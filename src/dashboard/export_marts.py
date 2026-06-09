"""
export_marts.py — Query mart_* + attrition_scores từ MySQL → ghi js/data.js.

Dashboard tĩnh đọc trực tiếp `const DATA = {...}` từ data.js (không cần server/API).
Chạy lại mỗi khi mart hoặc attrition_scores cập nhật.

Usage:
    python export_marts.py
"""

import os
import sys
import json
import datetime as dt
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv

# Windows cp1252 console -> ép UTF-8
sys.stdout.reconfigure(encoding="utf-8")

load_dotenv(Path(__file__).parents[2] / ".env")

MYSQL_CFG = {
    "host": os.getenv("MYSQL_HOST", "127.0.0.1"),
    "port": int(os.getenv("MYSQL_PORT", "3306")),
    "database": os.getenv("MYSQL_DB", "hr_warehouse"),
    "user": os.getenv("MYSQL_USER", "hr_analyst"),
    "password": os.getenv("MYSQL_PASSWORD", "hr_mysql_pass"),
}

OUT = Path(__file__).parent / "js" / "data.js"

# Map tên feature kỹ thuật -> nhãn tiếng Việt cho SHAP driver
DRIVER_LABELS = {
    "last_score": "Điểm review gần nhất thấp",
    "last_4q_avg": "Điểm 4 quý gần đây thấp",
    "avg_score": "Điểm trung bình thấp",
    "last_score_delta": "Điểm đang giảm",
    "days_since_last_raise": "Lâu chưa tăng lương",
    "last_salary_delta_pct": "Mức tăng lương thấp",
    "current_salary": "Lương hiện tại",
    "dept_attrition_rate": "Phòng có tỷ lệ nghỉ cao",
    "tenure_days_at_cutoff": "Thâm niên ngắn",
    "age": "Độ tuổi",
    "num_managers": "Đổi quản lý nhiều",
    "num_reviews": "Số lần review",
    "num_salary_changes": "Số lần đổi lương",
}


def fetch(cur, sql):
    cur.execute(sql)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, _norm(r))) for r in cur.fetchall()]


def _norm(row):
    out = []
    for v in row:
        if isinstance(v, dt.date):
            out.append(v.isoformat())
        elif isinstance(v, bool):
            out.append(v)
        elif isinstance(v, int):
            out.append(v)                       # giữ int (CAST AS UNSIGNED/SIGNED) -> JSON gọn, bỏ '.0'
        elif v.__class__.__name__ == "Decimal":
            f = float(v)
            out.append(int(f) if f.is_integer() else f)  # Decimal nguyên -> int
        elif isinstance(v, float):
            out.append(int(v) if v.is_integer() else v)
        else:
            out.append(v)
    return out


