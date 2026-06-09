'use strict';

// ─── GHN-aligned color palette ───
const C = {
  // Accent / brand
  accent:  '#F26522',   // GHN orange — primary accent
  blue:    '#00549A',   // GHN blue
  purple:  '#7A5AE0',   // purple series
  teal:    '#0E9488',   // teal series
  pink:    '#E0457B',   // pink series

  // Status
  ok:      '#16A34A',
  warn:    '#F59E0B',
  high:    '#DC2626',   // danger/high risk
  medium:  '#F59E0B',   // warn/medium
  low:     '#16A34A',   // ok/low risk

  // Backgrounds (for status)
  highBg:   'rgba(220,38,38,0.10)',
  mediumBg: 'rgba(245,158,11,0.10)',
  lowBg:    'rgba(22,163,74,0.10)',
};

// GHN-inspired series color palette
const SERIES_COLORS = [
  '#00549A',  // blue
  '#F26522',  // orange
  '#7A5AE0',  // purple
  '#0E9488',  // teal
  '#E0457B',  // pink
  '#16A34A',  // green
  '#F59E0B',  // amber
  '#C026D3',  // fuchsia
];

// Map risk_band -> {label, color, bg}
const RISK_BAND = {
  high:   { label: 'Cao',        color: '#DC2626', bg: 'rgba(220,38,38,0.10)' },
  medium: { label: 'Trung bình', color: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
  low:    { label: 'Thấp',       color: '#16A34A', bg: 'rgba(22,163,74,0.10)' },
};

// Thứ tự cấp bậc chuẩn — dùng để sort cột/chart theo level
const LEVEL_ORDER = ['Junior', 'Mid', 'Senior', 'Lead', 'Manager', 'Director'];

// Nhóm thâm niên (tab ML, dựa trên tenure_days)
const TENURE_GROUPS = {
  all:  { label: 'Tất cả thâm niên' },
  lt2:  { label: '< 2 năm',  test: d => d < 730 },
  '2to5': { label: '2 – 5 năm', test: d => d >= 730 && d < 1825 },
  gt5:  { label: '> 5 năm',  test: d => d >= 1825 },
};

// ─── Status thresholds (port từ GHN components) ───
// kind: 'attrition' (low-good), 'perf' (high-good), 'hire' (high-good), 'tth' (low-good), 'spread' (low-good)
function statusOf(kind, v) {
  if (v == null || isNaN(v)) return 'neutral';
  if (kind === 'attrition') return v <= 6 ? 'ok' : v <= 10 ? 'warn' : 'bad';   // %/quý
  if (kind === 'perf')      return v >= 3.5 ? 'ok' : v >= 3 ? 'warn' : 'bad';  // điểm 1–5
  if (kind === 'hire')      return v >= 5 ? 'ok' : v >= 3 ? 'warn' : 'bad';    // hire rate %
  if (kind === 'tth')       return v <= 30 ? 'ok' : v <= 35 ? 'warn' : 'bad';  // ngày
  if (kind === 'spread')    return v <= 60 ? 'ok' : v <= 80 ? 'warn' : 'bad';  // %
  if (kind === 'female')    return v >= 35 ? 'ok' : v >= 25 ? 'warn' : 'bad';  // % nữ
  return 'neutral';
}
const STATUS_LABEL = { ok: 'On-track', warn: 'At-Risk', bad: 'Off-track', neutral: '—' };
// Map status -> class badge GHN
const STATUS_CLS = { ok: 'badge-ok', warn: 'badge-warn', bad: 'badge-bad', neutral: 'badge-neutral' };

// ─── Helpers thuần (không DOM) ───
function fmtInt(n) {
  return (n == null || isNaN(n)) ? '–' : Math.round(n).toLocaleString('en-US');
}
function fmtMoney(n) {
  return (n == null || isNaN(n)) ? '–' : '$' + Math.round(n).toLocaleString('en-US');
}
function fmtPct(n, d) {
  return (n == null || isNaN(n)) ? '–' : Number(n).toFixed(d == null ? 1 : d) + '%';
}
function fmtScore(n) {
  return (n == null || isNaN(n)) ? '–' : Number(n).toFixed(2);
}
function deptColor(i) { return SERIES_COLORS[i % SERIES_COLORS.length]; }

// tenure_days -> "X.Y năm" + nhãn nhóm thâm niên
function fmtTenure(days) {
  if (days == null || isNaN(days)) return '–';
  return (days / 365.25).toFixed(1) + ' năm';
}
function tenureGroupLabel(days) {
  if (days == null || isNaN(days)) return '–';
  return days < 730 ? '< 2 năm' : days < 1825 ? '2–5 năm' : '> 5 năm';
}

// Cell delta "tăng/giảm cùng kỳ" — cur vs prev. invertGood=true: tăng là XẤU (vd attrition).
// Trả về HTML <span> màu + mũi tên + %; nếu không có prev -> "–".
function deltaCell(cur, prev, invertGood) {
  if (prev == null || isNaN(prev) || cur == null || isNaN(cur)) return '<span class="delta delta-flat">–</span>';
  const diff = cur - prev;
  const pct  = prev !== 0 ? diff / Math.abs(prev) * 100 : (diff !== 0 ? 100 : 0);
  const up   = diff > 0, flat = diff === 0;
  const good = flat ? null : (invertGood ? !up : up);
  const cls  = flat ? 'delta-flat' : good ? 'delta-up' : 'delta-down';
  const arrow = flat ? '→' : up ? '▲' : '▼';
  return `<span class="delta ${cls}" title="cùng kỳ: ${fmtInt(prev)}">${arrow} ${(diff >= 0 ? '+' : '') + fmtInt(diff)} (${(pct >= 0 ? '+' : '') + pct.toFixed(0)}%)</span>`;
}

// Gom rows theo key, sum 1 cột số
function sumBy(rows, keyFn, valFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    m.set(k, (m.get(k) || 0) + (valFn(r) || 0));
  }
  return m;
}
