# Hướng dẫn Push GitHub + Public Dashboard

> Project 05 đứng **riêng làm 1 repo** (sạch, nhẹ ~9MB — không kéo theo 2.6GB data của project 02).
> Dashboard tĩnh (data.js generate sẵn) → public miễn phí qua **GitHub Pages**.

---

## Phần A — Push project lên GitHub (repo riêng)

### A1. Kiểm tra trước (an toàn)

```bash
cd F:\ChangPH-project\05-HR-Analytics-Platform

# .env thật (password) PHẢI bị ignore — lệnh này in ra dòng .gitignore khớp = OK
git check-ignore -v .env          # đã có: *.env / .env
git check-ignore -v .venv         # .venv/
git check-ignore -v src/ml/models/attrition_xgb.pkl   # *.pkl
```
> Nếu 3 lệnh trên đều in ra dòng → an toàn. data.js KHÔNG bị ignore (cần để dashboard chạy) — đúng.

### A2. Khởi tạo git repo RIÊNG cho project 05

```bash
cd F:\ChangPH-project\05-HR-Analytics-Platform

git init -b main                  # tạo repo mới, nhánh main
git add .
git status                        # KIỂM TRA: KHÔNG được thấy .env, .venv/, *.pkl, *.parquet
git commit -m "feat: HR Analytics Platform — 7/7 phase (OLTP→dbt→ML→dashboard→Airflow→CI)"
```
> ⚠️ Nếu `git status` thấy `.env` hoặc `.venv/` → DỪNG, kiểm tra lại `.gitignore`. Đừng commit secret.

### A3. Tạo repo trên GitHub + push

**Cách 1 — GitHub CLI (nhanh nhất, nếu có `gh`):**
```bash
gh auth login                     # đăng nhập 1 lần
gh repo create hr-analytics-platform --public --source=. --remote=origin --push
```

**Cách 2 — Thủ công (không cần gh):**
1. Vào https://github.com/new → tên repo `hr-analytics-platform`, để **Public**, KHÔNG tick "Add README"
   (vì repo local đã có sẵn) → Create repository.
2. GitHub hiện sẵn lệnh, chạy:
```bash
git remote add origin https://github.com/<USERNAME>/hr-analytics-platform.git
git push -u origin main
```
> Lần đầu push sẽ hỏi đăng nhập. Dùng **Personal Access Token** (Settings → Developer settings →
> Personal access tokens) làm password, không phải mật khẩu GitHub.

### A4. Sau khi push — CI tự chạy
- Repo có sẵn `.github/workflows/ci.yml` → push lên là **CI chạy ngay**: ruff + pytest + JS + (dbt/ML pipeline trên MySQL service).
- Xem tab **Actions** trên GitHub → 2 job `unit` + `integration` chạy. Xanh = pipeline reproduce trên cloud.
- Thêm badge vào README (đổi `<USERNAME>`):
  `![CI](https://github.com/<USERNAME>/hr-analytics-platform/actions/workflows/ci.yml/badge.svg)`

---

## Phần B — Public Dashboard qua GitHub Pages

Dashboard tĩnh (`src/dashboard/`) đọc `data.js` đã generate sẵn → **không cần DB**, chạy 100% tĩnh.
Repo đã có sẵn workflow `deploy-pages.yml` tự đẩy folder dashboard lên Pages.

### B1. Bật GitHub Pages

1. Repo trên GitHub → **Settings → Pages**.
2. Mục **Build and deployment → Source**: chọn **GitHub Actions** (KHÔNG phải "Deploy from a branch").
3. Xong. Lần push tiếp theo (hoặc chạy tay) workflow `deploy-pages` sẽ deploy.

### B2. Trigger deploy

```bash
# Tự chạy khi push đụng src/dashboard/**, hoặc chạy tay:
# GitHub → Actions → "Deploy Dashboard to GitHub Pages" → Run workflow
```
Hoặc đơn giản push 1 commit bất kỳ đụng dashboard.

### B3. Lấy link public

- Sau khi workflow `deploy-pages` xanh → vào **Settings → Pages** thấy link:
  `https://<USERNAME>.github.io/hr-analytics-platform/`
- Mở link → dashboard chạy luôn (2 tab, filter, chart — tất cả tĩnh).

### B4. Cập nhật data dashboard về sau

Dashboard public đọc `data.js` đã commit. Khi data đổi:
```bash
python src/dashboard/export_marts.py    # regenerate data.js từ MySQL (cần DB local chạy)
git add src/dashboard/js/data.js
git commit -m "chore: refresh dashboard data"
git push                                 # deploy-pages tự chạy lại
```

---

## Tóm tắt nhanh (TL;DR)

```bash
cd F:\ChangPH-project\05-HR-Analytics-Platform
git init -b main && git add . && git commit -m "feat: HR Analytics Platform 7/7 phase"
gh repo create hr-analytics-platform --public --source=. --push   # hoặc remote add + push thủ công
# → GitHub: Settings → Pages → Source = GitHub Actions
# → Link dashboard: https://<USERNAME>.github.io/hr-analytics-platform/
```

## Lưu ý

| Vấn đề | Xử lý |
|---|---|
| `.env` lỡ bị commit | `git rm --cached .env` + commit lại, ĐỔI password đã lộ |
| Pages 404 | đợi ~1-2 phút sau deploy; chắc chắn Source = "GitHub Actions" |
| data.js 2.6MB | OK với Pages (giới hạn 100MB/file, 1GB/site) |
| Model `.pkl` không lên git | đúng — dashboard KHÔNG cần model, chỉ cần data.js. `metrics.json` vẫn giữ để show |
| Repo nặng do `.git` cũ | đây là repo MỚI (`git init`), không dính lịch sử workspace 2.6GB |