def main():
    conn = mysql.connector.connect(**MYSQL_CFG)
    cur = conn.cursor()
    try:
        data = {
            "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
            "departments": fetch(cur, "SELECT department_id, department_name FROM dim_department ORDER BY department_id"),
            "levels": fetch(cur, "SELECT level_id, level_name, level_group FROM dim_job_level ORDER BY level_id"),
            "headcount": fetch(cur, """
                SELECT year_month_key, department_id, department_name, level_id, level_name,
                       headcount, headcount_female, headcount_male, avg_tenure_years, pct_female
                FROM mart_headcount ORDER BY year_month_key, department_id, level_id
            """),
            "attrition": fetch(cur, """
                SELECT exit_year_quarter, department_id, department_name,
                       exits_total, exits_voluntary, exits_involuntary, exits_retirement,
                       avg_headcount, attrition_rate_pct, voluntary_pct,
                       avg_tenure_at_exit, avg_last_perf_score, avg_last_salary
                FROM mart_attrition ORDER BY exit_year_quarter, department_id
            """),
            "compensation": fetch(cur, """
                SELECT department_id, department_name, level_id, level_name, level_group,
                       employee_count, salary_min, salary_max, salary_avg,
                       salary_p25, salary_median, salary_p75, salary_spread_pct
                FROM mart_compensation ORDER BY department_id, level_id
            """),
            "hiring": fetch(cur, """
                SELECT year_quarter, department_id, department_name, total_requisitions,
                       cnt_applied, cnt_screening, cnt_interview, cnt_offer, cnt_hired,
                       screening_rate_pct, interview_rate_pct, offer_rate_pct,
                       offer_accept_rate_pct, overall_hire_rate_pct, avg_days_to_hire
                FROM mart_hiring ORDER BY year_quarter, department_id
            """),
            # Thêm year_quarter để dashboard lọc Performance theo range quý (khớp filter tháng/quý)
            "perf_dist": fetch(cur, """
                SELECT p.year_quarter, e.department_id,
                       FLOOR(p.score * 2) / 2 AS score_bucket, COUNT(*) AS cnt
                FROM fct_performance p
                JOIN dim_employee e ON p.employee_id = e.employee_id AND e.is_current = 1
                GROUP BY p.year_quarter, e.department_id, score_bucket
                ORDER BY p.year_quarter, e.department_id, score_bucket
            """),
            "perf_by_dept": fetch(cur, """
                SELECT p.year_quarter, e.department_id, d.department_name,
                       SUM(p.score) AS sum_score, COUNT(*) AS n_reviews
                FROM fct_performance p
                JOIN dim_employee e ON p.employee_id = e.employee_id AND e.is_current = 1
                JOIN dim_department d ON e.department_id = d.department_id
                GROUP BY p.year_quarter, e.department_id, d.department_name
                ORDER BY p.year_quarter, e.department_id
            """),
            "risk": _risk_block(cur),
        }
    finally:
        conn.close()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = "'use strict';\n// Auto-generated by export_marts.py — KHÔNG sửa tay\nconst DATA = " \
        + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    OUT.write_text(body, encoding="utf-8")

    print(f"Wrote {OUT}")
    for k, v in data.items():
        if isinstance(v, list):
            print(f"  {k:14s} {len(v)} rows")


