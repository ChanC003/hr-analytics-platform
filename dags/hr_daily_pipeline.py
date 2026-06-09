"""
hr_daily_pipeline — Airflow DAG orchestrate pipeline HR hàng ngày (Phase 6).

Luồng (mỗi task gọi lại đúng script đã có từ phase 2–5):

    ingest  →  dbt_run  →  dbt_test (QUALITY GATE)  →  ml_score  →  export_dashboard  →  attrition_alert

Nguyên tắc:
  - `dbt_test` là CỔNG CHẤT LƯỢNG: fail → các task sau KHÔNG chạy (dashboard không bị publish data lỗi).
  - Không generate lại data mỗi ngày (giữ seed cố định) — pipeline mô phỏng ETL: data sinh ở OLTP,
    hàng ngày chỉ ingest phần MỚI (incremental theo watermark) rồi transform.
  - Host DB lấy từ env (compose set MYSQL_HOST=mysql / POSTGRES_HOST=postgres) → script chạy không cần sửa.

Chạy: bật DAG trong UI (http://localhost:8080), hoặc `airflow dags trigger hr_daily_pipeline`.
"""

from __future__ import annotations

import os
import pendulum
from airflow.models.dag import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator

# Đường dẫn trong container (xem volumes ở docker-compose)
SRC = "/opt/airflow/src"
DBT_PROJECT = "/opt/airflow/hr_analytics"

default_args = {
    "owner": "hr-data",
    "retries": 1,
    "retry_delay": pendulum.duration(minutes=2),
}

with DAG(
    dag_id="hr_daily_pipeline",
    description="Ingest → dbt → test(gate) → ML score → export dashboard → alert",
    schedule="0 6 * * *",                       # 6h sáng mỗi ngày
    start_date=pendulum.datetime(2026, 1, 1, tz="Asia/Ho_Chi_Minh"),
    catchup=False,                              # không backfill các ngày quá khứ
    max_active_runs=1,                          # 1 run/lúc — tránh đụng watermark
    default_args=default_args,
    tags=["hr", "etl", "dbt", "ml"],
) as dag:

    # 1) INGEST — load incremental OLTP(Postgres) → Warehouse(MySQL) theo watermark
    ingest = BashOperator(
        task_id="ingest",
        bash_command=f"cd {SRC}/ingest && python load_to_mysql.py",
    )

    # 2) DBT RUN — build 18 model (staging → core → mart)
    dbt_run = BashOperator(
        task_id="dbt_run",
        bash_command=f"cd {DBT_PROJECT} && dbt run --no-use-colors",
    )

    # 3) DBT TEST — QUALITY GATE: 53 test. Fail → DAG dừng, task sau bị skip.
    dbt_test = BashOperator(
        task_id="dbt_test",
        bash_command=f"cd {DBT_PROJECT} && dbt test --no-use-colors",
    )

    # 4) ML SCORE — chấm điểm rủi ro nghỉ việc hôm nay → bảng attrition_scores
    ml_score = BashOperator(
        task_id="ml_score",
        bash_command=f"cd {SRC}/ml && python score_attrition.py",
    )

    # 5) EXPORT — refresh data.js cho dashboard tĩnh
    export_dashboard = BashOperator(
        task_id="export_dashboard",
        bash_command=f"cd {SRC}/dashboard && python export_marts.py",
    )

    # 6) ALERT — cảnh báo nếu attrition rate quý hoàn chỉnh gần nhất vượt ngưỡng
    def _check_attrition_and_alert(**_):
        """Đọc mart_attrition, lấy rate quý HOÀN CHỈNH gần nhất, alert nếu > ngưỡng.

        Quý đang chạy có rate=NULL nên đã bị loại tự nhiên (WHERE rate IS NOT NULL).
        Gửi Slack nếu có SLACK_WEBHOOK_URL, nếu không chỉ log (demo offline vẫn chạy được).
        """
        import json
        import urllib.request
        import mysql.connector

        threshold = float(os.getenv("ATTRITION_ALERT_THRESHOLD", "10"))
        conn = mysql.connector.connect(
            host=os.getenv("MYSQL_HOST", "mysql"),
            port=int(os.getenv("MYSQL_PORT", "3306")),
            database=os.getenv("MYSQL_DB", "hr_warehouse"),
            user=os.getenv("MYSQL_USER", "hr_analyst"),
            password=os.getenv("MYSQL_PASSWORD", "hr_mysql_pass"),
        )
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT exit_year_quarter, ROUND(AVG(attrition_rate_pct), 2) AS rate
                FROM mart_attrition
                WHERE attrition_rate_pct IS NOT NULL
                GROUP BY exit_year_quarter
                ORDER BY exit_year_quarter DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
        finally:
            conn.close()

        if not row:
            print("[alert] Chưa có dữ liệu attrition — bỏ qua.")
            return
        quarter, rate = row[0], float(row[1])
        over = rate > threshold
        msg = (f"{'🔴 ATTRITION SPIKE' if over else '✅ Attrition OK'} — quý {quarter}: "
               f"{rate}% (ngưỡng {threshold}%)")
        print("[alert]", msg)

        webhook = os.getenv("SLACK_WEBHOOK_URL", "").strip()
        if over and webhook:
            data = json.dumps({"text": msg}).encode("utf-8")
            req = urllib.request.Request(webhook, data=data,
                                         headers={"Content-Type": "application/json"})
            try:
                urllib.request.urlopen(req, timeout=10)
                print("[alert] Đã gửi Slack.")
            except Exception as e:  # không để alert làm fail cả pipeline
                print(f"[alert] Gửi Slack lỗi (bỏ qua): {e}")
        elif over:
            print("[alert] SLACK_WEBHOOK_URL trống — chỉ log, không gửi.")

    attrition_alert = PythonOperator(
        task_id="attrition_alert",
        python_callable=_check_attrition_and_alert,
    )

    # ── Thứ tự: quality gate ở giữa, mọi thứ sau test mới chạy ──
    ingest >> dbt_run >> dbt_test >> ml_score >> export_dashboard >> attrition_alert
