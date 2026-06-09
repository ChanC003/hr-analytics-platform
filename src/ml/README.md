# src/ml — Attrition Prediction (Phase 4)

> **Trạng thái:** ✅ DONE — AUC-ROC 0.71 (đã validate out-of-time + CV + baseline), đã score 4,519 active employees.

## Kết quả & độ tin cậy

| Bằng chứng | Value | Ý nghĩa |
|---|---|---|
| AUC-ROC (holdout 20%) | **0.714** | điểm chính |
| AUC-PR | 0.30 | với base-rate 16.8% (imbalanced) |
| **5-fold CV** | **0.718 ± 0.007** | std nhỏ → con số **ổn định**, không phải may rủi split |
| **Out-of-time** (train 2024-12 → test 2025-06) | **0.695** | chỉ kém CV 0.023 → **generalize qua thời gian** |
| Baseline LogReg | 0.733 | ⚠️ **cao hơn XGBoost** → tín hiệu phần lớn tuyến tính |
| Single-feature `last_score` | 0.687 | gần như cả model nằm ở 1 feature |
| Brier score | 0.16 | risk_score **chưa calibrated** (bị `scale_pos_weight` đẩy lên ~2×) |

**Score hôm nay:** 484 high-risk / 1,314 medium / 2,721 low (trên 4,519 active).
**Top drivers:** last_score, last_4q_avg, days_since_last_raise, dept_attrition_rate, last_salary_delta_pct.

> **Đọc risk_score đúng cách:** đây là **điểm XẾP HẠNG ưu tiên**, KHÔNG phải xác suất nghỉ tuyệt đối.
> Reliability curve: bucket dự đoán ~0.68 thực tế chỉ ~0.34 nghỉ → dùng để *sắp thứ tự ai cần can thiệp trước*,
> không phải "người này 68% sẽ nghỉ". Chi tiết: `models/eval_report.json`.

> **Lưu ý về data:** dataset synthetic, generator có **tín hiệu nhân quả** (low performer / lương đóng băng /
> lương lâu không tăng / tenure ngắn → nghỉ nhiều) — không random. AUC 0.71 realistic, không phải con số ảo.

## Files

| File | Vai trò |
|---|---|
| `requirements.txt` | xgboost, scikit-learn, shap, pandas, mysql-connector, **SQLAlchemy**, joblib |
| `build_features.py` | Point-in-time feature builder (tránh leakage), label `left_180d` |
| `train_attrition.py` | XGBoost — train tại cutoff 2025-06-30, eval AUC/PR/Brier + threshold sweep, save `.pkl` |
| `evaluate_attrition.py` | **Đánh giá độ tin cậy**: out-of-time + K-fold CV + baselines + calibration → `eval_report.json` |
| `score_attrition.py` | Score active employee hôm nay + SHAP top-3 driver → ghi `attrition_scores` vào MySQL |

## Chạy đánh giá độ tin cậy

```bash
cd src/ml
python evaluate_attrition.py     # OOT + CV + baseline + calibration → models/eval_report.json
```

## Thiết kế target (tránh data leakage)

- **Snapshot point-in-time**: chọn `CUTOFF_DATE`. Population = nhân viên active TẠI cutoff.
- **Label** `left_180d` = 1 nếu nghỉ trong `(cutoff, cutoff + 180 ngày]`.
- **Feature chỉ tính từ data `<= cutoff`** (review_date, effective_date) — không nhìn tương lai.
- Train: cutoff quá khứ (2025-06-30, đủ horizon biết nhãn). Score: cutoff = hôm nay (nhãn chưa biết).

## Output: bảng `attrition_scores` (MySQL)

| Cột | Mô tả |
|---|---|
| employee_id, scored_at | PK |
| risk_score | xác suất nghỉ 180 ngày (0–1) |
| risk_band | high (≥0.6) / medium (≥0.3) / low |
| driver_1..3 + impact | SHAP top-3 feature đẩy risk lên cao nhất |

## Chạy

```bash
pip install -r src/ml/requirements.txt
cd src/ml
python build_features.py --cutoff 2025-06-30   # kiểm tra feature
python train_attrition.py                       # train + save model
python score_attrition.py                       # score hôm nay → MySQL
```

## Nguồn feature (đã có sẵn từ Phase 3)

- `dim_employee` (SCD2) — tenure, department, level, manager
- `fct_performance` — perf trend (slope 4 quý gần nhất)
- `fct_salary` — salary delta vs band
- `mart_attrition` — dept attrition rate (denominator)

## Quyết định
- XGBoost + SHAP: interpretable, phù hợp HR cần giải thích "vì sao".
- Đọc trực tiếp từ MySQL bằng `mysql-connector-python` (đã có trong `src/ingest/requirements.txt`).
