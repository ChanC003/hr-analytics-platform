# Processing — HR Analytics Platform

**Cập nhật:** 2026-06-09
**Phase hiện tại:** 7/7 phase ✅ DONE · đã chuẩn bị deploy (GitHub + Pages)

## Deploy setup (2026-06-09)
- [x] **`DEPLOY.md`** — hướng dẫn push repo RIÊNG cho project 05 (tránh kéo 2.6GB data project 02) + public
  dashboard qua GitHub Pages. Có check an toàn (.env/.venv/.pkl ignored), gh CLI + cách thủ công.
- [x] **`.github/workflows/ci.yml`** — CI cho repo-riêng (bỏ prefix monorepo `05-...`, branch main).
- [x] **`.github/workflows/deploy-pages.yml`** — deploy `src/dashboard/` lên GitHub Pages (Source = GitHub Actions),
  dashboard tĩnh đọc data.js sẵn → không cần DB.
- [x] README: thêm link demo Pages + badge CI (placeholder `<USERNAME>`) + pointer DEPLOY.md.
- [x] Verify: project 05 ~9MB (không .venv/.git), `.env`/`.pkl` ignored, data.js (2.6MB) GIỮ để dashboard chạy.
  2 workflow YAML valid. Chưa có `.git` riêng → sẵn sàng `git init`.

> **Việc CÒN LẠI (user tự làm — cần GitHub account):** `git init` trong 05 → push → bật Pages. Xem DEPLOY.md.

---

## ✅ RE-TEST TOÀN BỘ 7 PHASE (2026-06-09, lần 2)

Test lại tuần tự từng layer sau khi hoàn thành Phase 6+7. **Tất cả PASS.**

| Layer | Kiểm tra | Kết quả |
|---|---|---|
| Hạ tầng | `docker ps` | postgres·mysql·airflow_db **healthy** · airflow·adminer up |
| **1+2 Ingest** | OLTP(PG) vs MySQL raw row count | **khớp 100%** (emp 10k·salary 30,426·perf 75,708·jc 6,465·recruit 110,155) |
| **3 dbt** | `dbt run` / `dbt test` | **18/18** · **53/53** PASS |
| 3 integrity | invariants | valid_to<from=0 · reviews/salary after-exit=0 · dim_emp 10,930/10k current |
| **4 ML** | train·eval·score | AUC **0.7136** · OOT 0.695 · CV 0.718±0.007 · LogReg 0.733 · score 486/1309/2723 |
| **5 Dashboard** | export + render matrix | **204 combo × 0 fail** · regression: donut-level(36/84/171)·table=KPI(486)·attrition 12.5%(≠0)·perf-quý(75708→9333)·trend-strip·Δ cùng kỳ |
| 5 Dashboard | hover + CSV | hover canvas.width set thêm **0** (không nhảy) · **5/5** CSV export OK |
| **6 Airflow** | DAG run | **6/6 task SUCCESS** (1m17s) · alert "🔴 ATTRITION SPIKE 2026-Q2 12.5%" |
| **7 CI suite** | ruff·pytest·JS | ruff **clean** · pytest **25 passed+1 skip** · JS **7 passed** |

**Kết luận:** pipeline thông suốt OLTP→MySQL→dbt(18/53)→ML(0.71 validated)→dashboard(filter ăn khớp)→
Airflow(6/6)→CI(test pass). Mọi số reproduce với seed cố định. Project HOÀN CHỈNH 7/7 phase, sẵn sàng portfolio.

> Lưu ý: score band đổi nhẹ (484→486) vì score theo `cutoff=hôm nay` (2026-06-09 ≠ ngày trước) — đúng thiết kế.

---

