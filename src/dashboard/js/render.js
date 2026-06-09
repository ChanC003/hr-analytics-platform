'use strict';

// ─── CSV export helper ───
function downloadCSV(rows, filename) {
  if (!rows || !rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const v = r[h] == null ? '' : String(r[h]);
      return v.includes(',') || v.includes('"') || v.includes('\n')
        ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(',')),
  ];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
const _today = () => new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────
// BUILDER HELPERS
// ─────────────────────────────────────────────

// KPI card kiểu GHN: label + badge + value + delta + note nhỏ
// badge: { text, cls } — 'badge-ok' | 'badge-risk' | 'badge-warn' | null
function kpiCard(label, value, delta, note, accentColor, badge) {
  const border = accentColor ? `style="border-top-color:${accentColor}"` : '';
  const badgeHtml = badge
    ? `<span class="kpi-badge ${badge.cls}">${badge.text}</span>` : '';
  return `<div class="kpi" ${border}>
    <div class="kpi-topline">
      <span class="kpi-label">${label}</span>
      ${badgeHtml}
    </div>
    <div class="kpi-value">${value}</div>
    ${delta ? `<div class="kpi-delta ${delta.cls || ''}">${delta.text}</div>` : ''}
    ${note ? `<div class="kpi-note">${note}</div>` : ''}
  </div>`;
}

function pageHead(title, sub) {
  return `<div class="page-head">
    <h2 class="page-title">${title}</h2>
    ${sub ? `<p class="page-question">${sub}</p>` : ''}
  </div>`;
}

// Scope banner — GHN style: icon box + orange tag + title + divider line
function divider(icon, title, sub) {
  return `<div class="scope-banner">
    <div class="scope-icon">${icon}</div>
    <div class="scope-body">
      <div class="scope-tag">HR Analytics</div>
      <div class="scope-title">${title}</div>
      ${sub ? `<div class="scope-sub">${sub}</div>` : ''}
    </div>
  </div>`;
}

function tblHead(text, exportId, note) {
  return `<div class="section-label-row">
    <div>
      <div class="section-label">${text}</div>
      ${note ? `<div class="section-note">${note}</div>` : ''}
    </div>
    ${exportId ? `<button class="export-btn" onclick="${exportId}()">⬇ Xuất CSV</button>` : ''}
  </div>`;
}

// HTML legend dưới chart
function chartLegend(series) {
  return `<div class="chart-legend">${series.map(s =>
    `<span class="chart-legend-item">
      <span class="legend-dot" style="background:${s.color}"></span>${s.label}
    </span>`).join('')}</div>`;
}

// Wrap canvas trong .chart-wrap để tooltip hoạt động
function chartWrap(canvasHtml) {
  return `<div class="chart-wrap">${canvasHtml}</div>`;
}

// Inline sparkline canvas (như GHN KPI card bottom)
function sparkId(id) {
  return `<div class="kpi-spark"><canvas id="${id}" height="40"></canvas></div>`;
}

// ─────────────────────────────────────────────
// PHÂN TÍCH (insight) + KHUYẾN NGHỊ — builder dùng chung
// insight: { kind:'alert'|'good'|'warn'|'info', title, body }  (body có thể chứa <b>)
// rec:     { prio:'high'|'mid'|'test', title, body }
// ─────────────────────────────────────────────
function insightSection(title, sub, cards) {
  const valid = cards.filter(Boolean);
  if (!valid.length) return '';
  return `${divider('🔍', title, sub)}
    <div class="insight-grid">${valid.map(c => `
      <div class="insight-card insight-${c.kind}">
        <div class="insight-title">${c.title}</div>
        <div class="insight-body">${c.body}</div>
      </div>`).join('')}</div>`;
}

const PRIO_LABEL = { high: 'Cao', mid: 'Trung bình', test: 'Thử nghiệm' };
function recSection(title, sub, recs) {
  const valid = recs.filter(Boolean);
  if (!valid.length) return '';
  return `${divider('🛠️', title, sub)}
    <div class="rec-grid">${valid.map(r => `
      <div class="rec-card rec-${r.prio}">
        <div class="rec-head">
          <span class="rec-title">${r.title}</span>
          <span class="rec-badge rec-badge-${r.prio}">${PRIO_LABEL[r.prio]}</span>
        </div>
        <div class="rec-body">${r.body}</div>
      </div>`).join('')}</div>`;
}

// ─────────────────────────────────────────────
// STATUS BADGE — chuẩn On-track / At-Risk / Off-track
// ─────────────────────────────────────────────
function statusBadge(kind, v) {
  const st = statusOf(kind, v);
  if (st === 'neutral') return '';
  return `<span class="kpi-badge ${STATUS_CLS[st]}">${STATUS_LABEL[st]}</span>`;
}

// ─────────────────────────────────────────────
// FILTER BAR — build per-tab, lọc thật
// ─────────────────────────────────────────────
function _months() { return DATA._months || []; }

function _selectHtml(id, label, value, options, disabled) {
  const opts = options.map(o =>
    `<option value="${o.v}" ${String(o.v) === String(value) ? 'selected' : ''}>${o.l}</option>`).join('');
  return `<label class="flt-select ${disabled ? 'disabled' : ''}">
    <span class="flt-label">${label}</span>
    <select id="${id}">${opts}</select>
  </label>`;
}

function buildFilterbar() {
  const bar = document.getElementById('filterbar');
  if (!bar) return;
  const months = _months();
  const a = STATE.mStart == null ? 0 : STATE.mStart;
  const b = STATE.mEnd   == null ? months.length - 1 : STATE.mEnd;
  const rangeTxt = months.length ? `${months[Math.min(a,b)]} – ${months[Math.max(a,b)]}` : '–';
  const nMonths = Math.abs(b - a) + 1;

  const deptOpts  = [{ v: 'all', l: 'Tất cả phòng' },
    ...DATA.departments.map(d => ({ v: d.department_id, l: d.department_name }))];
  const levelOpts = [{ v: 'all', l: 'Tất cả cấp' },
    ...(DATA.levels || []).map(l => ({ v: l.level_id, l: l.level_name }))];

  const calIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>`;
  const chevron = `<svg class="flt-chevron" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;

  let html = `
    <div class="flt-range-pick" id="flt-range-pick">
      <button class="flt-range-btn" id="flt-range-btn">
        ${calIcon}<span>${rangeTxt} · <strong>${nMonths} tháng</strong></span>${chevron}
      </button>
      <div class="range-pop" id="flt-range-pop" style="display:none">
        <div class="range-presets">
          ${[12, 24, months.length].map(d => {
            const active = nMonths === d && Math.max(a,b) === months.length - 1;
            return `<button class="range-preset ${active ? 'active' : ''}" data-preset="${d}">${d >= months.length ? 'Tất cả' : d + ' tháng'}</button>`;
          }).join('')}
        </div>
        <div class="range-inputs">
          <label class="range-input"><span>Từ</span>
            <input type="month" id="flt-month-start" value="${months[Math.min(a,b)] || ''}"
              min="${months[0] || ''}" max="${months[Math.max(a,b)] || ''}"></label>
          <span class="range-arrow">→</span>
          <label class="range-input"><span>Đến</span>
            <input type="month" id="flt-month-end" value="${months[Math.max(a,b)] || ''}"
              min="${months[Math.min(a,b)] || ''}" max="${months[months.length - 1] || ''}"></label>
        </div>
      </div>
    </div>
    <div class="segmented" id="flt-gran">
      <button class="seg-btn ${STATE.gran === 'month' ? 'active' : ''}" data-gran="month">Tháng</button>
      <button class="seg-btn ${STATE.gran === 'quarter' ? 'active' : ''}" data-gran="quarter">Quý</button>
    </div>
    <div class="flt-spacer"></div>
    ${_selectHtml('flt-dept', 'Phòng', STATE.dept, deptOpts)}
    ${_selectHtml('flt-level', 'Cấp', STATE.level, levelOpts)}`;

  if (STATE.tab === 'status') {
    html += _selectHtml('flt-gender', 'Giới tính', STATE.hcGender, [
      { v: 'all', l: 'Tất cả' }, { v: 'female', l: 'Nữ' }, { v: 'male', l: 'Nam' }]);
  } else {
    html += _selectHtml('flt-riskband', 'Mức rủi ro', STATE.riskBand, [
      { v: 'all', l: 'Tất cả' }, { v: 'high', l: 'Cao' }, { v: 'medium', l: 'Trung bình' }, { v: 'low', l: 'Thấp' }]);
    html += _selectHtml('flt-tenure', 'Thâm niên', STATE.tenureGroup,
      Object.entries(TENURE_GROUPS).map(([v, o]) => ({ v, l: o.label })));
  }

  bar.innerHTML = html;
  _wireFilterbar();
}

function _wireFilterbar() {
  const months = _months();
  const reRender = () => { persistState(); RENDERERS[STATE.tab](); };

  // date range popover
  const btn = document.getElementById('flt-range-btn');
  const pop = document.getElementById('flt-range-pop');
  const chev = btn && btn.querySelector('.flt-chevron');
  if (btn && pop) {
    btn.onclick = e => { e.stopPropagation();
      const open = pop.style.display === 'block';
      pop.style.display = open ? 'none' : 'block';
      if (chev) chev.classList.toggle('up', !open);
    };
    document.addEventListener('click', e => {
      if (!document.getElementById('flt-range-pick')?.contains(e.target)) {
        pop.style.display = 'none'; if (chev) chev.classList.remove('up');
      }
    });
  }
  document.querySelectorAll('#flt-range-pop [data-preset]').forEach(b => {
    b.onclick = () => {
      const d = Number(b.dataset.preset);
      STATE.mEnd = months.length - 1;
      STATE.mStart = Math.max(0, months.length - d);
      reRender();
    };
  });
  const ms = document.getElementById('flt-month-start');
  const me = document.getElementById('flt-month-end');
  if (ms) ms.onchange = () => { const i = months.indexOf(ms.value); if (i >= 0) { STATE.mStart = i; reRender(); } };
  if (me) me.onchange = () => { const i = months.indexOf(me.value); if (i >= 0) { STATE.mEnd = i; reRender(); } };

  // granularity
  document.querySelectorAll('#flt-gran [data-gran]').forEach(b => {
    b.onclick = () => { STATE.gran = b.dataset.gran; reRender(); };
  });

  // selects
  const bind = (id, key) => { const el = document.getElementById(id);
    if (el) el.onchange = () => { STATE[key] = el.value; reRender(); }; };
  bind('flt-dept', 'dept');
  bind('flt-level', 'level');
  bind('flt-gender', 'hcGender');
  bind('flt-riskband', 'riskBand');
  bind('flt-tenure', 'tenureGroup');
}

