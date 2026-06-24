# HR Analytics Platform

**Tagline:** People data → insight → action — workforce analytics from hire to exit

![CI](https://github.com/ChanC003/hr-analytics-platform/actions/workflows/ci.yml/badge.svg)

**🔗 Live Dashboard:** https://chanc003.github.io/hr-analytics-platform/ *(enabled after deploy — see [DEPLOY.md](DEPLOY.md))*

> **Push GitHub + public dashboard:** see [DEPLOY.md](DEPLOY.md) — separate repo + GitHub Pages.

---

## How to Run

```bash
# 1. Start services (PostgreSQL + MySQL + Adminer)
cp .env.example .env          # fill in passwords for the variables in .env
docker-compose -f docker/docker-compose.yml up -d

# 2. Generate synthetic data into PostgreSQL
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
start src/dashboard/index.html         # open file directly (no server needed)
```

> ⚠️ If you re-run the generator with `--truncate`, you MUST use `load_to_mysql.py --full-load`
> (not incremental) to reset the watermark — otherwise MySQL will drift out of sync with PostgreSQL.

### Viewing the database

> ⚠️ **MySQL (3306) and PostgreSQL (5433) cannot be opened in a browser** — they speak their own
> TCP protocol, not HTTP. Opening `localhost:3306` returns `ERR_INVALID_HTTP_RESPONSE`,
> `localhost:5433` returns `ERR_EMPTY_RESPONSE` — this is **normal** and means the DB is running.

To inspect data, use one of the following:

| Method | Details |
|---|---|
| **Adminer (web UI)** | http://localhost:8081 — server `mysql` or `postgres` (service name, not 127.0.0.1) |
| DB client GUI | DBeaver / TablePlus → host `127.0.0.1`, port `3306` (MySQL) or `5434` (PG) |
| CLI | `docker exec hr_mysql mysql -u mysql -p hr_db` |

**Adminer login** (use values from `.env`):
- MySQL → System: `MySQL`, Server: `mysql`, User: `MYSQL_USER`, Pass: `MYSQL_PASSWORD`, DB: `MYSQL_DB`
- PostgreSQL → System: `PostgreSQL`, Server: `postgres`, User: `POSTGRES_USER`, Pass: `POSTGRES_PASSWORD`, DB: `POSTGRES_DB`

### Airflow orchestration

```bash
docker compose -f docker/docker-compose.yml --profile airflow up -d --build
# UI: http://localhost:8080 (AIRFLOW_ADMIN_USER/AIRFLOW_ADMIN_PASSWORD from .env) — see dags/README.md
```

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
  Tab 1 Status Report (5 sections) · Tab 2 ML Prediction
        │
   Airflow DAG (daily) + CI/CD (GitHub Actions)
```

> **Architecture note:** Originally planned to use Redshift via LocalStack, but LocalStack Community
> does not expose a real Redshift endpoint (port 5439). Switched to **MySQL 8.0** as the analytical
> warehouse — fully local, dbt-mysql adapter is stable.

---

## Dataset (generated)

Synthetic dataset — 10,000 employees, 3 years, seed=42:

| Table (PostgreSQL `hr.*`) | Rows | Description |
|---|---|---|
| `employees` | 10,000 | Master employee record (5,535 terminated) |
| `departments` | 5 | Sales, Operations, Engineering, Product, HR |
| `job_levels` | 6 | Junior → Manager hierarchy |
| `salary_history` | 30,426 | Salary changes over time |
| `performance_reviews` | 75,708 | Quarterly reviews |
| `job_changes` | 6,465 | Promotions, transfers, terminations |
| `recruitment_events` | 110,155 | Hiring funnel events (multiple candidates per requisition, progressive drop-off) |

Full load PostgreSQL → MySQL: **~232,765 rows in ~30s**.

> The figures above reflect the **Phase 4 regeneration** (added causal signal for ML — see `processing.md`).
> The generator uses a fixed seed, so re-running produces these exact numbers.

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
04-HR-Analytics-Platform/
├── .env.example            ← Env vars template (DO NOT commit real .env)
├── .gitignore              ← Ignore .env, target/, __pycache__, large data files
├── README.md
├── processing.md           ← Phase-by-phase progress log
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
├── hr_analytics/           ← dbt project (created with `dbt init`)
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

> dbt models live inside `hr_analytics/` (standard scaffold from `dbt init`), **not** at `models/` root.
> Profile `hr_analytics` is set in `~/.dbt/profiles.yml`.

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
| `dim_employee` | 10,930 | **SCD Type 2** — versioned by promotion |
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
- **Validated reliability**: out-of-time 0.695 · CV 0.718±0.007 · baseline LogReg · calibration (see `evaluate_attrition.py`)

### 2. HR Dimensional Model (dbt) — *Phase 3 DONE*
- `dim_employee` — SCD Type 2 cho job/level changes (point-in-time correct)
- `fct_performance` / `fct_salary` / `fct_attrition`
- `mart_headcount` / `mart_attrition` / `mart_compensation` / `mart_hiring`

### 3. Dashboard (2 tab / 5 section) — *Phase 5 ✅*
**Tab 1 — Status Report:** 5 sections (Headcount · Attrition · Performance · Compensation · Hiring) +
Analysis + Operational Recommendations. **Tab 2 — ML · Prediction:** risk band + SHAP driver + Dept×Level heatmap.
GHN light theme, canvas charts, filters aligned to data grain (dept/level/date-range/gran/gender/risk/tenure),
trend-strip + period-over-period Δ, CSV export per table.

### 4. Airflow Orchestration — Phase 6 ✅
DAG `hr_daily_pipeline` (schedule `0 6 * * *`):
`ingest → dbt run → dbt test (quality gate) → ml score → export dashboard → attrition alert`.
`dbt test` failure → pipeline stops, dashboard is not published with bad data.

### 5. CI/CD + Test Automation — Phase 7 ✅
GitHub Actions (`.github/workflows/hr-analytics-ci.yml`) runs on every push/PR:
- **unit job**: ruff lint + `pytest -m "not db"` (25 tests) + JS helper tests (7 tests).
- **integration job**: MySQL+Postgres service → generate → ingest → `dbt run` → **`dbt test` (quality gate)**
  → ML train+score → export → `pytest -m db`. Full pipeline re-runs on every push.

```bash
pip install -r requirements-dev.txt
pytest -m "not db"   # fast unit tests
node tests/js/test_helpers.mjs
ruff check src dags tests
# see tests/README.md
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
