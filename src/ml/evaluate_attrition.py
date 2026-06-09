"""
evaluate_attrition.py — Đánh giá ĐỘ TIN CẬY của model attrition (không chỉ 1 con số AUC).

Trả lời câu hỏi: "AUC 0.71 có đáng tin không?" bằng 4 bằng chứng:

  1. Out-of-time (OOT) validation  — train ở cutoff QUÁ KHỨ, test ở cutoff TƯƠNG LAI.
     Đây là bài test thật nhất: model có generalize qua thời gian không, hay chỉ overfit 1 lát cắt.
  2. Stratified K-fold CV           — AUC mean ± std. std nhỏ = con số ổn định, không phải may rủi split.
  3. Baselines                      — so với LogisticRegression, single-feature, majority.
     Nếu model phức tạp KHÔNG hơn baseline đơn giản => không đáng dùng model phức tạp.
  4. Calibration + threshold sweep  — risk_score có phản ánh đúng xác suất thật không;
     ngưỡng band (0.3/0.6) hợp lý tới đâu; precision/recall tại từng ngưỡng.

Output: in ra console + ghi models/eval_report.json (nguồn số cho build-journey.md / README).

Chạy:
    cd src/ml
    python evaluate_attrition.py
    python evaluate_attrition.py --train-cutoff 2024-12-31 --test-cutoff 2025-06-30
"""

import os
import sys
import json
import argparse
import warnings


sys.stdout.reconfigure(encoding="utf-8")
warnings.filterwarnings("ignore")  # ẩn convergence/UserWarning, kết quả không đổi

from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import (
    roc_auc_score, average_precision_score, brier_score_loss,
    precision_recall_fscore_support,
)
from sklearn.calibration import calibration_curve
from xgboost import XGBClassifier

from build_features import build_features
from train_attrition import prepare_xy

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
RANDOM_STATE = 42


def _xgb(spw):
    return XGBClassifier(
        n_estimators=300, max_depth=5, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8, scale_pos_weight=spw,
        eval_metric="aucpr", random_state=RANDOM_STATE, n_jobs=-1,
    )


def _features(cutoff):
    """build_features -> X (đã one-hot), y."""
    return prepare_xy(build_features(cutoff, for_training=True))


def out_of_time(train_cutoff, test_cutoff):
    """Train ở quá khứ, test ở tương lai — bài test generalize theo thời gian."""
    Xtr, ytr = _features(train_cutoff)
    Xte, yte = _features(test_cutoff)
    # align cột (population/quý khác nhau có thể thiếu/ thừa cột one-hot)
    Xte = Xte.reindex(columns=Xtr.columns, fill_value=0)
    spw = (ytr == 0).sum() / max((ytr == 1).sum(), 1)
    model = _xgb(spw).fit(Xtr, ytr)
    proba = model.predict_proba(Xte)[:, 1]
    return {
        "train_cutoff": train_cutoff, "test_cutoff": test_cutoff,
        "n_train": int(len(ytr)), "n_test": int(len(yte)),
        "base_rate_train": round(float(ytr.mean()), 4),
        "base_rate_test": round(float(yte.mean()), 4),
        "auc_roc": round(float(roc_auc_score(yte, proba)), 4),
        "auc_pr": round(float(average_precision_score(yte, proba)), 4),
    }, yte.values, proba


def kfold_cv(X, y, k=5):
    """AUC mean ± std qua K fold (stratify giữ tỷ lệ positive)."""
    spw = (y == 0).sum() / max((y == 1).sum(), 1)
    model = _xgb(spw)
    cv = StratifiedKFold(k, shuffle=True, random_state=RANDOM_STATE)
    auc = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")
    ap = cross_val_score(model, X, y, cv=cv, scoring="average_precision")
    return {
        "k": k,
        "auc_roc_mean": round(float(auc.mean()), 4), "auc_roc_std": round(float(auc.std()), 4),
        "auc_pr_mean": round(float(ap.mean()), 4),  "auc_pr_std": round(float(ap.std()), 4),
    }


def baselines(X, y, k=5):
    """So model với baseline đơn giản — nếu không hơn baseline thì model thừa."""
    cv = StratifiedKFold(k, shuffle=True, random_state=RANDOM_STATE)
    out = {}
    # LogisticRegression (linear, class_weight balanced)
    lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced"))
    lr_auc = cross_val_score(lr, X, y, cv=cv, scoring="roc_auc")
    out["logreg"] = {"auc_roc_mean": round(float(lr_auc.mean()), 4), "auc_roc_std": round(float(lr_auc.std()), 4)}
    # Single-feature AUC (đo từng feature 1 mình giải thích được bao nhiêu)
    singles = {}
    for feat, sign in [("last_score", -1), ("days_since_last_raise", 1),
                       ("dept_attrition_rate", 1), ("last_4q_avg", -1), ("tenure_days_at_cutoff", -1)]:
        if feat in X.columns:
            singles[feat] = round(float(roc_auc_score(y, sign * X[feat])), 4)
    out["single_feature_auc"] = singles
    # Majority baseline = base rate (AUC 0.5 theo định nghĩa, ghi rõ để đối chiếu)
    out["majority"] = {"auc_roc": 0.5, "note": "đoán 'không nghỉ' cho mọi người"}
    return out