// ════════════════════════════════════════════════════════════════════
// TAB 1 — BÁO CÁO THỰC TRẠNG
// ════════════════════════════════════════════════════════════════════
function renderStatus() {
  buildFilterbar();
  const dn      = deptName();
  const isAll   = STATE.dept === 'all';
  const months  = monthsInRange();
  const latest  = months[months.length - 1];
  const prev    = months[months.length - 2];
  const lvlNA   = levelNotApplicable();
  const naBanner = `<div class="na-banner">⚠️ Filter <b>Cấp bậc</b> không áp dụng cho section này (dữ liệu chỉ theo phòng ban).</div>`;

  // ── Headcount (lọc dept + level + range tháng) ──
  const hcRows = filterHeadcount();
  const hcAt   = mk => hcRows.filter(r => r.year_month_key === mk).reduce((a, r) => a + r.headcount, 0);
  const curHC  = hcAt(latest), prevHC = hcAt(prev);
  const deltaHC = prevHC ? (curHC - prevHC) / prevHC * 100 : 0;
  const latestRows = hcRows.filter(r => r.year_month_key === latest);
  const femaleL = latestRows.reduce((a, r) => a + r.headcount_female, 0);
  const maleL   = latestRows.reduce((a, r) => a + r.headcount_male, 0);
  const pctF    = curHC ? femaleL / curHC * 100 : 0;
  const avgTen  = avgWeighted(latestRows, 'avg_tenure_years', 'headcount');

  // ── Attrition (lọc dept + range quý) ──
  const atRows   = filterAttrition();
  const quarters = [...new Set(atRows.map(r => r.exit_year_quarter))].sort();
  const totalEx  = atRows.reduce((a, r) => a + r.exits_total, 0);
  const totalVol = atRows.reduce((a, r) => a + r.exits_voluntary, 0);
  const volPct   = totalEx ? totalVol / totalEx * 100 : 0;
  // chỉ tính trên quý hoàn chỉnh (loại quý hiện tại rate=null)
  const compQ    = completedQuarters(atRows);
  const compRowsAt = atRows.filter(r => compQ.includes(r.exit_year_quarter)
    && r.attrition_rate_pct != null && !isNaN(r.attrition_rate_pct));
  const avgRate  = avgPlain(compRowsAt, 'attrition_rate_pct');
  const { rate: latestRate, quarter: latestQ } = latestCompletedRate(atRows);
  // Đánh giá tăng/giảm attrition rate: quý hoàn chỉnh đầu → cuối
  const atRateOf = q => { const rs = atRows.filter(r => r.exit_year_quarter === q && r.attrition_rate_pct != null && !isNaN(r.attrition_rate_pct)); return rs.length ? rs.reduce((a, r) => a + r.attrition_rate_pct, 0) / rs.length : null; };
  const firstQ = compQ[0], lastCompQ = compQ[compQ.length - 1];
  const atStart = firstQ ? atRateOf(firstQ) : null, atEnd = lastCompQ ? atRateOf(lastCompQ) : null;
  const atDelta = (atStart != null && atEnd != null) ? atEnd - atStart : null;
  // attrition TĂNG là XẤU → màu đảo (tăng = đỏ)
  const atTrendCls = atDelta == null ? 'kpi-delta-flat' : atDelta > 0 ? 'kpi-delta-down' : atDelta < 0 ? 'kpi-delta-up' : 'kpi-delta-flat';
  const atTrendArrow = atDelta == null ? '→' : atDelta > 0 ? '▲' : atDelta < 0 ? '▼' : '→';

  // ── Performance (dept + range quý; KHÔNG có level) ──
  // perf_dist/perf_by_dept có year_quarter → lọc theo range quý cho khớp filter.
  const distRows = filterPerfDist();
  const distMap  = sumBy(distRows, r => r.score_bucket, r => r.cnt);
  const dist     = [...distMap.keys()].sort((a, b) => a - b).map(b => ({ score_bucket: b, cnt: distMap.get(b) }));
  // Re-aggregate avg_score theo phòng (weighted = Σsum_score / Σn_reviews) trên range quý
  const pbdRaw   = filterPerfByDept();
  const byDeptMap = new Map();
  pbdRaw.forEach(r => {
    const c = byDeptMap.get(r.department_name) || { department_id: r.department_id, sum: 0, n: 0 };
    c.sum += r.sum_score; c.n += r.n_reviews; byDeptMap.set(r.department_name, c);
  });
  // cnt_low (<3) / cnt_high (≥4) theo phòng từ distRows (đã lọc range quý)
  const lowHighByDept = new Map();
  distRows.forEach(r => {
    const c = lowHighByDept.get(r.department_id) || { low: 0, high: 0 };
    if (r.score_bucket < 3) c.low += r.cnt;
    if (r.score_bucket >= 4) c.high += r.cnt;
    lowHighByDept.set(r.department_id, c);
  });
  const byDept = [...byDeptMap.entries()].map(([department_name, v]) => {
    const lh = lowHighByDept.get(v.department_id) || { low: 0, high: 0 };
    return {
      department_name, department_id: v.department_id,
      avg_score: v.n ? +(v.sum / v.n).toFixed(2) : 0, n_reviews: v.n,
      cnt_low: lh.low, cnt_high: lh.high,
    };
  });
  const totalRev = dist.reduce((a, r) => a + r.cnt, 0);
  const wAvg     = dist.reduce((a, r) => a + r.score_bucket * r.cnt, 0) / Math.max(1, totalRev);
  const lowCnt   = dist.filter(r => r.score_bucket < 3).reduce((a, r) => a + r.cnt, 0);
  const highCnt  = dist.filter(r => r.score_bucket >= 4).reduce((a, r) => a + r.cnt, 0);
  const lowPct   = totalRev ? lowCnt / totalRev * 100 : 0;

  // ── Compensation (dept + level) ──
  const compRows  = applyDeptLevel(DATA.compensation);
  const totalEmp  = compRows.reduce((a, r) => a + r.employee_count, 0);
  const avgMedian = avgWeighted(compRows, 'salary_median', 'employee_count');
  const maxSpread = compRows.length ? Math.max(...compRows.map(r => r.salary_spread_pct)) : 0;
  const spreadBand = compRows.length ? compRows.reduce((a, b) => b.salary_spread_pct > a.salary_spread_pct ? b : a) : null;

  // ── Hiring (dept-only, range quý) ──
  const hirRows = filterHiring();
  const hSum    = c => hirRows.reduce((a, r) => a + (r[c] || 0), 0);
  const applied = hSum('cnt_applied'), hired = hSum('cnt_hired');
  const reqs    = hSum('total_requisitions');
  const hireRate = applied ? hired / applied * 100 : 0;
  const avgTtH   = avgWeighted(hirRows.filter(r => r.cnt_hired > 0), 'avg_days_to_hire', 'cnt_hired');

  const genderTag = STATE.hcGender === 'female' ? ' · chỉ Nữ' : STATE.hcGender === 'male' ? ' · chỉ Nam' : '';
  const granLabel = STATE.gran === 'month' ? 'tháng' : 'quý';

  // ── Đánh giá tăng/giảm HC qua kỳ lọc (đầu → cuối + tốc độ TB/kỳ) ──
  const hcCol = STATE.hcGender === 'female' ? 'headcount_female' : STATE.hcGender === 'male' ? 'headcount_male' : 'headcount';
  const hcAtCol = mk => hcRows.filter(r => r.year_month_key === mk).reduce((a, r) => a + (r[hcCol] || 0), 0);
  const firstM = months[0];
  const hcStart = hcAtCol(firstM), hcEnd = hcAtCol(latest);
  const hcChg = hcEnd - hcStart;
  const hcChgPct = hcStart ? hcChg / hcStart * 100 : 0;
  // số kỳ theo gran để tính tốc độ trung bình mỗi kỳ
  const nPeriods = STATE.gran === 'month' ? Math.max(1, months.length - 1)
                                          : Math.max(1, quartersInRange().size - 1);
  const avgPerPeriod = hcChg / nPeriods;
  const trendCls = hcChg > 0 ? 'kpi-delta-up' : hcChg < 0 ? 'kpi-delta-down' : 'kpi-delta-flat';
  const trendArrow = hcChg > 0 ? '▲' : hcChg < 0 ? '▼' : '→';

  // Kỳ so sánh cùng kỳ năm trước cho bảng HC chi tiết = tháng (latest − 12)
  const cmpMonth = (() => {
    const [y, m] = latest.split('-').map(Number);
    return `${y - 1}-${String(m).padStart(2, '0')}`;
  })();
  const hcPrevRows = applyDeptLevel(DATA.headcount).filter(r => r.year_month_key === cmpMonth);
  const hcPrevMap = new Map(hcPrevRows.map(r => [`${r.department_id}|${r.level_id}`, r.headcount]));
  const hasCmp = hcPrevRows.length > 0;
  // Nhãn range quý (cho Performance/Attrition/Hiring — các section theo quý)
  const qSorted  = [...quartersInRange()].sort();
  const qCount   = qSorted.length;
  const qLabel   = qSorted.length ? `${qSorted[0]} → ${qSorted[qSorted.length - 1]}` : '–';

  // Legend cho trend headcount (theo gran)
  const hcSeriesLegend = isAll
    ? DATA.departments.map((d, i) => ({ label: d.department_name, color: deptColor(i) }))
    : [{ label: deptNameRaw(), color: C.accent }];
  const compLevelLegend = [...new Map(compRows.map((r, i) => [r.level_name, deptColor(i)])).entries()]
    .map(([label, color]) => ({ label, color }));

  // ── PHÂN TÍCH (insight động theo filter) ──
  const scope = isAll ? 'toàn công ty' : `phòng ${deptNameRaw()}`;
  // phòng attrition cao nhất trong kỳ
  const atByDeptIns = new Map();
  DATA.attrition.filter(r => quartersInRange().has(r.exit_year_quarter)
    && r.attrition_rate_pct != null && !isNaN(r.attrition_rate_pct)).forEach(r => {
    const c = atByDeptIns.get(r.department_name) || { sum: 0, n: 0 };
    c.sum += r.attrition_rate_pct; c.n++; atByDeptIns.set(r.department_name, c);
  });
  const atRankIns = [...atByDeptIns.entries()].map(([n, v]) => ({ n, r: v.n ? v.sum / v.n : 0 })).sort((a, b) => b.r - a.r);
  const topAtDept = atRankIns[0];
  const worstSpread = spreadBand;

  const insights = [
    {
      kind: avgRate > 8 ? 'alert' : avgRate > 6 ? 'warn' : 'good',
      title: avgRate > 8 ? '⚠️ Attrition vượt ngưỡng' : '✅ Attrition trong tầm kiểm soát',
      body: `Tỷ lệ nghỉ TB <b>${fmtPct(avgRate)}/quý</b> (${scope}, kỳ ${qLabel}). ` +
            (avgRate > 8 ? `Vượt benchmark 8% — cần can thiệp.` : `Dưới benchmark 8% — duy trì.`) +
            (isAll && topAtDept ? ` Cao nhất: <b>${topAtDept.n}</b> (${fmtPct(topAtDept.r)}).` : ''),
    },
    {
      kind: lowPct > 25 ? 'alert' : lowPct > 15 ? 'warn' : 'good',
      title: '📊 Chất lượng Performance',
      body: `<b>${fmtPct(lowPct)}</b> review điểm thấp (<3) · điểm TB <b>${fmtScore(wAvg)}/5</b>. ` +
            (lowPct > 25 ? `Trên 25% → cần PIP/đào tạo diện rộng.` :
             wAvg >= 3.5 ? `Mặt bằng tốt, trên kỳ vọng 3.5.` : `Ổn nhưng dưới kỳ vọng 3.5.`),
    },
    {
      kind: volPct > 70 ? 'warn' : 'info',
      title: '🚪 Cơ cấu nghỉ việc',
      body: `<b>${fmtPct(volPct)}</b> là nghỉ tự nguyện (${fmtInt(totalVol)}/${fmtInt(totalEx)}). ` +
            (volPct > 70 ? `Voluntary cao → dấu hiệu môi trường/lương cạnh tranh kém.` :
             `Tỷ lệ voluntary/involuntary cân đối.`),
    },
    worstSpread && worstSpread.salary_spread_pct > 60 ? {
      kind: 'warn',
      title: '💰 Bất công lương trong band',
      body: `Spread lớn nhất <b>${fmtPct(worstSpread.salary_spread_pct)}</b> ở ` +
            `<b>${worstSpread.department_name} / ${worstSpread.level_name}</b> (>60%). ` +
            `Cùng cấp bậc nhưng chênh lệch lương rộng — rà soát công bằng nội bộ.`,
    } : {
      kind: 'good', title: '💰 Lương trong band hợp lý',
      body: `Spread cao nhất <b>${fmtPct(maxSpread)}</b> (≤60%) — phân bổ lương đồng đều trong band.`,
    },
    {
      kind: avgTtH > 35 ? 'warn' : 'good',
      title: '🎯 Hiệu quả tuyển dụng',
      body: `Hire rate <b>${fmtPct(hireRate)}</b> · Time-to-hire <b>${fmtScore(avgTtH)} ngày</b>. ` +
            (avgTtH > 35 ? `Quy trình dài (>35d) — tối ưu các bước screening/interview.` :
             `Tốc độ tuyển trong ngưỡng (≤35d).`),
    },
  ];

  // ── KHUYẾN NGHỊ VẬN HÀNH (action động) ──
  const recs = [
    avgRate > 8 ? {
      prio: 'high', title: 'Stay-interview nhóm phòng attrition cao',
      body: (isAll && topAtDept ? `Ưu tiên phòng <b>${topAtDept.n}</b> (${fmtPct(topAtDept.r)}/quý). ` : '') +
            `Phỏng vấn giữ chân, tìm nguyên nhân gốc trước khi nhân viên nộp đơn.`,
    } : null,
    lowPct > 25 ? {
      prio: 'high', title: 'Triển khai PIP cho nhóm điểm thấp',
      body: `${fmtInt(lowCnt)} review < 3 điểm. Lập kế hoạch cải thiện hiệu suất + mentor 1:1 trong quý tới.`,
    } : null,
    (worstSpread && worstSpread.salary_spread_pct > 60) ? {
      prio: 'mid', title: 'Rà soát công bằng lương theo band',
      body: `Bắt đầu từ <b>${worstSpread.department_name}/${worstSpread.level_name}</b> (spread ${fmtPct(worstSpread.salary_spread_pct)}). ` +
            `Đối chiếu P25/P75 với năng lực thực tế.`,
    } : null,
    avgTtH > 35 ? {
      prio: 'mid', title: 'Rút ngắn Time-to-hire',
      body: `Hiện ${fmtScore(avgTtH)} ngày. Đặt SLA mỗi stage, dùng pre-screening để giảm vòng phỏng vấn.`,
    } : null,
    pctF < 35 ? {
      prio: 'test', title: 'Chương trình tăng đa dạng giới',
      body: `Tỷ lệ nữ ${fmtPct(pctF)} (<35%). Thử pilot tuyển dụng hướng đa dạng ở 1-2 phòng.`,
    } : null,
  ].filter(Boolean);
  // luôn có ít nhất 1 khuyến nghị tích cực nếu mọi thứ ổn
  if (!recs.length) recs.push({
    prio: 'test', title: 'Duy trì & theo dõi định kỳ',
    body: `Các chỉ số trong ngưỡng lành mạnh. Tiếp tục pulse-survey hằng quý để bắt sớm tín hiệu xấu.`,
  });

  document.getElementById('panel-status').innerHTML = `<div class="panel-content">
    ${pageHead('Báo cáo thực trạng nhân sự' + dn,
      `Kỳ ${months[0]} → ${latest} · ${months.length} tháng · gran: ${granLabel}`)}

    <!-- ══ HEADCOUNT ══ -->
    ${divider('👥', 'Headcount', `Snapshot cuối kỳ lọc: ${latest}${dn}${genderTag}`)}
    <div class="kpi-strip" style="--kpi-cols:4">
      ${kpiCard('Headcount hiện tại', fmtInt(STATE.hcGender === 'female' ? femaleL : STATE.hcGender === 'male' ? maleL : curHC),
        null, `Kỳ: ${latest} · nguồn mart_headcount${genderTag}`, '#0E9488')}
      ${kpiCard('Thay đổi kỳ trước', (deltaHC >= 0 ? '+' : '') + fmtPct(deltaHC, 1),
        { text: (deltaHC >= 0 ? '▲' : '▼') + ' ' + fmtInt(Math.abs(curHC - prevHC)) + ' người vs ' + (prev || '–'),
          cls: deltaHC >= 0 ? 'kpi-delta-up' : 'kpi-delta-down' },
        `= (HC_kỳ_mới − HC_kỳ_trước) / HC_kỳ_trước × 100`,
        deltaHC >= 0 ? '#16A34A' : '#DC2626',
        deltaHC >= 0 ? { text: 'Tăng', cls: 'badge-ok' } : { text: 'Giảm', cls: 'badge-risk' })}
      ${kpiCard('Tỷ lệ nữ', fmtPct(pctF),
        { text: fmtInt(femaleL) + ' / ' + fmtInt(curHC) + ' người', cls: pctF < 35 ? 'kpi-delta-down' : 'kpi-delta-up' },
        `= NV nữ / tổng HC × 100 · Benchmark lành mạnh ≥ 35%`, '#00549A',
        { text: STATUS_LABEL[statusOf('female', pctF)], cls: STATUS_CLS[statusOf('female', pctF)] })}
      ${kpiCard('Thâm niên TB', fmtScore(avgTen) + ' năm',
        { text: 'weighted theo headcount', cls: 'kpi-delta-flat' },
        `= Σ(thâm_niên × HC) / Σ HC`, '#7A5AE0')}
    </div>
    <div class="grid">
      <div class="panel-card span-7">
        <div class="panel-title">Xu hướng Headcount theo ${granLabel}${dn}</div>
        <div class="panel-sub-title">Tổng nhân viên active cuối mỗi ${granLabel} · ${isAll ? 'tách theo phòng ban' : 'phòng ' + deptNameRaw()}</div>
        <div class="trend-strip">
          <span class="trend-item"><span class="trend-lbl">${firstM}</span><b>${fmtInt(hcStart)}</b></span>
          <span class="trend-arrow">→</span>
          <span class="trend-item"><span class="trend-lbl">${latest}</span><b>${fmtInt(hcEnd)}</b></span>
          <span class="trend-delta ${trendCls}">${trendArrow} ${(hcChg >= 0 ? '+' : '') + fmtInt(hcChg)} người (${(hcChgPct >= 0 ? '+' : '') + fmtPct(hcChgPct, 1)})</span>
          <span class="trend-rate">TB ${(avgPerPeriod >= 0 ? '+' : '') + fmtScore(avgPerPeriod)} người/${granLabel}</span>
        </div>
        ${chartWrap('<canvas id="hc-trend" height="180"></canvas>')}
        ${chartLegend(hcSeriesLegend)}
      </div>
      <div class="panel-card span-5">
        <div class="panel-title">${isAll && STATE.hcGender === 'all' ? 'HC theo phòng (Nam/Nữ)' : 'HC theo cấp bậc'} — ${latest}</div>
        <div class="panel-sub-title">Phân bố headcount kỳ mới nhất${genderTag}</div>
        ${chartWrap('<canvas id="hc-second" height="180"></canvas>')}
        <div id="hc-second-legend"></div>
      </div>
    </div>
    ${tblHead('Chi tiết Headcount theo Phòng × Cấp — ' + latest, 'exportHeadcount',
      `Snapshot cuối tháng · HC = NV active · Δ cùng kỳ = ${hasCmp ? 'so với ' + cmpMonth + ' (năm trước)' : 'không đủ dữ liệu năm trước'}`)}
    <div class="table-wrap">${hcTable(latestRows, hasCmp ? hcPrevMap : null, hasCmp ? cmpMonth : null)}</div>

    <!-- ══ ATTRITION ══ -->
    ${divider('📉', 'Attrition — Tỷ lệ nghỉ việc', `Biến động nhân sự${dn} · ${quarters.length} quý`)}
    ${lvlNA ? naBanner : ''}
    <div class="kpi-strip" style="--kpi-cols:4">
      ${kpiCard('Tổng nghỉ việc', fmtInt(totalEx),
        { text: `${quarters.length} quý trong kỳ lọc`, cls: 'kpi-delta-flat' },
        `Gồm voluntary (chủ động) + involuntary (sa thải/hết HĐ)`, '#DC2626')}
      ${kpiCard('Attrition rate TB', fmtPct(avgRate),
        { text: 'trung bình theo quý', cls: avgRate > 8 ? 'kpi-delta-down' : 'kpi-delta-up' },
        `= exits / HC đầu quý × 100 · Benchmark ≤ 8%/quý`, '#F59E0B',
        { text: STATUS_LABEL[statusOf('attrition', avgRate)], cls: STATUS_CLS[statusOf('attrition', avgRate)] })}
      ${kpiCard('% Nghỉ tự nguyện', fmtPct(volPct),
        { text: fmtInt(totalVol) + ' / ' + fmtInt(totalEx) + ' exits', cls: 'kpi-delta-flat' },
        `Voluntary cao (>70%) = dấu hiệu môi trường / lương kém`, '#00549A')}
      ${kpiCard('Rate quý gần nhất', fmtPct(latestRate),
        { text: (latestQ || '–') + ' · quý đã chốt', cls: latestRate > 8 ? 'kpi-delta-down' : 'kpi-delta-up' },
        `Quý hoàn chỉnh gần nhất (loại quý đang chạy) · Ngưỡng > 8%/quý`, latestRate > 8 ? '#DC2626' : '#16A34A',
        { text: STATUS_LABEL[statusOf('attrition', latestRate)], cls: STATUS_CLS[statusOf('attrition', latestRate)] })}
    </div>
    <div class="grid">
      <div class="panel-card span-7">
        <div class="panel-title">Cơ cấu nghỉ việc theo quý${dn}</div>
        <div class="panel-sub-title">Stacked: Voluntary (chủ động) vs Involuntary (công ty) · tổng trên đỉnh cột</div>
        ${atStart != null && atEnd != null ? `<div class="trend-strip">
          <span class="trend-item"><span class="trend-lbl">${firstQ}</span><b>${fmtPct(atStart)}</b></span>
          <span class="trend-arrow">→</span>
          <span class="trend-item"><span class="trend-lbl">${lastCompQ}</span><b>${fmtPct(atEnd)}</b></span>
          <span class="trend-delta ${atTrendCls}">${atTrendArrow} ${(atDelta >= 0 ? '+' : '') + fmtPct(atDelta, 1)} điểm${atDelta > 0 ? ' (xấu đi)' : atDelta < 0 ? ' (cải thiện)' : ''}</span>
          <span class="trend-rate">rate nghỉ việc đầu→cuối kỳ (quý chốt)</span>
        </div>` : ''}
        ${chartWrap('<canvas id="at-stack" height="190"></canvas>')}
        ${chartLegend([
          { label: 'Voluntary — chủ động', color: '#F59E0B' },
          { label: 'Involuntary — công ty', color: '#94A3B8' },
        ])}
      </div>
      <div class="panel-card span-5">
        <div class="panel-title">Top phòng attrition cao nhất</div>
        <div class="panel-sub-title">Tỷ lệ nghỉ TB theo phòng · trong kỳ lọc</div>
        <div id="at-rank"></div>
      </div>
    </div>
    ${tblHead('Chi tiết Attrition theo Phòng × Quý', 'exportAttrition',
      'Attrition rate = exits / headcount_start × 100 · Voluntary = NV chủ động · Involuntary = công ty chủ động')}
    <div class="table-wrap">${attritionTable(atRows)}</div>

    <!-- ══ PERFORMANCE ══ -->
    ${divider('🏆', 'Performance — Đánh giá hiệu suất', `Điểm review ${qLabel}${dn}`)}
    ${lvlNA ? naBanner : ''}
    <div class="kpi-strip" style="--kpi-cols:4">
      ${kpiCard('Tổng lượt review', fmtInt(totalRev),
        { text: `${qCount} quý trong kỳ lọc`, cls: 'kpi-delta-flat' }, `Review trong kỳ đã lọc · 1 lần / chu kỳ`, '#0E9488')}
      ${kpiCard('Điểm trung bình', fmtScore(wAvg) + ' / 5',
        { text: wAvg >= 3.5 ? '▲ Trên kỳ vọng' : '▼ Dưới kỳ vọng', cls: wAvg >= 3.5 ? 'kpi-delta-up' : 'kpi-delta-down' },
        `= Σ(điểm × số_review) / tổng · Kỳ vọng ≥ 3.5`, '#00549A',
        { text: STATUS_LABEL[statusOf('perf', wAvg)], cls: STATUS_CLS[statusOf('perf', wAvg)] })}
      ${kpiCard('Điểm thấp < 3', fmtPct(lowPct),
        { text: fmtInt(lowCnt) + ' review cần cải thiện', cls: lowPct > 25 ? 'kpi-delta-down' : 'kpi-delta-flat' },
        `Ngưỡng cảnh báo > 25% · Cần PIP / đào tạo`, '#F59E0B',
        lowPct > 25 ? { text: 'At-Risk', cls: 'badge-warn' } : null)}
      ${kpiCard('Điểm cao ≥ 4', fmtPct(totalRev ? highCnt / totalRev * 100 : 0),
        { text: fmtInt(highCnt) + ' review xuất sắc', cls: 'kpi-delta-up' },
        `Top performer · Xem xét retain + reward`, '#16A34A', { text: 'Top talent', cls: 'badge-ok' })}
    </div>
    <div class="grid">
      <div class="panel-card span-6">
        <div class="panel-title">Phân bố điểm Performance${dn}</div>
        <div class="panel-sub-title">Số lượt review theo mức điểm (1.0 – 5.0) · ${qLabel}</div>
        ${chartWrap('<canvas id="pf-dist" height="165"></canvas>')}
        ${chartLegend([
          { label: '1–2: Cần cải thiện', color: '#DC2626' },
          { label: '3: Đạt yêu cầu', color: '#F59E0B' },
          { label: '4: Tốt', color: '#16A34A' },
          { label: '5: Xuất sắc', color: '#0E9488' },
        ])}
      </div>
      <div class="panel-card span-6">
        <div class="panel-title">Điểm TB theo phòng ban</div>
        <div class="panel-sub-title">Average score giữa các phòng · weighted theo số review · ${qLabel}</div>
        ${chartWrap('<canvas id="pf-dept" height="165"></canvas>')}
        ${chartLegend(byDept.map((r, i) => ({ label: r.department_name, color: deptColor(i) })))}
      </div>
    </div>
    ${tblHead('Chi tiết Performance theo Phòng ban', null,
      `avg_score = TB điểm review (weighted) · cnt_low = điểm < 3 · cnt_high = điểm ≥ 4 · kỳ ${qLabel}`)}
    <div class="table-wrap">${perfTable(byDept)}</div>

    <!-- ══ COMPENSATION ══ -->
    ${divider('💰', 'Compensation — Benchmark lương', `P25 · Median · P75 theo band${dn} · 📸 snapshot hiện tại (không theo kỳ)`)}
    <div class="na-banner" style="background:var(--blue-bg, #E8F2FB);border-color:rgba(0,84,154,.3);color:#00549A">
      ℹ️ Lương là <b>snapshot hiện tại</b> — filter <b>tháng/quý không áp</b> cho section này (chỉ có 1 bản lương mới nhất / nhân viên). Filter Phòng & Cấp vẫn áp dụng.
    </div>
    <div class="kpi-strip" style="--kpi-cols:4">
      ${kpiCard('NV có dữ liệu lương', fmtInt(totalEmp),
        { text: 'đang active', cls: 'kpi-delta-flat' }, `NV full-time có bản ghi lương`, '#0E9488')}
      ${kpiCard('Median lương TB', fmtMoney(avgMedian),
        { text: 'weighted by headcount', cls: 'kpi-delta-flat' },
        `= Σ(median × HC) / Σ HC · ít bị outliers`, '#00549A')}
      ${kpiCard('Số salary band', fmtInt(compRows.length),
        { text: 'tổ hợp phòng × cấp', cls: 'kpi-delta-flat' }, `Mỗi band = 1 phòng × 1 level`, '#7A5AE0')}
      ${kpiCard('Spread cao nhất', fmtPct(maxSpread),
        { text: spreadBand ? spreadBand.department_name + ' / ' + spreadBand.level_name : '–',
          cls: maxSpread > 60 ? 'kpi-delta-down' : 'kpi-delta-flat' },
        `Spread = (P75−P25)/Median×100 · > 60% = chênh lệch lớn`, maxSpread > 60 ? '#F59E0B' : '#16A34A',
        { text: STATUS_LABEL[statusOf('spread', maxSpread)], cls: STATUS_CLS[statusOf('spread', maxSpread)] })}
    </div>
    <div class="grid">
      <div class="panel-card span-7">
        <div class="panel-title">Median lương theo cấp bậc${dn}</div>
        <div class="panel-sub-title">Lương trung vị theo cấp · weighted by headcount</div>
        ${chartWrap('<canvas id="cp-level" height="160"></canvas>')}
        ${chartLegend(compLevelLegend)}
      </div>
      <div class="panel-card span-5">
        <div class="panel-title">Top phòng theo median lương</div>
        <div class="panel-sub-title">Median weighted theo headcount · trong bộ lọc</div>
        <div id="cp-rank"></div>
      </div>
    </div>
    ${tblHead('Salary Band theo Phòng × Cấp', 'exportComp',
      'P25/P75 = percentile 25/75 · Spread = (P75−P25)/Median×100 · phát hiện lương bất công cùng band')}
    <div class="table-wrap">${compTable(compRows)}</div>

    <!-- ══ HIRING ══ -->
    ${divider('🎯', 'Hiring — Tuyển dụng', `Funnel · Conversion · Time-to-hire${dn}`)}
    ${lvlNA ? naBanner : ''}
    <div class="kpi-strip" style="--kpi-cols:4">
      ${kpiCard('Vị trí tuyển (Req)', fmtInt(reqs),
        { text: 'requisitions mở', cls: 'kpi-delta-flat' }, `YC tuyển dụng được phê duyệt`, '#0E9488')}
      ${kpiCard('Ứng viên apply', fmtInt(applied),
        { text: 'đã vào funnel', cls: 'kpi-delta-flat' }, `Tổng CV nhận được`, '#00549A')}
      ${kpiCard('Đã tuyển được', fmtInt(hired),
        { text: 'Hire rate: ' + fmtPct(hireRate), cls: hireRate > 5 ? 'kpi-delta-up' : 'kpi-delta-flat' },
        `Hire rate = Hired / Applied × 100 · Benchmark ~5–10%`, '#16A34A',
        { text: STATUS_LABEL[statusOf('hire', hireRate)], cls: STATUS_CLS[statusOf('hire', hireRate)] })}
      ${kpiCard('Time-to-hire TB', fmtScore(avgTtH) + ' ngày',
        { text: avgTtH > 35 ? '⚠️ quy trình dài' : '✓ trong ngưỡng', cls: avgTtH > 35 ? 'kpi-delta-down' : 'kpi-delta-up' },
        `Từ mở req → ký offer · Benchmark ≤ 30 ngày`, avgTtH > 35 ? '#F59E0B' : '#16A34A',
        { text: STATUS_LABEL[statusOf('tth', avgTtH)], cls: STATUS_CLS[statusOf('tth', avgTtH)] })}
    </div>
    <div class="grid">
      <div class="panel-card span-5">
        <div class="panel-title">Hiring Funnel${dn}</div>
        <div class="panel-sub-title">Số ứng viên qua từng bước · % conversion</div>
        ${chartWrap('<canvas id="hr-funnel" height="200"></canvas>')}
        ${chartLegend([
          {label:'Applied',color:SERIES_COLORS[0]},{label:'Screening',color:SERIES_COLORS[1]},
          {label:'Interview',color:SERIES_COLORS[2]},{label:'Offer',color:SERIES_COLORS[3]},{label:'Hired',color:SERIES_COLORS[4]},
        ])}
      </div>
      <div class="panel-card span-7">
        <div class="panel-title">Số tuyển được theo quý${dn}</div>
        <div class="panel-sub-title">Hired mỗi quý trong kỳ lọc · xu hướng tuyển dụng</div>
        ${chartWrap('<canvas id="hr-trend" height="200"></canvas>')}
        ${chartLegend([{ label: 'Đã tuyển (Hired)', color: '#16A34A' }])}
      </div>
    </div>
    ${tblHead('Chi tiết Hiring theo Quý × Phòng', 'exportHiring',
      'Applied · Offer · Hired · Hire% · Time-to-hire theo từng phòng')}
    <div class="table-wrap" style="max-height:300px">${hiringTable(hirRows)}</div>

    <!-- ══ PHÂN TÍCH ══ -->
    ${insightSection('Phân tích', `Nhận định tự động theo ${scope} · kỳ ${qLabel}`, insights)}

    <!-- ══ KHUYẾN NGHỊ VẬN HÀNH ══ -->
    ${recSection('Khuyến nghị vận hành', `Hành động ưu tiên cho ${scope}`, recs)}
  </div>`;

  // ── Draw charts ──
  requestAnimationFrame(() => {
    // Headcount trend — theo gran (tháng/quý)
    const axis = STATE.gran === 'month' ? months : [...quartersInRange()].sort();
    const hcByKey = (key, deptName) => {
      let rows = hcRows;
      if (deptName) rows = rows.filter(r => r.department_name === deptName);
      if (STATE.gran === 'month') return rows.filter(r => r.year_month_key === key).reduce((a, r) => a + r.headcount, 0);
      // quarter: lấy tháng cuối của quý đó (snapshot)
      const qMonths = months.filter(m => monthToQuarter(m) === key);
      const lastM = qMonths[qMonths.length - 1];
      return lastM ? rows.filter(r => r.year_month_key === lastM).reduce((a, r) => a + r.headcount, 0) : 0;
    };
    const seriesHC = isAll
      ? DATA.departments.map((d, i) => ({ label: d.department_name, color: deptColor(i),
          points: axis.map(k => ({ x: k, y: hcByKey(k, d.department_name) })) }))
      : [{ label: deptNameRaw(), color: C.accent, points: axis.map(k => ({ x: k, y: hcByKey(k) })) }];
    drawLine(document.getElementById('hc-trend'),
      axis.map(k => STATE.gran === 'month' ? k.slice(2) : k.replace('-Q', ' Q')), seriesHC);

    // HC second — stacked Nam/Nữ theo phòng (khi all & gender=all), else bar theo cấp
    const hcSecondEl = document.getElementById('hc-second');
    const legendEl = document.getElementById('hc-second-legend');
    if (isAll && STATE.hcGender === 'all') {
      const deptNames = [...new Set(latestRows.map(r => r.department_name))];
      drawStackedBars(hcSecondEl, deptNames, [
        { name: 'Nữ', color: '#E0457B', data: deptNames.map(d => latestRows.filter(r => r.department_name === d).reduce((a, r) => a + r.headcount_female, 0)) },
        { name: 'Nam', color: '#00549A', data: deptNames.map(d => latestRows.filter(r => r.department_name === d).reduce((a, r) => a + r.headcount_male, 0)) },
      ]);
      if (legendEl) legendEl.innerHTML = chartLegend([{ label: 'Nữ', color: '#E0457B' }, { label: 'Nam', color: '#00549A' }]);
    } else {
      const grp = groupSum(latestRows, isAll ? 'department_name' : 'level_name',
        STATE.hcGender === 'female' ? 'headcount_female' : STATE.hcGender === 'male' ? 'headcount_male' : 'headcount');
      const keys = [...grp.keys()]; const cols = keys.map((_, i) => deptColor(i));
      drawBars(hcSecondEl, keys, [...grp.values()], C.accent, null, cols);
      if (legendEl) legendEl.innerHTML = chartLegend(keys.map((k, i) => ({ label: k, color: cols[i] })));
    }

    // Attrition — stacked vol/invol theo quý
    drawStackedBars(document.getElementById('at-stack'),
      quarters.map(q => q.replace('-Q', ' Q')), [
        { name: 'Voluntary', color: '#F59E0B', data: quarters.map(q => atRows.filter(r => r.exit_year_quarter === q).reduce((a, r) => a + r.exits_voluntary, 0)) },
        { name: 'Involuntary', color: '#94A3B8', data: quarters.map(q => atRows.filter(r => r.exit_year_quarter === q).reduce((a, r) => a + r.exits_involuntary, 0)) },
      ]);
    // Attrition rank — top phòng theo rate TB (luôn xét tất cả phòng để so sánh)
    const atByDept = new Map();
    const qSet = quartersInRange();
    DATA.attrition.filter(r => qSet.has(r.exit_year_quarter)
      && r.attrition_rate_pct != null && !isNaN(r.attrition_rate_pct)).forEach(r => {
      const cur = atByDept.get(r.department_name) || { sum: 0, n: 0 };
      cur.sum += r.attrition_rate_pct; cur.n++; atByDept.set(r.department_name, cur);
    });
    const atRank = [...atByDept.entries()].map(([name, v]) => ({ name, value: v.n ? v.sum / v.n : 0 }))
      .sort((a, b) => b.value - a.value)
      .map(r => ({ ...r, color: r.value > 10 ? '#DC2626' : r.value > 6 ? '#F59E0B' : '#16A34A',
        sub: fmtPct(r.value) + '/quý' }));
    renderRankTable(document.getElementById('at-rank'), atRank, { fmt: v => fmtPct(v) });

    // Performance bars
    const perfColors = dist.map(r => r.score_bucket < 3 ? '#DC2626' : r.score_bucket < 4 ? '#F59E0B' : r.score_bucket < 5 ? '#16A34A' : '#0E9488');
    drawBars(document.getElementById('pf-dist'), dist.map(r => r.score_bucket.toFixed(1)), dist.map(r => r.cnt), '#F59E0B', null, perfColors);
    drawBars(document.getElementById('pf-dept'), byDept.map(r => r.department_name), byDept.map(r => r.avg_score),
      C.accent, fmtScore, byDept.map((_, i) => deptColor(i)));

    // Compensation median by level + rank theo phòng
    const byLvl = new Map();
    compRows.forEach(r => { const c = byLvl.get(r.level_name) || { sum: 0, n: 0 }; c.sum += r.salary_median * r.employee_count; c.n += r.employee_count; byLvl.set(r.level_name, c); });
    const lvlLabels = LEVEL_ORDER.filter(l => byLvl.has(l));
    drawBars(document.getElementById('cp-level'), lvlLabels,
      lvlLabels.map(k => { const v = byLvl.get(k); return v.n ? v.sum / v.n : 0; }),
      C.accent, fmtMoney, lvlLabels.map((_, i) => deptColor(i)));
    const compByDept = new Map();
    compRows.forEach(r => { const c = compByDept.get(r.department_name) || { sum: 0, n: 0 }; c.sum += r.salary_median * r.employee_count; c.n += r.employee_count; compByDept.set(r.department_name, c); });
    const cpRank = [...compByDept.entries()].map(([name, v]) => ({ name, value: v.n ? v.sum / v.n : 0, color: C.blue }))
      .sort((a, b) => b.value - a.value);
    renderRankTable(document.getElementById('cp-rank'), cpRank, { fmt: fmtMoney });

    // Hiring funnel + quarterly hired trend
    drawFunnel(document.getElementById('hr-funnel'), [
      { label: 'Applied', value: hSum('cnt_applied') }, { label: 'Screening', value: hSum('cnt_screening') },
      { label: 'Interview', value: hSum('cnt_interview') }, { label: 'Offer', value: hSum('cnt_offer') },
      { label: 'Hired', value: hSum('cnt_hired') },
    ]);
    const hq = [...new Set(hirRows.map(r => r.year_quarter))].sort();
    drawBars(document.getElementById('hr-trend'), hq.map(q => q.replace('-Q', ' Q')),
      hq.map(q => hirRows.filter(r => r.year_quarter === q).reduce((a, r) => a + r.cnt_hired, 0)),
      '#16A34A', fmtInt);
  });
}

