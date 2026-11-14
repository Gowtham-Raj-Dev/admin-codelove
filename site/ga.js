/* Google Analytics 4 section: reads GA4 Data/Admin APIs in the browser with the owner's Google login.
 * Numbers come straight from the GA4 API (same data as analytics.google.com). */
(() => {
  'use strict';
  const { $, store, num, compact, pct, dur, durAxis, pctAxis, esc, div, iso, parseIso, addDays, rangeText, kpiChart, deltaHtml, table, barList, favicon, icon, pageHead, loading, paint, el } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
  const ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';
  const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
  const app = $('#app');
  const EYEBROW = 'Google Analytics';

  // ---------- auth ----------
  let token = null, tokenClient = null, pendingAuth = null;
  (function loadToken() {
    const raw = store.get('cl_admin_token', sessionStorage);
    if (!raw) return;
    try { const t = JSON.parse(raw); if (t.exp > Date.now() + 60e3) token = t.access; } catch { /* ignore */ }
  })();
  function initTokenClient() {
    if (tokenClient) return true;
    if (!window.google?.accounts?.oauth2) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
      scope: SCOPE,
      login_hint: CFG.ownerEmail || undefined,
      callback: (resp) => {
        const p = pendingAuth; pendingAuth = null;
        if (resp.error) { p?.reject(new Error(resp.error_description || resp.error)); return; }
        token = resp.access_token;
        store.set('cl_admin_token', JSON.stringify({ access: token, exp: Date.now() + (resp.expires_in - 60) * 1000 }), sessionStorage);
        p?.resolve(token);
      },
      error_callback: (err) => {
        const p = pendingAuth; pendingAuth = null;
        p?.reject(new Error(err.type === 'popup_closed' ? 'The Google window was closed before sign-in finished.' : err.type === 'popup_failed_to_open' ? 'The browser blocked the Google popup. Allow popups for this site.' : err.message || err.type || 'Sign-in closed'));
      },
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
  }

  // ---------- API ----------
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

  let props = null;
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
    const byHost = new Map();
    for (const { p, r } of results) {
      const per = new Map();
      for (const row of r) {
        const [host, rng] = row.d;
        if (!host || host === '(not set)') continue;
        if (!per.has(host)) per.set(host, { prop: p, cur: SITE_METRICS.map(() => 0), prev: SITE_METRICS.map(() => 0) });
        per.get(host)[rng === 'prev' ? 'prev' : 'cur'] = row.m;
      }
      for (const [host, v] of per) { if (!byHost.has(host)) byHost.set(host, []); byHost.get(host).push(v); }
    }
    const sites = [];
    for (const [host, cands] of byHost) {
      // A host reporting into two properties (games) is counted once, from the property with the most views.
      cands.sort((a, b) => (b.cur[3] + b.prev[3]) - (a.cur[3] + a.prev[3]));
      const best = cands[0];
      const o = (arr) => Object.fromEntries(SITE_METRICS.map((k, i) => [k, arr[i]]));
      sites.push({ host, prop: best.prop, alsoIn: cands.slice(1).map((c) => c.prop.name), cur: o(best.cur), prev: o(best.prev) });
    }
    return { sites, errors };
  }
  const visibleSites = (sites) => sites.filter((s) => showAll() || isMine(s.host));
  function groupByProp(sites) {
    const m = new Map();
    for (const s of sites) { if (!m.has(s.prop.id)) m.set(s.prop.id, new Set()); m.get(s.prop.id).add(s.host); }
    return m;
  }

  const SERIES_METRICS = ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'userEngagementDuration', 'engagedSessions'];
  async function loadSeries(R, sites) {
    const hourly = R.days <= 2;
    const dim = hourly ? 'dateHour' : 'date';
    const sum = new Map();
    await Promise.all([...groupByProp(sites)].map(async ([pid, hosts]) => {
      const body = {
        dateRanges: [{ startDate: R.start, endDate: R.end }],
        dimensions: [{ name: dim }, { name: 'hostName' }],
        metrics: SERIES_METRICS.map((name) => ({ name })),
      };
      if (hosts.size === 1) body.dimensionFilter = hostFilter([...hosts][0]);
      for (const row of await report(pid, body)) {
        if (!hosts.has(row.d[1])) continue;
        const a = sum.get(row.d[0]) || SERIES_METRICS.map(() => 0);
        row.m.forEach((v, i) => (a[i] += v));
        sum.set(row.d[0], a);
      }
    }));
    const point = (k, label, short, v) => ({ iso: k, label, short, u: v[0], n: v[1], s: v[2], v: v[3], sec: v[4], avg: div(v[4], v[0]), er: div(v[5], v[2]) });
    const pts = [];
    const nowKey = iso(new Date()).replace(/-/g, '') + String(new Date().getHours()).padStart(2, '0');
    const zero = SERIES_METRICS.map(() => 0);
    for (let d = parseIso(R.start); d <= parseIso(R.end); d = addDays(d, 1)) {
      const k = iso(d).replace(/-/g, '');
      if (hourly) {
        for (let h = 0; h < 24; h++) {
          const hh = String(h).padStart(2, '0'), kk = k + hh;
          if (kk > nowKey) break;
          pts.push(point(kk, `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${hh}:00`, hh + ':00', sum.get(kk) || zero));
        }
      } else {
        pts.push(point(k, d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), sum.get(k) || zero));
      }
    }
    return { pts, unit: hourly ? 'hour' : 'day' };
  }

  async function loadPages(R, sites) {
    const agg = new Map();
    await Promise.all([...groupByProp(sites)].map(async ([pid, hosts]) => {
      const body = {
        dateRanges: [{ startDate: R.start, endDate: R.end }],
        dimensions: [{ name: 'hostName' }, { name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }, { name: 'newUsers' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      };
      if (hosts.size === 1) body.dimensionFilter = hostFilter([...hosts][0]);
      for (const row of await report(pid, body)) {
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

  // ---------- views ----------
  const summary = (p) => `${num(p.u)} users · ${num(p.s)} sessions · ${num(p.v)} views · ${dur(p.sec)}`;
  function totals(sites, which) {
    const t = Object.fromEntries(SITE_METRICS.map((k) => [k, 0]));
    for (const s of sites) for (const k in t) t[k] += s[which][k];
    return t;
  }
  function metricChart(c, p, series) {
    const avgC = div(c.userEngagementDuration, c.activeUsers), avgP = div(p.userEngagementDuration, p.activeUsers);
    const erC = div(c.engagedSessions, c.sessions), erP = div(p.engagedSessions, p.sessions);
    return kpiChart({
      storeKey: 'cl_ga_metric2', summary, unit: series.unit, pts: series.pts,
      metrics: [
        { k: 'u', label: 'Users', value: num(c.activeUsers), delta: deltaHtml(c.activeUsers, p.activeUsers), fmt: num, axis: compact },
        { k: 'n', label: 'New users', value: num(c.newUsers), delta: deltaHtml(c.newUsers, p.newUsers), fmt: num, axis: compact },
        { k: 's', label: 'Sessions', value: num(c.sessions), delta: deltaHtml(c.sessions, p.sessions), fmt: num, axis: compact },
        { k: 'v', label: 'Page views', value: num(c.screenPageViews), delta: deltaHtml(c.screenPageViews, p.screenPageViews), fmt: num, axis: compact },
        { k: 'sec', label: 'Time spent', value: dur(c.userEngagementDuration), delta: deltaHtml(c.userEngagementDuration, p.userEngagementDuration), fmt: dur, axis: durAxis },
        { k: 'avg', label: 'Avg time / user', value: dur(avgC), delta: deltaHtml(avgC, avgP), fmt: dur, axis: durAxis },
        { k: 'er', label: 'Engagement rate', value: pct(erC), delta: deltaHtml(erC, erP), fmt: pct, axis: pctAxis },
      ],
    });
  }
  const errorBox = (errs) => (errs.length ? `<div class="error">${icon('alert')}<div><b>Some GA4 properties failed:</b><br>${errs.map(esc).join('<br>')}<div class="note">Check that "Google Analytics Data API" and "Google Analytics Admin API" are enabled in the Google Cloud project of the OAuth client.</div></div></div>` : '');
  const siteHref = (host) => CL.link({ src: 'ga', tab: 'overview', site: host });
  const siteLink = (host) => `<a href="${siteHref(host)}">${esc(host)}</a>`;

  async function viewOverview(R, alive) {
    const { sites: all, errors } = await loadSites(R);
    const sites = visibleSites(all).filter((s) => s.cur.activeUsers + s.cur.screenPageViews + s.prev.screenPageViews > 0);
    const series = await loadSeries(R, sites);
    if (!alive()) return;
    const c = totals(sites, 'cur'), p = totals(sites, 'prev');
    paint(errorBox(errors) + pageHead(EYEBROW, 'All sites', `${rangeText(R)} · ${sites.length} sites with traffic · compared with the ${R.days === 1 ? 'day' : `${R.days} days`} before`));
    app.append(metricChart(c, p, series));
    const card = el('section', 'card', `<div class="card-head"><h2>Sites</h2><label class="note" style="display:inline-flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="allHosts" ${showAll() ? 'checked' : ''}> Show hosts outside codelove.in</label></div><div class="tbl"></div><p class="note">Users are counted per site. Time spent is GA4 engagement time (page in focus).</p>`);
    app.append(card);
    $('#allHosts', card).addEventListener('change', (e) => { store.set('cl_admin_all_hosts', e.target.checked ? '1' : null); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const data = sites.map((s) => ({
      host: s.host, prop: s.prop.name + (s.alsoIn.length ? ` (+${s.alsoIn.join(', ')})` : ''),
      users: s.cur.activeUsers, newUsers: s.cur.newUsers, sessions: s.cur.sessions, views: s.cur.screenPageViews,
      time: s.cur.userEngagementDuration, perUser: div(s.cur.userEngagementDuration, s.cur.activeUsers),
      perSession: div(s.cur.userEngagementDuration, s.cur.sessions), engRate: div(s.cur.engagedSessions, s.cur.sessions),
      change: s.prev.activeUsers ? (s.cur.activeUsers - s.prev.activeUsers) / s.prev.activeUsers : null,
    }));
    table($('.tbl', card), [
      { key: 'host', label: 'Site', html: (r) => `<span class="site-cell">${favicon(r.host)}<span>${siteLink(r.host)}<span class="note block">${esc(r.prop)}</span></span></span>` },
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

  function pageCols(withHost) {
    const cols = [];
    if (withHost) cols.push({ key: 'host', label: 'Site', html: (r) => `<span class="site-cell">${favicon(r.host)}${siteLink(r.host)}</span>` });
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

  async function viewSite(R, alive, host) {
    const { sites, errors } = await loadSites(R);
    const site = sites.find((s) => s.host === host);
    if (!alive()) return;
    const crumb = `<a class="crumb" href="${CL.link({ src: 'ga' })}">← All sites</a>`;
    const title = `${favicon(host)}<a href="https://${esc(host)}" target="_blank" rel="noopener" title="Open ${esc(host)}">${esc(host)}${icon('ext')}</a>`;
    if (!site) { paint(errorBox(errors) + crumb + pageHead(EYEBROW, title, rangeText(R)) + `<section class="card"><p class="empty">Google Analytics has no data for this site in ${esc(rangeText(R))}.</p></section>`); return; }
    const [series, pages, countries, devices, sources, cities] = await Promise.all([
      loadSeries(R, [site]), loadPages(R, [site]),
      loadBreakdown(R, site, 'country'), loadBreakdown(R, site, 'deviceCategory'),
      loadBreakdown(R, site, 'sessionSourceMedium', 'sessions'), loadBreakdown(R, site, 'city'),
    ]);
    if (!alive()) return;
    paint(errorBox(errors) + crumb + pageHead(`${EYEBROW} · ${esc(site.prop.name)}`, title, rangeText(R)));
    app.append(metricChart(site.cur, site.prev, series));
    const card = el('section', 'card', '<div class="card-head"><h2>Pages</h2><span class="note">Avg / user = engagement time on that page ÷ users who viewed it</span></div><div class="tbl"></div>');
    app.append(card);
    table($('.tbl', card), pageCols(false), pages, { sort: 'views', search: 'Search path or title' });
    app.insertAdjacentHTML('beforeend', `<div class="grid2">${barList('Countries · users', countries)}${barList('Cities · users', cities)}${barList('Devices · users', devices)}${barList('Traffic sources · sessions', sources)}</div>`);
  }

  async function viewPages(R, alive, host) {
    const { sites, errors } = await loadSites(R);
    const vis = host ? sites.filter((s) => s.host === host) : visibleSites(sites);
    const pages = await loadPages(R, vis);
    if (!alive()) return;
    const t = pages.reduce((a, p) => ((a.views += p.views), (a.time += p.time), a), { views: 0, time: 0 });
    paint(errorBox(errors) + pageHead(EYEBROW, host ? `Pages · ${esc(host)}` : 'All pages', `${rangeText(R)} · ${num(pages.length)} pages${host ? '' : ` across ${vis.length} sites`} · ${num(t.views)} views · ${dur(t.time)} total time`));
    const card = el('section', 'card', '<div class="tbl"></div>');
    app.append(card);
    table($('.tbl', card), pageCols(!host), pages, { sort: 'views', search: host ? 'Search path or title' : 'Search site, path or title' });
  }

  let liveTimer = null;
  async function viewLive(alive, host) {
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
    if (!alive()) return;
    res.sort((a, b) => (b.total || 0) - (a.total || 0));
    const all = res.reduce((a, r) => a + (r.total || 0), 0);
    paint(pageHead(`${EYEBROW} · realtime`, 'Live · last 30 minutes', `Refreshes every 60 s · updated ${new Date().toLocaleTimeString('en-IN')} · grouped by GA4 property`, `<div class="chip-live big"><span class="pulse${all ? '' : ' idle'}"></span><b>${num(all)}</b> active</div>`)
      + (host ? `<div class="banner">${icon('info')}<div>GA realtime reports can't be split by site, so this shows every property. For per-site live visitors use <a href="${CL.link({ src: 'own', tab: 'live', site: host })}">CodeLove Analytics → Live</a>.</div></div>` : '')
      + res.map((r) => (r.error ? `<div class="error">${icon('alert')}<div><b>${esc(r.p.name)}</b>: ${esc(r.error)}</div></div>` : `<section class="card"><div class="card-head"><h2>${esc(r.p.name)}</h2><span><b>${num(r.total)}</b> <span class="muted">active</span></span></div>${r.total ? `<div class="grid2" style="margin:0">${barList('Pages (by title)', r.screens)}${barList('Countries', r.countries)}</div>` : '<p class="empty">Nobody right now.</p>'}</section>`)).join(''));
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { if (alive()) window.dispatchEvent(new HashChangeEvent('hashchange')); }, 60e3);
  }

  function viewSignIn(msg) {
    const origin = location.origin;
    const clientShort = (CFG.clientId || '').split('-')[0];
    paint(`<section class="card signin"><span class="logo" aria-hidden="true"></span><div class="eyebrow">Google Analytics</div><h1>Connect Google Analytics</h1>
      <p>Sign in with the Google account that owns the GA4 properties${CFG.ownerEmail ? ` (<b>${esc(CFG.ownerEmail)}</b>)` : ''}. Read-only access.</p>
      ${msg ? `<div class="error">${icon('alert')}<div>${esc(msg)}</div></div>` : ''}
      <button class="btn lg" id="gaSignin">${CL.G_LOGO || ''}Sign in with Google</button>
      <div class="help"><b>Google shows "Error 400: origin_mismatch"?</b> The OAuth client doesn't allow this address yet. One-time fix:
        <ol><li>Open <a href="https://console.cloud.google.com/apis/credentials/oauthclient/${encodeURIComponent(CFG.clientId || '')}?project=${encodeURIComponent(clientShort)}" target="_blank" rel="noopener">this OAuth client in Google Cloud</a> (signed in as the owner Gmail).</li>
        <li>Under <i>Authorized JavaScript origins</i> click <b>Add URI</b> and enter <code>${esc(origin)}</code> (no slash at the end).</li>
        <li>Click <b>Save</b>.</li>
        <li>Wait 5 minutes, then sign in again.</li></ol>
        <div style="margin-top:8px"><b>"Access blocked … not completed the Google verification process"?</b> Google Auth Platform → Audience → add this Gmail under <b>Test users</b>.</div></div></section>`, false);
    $('#gaSignin').onclick = async () => {
      try { await signIn(token ? '' : 'select_account'); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { viewSignIn(e.message); }
    };
  }

  async function route({ R, alive, site, tab }) {
    clearTimeout(liveTimer);
    if (!CFG.clientId) { paint(`<div class="error">${icon('alert')}<div>Set <code>clientId</code> in config.js to use Google Analytics.</div></div>`, false); return; }
    if (!token) return viewSignIn();
    loading('Loading Google Analytics…');
    try {
      if (tab === 'pages') await viewPages(R, alive, site);
      else if (tab === 'live') await viewLive(alive, site);
      else if (site) await viewSite(R, alive, site);
      else await viewOverview(R, alive);
    } catch (e) {
      if (!alive()) return;
      paint(`<div class="error">${icon('alert')}<div><b>Couldn't load Google Analytics.</b><br>${esc(e.message)}<div class="note">If the API is disabled, enable "Google Analytics Data API" and "Google Analytics Admin API" in Google Cloud. If permission is denied, sign in with the account that has access to the GA4 properties.</div></div></div><button class="btn" id="retry">Try again</button>`, false);
      $('#retry').onclick = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  window.GA = { route, signOut, clear: () => { cache.clear(); props = null; }, stop: () => clearTimeout(liveTimer), signedIn: () => !!token };
})();
