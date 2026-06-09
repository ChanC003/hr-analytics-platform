# Architecture — HR Analytics Platform

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  DATA SOURCES                           │
│                                                         │
│   Python Faker Generator                                │
│   → employees, departments, reviews, salary, exits      │
└─────────────────┬───────────────────────────────────────┘
                  │ batch insert
                  ▼
┌─────────────────────────────────────────────────────────┐
│            PostgreSQL (OLTP)  — port 5433               │
│                                                         │
│   hr.employees        hr.departments                    │
│   hr.performance_reviews                                │
│   hr.salary_history   hr.job_changes                    │
│   hr.recruitment_events                                 │
└─────────────────┬───────────────────────────────────────┘
                  │ Python ingest (batch, watermark incremental)
                  ▼
┌─────────────────────────────────────────────────────────┐
│        MySQL 8.0 (Analytical Warehouse) — port 3306     │
│                                                         │
│   raw_employees  raw_performance  raw_salary  ...       │
│   + _load_watermarks (incremental state)                │
└─────────────────┬───────────────────────────────────────┘
                  │ dbt run
                  ▼
┌─────────────────────────────────────────────────────────┐
│               dbt Models                                │
│                                                         │
│  STAGING         CORE                  MART             │
│  stg_employees → dim_employee (SCD2)                    │
│  stg_dept      → dim_department   ─►  mart_headcount    │
│  stg_reviews   → fct_performance  ─►  mart_attrition    │
│  stg_salary    → fct_salary       ─►  mart_compensation │
│  stg_exits     → fct_attrition    ─►  mart_hiring       │
│  stg_recruit   → fct_recruitment                        │
└──────────┬──────────────────────────────────────────────┘
           │                    │
           ▼                    ▼
┌──────────────────┐  ┌────────────────────────────────┐
│  XGBoost Model   │  │  HTML Dashboard (GHN light)     │
│                  │  │  Tab 1 Báo cáo thực trạng:      │
│  Features (21):  │  │   Headcount·Attrition·Perf·     │
│  - tenure        │  │   Compensation·Hiring (5 sect)  │
│  - perf_trend    │  │   + Phân tích + Khuyến nghị     │
│  - salary_delta  │  │  Tab 2 ML·Dự báo:               │
│  - dept_attrition│  │   risk band + SHAP + heatmap    │
│                  │  └────────────────────────────────┘
│  Output:         │
│  - risk_score    │
│  - shap_drivers  │
└──────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│        Apache Airflow 2.9 DAG  (Phase 6 ✅)             │
│                                                         │
│   hr_daily_pipeline (schedule: 0 6 * * *)               │
│   ┌──────────────────────────────────────────────────┐  │
│   │ ingest → dbt_run → dbt_test (QUALITY GATE) →     │  │
│   │ ml_score → export_dashboard → attrition_alert    │  │
│   └──────────────────────────────────────────────────┘  │
│   dbt_test fail → các task sau SKIP (không publish lỗi) │
│   Deploy: docker compose --profile airflow up --build   │
│   Container nối DB qua service name (MYSQL_HOST=mysql)   │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│        GitHub Actions CI/CD  (Phase 7 ✅)               │
│                                                         │
│   unit job:  ruff + pytest(-m "not db") + JS test       │
│   integ job: MySQL+PG service → generate → ingest →     │
│              dbt run → dbt test (gate) → ML → export →   │
│              pytest(-m db)  = re-run cả pipeline mỗi push│
└─────────────────────────────────────────────────────────┘
```

## Data Model (Core Layer)

### dim_employee (SCD Type 2)
| Column | Type | Notes |
|---|---|---|
| employee_sk | INT | Surrogate key |
| employee_id | VARCHAR | Natural key |
| full_name | VARCHAR | |
| department_id | INT | FK dim_department |
| job_level | VARCHAR | Junior/Mid/Senior/Lead/Manager |
| hire_date | DATE | |
| valid_from | DATE | SCD2 start |
| valid_to | DATE | SCD2 end (NULL = current) |
| is_current | BOOLEAN | |

### fct_performance
| Column | Type | Notes |
|---|---|---|
| perf_sk | INT | Surrogate key |
| employee_sk | INT | FK dim_employee |
| review_date | DATE | |
| score | FLOAT | 1.0 – 5.0 |
| manager_id | VARCHAR | |
| department_id | INT | |

### fct_attrition
| Column | Type | Notes |
|---|---|---|
| employee_sk | INT | FK dim_employee |
| exit_date | DATE | |
| exit_type | VARCHAR | voluntary/involuntary/retirement |
| tenure_days | INT | |
| last_score | FLOAT | Last perf score before exit |

## ML Model Design

**Target:** `will_leave_90d` (binary)

**Feature engineering:**
- `tenure_days` — days since hire_date
- `perf_trend` — slope of last 4 quarterly scores
- `salary_delta_vs_band` — (current_salary - band_midpoint) / band_midpoint
- `manager_change_count_12m` — how many manager changes in last 12 months
- `dept_attrition_rate_6m` — rolling attrition rate for employee's department
- `days_since_last_promotion` — staleness signal

**Training split:** 80/20, stratified by dept + exit_type

**Explainability:** SHAP TreeExplainer, per-employee top-3 feature contributions written to `attrition_scores` table

## Decisions Log

| Decision | Why |
|---|---|
| MySQL 8.0 over Redshift/LocalStack | **Đổi hướng:** LocalStack Community không expose endpoint Redshift thật (port 5439). MySQL chạy 100% local, dbt-mysql adapter ổn định, đủ cho demo dimensional model |
| PostgreSQL port 5433 (không 5432) | Windows host đã chạy native PostgreSQL chiếm 5432 — container map ra 5433 để tránh conflict |
| dbt project trong `hr_analytics/` (dbt init) | Dùng scaffold chuẩn của `dbt init` thay vì tự dựng `models/` — đúng convention, có sẵn analyses/macros/seeds/snapshots/tests |
| Watermark incremental load | `_load_watermarks` table track PK cuối cùng đã load mỗi bảng → idempotent, fact tables "nothing new" khi chạy lại |
| SCD2 for dim_employee | HR data needs point-in-time: "what was their salary when they left?" |
| XGBoost over Logistic Regression | Handles feature interactions (tenure × perf trend), better AUC on tabular HR data |
| SHAP over feature importance | HR managers need "why", not just score — SHAP gives per-employee explanation |
| Static HTML dashboard | No BI tool needed — recruiter opens file directly in browser |