// ════════════════════════════════════════════════════════════════════
// TAB 2 — ML · DỰ BÁO
// ════════════════════════════════════════════════════════════════════
function renderML() {
  buildFilterbar();
  const risk = DATA.risk;
  const dn   = deptName();
  const isAll = STATE.dept === 'all';

  // ── Phân bố band — đọc theo CẢ dept + level (FIX: trước donut không ăn filter Cấp) ──
  // Nguồn theo tổ hợp filter hiện tại: toàn bộ NV được score (không phải chỉ top 100).
  //   all            -> risk.bands
  //   dept           -> risk.bands_by_dept
  //   level          -> risk.bands_by_level
  //   dept + level   -> risk.bands_by_dept_level
  const hasLevel = STATE.level !== 'all';
  const bandCnt = band => {
    let src, match;
    if (isAll && !hasLevel) {
      src = risk.bands;
      match = z => z.risk_band === band;
    } else if (!isAll && !hasLevel) {
      src = risk.bands_by_dept;
      match = z => Number(z.department_id) === Number(STATE.dept) && z.risk_band === band;
    } else if (isAll && hasLevel) {
      src = risk.bands_by_level;
      match = z => Number(z.level_id) === Number(STATE.level) && z.risk_band === band;
    } else {
      src = risk.bands_by_dept_level;
      match = z => Number(z.department_id) === Number(STATE.dept)
                && Number(z.level_id) === Number(STATE.level) && z.risk_band === band;
    }
    const x = (src || []).find(match);
    return x ? x.cnt : 0;
  };
  const high = bandCnt('high'), med = bandCnt('medium'), low = bandCnt('low');
  const total = high + med + low;

  // ── Bảng top risk — lọc dept + level + tenure + riskBand ──
  let topRisk = risk.top;
  if (!isAll) topRisk = topRisk.filter(r => Number(r.department_id) === Number(STATE.dept));
  if (STATE.level !== 'all') topRisk = topRisk.filter(r => Number(r.level_id) === Number(STATE.level));
  if (STATE.riskBand !== 'all') topRisk = topRisk.filter(r => r.risk_band === STATE.riskBand);
  if (STATE.tenureGroup !== 'all') {
    const t = TENURE_GROUPS[STATE.tenureGroup];
    if (t && t.test) topRisk = topRisk.filter(r => t.test(r.tenure_days || 0));
  }
  const topDriver = mostCommonDriver(topRisk);

  const atRows = applyDeptFilter(DATA.attrition);
  // quý hoàn chỉnh gần nhất (loại quý đang chạy có rate=null → tránh hiện 0.0% giả "On-track")
  const { rate: latestRate, quarter: latestQ } = latestCompletedRate(atRows);

  const riskSegs = [
    { label: 'Cao',        value: high, color: '#DC2626' },
    { label: 'Trung bình', value: med,  color: '#F59E0B' },
    { label: 'Thấp',       value: low,  color: '#16A34A' },
  ];
  const pctHigh = total ? high / total * 100 : 0;
  const scope = isAll ? 'toàn công ty' : `phòng ${deptNameRaw()}`;

  // Phòng/cấp tập trung rủi ro cao nhất (từ bands_by_dept_level)
  const hiConc = (risk.bands_by_dept_level || [])
    .filter(r => r.risk_band === 'high'
      && (isAll || Number(r.department_id) === Number(STATE.dept))
      && (STATE.level === 'all' || Number(r.level_id) === Number(STATE.level)))
    .sort((a, b) => b.cnt - a.cnt)[0];

  // ── PHÂN TÍCH (ML) ──
  const mlInsights = [
    {
      kind: pctHigh > 12 ? 'alert' : pctHigh > 8 ? 'warn' : 'good',
      title: '⚠️ Quy mô nhóm rủi ro cao',
      body: `<b>${fmtInt(high)}</b> NV rủi ro CAO (${fmtPct(pctHigh)} của ${fmtInt(total)} được chấm điểm, ${scope}). ` +
            (pctHigh > 12 ? `Tỷ lệ cao — cần kế hoạch retention ngay.` : `Trong ngưỡng quản lý được.`),
    },
    hiConc ? {
      kind: 'warn', title: '🎯 Điểm nóng rủi ro',
      body: `Tập trung cao nhất: <b>${hiConc.department_name} / ${hiConc.level_name}</b> ` +
            `(<b>${fmtInt(hiConc.cnt)}</b> NV rủi ro cao). Ưu tiên gặp nhóm này trước.`,
    } : null,
    {
      kind: 'info', title: '🧭 Lý do nghỉ phổ biến (SHAP)',
      body: `Driver hàng đầu trong nhóm lọc: <b>${topDriver}</b>. ` +
            `Cùng với điểm review thấp & lương lâu không tăng — đây là 3 đòn bẩy can thiệp chính.`,
    },
    {
      kind: 'info', title: '📐 Cách đọc risk_score',
      body: `risk_score là <b>điểm xếp hạng ưu tiên</b>, KHÔNG phải xác suất tuyệt đối ` +
            `(model over-confident ~2× do scale_pos_weight). Dùng để chọn ai gặp trước, không để ra quyết định tự động.`,
    },
  ];

  const mlRecs = [
    high > 0 ? {
      prio: 'high', title: 'Retention 1:1 cho nhóm rủi ro cao',
      body: `${fmtInt(high)} NV (${scope}). Quản lý trực tiếp gặp trong 2 tuần, ` +
            (hiConc ? `bắt đầu từ <b>${hiConc.department_name}/${hiConc.level_name}</b>. ` : '') +
            `Tập trung driver "${topDriver}".`,
    } : null,
    med > 0 ? {
      prio: 'mid', title: 'Check-in định kỳ nhóm trung bình',
      body: `${fmtInt(med)} NV rủi ro trung bình — pulse-survey hằng tháng + rà soát lộ trình thăng tiến để chặn trượt lên nhóm cao.`,
    } : null,
    {
      prio: 'test', title: 'Calibrate model nếu cần báo xác suất',
      body: `Hiện risk_score chỉ để rank. Nếu HR cần con số xác suất thật → bọc CalibratedClassifierCV (Platt/Isotonic) + thêm feature manager-change.`,
    },
  ].filter(Boolean);

  document.getElementById('panel-ml').innerHTML = `<div class="panel-content">
    ${pageHead('ML · Dự báo Attrition' + dn,
      'XGBoost + SHAP · AUC-ROC 0.71 (OOT 0.70 · CV 0.72±0.01) — Dự báo nguy cơ nghỉ trong 180 ngày')}

    <!-- RealtimeStrip-style band KPI -->
    <div class="rt-strip">
      <div class="rt-head">
        <span class="rt-dot"></span>
        <span class="rt-title">ML Scoring</span>
        <span class="rt-updated">scored ${risk.scored_at || '–'} · ${fmtInt(total)} NV được chấm điểm${dn}</span>
      </div>
      <div class="rt-items" style="--rt-cols:4">
        <div class="rt-item alert">
          <div class="rt-val">${fmtInt(high)}</div>
          <div class="rt-label">Rủi ro CAO</div>
          <div class="rt-sub">${fmtPct(pctHigh)} nhóm · P(nghỉ) > 70%</div>
        </div>
        <div class="rt-item">
          <div class="rt-val">${fmtInt(med)}</div>
          <div class="rt-label">Rủi ro TRUNG BÌNH</div>
          <div class="rt-sub">${fmtPct(total ? med / total * 100 : 0)} · P(nghỉ) 40–70%</div>
        </div>
        <div class="rt-item">
          <div class="rt-val">${fmtInt(low)}</div>
          <div class="rt-label">Rủi ro THẤP</div>
          <div class="rt-sub">${fmtPct(total ? low / total * 100 : 0)} · P(nghỉ) < 40%</div>
        </div>
        <div class="rt-item">
          <div class="rt-val">${fmtPct(latestRate)}</div>
          <div class="rt-label">Attrition thực tế</div>
          <div class="rt-sub">${(latestQ || '–')} (quý chốt) · ${STATUS_LABEL[statusOf('attrition', latestRate)]}</div>
        </div>
      </div>
    </div>

    <div class="ml-insight-row">
      <div class="ml-insight-card ml-high">
        <div class="ml-insight-title">⚠️ Nhóm rủi ro cao${dn}</div>
        <div class="ml-insight-body">
          <b>${fmtInt(high)}</b> nhân viên (${fmtPct(pctHigh)} nhóm được chấm) có nguy cơ nghỉ trong 180 ngày.<br>
          Lý do SHAP phổ biến nhất: <b>${topDriver}</b>.<br>
          <span style="color:#94A3B8;font-size:11.5px">→ Đề xuất: retention package + 1:1 meeting với quản lý trực tiếp</span>
        </div>
      </div>
      <div class="ml-insight-card ml-model">
        <div class="ml-insight-title">🤖 Thông tin mô hình ML</div>
        <div class="ml-insight-body">
          Thuật toán: <b>XGBoost</b> · AUC-ROC: <b>0.71</b> · Train: 3 năm lịch sử<br>
          Score ngày: <b>${risk.scored_at || '–'}</b> · Features: 20+ biến<br>
          <span style="color:#94A3B8;font-size:11.5px">SHAP top-3 factors / người — hover cột "Lý do chính" để xem đủ 3</span>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="panel-card span-4">
        <div class="panel-title">Phân bố rủi ro${dn}${hasLevel ? ' · ' + levelNameRaw() : ''}</div>
        <div class="panel-sub-title">${fmtInt(total)} NV được chấm điểm theo 3 mức${hasLevel || !isAll ? ' · trong bộ lọc' : ' · toàn công ty'}</div>
        <div class="donut-wrap">
          <canvas id="at-donut" class="donut-canvas" width="150" height="150" style="width:150px;height:150px"></canvas>
          <div class="legend" id="at-legend"></div>
        </div>
        ${chartLegend(riskSegs)}
      </div>
      <div class="panel-card span-8">
        <div class="panel-title">Phân bố rủi ro theo Phòng × Cấp</div>
        <div class="panel-sub-title">Số NV rủi ro CAO mỗi tổ hợp · đỏ đậm = tập trung rủi ro</div>
        <div class="hm-wrap" id="ml-heatmap"></div>
      </div>
    </div>

    ${tblHead(`Nhân viên rủi ro nghỉ việc — SHAP top drivers (${fmtInt(topRisk.length)} NV)`, 'exportRisk',
      `risk_score = điểm xếp hạng ưu tiên (0–1) · Thâm niên + quý review gần nhất · chấm ngày ${risk.scored_at || '–'} · TOÀN BỘ NV được chấm điểm · lọc theo filter hiện tại`)}
    <div class="table-wrap">${riskTable(topRisk)}</div>

    <!-- ══ PHÂN TÍCH ══ -->
    ${insightSection('Phân tích', `Nhận định mô hình theo ${scope}`, mlInsights)}

    <!-- ══ KHUYẾN NGHỊ VẬN HÀNH ══ -->
    ${recSection('Khuyến nghị vận hành', `Hành động retention cho ${scope}`, mlRecs)}
  </div>`;

  requestAnimationFrame(() => {
    drawDonut(document.getElementById('at-donut'), riskSegs);
    document.getElementById('at-legend').innerHTML = riskSegs.map(s =>
      `<div class="legend-item">
        <span class="dot" style="background:${s.color}"></span>${s.label}
        <span class="legend-val">${fmtInt(s.value)}</span>
      </div>`).join('');

    // Heatmap Phòng × Cấp — high-risk count từ bands_by_dept_level
    const src = (risk.bands_by_dept_level || []).filter(r => r.risk_band === 'high'
      && (isAll || Number(r.department_id) === Number(STATE.dept))
      && (STATE.level === 'all' || Number(r.level_id) === Number(STATE.level)));
    const deptsH = isAll ? DATA.departments.map(d => d.department_name)
      : [deptNameRaw()];
    const levelsH = LEVEL_ORDER.filter(l => src.some(r => r.level_name === l));
    const cellAt = (dept, lvl) => {
      const r = src.find(x => x.department_name === dept && x.level_name === lvl);
      return r ? r.cnt : 0;
    };
    const maxCell = Math.max(1, ...src.map(r => r.cnt));
    const hmRows = deptsH.map(d => ({
      key: d,
      cells: levelsH.map(l => ({ value: cellAt(d, l), label: `${d} · ${l} · ${cellAt(d, l)} NV CAO` })),
    }));
    renderHeatmap(document.getElementById('ml-heatmap'), hmRows, levelsH, maxCell);
  });
}

