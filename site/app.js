/* CodeLove Admin — private analytics dashboard for every CodeLove site.
 * Reads Google Analytics 4 straight from the browser with the owner's Google login
 * (scope analytics.readonly). No server, no stored data: only a Google account that
 * has access to the GA4 properties can see anything. */
(() => {
  'use strict';

  const CFG = window.ADMIN_CONFIG || {};
  const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
  const ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';
  const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');

  // ---------- small storage helpers (never required to work) ----------
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
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const div = (a, b) => (b ? a / b : 0);

  // ---------- dates ----------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  function currentRange() {
    const v = $('#range').value, today = new Date();
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

  // ---------- auth ----------
  let token = null, tokenClient = null, pendingAuth = null;
  function loadToken() {
    const raw = store.get('cl_admin_token', sessionStorage);
    if (!raw) return;
    try { const t = JSON.parse(raw); if (t.exp > Date.now() + 60e3) token = t.access; } catch { /* ignore */ }
  }
  function clientId() { return CFG.clientId || store.get('cl_admin_client_id') || ''; }
  function initTokenClient() {
    if (tokenClient || !window.google?.accounts?.oauth2) return !!tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      callback: (resp) => {
        const p = pendingAuth; pendingAuth = null;
        if (resp.error) { p?.reject(new Error(resp.error_description || resp.error)); return; }
        token = resp.access_token;
        store.set('cl_admin_token', JSON.stringify({ access: token, exp: Date.now() + (resp.expires_in - 60) * 1000 }), sessionStorage);
        p?.resolve(token);
      },
      error_callback: (err) => { const p = pendingAuth; pendingAuth = null; p?.reject(new Error(err.message || err.type || 'Sign-in closed')); },
    });
    return true;
  }
  function signIn(prompt = '') {
    return new Promise((resolve, reject) => {
      if (!initTokenClient()) { reject(new Error('Google sign-in script not loaded yet. Try again in a second.')); return; }
      pendingAuth = { resolve, reject };
      tokenClient.requestAccessToken({ prompt });
    });
  }
  function signOut() {
    if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
    token = null; cache.clear(); props = null;
    store.set('cl_admin_token', null, sessionStorage);
    route();
  }

  // ---------- Google APIs ----------
  const cache = new Map();
  async function api(url, body, retried = false) {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) { await signIn(''); return api(url, body, true); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    return json;
  }
  function cached(key, fn) {
    if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
    return cache.get(key);
  }
  const rows = (r) => (r.rows || []).map((x) => ({ d: (x.dimensionValues || []).map((v) => v.value), m: (x.metricValues || []).map((v) => Number(v.value)) }));
  const report = (prop, body) => cached('r|' + prop + JSON.stringify(body), () => api(`${DATA_API}/${prop}:runReport`, { limit: 100000, ...body }).then(rows));
  const realtime = (prop, body) => api(`${DATA_API}/${prop}:runRealtimeReport`, body).then(rows);

  let props = null; // [{id:'properties/123', name, account}]
  async function listProperties() {
    if (props) return props;
    const out = []; let pageToken = '';
    do {
      const j = await api(`${ADMIN_API}/accountSummaries?pageSize=200${pageToken ? '&pageToken=' + pageToken : ''}`);
      for (const a of j.accountSummaries || []) for (const p of a.propertySummaries || []) out.push({ id: p.property, name: p.displayName, account: a.displayName });
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return (props = out);
  }

  const isMine = (host) => (CFG.siteSuffixes || ['codelove.in']).some((s) => host === s || host.endsWith('.' + s));
  const showAll = () => store.get('cl_admin_all_hosts') === '1';
  const hostFilter = (host) => ({ filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: host } } });

  // Per-site totals. A site can report into more than one GA4 property (games sends to two),
  // so each host is counted once, from the property that saw the most page views for it.
  const SITE_METRICS = ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'userEngagementDuration', 'engagedSessions'];
  async function loadSites(R) {
    const list = await listProperties();
    const errors = [];
    const results = await Promise.all(list.map((p) =>
      report(p.id, {
        dateRanges: [{ startDate: R.start, endDate: R.end, name: 'cur' }, { startDate: R.prevStart, endDate: R.prevEnd, name: 'prev' }],
        dimensions: [{ name: 'hostName' }],
        metrics: SITE_METRICS.map((name) => ({ name })),
      }).then((r) => ({ p, r })).catch((e) => { errors.push(`${p.name}: ${e.message}`); return { p, r: [] }; })));
    const byHost = new Map(); // host -> [{prop, cur, prev}]
    for (const { p, r } of results) {
      const per = new Map();
      for (const row of r) {
        const [host, range] = row.d;
        if (!host || host === '(not set)') continue;
        if (!per.has(host)) per.set(host, { prop: p, cur: SITE_METRICS.map(() => 0), prev: SITE_METRICS.map(() => 0) });
        per.get(host)[range === 'prev' ? 'prev' : 'cur'] = row.m;
      }
      for (const [host, v] of per) { if (!byHost.has(host)) byHost.set(host, []); byHost.get(host).push(v); }
    }
    const sites = [];
    for (const [host, cands] of byHost) {
      cands.sort((a, b) => (b.cur[3] + b.prev[3]) - (a.cur[3] + a.prev[3]));
      const best = cands[0];
      const o = (arr) => Object.fromEntries(SITE_METRICS.map((k, i) => [k, arr[i]]));
      sites.push({ host, prop: best.prop, alsoIn: cands.slice(1).map((c) => c.prop.name), cur: o(best.cur), prev: o(best.prev) });
    }
    return { sites, errors };
  }
  const visibleSites = (sites) => sites.filter((s) => showAll() || isMine(s.host));

  // Daily (or hourly for short ranges) series, summed over the given sites.
  async function loadSeries(R, sites) {
    const hourly = R.days <= 2;
    const dim = hourly ? 'dateHour' : 'date';
    const byProp = new Map();
    for (const s of sites) { if (!byProp.has(s.prop.id)) byProp.set(s.prop.id, new Set()); byProp.get(s.prop.id).add(s.host); }
    const sum = new Map();
    await Promise.all([...byProp].map(async ([pid, hosts]) => {
      const body = {
        dateRanges: [{ startDate: R.start, endDate: R.end }],
        dimensions: [{ name: dim }, { name: 'hostName' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'userEngagementDuration' }],
      };
      if (hosts.size === 1) body.dimensionFilter = hostFilter([...hosts][0]);
      const r = await report(pid, body);
      for (const row of r) {
        if (!hosts.has(row.d[1])) continue;
        const a = sum.get(row.d[0]) || [0, 0, 0];
        row.m.forEach((v, i) => (a[i] += v));
        sum.set(row.d[0], a);
      }
    }));
    // fill gaps so the line doesn't skip empty days/hours
    const pts = [];
    if (hourly) {
      for (let d = parseIso(R.start); d <= parseIso(R.end); d = addDays(d, 1))
        for (let h = 0; h < 24; h++) {
          const k = iso(d).replace(/-/g, '') + String(h).padStart(2, '0');
          const v = sum.get(k) || [0, 0, 0];
          pts.push({ key: k, label: `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${String(h).padStart(2, '0')}:00`, short: String(h).padStart(2, '0') + ':00', users: v[0], views: v[1], time: v[2] });
        }
      // drop future hours of today
      const nowKey = iso(new Date()).replace(/-/g, '') + String(new Date().getHours()).padStart(2, '0');
      return pts.filter((p) => p.key <= nowKey);
    }
    for (let d = parseIso(R.start); d <= parseIso(R.end); d = addDays(d, 1)) {
      const k = iso(d).replace(/-/g, '');
      const v = sum.get(k) || [0, 0, 0];
      pts.push({ key: k, label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), short: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), users: v[0], views: v[1], time: v[2] });
    }
    return pts;
  }

  // Pages: views, users and engagement time per path.
  async function loadPages(R, sites) {
    const byProp = new Map();
    for (const s of sites) { if (!byProp.has(s.prop.id)) byProp.set(s.prop.id, new Set()); byProp.get(s.prop.id).add(s.host); }
    const agg = new Map();
    await Promise.all([...byProp].map(async ([pid, hosts]) => {
      const body = {
        dateRanges: [{ startDate: R.start, endDate: R.end }],
        dimensions: [{ name: 'hostName' }, { name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }, { name: 'newUsers' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      };
      if (hosts.size === 1) body.dimensionFilter = hostFilter([...hosts][0]);
      const r = await report(pid, body);
      for (const row of r) {
        const [host, path, title] = row.d;
        if (!hosts.has(host)) continue;
        const k = host + path;
        let a = agg.get(k);
        if (!a) agg.set(k, (a = { host, path, title, tViews: -1, views: 0, users: 0, time: 0, newUsers: 0 }));
        a.views += row.m[0]; a.users += row.m[1]; a.time += row.m[2]; a.newUsers += row.m[3];
        if (row.m[0] > a.tViews) { a.title = title; a.tViews = row.m[0]; }
      }
    }));
    return [...agg.values()].map((p) => ({ ...p, perUser: div(p.time, p.users), perView: div(p.time, p.views) }));
  }

  async function loadBreakdown(R, site, dim, metric = 'activeUsers', limit = 10) {
    const r = await report(site.prop.id, {
      dateRanges: [{ startDate: R.start, endDate: R.end }],
      dimensions: [{ name: dim }],
      metrics: [{ name: metric }],
      dimensionFilter: hostFilter(site.host),
      orderBys: [{ metric: { metricName: metric }, desc: true }],
      limit,
    });
    return r.map((x) => ({ name: x.d[0], value: x.m[0] }));
  }

  // ---------- UI pieces ----------
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

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  // Single-series area/line chart with crosshair tooltip.
  function lineChart(el, pts, key, fmt, axisFmt) {
    el.innerHTML = '';
    if (!pts.length) { el.innerHTML = '<div class="center muted">No data</div>'; return; }
    const W = el.clientWidth || 600, H = el.clientHeight || 240;
    const pad = { l: 44, r: 12, t: 10, b: 24 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = niceMax(Math.max(...pts.map((p) => p[key])));
    const x = (i) => pad.l + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1));
    const y = (v) => pad.t + ih - (v / max) * ih;
    const NS = 'http://www.w3.org/2000/svg';
    let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(key)} over time">`;
    for (let i = 1; i <= 4; i++) {
      const v = (max * i) / 4, yy = y(v);
      s += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="tick" x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${esc(axisFmt(v))}</text>`;
    }
    s += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/><text class="tick" x="${pad.l - 6}" y="${y(0) + 4}" text-anchor="end">0</text>`;
    const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(iw / 70))));
    pts.forEach((p, i) => { if (i % step === 0) s += `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.short)}</text>`; });
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    if (pts.length > 1) s += `<path class="area" d="${line}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z"/>`;
    s += `<path class="line" d="${line}"/>`;
    if (pts.length === 1) s += `<circle class="dot" cx="${x(0)}" cy="${y(pts[0][key])}" r="5"/>`;
    s += `<line class="cross" id="cx" y1="${pad.t}" y2="${y(0)}" visibility="hidden"/><circle class="dot" id="cd" r="5" visibility="hidden"/>`;
    s += `<rect x="${pad.l}" y="0" width="${iw}" height="${H}" fill="transparent" id="hit"/></svg>`;
    el.innerHTML = s;
    const svg = el.firstChild, cx = $('#cx', svg), cd = $('#cd', svg), hit = $('#hit', svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(pts.length === 1 ? 0 : ((px - pad.l) / iw) * (pts.length - 1))));
      const p = pts[i];
      cx.setAttribute('x1', x(i)); cx.setAttribute('x2', x(i)); cx.setAttribute('visibility', 'visible');
      cd.setAttribute('cx', x(i)); cd.setAttribute('cy', y(p[key])); cd.setAttribute('visibility', 'visible');
      showTip(`<span class="muted">${esc(p.label)}</span><b>${esc(fmt(p[key]))}</b><span class="muted">${num(p.users)} users · ${num(p.views)} views · ${dur(p.time)}</span>`, ev.clientX, ev.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cx.setAttribute('visibility', 'hidden'); cd.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  function chartCard(title, pts) {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<div class="card-head"><h2>${esc(title)}</h2><div class="seg" role="tablist">
      <button data-k="users" class="on">Users</button><button data-k="views">Views</button><button data-k="time">Time spent</button></div></div><div class="chart"></div>`;
    const el = $('.chart', card);
    const conf = { users: [num, compact], views: [num, compact], time: [dur, (v) => dur(v).split(' ')[0]] };
    let k = store.get('cl_admin_metric') || 'users';
    if (!conf[k]) k = 'users';
    const draw = () => {
      card.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      lineChart(el, pts, k, conf[k][0], conf[k][1]);
    };
    card.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { k = b.dataset.k; store.set('cl_admin_metric', k); draw(); }));
    requestAnimationFrame(draw);
    new ResizeObserver(() => draw()).observe(el);
    return card;
  }

  function deltaHtml(cur, prev, lowerIsBetter = false) {
    if (!prev) return '<div class="delta">no data in previous period</div>';
    const ch = (cur - prev) / prev;
    if (Math.abs(ch) < 0.0005) return '<div class="delta">same as previous period</div>';
    const good = lowerIsBetter ? ch < 0 : ch > 0;
    return `<div class="delta ${good ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(1)}% vs previous period</div>`;
  }
  function kpis(items) {
    return `<div class="kpis">${items.map((k) => `<div class="kpi"><div class="label">${esc(k.label)}</div><div class="value">${k.value}</div>${k.delta || ''}</div>`).join('')}</div>`;
  }
  function totals(sites, which) {
    const t = { activeUsers: 0, newUsers: 0, sessions: 0, screenPageViews: 0, userEngagementDuration: 0, engagedSessions: 0 };
    for (const s of sites) for (const k in t) t[k] += s[which][k];
    return t;
  }
  function kpiSet(c, p) {
    return kpis([
      { label: 'Users', value: num(c.activeUsers), delta: deltaHtml(c.activeUsers, p.activeUsers) },
      { label: 'Page views', value: num(c.screenPageViews), delta: deltaHtml(c.screenPageViews, p.screenPageViews) },
      { label: 'Total time spent', value: dur(c.userEngagementDuration), delta: deltaHtml(c.userEngagementDuration, p.userEngagementDuration) },
      { label: 'Avg time per user', value: dur(div(c.userEngagementDuration, c.activeUsers)), delta: deltaHtml(div(c.userEngagementDuration, c.activeUsers), div(p.userEngagementDuration, p.activeUsers)) },
      { label: 'Sessions', value: num(c.sessions), delta: deltaHtml(c.sessions, p.sessions) },
      { label: 'Engagement rate', value: pct(div(c.engagedSessions, c.sessions)), delta: deltaHtml(div(c.engagedSessions, c.sessions), div(p.engagedSessions, p.sessions)) },
    ]);
  }

  // Sortable, searchable table. cols: {key,label,num?,fmt?,bar?,html?}
  function table(container, cols, data, opts = {}) {
    let sortKey = opts.sort || cols.find((c) => c.num)?.key, asc = false, q = '', shown = opts.pageSize || 100;
    container.innerHTML = `${opts.search ? `<div class="table-tools" style="margin-bottom:10px"><input type="search" placeholder="${esc(opts.search)}" aria-label="Search"><span class="muted count"></span></div>` : ''}<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th data-k="${c.key}" class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody></tbody></table></div><div class="more"></div>`;
    const tbody = $('tbody', container), more = $('.more', container), count = $('.count', container);
    const draw = () => {
      let d = q ? data.filter((r) => cols.some((c) => !c.num && String(r[c.key] ?? '').toLowerCase().includes(q)) || (r.title || '').toLowerCase().includes(q)) : data.slice();
      const col = cols.find((c) => c.key === sortKey);
      d.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; const r = col?.num ? x - y : String(x).localeCompare(String(y)); return asc ? r : -r; });
      const maxes = {};
      cols.filter((c) => c.bar).forEach((c) => (maxes[c.key] = Math.max(1, ...d.map((r) => r[c.key]))));
      tbody.innerHTML = d.slice(0, shown).map((r) => `<tr>${cols.map((c) => {
        const v = c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key]);
        if (c.bar) return `<td class="num"><span class="cellbar">${v}<i style="width:${Math.round((r[c.key] / maxes[c.key]) * 60)}px"></i></span></td>`;
        return `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${v}</td>`;
      }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="muted center">No data</td></tr>`;
      container.querySelectorAll('th').forEach((th) => { th.classList.toggle('sorted', th.dataset.k === sortKey); th.classList.toggle('asc', th.dataset.k === sortKey && asc); });
      if (count) count.textContent = `${num(d.length)} rows`;
      more.innerHTML = d.length > shown ? `<button class="ghost">Show more (${num(d.length - shown)} left)</button>` : '';
      const btn = $('button', more); if (btn) btn.onclick = () => { shown += 200; draw(); };
    };
    container.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => { if (sortKey === th.dataset.k) asc = !asc; else { sortKey = th.dataset.k; asc = false; } draw(); }));
    const input = $('input[type=search]', container);
    if (input) input.addEventListener('input', () => { q = input.value.trim().toLowerCase(); shown = opts.pageSize || 100; draw(); });
    draw();
  }

  function barList(title, items, fmt = num) {
    const max = Math.max(1, ...items.map((i) => i.value));
    const total = items.reduce((a, i) => a + i.value, 0);
    return `<section class="card"><h2>${esc(title)}</h2>${items.length ? `<ul class="bars">${items.map((i) => `<li title="${esc(i.name)}: ${esc(fmt(i.value))}"><span class="name">${esc(i.name || '(not set)')}</span><span class="val">${esc(fmt(i.value))} · ${pct(div(i.value, total))}</span><span class="track"><i style="width:${(i.value / max) * 100}%"></i></span></li>`).join('')}</ul>` : '<p class="muted">No data</p>'}</section>`;
  }

  const errorBox = (errs) => (errs.length ? `<div class="error"><b>Some GA4 properties failed:</b><br>${errs.map(esc).join('<br>')}<div class="note">Check that "Google Analytics Data API" and "Google Analytics Admin API" are enabled in your Google Cloud project.</div></div>` : '');
  const siteLink = (host) => `<a href="#/site/${encodeURIComponent(host)}">${esc(host)}</a>`;
  const rangeText = (R) => (R.start === R.end ? R.start : `${R.start} → ${R.end}`);
  let renderId = 0;

  // ---------- views ----------
  async function viewOverview(R, id) {
    const { sites: all, errors } = await loadSites(R);
    const sites = visibleSites(all).filter((s) => s.cur.activeUsers + s.cur.screenPageViews + s.prev.screenPageViews > 0);
    const series = await loadSeries(R, sites);
    if (id !== renderId) return;
    const c = totals(sites, 'cur'), p = totals(sites, 'prev');
    app.innerHTML = `${errorBox(errors)}<h1>All sites</h1><p class="sub">${rangeText(R)} · ${sites.length} sites · compared with ${R.prevStart} → ${R.prevEnd}</p>${kpiSet(c, p)}`;
    app.append(chartCard('Across all sites', series));
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<div class="card-head"><h2>Sites</h2><label class="note"><input type="checkbox" id="allHosts" ${showAll() ? 'checked' : ''}> Show all hosts (localhost, previews, other properties)</label></div><div class="tbl"></div><p class="note">Users are counted per site — one person visiting two sites counts in both. Time spent is GA4 engagement time (page in focus).</p>`;
    app.append(card);
    $('#allHosts', card).addEventListener('change', (e) => { store.set('cl_admin_all_hosts', e.target.checked ? '1' : null); route(); });
    const data = sites.map((s) => ({
      host: s.host, prop: s.prop.name + (s.alsoIn.length ? ` (+${s.alsoIn.join(', ')})` : ''),
      users: s.cur.activeUsers, newUsers: s.cur.newUsers, sessions: s.cur.sessions, views: s.cur.screenPageViews,
      time: s.cur.userEngagementDuration, perUser: div(s.cur.userEngagementDuration, s.cur.activeUsers),
      perSession: div(s.cur.userEngagementDuration, s.cur.sessions), engRate: div(s.cur.engagedSessions, s.cur.sessions),
      change: s.prev.activeUsers ? (s.cur.activeUsers - s.prev.activeUsers) / s.prev.activeUsers : null,
    }));
    table($('.tbl', card), [
      { key: 'host', label: 'Site', html: (r) => `${siteLink(r.host)}<div class="note">${esc(r.prop)}</div>` },
      { key: 'users', label: 'Users', num: true, fmt: num, bar: true },
      { key: 'change', label: 'vs prev', num: true, html: (r) => (r.change == null ? '<span class="muted">–</span>' : `<span class="delta ${r.change >= 0 ? 'up' : 'down'}">${r.change >= 0 ? '▲' : '▼'} ${Math.abs(r.change * 100).toFixed(0)}%</span>`) },
      { key: 'newUsers', label: 'New users', num: true, fmt: num },
      { key: 'sessions', label: 'Sessions', num: true, fmt: num },
      { key: 'views', label: 'Views', num: true, fmt: num },
      { key: 'time', label: 'Total time', num: true, fmt: dur, bar: true },
      { key: 'perUser', label: 'Avg / user', num: true, fmt: dur },
      { key: 'perSession', label: 'Avg / session', num: true, fmt: dur },
      { key: 'engRate', label: 'Engaged', num: true, fmt: pct },
    ], data, { sort: 'users' });
  }

  async function viewSite(R, id, host) {
    const { sites, errors } = await loadSites(R);
    const site = sites.find((s) => s.host === host);
    if (id !== renderId) return;
    if (!site) { app.innerHTML = `<a class="crumb" href="#/">← All sites</a><h1>${esc(host)}</h1><p class="muted">No data for this site in ${rangeText(R)}.</p>`; return; }
    const [series, pages, countries, devices, sources, cities] = await Promise.all([
      loadSeries(R, [site]), loadPages(R, [site]),
      loadBreakdown(R, site, 'country'), loadBreakdown(R, site, 'deviceCategory'),
      loadBreakdown(R, site, 'sessionSourceMedium', 'sessions'), loadBreakdown(R, site, 'city'),
    ]);
    if (id !== renderId) return;
    app.innerHTML = `${errorBox(errors)}<a class="crumb" href="#/">← All sites</a><h1><a href="https://${esc(host)}" target="_blank" rel="noopener">${esc(host)} ↗</a></h1><p class="sub">${rangeText(R)} · GA4 property: ${esc(site.prop.name)}</p>${kpiSet(site.cur, site.prev)}`;
    app.append(chartCard('Trend', series));
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = '<div class="card-head"><h2>Pages</h2></div><div class="tbl"></div><p class="note">Avg / user = engagement time on that page ÷ users who viewed it. Avg / view = time ÷ views.</p>';
    app.append(card);
    table($('.tbl', card), pageCols(false), pages, { sort: 'views', search: 'Search path or title', pageSize: 50 });
    const g = document.createElement('div');
    g.className = 'grid3';
    g.innerHTML = barList('Countries (users)', countries) + barList('Cities (users)', cities) + barList('Devices (users)', devices) + barList('Traffic sources (sessions)', sources);
    app.append(g);
  }

  function pageCols(withHost) {
    const cols = [];
    if (withHost) cols.push({ key: 'host', label: 'Site', html: (r) => siteLink(r.host) });
    cols.push(
      { key: 'path', label: 'Page', cls: 'path', html: (r) => `<a href="https://${esc(r.host)}${esc(r.path)}" target="_blank" rel="noopener" title="${esc(r.path)}">${esc(r.path)}</a><span class="title" title="${esc(r.title)}">${esc(r.title)}</span>` },
      { key: 'views', label: 'Views', num: true, fmt: num, bar: true },
      { key: 'users', label: 'Users', num: true, fmt: num },
      { key: 'newUsers', label: 'New users', num: true, fmt: num },
      { key: 'time', label: 'Total time', num: true, fmt: dur, bar: true },
      { key: 'perUser', label: 'Avg / user', num: true, fmt: dur },
      { key: 'perView', label: 'Avg / view', num: true, fmt: dur },
    );
    return cols;
  }

  async function viewPages(R, id) {
    const { sites, errors } = await loadSites(R);
    const vis = visibleSites(sites);
    const pages = await loadPages(R, vis);
    if (id !== renderId) return;
    const t = pages.reduce((a, p) => ((a.views += p.views), (a.time += p.time), a), { views: 0, time: 0 });
    app.innerHTML = `${errorBox(errors)}<h1>All pages</h1><p class="sub">${rangeText(R)} · ${num(pages.length)} pages across ${vis.length} sites · ${num(t.views)} views · ${dur(t.time)} total time</p>`;
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = '<div class="tbl"></div>';
    app.append(card);
    table($('.tbl', card), pageCols(true), pages, { sort: 'views', search: 'Search site, path or title', pageSize: 50 });
  }

  let liveTimer = null;
  async function viewLive(id) {
    const list = await listProperties();
    const res = await Promise.all(list.map(async (p) => {
      try {
        const [tot, screens, countries] = await Promise.all([
          realtime(p.id, { metrics: [{ name: 'activeUsers' }] }),
          realtime(p.id, { dimensions: [{ name: 'unifiedScreenName' }], metrics: [{ name: 'activeUsers' }], limit: 15, orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }] }),
          realtime(p.id, { dimensions: [{ name: 'country' }], metrics: [{ name: 'activeUsers' }], limit: 8, orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }] }),
        ]);
        return { p, total: tot[0]?.m[0] || 0, screens: screens.map((r) => ({ name: r.d[0], value: r.m[0] })), countries: countries.map((r) => ({ name: r.d[0], value: r.m[0] })) };
      } catch (e) { return { p, error: e.message }; }
    }));
    if (id !== renderId) return;
    res.sort((a, b) => (b.total || 0) - (a.total || 0));
    const all = res.reduce((a, r) => a + (r.total || 0), 0);
    app.innerHTML = `<h1>Live — last 30 minutes</h1><p class="sub">Auto-refreshes every 60 s · updated ${new Date().toLocaleTimeString('en-IN')} · GA4 realtime can't split by site, so it's grouped by GA4 property (page titles show which site).</p>
      <div class="kpis"><div class="kpi"><div class="label">Active users (all properties)</div><div class="live-num">${num(all)}</div><div class="delta">a site reporting to two properties counts twice</div></div></div>
      ${res.map((r) => r.error ? `<div class="error"><b>${esc(r.p.name)}</b>: ${esc(r.error)}</div>` : `<section class="card"><div class="card-head"><h2>${esc(r.p.name)}</h2><span class="kpi-inline"><b>${num(r.total)}</b> active</span></div>${r.total ? `<div class="grid3">${barList('Pages (by title)', r.screens)}${barList('Countries', r.countries)}</div>` : '<p class="muted">Nobody right now.</p>'}</section>`).join('')}`;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { if (location.hash === '#/live' && id === renderId) route(); }, 60e3);
  }

  // ---------- setup / sign-in screens ----------
  function viewSetup() {
    $('#tabs').hidden = $('#controls').hidden = true;
    const origin = location.origin;
    app.innerHTML = `<section class="card setup"><h1>One-time setup</h1>
      <p>This dashboard reads your Google Analytics 4 data straight from your browser. It needs an OAuth Client ID from your Google Cloud project.</p>
      <ol>
        <li>Open <a href="https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com" target="_blank" rel="noopener">Google Analytics Data API</a> and <a href="https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com" target="_blank" rel="noopener">Google Analytics Admin API</a> → <b>Enable</b> both (same project, e.g. the Firebase project).</li>
        <li><a href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noopener">OAuth consent screen</a>: User type <b>External</b>, keep it in <b>Testing</b>, add your own Gmail under <b>Test users</b>. Only test users can sign in.</li>
        <li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credentials</a> → Create credentials → <b>OAuth client ID</b> → Web application. Authorized JavaScript origins: <code>${esc(origin)}</code> (and <code>https://admin.codelove.in</code>, <code>http://localhost:5500</code>).</li>
        <li>Paste the Client ID below (or put it in <code>config.js</code> so every browser has it).</li>
      </ol>
      <div class="row"><input id="cid" placeholder="1234567890-xxxx.apps.googleusercontent.com" value="${esc(clientId())}"><button class="primary" id="saveCid">Save</button></div></section>`;
    $('#saveCid').onclick = () => { const v = $('#cid').value.trim(); if (!v) return; store.set('cl_admin_client_id', v); tokenClient = null; route(); };
  }

  function viewSignIn(msg) {
    $('#tabs').hidden = $('#controls').hidden = true;
    app.innerHTML = `<section class="card setup" style="text-align:center"><h1>CodeLove Admin</h1><p class="muted">Private. Sign in with the Google account that owns the Analytics properties.</p>
      ${msg ? `<div class="error">${esc(msg)}</div>` : ''}
      <button class="primary" id="signin">Sign in with Google</button>
      <p class="note" style="margin-top:16px"><a href="#" id="changeCid">Change OAuth client ID</a></p></section>`;
    $('#signin').onclick = async () => {
      try { await signIn('select_account'); route(); } catch (e) { viewSignIn(e.message); }
    };
    $('#changeCid').onclick = (e) => { e.preventDefault(); if (!CFG.clientId) { store.set('cl_admin_client_id', null); tokenClient = null; } viewSetup(); };
  }

  // ---------- router ----------
  async function route() {
    const id = ++renderId;
    clearTimeout(liveTimer);
    hideTip();
    if (!clientId()) return viewSetup();
    if (!token) return viewSignIn();
    $('#tabs').hidden = $('#controls').hidden = false;
    const hash = location.hash || '#/';
    const tab = hash.startsWith('#/pages') ? 'pages' : hash.startsWith('#/live') ? 'live' : 'overview';
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    $('#range').disabled = tab === 'live';
    app.innerHTML = '<div class="center muted">Loading analytics…</div>';
    const R = currentRange();
    try {
      if (hash.startsWith('#/site/')) await viewSite(R, id, decodeURIComponent(hash.slice(7)));
      else if (tab === 'pages') await viewPages(R, id);
      else if (tab === 'live') await viewLive(id);
      else await viewOverview(R, id);
    } catch (e) {
      if (id !== renderId) return;
      app.innerHTML = `<div class="error"><b>Couldn't load analytics.</b><br>${esc(e.message)}<div class="note">If this says the API is disabled, enable "Google Analytics Data API" and "Google Analytics Admin API" in Google Cloud. If it says permission denied, sign in with the account that has access to the GA4 properties.</div></div><button class="ghost" id="retry">Try again</button>`;
      $('#retry').onclick = route;
    }
  }

  // ---------- wiring ----------
  const savedRange = store.get('cl_admin_range');
  if (savedRange && [...$('#range').options].some((o) => o.value === savedRange)) $('#range').value = savedRange;
  $('#from').value = store.get('cl_admin_from') || iso(addDays(new Date(), -27));
  $('#to').value = store.get('cl_admin_to') || iso(new Date());
  $('#customRange').hidden = $('#range').value !== 'custom';
  $('#range').addEventListener('change', () => { store.set('cl_admin_range', $('#range').value); $('#customRange').hidden = $('#range').value !== 'custom'; route(); });
  ['from', 'to'].forEach((k) => $('#' + k).addEventListener('change', () => { store.set('cl_admin_' + k, $('#' + k).value); route(); }));
  $('#refresh').addEventListener('click', () => { cache.clear(); props = null; route(); });
  $('#signout').addEventListener('click', signOut);
  addEventListener('hashchange', route);
  addEventListener('scroll', hideTip, { passive: true });

  loadToken();
  // Wait for the Google Identity script, then render.
  (function boot(tries = 0) {
    if (window.google?.accounts?.oauth2 || tries > 50) route();
    else setTimeout(() => boot(tries + 1), 100);
  })();
})();
