# tests — Test automation (Phase 7)

Test cho pure logic của pipeline + integration thật trên DB. Chạy trong CI (GitHub Actions) mỗi push/PR.

## Cấu trúc

| File | Phủ | Cần DB? |
|---|---|---|
| `test_generator.py` | salary_for, next_level, quarters_between, **clamp_events_to_exit** (regression Phase 4c) | ❌ |
| `test_ml.py` | feature_columns, _years_between, _risk_band (ngưỡng band), prepare_xy (one-hot) | ❌ |
| `test_dag.py` | DAG parse (AST) + đủ 6 task + thứ tự quality gate; load thật nếu có Airflow | ❌ |
| `test_integration_db.py` | build_features shape/label/no-leak, dept_attrition_rate range | ✅ (`@pytest.mark.db`) |
| `js/test_helpers.mjs` | statusOf, fmtPct/Int/Score, deltaCell, tenureGroup, monthToQuarter | ❌ (Node) |

## Chạy local

```bash
pip install -r requirements-dev.txt

pytest -m "not db"        # unit nhanh, không cần DB (25 test)
pytest -m db              # integration — cần MySQL đang chạy (docker compose up)
pytest                    # tất cả
node tests/js/test_helpers.mjs   # JS helper (7 test)
ruff check src dags tests        # lint
```

## CI — `.github/workflows/hr-analytics-ci.yml`

2 job:
1. **unit** — ruff lint + `pytest -m "not db"` + coverage + JS test. Nhanh, không DB.
2. **integration** — dựng MySQL + Postgres service → seed schema → generate (1500 NV) → ingest →
   `dbt run` → **`dbt test` (quality gate)** → ML train+score → export → `pytest -m db`.
   = chạy lại TOÀN BỘ pipeline mỗi push, fail ở bất kỳ bước nào → CI đỏ.
