# src/dashboard — HTML Dashboard (Phase 5 ✅ DONE)

Static HTML dashboard 5 tab, không cần BI tool. Tuân thủ `html-build.md` (multi-file) + `design.md`
(dark theme `#0d1117`, accent teal `#5eead4` theo màu project 05 trong portfolio).

## Cấu trúc (multi-file)

```
src/dashboard/
├── export_marts.py   ← Query mart_* + attrition_scores từ MySQL → ghi js/data.js
├── index.html        ← skeleton: chỉ <link> + <script src>
├── style.css         ← toàn bộ CSS
└── js/
    ├── data.js       ← AUTO-GENERATED bởi export_marts.py (const DATA = {...})
    ├── constants.js  ← color map, formatter thuần (không DOM)
    ├── state.js      ← filter state + URL hash persistence
    ├── charts.js     ← canvas chart: line, bar, donut, funnel (DPR-aware)
    ├── render.js     ← render 5 tab + KPI + bảng + CSV export
    └── init.js       ← entry point: wire tab/filter, IIFE init
```

**Load order:** data → constants → state → charts → render → init.

## 5 tab
1. **Headcount** — KPI + trend line theo dept + bar dept/level + bảng (nguồn `mart_headcount`)
2. **Attrition** — attrition rate theo quý + donut risk band + **bảng top high-risk + lý do SHAP** (nguồn `mart_attrition` + `attrition_scores` Phase 4)
3. **Performance** — phân bố điểm + điểm TB theo phòng (nguồn `fct_performance`)
4. **Compensation** — median lương theo cấp + salary band p25/median/p75 (nguồn `mart_compensation`)
5. **Hiring** — funnel + tỷ lệ chuyển đổi + time-to-hire (nguồn `mart_hiring`)

Filter phòng ban áp dụng cho cả 5 tab. Mỗi bảng có nút **⬇ Xuất CSV** (BOM UTF-8).

## Cách chạy
```powershell
# 1. (sau khi dbt + ML đã chạy) refresh data từ MySQL
python src/dashboard/export_marts.py

# 2. mở dashboard — mở trực tiếp file, không cần server
start src/dashboard/index.html
```

> `data.js` dùng global scope (không ES module) để mở file trực tiếp không bị chặn CORS.
> Chạy lại `export_marts.py` mỗi khi mart hoặc `attrition_scores` cập nhật.
