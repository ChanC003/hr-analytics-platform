"""Integration test cần MySQL (đánh @pytest.mark.db).

Skip tự động nếu không kết nối được DB (vd CI nhẹ chưa dựng MySQL).
Chạy đầy đủ: `pytest -m db` khi stack DB đang chạy.
"""
import pytest

import build_features as bf


def _db_available():
    try:
        with bf._engine().connect():
            return True
    except Exception:
        return False


pytestmark = pytest.mark.db
skip_no_db = pytest.mark.skipif(not _db_available(), reason="MySQL không sẵn sàng")


@skip_no_db
def test_build_features_shape_and_label():
    """build_features tại cutoff train -> đúng cột feature + label nhị phân, không leak."""
    df = bf.build_features("2025-06-30", for_training=True)
    assert len(df) > 0
    assert "left_180d" in df.columns
    # label nhị phân 0/1
    assert set(df["left_180d"].unique()) <= {0, 1}
    # tỷ lệ positive hợp lý (imbalanced nhưng có tín hiệu) — 5–40%
    pos_rate = df["left_180d"].mean()
    assert 0.05 < pos_rate < 0.40
    # feature point-in-time: không có cột raw date rò rỉ
    for leak_col in ("exit_date", "hire_date", "birth_date"):
        assert leak_col not in df.columns


@skip_no_db
def test_dept_attrition_rate_range():
    """Tỷ lệ nghỉ lịch sử mỗi phòng nằm trong [0, 1]."""
    rates = bf._dept_attrition_rate("2025-06-30")
    assert len(rates) >= 1
    assert all(0.0 <= r <= 1.0 for r in rates.values())
