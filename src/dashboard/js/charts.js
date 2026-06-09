'use strict';

// ─── Canvas setup (light theme bg = white) ───
function _setupCanvas(canvas, defaultH) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.getBoundingClientRect().width || 600;
  const H   = parseInt(canvas.getAttribute('height')) || defaultH || 180;
  canvas.width  = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  return { ctx, W, H };
}

function _setupDonut(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const sz  = parseInt(canvas.getAttribute('width')) || 150;
  canvas.width  = sz * dpr; canvas.height = sz * dpr;
  canvas.style.setProperty('width',  sz + 'px', 'important');
  canvas.style.setProperty('height', sz + 'px', 'important');
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sz, sz);
  return { ctx, sz };
}

// ─── Tooltip helper ───
// Tạo tooltip div gắn vào .chart-wrap parent
function _makeTooltip(canvas) {
  const wrap = canvas.closest('.chart-wrap');
  if (!wrap) return null;
  let tip = wrap.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    wrap.appendChild(tip);
  }
  return tip;
}

function _hideTooltip(tip) { if (tip) tip.classList.remove('visible'); }

function _showTooltip(tip, canvas, x, y, html) {
  if (!tip) return;
  tip.innerHTML = html;
  tip.classList.add('visible');
  const cRect  = canvas.getBoundingClientRect();
  const wRect  = canvas.closest('.chart-wrap').getBoundingClientRect();
  const tipW   = 160, tipH = tip.offsetHeight || 100;
  let left = x + 14, top = y - tipH / 2;
  if (left + tipW > wRect.width - 4) left = x - tipW - 10;
  if (top < 4) top = 4;
  tip.style.left = left + 'px';
  tip.style.top  = top  + 'px';
}

// ─── Grid + axis shared ───
function _grid(ctx, pad, W, H, maxY, fmtY) {
  const plotH = H - pad.top - pad.bottom;
  const plotW = W - pad.left - pad.right;
  ctx.strokeStyle = '#EEF1F4'; ctx.lineWidth = 1;
  ctx.fillStyle   = '#94A3B8'; ctx.font = "10.5px 'Be Vietnam Pro', system-ui";
  ctx.textAlign   = 'right';
  for (let g = 0; g <= 4; g++) {
    const y = pad.top + plotH - plotH * g / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillText((fmtY || fmtInt)(maxY * g / 4), pad.left - 6, y + 3);
  }
  return { plotW, plotH };
}

// ══════════════════════════════════════════════
// LINE CHART — nhiều series, tooltip hover
// series = [{ label, color, points:[{x, y}] }]
// ══════════════════════════════════════════════
function _drawLineContent(ctx, W, H, pad, labels, series, minY, maxY, plotW, plotH) {
  const step = Math.max(1, Math.ceil(labels.length / 7));
  ctx.textAlign = 'center'; ctx.fillStyle = '#94A3B8'; ctx.font = "10.5px 'Be Vietnam Pro', system-ui";
  labels.forEach((lb, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    const x = pad.left + plotW * i / Math.max(1, labels.length - 1);
    ctx.fillText(lb, x, H - 8);
  });
  const getX = i => pad.left + plotW * i / Math.max(1, series[0].points.length - 1);
  const getY = v => pad.top + plotH - plotH * (v - minY) / (maxY - minY);
  // Area fill mờ dưới mỗi đường (giữ look "cái cũ"). Multi-series: fill rất nhạt (+'12') để không đè đục.
  const fillAlpha = series.length === 1 ? '20' : '12';
  for (const s of series) {
    ctx.beginPath();
    s.points.forEach((p, i) => { i === 0 ? ctx.moveTo(getX(i), getY(p.y)) : ctx.lineTo(getX(i), getY(p.y)); });
    ctx.lineTo(getX(s.points.length - 1), pad.top + plotH);
    ctx.lineTo(getX(0), pad.top + plotH);
    ctx.closePath(); ctx.fillStyle = s.color + fillAlpha; ctx.fill();
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    s.points.forEach((p, i) => { i === 0 ? ctx.moveTo(getX(i), getY(p.y)) : ctx.lineTo(getX(i), getY(p.y)); });
    ctx.stroke();
  }
  return { getX, getY };
}