// ─────────────────────────────────────────────
// TABLE BUILDERS — GHN style với heatmap màu
// ─────────────────────────────────────────────

// prevMap: Map "deptId|levelId" -> headcount cùng kỳ năm trước (có thể null)
// cmpLabel: nhãn kỳ so sánh (vd "2025-06") để ghi th-note
function hcTable(rows, prevMap, cmpLabel) {
  const sorted = [...rows].sort((a, b) => b.headcount - a.headcount);
  const maxHC  = Math.max(1, ...sorted.map(r => r.headcount));
  const body = sorted.map(r => {
    const pct  = r.headcount / maxHC;
    const barW = Math.round(pct * 80);
    const femBg = r.pct_female >= 35 ? 'cell-ok' : r.pct_female >= 25 ? 'cell-warn' : 'cell-risk';
    const prev = prevMap ? prevMap.get(`${r.department_id}|${r.level_id}`) : null;
    return `<tr>
      <td><b>${r.department_name}</b></td>
      <td>${r.level_name}</td>
      <td class="num">
        <div class="cell-bar-wrap">
          <div class="cell-bar" style="width:${barW}%"></div>
          <span>${fmtInt(r.headcount)}</span>
        </div>
      </td>
      <td class="num">${deltaCell(r.headcount, prev, false)}</td>
      <td class="num">${fmtInt(r.headcount_female)}</td>
      <td class="num"><span class="cell-heat ${femBg}">${fmtPct(r.pct_female)}</span></td>
      <td class="num">${fmtScore(r.avg_tenure_years)} năm</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr>
      <th>Phòng ban</th><th>Cấp bậc</th>
      <th class="num">Headcount</th>
      <th class="num">Δ cùng kỳ <span class="th-note">(${cmpLabel ? 'vs ' + cmpLabel : 'YoY'})</span></th>
      <th class="num">Nữ</th>
      <th class="num">% Nữ <span class="th-note">(≥35%=tốt)</span></th>
      <th class="num">Thâm niên TB</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function attritionTable(rows) {
  if (!rows.length) return '<div class="empty">Không có dữ liệu</div>';
  // Lookup cùng kỳ năm trước: key "quý|deptId" -> exits_total (từ toàn bộ DATA.attrition)
  const prevYoY = new Map(DATA.attrition.map(r => [`${r.exit_year_quarter}|${r.department_id ?? 'all'}`, r.exits_total]));
  const prevQuarter = q => { const [y, qq] = q.split('-Q'); return `${Number(y) - 1}-Q${qq}`; };
  const sorted = [...rows].sort((a, b) => b.exit_year_quarter.localeCompare(a.exit_year_quarter) || b.exits_total - a.exits_total);
  const body = sorted.map(r => {
    const rt = r.attrition_rate_pct;
    const incomplete = rt == null || isNaN(rt);  // quý đang chạy — chưa có rate
    const rateCls = incomplete ? '' : rt > 10 ? 'cell-risk' : rt > 6 ? 'cell-warn' : 'cell-ok';
    const rateHtml = incomplete
      ? '<span class="chip" title="Quý chưa hết kỳ — chưa tính được rate">đang chạy</span>'
      : `<span class="cell-heat ${rateCls}">${fmtPct(rt)}</span>`;
    const volPct2 = r.exits_total ? r.exits_voluntary / r.exits_total * 100 : 0;
    const prevEx = prevYoY.get(`${prevQuarter(r.exit_year_quarter)}|${r.department_id ?? 'all'}`);
    return `<tr>
      <td>${r.exit_year_quarter}</td>
      <td><b>${r.department_name || 'Tất cả'}</b></td>
      <td class="num">${fmtInt(r.exits_total)}</td>
      <td class="num">${deltaCell(r.exits_total, prevEx, true)}</td>
      <td class="num">${fmtInt(r.exits_voluntary)}</td>
      <td class="num">${fmtInt(r.exits_involuntary)}</td>
      <td class="num">${rateHtml}</td>
      <td class="num">${fmtPct(volPct2)}</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr>
      <th>Quý</th><th>Phòng</th>
      <th class="num">Tổng nghỉ</th>
      <th class="num">Δ cùng kỳ <span class="th-note">(vs quý năm trước · tăng=xấu)</span></th>
      <th class="num">Voluntary</th><th class="num">Involuntary</th>
      <th class="num">Rate <span class="th-note">(≤6%=ok·>10%=alert)</span></th>
      <th class="num">% Vol</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function perfTable(rows) {
  if (!rows.length) return '<div class="empty">Không có dữ liệu</div>';
  const sorted = [...rows].sort((a, b) => b.avg_score - a.avg_score);
  const body = sorted.map(r => {
    const scoreCls = r.avg_score >= 4 ? 'cell-ok' : r.avg_score >= 3 ? 'cell-warn' : 'cell-risk';
    return `<tr>
      <td><b>${r.department_name}</b></td>
      <td class="num">${fmtInt(r.n_reviews || 0)}</td>
      <td class="num"><span class="cell-heat ${scoreCls}">${fmtScore(r.avg_score)}</span></td>
      <td class="num">${fmtInt(r.cnt_low || 0)}</td>
      <td class="num">${fmtInt(r.cnt_high || 0)}</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr>
      <th>Phòng ban</th><th class="num">Số review</th>
      <th class="num">Điểm TB <span class="th-note">(≥4=tốt)</span></th>
      <th class="num">Điểm thấp &lt;3</th><th class="num">Điểm cao ≥4</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function compTable(rows) {
  if (!rows.length) return '<div class="empty">Không có dữ liệu</div>';
  const sorted = [...rows].sort((a, b) => b.salary_median - a.salary_median);
  const body = sorted.map(r => {
    const spreadCls = r.salary_spread_pct > 60 ? 'cell-warn' : r.salary_spread_pct > 80 ? 'cell-risk' : 'cell-ok';
    return `<tr>
      <td><b>${r.department_name}</b></td><td>${r.level_name}</td>
      <td class="num">${fmtInt(r.employee_count)}</td>
      <td class="num">${fmtMoney(r.salary_p25)}</td>
      <td class="num"><b>${fmtMoney(r.salary_median)}</b></td>
      <td class="num">${fmtMoney(r.salary_p75)}</td>
      <td class="num"><span class="cell-heat ${spreadCls}">${fmtPct(r.salary_spread_pct)}</span></td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr>
      <th>Phòng</th><th>Cấp</th><th class="num">NV</th>
      <th class="num">P25</th><th class="num">Median</th><th class="num">P75</th>
      <th class="num">Spread <span class="th-note">(&lt;60%=ok)</span></th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function hiringTable(rows) {
  if (!rows.length) return '<div class="empty">Không có dữ liệu</div>';
  const prevYoY = new Map(DATA.hiring.map(r => [`${r.year_quarter}|${r.department_id}`, r.cnt_hired]));
  const prevQuarter = q => { const [y, qq] = q.split('-Q'); return `${Number(y) - 1}-Q${qq}`; };
  const sorted = [...rows].sort((a, b) => b.year_quarter.localeCompare(a.year_quarter) || b.cnt_hired - a.cnt_hired);
  const body = sorted.map(r => {
    const rateCls = r.overall_hire_rate_pct >= 5 ? 'cell-ok' : 'cell-warn';
    const tthCls  = r.avg_days_to_hire > 35 ? 'cell-risk' : r.avg_days_to_hire > 25 ? 'cell-warn' : 'cell-ok';
    const prevH = prevYoY.get(`${prevQuarter(r.year_quarter)}|${r.department_id}`);
    return `<tr>
      <td>${r.year_quarter}</td><td><b>${r.department_name}</b></td>
      <td class="num">${fmtInt(r.cnt_applied)}</td>
      <td class="num">${fmtInt(r.cnt_offer)}</td>
      <td class="num">${fmtInt(r.cnt_hired)}</td>
      <td class="num">${deltaCell(r.cnt_hired, prevH, false)}</td>
      <td class="num"><span class="cell-heat ${rateCls}">${fmtPct(r.overall_hire_rate_pct)}</span></td>
      <td class="num"><span class="cell-heat ${tthCls}">${fmtScore(r.avg_days_to_hire)}d</span></td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr>
      <th>Quý</th><th>Phòng</th>
      <th class="num">Applied</th><th class="num">Offer</th><th class="num">Hired</th>
      <th class="num">Δ Hired <span class="th-note">(vs quý năm trước)</span></th>
      <th class="num">Hire% <span class="th-note">(≥5%=ok)</span></th>
      <th class="num">TtH <span class="th-note">(≤30d=ok)</span></th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function riskTable(rows) {
  if (!rows.length) return '<div class="empty">Không có nhân viên khớp bộ lọc (thử đổi Mức rủi ro / Thâm niên).</div>';
  const CAP = 500;  // đủ chứa toàn bộ 484 high; cap để DOM không quá nặng
  const shown = rows.slice(0, CAP);
  const moreNote = rows.length > CAP
    ? `<div class="empty" style="padding:12px">… hiển thị ${CAP}/${fmtInt(rows.length)} dòng đầu · Xuất CSV để xem đủ</div>` : '';
  const body = shown.map(r => {
    const b   = RISK_BAND[r.risk_band] || RISK_BAND.low;
    const all = [r.driver_1, r.driver_2, r.driver_3].filter(Boolean).join(' · ');
    const scoreCls = r.risk_score > 0.7 ? 'cell-risk' : r.risk_score > 0.4 ? 'cell-warn' : 'cell-ok';
    const tenCls = r.tenure_days < 730 ? 'cell-risk' : r.tenure_days < 1825 ? 'cell-warn' : 'cell-ok';
    return `<tr>
      <td style="font-family:monospace;font-size:11.5px">${r.employee_id}</td>
      <td>${r.department_name}</td><td>${r.level_name}</td>
      <td class="num"><span class="cell-heat ${tenCls}">${fmtTenure(r.tenure_days)}</span></td>
      <td class="num"><span class="cell-heat ${scoreCls}">${fmtScore(r.risk_score)}</span></td>
      <td><span class="badge" style="color:${b.color};background:${b.bg}">${b.label}</span></td>
      <td style="white-space:nowrap">${r.last_review_quarter || '–'}</td>
      <td title="${all}" style="cursor:help">
        <span class="driver-chip">${r.driver_1 || '–'}</span>
        ${r.driver_2 ? `<span class="driver-chip driver-2">${r.driver_2}</span>` : ''}
      </td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr>
      <th>Mã NV</th><th>Phòng</th><th>Cấp</th>
      <th class="num">Thâm niên <span class="th-note">(&lt;2y=mới)</span></th>
      <th class="num">Risk score <span class="th-note">(0→1)</span></th>
      <th>Mức rủi ro</th>
      <th>Review gần nhất <span class="th-note">(quý)</span></th>
      <th>Lý do chính (SHAP)</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>${moreNote}`;
}

function mostCommonDriver(rows) {
  const m = new Map();
  rows.forEach(r => { if (r.driver_1) m.set(r.driver_1, (m.get(r.driver_1) || 0) + 1); });
  let best = '–', bn = 0;
  m.forEach((v, k) => { if (v > bn) { bn = v; best = k; } });
  return best;
}

// ─── Export functions (xuất đúng data đang lọc — theo rule export-data) ───
function exportHeadcount() {
  const months = monthsInRange();
  const latest = months[months.length - 1];
  downloadCSV(
    filterHeadcount().filter(r => r.year_month_key === latest).map(r => ({
      year_month: r.year_month_key, dept: r.department_name, level: r.level_name,
      headcount: r.headcount, female: r.headcount_female, male: r.headcount_male,
      pct_female: r.pct_female, avg_tenure_years: r.avg_tenure_years,
    })),
    `hr_headcount_${_today()}.csv`
  );
}
function exportAttrition() {
  downloadCSV(filterAttrition().map(r => ({
    quarter: r.exit_year_quarter, dept: r.department_name || 'All',
    exits_total: r.exits_total, exits_voluntary: r.exits_voluntary,
    exits_involuntary: r.exits_involuntary, attrition_rate_pct: r.attrition_rate_pct,
  })), `hr_attrition_${_today()}.csv`);
}
function exportComp() {
  downloadCSV(applyDeptLevel(DATA.compensation).map(r => ({
    dept: r.department_name, level: r.level_name, employee_count: r.employee_count,
    p25: r.salary_p25, median: r.salary_median, p75: r.salary_p75, spread_pct: r.salary_spread_pct,
  })), `hr_compensation_${_today()}.csv`);
}
function exportHiring() {
  downloadCSV(filterHiring().map(r => ({
    quarter: r.year_quarter, dept: r.department_name, applied: r.cnt_applied,
    offer: r.cnt_offer, hired: r.cnt_hired,
    hire_rate_pct: r.overall_hire_rate_pct, time_to_hire_days: r.avg_days_to_hire,
  })), `hr_hiring_${_today()}.csv`);
}
function exportRisk() {
  let r0 = DATA.risk.top;
  if (STATE.dept !== 'all')  r0 = r0.filter(r => Number(r.department_id) === Number(STATE.dept));
  if (STATE.level !== 'all') r0 = r0.filter(r => Number(r.level_id) === Number(STATE.level));
  if (STATE.riskBand !== 'all') r0 = r0.filter(r => r.risk_band === STATE.riskBand);
  if (STATE.tenureGroup !== 'all') {
    const t = TENURE_GROUPS[STATE.tenureGroup];
    if (t && t.test) r0 = r0.filter(r => t.test(r.tenure_days || 0));
  }
  downloadCSV(r0.map(r => ({
    employee_id: r.employee_id, dept: r.department_name, level: r.level_name,
    risk_score: r.risk_score, risk_band: r.risk_band,
    tenure_days: r.tenure_days, tenure_years: (r.tenure_days / 365.25).toFixed(1),
    last_review_quarter: r.last_review_quarter || '', scored_at: r.scored_at || '',
    driver_1: r.driver_1, driver_2: r.driver_2, driver_3: r.driver_3,
  })), `hr_attrition_risk_${_today()}.csv`);
}

// ─── Shared helpers ───
function deptName() {
  if (STATE.dept === 'all') return '';
  const d = DATA.departments.find(x => Number(x.department_id) === Number(STATE.dept));
  return d ? ` — ${d.department_name}` : '';
}
function deptNameRaw() {
  const d = DATA.departments.find(x => Number(x.department_id) === Number(STATE.dept));
  return d ? d.department_name : 'Tổng';
}
function levelNameRaw() {
  const l = (DATA.levels || []).find(x => Number(x.level_id) === Number(STATE.level));
  return l ? l.level_name : '';
}
function groupSum(rows, key, val) {
  const m = new Map();
  rows.forEach(r => m.set(r[key], (m.get(r[key]) || 0) + (r[val] || 0)));
  return m;
}
function avgPlain(rows, c) {
  return rows.length ? rows.reduce((a, r) => a + (r[c] || 0), 0) / rows.length : 0;
}
function avgWeighted(rows, c, w) {
  let s = 0, n = 0;
  rows.forEach(r => { s += (r[c] || 0) * (r[w] || 0); n += (r[w] || 0); });
  return n ? s / n : 0;
}

// ─── Attrition: chỉ tính QUÝ HOÀN CHỈNH ───
// Quý hiện tại (vd 2026-Q3) chưa hết kỳ → attrition_rate_pct = null/NaN trong mart.
// Loại các quý có rate null để KPI "rate quý gần nhất" không hiện 0.0% giả "On-track".
function completedQuarters(atRows) {
  const qs = [...new Set(atRows.map(r => r.exit_year_quarter))].sort();
  return qs.filter(q => atRows.some(r =>
    r.exit_year_quarter === q && r.attrition_rate_pct != null && !isNaN(r.attrition_rate_pct)));
}
// Rate TB của quý hoàn chỉnh gần nhất (+ tên quý đó). Trả {rate, quarter}.
function latestCompletedRate(atRows) {
  const cq = completedQuarters(atRows);
  if (!cq.length) return { rate: 0, quarter: null };
  const q = cq[cq.length - 1];
  const rows = atRows.filter(r => r.exit_year_quarter === q
    && r.attrition_rate_pct != null && !isNaN(r.attrition_rate_pct));
  const rate = rows.length ? rows.reduce((a, r) => a + r.attrition_rate_pct, 0) / rows.length : 0;
  return { rate, quarter: q };
}
