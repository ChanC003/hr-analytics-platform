"""
score_attrition.py — Score toàn bộ nhân viên đang active HÔM NAY, ghi risk score + SHAP top-3 driver vào MySQL.

Pipeline:
  1. Load model + feature columns đã train.
  2. build_features tại cutoff = hôm nay (for_training=False — chưa biết nhãn).
  3. Align cột với feature_columns.json (thêm cột thiếu = 0).
  4. predict_proba -> risk_score.
  5. SHAP TreeExplainer -> top-3 driver mỗi nhân viên.
  6. Ghi bảng attrition_scores (truncate + insert).
"""

import os
import sys
import json
import datetime as dt
import joblib
import numpy as np
import pandas as pd
import mysql.connector

# Windows cp1252 console -> ép UTF-8 cho output tiếng Việt
sys.stdout.reconfigure(encoding="utf-8")

from build_features import build_features, feature_columns, CATEGORICAL, MYSQL_CFG

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")


def _conn():
    return mysql.connector.connect(**MYSQL_CFG)


def _ensure_table(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS attrition_scores (
            employee_id        VARCHAR(12)   NOT NULL,
            scored_at          DATE          NOT NULL,
            risk_score         DECIMAL(5,4)  NOT NULL,
            risk_band          VARCHAR(10)   NOT NULL,
            driver_1           VARCHAR(60),
            driver_1_impact    DECIMAL(8,4),
            driver_2           VARCHAR(60),
            driver_2_impact    DECIMAL(8,4),
            driver_3           VARCHAR(60),
            driver_3_impact    DECIMAL(8,4),
            PRIMARY KEY (employee_id, scored_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )


def _risk_band(score: float) -> str:
    if score >= 0.6:
        return "high"
    if score >= 0.3:
        return "medium"
    return "low"


def align_features(df: pd.DataFrame, feat_cols: list) -> pd.DataFrame:
    """Encode + align về đúng cột model đã train."""
    X = df[feature_columns(df)].copy()
    X = pd.get_dummies(X, columns=[c for c in CATEGORICAL if c in X.columns], dummy_na=False)
    X = X.apply(pd.to_numeric, errors="coerce").fillna(0)
    # thêm cột thiếu, bỏ cột thừa, đúng thứ tự
    for c in feat_cols:
        if c not in X.columns:
            X[c] = 0
    X = X[feat_cols]
    return X


def main():
    today = dt.date.today().isoformat()
    print("[1/5] Load model ...")
    model = joblib.load(os.path.join(MODEL_DIR, "attrition_xgb.pkl"))
    with open(os.path.join(MODEL_DIR, "feature_columns.json")) as f:
        feat_cols = json.load(f)

    print(f"[2/5] Build features cho active employees tại {today} ...")
    df = build_features(today, for_training=False)
    print(f"      {len(df)} active employees")

    X = align_features(df, feat_cols)

    print("[3/5] Predict risk ...")
    proba = model.predict_proba(X)[:, 1]
    df_out = pd.DataFrame({"employee_id": df["employee_id"].values, "risk_score": proba})
    df_out["risk_band"] = df_out["risk_score"].apply(_risk_band)

    print("[4/5] SHAP top-3 drivers ...")
    drivers = _shap_drivers(model, X, feat_cols)
    df_out = pd.concat([df_out.reset_index(drop=True), drivers.reset_index(drop=True)], axis=1)

    print("[5/5] Write attrition_scores ...")
    conn = _conn()
    try:
        cur = conn.cursor()
        _ensure_table(cur)
        cur.execute("DELETE FROM attrition_scores WHERE scored_at = %s", (today,))
        rows = [
            (
                r.employee_id, today, float(round(r.risk_score, 4)), r.risk_band,
                r.driver_1, _f(r.driver_1_impact),
                r.driver_2, _f(r.driver_2_impact),
                r.driver_3, _f(r.driver_3_impact),
            )
            for r in df_out.itertuples(index=False)
        ]
        cur.executemany(
            """
            INSERT INTO attrition_scores
              (employee_id, scored_at, risk_score, risk_band,
               driver_1, driver_1_impact, driver_2, driver_2_impact,
               driver_3, driver_3_impact)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            rows,
        )
        conn.commit()
    finally:
        conn.close()

    band_counts = df_out["risk_band"].value_counts().to_dict()
    print(f"\nScored {len(df_out)} employees @ {today}")
    print(f"  Risk bands: {band_counts}")
    print("  Top 5 highest risk:")
    top5 = df_out.nlargest(5, "risk_score")[["employee_id", "risk_score", "risk_band", "driver_1"]]
    print(top5.to_string(index=False))


def _shap_drivers(model, X: pd.DataFrame, feat_cols: list) -> pd.DataFrame:
    """Trả về DataFrame driver_1..3 + impact (SHAP value đẩy risk LÊN cao nhất)."""
    import shap

    explainer = shap.TreeExplainer(model)
    sv = explainer.shap_values(X)
    sv = np.asarray(sv)

    recs = []
    for i in range(sv.shape[0]):
        row = sv[i]
        # chỉ lấy driver làm TĂNG risk (shap > 0), sort giảm dần
        order = np.argsort(row)[::-1]
        top = [(feat_cols[j], float(row[j])) for j in order[:3] if row[j] > 0]
        while len(top) < 3:
            top.append((None, None))
        recs.append({
            "driver_1": top[0][0], "driver_1_impact": top[0][1],
            "driver_2": top[1][0], "driver_2_impact": top[1][1],
            "driver_3": top[2][0], "driver_3_impact": top[2][1],
        })
    return pd.DataFrame(recs)


def _f(v):
    return None if v is None or pd.isna(v) else float(round(v, 4))


if __name__ == "__main__":
    main()