## Phase 7 — CI/CD + Test automation (2026-06-09)
- [x] **pytest scaffolding**: `requirements-dev.txt`, `pytest.ini` (marker `db`), `tests/conftest.py` (path src/*).
- [x] **`tests/test_generator.py`** (10 test): salary_for, next_level, quarters_between + **clamp_events_to_exit
  regression** (bug "event sau exit" Phase 4c) — drop sau exit / giữ termination / noop khi không nghỉ.
- [x] **`tests/test_ml.py`** (10 test): feature_columns (loại id/label), _years_between, _risk_band (ngưỡng
  band khớp dashboard), prepare_xy (one-hot, không còn object col, y int).
- [x] **`tests/test_dag.py`** (4 test): DAG parse AST + đủ 6 task + thứ tự quality gate (dbt_test>>ml_score);
  load thật nếu môi trường có Airflow (skip ở host).
- [x] **`tests/test_integration_db.py`** (2 test, `@pytest.mark.db`): build_features shape/label nhị phân/
  không leak date col; dept_attrition_rate ∈ [0,1]. Auto-skip nếu không có MySQL.
- [x] **`tests/js/test_helpers.mjs`** (7 test, Node thuần): statusOf, fmtPct/Int/Score, deltaCell (up/down/
  invertGood), tenureGroupLabel, monthToQuarter. Load global-scope JS qua vm.
- [x] **`.github/workflows/hr-analytics-ci.yml`** — 2 job:
  - `unit`: ruff + pytest(not db) + coverage + JS test.
  - `integration`: MySQL+Postgres service → seed schema → generate(1500) → ingest → dbt run →
    **dbt test (quality gate)** → ML train+score → export → pytest(db). Re-run TOÀN BỘ pipeline mỗi push.
- [x] **`ruff.toml`** — config lint (ignore E402: sys.stdout.reconfigure phải chạy trước import trên Windows).
  Auto-fix 9 lỗi F541/F401 trong src. `ruff check` PASS.
- [x] **Verify local:** pytest **25 passed + 1 skipped** (airflow-not-installed) · JS **7 passed** · ruff clean ·
  ML modules vẫn import OK sau auto-fix.

### Quyết định Phase 7
- Test theo tầng pure-logic (không DB, nhanh) vs integration (DB, chạy pipeline thật) — chia 2 CI job tương ứng.
- Generate nhỏ (1500 NV) trong CI để nhanh, vẫn đủ tín hiệu cho dbt/ML chạy.
- Giữ E402 (import sau reconfigure) — không sửa code đang chạy chỉ để chiều linter; ignore qua config.

---

## Phase 6 — Airflow orchestration (2026-06-08)
- [x] **`docker/Dockerfile.airflow`** — base `apache/airflow:2.9.3-python3.11` + deps các script phase 2-5
  (psycopg2, mysql-connector, pandas, sklearn, xgboost, shap) + `dbt-core 1.7.19` + `dbt-mysql 1.7.0`.
  SQLAlchemy pin 1.4.52 (Airflow 2.9 yêu cầu <2.0; script chỉ dùng create_engine/read_sql nên OK).
- [x] **`docker-compose.yml`** — thêm profile `airflow`: service `airflow_postgres` (metadata DB riêng) +
  `airflow` (LocalExecutor, `airflow standalone`). Mount `dags/ src/ hr_analytics/ dbt_profile/`.
  Override host DB qua env (`MYSQL_HOST=mysql`, `POSTGRES_HOST=postgres`, port nội bộ 5432) → script nối
  DB container qua service name, KHÔNG sửa code. UI port 8080.
- [x] **`docker/dbt_profile/profiles.yml`** — profile container dùng env_var (server=mysql) thay vì 127.0.0.1.
- [x] **`dags/hr_daily_pipeline.py`** — DAG schedule `0 6 * * *`, `catchup=False`, `max_active_runs=1`:
  `ingest → dbt_run → dbt_test (QUALITY GATE) → ml_score → export_dashboard → attrition_alert`.
  - 5 BashOperator gọi script đã có + 1 PythonOperator alert (đọc mart_attrition, Slack nếu rate>ngưỡng).
  - dbt_test fail → task sau SKIP (dashboard không publish data lỗi). Validated qua AST.
- [x] Docs: `.env.example` (admin/slack/threshold), `README`, `docs/architecture`, `dags/README` (DONE),
  `.gitignore` (airflow.cfg/db/standalone_password...).
- [x] **🔴 Bug compat pandas/SQLAlchemy** (gặp khi chạy thật): container Airflow buộc SQLAlchemy <2.0,
  nhưng pandas 2.2 bỏ hỗ trợ SQLAlchemy 1.4 → `'Engine'/'Connection' object has no attribute 'cursor'`.
  Fix: (1) `build_features.py` dùng `with _engine().connect() as conn` (forward-compat 1.4 & 2.0);
  (2) Dockerfile pin **pandas 2.1.4** (chạy với SQLAlchemy 1.4). Host vẫn 2.2.2 OK.
- [x] **✅ Verify chạy THẬT:** build image → `docker compose --profile airflow up` → DAG parse OK, 0 import error
  → trigger run → **6/6 task SUCCESS** (ingest→dbt_run→dbt_test→ml_score→export→alert).
  Alert log đúng: "🔴 ATTRITION SPIKE — quý 2026-Q2: 12.5% (ngưỡng 10%)" (chỉ log vì webhook trống).

### Quyết định Phase 6
- Deploy Docker Compose (self-contained, đẹp portfolio) thay vì standalone host — `--profile airflow` để stack
  DB cũ vẫn chạy độc lập khi không cần Airflow.
- DAG bắt đầu từ ingest (KHÔNG generate mỗi ngày) — đúng ETL thật, giữ seed cố định, không phá watermark.
- Metadata DB Airflow tách riêng (`airflow_postgres`), không dùng chung OLTP postgres → sạch concern.
- Pin pandas 2.1.4 trong container (không 2.2): mâu thuẫn version Airflow(SQLAlchemy<2.0) × pandas2.2(cần SA2.0).

---

**Phase trước:** Phase 3+4+5 ✅ DONE — đã re-test end-to-end toàn bộ

## ✅ Re-test toàn bộ Phase 3/4/5 (2026-06-08)

Test lại tuần tự từng layer sau các đợt fix (event-sau-exit, ML review, dashboard filter). Tất cả PASS.

| Phase | Bước test | Kết quả |
|---|---|---|
| **Hạ tầng** | `docker ps` | hr_postgres · hr_mysql **healthy** |
| **3 — dbt** | `dbt debug` | All checks passed |
| | `dbt run` | **18/18 PASS** (dim_employee 10,930 · fct_performance 75,708 · fct_salary 30,426 · fct_attrition 5,535 · mart_headcount 1,260) |
| | `dbt test` | **53/53 PASS** (gồm `assert_dim_employee_valid_window`) |
| | integrity spot-check | valid_to<valid_from=0 · reviews-after-exit=0 · is_current=10,000 · raw=oltp ✓ |
| **4 — ML** | `build_features --cutoff 2025-06-30` | 5,770 rows · 16.8% positive ✓ |
| | `train_attrition` | **AUC-ROC 0.7136** · AUC-PR 0.3006 · Brier 0.1708 · best-F1 thr 0.5 |
| | `evaluate_attrition` | OOT **0.6946** · CV **0.7176±0.007** · LogReg 0.7326 · Brier 0.1603 |
| | `score_attrition` | 4,519 active → **484 high / 1,314 medium / 2,721 low** |
| **5 — Dashboard** | `export_marts` | data.js OK (headcount 1,260 · perf_dist 583 · perf_by_dept 65 · risk.top 4,519) |
| | `node --check` ×5 | constants/state/charts/render/init **OK** |
| | headless render matrix | **171 tổ hợp filter × 0 fail** (Status: dept×level×gran + gender×range · ML: dept×level×band×tenure) — không NaN/undefined |
| | CSV exports | **5/5 OK** (headcount/attrition/comp/hiring/risk) |
| | regression bug đã fix | donut ăn Level (Eng+Mid 36/84/171) · table=KPI (all+Cao 484) · medium/low>0 · Attrition 12.5% Q2 Off-track (hết 0% Q3) · perf lọc quý (75,708→9,333) |
| | cleanup | xóa dead code `shortMonth` + `deptTrendSeries` (không dùng) |

**Kết luận:** pipeline thông suốt OLTP → MySQL → dbt(18 model/53 test) → ML(0.71 validated) → dashboard(filter ăn khớp).
Mọi số reproduce đúng với seed cố định. Sẵn sàng demo / build Phase 6 (Airflow).

---

## Phase 5g — Fix hover line chart "chạy đi" + cột Δ cùng kỳ (2026-06-08)
- [x] **🔴 Di chuột vào line chart bị "chạy đi mất"** (user phát hiện): `onmousemove` gọi lại `_setupCanvas()`
  → set `canvas.width` → đọc lại `parent.getBoundingClientRect().width` mỗi lần → layout đổi 1px (scrollbar) →
  canvas resize → chart nhảy. Thêm cờ `_lineWired` + `onmouseleave` gọi `drawLine()` đệ quy càng tệ.
  Sửa `charts.js`: **cache W/H/dpr** sau lần vẽ đầu; `_redrawCached()` chỉ `clearRect`+redraw ở kích thước cache,
  KHÔNG đụng `canvas.width`. Verify: hover 10 lần + leave = **0 lần set canvas.width** (hết nhảy).
- [x] **Khôi phục area fill** (user thích look cũ): bỏ logic "chỉ fill 1 series"; multi-series fill rất nhạt (+'12').
- [x] **Thêm cột "Δ cùng kỳ"** (theo yêu cầu) vào 3 bảng có chiều thời gian:
  - HC table: Δ vs tháng −12 (năm trước) · Attrition: Δ exits vs quý năm trước (tăng=xấu/đỏ) · Hiring: Δ Hired vs quý năm trước.
  - Helper `deltaCell(cur, prev, invertGood)` (constants.js) → `▲/▼ ±n (±%)` màu theo ý nghĩa, title=giá trị cùng kỳ.
- [x] Update rule global: bug hover-cache, cột Δ cùng kỳ pattern. Regression 42 combos × 0 fail.

## Phase 5f — Fix chart line chồng đè + thêm trend-strip tăng/giảm (2026-06-08)
- [x] **🔴 Chart "Xu hướng Headcount" mảng xám rối** (user phát hiện): `drawLine` multi-series mà MỖI đường
  tô area xuống đáy → 5 area translucent đè nhau thành mảng xám tím, không đọc được phòng nào.
  Sửa `charts.js`: `fillArea = series.length === 1` — chỉ tô area khi 1 series; ≥2 series chỉ vẽ line + chấm
  điểm cuối mỗi đường. (Đường HC dốc xuống -30.5% là DATA THẬT: exits > hires, không phải bug chart.)
- [x] **Thêm trend-strip đánh giá tăng/giảm** (theo yêu cầu): strip dưới chart xu hướng hiện
  `kỳ_đầu X → kỳ_cuối Y · ▲/▼ ±delta (±%) · TB ±n/kỳ`. Áp cho HC (theo tháng/quý) + Attrition rate.
  Màu theo Ý NGHĨA: HC tăng=xanh; **attrition tăng=đỏ "(xấu đi)"**. Tốc độ TB đổi theo gran. `style.css`: `.trend-strip`.
- [x] Cập nhật rule global `analytics-dashboard.md`: multi-series fill, trend-strip pattern, quý-đang-chạy
  (loại khỏi KPI gần nhất), KPI=bảng phải khớp, + 6 anti-pattern mới.
- [x] Regression: 31 tổ hợp filter × 0 fail · HC delta -1,974 (-30.5%) · Attrition +9.5% (xấu đi) hiển thị đúng.

## Phase 5e — Fix KPI "Attrition thực tế 0.0% On-track" giả (2026-06-08)
- [x] **🔴 KPI Attrition lấy quý ĐANG CHẠY** (user phát hiện): quý hiện tại 2026-Q3 mới có 28 exits,
  `attrition_rate_pct = null` trong mart → KPI hiện **0.0% · On-track** (sai: NaN→0→ok). Đúng phải là
  quý hoàn chỉnh gần nhất **2026-Q2 = 12.5% · Off-track**.
- [x] Thêm helper dùng chung: `completedQuarters(atRows)` (loại quý rate=null) + `latestCompletedRate()`.
  Áp cho cả tab Status (KPI "Rate quý gần nhất" + "Attrition rate TB") và tab ML (RealtimeStrip "Attrition thực tế").
- [x] Bảng Attrition: quý đang chạy hiện chip **"đang chạy"** (thay vì "–" nền xanh giả on-track).
- [x] Mọi aggregation rate (insight top-dept, rank-table) lọc bỏ null → hết NaN. Verify: Status/ML không NaN,
  rate TB 7.4% (không bị Q3=0 kéo xuống), KPI hiện 2026-Q2 12.5% Off-track.

## Phase 5d — Filter ăn khớp toàn bộ chart/table + insight động (2026-06-08)
- [x] **🔴 Filter tháng/quý chưa áp vào Performance**: `perf_dist`/`perf_by_dept` export đã collapse mất time dim.
  - `export_marts.py`: thêm `year_quarter` vào 2 query perf + đổi `perf_by_dept` trả `sum_score`+`n_reviews`
    (để dashboard re-aggregate avg weighted theo range quý). perf_dist 45→583 rows, perf_by_dept 5→65.
  - `state.js`: thêm `filterPerfDist()` / `filterPerfByDept()` (lọc dept + range quý).
  - `render.js`: Performance giờ **lọc thật theo range quý** — verify: full 75,708 review → 4 tháng cuối 9,333.
  - **Fix bug cũ**: bảng Performance trước hiện `Số review = 0` (cột `review_count` không tồn tại trong data) →
    nay tính `n_reviews`/`cnt_low`/`cnt_high` thật từ dist theo phòng.
- [x] **Compensation = snapshot**: data không có time → thêm banner "📸 snapshot · filter tháng/quý không áp"
  (Phòng & Cấp vẫn áp). User không tưởng filter lỗi.
- [x] **Sửa nhãn gây hiểu nhầm**: "Kỳ mới nhất" → "Snapshot cuối kỳ lọc"; Performance KPI/chart ghi rõ range quý.
- [x] **Thêm 2 section bắt buộc (html-build.md)** cho cả 2 tab:
  - **Phân tích** — insight cards (alert/warn/good/info) sinh động theo dept + kỳ (attrition/perf/spread/hiring; ML: quy mô high-risk, điểm nóng phòng×cấp, SHAP driver, cách đọc score).
  - **Khuyến nghị vận hành** — action cards + badge ưu tiên (Cao/Trung bình/Thử nghiệm), nội dung đổi theo filter.
  - `style.css`: `.insight-grid/.insight-card` + `.rec-grid/.rec-card` + badge ưu tiên.
- [x] **🔴 Donut "Phân bố rủi ro" không ăn filter Cấp**: `bandCnt()` chỉ xét all/dept, bỏ qua `STATE.level`.
  Sửa: 4 nhánh theo tổ hợp (all→`bands`, dept→`bands_by_dept`, level→`bands_by_level`, dept+level→`bands_by_dept_level`).
  Verify khớp DB: Eng+Mid = 36/84/171 · all+Mid = 161/388/810 · Product+Lead = 17/35/78. Thêm `levelNameRaw()`.
- [x] **🔴 Bảng "Top NV rủi ro" hiện 0 NV khi lọc Mức rủi ro = TB/Thấp**: `risk.top` cũ = 100 NV TOÀN `high`
  → filter band TB/Thấp ra rỗng; filter thâm niên cũng hạn chế.
  - `export_marts.py`: đổi query `top` sang **lấy mẫu theo cả 3 band** (ROW_NUMBER per band: 200 high + 120 medium
    + 80 low = 400 NV). Thêm cột **time**: `scored_at` (ngày chấm) + `last_review_quarter` (quý review gần nhất).
  - `riskTable()`: thêm cột **Thâm niên** (X.Y năm + heatmap <2y=đỏ) + **Review gần nhất (quý)**; show 120 dòng đầu.
  - `constants.js`: `fmtTenure()` + `tenureGroupLabel()`. exportRisk thêm tenure_years/last_review_quarter/scored_at.
  - Verify: riskBand all/high/medium/low = 120/120/120/80 (hết 0) · tenure gt5 = 48 · medium+lt2 = 68 (khớp DB).
- [x] **🔴 KPI 484 nhưng bảng chỉ 200** (user phát hiện không nhất quán): mẫu cũ < tổng band.
  Sửa export: **`risk.top` xuất TOÀN BỘ 4,519 NV được chấm điểm** (484 high + 1,314 medium + 2,721 low) →
  bảng khớp KPI/donut/heatmap ở MỌI tổ hợp filter (band/dept/level/tenure), hết lệch số.
  - Tinh gọn data: bỏ `full_name`, bỏ per-row `scored_at` (đã có ở `risk.scored_at`), CAST id/tenure → INT.
  - Sửa `_norm()`: giữ int (bỏ `.0`), float nguyên → int, chỉ giữ thập phân thực (risk_score/pct) → JSON gọn.
  - `riskTable()` render cap 500 dòng đầu (mượt DOM) + note "hiển thị X/Y · Xuất CSV xem đủ"; CSV xuất đủ.
  - Verify khớp KPI mọi band: all high=484 · Eng high=77 · Eng medium=261. data.js 1021→2631 KB.
- [x] Audit filter coverage toàn bộ: Headcount(dept/level/range tháng/gran/gender) · Attrition(dept/range quý) ·
  Performance(dept/range quý) · Compensation(dept/level, snapshot) · Hiring(dept/range quý) ·
  ML(dept/level/riskBand/tenure + donut/heatmap/table) — **tất cả ăn khớp**.
- [x] Test headless: mọi tổ hợp filter render OK, không NaN/undefined, perf table có số review > 0.

### Quyết định Phase 5d
- Perf lọc theo quý (data cho phép); Comp giữ snapshot + ghi rõ (lương ít đổi theo tháng, build per-period tốn kém ít giá trị).
- Insight/Khuyến nghị sinh từ chính metric đã tính trong render — không hardcode, đổi theo filter.

## Phase 4c — Fix bug "event sau ngày nghỉ" (2026-06-08)
- [x] **🔴 Bug data integrity** (phát hiện khi điều tra valid_to): generator sinh review/lương/thăng chức
  độc lập exit_date → **30,214 review + 5,894 salary + 394 promotion dated SAU khi nhân viên đã nghỉ**.
  Triệu chứng nổi: 394 bản `dim_employee` có `valid_to < valid_from`.
- [x] **Fix generator** `clamp_events_to_exit()`: sau khi có exit_date, loại mọi event > exit_date
  (giữ thứ tự sinh để không phá RNG seed tín hiệu nhân quả). Wire vào `main()` trước insert.
- [x] **Phòng thủ dbt** `dim_employee.sql`: `valid_to = GREATEST(<...>, valid_from)` + singular test
  `tests/assert_dim_employee_valid_window.sql` (fail nếu valid_to < valid_from).
- [x] Regenerate OLTP → full-load MySQL (232,765 rows) → `dbt run` 18/18 → `dbt test` **53/53** (thêm 1 test).
- [x] Verify: valid_to<valid_from=0 · promotions/reviews/salary after exit = **0**. SCD2 dept/level vẫn 0 đổi.
- [x] Retrain (AUC **0.7136 y nguyên** vì build_features đã filter `<=cutoff`) + evaluate + rescore (484/1314/2721) + export data.js.
- [x] Cập nhật row counts: perf 105,922→75,708 · salary 36,320→30,426 · job_changes 6,859→6,465 · dim_employee 11,324→10,930.

### Quyết định Phase 4c
- Bug data *vô hại với model hiện tại* (đã filter ≤cutoff) nhưng *độc với SCD2 / point-in-time tương lai* → vẫn phải sửa tận gốc.
- Fix 2 lớp: generator (gốc) + dbt GREATEST (phòng thủ) + dbt test (gác cổng) — không tin 1 lớp.

## Phase 4b — Review độ tin cậy ML (2026-06-08)
- [x] **Thêm `src/ml/evaluate_attrition.py`** — 4 bằng chứng độ tin cậy → `models/eval_report.json`:
  - **Out-of-time:** train 2024-12-31 → test 2025-06-30 = **AUC 0.695** (kém CV chỉ 0.023 → generalize qua thời gian).
  - **5-fold CV:** AUC **0.718 ± 0.007** (std nhỏ → ổn định, không phải split may rủi).
  - **Baseline:** LogReg **0.733 > XGBoost 0.718** → tín hiệu phần lớn tuyến tính; single-feature `last_score` 0.687.
  - **Calibration:** Brier 0.16, reliability curve cho thấy over-confident ~2× (do scale_pos_weight) → risk_score là RANK, không phải xác suất.
- [x] **Điều tra rò rỉ point-in-time** (nghi ngờ cũ trong journey): promotion KHÔNG đổi dept/level (1,324 cặp version, 0 thay đổi) → rò rỉ `is_current` = 0 thực tế. Bác bỏ nghi ngờ.
- [x] **Phát hiện bug `valid_to` SCD2:** 394 bản terminated có `valid_to < valid_from` → KHÔNG dùng valid_to lọc population (cách hiện tại dùng hire/exit_date là đúng). Ghi nhận fix dbt sau.
- [x] `build_features.py`: chuyển `pd.read_sql` sang **SQLAlchemy engine** (hết warning) + comment point-in-time.
- [x] `train_attrition.py`: thêm Brier score + threshold sweep (P/R theo ngưỡng) + best-F1 vào metrics.json.
- [x] Retrain (AUC 0.7136 reproduce) + rescore (484/1314/2721 reproduce) + regenerate data.js.
- [x] Cập nhật `src/ml/README.md` + `docs/build-journey.md` (Bước 6 đánh giá chi tiết) + Đánh giá/Báo cáo.

### Quyết định Phase 4b
- Giữ XGBoost vì SHAP per-employee (HR cần "vì sao"), CHẤP NHẬN kém LogReg ~0.015 AUC — interpretability > accuracy ở use-case này.
- risk_score = điểm xếp hạng ưu tiên triage, KHÔNG calibrate (chưa cần báo xác suất tuyệt đối).
- Model đủ tin để gợi ý HR gặp 1:1, KHÔNG dùng ra quyết định tự động (precision ~0.33).

## Phase 5c — Canh chuẩn GHN design + fix bug ML filter (2026-06-08)
- [x] **🔴 BUG ML "100% rủi ro CAO" khi lọc phòng** (user phát hiện): `bandCnt()` đếm từ `risk.top`
  (Top 100 NV toàn band `high`) → lọc dept ra 100% Cao. Sửa tận gốc:
  - `export_marts.py` `_risk_block()`: thêm `bands_by_dept`, `bands_by_level`, `bands_by_dept_level`
    (GROUP BY dept/level × risk_band trên TOÀN BỘ attrition_scores, không LIMIT 100).
  - Regenerate `data.js`. Verify: Engineering = high 77 / medium 261 / low 613 (KHÔNG còn 100%).
  - `render.js` `bandCnt()`: lọc dept → đọc `risk.bands_by_dept[dept]` thay vì `risk.top`.
- [x] **Đối chiếu file mẫu** `.claude/templates/GHN Master Dashboard (standalone).html` (giải nén React bundle,
  trích CSS + components thật làm chuẩn — đã xóa thư mục `_decoded/` tạm sau khi xong).
- [x] **Filter bar tương tác** (thay 5 chip tĩnh): date-range picker (preset 12/24/all tháng + custom Từ/Đến
  input `type=month`) + segmented **Tháng/Quý** (granularity chart xu hướng) + select Phòng/Cấp/Giới tính
  (tab Thực trạng) · Phòng/Cấp/Mức rủi ro/Thâm niên (tab ML). **Lọc thật** toàn bộ KPI/chart/bảng.
  - `state.js`: STATE mở rộng (level/mStart/mEnd/gran/hcGender/riskBand/tenureGroup) + helpers
    `monthsInRange/quartersInRange/filterHeadcount/filterAttrition/filterHiring/applyDeptLevel`.
  - Level filter: chỉ áp Headcount/Compensation/risk; section dept-only (Attrition/Perf/Hiring) hiện banner
    "Cấp không áp dụng" thay vì lọc sai. Gender = toggle view chỉ ở Headcount (data khác không có gender).
- [x] **Chart mới GHN-style** (`charts.js` + `render.js`):
  - `drawStackedBars` — Attrition voluntary/involuntary theo quý + Headcount Nam/Nữ theo phòng.
  - `renderRankTable` (mini-bar) — top phòng attrition cao nhất + top phòng theo median lương.
  - `renderHeatmap` + `scaleRed` — Phòng × Cấp high-risk concentration (tab ML).
  - Hiring: thêm trend "số tuyển được theo quý". KPI ML chuyển sang **RealtimeStrip-style**.
- [x] **Design tokens** (`style.css`) đồng bộ GHN: nav số thứ tự + SVG icon (bỏ emoji), scope-banner có
  divider line kéo hết hàng (`::after`), badge On-track/At-Risk/Off-track chuẩn (`statusOf`/`STATUS_LABEL`),
  density tokens, rt-strip/rank-table/heatmap CSS. Bỏ dept-select khỏi footer sidebar.
- [x] Export CSV cập nhật xuất đúng data đang lọc (range + level + gender + risk band + tenure).
- [x] Test: `node --check` 5/5 PASS + smoke render headless (ml/status × mọi tổ hợp filter) PASS.

### Quyết định Phase 5c
- Filter date/gran lọc THẬT (HR đo theo tháng/quý, không có grain ngày như GHN logistics).
- Bug ML sửa ở DATA LAYER (thêm breakdown query) thay vì workaround ở UI — đúng đắn vì DB sẵn sàng.
- Gender không làm global filter (chỉ Headcount có gender) → toggle view cục bộ.

## Phase 5b — Dashboard review fixes (2026-06-08)
- [x] **Bug funnel 100%**: generator cũ gán mọi requisition đi đủ 5 stage → funnel không thu hẹp.
  Sửa `generate_recruitment()`: nhiều ứng viên/requisition, rớt dần theo conversion thật
  (applied→scr 55% / scr→int 50% / int→off 40% / off→hire 80%). recruitment_events 20,761 → 110,155.
- [x] Sửa `mart_hiring.sql`: đếm DISTINCT candidate/stage thay vì requisition → funnel thu hẹp đúng.
  Verify: applied 36,733 → scr 20,770 → int 10,961 → off 4,958 → hired 2,969.
- [x] Regenerate → full-load (269,267 rows) → dbt run mart_hiring PASS.
- [x] `export_marts.py`: perf_dist thêm department_id → tab Performance filter được theo phòng.
- [x] charts.js: cột dày + sát + căn giữa khi ít cột; giảm chiều cao chart (line/bar 170-180px); funnel kèm % chuyển đổi inline.
- [x] render.js: thêm dải nhận định (insight) mỗi tab; gộp SHAP 3 chip → 1 tag chính (hover xem đủ);
  bỏ chart "tỷ lệ chuyển đổi" trùng (đã có inline trong funnel); HC chart 2 đổi theo ngữ cảnh filter.
- [x] style.css: thêm `.insights/.insight` (alert/warn/good/info), siết spacing card.
- [x] Test: node --check 5/5 + smoke 5 renderer × (all + dept) PASS.

## Phase 5 — Dashboard (2026-06-08)
- [x] `src/dashboard/export_marts.py` — query mart_* + attrition_scores từ MySQL → ghi `js/data.js`
  (departments, levels, headcount 1260, attrition 69, compensation 30, hiring 67, perf_dist, perf_by_dept, risk)
- [x] Multi-file theo html-build.md: index.html + style.css + js/{constants,state,charts,render,init}.js
- [x] 5 tab: Headcount / Attrition (kèm ML risk + SHAP driver) / Performance / Compensation / Hiring
- [x] Canvas charts DPR-aware: line (trend), bar (grouped), donut (risk band), funnel (hiring)
- [x] Filter phòng ban áp dụng cả 5 tab + URL hash persistence
- [x] Mỗi bảng có nút xuất CSV (BOM UTF-8 theo export-data.md)
- [x] SHAP driver kỹ thuật → dịch nhãn tiếng Việt (DRIVER_LABELS trong export_marts.py)
- [x] Test: `node --check` 5/5 file PASS + smoke test 5 renderer + 5 export PASS (cả all & dept-filtered)

### Quyết định Phase 5
- Data feed = script Python export ra `data.js` dạng `const DATA` global (không ES module → mở file trực tiếp không CORS).
- Accent teal `#5eead4` khớp màu project 05 trong portfolio data.js.
- Tab Attrition là tab "ăn tiền": gộp mart_attrition (lịch sử) + attrition_scores (dự báo ML + SHAP top-3).

---

**Phase trước:** Phase 4 — ML Attrition Model ✅ DONE (AUC 0.71)

> **Row counts thực tế (sau Phase 4c — fix event-sau-exit, seed cố định):**
> PostgreSQL/MySQL raw — employees 10,000 · performance_reviews 75,708 · salary_history 30,426 ·
> job_changes 6,465 · recruitment_events 110,155.
> dbt — dim_employee 10,930 · fct_performance 75,708 · fct_salary 30,426 · fct_attrition 5,535 ·
> mart_headcount 1,260 · mart_attrition 69 · attrition_scores 4,519.
> (Con số cũ perf 105,922 / salary 36,320 là bản TRƯỚC khi clamp event sau exit — giữ làm lịch sử.)

## Phase 4 — ML Model (2026-06-08)
- [x] `src/ml/requirements.txt` — xgboost, sklearn, shap, pandas, mysql-connector, joblib
- [x] `src/ml/build_features.py` — point-in-time feature builder, label `left_180d`, tránh leakage (feature <= cutoff)
- [x] `src/ml/train_attrition.py` — XGBoost, scale_pos_weight, eval AUC/PR, save .pkl + metrics.json
- [x] `src/ml/score_attrition.py` — score active employees hôm nay + SHAP top-3 driver → ghi bảng `attrition_scores` MySQL
- [x] **AUC-ROC 0.71** (0.53 random → 0.62 → 0.71 sau khi thêm tín hiệu nhân quả vào generator)
- [x] Scored 4,519 active: 484 high / 1,314 medium / 2,721 low
- [x] Fix Unicode cp1252 (sys.stdout.reconfigure utf-8) trong cả 3 file ml

### Quyết định Phase 4
- Generator gốc gán exit RANDOM theo dept → model AUC ~0.53. Đã **thêm causal signal**:
  low performer / lương đóng băng (18%) / lương lâu không tăng / tenure ngắn → multiplier prob_exit.
- SHAP gộp vào score_attrition.py (1 forward pass), không tách explain_shap.py riêng.
- **QUAN TRỌNG:** sau khi `generate_hr_data.py --truncate` (regenerate), PHẢI chạy
  `load_to_mysql.py --full-load` (không phải incremental) — vì watermark cũ ≥ PK mới sẽ skip data,
  gây MySQL lệch PostgreSQL.

## Phase 3 ✅ DONE + Cleanup cấu trúc ✅ + E2E verified (7/7 PASS)

## Cleanup cấu trúc (2026-06-08)
- [x] Xóa `models/` cũ ở root (bản pre-dbt-init lỗi thời, đã thay bởi `hr_analytics/models/`)
- [x] Xóa `logs/` root, `sql/redshift_raw_schema.sql`, `src/ingest/load_to_redshift.py`, `src/ingest/setup_localstack_redshift.py`
- [x] Tạo `.gitignore` root (ignore `.env`, target/, __pycache__, data lớn) — trước đó .env CHƯA được ignore (rủi ro lộ secret)
- [x] Tạo placeholder README: `src/ml/`, `src/dashboard/`, `dags/` (ghi rõ phase + input)
- [x] Cập nhật README + docs/architecture.md: Redshift→MySQL, models/→hr_analytics/, row counts thực, decision log
- [x] Thêm Adminer (web DB UI) vào docker-compose — http://localhost:8081
- [x] E2E flow test: 7/7 PASS (folder / PG data / MySQL raw / dbt outputs / dbt run 18 / dbt test 52 / loader idempotent)
- [x] Thêm global rule `~/.claude/rules/project-scaffold.md` + link vào CLAUDE.md

**Lưu ý:** container `hr_localstack` (port 4566) là ORPHAN — không còn trong docker-compose, không dùng. Có thể `docker rm -f hr_localstack` để dọn.

---

## Đã xong
- [x] Tạo cấu trúc folder project
- [x] README.md với architecture + tech stack + data model
- [x] Thêm project vào Portfolio (data.js + i18n.js)
- [x] processing.md khởi tạo
- [x] `sql/init_schema.sql` — PostgreSQL OLTP schema (6 tables + indexes + seed data)
- [x] `docker/docker-compose.yml` — PostgreSQL + LocalStack (Redshift)
- [x] `.env.example` — tất cả env vars cần thiết
- [x] `src/generator/generate_hr_data.py` — Faker generator 10k employees × 3yr
- [x] `src/generator/requirements.txt`

## Còn lại

### Phase 1 — Data Generator
- [ ] Test chạy generator: `docker-compose up -d` → `python generate_hr_data.py --truncate`

### Phase 2 — Ingestion ✅ TESTED
- [x] `sql/mysql_raw_schema.sql` — raw layer schema MySQL (8 tables + watermark + indexes)
- [x] `src/ingest/load_to_mysql.py` — incremental loader (full / incremental_pk / replace)
- [x] `src/ingest/requirements.txt` (mysql-connector-python + boto3)
- [x] `docker/docker-compose.yml` đổi sang MySQL 8.0 port 3306
- [x] `.env` + `.env.example` cập nhật MYSQL_* vars
- [x] Đã test full load: 183,820 rows / 22.9s ✅
- [x] Đã test incremental idempotency: fact tables "nothing new" ✅
- [x] Đã fix bugs: port conflict 5432→5433, FK manager_id, encoding Windows, WHERE clause full load

### Quyết định thay đổi
- Đổi từ Redshift (LocalStack) → MySQL: LocalStack Community không expose port 5439 thực sự

### Phase 3 — dbt Models ✅ DONE
- [x] `dbt init hr_analytics` — dbt project scaffold (staging/core/mart layers)
- [x] `models/staging/` — 6 views: stg_employees, stg_departments, stg_job_levels, stg_salary_history, stg_performance_reviews, stg_job_changes, stg_recruitment_events
- [x] `models/core/` — dim_date (2922 rows), dim_department (5), dim_job_level (6), dim_employee SCD2 (11,326 versions), fct_performance (105,922), fct_salary (42,287), fct_attrition (3,521)
- [x] `models/mart/` — mart_headcount (1,260), mart_attrition (70), mart_compensation (30), mart_hiring (66)
- [x] `~/.dbt/profiles.yml` — hr_analytics profile với dbt-mysql 1.7.0
- [x] **dbt run: 18/18 PASS** ✅
- [x] **dbt test: 52/52 PASS** ✅
- [x] Bugs fixed: dim_date cte_max_recursion_depth, dim_employee UNION ALL column order mismatch, mart year_month→year_month_key, mart_compensation PERCENTILE_CONT→ROW_NUMBER manual percentile

### Phase 4 — ML Model
- [ ] `src/ml/train_attrition.py` — XGBoost classifier
- [ ] `src/ml/score_attrition.py` — score all employees, write risk scores
- [ ] SHAP explainability: top 3 drivers per employee

### Phase 5 — Dashboard
- [ ] `src/dashboard/` — multi-tab HTML dashboard (5 tabs)
- [ ] Tab: Headcount, Attrition, Performance, Compensation, Hiring
- [ ] Canvas charts: trend lines, bar charts, donut

### Phase 6 — Orchestration
- [ ] `dags/hr_daily_pipeline.py` — Airflow DAG
- [ ] Alert hook: Slack webhook khi attrition spike

### Phase 7 — Polish
- [ ] docker/docker-compose.yml hoàn chỉnh
- [ ] docs/architecture.md với diagram
- [ ] Screenshots → docs/screenshots/
- [ ] Mark featured: true trong portfolio

## Quyết định quan trọng
- Redshift via LocalStack thay vì Snowflake: giả lập AWS cloud warehouse local, Redshift SQL dialect quen thuộc với recruiter AWS-stack, không cần cloud cost
- XGBoost + SHAP: interpretable ML, phù hợp HR context (cần giải thích được cho HR manager)
- Static HTML dashboard: recruiter mở trực tiếp file, không cần server
