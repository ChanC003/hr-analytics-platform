"""Unit test pure logic của ML pipeline — không cần DB.

feature_columns (loại id/label), _years_between (tuổi/thâm niên), _risk_band (ngưỡng band),
prepare_xy (one-hot + numeric). Test point-in-time/leakage cần DB -> đánh @pytest.mark.db ở file khác.
"""
import datetime as dt

import numpy as np
import pandas as pd
import pytest

import build_features as bf
import score_attrition as sc
from train_attrition import prepare_xy


# ── feature_columns ─────────────────────────────────────────────────────────
def test_feature_columns_excludes_id_and_label():
    df = pd.DataFrame({
        "employee_id": ["E1"], "left_180d": [1],
        "last_score": [3.2], "age": [30],
    })
    cols = bf.feature_columns(df)
    assert "employee_id" not in cols
    assert "left_180d" not in cols
    assert set(cols) == {"last_score", "age"}


# ── _years_between ──────────────────────────────────────────────────────────
def test_years_between_basic():
    born = dt.date(2000, 1, 1)
    ref = dt.date(2025, 1, 1)
    assert bf._years_between(born, ref) == pytest.approx(25.0, abs=0.1)


def test_years_between_none_returns_zero():
    assert bf._years_between(None, dt.date(2025, 1, 1)) == 0.0


# ── _risk_band (ngưỡng band khớp dashboard: high>=0.6, medium>=0.3) ──────────
@pytest.mark.parametrize("score,band", [
    (0.95, "high"), (0.60, "high"),
    (0.59, "medium"), (0.30, "medium"),
    (0.29, "low"), (0.0, "low"),
])
def test_risk_band_thresholds(score, band):
    assert sc._risk_band(score) == band


# ── prepare_xy (one-hot categorical, mọi cột numeric, y là int) ──────────────
def test_prepare_xy_onehot_and_numeric():
    df = pd.DataFrame({
        "employee_id": ["E1", "E2"],
        "gender": ["male", "female"],
        "employment_type": ["full_time", "contract"],
        "last_score": [3.0, 4.0],
        "left_180d": [0, 1],
    })
    X, y = prepare_xy(df)
    # one-hot: phải có cột gender_* và employment_type_*
    assert any(c.startswith("gender_") for c in X.columns)
    assert any(c.startswith("employment_type_") for c in X.columns)
    # không còn cột id/label/categorical gốc
    assert "employee_id" not in X.columns and "left_180d" not in X.columns
    assert "gender" not in X.columns
    # không còn cột object/string (chỉ numeric hoặc bool one-hot) + không NaN
    assert X.select_dtypes(include="object").shape[1] == 0
    assert not X.isnull().any().any()
    # y đúng nhãn
    assert list(y) == [0, 1]
    assert y.dtype == int or np.issubdtype(y.dtype, np.integer)
