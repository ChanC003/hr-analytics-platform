// Unit test helper thuần của dashboard (constants.js + state.js) — chạy bằng Node, không deps.
// Load file global-scope qua vm, lấy hàm ra rồi assert. Chạy: node tests/js/test_helpers.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS = path.resolve(__dirname, '../../src/dashboard/js');

// Sandbox global: nạp constants.js + state.js (state.js cần monthToQuarter ở scope chung)
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['constants.js', 'state.js']) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f });
}
// function-declarations gắn vào context; `const` (STATUS_LABEL) thì không -> đọc qua runInContext.
const { statusOf, fmtInt, fmtPct, fmtScore, fmtTenure,
        tenureGroupLabel, deltaCell, monthToQuarter } = ctx;
const STATUS_LABEL = vm.runInContext('STATUS_LABEL', ctx);

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// ── statusOf ──
t('statusOf attrition thresholds', () => {
  assert.equal(statusOf('attrition', 5), 'ok');
  assert.equal(statusOf('attrition', 8), 'warn');
  assert.equal(statusOf('attrition', 12), 'bad');
  assert.equal(statusOf('attrition', NaN), 'neutral');
});
t('statusOf perf thresholds', () => {
  assert.equal(statusOf('perf', 4.0), 'ok');
  assert.equal(statusOf('perf', 3.2), 'warn');
  assert.equal(statusOf('perf', 2.5), 'bad');
});
t('STATUS_LABEL map', () => {
  assert.equal(STATUS_LABEL.ok, 'On-track');
  assert.equal(STATUS_LABEL.bad, 'Off-track');
});

// ── formatters ──
t('fmtInt / fmtPct / fmtScore', () => {
  assert.equal(fmtInt(1234), '1,234');
  assert.equal(fmtInt(null), '–');
  assert.equal(fmtPct(12.345), '12.3%');
  assert.equal(fmtPct(12.345, 0), '12%');
  assert.equal(fmtScore(3.456), '3.46');
  assert.equal(fmtScore(NaN), '–');
});
t('fmtTenure / tenureGroupLabel', () => {
  assert.equal(fmtTenure(730), '2.0 năm');
  assert.equal(tenureGroupLabel(365), '< 2 năm');
  assert.equal(tenureGroupLabel(1000), '2–5 năm');
  assert.equal(tenureGroupLabel(2000), '> 5 năm');
});

// ── deltaCell ──
t('deltaCell up/down/flat + invertGood', () => {
  const up = deltaCell(120, 100, false);
  assert.ok(up.includes('delta-up') && up.includes('▲') && up.includes('+20'));
  // tăng nhưng invertGood (attrition) -> xấu (down màu đỏ)
  const bad = deltaCell(120, 100, true);
  assert.ok(bad.includes('delta-down'));
  // không có prev -> dash
  assert.ok(deltaCell(100, null, false).includes('–'));
  // flat
  assert.ok(deltaCell(100, 100, false).includes('delta-flat'));
});

// ── monthToQuarter (state.js) ──
t('monthToQuarter', () => {
  assert.equal(monthToQuarter('2025-01'), '2025-Q1');
  assert.equal(monthToQuarter('2025-06'), '2025-Q2');
  assert.equal(monthToQuarter('2025-12'), '2025-Q4');
});

if (process.exitCode) console.error(`\nJS helper tests: ${passed} passed, có FAIL.`);
else console.log(`JS helper tests: ${passed} passed.`);