def calibration_and_threshold(y, proba):
    """Calibration (risk_score có ~ xác suất thật không) + precision/recall tại các ngưỡng band."""
    brier = float(brier_score_loss(y, proba))
    frac_pos, mean_pred = calibration_curve(y, proba, n_bins=10, strategy="quantile")
    reliability = [{"mean_pred": round(float(mp), 4), "frac_pos": round(float(fp), 4)}
                   for mp, fp in zip(mean_pred, frac_pos)]
    # precision/recall tại ngưỡng band hiện dùng + vài mốc
    sweep = []
    for thr in [0.3, 0.4, 0.5, 0.6, 0.7]:
        pred = (proba >= thr).astype(int)
        p, r, f, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
        sweep.append({"threshold": thr, "precision": round(float(p), 3),
                      "recall": round(float(r), 3), "f1": round(float(f), 3),
                      "n_flagged": int(pred.sum())})
    best = max(sweep, key=lambda s: s["f1"])
    return {"brier_score": round(brier, 4), "reliability_curve": reliability,
            "threshold_sweep": sweep, "best_f1_threshold": best}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-cutoff", default="2024-12-31")
    ap.add_argument("--test-cutoff", default="2025-06-30")
    ap.add_argument("--cv-cutoff", default="2025-06-30", help="cutoff để chạy K-fold + baseline")
    ap.add_argument("--folds", type=int, default=5)
    args = ap.parse_args()

    print("=" * 64)
    print("ĐÁNH GIÁ ĐỘ TIN CẬY MODEL ATTRITION")
    print("=" * 64)

    print(f"\n[1/4] Out-of-time: train {args.train_cutoff} -> test {args.test_cutoff} ...")
    oot, y_oot, p_oot = out_of_time(args.train_cutoff, args.test_cutoff)
    print(f"      AUC-ROC {oot['auc_roc']} | AUC-PR {oot['auc_pr']} "
          f"| base_test {oot['base_rate_test']} (n_test={oot['n_test']})")

    print(f"\n[2/4] {args.folds}-fold CV @ {args.cv_cutoff} ...")
    X, y = _features(args.cv_cutoff)
    cv = kfold_cv(X, y, args.folds)
    print(f"      AUC-ROC {cv['auc_roc_mean']} +/- {cv['auc_roc_std']} "
          f"| AUC-PR {cv['auc_pr_mean']} +/- {cv['auc_pr_std']}")

    print(f"\n[3/4] Baselines @ {args.cv_cutoff} ...")
    bl = baselines(X, y, args.folds)
    print(f"      LogReg AUC {bl['logreg']['auc_roc_mean']} +/- {bl['logreg']['auc_roc_std']}")
    print(f"      single-feature AUC: {bl['single_feature_auc']}")

    print("\n[4/4] Calibration + threshold sweep (trên OOT test) ...")
    cal = calibration_and_threshold(y_oot, p_oot)
    print(f"      Brier {cal['brier_score']} (càng nhỏ càng calibrated)")
    print(f"      best-F1 threshold: {cal['best_f1_threshold']}")
    for s in cal["threshold_sweep"]:
        print(f"        thr {s['threshold']}: P={s['precision']} R={s['recall']} "
              f"F1={s['f1']} flagged={s['n_flagged']}")

    report = {
        "out_of_time": oot,
        "cross_validation": cv,
        "baselines": bl,
        "calibration": cal,
        "verdict": _verdict(oot, cv, bl),
    }
    out_path = os.path.join(MODEL_DIR, "eval_report.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\nĐã ghi {out_path}")
    print("\nKẾT LUẬN:", report["verdict"])


def _verdict(oot, cv, bl):
    """Tự tổng kết độ tin cậy thành 1 câu (cho doc)."""
    notes = []
    drop = cv["auc_roc_mean"] - oot["auc_roc"]
    if drop <= 0.04:
        notes.append(f"OOT AUC {oot['auc_roc']} chỉ kém CV {cv['auc_roc_mean']} {drop:.3f} -> generalize tốt qua thời gian")
    else:
        notes.append(f"OOT AUC {oot['auc_roc']} thấp hơn CV {cv['auc_roc_mean']} {drop:.3f} -> có dấu hiệu drift/overfit thời gian")
    if cv["auc_roc_std"] <= 0.02:
        notes.append(f"CV std {cv['auc_roc_std']} nhỏ -> con số ổn định")
    lr = bl["logreg"]["auc_roc_mean"]
    if lr >= cv["auc_roc_mean"]:
        notes.append(f"LogReg baseline ({lr}) >= XGBoost ({cv['auc_roc_mean']}) -> tín hiệu phần lớn tuyến tính; giữ XGBoost CHỦ YẾU vì SHAP, không vì AUC")
    else:
        notes.append(f"XGBoost ({cv['auc_roc_mean']}) > LogReg ({lr}) -> phi tuyến có giá trị")
    return " · ".join(notes)


if __name__ == "__main__":
    main()
