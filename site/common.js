/* Shared helpers for CodeLove Admin: formatting, dates, range state, icons, dropdowns, charts, tables. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const CFG = window.ADMIN_CONFIG || {};

  const store = {
    get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
    set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---------- formatting ----------
  const nf = new Intl.NumberFormat('en-IN');
  const num = (n) => nf.format(Math.round(n || 0));
  const compact = (n) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  const pct = (n) => (n == null || !isFinite(n) ? '–' : (n * 100).toFixed(1) + '%');
  function dur(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + 's';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h >= 24) { const d = Math.floor(h / 24); return `${d}d ${h % 24}h`; }
    if (h) return `${h}h ${m}m`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  // Axis tick labels. Ticks are multiples of a step from axisMax(), so they come out whole.
  const durAxis = (v) => { v = Math.round(v); return v && v % 86400 === 0 ? v / 86400 + 'd' : v && v % 3600 === 0 ? v / 3600 + 'h' : v && v % 60 === 0 ? v / 60 + 'm' : v + 's'; };
  durAxis.kind = 'dur';
  const pctAxis = (v) => Math.round(v * 100) + '%';
  pctAxis.kind = 'pct';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const div = (a, b) => (b ? a / b : 0);

  // ---------- dates (local calendar days; the site runs in IST) ----------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const istToday = () => parseIso(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const fmtDate = (s) => parseIso(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const rangeText = (R) => (R.start === R.end ? fmtDate(R.start) : `${fmtDate(R.start)} – ${fmtDate(R.end)}`);
  function shortRange(start, end) {
    const a = parseIso(start), b = parseIso(end), y = istToday().getFullYear();
    const f = (d, withYear) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
    if (start === end) return f(a, a.getFullYear() !== y);
    const yrs = a.getFullYear() !== b.getFullYear() || b.getFullYear() !== y;
    return `${f(a, yrs)} – ${f(b, yrs)}`;
  }
  function eachDay(start, end, fn) { for (let d = parseIso(start); d <= parseIso(end); d = addDays(d, 1)) fn(iso(d), d); }

  // ---------- date range state (shared by both sections) ----------
  const PRESETS = [
    { v: 'today', label: 'Today' },
    { v: 'yesterday', label: 'Yesterday' },
    { v: '7', label: 'Last 7 days' },
    { v: '28', label: 'Last 28 days' },
    { v: '90', label: 'Last 90 days' },
    { v: '365', label: 'Last 12 months' },
    { v: 'mtd', label: 'This month' },
    { v: 'lastmonth', label: 'Last month' },
    { v: 'since', label: 'Since tracking started' },
  ];
  const range = { preset: '28', from: '', to: '' };
  (() => {
    const p = store.get('cl_admin_range');
    if (p && (p === 'custom' || PRESETS.some((x) => x.v === p))) range.preset = p;
    range.from = store.get('cl_admin_from') || '';
    range.to = store.get('cl_admin_to') || '';
    if (range.preset === 'custom' && !(range.from && range.to)) range.preset = '28';
  })();
  function rangeBounds(preset, from, to) {
    const today = istToday();
    let start, end = today;
    switch (preset) {
      case 'today': start = today; break;
      case 'yesterday': start = end = addDays(today, -1); break;
      case 'mtd': start = new Date(today.getFullYear(), today.getMonth(), 1); break;
      case 'lastmonth': start = new Date(today.getFullYear(), today.getMonth() - 1, 1); end = new Date(today.getFullYear(), today.getMonth(), 0); break;
      case 'since': start = CFG.trackingSince ? parseIso(CFG.trackingSince) : addDays(today, -27); if (start > today) start = today; break;
      case 'custom':
        start = from ? parseIso(from) : addDays(today, -27);
        end = to ? parseIso(to) : today;
        if (start > end) [start, end] = [end, start];
        break;
      default: start = addDays(today, -((Number(preset) || 28) - 1));
    }
    return { start: iso(start), end: iso(end) };
  }
  function currentRange() {
    const { start, end } = rangeBounds(range.preset, range.from, range.to);
    const days = Math.round((parseIso(end) - parseIso(start)) / 864e5) + 1;
    const prevEnd = addDays(parseIso(start), -1), prevStart = addDays(prevEnd, -(days - 1));
    return { start, end, prevStart: iso(prevStart), prevEnd: iso(prevEnd), days, preset: range.preset };
  }
  function setRange(preset, from = '', to = '') {
    range.preset = preset;
    store.set('cl_admin_range', preset);
    if (preset === 'custom') { range.from = from; range.to = to; store.set('cl_admin_from', from); store.set('cl_admin_to', to); }
  }
  const rangeLabel = () => (PRESETS.find((p) => p.v === range.preset) || { label: 'Custom range' }).label;

  // ---------- icons (inline, stroke = currentColor) ----------
  const ICONS = {
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.48M7.76 16.24a6 6 0 0 1 0-8.48M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M5 12.5 10 17.5 19 7"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    bars: '<path d="M6 20v-6M12 20V8M18 20V4"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  };
  const icon = (name, cls = '') => `<svg class="ic ic-${name}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  // Site favicon; falls back to the site's first letter when the icon can't load.
  const favicon = (host) => {
    const h = String(host || '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
    const letter = (h.replace(/^www\./, '').charAt(0) || '?').toUpperCase();
    return `<img class="fav" src="https://${h}/favicon.ico" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'fav fav-x',textContent:'${letter}'}))">`;
  };

  // ---------- popover / dropdown ----------
  let openPop = null;
  function closePop(focusBack = true) {
    if (!openPop) return;
    const { el, scrim, trigger } = openPop;
    openPop = null;
    el.remove(); if (scrim) scrim.remove();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('open');
    if (focusBack && document.contains(trigger)) trigger.focus({ preventScroll: true });
  }
  function place(el, trigger, align) {
    const r = trigger.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
    el.style.minWidth = Math.max(r.width, 230) + 'px';
    const w = el.offsetWidth;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const top = r.bottom + 6;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.maxHeight = Math.max(220, vh - top - 12) + 'px';
  }
  /** Opens a popover under `trigger`; build(el, close) fills it. Clicking the trigger again closes it. */
  function popover(trigger, build, opts = {}) {
    if (openPop && openPop.trigger === trigger) { closePop(); return null; }
    closePop(false);
    const sheet = innerWidth < 560;
    const el = document.createElement('div');
    el.className = 'pop' + (sheet ? ' sheet' : '') + (opts.cls ? ' ' + opts.cls : '');
    let scrim = null;
    if (sheet) { scrim = document.createElement('div'); scrim.className = 'pop-scrim'; document.body.append(scrim); }
    document.body.append(el);
    openPop = { el, scrim, trigger };
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('open');
    build(el, (back = true) => closePop(back));
    if (!sheet) place(el, trigger, opts.align);
    const first = el.querySelector('[data-autofocus]') || el.querySelector('.mi[aria-selected="true"]') || el.querySelector('.mi, input, button');
    if (first && !sheet) first.focus({ preventScroll: true });
    return el;
  }
  document.addEventListener('pointerdown', (e) => {
    if (openPop && !openPop.el.contains(e.target) && !openPop.trigger.contains(e.target)) closePop(false);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!openPop) return;
    if (e.key === 'Escape') { e.preventDefault(); closePop(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = $$('.mi', openPop.el).filter((x) => !x.hidden && !x.disabled);
      if (!items.length) return;
      e.preventDefault();
      let i = items.indexOf(document.activeElement);
      i = e.key === 'ArrowDown' ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1;
      items[i].focus();
    }
  });
  addEventListener('resize', () => { if (openPop && !openPop.el.classList.contains('sheet')) closePop(false); });

  /** Single-select dropdown. items: [{value, label, icon?, hint?} | {sep:true}] */
  function selectMenu(trigger, { items, value, onSelect, search, title, align }) {
    return popover(trigger, (el, close) => {
      el.innerHTML = `${title ? `<div class="pop-title">${esc(title)}</div>` : ''}${search ? `<div class="pop-search">${icon('search')}<input type="search" data-autofocus placeholder="${esc(search)}" aria-label="${esc(search)}" autocomplete="off"></div>` : ''}
        <div class="pop-list" role="listbox">${items.map((it, i) => (it.sep ? '<div class="pop-sep" role="separator"></div>' : `<button type="button" class="mi" role="option" data-i="${i}" aria-selected="${it.value === value}">${icon('check', 'mi-check')}${it.icon || ''}<span class="mi-label">${esc(it.label)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}</button>`)).join('')}</div>
        <div class="pop-empty" hidden>No match</div>`;
      $$('.mi', el).forEach((b) => b.addEventListener('click', () => { const it = items[+b.dataset.i]; close(); onSelect(it.value); }));
      const input = $('input[type=search]', el);
      if (input) {
        input.addEventListener('input', () => {
          const q = input.value.trim().toLowerCase();
          let any = false;
          $$('.mi', el).forEach((b) => { const hit = !q || items[+b.dataset.i].label.toLowerCase().includes(q); b.hidden = !hit; any ||= hit; });
          $$('.pop-sep', el).forEach((s) => (s.hidden = !!q));
          $('.pop-empty', el).hidden = any;
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $$('.mi', el).find((x) => !x.hidden); if (b) b.click(); } });
      }
    }, { align });
  }

  // ---------- tooltip ----------
  const tip = $('#tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 14, top = y - h - 12;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (top < 8) top = y + 16;
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = top + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  addEventListener('scroll', hideTip, { passive: true });

  // ---------- charts ----------
  // Nice axis: max = n × step, step from 1/2/2.5/5 × 10^k (whole numbers for counts), or a clock step for durations.
  function niceStep(raw, whole) {
    if (whole && raw <= 1) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5]) { const s = m * p; if (s >= raw * 0.9999 && (!whole || Number.isInteger(s))) return s; }
    return 10 * p;
  }
  const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 345600, 604800, 1209600, 2592000];
  function axisMax(v, kind, n = 4) {
    if (!(v > 0)) return kind === 'pct' ? 1 : kind === 'dur' ? 60 * n : n;
    const raw = v / n;
    if (kind === 'dur') return (TIME_STEPS.find((t) => t >= raw) || niceStep(raw / 86400, true) * 86400) * n;
    if (kind === 'pct') return Math.min(1, niceStep(raw) * n);
    return niceStep(raw, true) * n;
  }
  let gid = 0;
  // Single-series area chart with crosshair tooltip. pts: [{label, short, ...values}], summary(p) -> html
  function lineChart(el, pts, key, fmt, axisFmt, summary) {
    el.innerHTML = '';
    if (!pts.length) { el.innerHTML = '<div class="chart-empty">No data in this range</div>'; return; }
    const W = el.clientWidth || 600, H = el.clientHeight || 260;
    const pad = { l: 48, r: 14, t: 12, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = axisMax(Math.max(...pts.map((p) => p[key] || 0)), axisFmt.kind);
    const x = (i) => pad.l + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1));
    const y = (v) => pad.t + ih - ((v || 0) / max) * ih;
    const id = 'ag' + ++gid;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(key)} over time"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--series)" stop-opacity=".22"/><stop offset="1" stop-color="var(--series)" stop-opacity="0"/></linearGradient></defs>`;
    for (let i = 1; i <= 4; i++) {
      const v = (max * i) / 4, yy = y(v);
      s += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="tick" x="${pad.l - 8}" y="${yy + 4}" text-anchor="end">${esc(axisFmt(v))}</text>`;
    }
    s += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/><text class="tick" x="${pad.l - 8}" y="${y(0) + 4}" text-anchor="end">0</text>`;
    const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(iw / 72))));
    pts.forEach((p, i) => { if (i % step === 0) s += `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.short)}</text>`; });
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    if (pts.length > 1) s += `<path fill="url(#${id})" d="${line}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z"/>`;
    s += `<path class="line" d="${line}"/>`;
    if (pts.length === 1) s += `<circle class="dot" cx="${x(0)}" cy="${y(pts[0][key])}" r="5"/>`;
    s += `<line class="cross" y1="${pad.t}" y2="${y(0)}" visibility="hidden"/><circle class="dot hov" r="5" visibility="hidden"/>`;
    s += `<rect x="${pad.l - 10}" y="0" width="${iw + 20}" height="${H}" fill="transparent" class="hit"/></svg>`;
    el.innerHTML = s;
    const svg = el.firstChild, cx = $('.cross', svg), cd = $('.hov', svg), hit = $('.hit', svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(pts.length === 1 ? 0 : ((px - pad.l) / iw) * (pts.length - 1))));
      const p = pts[i];
      cx.setAttribute('x1', x(i)); cx.setAttribute('x2', x(i)); cx.setAttribute('visibility', 'visible');
      cd.setAttribute('cx', x(i)); cd.setAttribute('cy', y(p[key])); cd.setAttribute('visibility', 'visible');
      showTip(`<b>${esc(fmt(p[key] || 0))}</b><span class="muted">${esc(p.label)}</span>${summary ? `<span class="tip-sum">${summary(p)}</span>` : ''}`, ev.clientX, ev.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cx.setAttribute('visibility', 'hidden'); cd.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  /** KPI tiles that double as the chart's metric switch, plus a table view of the same points.
   * metrics: [{k, label, value (html), delta (html), fmt, axis}] — every metric must exist on each point. */
  function kpiChart({ metrics, pts, storeKey, summary, unit = 'day', note = '' }) {
    const card = document.createElement('section');
    card.className = 'card kc';
    card.innerHTML = `<div class="kc-tabs" role="tablist" aria-label="Metric">${metrics.map((m) => `<button type="button" role="tab" class="kc-tab" data-k="${m.k}"><span class="kc-label">${esc(m.label)}</span><span class="kc-value">${m.value}</span>${m.delta || ''}</button>`).join('')}</div>
      <div class="kc-body"><div class="kc-head"><h2 class="kc-title"></h2><button type="button" class="link-btn kc-toggle">Table view</button></div><div class="chart"></div><div class="kc-table" hidden></div>${note ? `<p class="note">${note}</p>` : ''}</div>`;
    const el = $('.chart', card), tbl = $('.kc-table', card), toggle = $('.kc-toggle', card), titleEl = $('.kc-title', card);
    let k = store.get(storeKey);
    if (!metrics.some((m) => m.k === k)) k = metrics[0].k;
    let asTable = false;
    const draw = () => {
      const m = metrics.find((x) => x.k === k);
      $$('.kc-tab', card).forEach((b) => { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      titleEl.textContent = `${m.label} by ${unit}`;
      if (!asTable) lineChart(el, pts, k, m.fmt, m.axis, summary);
    };
    $$('.kc-tab', card).forEach((b) => b.addEventListener('click', () => { k = b.dataset.k; store.set(storeKey, k); draw(); }));
    toggle.addEventListener('click', () => {
      asTable = !asTable;
      el.hidden = asTable; tbl.hidden = !asTable;
      toggle.textContent = asTable ? 'Chart view' : 'Table view';
      if (asTable) table(tbl, [{ key: 'iso', label: unit === 'hour' ? 'Hour' : 'Date', html: (r) => esc(r.label) }, ...metrics.map((m) => ({ key: m.k, label: m.label, num: true, fmt: m.fmt }))], pts.slice(), { sort: 'iso', pageSize: 60 });
      else draw();
    });
    let w = 0;
    new ResizeObserver(() => { if (el.clientWidth && el.clientWidth !== w) { w = el.clientWidth; draw(); } }).observe(el);
    draw();
    return card;
  }

  // Vertical columns (e.g. 24 hours). items: [{label, value, tip}]
  function columns(el, items, fmt) {
    const draw = () => {
      const W = el.clientWidth || 600, H = el.clientHeight || 190;
      const pad = { l: 38, r: 6, t: 8, b: 22 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      const max = axisMax(Math.max(0, ...items.map((i) => i.value)), 'count');
      const bw = iw / items.length, gap = Math.max(2, Math.min(4, bw * 0.25));
      let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`;
      for (let i = 1; i <= 4; i++) { const yy = pad.t + ih - (ih * i) / 4; s += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="tick" x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${compact((max * i) / 4)}</text>`; }
      s += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>`;
      const every = Math.ceil(items.length / Math.max(2, Math.floor(iw / 34)));
      items.forEach((it, i) => {
        const h = (it.value / max) * ih, x0 = pad.l + i * bw + gap / 2, w = Math.max(1, bw - gap), y0 = pad.t + ih - h;
        const r = Math.min(4, w / 2, h);
        if (h > 0) s += `<path class="col" data-i="${i}" d="M${x0},${pad.t + ih}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${pad.t + ih}Z"/>`;
        s += `<rect class="colhit" data-i="${i}" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}" fill="transparent"/>`;
        if (i % every === 0) s += `<text class="tick" x="${x0 + w / 2}" y="${H - 6}" text-anchor="middle">${esc(it.label)}</text>`;
      });
      el.innerHTML = s + '</svg>';
      el.querySelectorAll('.colhit').forEach((r) => {
        const it = items[+r.dataset.i], col = el.querySelector(`.col[data-i="${r.dataset.i}"]`);
        const f = (ev) => { if (col) col.classList.add('hov'); showTip(`<b>${esc(fmt(it.value))}</b><span class="muted">${esc(it.tip || it.label)}</span>`, ev.clientX, ev.clientY); };
        r.addEventListener('pointermove', f); r.addEventListener('pointerdown', f);
        r.addEventListener('pointerleave', () => { if (col) col.classList.remove('hov'); hideTip(); });
      });
    };
    let w = 0;
    new ResizeObserver(() => { if (el.clientWidth && el.clientWidth !== w) { w = el.clientWidth; draw(); } }).observe(el);
  }

  // Tiny sparkline (no axes) for site cards.
  function sparkline(values) {
    const W = 120, H = 32, max = Math.max(1, ...values);
    if (values.length < 2) return '';
    const pts = values.map((v, i) => `${((i * W) / (values.length - 1)).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="M${pts.join('L')}L${W},${H}L0,${H}Z" class="spark-area"/><path d="M${pts.join('L')}" class="spark-line"/></svg>`;
  }

  /** Change vs previous period. opts.none = text when there's nothing to compare with. */
  function deltaHtml(cur, prev, opts = {}) {
    if (opts.none) return `<span class="delta">${esc(opts.none)}</span>`;
    if (!prev) return '<span class="delta">no data before</span>';
    const ch = (cur - prev) / prev;
    if (Math.abs(ch) < 0.0005) return '<span class="delta">same as before</span>';
    const good = opts.lower ? ch < 0 : ch > 0;
    return `<span class="delta ${good ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(1)}% <span class="muted">vs prev</span></span>`;
  }

  // ---------- tables & lists ----------
  // Sortable, searchable table. cols: {key,label,num?,fmt?,bar?,html?,cls?}
  function table(container, cols, data, opts = {}) {
    let sortKey = opts.sort || cols.find((c) => c.num)?.key, asc = false, q = '', shown = opts.pageSize || 50;
    container.innerHTML = `${opts.search ? `<div class="table-tools"><label class="search">${icon('search')}<input type="search" placeholder="${esc(opts.search)}" aria-label="Search"></label><span class="muted count"></span></div>` : ''}<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th data-k="${c.key}" class="${c.num ? 'num' : ''}" tabindex="0" aria-sort="none">${esc(c.label)}</th>`).join('')}</tr></thead><tbody></tbody></table></div><div class="more"></div>`;
    const tbody = $('tbody', container), more = $('.more', container), count = $('.count', container);
    const draw = () => {
      const d = q ? data.filter((r) => cols.some((c) => !c.num && String(r[c.key] ?? '').toLowerCase().includes(q)) || String(r.title || '').toLowerCase().includes(q)) : data.slice();
      const col = cols.find((c) => c.key === sortKey);
      d.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; const r = col?.num ? (x ?? -1) - (y ?? -1) : String(x).localeCompare(String(y)); return asc ? r : -r; });
      const maxes = {};
      cols.filter((c) => c.bar).forEach((c) => (maxes[c.key] = Math.max(1, ...d.map((r) => r[c.key] || 0))));
      tbody.innerHTML = d.slice(0, shown).map((r) => `<tr>${cols.map((c) => {
        const v = c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key]);
        if (c.bar) return `<td class="num"><span class="cellbar"><span>${v}</span><i style="width:${Math.round(((r[c.key] || 0) / maxes[c.key]) * 56)}px"></i></span></td>`;
        return `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${v}</td>`;
      }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty-row">No data yet</td></tr>`;
      container.querySelectorAll('th').forEach((th) => {
        const on = th.dataset.k === sortKey;
        th.classList.toggle('sorted', on); th.classList.toggle('asc', on && asc);
        th.setAttribute('aria-sort', on ? (asc ? 'ascending' : 'descending') : 'none');
      });
      if (count) count.textContent = `${num(d.length)} ${d.length === 1 ? 'row' : 'rows'}`;
      more.innerHTML = d.length > shown ? `<button class="btn">Show more (${num(d.length - shown)} left)</button>` : '';
      const btn = $('button', more); if (btn) btn.onclick = () => { shown += 100; draw(); };
    };
    const sortBy = (th) => { if (sortKey === th.dataset.k) asc = !asc; else { sortKey = th.dataset.k; asc = false; } draw(); };
    container.querySelectorAll('th').forEach((th) => {
      th.addEventListener('click', () => sortBy(th));
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(th); } });
    });
    const input = $('input[type=search]', container);
    if (input) input.addEventListener('input', () => { q = input.value.trim().toLowerCase(); shown = opts.pageSize || 50; draw(); });
    draw();
  }

  function barList(title, items, fmt = num, opts = {}) {
    const max = Math.max(1, ...items.map((i) => i.value));
    const total = opts.total ?? items.reduce((a, i) => a + i.value, 0);
    return `<section class="card"><div class="card-head"><h2>${esc(title)}</h2>${opts.right || ''}</div>${items.length ? `<ul class="bars">${items.map((i) => `<li title="${esc(i.name)}: ${esc(fmt(i.value))}"><span class="name">${i.html || esc(i.name || '(not set)')}</span><span class="val"><b>${esc(fmt(i.value))}</b>${opts.noPct ? '' : `<span class="muted"> ${pct(div(i.value, total))}</span>`}</span><span class="track"><i style="width:${Math.max(1, (i.value / max) * 100)}%"></i></span></li>`).join('')}</ul>` : '<p class="empty">No data yet</p>'}</section>`;
  }

  // ---------- page chrome ----------
  const app = $('#app');
  /** Header at the top of a view. */
  function pageHead(eyebrow, title, sub, right = '') {
    return `<div class="page-head"><div class="ph-text"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${right ? `<div class="ph-right">${right}</div>` : ''}</div>`;
  }
  /** While data reloads, keep the previous render dimmed instead of flashing a spinner. */
  function loading(msg = 'Loading…') {
    if (app.dataset.filled) app.classList.add('busy');
    else app.innerHTML = `<div class="loading"><span class="spinner"></span>${esc(msg)}</div>`;
  }
  /** Replace the view. keep=false for sign-in / error screens (next load shows the spinner again). */
  function paint(html, keep = true) {
    app.classList.remove('busy');
    if (keep) app.dataset.filled = '1'; else delete app.dataset.filled;
    app.innerHTML = html;
  }
  const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

  window.CL = {
    $, $$, store, num, compact, pct, dur, durAxis, pctAxis, esc, div, iso, addDays, parseIso, istToday, fmtDate, rangeText, shortRange, eachDay,
    PRESETS, range, rangeBounds, currentRange, setRange, rangeLabel, axisMax,
    icon, favicon, popover, closePop, selectMenu,
    showTip, hideTip, lineChart, kpiChart, columns, sparkline, deltaHtml, table, barList,
    pageHead, loading, paint, el,
  };
})();
