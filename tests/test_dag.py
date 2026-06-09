"""Validate DAG hr_daily_pipeline — parse được, đủ task, thứ tự đúng (quality gate ở giữa).

Nếu Airflow CÓ cài (môi trường có airflow): import thật, kiểm DAG object + task deps.
Nếu KHÔNG (CI nhẹ): fallback kiểm bằng AST — vẫn bắt được lỗi cú pháp / thiếu task / sai chain.
"""
import ast
from pathlib import Path

import pytest

DAG_FILE = Path(__file__).resolve().parents[1] / "dags" / "hr_daily_pipeline.py"
EXPECTED_TASKS = {
    "ingest", "dbt_run", "dbt_test", "ml_score", "export_dashboard", "attrition_alert",
}


def test_dag_file_exists():
    assert DAG_FILE.is_file()


def test_dag_parses_syntactically():
    ast.parse(DAG_FILE.read_text(encoding="utf-8"))


def test_dag_has_all_tasks_and_gate_order():
    src = DAG_FILE.read_text(encoding="utf-8")
    for t in EXPECTED_TASKS:
        assert f'task_id="{t}"' in src, f"thiếu task {t}"
    # quality gate: dbt_test phải đứng TRƯỚC ml_score trong chain
    assert "dbt_test >> ml_score" in src
    # full chain đúng thứ tự
    assert ("ingest >> dbt_run >> dbt_test >> ml_score >> "
            "export_dashboard >> attrition_alert") in src
    # schedule daily 6h
    assert '"0 6 * * *"' in src


def test_dag_loads_in_airflow_if_available():
    """Chỉ chạy khi môi trường có Airflow (skip ở CI nhẹ)."""
    pytest.importorskip("airflow")
    import importlib.util

    spec = importlib.util.spec_from_file_location("hr_daily_pipeline", DAG_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    dag = mod.dag
    assert dag.dag_id == "hr_daily_pipeline"
    assert {t.task_id for t in dag.tasks} == EXPECTED_TASKS
    # dbt_test là upstream của ml_score (quality gate)
    ml = dag.get_task("ml_score")
    assert "dbt_test" in {t.task_id for t in ml.upstream_list}