function drawLine(canvas, labels, series, opts) {
  opts = opts || {};
  const pad  = { top: 16, right: 16, bottom: 32, left: 50 };
  const allY = series.flatMap(s => s.points.map(p => p.y));
  const minY = opts.minY != null ? opts.minY : 0;
  const maxY = Math.max(1, ...allY) * 1.08;

  const _draw = () => {
    const { ctx, W, H } = _setupCanvas(canvas, opts.height || 200);
    const { plotW, plotH } = _grid(ctx, pad, W, H, maxY, opts.fmtY);
    return _drawLineContent(ctx, W, H, pad, labels, series, minY, maxY, plotW, plotH);
  };

  const { getX, getY } = _draw();
  const dpr = window.devicePixelRatio || 1;
  // CACHE kích thước ngay sau lần vẽ đầu — KHÔNG đọc lại parent width khi hover (đó là lý do chart "nhảy").
  const W = canvas.width / dpr, H = canvas.height / dpr;
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const n = series[0].points.length;

  const tip = _makeTooltip(canvas);
  if (!tip) return;

  // Vẽ lại chart trên kích thước ĐÃ CACHE (không gọi _setupCanvas → không resize/đọc parent).
  const ctx = canvas.getContext('2d');
  const _redrawCached = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);   // reset transform
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    _grid(ctx, pad, W, H, maxY, opts.fmtY);
    _drawLineContent(ctx, W, H, pad, labels, series, minY, maxY, plotW, plotH);
  };

  canvas.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(mx - getX(i));
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (bestDist > plotW / n * 0.6) { _hideTooltip(tip); _redrawCached(); return; }

    _redrawCached();
    // Crosshair + dots (ctx đã scale(dpr) trong _redrawCached, toạ độ CSS)
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    const vx = getX(best);
    ctx.beginPath(); ctx.moveTo(vx, pad.top); ctx.lineTo(vx, pad.top + plotH); ctx.stroke();
    ctx.setLineDash([]);
    series.forEach(s => {
      const vy = getY(s.points[best].y);
      ctx.beginPath(); ctx.arc(vx, vy, 4, 0, Math.PI * 2);
      ctx.fillStyle = s.color; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    });

    const rows = series.map(s =>
      `<div class="chart-tooltip-row">
        <span class="chart-tooltip-dot" style="background:${s.color}"></span>
        <span class="chart-tooltip-label">${s.label}</span>
        <span class="chart-tooltip-val">${(opts.fmtY || fmtInt)(s.points[best].y)}</span>
      </div>`).join('');
    _showTooltip(tip, canvas, getX(best), getY(series[0].points[best].y),
      `<div class="chart-tooltip-title">${labels[best]}</div>${rows}`);
  };

  canvas.onmouseleave = () => { _hideTooltip(tip); _redrawCached(); };
}

