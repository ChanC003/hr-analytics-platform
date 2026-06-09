'use strict';

const RENDERERS = {
  status: renderStatus,
  ml:     renderML,
};

function showTab(tab) {
  STATE.tab = tab;
  document.querySelectorAll('.nav-item').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p =>
    p.classList.toggle('active', p.id === 'panel-' + tab));
  RENDERERS[tab]();
  persistState();
}

(function init() {
  // Trục thời gian — danh sách tháng duy nhất, sort tăng dần
  DATA._months = [...new Set(DATA.headcount.map(r => r.year_month_key))].sort();

  restoreState();
  if (!RENDERERS[STATE.tab]) STATE.tab = 'status';
  // Mặc định range = full nếu chưa restore
  if (STATE.mStart == null) STATE.mStart = 0;
  if (STATE.mEnd   == null) STATE.mEnd = DATA._months.length - 1;

  // Wire nav item clicks
  document.getElementById('nav').addEventListener('click', e => {
    const btn = e.target.closest('.nav-item[data-tab]');
    if (btn) showTab(btn.dataset.tab);
  });

  // Meta nguồn dữ liệu
  const meta = document.getElementById('gen-meta');
  if (meta) meta.textContent = DATA.generated_at ? `Dữ liệu: ${DATA.generated_at.slice(0, 10)}` : '';

  // Re-render on resize (debounce)
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt); rt = setTimeout(() => RENDERERS[STATE.tab](), 150);
  });

  showTab(STATE.tab);
})();
