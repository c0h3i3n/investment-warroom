// Progressive enhancement; stored display preferences never affect market data.
(() => {
  const button = document.getElementById('ticker-toggle');
  const content = document.getElementById('ticker-content');
  let collapsed = false;
  try { collapsed = localStorage.getItem('warroom_ticker_collapsed') === 'true'; } catch {}
  function render() {
    content.hidden = collapsed;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.textContent = collapsed ? '展開跑馬燈' : '收合跑馬燈';
  }
  if (button && content) {
    render();
    button.addEventListener('click', () => {
      collapsed = !collapsed;
      render();
      try { localStorage.setItem('warroom_ticker_collapsed', String(collapsed)); } catch {}
    });
  }
  const chart = document.getElementById('ind-chart');
  const output = document.getElementById('chart-detail');
  if (!chart || !output) return;
  const select = event => {
    const point = event.target.closest('[data-chart-detail]');
    if (!point) return;
    chart.querySelectorAll('[data-chart-detail]').forEach(el => {
      el.classList.toggle('selected', el === point);
      el.setAttribute('tabindex', el === point ? '0' : '-1');
    });
    output.textContent = point.dataset.chartDetail;
  };
  ['pointerover','focusin','click'].forEach(name => chart.addEventListener(name, select));
  chart.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const points = [...chart.querySelectorAll('[data-chart-detail]')];
    const index = points.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? points.length-1
      : Math.max(0,Math.min(points.length-1,index+(event.key === 'ArrowRight' ? 1 : -1)));
    points[next].focus();
  });
})();