def _risk_block(cur):
    """attrition_scores của ngày score mới nhất: KPI band + top high-risk list."""
    cur.execute("SELECT MAX(scored_at) FROM attrition_scores")
    scored_at = cur.fetchone()[0]
    scored_at = scored_at.isoformat() if scored_at else None

    bands = fetch(cur, """
        SELECT risk_band, COUNT(*) AS cnt, ROUND(AVG(risk_score), 3) AS avg_score
        FROM attrition_scores
        WHERE scored_at = (SELECT MAX(scored_at) FROM attrition_scores)
        GROUP BY risk_band
    """)

    # Bảng chi tiết NV rủi ro — XUẤT TOÀN BỘ NV được chấm điểm (cả 3 band, 4,519 NV).
    # -> Bảng luôn khớp KPI/donut/heatmap ở MỌI tổ hợp filter (dept/level/band/tenure), không còn lệch số.
    # Cột tinh gọn (bỏ full_name không dùng) để data.js không phồng quá mức. Sort theo risk_score giảm dần.
    # Time dimension: scored_at (ngày chấm) + last_review_quarter (quý review gần nhất).
    # scored_at bỏ khỏi per-row (giống nhau mọi dòng -> đã có ở risk.scored_at).
    # CAST id/tenure về INT để JSON gọn (bỏ '.0'). 4,519 dòng nên từng byte/dòng đáng kể.
    top = fetch(cur, """
        SELECT s.employee_id, s.risk_score, s.risk_band,
               s.driver_1, s.driver_2, s.driver_3,
               CAST(e.department_id AS UNSIGNED) AS department_id, d.department_name,
               CAST(e.level_id AS UNSIGNED)      AS level_id, l.level_name,
               CAST(e.tenure_days AS SIGNED)     AS tenure_days,
               lr.last_review_quarter
        FROM attrition_scores s
        JOIN dim_employee e   ON s.employee_id = e.employee_id AND e.is_current = 1
        JOIN dim_department d ON e.department_id = d.department_id
        JOIN dim_job_level  l ON e.level_id      = l.level_id
        LEFT JOIN (
            SELECT employee_id, MAX(year_quarter) AS last_review_quarter
            FROM fct_performance GROUP BY employee_id
        ) lr ON s.employee_id = lr.employee_id
        WHERE s.scored_at = (SELECT MAX(scored_at) FROM attrition_scores)
        ORDER BY s.risk_score DESC
    """)
    for r in top:
        for k in ("driver_1", "driver_2", "driver_3"):
            r[k] = DRIVER_LABELS.get(r[k], r[k] or "")

    # High-risk theo dept (đếm band=high mỗi phòng)
    by_dept = fetch(cur, """
        SELECT d.department_name, COUNT(*) AS high_cnt
        FROM attrition_scores s
        JOIN dim_employee e   ON s.employee_id = e.employee_id AND e.is_current = 1
        JOIN dim_department d ON e.department_id = d.department_id
        WHERE s.scored_at = (SELECT MAX(scored_at) FROM attrition_scores)
          AND s.risk_band = 'high'
        GROUP BY d.department_name ORDER BY high_cnt DESC
    """)

    # Phân bố ĐỦ 3 band theo từng phòng — nguồn đúng cho donut/KPI khi lọc dept
    # (risk.top chỉ có 100 NV toàn high, không dùng để tính phân bố band của 1 phòng).
    bands_by_dept = fetch(cur, """
        SELECT e.department_id, d.department_name, s.risk_band,
               COUNT(*) AS cnt, ROUND(AVG(s.risk_score), 3) AS avg_score
        FROM attrition_scores s
        JOIN dim_employee e   ON s.employee_id = e.employee_id AND e.is_current = 1
        JOIN dim_department d ON e.department_id = d.department_id
        WHERE s.scored_at = (SELECT MAX(scored_at) FROM attrition_scores)
        GROUP BY e.department_id, d.department_name, s.risk_band
        ORDER BY e.department_id, s.risk_band
    """)

    # Phân bố 3 band theo cấp bậc — cho filter Level + heatmap Phòng × Cấp ở tab ML
    bands_by_level = fetch(cur, """
        SELECT e.level_id, l.level_name, s.risk_band, COUNT(*) AS cnt
        FROM attrition_scores s
        JOIN dim_employee e  ON s.employee_id = e.employee_id AND e.is_current = 1
        JOIN dim_job_level l ON e.level_id     = l.level_id
        WHERE s.scored_at = (SELECT MAX(scored_at) FROM attrition_scores)
        GROUP BY e.level_id, l.level_name, s.risk_band
        ORDER BY e.level_id, s.risk_band
    """)

    # Phân bố band theo Phòng × Cấp — heatmap high-risk concentration ở tab ML
    bands_by_dept_level = fetch(cur, """
        SELECT e.department_id, d.department_name, e.level_id, l.level_name,
               s.risk_band, COUNT(*) AS cnt
        FROM attrition_scores s
        JOIN dim_employee e   ON s.employee_id = e.employee_id AND e.is_current = 1
        JOIN dim_department d ON e.department_id = d.department_id
        JOIN dim_job_level  l ON e.level_id      = l.level_id
        WHERE s.scored_at = (SELECT MAX(scored_at) FROM attrition_scores)
        GROUP BY e.department_id, d.department_name, e.level_id, l.level_name, s.risk_band
        ORDER BY e.department_id, e.level_id, s.risk_band
    """)

    return {
        "scored_at": scored_at, "bands": bands, "top": top, "by_dept": by_dept,
        "bands_by_dept": bands_by_dept,
        "bands_by_level": bands_by_level,
        "bands_by_dept_level": bands_by_dept_level,
    }


if __name__ == "__main__":
    main()
