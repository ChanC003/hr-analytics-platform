# Nhật ký xây dựng — HR Analytics Platform (chi tiết từng bước)

> Viết lại toàn bộ quá trình làm project dưới góc nhìn **một Data Engineer bình thường, làm tay, không dùng AI** —
> từ lúc nhận bài toán đến lúc pipeline tự chạy hàng ngày + có CI. Mỗi bước ghi rõ **suy nghĩ → làm gì → lệnh
> terminal cụ thể → tình huống có thể xảy ra → cách xử lý → lưu ý**.
>
> Phạm vi: **Phase 1 → Phase 7 (7/7 đã xong, test thật end-to-end ngày 2026-06-09).**

**Mục lục**
- [0. Kết quả test flow](#0-kết-quả-test-flow-chốt-trước)
- [1. Nhận bài toán](#1-nhận-bài-toán)
- [2. Phân tích & thiết kế kiến trúc](#2-phân-tích--thiết-kế-kiến-trúc)
- [3. Lên plan](#3-lên-plan)
- [Phase 1 — Generator + OLTP](#phase-1--generator--postgresql-oltp)
- [Phase 2 — Ingest (chi tiết)](#phase-2--ingest-postgresql--mysql-chi-tiết-từng-bước)
- [Phase 3 — dbt (từng file)](#phase-3--dbt-models-từng-file-một-ý-nghĩa--lý-do)
- [Phase 4 — ML (từng bước tư duy)](#phase-4--ml-attrition--shap-từng-bước-tư-duy)
- [Phase 5 — Dashboard (cầm tay chỉ việc)](#phase-5--dashboard-html-cầm-tay-chỉ-việc-cho-intern)
- [Phase 6 — Airflow orchestration](#phase-6--airflow-orchestration-tự-động-hoá-pipeline)
- [Phase 7 — CI/CD + Test automation](#phase-7--cicd--test-automation)
- [Đánh giá & rút kinh nghiệm](#6-đánh-giá--rút-kinh-nghiệm)
- [Báo cáo](#7-báo-cáo-stakeholder)

---

## 0. Kết quả test flow (chốt trước)

Chạy lại toàn bộ flow end-to-end (2026-06-09) để chắc chắn còn sống — **7/7 phase PASS**:

| Layer | Kiểm tra | Kết quả |
|---|---|---|
| Docker | `docker ps` | postgres·mysql·airflow_db **healthy** · airflow·adminer up |
| PostgreSQL OLTP | row count | emp 10,000 · perf 75,708 · salary 30,426 · job_changes 6,465 · recruit 110,155 |
| MySQL raw | row count | **khớp 100%** PostgreSQL → loader OK |
| dbt core/mart | row count | dim_employee 10,930 · fct_attrition 5,535 · fct_salary 30,426 · mart_headcount 1,260 |
| dbt test | `dbt test` | **53/53 PASS** (gồm test valid_to ≥ valid_from) |
| ML | train·eval·score | AUC **0.7136** · OOT 0.695 · CV 0.718±0.007 · score ~486/1309/2723 |
| Dashboard | headless render matrix | **204 tổ hợp filter × 0 fail** · 5/5 CSV export |
| Airflow | DAG run | **6/6 task SUCCESS** · alert "ATTRITION SPIKE 2026-Q2 12.5%" |
| CI suite | ruff·pytest·JS | ruff clean · pytest **25 passed+1 skip** · JS **7 passed** |

> **Cập nhật 2026-06-08 (Phase 4c):** sửa bug "event sau ngày nghỉ" — generator sinh review/lương/thăng chức
> độc lập exit_date nên có row dated SAU khi nhân viên đã nghỉ (30,214 review + 5,894 salary + 394 promotion).
> Đã clamp về `<= exit_date` → row count perf/salary giảm tương ứng. Metrics ML **không đổi** (0.7136) vì
> `build_features` vốn đã filter `<= cutoff`, nên row bẩn chưa từng lọt vào train. Xem
> [Bước 7 — Bug event sau exit](#bước-7--bug-event-sau-ngày-nghỉ-fix-2026-06-08).
| ML train | `train_attrition.py` | **AUC-ROC 0.7136** (reproduce đúng metrics.json) |
| ML eval | `evaluate_attrition.py` | **OOT 0.695 · CV 0.718±0.007 · LogReg 0.733** → eval_report.json |
| ML score | `score_attrition.py` | 4,519 active → **484 high / 1,314 medium / 2,721 low** |

> Đã cập nhật lại số liệu trong `README.md` + `processing.md` cho khớp (trước đó còn ghi salary 42,287 / fct_attrition 3,521 — số của bản TRƯỚC khi regenerate Phase 4).

---

## 1. Nhận bài toán

**Đề bài (tự đặt, project portfolio):**
> "Hệ thống HR analytics end-to-end: data nhân sự thô → dimensional model → dự đoán nghỉ việc *giải thích được* → dashboard. Chạy 100% local, demo được cho recruiter."

**Bóc tách thành câu hỏi nghiệp vụ:**
1. Headcount theo phòng/cấp bậc, thay đổi theo thời gian?
2. Attrition rate theo quý/phòng?
3. Phân bố điểm performance?
4. Lương công bằng theo band (p25/median/p75)?
5. **Ai sắp nghỉ trong 6 tháng tới, VÌ SAO?** ← phần ăn tiền, phân biệt với dashboard thường.

**Ràng buộc tự đặt:** local 100% (Docker, không cloud cost) · demo offline (dashboard mở bằng file) · model **giải thích được** (HR không tin black box).

---

## 2. Phân tích & thiết kế kiến trúc

Vẽ kiến trúc ra giấy trước. Phân tầng kinh điển:

```
Generator (Faker) → OLTP (PostgreSQL) → Warehouse (MySQL) → dbt (staging→core→mart) → ML (XGBoost+SHAP)
                                                                                     → Dashboard (HTML)
```

**Vì sao tách OLTP riêng khỏi Warehouse (không gen thẳng vào warehouse)?**
Mô phỏng đúng đời thực: data sinh ở hệ giao dịch (OLTP), rồi *ingest* sang kho phân tích. Có bước ingest mới
demo được **incremental load + watermark** — kỹ năng DE cốt lõi. Nếu gen thẳng thì mất cả một mảng kiến thức.

**Thiết kế core layer (viết ra TRƯỚC khi code):**
- `dim_employee` — **SCD Type 2**. HR cần point-in-time: "lúc nghỉ, lương/cấp bậc người này là gì?" → version theo promotion, không ghi đè.
- `fct_performance`, `fct_salary`, `fct_attrition` — fact tables.
- `mart_*` — bảng tổng hợp cho dashboard.

---

## 3. Lên plan

| Phase | Nội dung | Output kiểm chứng |
|---|---|---|
| 1 | Generator + OLTP schema | data nằm trong PostgreSQL |
| 2 | Ingest PostgreSQL → Warehouse | row count warehouse = OLTP |
| 3 | dbt models | `dbt run` + `dbt test` PASS |
| 4 | ML attrition + SHAP | AUC > baseline + bảng scores |
| 5 | Dashboard *(chưa)* | — |
| 6 | Airflow *(chưa)* | — |

Nguyên tắc: **mỗi phase phải chạy & test được độc lập** mới sang phase sau.

---

## Phase 1 — Generator + PostgreSQL OLTP

### Suy nghĩ
Cần data "giống thật" — không random vô hồn. Phải có: cơ cấu phòng ban, cấp bậc, lương theo band, review hàng quý,
promotion, và **nghỉ việc có nguyên nhân**. Phần "nguyên nhân" lúc đầu mình làm sơ sài (chỉ random theo dept) — và
đây chính là cái sau này phải sửa ở Phase 4 (xem [lưu ý quan trọng nhất](#lưu-ý-quan-trọng-nhất-của-cả-project)).

### Làm gì — từng bước
1. **Viết schema OLTP** `sql/init_schema.sql`: schema `hr.*` 7 bảng + index + seed (departments, job_levels). Serial PK cho mọi fact table (cần cho watermark Phase 2).
2. **Viết generator** `src/generator/generate_hr_data.py`:
   - `DEPARTMENTS` — mỗi phòng có `salary_band` + `attrition_rate` riêng.
   - `LEVEL_SALARY_MULTIPLIER = {1:0.6 ... 6:1.7}` — lương tăng theo cấp.
   - Hàm `salary_for(dept, level)` = base band × multiplier + jitter gauss 5%.
   - Sinh nhân viên → salary_history → performance_reviews → job_changes (promotion + termination) → recruitment_events.
   - **Seed cố định** (`random.Random(42)`) → chạy lại ra đúng số.
3. **Dựng PostgreSQL** bằng Docker, mount init script tự chạy lúc khởi tạo container.

### Lệnh terminal
```powershell
cp .env.example .env                                   # rồi điền password
docker-compose -f docker/docker-compose.yml up -d      # init_schema.sql tự apply
pip install -r src/generator/requirements.txt
python src/generator/generate_hr_data.py --truncate    # --truncate = xoá sạch trước, idempotent
```

### Kiểm chứng
```powershell
docker exec hr_postgres psql -U hr_user -d hr_db -c "SELECT count(*) FROM hr.employees;"   # → 10000
```

### Tình huống có thể xảy ra → cách xử lý
| Tình huống | Triệu chứng | Xử lý |
|---|---|---|
| Port 5432 bị chiếm | container PG không start | host đã chạy PG native → map ra **5433** (`"5433:5432"`) |
| FK `manager_id` lỗi | insert fail, manager trỏ tới nhân viên chưa tồn tại | sinh nhân viên theo thứ tự cấp bậc cao→thấp, hoặc nới FK lúc seed |
| `UnicodeEncodeError` khi print | console Windows cp1252 không in được tiếng Việt | `sys.stdout.reconfigure(encoding="utf-8")` đầu file |
| init script không chạy lại | sửa schema xong `up -d` mà DB cũ | `docker-compose down -v` (xoá volume) rồi `up -d` lại |

> **Lưu ý:** init script trong `docker-entrypoint-initdb.d` **chỉ chạy 1 lần lúc volume trống**. Sửa schema sau đó phải `down -v`.

---

## Phase 2 — Ingest PostgreSQL → MySQL (chi tiết từng bước)

> Đây là trái tim "DE" của project: **incremental load idempotent bằng watermark**.
> File chính: `src/ingest/load_to_mysql.py`.

### Suy nghĩ — tại sao cần watermark?
Chạy pipeline mỗi ngày, không thể load lại toàn bộ 180k dòng mỗi lần (chậm + nhân đôi data). Cần biết "lần trước
đã load tới đâu" để lần này chỉ lấy dòng MỚI. Vì fact table có **serial PK tăng dần**, dùng chính PK làm watermark:
load xong lưu `last_loaded_id`, lần sau `WHERE pk > last_loaded_id`.

### 3 chiến lược load (mỗi bảng một kiểu)
| Bảng | Mode | Lý do |
|---|---|---|
| `departments`, `job_levels` | **full** (TRUNCATE + reload) | bảng tham chiếu nhỏ, load lại cho gọn |
| `employees` | **replace** (`REPLACE INTO`) | nhân viên có thể đổi status active→terminated → cần update, không chỉ insert |
| `salary_history`, `performance_reviews`, `job_changes`, `recruitment_events` | **incremental_pk** | fact table lớn, chỉ lấy PK mới |

### Logic incremental (từng bước trong code)
```
1. get_watermark(table)            → đọc last_loaded_id từ bảng _load_watermarks (chưa có = 0)
2. SELECT ... WHERE pk > %s         → query PG với watermark làm tham số
3. fetchmany(BATCH_SIZE=5000)       → đọc theo lô, executemany INSERT IGNORE vào MySQL
4. last_id = rows[-1][0]            → PK lớn nhất của lô vừa load
5. update_watermark(last_id, +n)    → cập nhật watermark + cộng dồn rows_loaded
6. commit() 1 lần ở cuối            → toàn bộ load là 1 transaction; lỗi → rollback() sạch
```

- `INSERT IGNORE` cho fact → idempotent thật: lỡ load trùng PK cũng không nhân đôi.
- `REPLACE INTO` cho employees → vừa insert vừa update theo PK.

### Lệnh terminal
```powershell
pip install -r src/ingest/requirements.txt

# Lần đầu — full load (reset mọi watermark, TRUNCATE + reload tất cả)
python src/ingest/load_to_mysql.py --full-load

# Hằng ngày — incremental (fact table sẽ báo "nothing new" nếu không có gì mới)
python src/ingest/load_to_mysql.py

# Load 1 bảng cụ thể
python src/ingest/load_to_mysql.py --table salary_history
```

### Kiểm chứng đồng bộ
```powershell
docker exec hr_mysql mysql -u hr_analyst -phr_mysql_pass hr_warehouse -e "SELECT count(*) FROM raw_employees;"
# phải = count bên PostgreSQL (10000)
```

### Tình huống có thể xảy ra → cách xử lý
| Tình huống | Triệu chứng | Xử lý |
|---|---|---|
| **Full load vẫn dính WHERE** | query incremental có `WHERE pk > %s`, full load không truyền tham số → lỗi/thiếu data | code tự **strip mệnh đề WHERE** khi full (`query[:query.index("WHERE")]`) — xem `load_full()` |
| **Watermark lệch sau regenerate** | chạy `generate --truncate` (PK reset về 1) rồi chạy *incremental* → watermark cũ ≥ PK mới → **skip sạch data** | **BẮT BUỘC** `--full-load` sau mỗi regenerate (xem lưu ý dưới) |
| Load nửa chừng crash | mất kết nối giữa chừng | toàn bộ trong 1 transaction → `rollback()` tự động, watermark KHÔNG bị cập nhật → chạy lại an toàn |
| Encoding khi log tiếng Việt | `UnicodeEncodeError` | logging dùng ASCII / set UTF-8 |

### ⚠️ Lưu ý quan trọng nhất của Phase 2
**Sau mỗi `generate_hr_data.py --truncate` → PHẢI `load_to_mysql.py --full-load`**, KHÔNG được incremental.
Vì regenerate reset PK về 1, mà watermark cũ đang giữ giá trị lớn (vd 36320) → incremental query
`WHERE salary_id > 36320` trả về 0 dòng → MySQL **âm thầm lệch** PostgreSQL mà không báo lỗi. Đây là loại bug
khó chịu nhất: không crash, chỉ sai số. Test idempotency là để bắt đúng loại này.

**Kết quả thực:** full load ~232,765 dòng trong ~30s; incremental lần 2 → fact tables "nothing new" ✅.

---

## Phase 3 — dbt Models (từng file một, ý nghĩa + lý do)

> Dùng `dbt init hr_analytics` để có scaffold chuẩn (KHÔNG tự dựng `models/` rời ở root).
> 3 tầng: **staging (view) → core (table) → mart (table)**. Tổng 18 model.

### Vì sao 3 tầng?
- **staging** = làm sạch raw, 1-1 với bảng nguồn, ép kiểu, chuẩn hoá null. Là view (nhẹ, luôn tươi).
- **core** = dimensional model (dim/fct). Là table (đắt khi build, nhưng query nhanh).
- **mart** = tổng hợp business metric cho dashboard. Là table.

Tách tầng để: lỗi nằm đúng tầng nào dễ tìm; tầng dưới đổi không phá tầng trên; test theo tầng.

### `models/staging/sources.yml`
Khai báo nguồn = các bảng `raw_*` trong MySQL. Cho phép `{{ source(...) }}` + test freshness. Là điểm "neo" để dbt biết raw layer ở đâu.

### `models/staging/stg_*.sql` (7 view) — làm sạch
Mỗi file 1-1 với 1 bảng raw. Ví dụ `stg_employees.sql`:
- `LOWER(TRIM(email))`, `LOWER(COALESCE(gender,'unknown'))` — chuẩn hoá.
- `CAST(... AS DATE/UNSIGNED)` — ép kiểu (raw để VARCHAR cho an toàn ingest).
- `WHERE employee_id IS NOT NULL AND hire_date IS NOT NULL` — loại rác.

7 view: `stg_employees, stg_departments, stg_job_levels, stg_salary_history, stg_performance_reviews, stg_job_changes, stg_recruitment_events`.

> **Lưu ý:** staging KHÔNG join, KHÔNG aggregate — chỉ clean 1 bảng. Join/tính toán để dành tầng core/mart. Giữ kỷ luật này thì pipeline dễ debug.

### `models/core/dim_date.sql` — calendar
Sinh lịch 2020–2027 (2,922 dòng) bằng **recursive CTE**. Dùng để join phân tích theo thời gian.
- **Tình huống:** MySQL chặn đệ quy ở 1000 mặc định → `cte_max_recursion_depth exceeded`.
- **Xử lý:** set `cte_max_recursion_depth` cao hơn (hoặc đổi cách sinh ngày).

### `models/core/dim_employee.sql` — **SCD Type 2** (model khó nhất)
Mỗi dòng = 1 *version* của nhân viên. Logic:
1. `base` — version đầu tiên, `valid_from = hire_date`.
2. `promotions` — mỗi promotion (`change_type='promotion'`) tạo 1 version mới, lấy dept/level/manager MỚI (`COALESCE(jc.to_*, e.*)`), `valid_from = change_date`.
3. `all_versions` — `UNION ALL` base + promotions, **liệt kê cột tường minh** (không `SELECT *`).
4. `ranked` — `ROW_NUMBER()` đánh version + `LEAD(valid_from)` lấy mốc version kế.
5. `exits` — lấy `exit_date`/`exit_type` từ `change_type='termination'`.
6. SELECT cuối: `employee_sk = CONCAT(id,'-V',version)`, `valid_to = next_valid_from - 1 ngày` (hoặc exit_date nếu terminated, hoặc NULL nếu current), `is_current = 1` cho version mới nhất, `tenure_days`.

- **Tình huống:** `UNION ALL` báo column order/type mismatch giữa 2 nhánh.
- **Xử lý:** viết **đúng thứ tự cột giống hệt** 2 nhánh, ép cùng kiểu. Đây là lỗi kinh điển của UNION.

> **Ý nghĩa nghiệp vụ:** nhờ SCD2 mà sau này hỏi được "lúc nghỉ việc, người này ở dept/level nào, lương bao nhiêu" — point-in-time correct.

### `models/core/dim_department.sql`, `dim_job_level.sql` — dim nhỏ
Clean + thêm thuộc tính phái sinh (vd `level_group`: Junior/Mid gộp "IC", Lead/Manager "Lead"). Phục vụ group trên dashboard.

### `models/core/fct_performance.sql`, `fct_salary.sql`, `fct_attrition.sql` — fact
- `fct_performance` (75,708) — mỗi review 1 dòng, thêm `score_4q_avg`, `score_delta` (window function — chính là feature cho ML sau này).
- `fct_salary` (30,426) — mỗi lần đổi lương 1 dòng + `salary_delta_pct`, `salary_seq` (thứ tự thay đổi/employee).
- `fct_attrition` (5,535) — mỗi exit 1 dòng + `tenure_days`, `last_score`.

### `models/mart/*.sql` (4 bảng) — business metric
- `mart_headcount` (1,260) — grain `(year_month_key, dept, level)`.
- `mart_attrition` (69) — grain `(year_quarter, dept)` → attrition rate.
- `mart_compensation` (30) — grain `(dept, level)` → salary p25/median/p75.
  - **Tình huống:** MySQL 8.0 KHÔNG có `PERCENTILE_CONT`.
  - **Xử lý:** tự tính percentile bằng `ROW_NUMBER()` + `FLOOR(grp_cnt * 0.25)+1` — xem `mart_compensation.sql`.
- `mart_hiring` (66) — funnel tuyển dụng.
  - **Tình huống:** alias `year_month` đụng reserved-ish/khó group.
  - **Xử lý:** đổi sang `year_month_key`.

### `models/*/schema.yml` — data quality test
Khai báo test cho từng cột: `not_null`, `unique`, `accepted_values` (vd `is_current ∈ {0,1}`, `exit_type ∈ {voluntary,involuntary,retirement}`), `relationships` (FK). Tổng **52 test**.

### Lệnh terminal
```powershell
cd hr_analytics
dbt debug          # KIỂM TRA KẾT NỐI profile TRƯỚC — luôn chạy đầu tiên
dbt run            # build 18 model (staging→core→mart, dbt tự sắp thứ tự theo ref())
dbt test           # 52 data quality test
dbt run --select dim_employee    # chạy lại 1 model khi debug
dbt run --select dim_employee+   # model đó + tất cả downstream phụ thuộc
cd ..
```

### Kết quả: `dbt run` **18/18 PASS** · `dbt test` **52/52 PASS**.

### Tình huống chung Phase 3 → xử lý
| Tình huống | Xử lý |
|---|---|
| `dbt debug` fail | sai `~/.dbt/profiles.yml` (host/port/user) — sửa profile, **append** không ghi đè profile project khác |
| model A cần B nhưng B chạy sau | luôn dùng `{{ ref('B') }}` — dbt tự suy ra thứ tự, KHÔNG hardcode tên bảng |
| sửa SQL không thấy đổi | dbt cache parse → `dbt run` lại; nếu lạ thì xoá `target/` |
| test fail | đọc `dbt test` chỉ rõ cột nào — sửa logic model, không sửa test cho qua |

---

## Phase 4 — ML Attrition + SHAP (từng bước tư duy)

> 3 file: `build_features.py` (tạo input) → `train_attrition.py` (train+test) → `score_attrition.py` (score + SHAP).
> Đây là phần phải suy nghĩ kỹ nhất về **logic** — sai một chỗ là model vô nghĩa.

### Bước 1 — Định nghĩa bài toán ML
- **Target:** nhân viên có nghỉ trong **180 ngày** tới không? → binary classification.
- **Đơn vị:** mỗi nhân viên *active tại một thời điểm cutoff* = 1 mẫu.

### Bước 2 — Tư duy chống data leakage (QUAN TRỌNG NHẤT)
Đây là chỗ người mới hay sai: nếu dùng feature "tương lai" để dự đoán → model giả vờ giỏi nhưng vô dụng thực tế.
Nguyên tắc point-in-time:
- Chọn `cutoff_date`.
- **Population** = nhân viên active TẠI cutoff (`hire_date <= cutoff AND (exit_date IS NULL OR exit_date > cutoff)`).
- **Feature** chỉ tính từ data `<= cutoff` (review_date <= cutoff, effective_date <= cutoff).
- **Label** `left_180d` = 1 nếu exit trong `(cutoff, cutoff+180d]`.

→ Feature ở quá khứ, label ở tương lai, ranh giới là cutoff. Train dùng cutoff quá khứ (2025-06-30, đủ horizon biết nhãn); score dùng cutoff = hôm nay (chưa biết nhãn, chỉ predict).

### Bước 3 — Tạo input (`build_features.py`)
Từng query (tất cả đều filter `<= cutoff`):
1. **Population** từ `dim_employee` (active tại cutoff).
2. **Performance** — `last_score`, `last_4q_avg`, `last_score_delta`, `avg_score`, `num_reviews`, `num_managers`.
3. **Salary** — `current_salary`, `last_salary_delta_pct`, `days_since_last_raise`, `num_salary_changes`.
4. **Dept attrition rate** — `_dept_attrition_rate(cutoff)`: exits<=cutoff / total<=cutoff (lịch sử, không leak).
5. **Derived** — `age`, `tenure_days_at_cutoff`.
6. **Fill NA** — nhân viên chưa có review/salary → default (vd `days_since_last_raise=9999`).

```powershell
cd src/ml
python build_features.py --cutoff 2025-06-30    # in label balance để kiểm tra TRƯỚC khi train
# → Cutoff: 2025-06-30 | rows: 5770 | cols: 19 | Label left_180d: 967 positive (16.8%)
```
16.8% positive = imbalanced vừa phải, đủ học.

### Bước 4 — Train + test (`train_attrition.py`)
```
[1] build_features(cutoff=2025-06-30, for_training=True)        → X, y
[2] one-hot categorical (gender, employment_type); split 80/20 STRATIFY theo y; random_state=42
[3] XGBoost: n_estimators=300, max_depth=5, lr=0.05, subsample=0.8,
    scale_pos_weight = n_neg/n_pos (≈4.96) → cân imbalance
[4] eval trên test 20%: AUC-ROC, AUC-PR, confusion matrix, classification_report
[5] save attrition_xgb.pkl + feature_columns.json + metrics.json
```
- **Vì sao stratify?** giữ tỷ lệ 16.8% positive ở cả train/test, tránh split lệch.
- **Vì sao `scale_pos_weight`?** class nghỉ ít → model lười đoán "không nghỉ" hết. Trọng số này phạt nặng khi bỏ sót.
- **Vì sao đo cả AUC-PR?** với imbalanced, AUC-PR phản ánh thật hơn AUC-ROC.

```powershell
python train_attrition.py
# → AUC-ROC 0.7136 | AUC-PR 0.3006 | scale_pos_weight 4.96
```

### Bước 5 — Score + giải thích (`score_attrition.py`)
```
[1] load model + feature_columns.json
[2] build_features(cutoff=HÔM NAY, for_training=False)   → active employees, chưa có nhãn
[3] align_features: thêm cột thiếu=0, bỏ cột thừa, đúng thứ tự như lúc train (TRÁNH lệch schema)
[4] predict_proba → risk_score; band: >=0.6 high, >=0.3 medium, else low
[5] SHAP TreeExplainer → mỗi nhân viên lấy top-3 feature có shap>0 (đẩy risk LÊN) → driver_1..3
[6] ghi bảng attrition_scores (DELETE theo scored_at + INSERT) — idempotent theo ngày
```
```powershell
python score_attrition.py
# → Scored 4519 @ 2026-06-08 | high 484 / medium 1314 / low 2721
cd ../..
```

### Kiểm chứng output
```powershell
docker exec hr_mysql mysql -u hr_analyst -phr_mysql_pass hr_warehouse -e "
  SELECT risk_band, count(*) FROM attrition_scores GROUP BY risk_band;
  SELECT employee_id, risk_score, driver_1, driver_2, driver_3
  FROM attrition_scores ORDER BY risk_score DESC LIMIT 3;"
```
Top risk driven by `last_score` thấp + `days_since_last_raise` cao + `dept_attrition_rate` → **hợp lý nghiệp vụ**.

---

### Bước 6 — Đánh giá ĐỘ TIN CẬY (review bổ sung 2026-06-08)

> 1 con số "AUC 0.71" KHÔNG đủ để tin model. Một AUC tốt có thể đến từ: split may mắn, overfit thời gian,
> hay tín hiệu rò rỉ. Phần này dựng **4 bằng chứng độc lập** để trả lời "có đáng tin không". File:
> `src/ml/evaluate_attrition.py` → ghi `models/eval_report.json`. Chạy: `python evaluate_attrition.py`.

#### 6.0 — Tóm tắt model dưới dạng "thẻ model" (model card)

| Hạng mục | Nội dung |
|---|---|
| **Bài toán** | Binary classification — nhân viên có nghỉ trong **180 ngày** tới (`left_180d`) |
| **Đơn vị mẫu** | 1 nhân viên *active tại cutoff* = 1 dòng |
| **Thuật toán** | XGBoost (`n_estimators=300, max_depth=5, lr=0.05, subsample/colsample=0.8`) |
| **Vì sao XGBoost** | (a) chịu được feature numeric lệch thang, không cần scale; (b) **SHAP TreeExplainer** giải thích per-employee — HR cần "vì sao", không nhận black box. *(Lưu ý 6.3: trên data này LogReg còn nhỉnh hơn về AUC — XGBoost được giữ chủ yếu vì SHAP, không phải vì độ chính xác.)* |
| **Input (21 feature)** | perf: `last_score, last_4q_avg, last_score_delta, avg_score, num_reviews, num_managers` · salary: `current_salary, last_salary_delta_pct, days_since_last_raise, num_salary_changes` · org: `department_id, level_id, dept_attrition_rate` · cá nhân: `age, tenure_days_at_cutoff` · one-hot: `gender_*` (3), `employment_type_*` (3) |
| **Imbalance** | base-rate 16.8% positive → `scale_pos_weight ≈ 4.96` (= n_neg/n_pos) |
| **Output** | `risk_score` ∈ [0,1] (điểm xếp hạng) + `risk_band` (high ≥0.6 / medium ≥0.3 / low) + SHAP `driver_1..3` |
| **Train cutoff** | 2025-06-30 (đủ 180 ngày horizon để biết nhãn thật) |

#### 6.1 — Bằng chứng 1: Cross-validation (con số có ỔN ĐỊNH không?)

5-fold stratified CV tại cutoff 2025-06-30:
```
AUC-ROC: 0.7176 ± 0.0070   |   AUC-PR: 0.3198 ± 0.0146
```
→ **std 0.007 rất nhỏ** ⇒ 0.71 không phải nhờ split may mắn; đổi fold vẫn ~0.71. Đáng tin về mặt ổn định.

#### 6.2 — Bằng chứng 2: Out-of-time (model có GENERALIZE qua thời gian không?)

Đây là bài test thật nhất cho bài toán dự báo: **train ở quá khứ, test ở tương lai** (mô phỏng đúng lúc deploy —
train hôm nay, dự báo cho ngày mai). Train cutoff **2024-12-31** → test cutoff **2025-06-30** (2 tập nhân viên/thời
điểm khác hẳn nhau):
```
OOT AUC-ROC: 0.6946   (chỉ kém CV 0.7176 đúng 0.023)
```
→ Rớt rất ít khi sang thời điểm mới ⇒ **không overfit thời gian**, model học pattern bền chứ không học nhiễu của 1
lát cắt. Đây là bằng chứng mạnh nhất cho "đáng tin để dùng dự báo".

#### 6.3 — Bằng chứng 3: Baseline (model phức tạp có ĐÁNG so với đơn giản không?)

| Mô hình | AUC-ROC | Kết luận |
|---|---|---|
| Majority (đoán "không nghỉ") | 0.500 | sàn |
| Single-feature `last_score` | 0.687 | **gần như cả model nằm ở 1 feature** |
| Single-feature `last_4q_avg` | 0.685 | điểm review là tín hiệu mạnh nhất |
| Single-feature `dept_attrition_rate` | 0.575 | phòng có nghỉ cao → đóng góp vừa |
| **LogisticRegression** (balanced) | **0.733** | ⚠️ **CAO HƠN XGBoost (0.718)** |
| XGBoost (model chính) | 0.718 | — |

**Phát hiện thành thật (quan trọng):** trên dataset này tín hiệu **phần lớn là tuyến tính** → một LogReg đơn giản
còn nhỉnh hơn XGBoost ~0.015 AUC. Nghĩa là **không nên bán XGBoost như "vũ khí bí mật về độ chính xác"**. Lý do
giữ XGBoost: **khả năng giải thích per-employee bằng SHAP** (driver_1..3 cho từng người) — thứ LogReg coefficient
toàn cục không cho. Đây là đánh đổi *interpretability cục bộ* đổi lấy ~0.015 AUC. Nếu chỉ cần rank, LogReg đủ.

#### 6.4 — Bằng chứng 4: Calibration (risk_score có = xác suất THẬT không?)

Reliability curve (10 bins, trên OOT test) cho thấy model **over-confident**:

| risk_score dự đoán (TB bin) | tỷ lệ nghỉ THỰC TẾ |
|---|---|
| 0.45 | 0.21 |
| 0.54 | 0.30 |
| **0.68** | **0.34** |

→ Bucket "dự đoán ~68%" thực tế chỉ ~34% nghỉ. Nguyên nhân: `scale_pos_weight=4.96` cố ý đẩy điểm lên để bắt
class hiếm → **risk_score bị thổi phồng ~2×, KHÔNG phải xác suất calibrated**. Brier score 0.16.

**Hệ quả cách đọc:** `risk_score` là **điểm XẾP HẠNG ƯU TIÊN** ("ai cần gặp trước"), KHÔNG đọc là "người này
68% sẽ nghỉ". Band high/medium/low cũng là phân tầng ưu tiên, không phải xác suất tuyệt đối. Nếu sau này cần con
số xác suất thật → bọc `CalibratedClassifierCV` (Platt/Isotonic). Hiện chưa làm vì mục đích là *triage*, không
phải *quote xác suất*.

#### 6.5 — Threshold sweep (chọn ngưỡng theo MỤC TIÊU nghiệp vụ)

Ngưỡng band không phải "đúng/sai" mà là đánh đổi precision↔recall. Bảng (holdout 20%, cutoff 2025-06-30):

| Ngưỡng | Precision | Recall | F1 | Số người gắn cờ |
|---|---|---|---|---|
| 0.3 (band medium) | 0.27 | 0.71 | 0.39 | 515 |
| 0.5 | 0.33 | 0.50 | **0.40** ← best F1 | 291 |
| 0.6 (band high) | 0.33 | 0.35 | 0.34 | 205 |
| 0.7 | 0.33 | 0.20 | 0.25 | 119 |

- Muốn **không bỏ sót** (HR có nguồn lực gặp nhiều người) → ngưỡng thấp 0.3: recall 0.71 nhưng 3 người gắn cờ
  chỉ ~1 người nghỉ thật.
- Muốn **chính xác** (nguồn lực ít) → ngưỡng cao: precision không tăng mấy (~0.33) mà recall rớt mạnh → với data
  này, tăng ngưỡng *không* mua thêm nhiều precision. Đây là dấu hiệu signal có trần.

#### 6.6 — Điều tra rò rỉ point-in-time (kết luận lại — khác với nghi ngờ ban đầu)

Bản trước ghi "⚠️ population dùng `is_current=1` để lấy dept/level → rò rỉ org structure". **Điều tra trên data
thực bác bỏ nghi ngờ này:**

```sql
-- so dept/level giữa các version SCD2 của cùng nhân viên
SELECT SUM(d2.level_id<>d1.level_id) AS level_changed,
       SUM(d2.department_id<>d1.department_id) AS dept_changed, COUNT(*) pairs
FROM dim_employee d1 JOIN dim_employee d2
  ON d1.employee_id=d2.employee_id AND d2.valid_from>d1.valid_from;
-- → level_changed=0, dept_changed=0, pairs=1324
```

→ **Cả 1,324 cặp version, promotion KHÔNG đổi department_id/level_id** ⇒ dùng `is_current=1` cho dept/level **rò
rỉ = 0 thực tế** trên dataset này. Nghi ngờ đúng về lý thuyết nhưng null về số.

**Phát hiện ngược lại — bug thật trong dim_employee:** 394 bản `terminated` có `valid_to < valid_from` (valid_to bị
gán = exit_date sớm hơn version cuối). ⟹ **TUYỆT ĐỐI không dùng `valid_to` để lọc population point-in-time** (nếu
join `valid_to >= cutoff` sẽ loại nhầm người vẫn active). Cách đang dùng — lọc active bằng `hire_date`/`exit_date`
trực tiếp — là **đúng**, không đụng tới `valid_to`. (Bug `valid_to` của SCD2 ghi nhận để fix ở dbt sau, không ảnh
hưởng feature ML.)

#### 6.7 — Kết luận độ tin cậy (1 câu)

> AUC ~0.71 **ổn định** (CV std 0.007) và **generalize qua thời gian** (OOT 0.695) ⇒ đủ tin để **xếp hạng ưu tiên
> retention**. NHƯNG: (1) tín hiệu phần lớn tuyến tính, XGBoost không hơn LogReg về AUC — giữ vì SHAP; (2)
> risk_score **chưa calibrated** (đọc là rank, không phải xác suất); (3) precision class nghỉ ~0.33 → còn nhiều
> false positive, **KHÔNG dùng để ra quyết định tự động** (sa thải/không thăng tiến), chỉ để gợi ý HR gặp 1:1.

---

### Bước 7 — Bug "event sau ngày nghỉ" (fix 2026-06-08)

> Phát hiện khi điều tra bug `valid_to` ở [Bước 6.6](#66--điều-tra-rò-rỉ-point-in-time-kết-luận-lại--khác-với-nghi-ngờ-ban-đầu).
> Hoá ra `valid_to < valid_from` chỉ là *triệu chứng* — gốc bệnh sâu hơn ở **generator**.

#### Triệu chứng & điều tra
Query đếm event xảy ra SAU `exit_date` của cùng nhân viên:
```
performance_reviews sau exit : 30,214 dòng
salary_history sau exit      :  5,894 dòng
promotions sau exit          :    394 dòng   (chính là 394 valid_to < valid_from)
```
Nghĩa là: nhân viên **được review, tăng lương, thăng chức SAU khi đã nghỉ việc** — vô lý nghiệp vụ.

#### Nguyên nhân gốc (thứ tự sinh data trong `main()`)
```
1. generate_salary_history   → sinh trên TOÀN sim window
2. generate_performance_reviews → sinh trên TOÀN sim window
3. generate_job_changes_and_exits → quyết định exit_date SAU CÙNG
```
Vì exit quyết định cuối, mà salary/review/promotion sinh trước & độc lập exit_date → event vô tư rơi vào
khoảng sau exit. (Lưu ý: exit_date *phải* quyết định sau vì xác suất nghỉ phụ thuộc `_last_score`/`_perf_trend`
— vốn tính trong lúc sinh review. Vòng phụ thuộc này là lý do không thể chỉ "đảo thứ tự".)

#### Cách fix — clamp hậu kỳ (`clamp_events_to_exit`)
Giữ nguyên thứ tự sinh (không phá RNG seed của tín hiệu nhân quả), nhưng **sau khi có exit_date thì lọc bỏ
mọi event > exit_date**:
```python
exit_date = {jc["employee_id"]: jc["change_date"]
             for jc in job_change_rows if jc["change_type"] == "termination"}
# drop salary/review > exit_date ; drop promotion > exit_date ; GIỮ termination row
```
- Mỗi nhân viên vẫn còn ≥ 1 dòng salary (dòng `hire` luôn ≤ exit) → không ai mất sạch lương.
- Nhân viên nghỉ trong ~90 ngày đầu có thể 0 review — đúng thực tế (`build_features` đã fillna).

#### Phòng thủ 2 lớp ở dbt (`dim_employee.sql`)
Kể cả nếu nguồn lỗi, model không được tạo `valid_to < valid_from`:
```sql
valid_to = GREATEST(<next_valid_from - 1 | exit_date>, valid_from)
```
Thêm **singular test** `tests/assert_dim_employee_valid_window.sql`: fail nếu còn dòng `valid_to < valid_from`.

#### Kiểm chứng sau fix
```
clamp dropped: salary=5,894 reviews=30,214 promotions=394   (khớp 100% số điều tra)
sau regenerate + full-load + dbt run:
  valid_to < valid_from : 0      promotions after exit : 0
  reviews after exit    : 0      salary after exit     : 0
  dbt test: 53/53 PASS (thêm test valid-window)
```
**Row count đổi:** salary 36,320→30,426 · perf 105,922→75,708 · job_changes 6,859→6,465 · dim_employee 11,324→10,930.

#### Vì sao metrics ML KHÔNG đổi (0.7136 y nguyên)?
Vì `build_features` vốn đã filter `review_date <= cutoff` / `effective_date <= cutoff` → row sau exit (đều ở
tương lai so với cutoff train 2025-06-30 với người đã nghỉ trước đó) **chưa từng lọt vào feature train**. Fix
này dọn **tính toàn vẹn của dimension** (cho mọi phân tích/SCD2/point-in-time tương lai), không phải fix leakage
vào model hiện tại. Bài học: 1 bug data có thể *vô hại với pipeline này* nhưng *độc với pipeline khác* — vẫn phải sửa.

### Tình huống Phase 4 → xử lý
| Tình huống | Triệu chứng | Xử lý |
|---|---|---|
| **AUC ~0.53 (random)** | model không học được gì | data leakage NGƯỢC: generator gán exit RANDOM → không có tín hiệu. Phải **sửa generator** (xem dưới) |
| schema lệch train↔score | predict lỗi/sai do thiếu/thừa cột | `align_features()` ép đúng `feature_columns.json` |
| SHAP trả mảng đa chiều | index lỗi | `np.asarray(sv)`, lấy đúng class dương |
| cảnh báo `pd.read_sql` SQLAlchemy | warning (không sai kết quả) | nên đổi sang SQLAlchemy engine cho sạch |
| encoding Windows | `UnicodeEncodeError` | `sys.stdout.reconfigure(encoding="utf-8")` cả 3 file |

### ⚠️ Lưu ý quan trọng nhất của cả project
**Model AUC 0.53 KHÔNG phải lỗi model — là lỗi DATA không có tín hiệu.**
Generator ban đầu gán nghỉ việc *random theo dept* → học gì cũng = đoán mò. Cách sửa: **quay về generator,
gắn quan hệ nhân quả thật** (xem `generate_hr_data.py` quanh dòng 308–333):

```python
mult = 1.0
if last_score < 2.5:  mult *= 2.8      # điểm thấp → nghỉ nhiều
elif last_score < 3.0: mult *= 1.7
elif last_score > 4.2: mult *= 0.4     # điểm cao → được giữ
if perf_trend < -0.03: mult *= 1.6     # điểm giảm dần → bất mãn
if e["_salary_frozen"]: mult *= 2.2    # ~18% bị đóng băng lương → nghỉ mạnh
if days_since_raise > 600: mult *= 1.5 # lương lâu không tăng
if tenure_days < 547: mult *= 1.7      # nhân viên mới nghỉ nhiều
prob_exit = min(0.95, prob_exit * mult)
```
Sau khi thêm → AUC **0.53 → 0.62 → 0.71**. Bài học: **garbage in, garbage out** — fix nguồn data trước, đừng tune model bừa.

> **HỆ QUẢ:** vì sửa generator nên phải regenerate → đây chính là lý do row count đổi (salary 42,287→36,320,
> fct_attrition 3,521→5,535) và là lý do **bắt buộc `--full-load`** lại ở Phase 2 (đã giải thích trên).

---

## Phase 5 — Dashboard HTML (cầm tay chỉ việc cho intern)

> Mục tiêu: biến số liệu trong MySQL thành **dashboard 5 tab mở được bằng cách double-click file**, không cần
> server, không cần Power BI. Phần này viết SIÊU chi tiết — nếu bạn là intern chưa từng làm dashboard tĩnh,
> đọc từng bước là làm theo được.

### 5.0 — Hiểu bài toán trước khi gõ phím

Mình có data sạch nằm trong MySQL (các bảng `mart_*` + `attrition_scores`). Recruiter/HR muốn **nhìn**, không
muốn viết SQL. Cần một trang web hiển thị KPI + biểu đồ + bảng.

**Câu hỏi đầu tiên một DE phải tự hỏi:** "Trang web này lấy data từ đâu lúc chạy?"
Có 2 lựa chọn:
1. **Web gọi API → API query MySQL real-time.** → cần dựng backend (Flask/FastAPI), cần server chạy 24/7.
2. **Xuất data ra 1 file tĩnh, web đọc file đó.** → không cần server, double-click `index.html` là chạy.

→ Vì yêu cầu là "demo offline, mở bằng file", mình chọn **cách 2**. Đây là quyết định kiến trúc quan trọng nhất
của phase này, mọi thứ sau đều xoay quanh nó.

**Hệ quả của cách 2:**
- Cần 1 script Python: đọc MySQL → ghi ra file JavaScript `data.js` chứa `const DATA = {...}`.
- Dashboard chỉ là HTML+CSS+JS thuần, nạp `data.js` rồi vẽ.
- **KHÔNG dùng ES module** (`import/export`). Vì khi mở file bằng `file://` (không qua http), trình duyệt chặn
  module vì lý do CORS. Phải để mọi biến/hàm ở **global scope** (kiểu cũ, `<script src>` nối tiếp nhau).

### 5.1 — Khảo sát dữ liệu nguồn (BẮT BUỘC làm trước khi code dashboard)

Đừng đoán cột. Mở MySQL xem THẬT có những cột gì, kiểu gì. Nếu code dashboard theo trí nhớ rồi cột sai tên là
toang. Lệnh khảo sát:

```powershell
# Xem cột của bảng sẽ dùng
docker exec hr_mysql mysql -u hr_analyst -phr_mysql_pass hr_warehouse -e "SHOW COLUMNS FROM mart_compensation;"
docker exec hr_mysql mysql -u hr_analyst -phr_mysql_pass hr_warehouse -e "SHOW COLUMNS FROM attrition_scores;"

# Xem giá trị dimension (để biết có bao nhiêu phòng, tên gì)
docker exec hr_mysql mysql -u hr_analyst -phr_mysql_pass hr_warehouse -e "SELECT department_id, department_name FROM dim_department ORDER BY 1;"
docker exec hr_mysql mysql -u hr_analyst -phr_mysql_pass hr_warehouse -e "SELECT level_id, level_name, level_group FROM dim_job_level ORDER BY 1;"
```

Từ kết quả mình ghi ra giấy: 5 phòng (Engineering/Product/Sales/Operations/Human Resources), 6 cấp
(Junior→Director), `attrition_scores` có cột `driver_1..3` (tên feature kỹ thuật) + `risk_score` + `risk_band`.

> **Lưu ý intern:** `attrition_scores.driver_1` chứa giá trị như `last_score`, `days_since_last_raise` — tên feature
> dân kỹ thuật hiểu, nhưng HR đọc không hiểu. → phải có bước **dịch nhãn sang tiếng Việt** (làm ở 5.2).

### 5.2 — Bước 1: Viết script xuất data (`export_marts.py`)

Đây là cây cầu nối MySQL → dashboard. Logic từng phần:

**(a) Kết nối + helper chuyển kiểu.** MySQL trả về `Decimal` và `date` — JSON không serialize được trực tiếp.
Viết hàm `_norm()` ép `Decimal → float`, `date → 'YYYY-MM-DD'`:
```python
def _norm(row):
    out = []
    for v in row:
        if isinstance(v, dt.date):           out.append(v.isoformat())
        elif v.__class__.__name__ == "Decimal": out.append(float(v))
        else:                                 out.append(v)
    return out
```

**(b) Hàm `fetch()` chạy 1 query → list of dict** (mỗi dòng thành `{cột: giá trị}`), tiện cho JS đọc:
```python
def fetch(cur, sql):
    cur.execute(sql)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, _norm(r))) for r in cur.fetchall()]
```

**(c) Dịch nhãn SHAP** — dict map tên kỹ thuật → tiếng Việt:
```python
DRIVER_LABELS = {
    "last_score": "Điểm review gần nhất thấp",
    "days_since_last_raise": "Lâu chưa tăng lương",
    "dept_attrition_rate": "Phòng có tỷ lệ nghỉ cao",
    # ... đủ mọi feature
}
```

**(d) Query từng phần data dashboard cần** — không dump cả bảng, chỉ lấy cột dùng:
- `headcount`, `attrition`, `compensation`, `hiring` ← từ `mart_*`.
- `perf_dist` (phân bố điểm — `GROUP BY FLOOR(score*2)/2`), `perf_by_dept` ← từ `fct_performance`.
- `risk` ← block riêng: lấy `attrition_scores` của **ngày score mới nhất** (`WHERE scored_at = (SELECT MAX...)`),
  join `dim_employee`/`dim_department` để có tên phòng, **dịch driver** qua `DRIVER_LABELS`, lấy top 100 high-risk.

**(e) Ghi ra `js/data.js`** đúng định dạng JS global:
```python
body = "'use strict';\nconst DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
OUT.write_text(body, encoding="utf-8")   # ensure_ascii=False để giữ tiếng Việt
```

**Chạy + kiểm chứng:**
```powershell
cd F:\ChangPH-project\05-HR-Analytics-Platform
python src/dashboard/export_marts.py
# Kỳ vọng in ra: headcount 1260 rows, attrition 69, compensation 30, hiring 67, ...
```

**Tình huống → xử lý:**
| Tình huống | Triệu chứng | Xử lý |
|---|---|---|
| `Object of type Decimal is not JSON serializable` | crash lúc `json.dumps` | thêm hàm `_norm()` ép Decimal→float (đã làm) |
| Tiếng Việt thành `\u1 ...` trong data.js | nhãn driver bị escape | `json.dumps(..., ensure_ascii=False)` + ghi file `encoding="utf-8"` |
| `attrition_scores` rỗng | chưa chạy Phase 4 | chạy `score_attrition.py` trước |

### 5.3 — Bước 2: Dựng khung file (multi-file theo `html-build.md`)

**Quy tắc vàng:** KHÔNG nhồi tất cả vào 1 file `index.html`. Tách rõ trách nhiệm — sau này sửa dễ, đọc dễ:

```
src/dashboard/
├── index.html      ← CHỈ có <link> + <script src>, KHÔNG inline <style>/<script>
├── style.css       ← toàn bộ CSS
└── js/
    ├── data.js     ← auto-gen (đừng sửa tay)
    ├── constants.js← màu + hàm format thuần (fmtInt, fmtMoney...) — KHÔNG đụng DOM
    ├── state.js    ← biến filter (tab nào, phòng nào) + lưu URL hash
    ├── charts.js   ← hàm vẽ canvas (line/bar/donut/funnel)
    ├── render.js   ← build HTML từng tab + bảng + nút xuất CSV
    └── init.js     ← điểm khởi động: gắn sự kiện click, chạy lần đầu
```

**Thứ tự nạp trong `index.html` CỰC KỲ quan trọng** (script sau dùng biến của script trước):
```html
<script src="js/data.js"></script>      <!-- DATA -->
<script src="js/constants.js"></script>  <!-- C, fmtInt... -->
<script src="js/state.js"></script>      <!-- STATE -->
<script src="js/charts.js"></script>     <!-- drawLine... -->
<script src="js/render.js"></script>     <!-- renderHeadcount... -->
<script src="js/init.js"></script>       <!-- chạy cuối cùng -->
```
> Nếu đặt `init.js` lên đầu → nó gọi `renderHeadcount()` chưa tồn tại → lỗi `undefined is not a function`.

Mỗi file JS bắt đầu bằng `'use strict';`.

### 5.4 — Bước 3: CSS theo design system (đừng tự chế màu)

> **Cập nhật quan trọng:** bản đầu mình làm **dark theme** (nền `#0d1117`, accent teal). Sau khi đối chiếu file
> mẫu **GHN Master Dashboard** (đẹp & chuẩn hơn cho dashboard phân tích nhiều section), mình **đổi sang GHN
> light theme** và đúc kết thành rule global [`analytics-dashboard.md`](C:/Users/ADMIN/.claude/rules/analytics-dashboard.md).
> Mô tả dưới đây là bản HIỆN TẠI (light).

GHN light theme — depth bằng **màu nền phân tầng** (3 lớp), không dùng shadow nặng:
- nền `#F4F5F7`, surface `#FFFFFF`, surface-2 `#FAFBFC`; viền `#E7EAEE`/`#EEF1F4`.
- chữ `#14213D` / `#4A5568` / `#94A3B8` (3 cấp); accent **cam GHN `#F26522`**.
- status theo NGƯỠNG (`statusOf()`): ok `#16A34A` / warn `#F59E0B` / danger `#DC2626` — KHÔNG tô màu tay.
- badge On-track / At-Risk / Off-track; KPI border-top màu chủ đề; scope-banner có divider line kéo hết hàng.

Class chuẩn: `.nav` (sidebar số TT + SVG icon), `.filterbar` (sticky), `.kpi-strip/.kpi`, `.panel-card`,
`.chart-wrap`, `.table-wrap`, `.insight-grid/.rec-grid` (Phân tích/Khuyến nghị), `.trend-strip`, `.rt-strip`,
`.rank-table`, `.heatmap`. Responsive: ≥1280 4 cột → ≤768 2 cột → ≤480 1 cột.

> **Các vòng fix dashboard sau khi redesign** (đều ghi chi tiết trong `processing.md` Phase 5c–5g):
> - **Filter ăn khớp grain data**: audit từng bảng có dimension nào (dept/level/time/gender) trước khi gắn filter;
>   data snapshot (lương) → banner "không theo kỳ"; section dept-only → banner "Cấp N/A".
> - **Bug donut "100% Cao"** khi lọc phòng: đọc sai nguồn (`risk.top` toàn high) → sửa đọc `bands_by_dept/level`.
> - **KPI = bảng phải khớp**: export đủ data (không chỉ mẫu 1 band) để filter ra đúng số.
> - **Quý đang chạy** (rate=null) loại khỏi KPI "gần nhất" — tránh "0% On-track" giả.
> - **Multi-series line**: chỉ fill area khi 1 series (nhiều series fill → mảng xám rối). **Bug hover "chart nhảy"**:
>   cache W/H, không đọc lại parent width khi `onmousemove`.
> - **Trend-strip** (đầu→cuối kỳ ±delta) + cột **Δ cùng kỳ** (YoY/QoQ) cho bảng có chiều thời gian.

### 5.5 — Bước 4: Vẽ canvas (`charts.js`) — phần intern hay sợ nhất

Canvas vẽ bằng tay (không dùng Chart.js để khỏi phụ thuộc external). Có **3 cái bẫy** phải nhớ:

**Bẫy 1 — màn hình retina làm chart mờ.** Phải nhân `devicePixelRatio` (dpr):
```js
const dpr = window.devicePixelRatio || 1;
canvas.width  = W * dpr;  canvas.height = H * dpr;     // buffer thật to gấp dpr lần
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';  // hiển thị kích thước CSS
ctx.scale(dpr, dpr);                                   // vẽ theo toạ độ CSS, sắc nét
```

**Bẫy 2 — đọc chiều rộng canvas khi DOM CHƯA render xong → ra 0.** Phải vẽ TRONG `requestAnimationFrame()`
SAU khi đã set `innerHTML`:
```js
panel.innerHTML = '<canvas id="hc-trend" height="220"></canvas>';
requestAnimationFrame(() => {            // đợi browser layout xong
  drawLine(document.getElementById('hc-trend'), labels, series);
});
```
Nếu gọi `drawLine` ngay sau `innerHTML` (không có rAF) → `getBoundingClientRect().width` = 0 → chart trống.

**Bẫy 3 — donut bị CSS `width:100%` kéo méo.** Donut cần kích thước CỐ ĐỊNH. Rule CSS:
```css
canvas { width: 100% !important; }                    /* bar/line fill ngang OK */
canvas.donut-canvas { width: auto !important; flex-shrink: 0; }  /* donut giữ cứng */
```

4 hàm vẽ đã viết: `drawLine` (trend headcount), `drawBars` (attrition rate, phân bố điểm — có value label trên
đỉnh cột), `drawDonut` (phân bố risk band — có % trên mỗi miếng), `drawFunnel` (phễu tuyển dụng).
Luôn `ctx.fillRect` nền `#0d1117` trước khi vẽ để tránh nền trắng mặc định.

### 5.6 — Bước 5: Render từng tab (`render.js`) — trái tim dashboard

Mỗi tab là 1 hàm `renderXxx()` làm đúng 3 việc:
1. **Lấy data** từ `DATA`, lọc theo filter phòng đang chọn: `applyDeptFilter(DATA.headcount)`.
2. **Tính KPI** (tổng, trung bình, % thay đổi so kỳ trước).
3. **Set `innerHTML`** (KPI cards + chart-card + bảng) rồi `requestAnimationFrame` → gọi hàm vẽ chart.

Ví dụ mạch tư duy tab Headcount:
- Lấy danh sách tháng `[...new Set(rows.map(r => r.year_month_key))].sort()`.
- HC hiện tại = sum headcount của tháng mới nhất; HC kỳ trước = tháng kế cuối → tính `delta %`.
- Vẽ line trend (nếu xem "tất cả" → 1 đường/phòng; nếu lọc 1 phòng → 1 đường tổng).
- Bảng chi tiết phòng×cấp + nút xuất CSV.

**Tab Attrition là tab "ăn tiền"** — gộp 2 nguồn:
- `mart_attrition` (lịch sử): attrition rate theo quý → vẽ bar.
- `attrition_scores` (dự báo ML): donut phân bố risk band + **bảng top high-risk kèm lý do SHAP** (3 chip
  tiếng Việt mỗi người). Đây là điểm phân biệt với dashboard HR thường — không chỉ "ai đã nghỉ" mà "ai SẮP nghỉ
  và VÌ SAO".

**Nút xuất CSV** — copy helper `downloadCSV()` từ `~/.claude/rules/export-data.md`, **bắt buộc có BOM UTF-8**
(`'﻿' + ...`) nếu không Excel mở tiếng Việt bị lỗi font. Mỗi tab 1 hàm `exportXxx()` chỉ xuất cột có nghĩa
nghiệp vụ, và **xuất đúng data đang lọc** (không dump toàn bộ).

### 5.7 — Bước 6: Khởi động + wire sự kiện (`init.js`)

File chạy cuối. Việc của nó:
1. Đổ danh sách phòng vào `<select>` filter.
2. Gắn sự kiện: click tab → `showTab()`; đổi `<select>` → đổi `STATE.dept` rồi render lại.
3. Lưu trạng thái vào URL hash (`#tab=attrition&dept=2`) để reload/chia sẻ giữ nguyên.
4. Gắn `resize` → vẽ lại chart (vì canvas cần đọc lại chiều rộng).
5. Gọi `showTab(STATE.tab)` lần đầu.

```js
(function init() {
  restoreState();                     // đọc URL hash
  // ... đổ <select>, wire click ...
  showTab(STATE.tab);                 // render lần đầu
})();
```

### 5.8 — Bước 7: Test KHÔNG cần mở trình duyệt (mẹo cho intern)

Mở trình duyệt bấm tay từng tab thì chậm và dễ sót. DE test bằng **Node + DOM giả** để bắt lỗi logic/tham chiếu
trước:

**(a) Check cú pháp từng file:**
```powershell
cd src\dashboard
node --check js/constants.js
node --check js/charts.js
node --check js/render.js
# ... 5/5 phải OK
```

**(b) Smoke test logic** — viết 1 script Node tạo `document`/`canvas` giả (stub), nạp data.js + các module,
rồi gọi thử cả 5 renderer + 5 export. Nếu chạy không ném lỗi nghĩa là tham chiếu data đúng, không gọi nhầm cột:
```
OK renderHeadcount / renderAttrition / ... (cả khi filter dept=Product)
OK exportHeadcount / exportRisk / ...
```
(canvas vẽ ra pixel không kiểm được bằng Node — phần đó để mắt người xem trên trình duyệt; nhưng *logic lấy data
và build HTML* thì Node bắt hết.)

**Tình huống thực gặp khi test bằng Node trên Windows:**
| Tình huống | Nguyên nhân | Xử lý |
|---|---|---|
| `const DATA` không thấy trong context | `const` ở top-level KHÔNG gắn vào object context của `vm` | đọc giá trị bằng `vm.runInContext('DATA', ctx)` thay vì `ctx.DATA` |
| Path `F:\05-...` lỗi `\x05` | `\0`/`\05` bị hiểu là escape trong chuỗi | dùng **forward slash** `F:/ChangPH-project/...` — Node chấp nhận trên Windows |

### 5.9 — Bước 8: Mở thật + chụp screenshot

```powershell
python src\dashboard\export_marts.py     # refresh data lần cuối
start src\dashboard\index.html           # mở bằng trình duyệt mặc định
```
Bấm qua 5 tab, đổi filter phòng, bấm xuất CSV thử. Chụp màn hình → `docs/screenshots/`.

### 5.10 — Kết quả Phase 5
- 5 tab chạy mượt, filter phòng áp cho cả 5 tab, URL hash giữ trạng thái.
- `node --check` 5/5 PASS; smoke test 5 renderer + 5 export PASS (cả "all" lẫn dept-filtered).
- Tab Attrition hiển thị 484 high-risk + lý do SHAP tiếng Việt.

### Lưu ý tổng cho intern khi làm dashboard tĩnh
1. **Khảo sát cột THẬT trước khi code** — đừng đoán tên cột.
2. **Tách file theo trách nhiệm**, không nhồi 1 file; nhớ thứ tự nạp script.
3. **3 bẫy canvas**: dpr (nét), requestAnimationFrame (đợi layout), donut giữ kích thước cứng.
4. **CSV phải có BOM UTF-8** + xuất đúng data đang lọc.
5. **Test bằng Node + DOM giả trước** khi mở trình duyệt — bắt lỗi logic nhanh hơn nhiều.
6. **Dữ liệu đổi → chạy lại `export_marts.py`** rồi refresh trang (data.js là snapshot, không live).

---

## Phase 6 — Airflow orchestration (tự động hoá pipeline)

> Mục tiêu: 5 phase trước đang chạy TAY từng script. Phase 6 dựng **Airflow DAG** để chuỗi tự chạy hàng ngày,
> có **quality gate**. File: `dags/hr_daily_pipeline.py`, `docker/Dockerfile.airflow`, compose service.

### 6.0 — Quyết định kiến trúc trước khi gõ

Câu hỏi đầu tiên: **Airflow chạy ở đâu?** Scripts hiện nối DB qua `localhost`. Hai lựa chọn:
1. Airflow standalone trên host → nối container DB qua localhost (nhanh, nhưng người clone về phải tự cài Airflow).
2. **Airflow trong Docker Compose** → self-contained, `docker compose up` là chạy. Đẹp portfolio. → **chọn (2)**.

Hệ quả của (2): trong container, `localhost` KHÔNG trỏ tới DB container. Phải **override host qua env**:
`MYSQL_HOST=mysql`, `POSTGRES_HOST=postgres` (service name), port nội bộ `5432`. Script vốn đọc host từ env
(default localhost) → **không cần sửa code**, chỉ set env trong compose.

**Quyết định scope DAG:** bắt đầu từ `ingest` (KHÔNG generate lại mỗi ngày) — đúng ETL thật: data sinh ở OLTP,
hàng ngày chỉ ingest phần MỚI (incremental theo watermark). Generate là việc thủ công 1 lần, giữ seed cố định.

### 6.1 — Dựng image + compose

1. **`docker/Dockerfile.airflow`**: base `apache/airflow:2.9.3-python3.11` + cài deps các script phase 2-5
   (psycopg2, mysql-connector, pandas, sklearn, xgboost, shap) + `dbt-core 1.7.19` + `dbt-mysql 1.7.0`.
2. **compose** thêm profile `airflow`: service `airflow_postgres` (metadata DB RIÊNG, tách OLTP) + `airflow`
   (LocalExecutor, `airflow standalone`). Mount `dags/ src/ hr_analytics/ dbt_profile/` vào container.
3. **`docker/dbt_profile/profiles.yml`**: profile container dùng `env_var('MYSQL_HOST','mysql')` thay vì 127.0.0.1
   (profile host ở `~/.dbt` vẫn dùng localhost — 2 profile cho 2 môi trường).

### 6.2 — DAG (`hr_daily_pipeline.py`)

```
ingest → dbt_run → dbt_test (QUALITY GATE) → ml_score → export_dashboard → attrition_alert
```
- 5 `BashOperator` gọi đúng script đã có (`load_to_mysql.py`, `dbt run/test`, `score_attrition.py`, `export_marts.py`).
- 1 `PythonOperator` `attrition_alert`: đọc `mart_attrition`, Slack-alert nếu rate quý gần nhất > ngưỡng
  (webhook trống → chỉ log, demo offline vẫn chạy).
- `schedule="0 6 * * *"`, `catchup=False`, `max_active_runs=1` (tránh 2 run đụng watermark).
- **Điểm cốt lõi:** `dbt_test` đứng giữa — fail → task sau **SKIP**, dashboard KHÔNG bị publish data lỗi.

### 6.3 — Lệnh

```bash
docker compose -f docker/docker-compose.yml --profile airflow up -d --build
# UI: http://localhost:8080 (admin/admin)
docker exec hr_airflow airflow dags trigger hr_daily_pipeline
```

### ⚠️ Tình huống thực gặp khi chạy THẬT → cách xử lý

| Tình huống | Triệu chứng | Xử lý |
|---|---|---|
| **pandas × SQLAlchemy conflict** | task `ml_score` fail: `'Engine'/'Connection' object has no attribute 'cursor'` | Airflow 2.9 buộc SQLAlchemy **<2.0**, nhưng pandas 2.2 **bỏ** hỗ trợ SQLAlchemy 1.4. Fix 2 lớp: (1) `build_features.py` dùng `with _engine().connect() as conn` (forward-compat); (2) Dockerfile **pin pandas 2.1.4**. Host vẫn 2.2.2 OK. |
| dbt không nối được MySQL trong container | connection refused | dùng service name `mysql` (không `127.0.0.1`) qua `env_var` trong profile container |
| init chạy lại mỗi lần up | tạo trùng admin user | `airflow users create ... || true` (bỏ qua lỗi nếu đã có) |

**Kết quả thực:** sau fix → trigger run → **6/6 task SUCCESS** (~1m17s). Alert log đúng:
"🔴 ATTRITION SPIKE — quý 2026-Q2: 12.5% (ngưỡng 10%)".

> **Bài học Phase 6:** version conflict giữa Airflow (SQLAlchemy<2.0) và data stack (pandas2.2 cần SA2.0) là
> loại bug HAY GẶP khi gộp 2 hệ vào 1 container. Cách giải: tìm bản pandas "cầu nối" (2.1.4) + viết code
> forward-compat (Connection thay Engine) để chạy được trên CẢ 2 môi trường.

---

## Phase 7 — CI/CD + Test automation

> Mục tiêu: mỗi lần đổi code, tự động **lint + test + chạy lại pipeline** để bắt regression. File:
> `tests/`, `.github/workflows/hr-analytics-ci.yml`, `ruff.toml`, `requirements-dev.txt`.

### 7.0 — Tư duy: test cái gì, ở tầng nào

Không test bừa. Chia theo "cần DB hay không" để CI nhanh:
- **Pure logic (không DB)** → unit test nhanh: hàm thuần của generator/ML/JS. Đây là phần chạy mỗi commit.
- **Integration (cần DB)** → đánh `@pytest.mark.db`, skip khi không có DB; CI dựng MySQL service để chạy.

Ưu tiên test **chính những bug đã fix** → biến chúng thành regression guard (không tái phát).

### 7.1 — Test viết ra

| File | Phủ | DB? |
|---|---|---|
| `tests/test_generator.py` (10) | salary_for, next_level, quarters_between, **clamp_events_to_exit** (guard bug "event sau exit") | ❌ |
| `tests/test_ml.py` (10) | feature_columns, _years_between, **_risk_band** (ngưỡng band), prepare_xy (one-hot) | ❌ |
| `tests/test_dag.py` (4) | DAG parse + đủ 6 task + thứ tự quality gate; load thật nếu có Airflow | ❌ |
| `tests/test_integration_db.py` (2) | build_features shape/label/no-leak, dept_rate ∈[0,1] | ✅ |
| `tests/js/test_helpers.mjs` (7) | statusOf, fmtPct, **deltaCell**, monthToQuarter (Node thuần, load global qua `vm`) | ❌ |

> **Lưu ý JS test:** file dashboard dùng global scope (không ES module). Load bằng `vm.runInContext`. Hàm
> `function` gắn vào context, nhưng `const` (STATUS_LABEL) thì KHÔNG → đọc qua `vm.runInContext('STATUS_LABEL', ctx)`.

### 7.2 — CI (`.github/workflows/hr-analytics-ci.yml`) — 2 job

1. **unit**: `ruff check` + `pytest -m "not db"` + coverage + JS test. Nhanh, không DB.
2. **integration**: dựng MySQL + Postgres **service** → seed schema → generate (1500 NV cho nhanh) → ingest →
   `dbt run` → **`dbt test` (quality gate)** → ML train+score → export → `pytest -m db`.
   = chạy lại TOÀN BỘ pipeline mỗi push, fail ở bất kỳ bước → CI đỏ.

### 7.3 — Lệnh local

```bash
pip install -r requirements-dev.txt
pytest -m "not db"               # unit nhanh (25 test)
pytest -m db                     # integration — cần MySQL đang chạy
node tests/js/test_helpers.mjs   # JS helper (7 test)
ruff check src dags tests        # lint
```

### Tình huống Phase 7 → xử lý

| Tình huống | Xử lý |
|---|---|
| ruff báo **E402** (14 lỗi) | import sau `sys.stdout.reconfigure(utf-8)` — BẮT BUỘC chạy trước trên Windows. KHÔNG sửa code, ignore qua `ruff.toml` |
| ruff F541/F401 | auto-fix `ruff check --fix` (an toàn) — bỏ f-string thừa + import không dùng |
| `const` JS không thấy trong `vm` context | đọc bằng `vm.runInContext('TÊN', ctx)` thay vì destructure |
| `prepare_xy` cột one-hot là `bool` | test assert "không còn cột object" thay vì "tất cả number" (bool OK cho XGBoost) |

**Kết quả thực:** ruff clean · pytest **25 passed + 1 skipped** (airflow-not-on-host) · JS **7 passed**.

> **Lưu ý:** repo hiện LOCAL (chưa có git remote). Workflow đã sẵn sàng — `git remote add` + `push` lên GitHub
> là CI chạy lần đầu.

---

## 6. Đánh giá & rút kinh nghiệm

### Logic tốt
- ✅ Phân tầng đúng chuẩn OLTP → warehouse → staging → core → mart — rõ, dễ debug.
- ✅ Watermark incremental idempotent thật.
- ✅ SCD2 đúng — point-in-time được.
- ✅ Point-in-time feature/label, chống leakage — phân biệt người làm ML nghiêm túc.
- ✅ SHAP per-employee top-3 driver — đúng nhu cầu HR ("vì sao").
- ✅ Sửa AUC bằng cách **sửa data, không tune bừa** — tư duy đúng.
- ✅ **Đánh giá độ tin cậy đa chiều** (review 2026-06-08): out-of-time + CV + baseline + calibration —
  không bán 1 con số AUC trần trụi (xem [Bước 6](#bước-6--đánh-giá-độ-tin-cậy-review-bổ-sung-2026-06-08)).
- ✅ **Orchestration có quality gate** (Phase 6): `dbt_test` fail → pipeline dừng, không publish data lỗi.
- ✅ **CI + regression guard** (Phase 7): test hoá chính các bug đã fix → không tái phát; CI chạy lại cả pipeline mỗi push.

### Logic cần cải thiện (cập nhật sau review độ tin cậy 2026-06-08)
- ⚠️ **Tín hiệu phần lớn tuyến tính** — LogReg baseline (AUC 0.733) còn nhỉnh hơn XGBoost (0.718). Giữ XGBoost vì
  SHAP per-employee, KHÔNG vì độ chính xác. Trung thực: đừng quảng cáo XGBoost như lợi thế chính xác.
- ⚠️ **risk_score chưa calibrated** (Brier 0.16, over-confident ~2× do `scale_pos_weight`). Đọc là **rank ưu tiên**,
  không phải xác suất. Fix nếu cần số thật: bọc `CalibratedClassifierCV` (Platt/Isotonic).
- ⚠️ **Precision class nghỉ ~0.33** (recall 0.50) — còn nhiều false positive. Chỉ để *triage*, KHÔNG ra quyết định
  tự động. Thêm feature `manager_change_count`, `days_since_last_promotion` để nâng (đã thiết kế, chưa đưa hết).
- ✅ **Nghi ngờ rò rỉ point-in-time (is_current) đã được điều tra & BÁC BỎ:** trên data thực, promotion không đổi
  dept/level (1,324 cặp version, 0 thay đổi) → rò rỉ = 0. Đổi lại phát hiện **bug `valid_to` của SCD2** (394 bản
  terminated có valid_to<valid_from) → ghi nhận fix ở dbt, KHÔNG ảnh hưởng feature ML (xem Bước 6.6).
- ✅ **`pd.read_sql` warning SQLAlchemy đã fix** — `build_features.py` dùng `create_engine` (pool, pre_ping).

### Rút kinh nghiệm
1. **Gắn tín hiệu nhân quả vào data TỪ ĐẦU** — đừng gen random rồi mới phát hiện model học không nổi (mất 1 vòng lặp).
2. **Sau regenerate → luôn `--full-load`**, không thì warehouse lệch âm thầm.
3. **Không tin 1 con số AUC** — phải có out-of-time + CV + baseline + calibration mới biết con số *đáng tin tới đâu*
   và *dùng vào việc gì* (rank vs xác suất vs quyết định tự động).
4. **Điều tra nghi ngờ bằng data thật trước khi "fix"** — nghi ngờ rò rỉ is_current hoá ra null; "fix" bằng valid_to
   lại gặp bug khác. Verify trước, sửa sau.
5. **Cập nhật doc ngay khi đổi số** — drift làm mất niềm tin vào con số (đã fix README + processing + journey).
6. **Đổi hướng kỹ thuật (Redshift→MySQL) phải dọn sạch dấu vết cũ** — đã làm tốt.

---

## 7. Báo cáo (stakeholder)

**Tổng quan:** Hệ thống HR analytics end-to-end chạy 100% local **hoàn thành 7/7 phase**. Pipeline data thô → kho
phân tích → mô hình chiều → dự đoán nghỉ việc → dashboard → **tự động hoá (Airflow) + CI/CD** — thông suốt, verify thật.

**Phát hiện chính:**
- 484 nhân viên (10.7% trong 4,519 active) ở nhóm **rủi ro nghỉ cao** — ưu tiên can thiệp.
- 3 yếu tố dự báo mạnh nhất: **điểm performance gần nhất thấp**, **lương lâu không tăng**, **phòng có tỷ lệ nghỉ cao**.
- Mô hình AUC-ROC 0.71, **đã kiểm chứng**: ổn định (CV 0.718±0.007) + generalize qua thời gian (out-of-time 0.695).
  Đủ để **xếp ưu tiên retention**, chưa đủ ra quyết định tự động.

**Rủi ro / vấn đề (độ tin cậy):**
- `risk_score` **chưa calibrated** (over-confident ~2×) → đọc là **điểm xếp hạng ưu tiên**, KHÔNG phải xác suất nghỉ.
- Precision class nghỉ ~0.33 → còn nhiều false positive; tín hiệu phần lớn tuyến tính (LogReg ≈ XGBoost).
- (Đã giải quyết) nghi ngờ rò rỉ point-in-time → điều tra cho thấy rò rỉ = 0; phát hiện bug `valid_to` của SCD2 (không ảnh hưởng ML).

**Khuyến nghị (còn lại để nâng cấp):**
1. HR review high-risk theo SHAP driver, ưu tiên "điểm thấp + lương đóng băng" — gặp 1:1, KHÔNG dùng cho quyết định sa thải/thăng tiến.
2. Bổ sung feature manager-change & promotion-staleness; cân nhắc calibrate (Platt/Isotonic) nếu cần báo xác suất thật.
3. ✅ (Đã fix Phase 4c) bug `valid_to` trong `dim_employee` — clamp event sau exit + test gác cổng `assert_dim_employee_valid_window`.

**Đã hoàn thành 7/7 phase** (1 OLTP → 2 ingest → 3 dbt → 4 ML → 5 dashboard → 6 Airflow → 7 CI/CD).

**Bước tiếp theo (mở rộng, ngoài scope core):** push lên GitHub để CI chạy cloud; hoặc nâng ML (MLflow + calibration),
data quality nâng cao (Great Expectations), hoặc API serving (FastAPI) — tuỳ định hướng portfolio.
