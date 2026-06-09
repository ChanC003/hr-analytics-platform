"""
train_attrition.py — Train XGBoost classifier dự đoán nghỉ việc trong 180 ngày.

Pipeline:
  1. build_features tại CUTOFF train (mặc định 2025-06-30) -> X, y
  2. One-hot encode categorical, split stratified 80/20
  3. Train XGBoost với scale_pos_weight (xử lý imbalance)
  4. Eval: AUC-ROC, AUC-PR, classification report, confusion matrix
  5. Save model + feature list + encoder columns vào src/ml/models/
"""

import os
import sys
import json
import joblib
import pandas as pd

# Windows cp1252 console -> ép UTF-8 cho output tiếng Việt
sys.stdout.reconfigure(encoding="utf-8")
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    roc_auc_score, average_precision_score,
    classification_report, confusion_matrix,
    brier_score_loss, precision_recall_fscore_support,
)
from xgboost import XGBClassifier

from build_features import build_features, feature_columns, CATEGORICAL, LABEL_COL

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODEL_DIR, exist_ok=True)

TRAIN_CUTOFF = os.getenv("ML_TRAIN_CUTOFF", "2025-06-30")
RANDOM_STATE = 42


def prepare_xy(df: pd.DataFrame):
    """One-hot encode categorical, trả về X (DataFrame), y (Series), danh sách cột."""
    feat_cols = feature_columns(df)
    X = df[feat_cols].copy()
    X = pd.get_dummies(X, columns=[c for c in CATEGORICAL if c in X.columns], dummy_na=False)
    # ép mọi cột về numeric (department_id/level_id là category-like nhưng giữ numeric ok cho tree)
    X = X.apply(pd.to_numeric, errors="coerce").fillna(0)
    y = df[LABEL_COL].astype(int)
    return X, y


def main():
    print(f"[1/5] Build features tại cutoff {TRAIN_CUTOFF} ...")
    df = build_features(TRAIN_CUTOFF, for_training=True)
    pos = int(df[LABEL_COL].sum())
    print(f"      {len(df)} rows | {pos} positive ({pos/len(df)*100:.1f}%)")

    print("[2/5] Encode + split ...")
    X, y = prepare_xy(df)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=RANDOM_STATE
    )

    # scale_pos_weight = n_neg / n_pos để cân bằng
    neg, pos_n = int((y_train == 0).sum()), int((y_train == 1).sum())
    spw = neg / max(pos_n, 1)

    print(f"[3/5] Train XGBoost (scale_pos_weight={spw:.2f}) ...")
    model = XGBClassifier(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=spw,
        eval_metric="aucpr",
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    print("[4/5] Evaluate ...")
    proba = model.predict_proba(X_test)[:, 1]
    pred = (proba >= 0.5).astype(int)

    auc = roc_auc_score(y_test, proba)
    ap = average_precision_score(y_test, proba)
    cm = confusion_matrix(y_test, pred)
    brier = brier_score_loss(y_test, proba)  # calibration: 0 = hoàn hảo

    print(f"\n  AUC-ROC : {auc:.4f}")
    print(f"  AUC-PR  : {ap:.4f}")
    print(f"  Brier   : {brier:.4f}  (calibration — càng nhỏ risk_score càng sát xác suất thật)")
    print(f"  Confusion matrix [tn fp / fn tp]:\n{cm}")
    print("\n" + classification_report(y_test, pred, digits=3))

    # Precision/Recall tại các ngưỡng band — chọn ngưỡng phù hợp mục tiêu nghiệp vụ
    sweep = []
    for thr in (0.3, 0.4, 0.5, 0.6, 0.7):
        pr = (proba >= thr).astype(int)
        p, r, f, _ = precision_recall_fscore_support(y_test, pr, average="binary", zero_division=0)
        sweep.append({"threshold": thr, "precision": round(float(p), 3),
                      "recall": round(float(r), 3), "f1": round(float(f), 3),
                      "n_flagged": int(pr.sum())})
    best = max(sweep, key=lambda s: s["f1"])
    print("  Threshold sweep (precision/recall theo ngưỡng risk_score):")
    for s in sweep:
        mark = " <- best F1" if s is best else ""
        print(f"    thr {s['threshold']}: P={s['precision']} R={s['recall']} F1={s['f1']} flagged={s['n_flagged']}{mark}")

    # Top feature importance
    imp = pd.Series(model.feature_importances_, index=X.columns).sort_values(ascending=False)
    print("  Top 10 feature importance:")
    for name, val in imp.head(10).items():
        print(f"    {name:30s} {val:.4f}")

    print("[5/5] Save model ...")
    joblib.dump(model, os.path.join(MODEL_DIR, "attrition_xgb.pkl"))
    with open(os.path.join(MODEL_DIR, "feature_columns.json"), "w") as f:
        json.dump(list(X.columns), f, indent=2)
    metrics = {
        "train_cutoff": TRAIN_CUTOFF,
        "n_train": len(X_train),
        "n_test": len(X_test),
        "auc_roc": round(auc, 4),
        "auc_pr": round(ap, 4),
        "brier_score": round(float(brier), 4),
        "scale_pos_weight": round(spw, 2),
        "threshold_sweep": sweep,
        "best_f1_threshold": best,
        "band_thresholds": {"high": 0.6, "medium": 0.3,
                            "note": "risk_score bị scale_pos_weight đẩy lên (không phải xác suất calibrated); "
                                    "dùng để XẾP HẠNG ưu tiên, không đọc như P(nghỉ) tuyệt đối. "
                                    "Xem eval_report.json (evaluate_attrition.py) để biết OOT/CV/baseline."},
        "top_features": imp.head(10).round(4).to_dict(),
    }
    with open(os.path.join(MODEL_DIR, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"\nSaved -> {MODEL_DIR}")
    print("  attrition_xgb.pkl | feature_columns.json | metrics.json")


if __name__ == "__main__":
    main()
