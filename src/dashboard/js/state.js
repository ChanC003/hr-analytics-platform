'use strict';

// ─── Global filter state ───
const STATE = {
  tab:   'status',
  dept:  'all',     // 'all' | department_id
  level: 'all',     // 'all' | level_id  (chỉ áp dụng Headcount / Compensation / risk)
  mStart: null,     // index tháng đầu trong DATA._months (set ở init)
  mEnd:   null,     // index tháng cuối
  gran:  'quarter', // 'month' | 'quarter' — granularity chart xu hướng
  hcGender: 'all',  // 'all' | 'female' | 'male' — chỉ section Headcount
  // tab ML
  riskBand:    'all', // 'all' | 'high' | 'medium' | 'low'
  tenureGroup: 'all', // 'all' | 'lt2' | '2to5' | 'gt5'
};

// ─────────────────────────────────────────────
// DERIVED TIME AXES — set 1 lần ở init từ DATA
// ─────────────────────────────────────────────
// Tháng "2023-01" → quý "2023-Q1"
function monthToQuarter(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
}

// Mảng tháng đang chọn theo range
function monthsInRange() {
  const all = DATA._months || [];
  const a = STATE.mStart == null ? 0 : STATE.mStart;
  const b = STATE.mEnd   == null ? all.length - 1 : STATE.mEnd;
  return all.slice(Math.min(a, b), Math.max(a, b) + 1);
}

// Set quý suy ra từ range tháng — dùng cho attrition / hiring
function quartersInRange() {
  return new Set(monthsInRange().map(monthToQuarter));
}

// ─────────────────────────────────────────────
// FILTER HELPERS
// ─────────────────────────────────────────────

// Lọc theo dept hiện tại (rows có department_id)
function applyDeptFilter(rows) {
  if (STATE.dept === 'all') return rows;
  const id = Number(STATE.dept);
  return rows.filter(r => Number(r.department_id) === id);
}

// Lọc theo dept + level (rows có department_id và level_id)
function applyDeptLevel(rows) {
  let out = applyDeptFilter(rows);
  if (STATE.level !== 'all') {
    const lid = Number(STATE.level);
    out = out.filter(r => Number(r.level_id) === lid);
  }
  return out;
}

// Lọc headcount theo range tháng (+ dept + level)
function filterHeadcount() {
  const months = new Set(monthsInRange());
  return applyDeptLevel(DATA.headcount).filter(r => months.has(r.year_month_key));
}

// Lọc attrition theo range quý (+ dept) — KHÔNG có level
function filterAttrition() {
  const qs = quartersInRange();
  return applyDeptFilter(DATA.attrition).filter(r => qs.has(r.exit_year_quarter));
}

// Lọc hiring theo range quý (+ dept)
function filterHiring() {
  const qs = quartersInRange();
  return applyDeptFilter(DATA.hiring).filter(r => qs.has(r.year_quarter));
}

// Lọc performance theo range quý (+ dept) — perf_dist / perf_by_dept có year_quarter
function filterPerfDist() {
  const qs = quartersInRange();
  return applyDeptFilter(DATA.perf_dist).filter(r => qs.has(r.year_quarter));
}
function filterPerfByDept() {
  const qs = quartersInRange();
  return applyDeptFilter(DATA.perf_by_dept).filter(r => qs.has(r.year_quarter));
}

// True nếu level filter đang bật nhưng section không hỗ trợ level (dept-only)
function levelNotApplicable() {
  return STATE.level !== 'all';
}

// ─────────────────────────────────────────────
// PERSISTENCE (URL hash)
// ─────────────────────────────────────────────
function persistState() {
  const p = [`tab=${STATE.tab}`, `dept=${STATE.dept}`, `level=${STATE.level}`,
    `gran=${STATE.gran}`, `g=${STATE.hcGender}`, `rb=${STATE.riskBand}`, `tg=${STATE.tenureGroup}`];
  if (STATE.mStart != null) p.push(`ms=${STATE.mStart}`);
  if (STATE.mEnd   != null) p.push(`me=${STATE.mEnd}`);
  location.hash = p.join('&');
}

function restoreState() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return;
  for (const part of h.split('&')) {
    const [k, v] = part.split('=');
    if (v == null) continue;
    if (k === 'tab')   STATE.tab = v;
    if (k === 'dept')  STATE.dept = v;
    if (k === 'level') STATE.level = v;
    if (k === 'gran')  STATE.gran = v;
    if (k === 'g')     STATE.hcGender = v;
    if (k === 'rb')    STATE.riskBand = v;
    if (k === 'tg')    STATE.tenureGroup = v;
    if (k === 'ms')    STATE.mStart = Number(v);
    if (k === 'me')    STATE.mEnd = Number(v);
  }
}
