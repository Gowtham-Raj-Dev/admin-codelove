/* Google Analytics 4 section: reads GA4 Data/Admin APIs with the owner's Google login. */
(() => {
  'use strict';
  const { $, store, num, compact, pct, dur, durAxis, esc, div, iso, parseIso, addDays, rangeText, chartCard, kpis, deltaHtml, table, barList, favicon } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
  const ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';
  const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
  const app = $('#app');

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
  function groupByProp(sites) {
    const m = new Map();
    for (const s of sites) { if (!m.has(s.prop.id)) m.set(s.prop.id, new Set()); m.get(s.prop.id).add(s.host); }
    return m;
  }

  async function loadSeries(R, sites) {
    const hourly = R.days <= 2;
    const dim = hourly ? 'dateHour' : 'date';
    const sum = new Map();
    await Promise.all([...groupByProp(sites)].map(async ([pid, hosts]) => {
      const body = {
        dateRanges: [{ startDate: R.start, endDate: R.end }],
        dimensions: [{ name: dim }, { name: 'hostName' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'userEngagementDuration' }],
      };
      if (hosts.size === 1) body.dimensionFilter = hostFilter([...hosts][0]);
      for (const row of await report(pid, body)) {
        if (!hosts.has(row.d[1])) continue;
        const a = sum.get(row.d[0]) || [0, 0, 0];
        row.m.forEach((v, i) => (a[i] += v));
        sum.set(row.d[0], a);
      }
    }));
    const pts = [];
    const nowKey = iso(new Date()).replace(/-/g, '') + String(new Date().getHours()).padStart(2, '0');
    for (let d = parseIso(R.start); d <= parseIso(R.end); d = addDays(d, 1)) {
      const k = iso(d).replace(/-/g, '');
      if (hourly) {
        for (let h = 0; h < 24; h++) {
          const kk = k + String(h).padStart(2, '0');
          if (kk > nowKey) break;
          const v = sum.get(kk) || [0, 0, 0];
          pts.push({ label: `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${String(h).padStart(2, '0')}:00`, short: String(h).padStart(2, '0') + ':00', users: v[0], views: v[1], time: v[2] });
        }
      } else {
        const v = sum.get(k) || [0, 0, 0];
        pts.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), short: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), users: v[0], views: v[1], time: v[2] });
      }
    }
    return pts;
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
  const METRICS = [
    { k: 'users', label: 'Users', fmt: num, axis: compact },
    { k: 'views', label: 'Views', fmt: num, axis: compact },
    { k: 'time', label: 'Time spent', fmt: dur, axis: durAxis },
  ];
  const summary = (p) => `${num(p.users)} users · ${num(p.views)} views · ${dur(p.time)}`;
  const chart = (title, pts) => chartCard(title, pts, METRICS, summary, 'cl_ga_metric');

  function totals(sites, which) {
    const t = { activeUsers: 0, newUsers: 0, sessions: 0, screenPageViews: 0, userEngagementDuration: 0, engagedSessions: 0 };
    for (const s of sites) for (const k in t) t[k] += s[which][k];
    return t;
  }
  function kpiSet(c, p) {
    return kpis([
      { label: 'Users', value: num(c.activeUsers), delta: deltaHtml(c.activeUsers, p.activeUsers), accent: true },
      { label: 'Page views', value: num(c.screenPageViews), delta: deltaHtml(c.screenPageViews, p.screenPageViews) },
      { label: 'Total time spent', value: dur(c.userEngagementDuration), delta: deltaHtml(c.userEngagementDuration, p.userEngagementDuration) },
      { label: 'Avg time per user', value: dur(div(c.userEngagementDuration, c.activeUsers)), delta: deltaHtml(div(c.userEngagementDuration, c.activeUsers), div(p.userEngagementDuration, p.activeUsers)) },
      { label: 'Sessions', value: num(c.sessions), delta: deltaHtml(c.sessions, p.sessions) },
      { label: 'Engagement rate', value: pct(div(c.engagedSessions, c.sessions)), delta: deltaHtml(div(c.engagedSessions, c.sessions), div(p.engagedSessions, p.sessions)) },
    ]);
  }
  const errorBox = (errs) => (errs.length ? `<div class="error"><b>Some GA4 properties failed:</b><br>${errs.map(esc).join('<br>')}<div class="note">Check that "Google Analytics Data API" and "Google Analytics Admin API" are enabled in your Google Cloud project.</div></div>` : '');
  const siteLink = (host) => `<a href="#/ga/site/${encodeURIComponent(host)}">${esc(host)}</a>`;

  async function viewOverview(R, alive) {
    const { sites: all, errors } = await loadSites(R);
    const sites = visibleSites(all).filter((s) => s.cur.activeUsers + s.cur.screenPageViews + s.prev.screenPageViews > 0);
    const series = await loadSeries(R, sites);
    if (!alive()) return;
    const c = totals(sites, 'cur'), p = totals(sites, 'prev');
    app.innerHTML = `${errorBox(errors)}<div class="hero ga"><div><div class="eyebrow">Google Analytics</div><h1>All sites</h1><p class="sub">${rangeText(R)} · ${sites.length} sites · vs ${rangeText({ start: R.prevStart, end: R.prevEnd })}</p></div></div>${kpiSet(c, p)}`;
    app.append(chart('Across all sites', series));
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<div class="card-head"><h2>Sites</h2><label class="note"><input type="checkbox" id="allHosts" ${showAll() ? 'checked' : ''}> Show all hosts</label></div><div class="tbl"></div><p class="note">Users are counted per site. Time spent is GA4 engagement time (page in focus).</p>`;
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

  async function viewSite(R, alive, host) {
    const { sites, errors } = await loadSites(R);
    const site = sites.find((s) => s.host === host);
    if (!alive()) return;
    if (!site) { app.innerHTML = `<a class="crumb" href="#/ga">← All sites</a><h1>${esc(host)}</h1><p class="muted">No data for this site in ${rangeText(R)}.</p>`; return; }
    const [series, pages, countries, devices, sources, cities] = await Promise.all([
      loadSeries(R, [site]), loadPages(R, [site]),
      loadBreakdown(R, site, 'country'), loadBreakdown(R, site, 'deviceCategory'),
      loadBreakdown(R, site, 'sessionSourceMedium', 'sessions'), loadBreakdown(R, site, 'city'),
    ]);
    if (!alive()) return;
    app.innerHTML = `${errorBox(errors)}<a class="crumb" href="#/ga">← All sites</a><div class="hero ga"><div><div class="eyebrow">Google Analytics · ${esc(site.prop.name)}</div><h1 class="site-title">${favicon(host)}<a href="https://${esc(host)}" target="_blank" rel="noopener">${esc(host)} ↗</a></h1><p class="sub">${rangeText(R)}</p></div></div>${kpiSet(site.cur, site.prev)}`;
    app.append(chart('Trend', series));
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = '<div class="card-head"><h2>Pages</h2></div><div class="tbl"></div><p class="note">Avg / user = engagement time on that page ÷ users who viewed it.</p>';
    app.append(card);
    table($('.tbl', card), pageCols(false), pages, { sort: 'views', search: 'Search path or title' });
    const g = document.createElement('div');
    g.className = 'grid3';
    g.innerHTML = barList('Countries (users)', countries) + barList('Cities (users)', cities) + barList('Devices (users)', devices) + barList('Traffic sources (sessions)', sources);
    app.append(g);
  }

  async function viewPages(R, alive) {
    const { sites, errors } = await loadSites(R);
    const vis = visibleSites(sites);
    const pages = await loadPages(R, vis);
    if (!alive()) return;
    const t = pages.reduce((a, p) => ((a.views += p.views), (a.time += p.time), a), { views: 0, time: 0 });
    app.innerHTML = `${errorBox(errors)}<div class="hero ga"><div><div class="eyebrow">Google Analytics</div><h1>All pages</h1><p class="sub">${rangeText(R)} · ${num(pages.length)} pages across ${vis.length} sites · ${num(t.views)} views · ${dur(t.time)} total time</p></div></div>`;
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = '<div class="tbl"></div>';
    app.append(card);
    table($('.tbl', card), pageCols(true), pages, { sort: 'views', search: 'Search site, path or title' });
  }

  let liveTimer = null;
  async function viewLive(alive) {
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
    app.innerHTML = `<div class="hero ga"><div><div class="eyebrow">Google Analytics · realtime</div><h1>Live — last 30 minutes</h1><p class="sub">Refreshes every 60 s · updated ${new Date().toLocaleTimeString('en-IN')} · grouped by GA4 property</p></div><div class="hero-live"><span class="pulse"></span><b>${num(all)}</b> active</div></div>
      ${res.map((r) => r.error ? `<div class="error"><b>${esc(r.p.name)}</b>: ${esc(r.error)}</div>` : `<section class="card"><div class="card-head"><h2>${esc(r.p.name)}</h2><span><b>${num(r.total)}</b> active</span></div>${r.total ? `<div class="grid3">${barList('Pages (by title)', r.screens)}${barList('Countries', r.countries)}</div>` : '<p class="muted">Nobody right now.</p>'}</section>`).join('')}`;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { if (alive()) window.dispatchEvent(new HashChangeEvent('hashchange')); }, 60e3);
  }

  function viewSignIn(msg) {
    app.innerHTML = `<section class="card setup" style="text-align:center"><div class="eyebrow">Google Analytics</div><h1>Connect Google Analytics</h1><p class="muted">Sign in with the Google account that owns the GA4 properties.</p>
      ${msg ? `<div class="error">${esc(msg)}</div>` : ''}
      <button class="primary" id="gaSignin">Sign in with Google</button>
      <p class="note" style="margin-top:16px">"Access blocked … has not completed the Google verification process" → in Google Cloud, Google Auth Platform → Audience, add this Gmail under <b>Test users</b> (or press <b>Publish app</b>).</p></section>`;
    $('#gaSignin').onclick = async () => {
      try { await signIn('select_account'); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { viewSignIn(e.message); }
    };
  }

  async function route(hash, R, alive) {
    clearTimeout(liveTimer);
    if (!CFG.clientId) { app.innerHTML = '<div class="error">Set <code>clientId</code> in config.js to use Google Analytics.</div>'; return; }
    if (!token) return viewSignIn();
    app.innerHTML = '<div class="center muted">Loading Google Analytics…</div>';
    try {
      if (hash.startsWith('#/ga/site/')) await viewSite(R, alive, decodeURIComponent(hash.slice(10)));
      else if (hash.startsWith('#/ga/pages')) await viewPages(R, alive);
      else if (hash.startsWith('#/ga/live')) await viewLive(alive);
      else await viewOverview(R, alive);
    } catch (e) {
      if (!alive()) return;
      app.innerHTML = `<div class="error"><b>Couldn't load Google Analytics.</b><br>${esc(e.message)}<div class="note">If the API is disabled, enable "Google Analytics Data API" and "Google Analytics Admin API" in Google Cloud. If permission is denied, sign in with the account that has access to the GA4 properties.</div></div><button class="ghost" id="retry">Try again</button>`;
      $('#retry').onclick = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  window.GA = { route, signOut, clear: () => { cache.clear(); props = null; }, stop: () => clearTimeout(liveTimer), signedIn: () => !!token };
})();
