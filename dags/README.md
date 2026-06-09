# dags — Airflow Orchestration (Phase 6) ✅ DONE

DAG `hr_daily_pipeline.py` chạy pipeline HR hàng ngày, mỗi task gọi lại script đã có từ phase 2–5.

## Luồng DAG — `hr_daily_pipeline` · schedule `0 6 * * *`

```
ingest → dbt_run → dbt_test (QUALITY GATE) → ml_score → export_dashboard → attrition_alert
```

| Task | Gọi | Làm gì |
|---|---|---|
| `ingest` | `load_to_mysql.py` | OLTP(Postgres) → Warehouse(MySQL), incremental theo watermark |
| `dbt_run` | `dbt run` | build 18 model (staging → core → mart) |
| `dbt_test` | `dbt test` | **53 test — cổng chất lượng**: fail → task sau bị skip |
| `ml_score` | `score_attrition.py` | chấm điểm rủi ro nghỉ → bảng `attrition_scores` |
| `export_dashboard` | `export_marts.py` | refresh `js/data.js` cho dashboard tĩnh |
| `attrition_alert` | (PythonOperator) | đọc `mart_attrition`, Slack-alert nếu rate quý gần nhất > ngưỡng |

## Nguyên tắc thiết kế
- **`dbt_test` = quality gate:** data fail test (vd `valid_to < valid_from`) → pipeline dừng, dashboard KHÔNG
  bị publish data lỗi. Đây là điểm cốt lõi của orchestration có kiểm soát chất lượng.
- **Không generate lại data mỗi ngày** (giữ seed cố định): pipeline mô phỏng ETL thật — data sinh ở OLTP,
  hàng ngày chỉ ingest phần MỚI rồi transform. (Generate là việc thủ công 1 lần, không nằm trong DAG hàng ngày.)
- **Host DB qua env:** compose set `MYSQL_HOST=mysql` / `POSTGRES_HOST=postgres` → script & dbt nối DB container
  qua service name, KHÔNG cần sửa code (script vốn đọc host từ env, default localhost).
- `max_active_runs=1` + `catchup=False`: tránh 2 run đụng watermark, không backfill quá khứ.

## Chạy

```bash
# 1) Dựng stack DB (nếu chưa) + Airflow
docker compose -f docker/docker-compose.yml --profile airflow up -d --build

# 2) Mở UI: http://localhost:8080  (user/pass: admin/admin — đổi trong .env)
#    Bật toggle DAG 'hr_daily_pipeline' rồi Trigger, hoặc:
docker exec hr_airflow airflow dags trigger hr_daily_pipeline

# 3) Xem trạng thái
docker exec hr_airflow airflow dags list-runs -d hr_daily_pipeline
```

> File container: DAG ở `/opt/airflow/dags`, src ở `/opt/airflow/src`, dbt ở `/opt/airflow/hr_analytics`,
> dbt profile (host=mysql) ở `/opt/airflow/dbt_profile` (xem `docker/dbt_profile/profiles.yml`).