// ══════════════════════════════════════════════
// BAR CHART — tooltip hover
// ══════════════════════════════════════════════
// colors: optional string[] per bar — overrides single color
function drawBars(canvas, labels, values, color, fmt, colors) {
  const { ctx, W, H } = _setupCanvas(canvas, 170);
  const pad  = { top: 28, right: 14, bottom: 32, left: 50 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const maxY  = Math.max(1, ...values) * 1.15;
  const n     = Math.max(1, labels.length);

  // Grid
  ctx.strokeStyle = '#EEF1F4'; ctx.lineWidth = 1;
  ctx.fillStyle   = '#94A3B8'; ctx.font = "10.5px 'Be Vietnam Pro', system-ui"; ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const y = pad.top + plotH - plotH * g / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillText((fmt || fmtInt)(maxY * g / 4), pad.left - 6, y + 3);
  }

  const barW   = Math.min(48, (plotW / n) * 0.65);
  const slot   = barW * 1.6;
  const blockW = slot * n;
  const startX = pad.left + Math.max(0, (plotW - blockW) / 2);

  const barRects = [];
  labels.forEach((lb, i) => {
    const cx = startX + slot * i + slot / 2;
    const x  = cx - barW / 2;
    const bh = plotH * values[i] / maxY;
    const y  = pad.top + plotH - bh;

    // Bar with rounded top
    const barColor = (colors && colors[i]) ? colors[i] : color;
    ctx.fillStyle = barColor + 'cc';
    ctx.beginPath();
    const r = Math.min(4, barW / 4);
    ctx.moveTo(x + r, y); ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, y + bh); ctx.lineTo(x, y + bh);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fill();

    // Value label trên đỉnh
    ctx.fillStyle = '#4A5568'; ctx.font = "bold 10.5px 'Be Vietnam Pro', system-ui"; ctx.textAlign = 'center';
    ctx.fillText((fmt || fmtInt)(values[i]), cx, y - 5);
    // X label
    ctx.fillStyle = '#94A3B8'; ctx.font = "10.5px 'Be Vietnam Pro', system-ui";
    ctx.fillText(lb, cx, H - 8);
    barRects.push({ x, y, w: barW, h: bh, cx, label: lb, value: values[i], color: barColor });
  });

  // Tooltip
  const tip = _makeTooltip(canvas);
  if (!tip) return;
  canvas.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = barRects.find(r => mx >= r.x - 4 && mx <= r.x + r.w + 4 && my >= r.y && my <= r.y + r.h);
    if (!hit) { _hideTooltip(tip); return; }
    _showTooltip(tip, canvas, hit.cx, hit.y,
      `<div class="chart-tooltip-title">${hit.label}</div>
       <div class="chart-tooltip-row">
         <span class="chart-tooltip-dot" style="background:${hit.color || color}"></span>
         <span class="chart-tooltip-val">${(fmt || fmtInt)(hit.value)}</span>
       </div>`);
  };
  canvas.onmouseleave = () => _hideTooltip(tip);
}

