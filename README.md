# HR Analytics Platform

**Tagline:** People data → insight → action — workforce analytics from hire to exit

<!-- Sau khi push lên GitHub, đổi <USERNAME> để badge + link demo hoạt động: -->
<!-- ![CI](https://github.com/<USERNAME>/hr-analytics-platform/actions/workflows/ci.yml/badge.svg) -->

**🔗 Live Dashboard:** `https://<USERNAME>.github.io/hr-analytics-platform/` *(bật sau khi deploy — xem [DEPLOY.md](DEPLOY.md))*

> **Push GitHub + public dashboard:** xem [DEPLOY.md](DEPLOY.md) — repo riêng + GitHub Pages.

---

## Overview

End-to-end HR analytics system built on a synthetic dataset of 10,000 employees across 3 years. Covers the full employee lifecycle: hiring funnel, performance scoring, attrition prediction, headcount planning, and compensation benchmarking.

Key differentiators:
- ML attrition model (XGBoost) with SHAP explainability — not just dashboards
- dbt-modeled HR dimensional model with SCD Type 2 employee history
- Airflow DAG: daily incremental load → dbt run → ML scoring → alert
- Static HTML dashboard — no BI tool required for demo

---

## Architecture

```
Synthetic HR Data Generator (Python + Faker)
        │
        ▼
PostgreSQL (OLTP HR system, port 5433)
        │
   Python batch ingest (watermark-based incremental)
        │
        ▼
MySQL 8.0 (analytical warehouse, port 3306)
        │
      dbt Models (dbt-mysql)
   staging → core → mart
        │
   ┌────┴────┐
   │         │
Airflow    ML Model (XGBoost + SHAP)
Schedule   Attrition Scoring
   │         │
   └────┬────┘
        │
  HTML Dashboard (GHN light theme)
  Tab 1 Báo cáo thực trạng (5 section) · Tab 2 ML Dự báo
        │
   Airflow DAG (daily) + CI/CD (GitHub Actions)
```

> **Lưu ý kiến trúc:** Ban đầu dự định dùng Redshift via LocalStack, nhưng LocalStack Community
> không expose endpoint Redshift thật (port 5439). Đã chuyển sang **MySQL 8.0** làm analytical
> warehouse — chạy được hoàn toàn local, dbt-mysql adapter ổn định.

---

## Dataset (đã generate thực tế)

Synthetic dataset — 10,000 employees, 3 years, seed=42:

| Table (PostgreSQL `hr.*`) | Rows | Description |
|---|---|---|
| `employees` | 10,000 | Master employee record (5,535 terminated) |
| `departments` | 5 | Sales, Operations, Engineering, Product, HR |
| `job_levels` | 6 | Junior → Manager hierarchy |
| `salary_history` | 30,426 | Salary changes over time |
| `performance_reviews` | 75,708 | Quarterly reviews |
| `job_changes` | 6,465 | Promotions, transfers, terminations |
| `recruitment_events` | 110,155 | Hiring funnel events (nhiều ứng viên/requisition, rớt dần) |

Full load PostgreSQL → MySQL: **~232,765 rows trong ~30s**.

> Số liệu trên là bản **regenerate ở Phase 4** (thêm causal signal cho ML — xem `processing.md`).
> Generator dùng seed cố định nên chạy lại ra đúng các con số này.

---

## Tech Stack

| Layer | Tool |
|---|---|
| Data generator | Python + Faker |
| OLTP source | PostgreSQL 15 |
| Ingestion | Python (batch, watermark incremental) |
| Analytical warehouse | MySQL 8.0 |
| Transformation | dbt-mysql 1.7.0 |
| Orchestration | Apache Airflow 2.9 — DAG `hr_daily_pipeline` (DONE) |
| ML model | XGBoost + SHAP — AUC 0.71 |
| Dashboard | Static HTML/CSS/JS — 2 tab (5 section), GHN light theme (DONE) |
| Containerization | Docker Compose |
| CI/CD + Test | GitHub Actions — ruff + pytest + JS test + dbt build/test (DONE) |

---

## Project Structure

```
05-HR-Analytics-Platform/
├── .env.example            ← Mẫu env vars (KHÔNG commit .env thật)
├── .gitignore              ← Ignore .env, target/, __pycache__, data lớn
├── README.md
├── processing.md           ← Tiến trình từng phase
├── docker/
│   └── docker-compose.yml  ← PostgreSQL (5433) + MySQL (3306)
├── sql/
│   ├── init_schema.sql         ← PostgreSQL OLTP schema + seed
│   └── mysql_raw_schema.sql    ← MySQL raw layer + _load_watermarks
├── src/
│   ├── generator/          ← Synthetic HR data generator
│   ├── ingest/             ← PostgreSQL → MySQL loader (incremental)
│   ├── ml/                 ← Attrition model (Phase 4 ✅) + evaluate_attrition
│   └── dashboard/          ← Static HTML dashboard (Phase 5 ✅)
├── hr_analytics/           ← dbt project (tạo bằng `dbt init`)
│   └── models/
│       ├── staging/        ← 7 views: stg_*
│       ├── core/           ← dim_* + fct_* (tables)
│       └── mart/           ← mart_* (aggregated business metrics)
├── dags/                   ← Airflow DAG hr_daily_pipeline (Phase 6 ✅)
├── tests/                  ← pytest (generator/ml/dag/db) + JS tests (Phase 7 ✅)
├── data/                   ← Sample data (gitignored)
├── notebooks/              ← EDA notebooks
└── docs/
    ├── architecture.md
    └── screenshots/
```

> dbt models nằm trong `hr_analytics/` (scaffold chuẩn từ `dbt init`), **không** ở `models/` root.
> Profile `hr_analytics` đặt ở `~/.dbt/profiles.yml`.

---

## How to Run

```bash
# 1. Start services (PostgreSQL + MySQL + Adminer)
cp .env.example .env          # rồi điền password
docker-compose -f docker/docker-compose.yml up -d

# 2. Generate synthetic data vào PostgreSQL
pip install -r src/generator/requirements.txt
python src/generator/generate_hr_data.py --truncate

# 3. Load PostgreSQL → MySQL (incremental, idempotent)
pip install -r src/ingest/requirements.txt
python src/ingest/load_to_mysql.py

# 4. Run dbt models (staging → core → mart)
cd hr_analytics
dbt run        # 18 models
dbt test       # 53 data quality tests

# 5. Train + score attrition risk   (Phase 4 — DONE, AUC 0.71)
pip install -r src/ml/requirements.txt
cd src/ml
python train_attrition.py           # train XGBoost + save model
python score_attrition.py           # score active employees + SHAP → MySQL attrition_scores
cd ../..

# 6. Dashboard                      (Phase 5 — DONE, 2 tab / 5 section)
python src/dashboard/export_marts.py   # query mart_* + attrition_scores → js/data.js
start src/dashboard/index.html         # mở trực tiếp file (không cần server)
```

> ⚠️ Nếu chạy lại generator với `--truncate`, BẮT BUỘC dùng `load_to_mysql.py --full-load`
> (không phải incremental) để reset watermark — nếu không MySQL sẽ lệch PostgreSQL.

### Xem database

> ⚠️ **MySQL (3306) và PostgreSQL (5433) KHÔNG mở được bằng trình duyệt** — chúng nói
> giao thức TCP riêng, không phải HTTP. Mở `localhost:3306` ra `ERR_INVALID_HTTP_RESPONSE`,
> `localhost:5433` ra `ERR_EMPTY_RESPONSE` — đó là **bình thường**, nghĩa là DB đang sống.

Để xem data, dùng một trong các cách:

| Cách | Chi tiết |
|---|---|
| **Adminer (web UI)** | http://localhost:8081 — server `mysql` hoặc `postgres` (tên service, không phải 127.0.0.1) |
| DB client GUI | DBeaver / TablePlus → host `127.0.0.1`, port `3306` (MySQL) hoặc `5433` (PG) |
| CLI | `docker exec hr_mysql mysql -u hr_analyst -p hr_warehouse` |

**Adminer login:**
- MySQL → System: `MySQL`, Server: `mysql`, User: `hr_analyst`, Pass: `hr_mysql_pass`, DB: `hr_warehouse`
- PostgreSQL → System: `PostgreSQL`, Server: `postgres`, User: `hr_user`, Pass: `hr_pass`, DB: `hr_db`

---

## dbt Models (Phase 3 — DONE, 18/18 run + 53/53 test PASS)

### Staging (views) — clean raw layer
`stg_employees`, `stg_departments`, `stg_job_levels`, `stg_salary_history`,
`stg_performance_reviews`, `stg_job_changes`, `stg_recruitment_events`

### Core (tables) — dimensional model
| Model | Rows | Notes |
|---|---|---|
| `dim_date` | 2,922 | Calendar 2020–2027 (recursive CTE) |
| `dim_department` | 5 | |
| `dim_job_level` | 6 | |
| `dim_employee` | 10,930 | **SCD Type 2** — version theo promotion |
| `fct_performance` | 75,708 | Quarterly scores |
| `fct_salary` | 30,426 | Salary history |
| `fct_attrition` | 5,535 | Exit events (voluntary/involuntary/retirement) |

### Mart (tables) — business metrics
| Model | Rows | Grain |
|---|---|---|
| `mart_headcount` | 1,260 | (year_month_key, dept, level) |
| `mart_attrition` | 69 | (year_quarter, dept) — attrition rate |
| `mart_compensation` | 30 | (dept, level) — salary band p25/median/p75 |
| `mart_hiring` | 67 | Hiring funnel |

---

## Key Features

### 1. Attrition Prediction (XGBoost + SHAP) — *Phase 4 ✅*
- Binary classifier: will employee leave in next **180 days**?
- Features: tenure, performance trend, salary delta vs band, dept attrition rate (21 features)
- SHAP values explain each prediction — "top 3 reasons this person might leave"
- **Đã validate độ tin cậy**: out-of-time 0.695 · CV 0.718±0.007 · baseline LogReg · calibration (xem `evaluate_attrition.py`)

### 2. HR Dimensional Model (dbt) — *Phase 3 DONE*
- `dim_employee` — SCD Type 2 cho job/level changes (point-in-time correct)
- `fct_performance` / `fct_salary` / `fct_attrition`
- `mart_headcount` / `mart_attrition` / `mart_compensation` / `mart_hiring`

### 3. Dashboard (2 tab / 5 section) — *Phase 5 ✅*
**Tab 1 — Báo cáo thực trạng:** 5 section (Headcount · Attrition · Performance · Compensation · Hiring) +
Phân tích + Khuyến nghị vận hành. **Tab 2 — ML · Dự báo:** risk band + SHAP driver + heatmap Phòng×Cấp.
GHN light theme, canvas charts, filter ăn khớp grain data (dept/level/date-range/gran/gender/risk/tenure),
trend-strip + Δ cùng kỳ, xuất CSV mỗi bảng.

### 4. Airflow Orchestration — Phase 6 ✅
DAG `hr_daily_pipeline` (schedule `0 6 * * *`):
`ingest → dbt run → dbt test (quality gate) → ml score → export dashboard → attrition alert`.
`dbt test` fail → pipeline dừng, dashboard không bị publish data lỗi.

```bash
docker compose -f docker/docker-compose.yml --profile airflow up -d --build
# UI: http://localhost:8080 (admin/admin) — xem dags/README.md
```

### 5. CI/CD + Test Automation — Phase 7 ✅
GitHub Actions (`.github/workflows/hr-analytics-ci.yml`) chạy mỗi push/PR:
- **unit job**: ruff lint + `pytest -m "not db"` (25 test) + JS helper test (7 test).
- **integration job**: MySQL+Postgres service → generate → ingest → `dbt run` → **`dbt test` (quality gate)**
  → ML train+score → export → `pytest -m db`. Toàn pipeline re-run mỗi push.

```bash
pip install -r requirements-dev.txt
pytest -m "not db"   # unit nhanh
node tests/js/test_helpers.mjs
ruff check src dags tests
# xem tests/README.md
```

---

## Data Model

```
dim_employee (SCD2) ──┬── fct_performance
                      ├── fct_attrition
                      └── fct_salary

dim_department ───── dim_employee
dim_job_level  ───── dim_employee
dim_date ──────┬──── fct_performance
               └──── fct_attrition
```
