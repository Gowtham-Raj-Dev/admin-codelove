/* Shared helpers for CodeLove Admin: formatting, dates, storage, charts, tables. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);

  const store = {
    get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
    set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch { /* ignore */ } },
  };

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
  const durAxis = (v) => (v < 60 ? Math.round(v) + 's' : v < 3600 ? Math.round(v / 60) + 'm' : v < 86400 ? (v / 3600).toFixed(v < 36000 ? 1 : 0).replace(/\.0$/, '') + 'h' : Math.round(v / 86400) + 'd');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const div = (a, b) => (b ? a / b : 0);

  // dates (local calendar days)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const istToday = () => parseIso(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  function currentRange() {
    const v = $('#range').value, today = istToday();
    let start, end;
    if (v === 'today') start = end = today;
    else if (v === 'yesterday') start = end = addDays(today, -1);
    else if (v === 'custom') {
      start = $('#from').value ? parseIso($('#from').value) : addDays(today, -27);
      end = $('#to').value ? parseIso($('#to').value) : today;
      if (start > end) [start, end] = [end, start];
    } else { end = today; start = addDays(today, -(Number(v) - 1)); }
    const days = Math.round((end - start) / 864e5) + 1;
    const prevEnd = addDays(start, -1), prevStart = addDays(prevEnd, -(days - 1));
    return { start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd), days };
  }
  const rangeText = (R) => (R.start === R.end ? fmtDate(R.start) : `${fmtDate(R.start)} → ${fmtDate(R.end)}`);
  const fmtDate = (s) => parseIso(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  function eachDay(start, end, fn) { for (let d = parseIso(start); d <= parseIso(end); d = addDays(d, 1)) fn(iso(d), d); }

  // tooltip
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

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  // Single-series area chart with crosshair tooltip. pts: [{label, short, ...values}], summary(p) -> html
  function lineChart(el, pts, key, fmt, axisFmt, summary) {
    el.innerHTML = '';
    if (!pts.length) { el.innerHTML = '<div class="center muted">No data</div>'; return; }
    const W = el.clientWidth || 600, H = el.clientHeight || 240;
    const pad = { l: 44, r: 12, t: 10, b: 24 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = niceMax(Math.max(...pts.map((p) => p[key])));
    const x = (i) => pad.l + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1));
    const y = (v) => pad.t + ih - (v / max) * ih;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(key)} over time"><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--series)" stop-opacity=".28"/><stop offset="1" stop-color="var(--series)" stop-opacity="0"/></linearGradient></defs>`;
    for (let i = 1; i <= 4; i++) {
      const v = (max * i) / 4, yy = y(v);
      s += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="tick" x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${esc(axisFmt(v))}</text>`;
    }
    s += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/><text class="tick" x="${pad.l - 6}" y="${y(0) + 4}" text-anchor="end">0</text>`;
    const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(iw / 70))));
    pts.forEach((p, i) => { if (i % step === 0) s += `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.short)}</text>`; });
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    if (pts.length > 1) s += `<path fill="url(#ag)" d="${line}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z"/>`;
    s += `<path class="line" d="${line}"/>`;
    if (pts.length === 1) s += `<circle class="dot" cx="${x(0)}" cy="${y(pts[0][key])}" r="5"/>`;
    s += `<line class="cross" y1="${pad.t}" y2="${y(0)}" visibility="hidden"/><circle class="dot hov" r="5" visibility="hidden"/>`;
    s += `<rect x="${pad.l}" y="0" width="${iw}" height="${H}" fill="transparent" class="hit"/></svg>`;
    el.innerHTML = s;
    const svg = el.firstChild, cx = $('.cross', svg), cd = $('.hov', svg), hit = $('.hit', svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(pts.length === 1 ? 0 : ((px - pad.l) / iw) * (pts.length - 1))));
      const p = pts[i];
      cx.setAttribute('x1', x(i)); cx.setAttribute('x2', x(i)); cx.setAttribute('visibility', 'visible');
      cd.setAttribute('cx', x(i)); cd.setAttribute('cy', y(p[key])); cd.setAttribute('visibility', 'visible');
      showTip(`<span class="muted">${esc(p.label)}</span><b>${esc(fmt(p[key]))}</b>${summary ? `<span class="muted">${summary(p)}</span>` : ''}`, ev.clientX, ev.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cx.setAttribute('visibility', 'hidden'); cd.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  // metrics: [{k, label, fmt, axis}]
  function chartCard(title, pts, metrics, summary, storeKey = 'cl_admin_metric') {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<div class="card-head"><h2>${esc(title)}</h2><div class="seg">${metrics.map((m) => `<button data-k="${m.k}">${esc(m.label)}</button>`).join('')}</div></div><div class="chart"></div>`;
    const el = $('.chart', card);
    let k = store.get(storeKey);
    if (!metrics.some((m) => m.k === k)) k = metrics[0].k;
    const draw = () => {
      const m = metrics.find((x) => x.k === k);
      card.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      lineChart(el, pts, k, m.fmt, m.axis, summary);
    };
    card.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { k = b.dataset.k; store.set(storeKey, k); draw(); }));
    let w = 0;
    new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; draw(); } }).observe(el);
    return card;
  }

  // Vertical columns (e.g. 24 hours). items: [{label, value, tip}]
  function columns(el, items, fmt) {
    const draw = () => {
      const W = el.clientWidth || 600, H = el.clientHeight || 180;
      const pad = { l: 36, r: 6, t: 8, b: 22 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      const max = niceMax(Math.max(1, ...items.map((i) => i.value)));
      const bw = iw / items.length, gap = Math.min(4, bw * 0.25);
      let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`;
      for (let i = 1; i <= 3; i++) { const yy = pad.t + ih - (ih * i) / 3; s += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="tick" x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${compact((max * i) / 3)}</text>`; }
      s += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>`;
      const every = Math.ceil(items.length / Math.max(2, Math.floor(iw / 34)));
      items.forEach((it, i) => {
        const h = (it.value / max) * ih, x0 = pad.l + i * bw + gap / 2, w = Math.max(1, bw - gap), y0 = pad.t + ih - h;
        const r = Math.min(4, w / 2, h);
        if (h > 0) s += `<path class="col" d="M${x0},${pad.t + ih}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${pad.t + ih}Z"/>`;
        s += `<rect class="colhit" data-i="${i}" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}" fill="transparent"/>`;
        if (i % every === 0) s += `<text class="tick" x="${x0 + w / 2}" y="${H - 6}" text-anchor="middle">${esc(it.label)}</text>`;
      });
      el.innerHTML = s + '</svg>';
      el.querySelectorAll('.colhit').forEach((r) => {
        const it = items[+r.dataset.i];
        const f = (ev) => showTip(`<span class="muted">${esc(it.tip || it.label)}</span><b>${esc(fmt(it.value))}</b>`, ev.clientX, ev.clientY);
        r.addEventListener('pointermove', f); r.addEventListener('pointerdown', f); r.addEventListener('pointerleave', hideTip);
      });
    };
    let w = 0;
    new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; draw(); } }).observe(el);
  }

  // Tiny sparkline (no axes) for site cards.
  function sparkline(values) {
    const W = 120, H = 32, max = Math.max(1, ...values);
    if (values.length < 2) return '';
    const pts = values.map((v, i) => `${((i * W) / (values.length - 1)).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="M${pts.join('L')}L${W},${H}L0,${H}Z" class="spark-area"/><path d="M${pts.join('L')}" class="spark-line"/></svg>`;
  }

  function deltaHtml(cur, prev, lowerIsBetter = false) {
    if (!prev) return '<div class="delta">no data in previous period</div>';
    const ch = (cur - prev) / prev;
    if (Math.abs(ch) < 0.0005) return '<div class="delta">same as previous period</div>';
    const good = lowerIsBetter ? ch < 0 : ch > 0;
    return `<div class="delta ${good ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(1)}% vs previous period</div>`;
  }
  function kpis(items) {
    return `<div class="kpis">${items.map((k) => `<div class="kpi${k.accent ? ' accent' : ''}"><div class="label">${esc(k.label)}</div><div class="value">${k.value}</div>${k.delta || ''}</div>`).join('')}</div>`;
  }

  // Sortable, searchable table. cols: {key,label,num?,fmt?,bar?,html?,cls?}
  function table(container, cols, data, opts = {}) {
    let sortKey = opts.sort || cols.find((c) => c.num)?.key, asc = false, q = '', shown = opts.pageSize || 50;
    container.innerHTML = `${opts.search ? `<div class="table-tools" style="margin-bottom:10px"><input type="search" placeholder="${esc(opts.search)}" aria-label="Search"><span class="muted count"></span></div>` : ''}<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th data-k="${c.key}" class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody></tbody></table></div><div class="more"></div>`;
    const tbody = $('tbody', container), more = $('.more', container), count = $('.count', container);
    const draw = () => {
      const d = q ? data.filter((r) => cols.some((c) => !c.num && String(r[c.key] ?? '').toLowerCase().includes(q)) || String(r.title || '').toLowerCase().includes(q)) : data.slice();
      const col = cols.find((c) => c.key === sortKey);
      d.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; const r = col?.num ? (x ?? -1) - (y ?? -1) : String(x).localeCompare(String(y)); return asc ? r : -r; });
      const maxes = {};
      cols.filter((c) => c.bar).forEach((c) => (maxes[c.key] = Math.max(1, ...d.map((r) => r[c.key] || 0))));
      tbody.innerHTML = d.slice(0, shown).map((r) => `<tr>${cols.map((c) => {
        const v = c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key]);
        if (c.bar) return `<td class="num"><span class="cellbar">${v}<i style="width:${Math.round(((r[c.key] || 0) / maxes[c.key]) * 60)}px"></i></span></td>`;
        return `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${v}</td>`;
      }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="muted center">No data yet</td></tr>`;
      container.querySelectorAll('th').forEach((th) => { th.classList.toggle('sorted', th.dataset.k === sortKey); th.classList.toggle('asc', th.dataset.k === sortKey && asc); });
      if (count) count.textContent = `${num(d.length)} rows`;
      more.innerHTML = d.length > shown ? `<button class="ghost">Show more (${num(d.length - shown)} left)</button>` : '';
      const btn = $('button', more); if (btn) btn.onclick = () => { shown += 100; draw(); };
    };
    container.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => { if (sortKey === th.dataset.k) asc = !asc; else { sortKey = th.dataset.k; asc = false; } draw(); }));
    const input = $('input[type=search]', container);
    if (input) input.addEventListener('input', () => { q = input.value.trim().toLowerCase(); shown = opts.pageSize || 50; draw(); });
    draw();
  }

  function barList(title, items, fmt = num, opts = {}) {
    const max = Math.max(1, ...items.map((i) => i.value));
    const total = opts.total ?? items.reduce((a, i) => a + i.value, 0);
    return `<section class="card"><h2>${esc(title)}</h2>${items.length ? `<ul class="bars">${items.map((i) => `<li title="${esc(i.name)}: ${esc(fmt(i.value))}"><span class="name">${i.html || esc(i.name || '(not set)')}</span><span class="val">${esc(fmt(i.value))}${opts.noPct ? '' : ' · ' + pct(div(i.value, total))}</span><span class="track"><i style="width:${(i.value / max) * 100}%"></i></span></li>`).join('')}</ul>` : '<p class="muted">No data yet</p>'}</section>`;
  }

  const favicon = (host) => `<img class="fav" src="https://${esc(host)}/favicon.ico" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;

  window.CL = {
    $, store, num, compact, pct, dur, durAxis, esc, div, iso, addDays, parseIso, istToday, currentRange, rangeText, fmtDate, eachDay,
    showTip, hideTip, lineChart, chartCard, columns, sparkline, deltaHtml, kpis, table, barList, favicon,
  };
})();