// ══════════════════════════════════════════════
// DONUT
// ══════════════════════════════════════════════
function drawDonut(canvas, segs) {
  const { ctx, sz } = _setupDonut(canvas);
  const total = segs.reduce((a, s) => a + s.value, 0) || 1;
  const cx = sz / 2, cy = sz / 2;
  const outer = sz / 2 - 4, inner = outer * 0.58;

  let a0 = -Math.PI / 2;
  const mids = [];
  for (const s of segs) {
    const a1 = a0 + (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, a0, a1);
    ctx.arc(cx, cy, inner, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = s.color; ctx.fill();
    const mid = (a0 + a1) / 2, r = (outer + inner) / 2;
    mids.push({ pct: Math.round(s.value / total * 100), x: cx + Math.cos(mid) * r, y: cy + Math.sin(mid) * r });
    a0 = a1;
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  mids.forEach(m => {
    if (m.pct >= 8) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.font = 'bold 11px Segoe UI';
      ctx.fillText(m.pct + '%', m.x, m.y);
    }
  });
  ctx.textBaseline = 'alphabetic';
}

// ══════════════════════════════════════════════
// FUNNEL (hiring)
// ══════════════════════════════════════════════
function drawFunnel(canvas, stages) {
  const rowH = 26, gap = 6;
  const { ctx, W, H } = _setupCanvas(canvas, stages.length * (rowH + gap) + 16);
  const maxV  = Math.max(1, ...stages.map(s => s.value));
  const labelW = 82, numW = 120, barMax = W - labelW - numW - 8;

  stages.forEach((s, i) => {
    const y  = 8 + i * (rowH + gap);
    const bw = Math.max(4, barMax * s.value / maxV);
    const col = SERIES_COLORS[i % SERIES_COLORS.length];

    // Bar bg
    ctx.fillStyle = '#EEF1F4';
    ctx.beginPath(); ctx.roundRect(labelW, y, barMax, rowH, 4); ctx.fill();
    // Bar fill
    ctx.fillStyle = col + 'dd';
    ctx.beginPath(); ctx.roundRect(labelW, y, bw, rowH, 4); ctx.fill();

    // Stage label
    ctx.fillStyle = '#4A5568'; ctx.font = "600 11.5px 'Be Vietnam Pro', system-ui"; ctx.textAlign = 'left';
    ctx.fillText(s.label, 4, y + rowH / 2 + 4);

    // Value + conversion %
    ctx.fillStyle = '#14213D'; ctx.font = "bold 11.5px 'Be Vietnam Pro', system-ui";
    let txt = fmtInt(s.value);
    if (i > 0 && stages[i - 1].value) {
      const pct = Math.round(s.value / stages[i - 1].value * 100);
      ctx.fillText(fmtInt(s.value), labelW + bw + 6, y + rowH / 2 + 4);
      ctx.fillStyle = pct >= 50 ? '#16A34A' : '#F59E0B';
      ctx.font = "10.5px 'Be Vietnam Pro', system-ui";
      ctx.fillText(`(${pct}%)`, labelW + bw + 6 + ctx.measureText(fmtInt(s.value)).width + 5, y + rowH / 2 + 4);
    } else {
      ctx.fillText(txt, labelW + bw + 6, y + rowH / 2 + 4);
    }
  });
}

// ══════════════════════════════════════════════
// STACKED BARS — segments = [{name, color, data:[]}], labels song song
// Tổng trên đỉnh + label segment trong cột (theo rule chart-canvas)
// ══════════════════════════════════════════════
function drawStackedBars(canvas, labels, segments, opts) {
  opts = opts || {};
  const fmt = opts.fmt || fmtInt;
  const { ctx, W, H } = _setupCanvas(canvas, opts.height || 200);
  const pad   = { top: 28, right: 14, bottom: 32, left: 50 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const n     = Math.max(1, labels.length);
  const totals = labels.map((_, i) => segments.reduce((a, s) => a + (s.data[i] || 0), 0));
  const maxY  = Math.max(1, ...totals) * 1.15;

  // Grid
  ctx.strokeStyle = '#EEF1F4'; ctx.lineWidth = 1;
  ctx.fillStyle = '#94A3B8'; ctx.font = "10.5px 'Be Vietnam Pro', system-ui"; ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const y = pad.top + plotH - plotH * g / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillText(fmt(maxY * g / 4), pad.left - 6, y + 3);
  }

  const slot   = plotW / n;
  const barW   = Math.min(46, slot * 0.6);
  const barRects = [];

  labels.forEach((lb, i) => {
    const cx = pad.left + slot * i + slot / 2;
    const x  = cx - barW / 2;
    let yCursor = pad.top + plotH;

    segments.forEach(s => {
      const v  = s.data[i] || 0;
      const bh = plotH * v / maxY;
      const y  = yCursor - bh;
      ctx.fillStyle = s.color;
      ctx.fillRect(x, y, barW, bh);
      // label segment trong cột nếu đủ cao
      if (bh >= 16) {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = "bold 9px 'Be Vietnam Pro', system-ui"; ctx.textAlign = 'center';
        ctx.fillText(fmt(v), cx, y + bh / 2 + 3);
      }
      barRects.push({ x, y, w: barW, h: bh, cx, label: lb, segName: s.name, value: v, color: s.color });
      yCursor = y;
    });

    // tổng trên đỉnh
    const totalY = pad.top + plotH - plotH * totals[i] / maxY;
    ctx.fillStyle = '#14213D'; ctx.font = "bold 10.5px 'Be Vietnam Pro', system-ui"; ctx.textAlign = 'center';
    ctx.fillText(fmt(totals[i]), cx, totalY - 5);
    // x label
    ctx.fillStyle = '#94A3B8'; ctx.font = "10.5px 'Be Vietnam Pro', system-ui";
    ctx.fillText(lb, cx, H - 8);
  });

  // Tooltip — show full stack của 1 cột
  const tip = _makeTooltip(canvas);
  if (!tip) return;
  canvas.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = barRects.find(r => mx >= r.x - 2 && mx <= r.x + r.w + 2 && my >= r.y && my <= r.y + r.h);
    if (!hit) { _hideTooltip(tip); return; }
    const idx = labels.indexOf(hit.label);
    const rows = segments.map(s =>
      `<div class="chart-tooltip-row">
         <span class="chart-tooltip-dot" style="background:${s.color}"></span>
         <span class="chart-tooltip-label">${s.name}</span>
         <span class="chart-tooltip-val">${fmt(s.data[idx] || 0)}</span>
       </div>`).join('');
    _showTooltip(tip, canvas, hit.cx, hit.y,
      `<div class="chart-tooltip-title">${hit.label} · tổng ${fmt(totals[idx])}</div>${rows}`);
  };
  canvas.onmouseleave = () => _hideTooltip(tip);
}

