// Footprint chart sourced from the same taker trades as Volume Profile.
(() => {
  'use strict';
  const O = window.OI, volume = window.OI_volumeProfile;
  const selector = document.getElementById('chartType');
  if (!O || !volume || !selector) return;

  const TFS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  const BUY = '#38bdf8', SELL = '#f97316', NEUTRAL = '#a8b6c8', SPACING = 96;
  const scale = O.chart.timeScale();
  const candleFields = ['upColor', 'downColor', 'wickUpColor', 'wickDownColor'];
  const format = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toFixed(2);
  let previous = null;

  function fit() {
    scale.applyOptions({ barSpacing: SPACING, rightOffset: 1 });
    scale.scrollToRealTime();
  }
  let mode = 'candles', originalColors = null;
  function setMode(next) {
    if (next === mode) return;
    if (mode === 'footprint') {
      const { barSpacing, rightOffset, scroll, tf } = previous;
      scale.applyOptions({ barSpacing, rightOffset });
      if (tf === O.tf) scale.scrollToPosition(scroll, false);
      else scale.scrollToRealTime();
      previous = null;
      volume.setFootprint(false);
    }
    if (mode === 'candles') {
      const options = O.series.options();
      originalColors = Object.fromEntries(candleFields.map(key => [key, options[key]]));
      O.series.applyOptions(Object.fromEntries(candleFields.map(key => [key, 'transparent'])));
    }
    if (next === 'candles') O.series.applyOptions(originalColors);
    if (next === 'footprint') {
      const { barSpacing, rightOffset } = scale.options();
      previous = { candleColors: originalColors, barSpacing, rightOffset, scroll: scale.scrollPosition(), tf: O.tf };
      volume.setFootprint(true);
      fit();
    }
    mode = next;
    document.getElementById('chartTypeIcon').textContent = {candles:'▥',line:'∿',footprint:'☷'}[mode];
    O.markDirty();
  }
  const preferenceKey = 'oit_chart_type' + (O.psfx || '');
  function restoreMode() {
    let saved;
    try { saved = localStorage.getItem(preferenceKey); } catch (_) {}
    if (['line', 'footprint', 'candles'].includes(saved)) setMode(saved);
    selector.value = mode;
  }
  selector.addEventListener('change', () => {
    setMode(selector.value);
    try { localStorage.setItem(preferenceKey, mode); } catch (_) {}
  });

  function drawCloseLine(ctx, width, height) {
    if (width <= 0 || height <= 0) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    ctx.beginPath();
    let started = false;
    const spacing = scale.options().barSpacing;
    for (const bar of O.series.data()) {
      const x = scale.timeToCoordinate(bar.time);
      if (!Number.isFinite(x) || x < -spacing || x > width + spacing) continue;
      const y = O.series.priceToCoordinate(bar.close);
      if (!Number.isFinite(y)) { started = false; continue; }
      if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      started = true;
    }
    ctx.strokeStyle = '#71d7f5';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  function drawCandle(ctx, bar, x, colors) {
    const [open, high, low, close] = ['open', 'high', 'low', 'close'].map(key => O.series.priceToCoordinate(bar[key]));
    if (![open, high, low, close].every(Number.isFinite)) return;
    const up = bar.close >= bar.open;
    ctx.fillStyle = up ? colors.wickUpColor : colors.wickDownColor;
    ctx.fillRect(x, high, 1, Math.max(1, low - high));
    ctx.fillStyle = up ? colors.upColor : colors.downColor;
    ctx.fillRect(x - 3, Math.min(open, close), 7, Math.max(1, Math.abs(close - open)));
  }

  function drawBar(ctx, bar, x, half, height, shift, seconds, windowStart, windowEnd) {
    const start = (bar.time - O.tzShift) * 1000;
    const rows = volume.footprint(Math.max(start, windowStart), Math.min(start + seconds * 1000, windowEnd));
    if (!rows.length) return false;

    const yAt = price => O.series.priceToCoordinate(price - shift);
    const top = yAt(rows[0].price + 0.05), bottom = yAt(rows.at(-1).price - 0.05);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom < 0 || top >= height) return false;

    let max = 0, delta = 0;
    for (const { buy, sell } of rows) {
      max = Math.max(max, buy, sell);
      delta += buy - sell;
    }

    ctx.fillStyle = '#a8b6c85c';
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    for (const { price, buy, sell } of rows) {
      const a = yAt(price + 0.05), b = yAt(price - 0.05);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < 0 || a >= height) continue;
      const y = Math.round((a + b) / 2);
      const rowHeight = Math.max(1, Math.min(15, Math.floor(b - a) - 1));
      if (sell > 0) {
        const width = Math.max(1, half * sell / max);
        ctx.fillStyle = SELL;
        ctx.globalAlpha = 0.58;
        ctx.fillRect(x - 2 - width, y - rowHeight / 2, width, rowHeight);
      }
      if (buy > 0) {
        const width = Math.max(1, half * buy / max);
        ctx.fillStyle = BUY;
        ctx.globalAlpha = 0.58;
        ctx.fillRect(x + 2, y - rowHeight / 2, width, rowHeight);
      }
      ctx.globalAlpha = 1;
      if (rowHeight >= 10 && half >= 23) {
        ctx.fillStyle = '#edf3fc';
        ctx.textAlign = 'right';
        if (sell > 0) ctx.fillText(format(sell), x - 4, y, half - 2);
        ctx.textAlign = 'left';
        if (buy > 0) ctx.fillText(format(buy), x + 4, y, half - 2);
      }
    }
    if (bottom + 5 < height) {
      const value = Math.round(delta * 100) / 100;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = value > 0 ? BUY : value < 0 ? SELL : NEUTRAL;
      ctx.fillText('Δ ' + (value > 0 ? '+' : value < 0 ? '−' : '') + format(Math.abs(value)), x, Math.min(height - 7, bottom + 9), 2 * half + 2);
      ctx.font = '10px monospace';
    }
    return true;
  }

  O.hooks.push((ctx, w, h) => {
    if (mode === 'line') return drawCloseLine(ctx, scale.width(), h - scale.height());
    if (!previous) return;
    const width = scale.width(), height = h - scale.height();
    if (width <= 0 || height <= 0) return;
    const feed = window.OI_bigtr, shift = volume.offset();
    const half = Math.max(2, Math.min(57, scale.options().barSpacing / 2 - 5));
    const seconds = TFS[O.tf];
    const { start: windowStart, end: windowEnd } = volume.footprintWindow();
    let drawn = false;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.textBaseline = 'middle';
    ctx.font = '10px monospace';
    for (const bar of O.series.data()) {
      const x = scale.timeToCoordinate(bar.time);
      if (x === null || x < -half || x > width + half) continue;
      const reference = feed?.pxOff.get(bar.time);
      const basis = Number.isFinite(reference) ? reference - bar.close : shift;
      if (basis !== null && seconds && drawBar(ctx, bar, Math.round(x), half, height, basis, seconds, windowStart, windowEnd)) drawn = true;
      else drawCandle(ctx, bar, Math.round(x), previous.candleColors);
    }
    const venue = { binance: 'Binance', bitget: 'Bitget' }[feed?.src];
    const source = venue ? venue + ' XAUUSDT' : 'XAUUSDT';
    const detail = feed?.busy ? 'กำลังโหลดย้อนหลัง…'
      : drawn ? 'oz · เท่าที่รับได้'
      : feed?.status?.startsWith('โหลดไม่ได้') ? 'โหลด Footprint ไม่สำเร็จ'
      : 'ไม่มี Footprint ในช่วงที่เห็น';
    const caption = source + ' · ' + detail;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0b1728e8';
    ctx.fillRect(5, 5, ctx.measureText(caption).width + 10, 18);
    ctx.fillStyle = NEUTRAL;
    ctx.fillText(caption, 10, 14);
    ctx.restore();
  });

  window.OI_footprint = { get active() { return previous !== null; }, fit };
  restoreMode();
})();
