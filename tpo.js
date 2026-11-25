// Session Market Profile. One TPO per price row touched by a time block.
(function (root) {
  'use strict';
  const DAY = 86400, SESSION_START = 5 * 3600;
  const sessionOf = time => Math.floor((time - SESSION_START) / DAY) * DAY + SESSION_START;
  function profile(rows, percent) {
    const levels = [...rows.keys()].sort((a, b) => a - b);
    const counts = levels.map(level => rows.get(level));
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (!total) return null;
    const midpoint = (levels[0] + levels.at(-1)) / 2;
    let poc = 0;
    for (let i = 1; i < levels.length; i++) {
      if (counts[i] > counts[poc] || (counts[i] === counts[poc] &&
          Math.abs(levels[i] - midpoint) < Math.abs(levels[poc] - midpoint))) poc = i;
    }
    let low = poc, high = poc, included = counts[poc];
    while (included < total * percent / 100 && (low > 0 || high < levels.length - 1)) {
      const below = low > 0 ? counts[low - 1] : -1;
      const above = high < levels.length - 1 ? counts[high + 1] : -1;
      if (above > below || (above === below && high - poc <= poc - low)) included += counts[++high];
      else included += counts[--low];
    }
    return { rows, poc: levels[poc], low: levels[low], high: levels[high], max: counts[poc] };
  }

  function build(bars, rowSize, percent, days) {
    const sessions = new Map();
    const ordered = [...new Map(bars.map(bar => [bar.time, bar])).values()].sort((a, b) => a.time - b.time);
    for (const bar of ordered) {
      if (![bar.time, bar.low, bar.high].every(Number.isFinite) || bar.high < bar.low) continue;
      const first = Math.floor(bar.low / rowSize + 1e-9);
      const last = Math.floor(bar.high / rowSize + 1e-9);
      if (last - first > 10000) continue;
      const start = sessionOf(bar.time);
      let rows = sessions.get(start);
      if (!rows) sessions.set(start, rows = new Map());
      for (let level = first; level <= last; level++) rows.set(level, (rows.get(level) || 0) + 1);
    }
    return [...sessions].slice(-days).map(([start, rows]) => ({ start, ...profile(rows, percent) }));
  }
  if (typeof module === 'object' && module.exports) module.exports = { build, sessionOf };
  const O = root.OI;
  if (!O?.hooks || !O.fetchTF) return;
  const $ = id => document.getElementById(id);
  const key = 'oit_tpo' + (O.psfx || '');
  const cfg = { enabled: true, block: 30, row: 1, area: 70, days: 3 };
  const limits = { row: [0.1, 100], area: [1, 100], days: [1, 5] };
  function valid(name, value) {
    if (name === 'block') return [15, 30, 60].includes(value);
    const range = limits[name];
    return range && Number.isFinite(value) && value >= range[0] && value <= range[1] &&
      (name === 'row' || Number.isInteger(value));
  }
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (typeof saved?.enabled === 'boolean') cfg.enabled = saved.enabled;
    for (const name of ['block', ...Object.keys(limits)]) {
      if (valid(name, saved?.[name])) cfg[name] = saved[name];
    }
  } catch (_) {}
  let bars = [], profiles = [], dataBlock = null, busy = false, status = '';
  const scale = O.chart.timeScale();
  function rebuild() {
    profiles = dataBlock === cfg.block ? build(bars, cfg.row, cfg.area, cfg.days) : [];
    O.markDirty();
  }
  function showStatus(message) {
    status = message;
    const node = $('tpoStatus');
    if (node) node.textContent = status;
  }
  async function refresh() {
    if (!cfg.enabled || busy || O.paused || document.hidden) return;
    const block = cfg.block;
    busy = true;
    if (!profiles.length) showStatus('กำลังโหลด TPO…');
    try {
      const tf = { 15: '15m', 30: '30m', 60: '1h' }[block];
      const data = await O.fetchTF(tf, block === 15 ? 1000 : 300);
      if (block !== cfg.block) return;
      if (!data?.length) { showStatus('ยังโหลดข้อมูล TPO ไม่ได้'); return; }
      bars = data;
      dataBlock = block;
      rebuild();
      showStatus('');
    } catch (_) { showStatus('ยังโหลดข้อมูล TPO ไม่ได้'); }
    finally {
      busy = false;
      if (block !== cfg.block) void refresh();
    }
  }

  function barIndex(data, time) {
    let lo = 0, hi = data.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (data[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  O.hooks.push((ctx, w, h) => {
    if (!cfg.enabled || !profiles.length || O.tf === '1d') return;
    const candles = O.series.data();
    if (!candles.length) return;
    const width = scale.width(), height = h - scale.height();
    const spacing = scale.options().barSpacing || 6;
    const yAt = price => O.series.priceToCoordinate(price);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    ctx.font = '10px monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    for (const p of profiles) {
      const first = barIndex(candles, p.start);
      const after = barIndex(candles, p.start + DAY);
      if (first >= after) continue;
      const startX = scale.timeToCoordinate(candles[first].time);
      const lastX = scale.timeToCoordinate(candles[after - 1].time);
      if (!Number.isFinite(startX) || !Number.isFinite(lastX)) continue;
      const left = startX - spacing / 2, right = Math.min(width, lastX + spacing / 2);
      if (right <= 0 || left >= width) continue;
      const maxWidth = Math.min(98, Math.max(spacing, (lastX + spacing / 2 - left) * 0.42));
      for (const [level, count] of p.rows) {
        const top = yAt((level + 1) * cfg.row), bottom = yAt(level * cfg.row);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom < 0 || top > height) continue;
        ctx.fillStyle = level === p.poc ? '#f2bc50b8' : level >= p.low && level <= p.high ? '#49c8cd70' : '#8194ae42';
        ctx.fillRect(left, top, Math.min(right - left, maxWidth * count / p.max), Math.max(1, bottom - top - 0.5));
      }
      for (const [name, price, color] of [
        ['TPO POC', (p.poc + 0.5) * cfg.row, '#f2bc50'],
        ['VAH', (p.high + 1) * cfg.row, '#72d9db'],
        ['VAL', p.low * cfg.row, '#72d9db']
      ]) {
        const y = yAt(price);
        if (!Number.isFinite(y) || y < 0 || y > height) continue;
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.setLineDash(name === 'TPO POC' ? [] : [4, 3]);
        ctx.beginPath(); ctx.moveTo(Math.max(0, left), y); ctx.lineTo(right, y); ctx.stroke();
        if (right - Math.max(0, left) >= 72) {
          ctx.fillStyle = color;
          ctx.fillText(name + ' ' + price.toFixed(2), Math.max(0, left) + 3, Math.max(11, y - 2), right - Math.max(0, left) - 3);
        }
      }
    }
    ctx.restore();
  });

  const menu = $('indMenu');
  function mount() {
    if (!menu || menu.hidden || $('tpoBox')) return;
    const section = document.createElement('div');
    section.id = 'tpoBox';
    section.className = 'gsbox';
    section.innerHTML = `<div class="row"><button type="button" class="gsb${cfg.enabled ? ' on' : ''}" aria-pressed="${cfg.enabled}" data-tpo-toggle>TPO · Market Profile</button></div>
      <div class="row ps">
        <label>ช่วงเวลา<select data-tpo="block">${[15, 30, 60].map(n => `<option value="${n}"${n === cfg.block ? ' selected' : ''}>${n} นาที</option>`).join('')}</select></label>
        <label>ระดับราคา ($)<input type="number" min="0.1" max="100" step="any" value="${cfg.row}" data-tpo="row"></label>
        <label>Value Area (%)<input type="number" min="1" max="100" value="${cfg.area}" data-tpo="area"></label>
        <label>วันเทรดย้อนหลัง<input type="number" min="1" max="5" value="${cfg.days}" data-tpo="days"></label>
      </div><span class="gsinfo">เริ่มวัน 05:00 น. เวลาไทย · ใช้บนกราฟระหว่างวัน</span><span class="gsinfo" id="tpoStatus" role="status"></span>`;
    const anchor = menu.querySelector('.t');
    if (anchor) anchor.after(section);
    else menu.prepend(section);
    showStatus(status);
  }
  function save() {
    try { localStorage.setItem(key, JSON.stringify(cfg)); } catch (_) {}
  }
  if (menu) {
    new MutationObserver(mount).observe(menu, { childList: true });
    menu.addEventListener('click', event => {
      const button = event.target.closest('[data-tpo-toggle]');
      if (!button) return;
      cfg.enabled = !cfg.enabled;
      button.classList.toggle('on', cfg.enabled);
      button.setAttribute('aria-pressed', String(cfg.enabled));
      save(); O.markDirty();
      if (cfg.enabled) void refresh();
      else showStatus('');
    });
    menu.addEventListener('change', event => {
      const input = event.target.closest('[data-tpo]');
      if (!input) return;
      const name = input.dataset.tpo, value = Number(input.value);
      if (!valid(name, value)) { input.value = cfg[name]; return; }
      cfg[name] = value;
      save(); rebuild(); void refresh();
    });
    mount();
  }
  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', refresh);
  setTimeout(refresh, 1200);
})(typeof window === 'undefined' ? globalThis : window);