// ══════════════════════════════════════════════
// RANK TABLE (HTML, không canvas) — list mini-bar kiểu GHN
// rows = [{ name, code?, value, delta?, sub?, color? }]
// ══════════════════════════════════════════════
function renderRankTable(el, rows, opts) {
  if (!el) return;
  opts = opts || {};
  const fmt = opts.fmt || fmtInt;
  if (!rows || !rows.length) { el.innerHTML = '<div class="empty">Không có dữ liệu</div>'; return; }
  const max = Math.max(1, ...rows.map(r => r.value));
  el.innerHTML = `<div class="rank-table">${rows.map((r, i) => {
    const col = r.color || C.accent;
    const w = Math.round(r.value / max * 100);
    const deltaHtml = r.delta != null
      ? `<span class="delta ${r.delta >= 0 ? 'delta-up' : 'delta-down'}">${r.delta >= 0 ? '▲' : '▼'} ${Math.abs(r.delta).toFixed(1)}${opts.deltaSuffix || ''}</span>`
      : '';
    return `<div class="rank-row">
      <span class="rank-idx">${i + 1}</span>
      <div class="rank-main">
        <div class="rank-name">${r.name}${r.code ? ` <span class="rank-code">${r.code}</span>` : ''}</div>
        <div class="minibar-track"><div class="minibar-fill" style="width:${w}%;background:${col}"></div></div>
      </div>
      <div class="rank-nums">
        <span class="rank-ontime">${fmt(r.value)}</span>
        ${deltaHtml}
      </div>
      ${r.sub != null ? `<span class="rank-orders">${r.sub}</span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ══════════════════════════════════════════════
// HEATMAP (HTML grid) — màu theo scaleRed
// rows = [{key, cells:[{value,label}]}], cols = string[]
// ══════════════════════════════════════════════
function renderHeatmap(el, rows, cols, max) {
  if (!el) return;
  if (!rows || !rows.length) { el.innerHTML = '<div class="empty">Không có dữ liệu</div>'; return; }
  const head = `<div class="hm-corner"></div>` + cols.map(c => `<div class="hm-colhead">${c}</div>`).join('');
  const body = rows.map(r =>
    `<div class="hm-rowhead">${r.key}</div>` + r.cells.map(c => {
      const bg = scaleRed(c.value, max);
      const dark = c.value / max > 0.45;
      return `<div class="hm-cell" style="background:${bg}" title="${c.label || ''}">
        <span class="hm-val" style="color:${dark ? '#fff' : '#14213D'};text-shadow:${dark ? '0 1px 1px rgba(0,0,0,.2)' : 'none'}">${c.value ? fmtInt(c.value) : ''}</span>
      </div>`;
    }).join('')).join('');
  el.innerHTML = `<div class="heatmap" style="--cols:${cols.length}">${head}${body}</div>`;
}

// Nội suy màu trắng → cam nhạt → đỏ theo tỷ lệ v/max (GHN scaleRed)
function scaleRed(v, max) {
  if (!v || v <= 0) return '#FAFBFC';
  const t = Math.min(1, v / (max || 1));
  // 0 → #FEF6E7 (warn-bg) ; 0.5 → #F59E0B ; 1 → #DC2626
  const lerp = (a, b, k) => Math.round(a + (b - a) * k);
  let r, g, b;
  if (t < 0.5) {
    const k = t / 0.5;
    r = lerp(0xFE, 0xF5, k); g = lerp(0xF6, 0x9E, k); b = lerp(0xE7, 0x0B, k);
  } else {
    const k = (t - 0.5) / 0.5;
    r = lerp(0xF5, 0xDC, k); g = lerp(0x9E, 0x26, k); b = lerp(0x0B, 0x26, k);
  }
  return `rgb(${r},${g},${b})`;
}
