// Breakout thresholds for each candle, using only its 20 predecessors.
(() => {
  'use strict';
  const O = window.OI;
  const summary = document.querySelector('dialog[aria-label="ตาราง Donchian Trend"] .summary');
  if (!O || !summary) return;
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  const key = 'oit_donchian_channel' + O.psfx;
  toggle.checked = true;
  try { toggle.checked = localStorage.getItem(key) !== '0'; } catch {}
  const label = document.createElement('label');
  label.append(toggle, ' แสดง Don Up / Don Low (20 แท่ง)');
  summary.before(label);

  const options = { lineType: 1, lineWidth: 1, lineStyle: 2, priceLineVisible: false, crosshairMarkerVisible: false };
  const up = O.chart.addLineSeries({ ...options, title: 'Don Up', color: '#20ca88' });
  const low = O.chart.addLineSeries({ ...options, title: 'Don Low', color: '#ff7900' });
  let previous = '';
  function refresh() {
    if (document.hidden) return;
    const raw = O.rawBars;
    const visible = toggle.checked && O.tf === O.displayedTF;
    const signature = visible
      ? [O.tf, O.src, O.adj, raw.length, raw[0]?.[0], raw.at(-2)?.join(','), raw.at(-1)?.[0]].join('|')
      : 'off';
    if (signature === previous) return;
    previous = signature;
    const bars = visible ? O.chartBars() : [];
    const highs = [], lows = [];
    for (let i = 20; i < bars.length; i++) {
      const prior = bars.slice(i - 20, i);
      highs.push({ time: bars[i].time, value: Math.max(...prior.map(bar => bar.high)) });
      lows.push({ time: bars[i].time, value: Math.min(...prior.map(bar => bar.low)) });
    }
    up.setData(highs);
    low.setData(lows);
  }
  toggle.onchange = () => {
    try { localStorage.setItem(key, toggle.checked ? '1' : '0'); } catch {}
    refresh();
  };
  setInterval(refresh, 1200);
  refresh();
})();
