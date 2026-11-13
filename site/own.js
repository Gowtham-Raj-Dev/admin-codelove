/* CodeLove Analytics section: our own tracker data (t.js) from Cloud Firestore.
 * Collection d, one document per site per IST day: d/{YYYY-MM-DD}_{host_with_underscores}
 *   t: {v,u,n,s,sec,c}  p: {pageKey: {v,u,sec,c,ti}}  h/r/dev/tz/br/clk: {key: count}  live: {vid: {p, t}} */
(() => {
  'use strict';
  const { $, num, compact, dur, durAxis, esc, div, iso, istToday, rangeText, eachDay, chartCard, columns, sparkline, kpis, deltaHtml, table, barList, favicon } = CL;
  const CFG = (window.ADMIN_CONFIG || {}).firebase || {};
  const OWNER = (window.ADMIN_CONFIG || {}).ownerEmail || '';
  const app = $('#app');
  const LIVE_WINDOW = 90e3; // tracker heartbeat is 60 s

  let db = null, auth = null, user = null, authReady = false;
  const onAuthChange = [];
  function init() {
    if (db || !window.firebase || !CFG.apiKey) return;
    firebase.initializeApp(CFG);
    auth = firebase.auth();
    db = firebase.firestore();
    auth.onAuthStateChanged((u) => { user = u; authReady = true; onAuthChange.forEach((f) => f(u)); if (u) watchLive(); else unwatchLive(); });
  }
  const now = () => Date.now();
  const docId = () => firebase.firestore.FieldPath.documentId();

  // ---------- data ----------
  const cache = new Map();
  function getDays(start, end) {
    const k = start + '|' + end;
    if (!cache.has(k)) {
      cache.set(k, db.collection('d').where(docId(), '>=', start).where(docId(), '<=', end + '_').get().then((snap) => {
        const raw = {};
        snap.forEach((doc) => {
          const i = doc.id.indexOf('_');
          const day = doc.id.slice(0, i), site = doc.id.slice(i + 1);
          (raw[day] ||= {})[site] = doc.data();
        });
        return raw;
      }).catch((e) => { cache.delete(k); throw e; }));
    }
    return cache.get(k);
  }
  const hostOf = (site) => site.replace(/_/g, '.');
  const dec = (k) => { try { return decodeURIComponent(k); } catch { return k; } };
  const T0 = () => ({ v: 0, u: 0, n: 0, s: 0, sec: 0, c: 0 });
  function addT(a, t) { if (t) for (const k in a) a[k] += t[k] || 0; }
  function addMap(a, m) { if (m) for (const k in m) a[k] = (a[k] || 0) + (m[k] || 0); }

  // Aggregate a date range into per-site stats (+ previous period totals).
  async function load(R, onlySite) {
    const raw = await getDays(R.prevStart, R.end);
    const sites = {};
    const get = (site) => (sites[site] ||= { site, host: hostOf(site), cur: T0(), prev: T0(), daily: {}, pages: {}, h: {}, r: {}, dev: {}, tz: {}, clk: {}, br: {} });
    for (const day in raw) {
      const inCur = day >= R.start && day <= R.end;
      for (const site in raw[day]) {
        if (onlySite ? site !== onlySite : site === 'localhost') continue; // localhost = test data, only on its own page
        const d = raw[day][site] || {}, S = get(site);
        if (!inCur) { addT(S.prev, d.t); continue; }
        addT(S.cur, d.t);
        S.daily[day] = { ...T0(), ...(d.t || {}) };
        for (const pk in d.p || {}) {
          const src = d.p[pk] || {}, p = (S.pages[pk] ||= { v: 0, u: 0, sec: 0, c: 0, ti: '' });
          p.v += src.v || 0; p.u += src.u || 0; p.sec += src.sec || 0; p.c += src.c || 0;
          if (src.ti) p.ti = src.ti;
        }
        for (const g of ['h', 'r', 'dev', 'tz', 'clk', 'br']) addMap(S[g], d[g]);
      }
    }
    return Object.values(sites);
  }
  function series(R, sites) {
    const pts = [];
    eachDay(R.start, R.end, (day, d) => {
      const t = T0();
      for (const s of sites) addT(t, s.daily[day]);
      pts.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), short: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), users: t.u, views: t.v, time: t.sec, clicks: t.c, visits: t.s });
    });
    return pts;
  }
  const sumT = (sites, which) => { const t = T0(); sites.forEach((s) => addT(t, s[which])); return t; };
  const sumG = (sites, g) => { const m = {}; sites.forEach((s) => addMap(m, s[g])); return m; };
  const top = (m, n = 10, map = (k) => ({ name: dec(k) })) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ ...map(k), value: v }));
  function pageRows(sites) {
    const rows = [];
    for (const s of sites) for (const pk in s.pages) {
      const p = s.pages[pk];
      if (!p.v && !p.sec) continue;
      rows.push({ host: s.host, site: s.site, path: dec(pk), title: p.ti || '', views: p.v, users: p.u, time: p.sec, clicks: p.c, perUser: div(p.sec, p.u), perView: div(p.sec, p.v) });
    }
    return rows;
  }

  // ---------- live: listen to today's documents (live.{vid} = {p, t}) ----------
  let liveUnsub = null, liveDayKey = '', liveData = {}, liveTitles = {}; const liveListeners = new Set();
  function watchLive() {
    const today = iso(istToday());
    if (liveUnsub && liveDayKey === today) return;
    if (liveUnsub) liveUnsub();
    liveDayKey = today;
    liveUnsub = db.collection('d').where(docId(), '>=', today).where(docId(), '<=', today + '_').onSnapshot((snap) => {
      liveData = {}; liveTitles = {};
      snap.forEach((doc) => {
        const site = doc.id.slice(doc.id.indexOf('_') + 1), d = doc.data();
        liveData[site] = d.live || {};
        liveTitles[site] = {};
        for (const pk in d.p || {}) if (d.p[pk] && d.p[pk].ti) liveTitles[site][pk] = d.p[pk].ti;
      });
      liveListeners.forEach((f) => f()); updateBadge();
    }, () => {});
  }
  function unwatchLive() { if (liveUnsub) liveUnsub(); liveUnsub = null; liveData = {}; updateBadge(); }
  const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : Number(t) || 0);
  function liveNow() {
    const cut = now() - LIVE_WINDOW, out = [];
    for (const site in liveData) for (const vid in liveData[site]) { const e = liveData[site][vid]; if (e && ms(e.t) > cut) out.push({ site, host: hostOf(site), path: e.p || '/', vid }); }
    return out;
  }
  function updateBadge() {
    const el = $('#liveBadge');
    if (!el) return;
    const n = user ? liveNow().length : 0;
    el.hidden = !user;
    el.innerHTML = `<span class="pulse${n ? '' : ' idle'}"></span>${num(n)} live`;
    document.querySelectorAll('.hero-live[data-site]').forEach((h) => {
      const s = h.dataset.site, c = s ? liveNow().filter((x) => x.site === s).length : n;
      h.innerHTML = `<span class="pulse${c ? '' : ' idle'}"></span><b>${num(c)}</b> on site now`;
    });
  }
  setInterval(() => { if (user) watchLive(); updateBadge(); liveListeners.forEach((f) => f()); }, 10e3);
  // Visitors whose tab closed without the final "bye" stay in live.{vid}; the owner removes them after 30 min.
  function cleanupLive() {
    const cut = now() - 30 * 60e3;
    for (const site in liveData) {
      const upd = {};
      for (const vid in liveData[site]) if (!liveData[site][vid] || ms(liveData[site][vid].t) < cut) upd['live.' + vid] = firebase.firestore.FieldValue.delete();
      if (Object.keys(upd).length) db.collection('d').doc(liveDayKey + '_' + site).update(upd).catch(() => {});
    }
  }

  // ---------- views ----------
  const METRICS = [
    { k: 'users', label: 'Visitors', fmt: num, axis: compact },
    { k: 'views', label: 'Views', fmt: num, axis: compact },
    { k: 'time', label: 'Time spent', fmt: dur, axis: durAxis },
    { k: 'clicks', label: 'Clicks', fmt: num, axis: compact },
  ];
  const summary = (p) => `${num(p.users)} visitors · ${num(p.visits)} visits · ${num(p.views)} views · ${dur(p.time)} · ${num(p.clicks)} clicks`;
  const chart = (title, pts) => chartCard(title, pts, METRICS, summary, 'cl_own_metric');

  function kpiSet(c, p) {
    return kpis([
      { label: 'Visitors', value: num(c.u), delta: deltaHtml(c.u, p.u), accent: true },
      { label: 'New visitors', value: num(c.n), delta: deltaHtml(c.n, p.n) },
      { label: 'Visits', value: num(c.s), delta: deltaHtml(c.s, p.s) },
      { label: 'Page views', value: num(c.v), delta: deltaHtml(c.v, p.v) },
      { label: 'Time spent', value: dur(c.sec), delta: deltaHtml(c.sec, p.sec) },
      { label: 'Avg time / visitor', value: dur(div(c.sec, c.u)), delta: deltaHtml(div(c.sec, c.u), div(p.sec, p.u)) },
      { label: 'Clicks', value: num(c.c), delta: deltaHtml(c.c, p.c) },
    ]);
  }
  function hero(eyebrow, title, sub, extra = '') {
    return `<div class="hero"><div><div class="eyebrow">${eyebrow}</div><h1 class="site-title">${title}</h1><p class="sub">${sub}</p></div>${extra}</div>`;
  }
  const liveHero = (n, site = '') => `<a class="hero-live" data-site="${esc(site)}" href="#/live"><span class="pulse${n ? '' : ' idle'}"></span><b>${num(n)}</b> on site now</a>`;
  const siteLink = (host) => `<a href="#/site/${encodeURIComponent(host)}">${esc(host)}</a>`;
  const SNIPPET = '<script defer src="https://admin.codelove.in/t.js"></script>';

  function hoursCard(sites, title = 'Busy hours (IST, page views)') {
    const h = sumG(sites, 'h');
    const items = Array.from({ length: 24 }, (_, i) => { const k = String(i).padStart(2, '0'); return { label: k, tip: `${k}:00 – ${k}:59 IST`, value: h[k] || 0 }; });
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<h2>${esc(title)}</h2><div class="chart cols"></div>`;
    columns($('.chart', card), items, (v) => num(v) + ' views');
    return card;
  }
  function clickItems(m, n = 10, withPage = true) {
    return top(m, n, (k) => {
      const s = dec(k), i = s.indexOf(' :: ');
      const page = i >= 0 ? s.slice(0, i) : '', label = i >= 0 ? s.slice(i + 4) : s;
      return { name: s, html: `${esc(label)}${withPage && page ? ` <span class="note">on ${esc(page)}</span>` : ''}` };
    });
  }
  const tzName = (k) => { const s = dec(k); return s.replace(/_/g, ' '); };

  function emptyState() {
    return `<section class="card setup-card"><h2>No visits recorded yet</h2>
      <p>Add this one line to every site (inside <code>&lt;head&gt;</code>), deploy, and visits start showing here within seconds:</p>
      <pre class="code">${esc(SNIPPET)}</pre>
      <p class="note">Works on all *.codelove.in sites and localhost. Counts visitors, visits, page views, time on page (tab visible and active), clicks, sources, devices and live visitors. No cookies.</p></section>`;
  }

  async function viewOverview(R, alive) {
    const all = await load(R);
    if (!alive()) return;
    const sites = all.filter((s) => s.cur.v || s.prev.v).sort((a, b) => b.cur.u - a.cur.u || b.cur.v - a.cur.v);
    const c = sumT(sites, 'cur'), p = sumT(sites, 'prev');
    const live = liveNow();
    app.innerHTML = hero('CodeLove Analytics', 'All sites', `${rangeText(R)} · ${sites.length} sites · vs ${rangeText({ start: R.prevStart, end: R.prevEnd })}`, liveHero(live.length));
    if (!sites.length) { app.insertAdjacentHTML('beforeend', emptyState()); return; }
    app.insertAdjacentHTML('beforeend', kpiSet(c, p));
    app.append(chart('Across all sites', series(R, sites)));

    // site cards
    const grid = document.createElement('div');
    grid.className = 'site-grid';
    const liveBy = {}; live.forEach((x) => (liveBy[x.site] = (liveBy[x.site] || 0) + 1));
    grid.innerHTML = sites.map((s) => {
      const vals = []; eachDay(R.start, R.end, (d) => vals.push(s.daily[d]?.u || 0));
      const ch = s.prev.u ? (s.cur.u - s.prev.u) / s.prev.u : null;
      return `<a class="site-card" href="#/site/${encodeURIComponent(s.host)}">
        <div class="sc-head">${favicon(s.host)}<span class="sc-host">${esc(s.host)}</span>${liveBy[s.site] ? `<span class="sc-live"><span class="pulse"></span>${liveBy[s.site]}</span>` : ''}</div>
        <div class="sc-main"><div><div class="sc-num">${num(s.cur.u)}</div><div class="note">visitors ${ch == null ? '' : `<span class="delta ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'}${Math.abs(ch * 100).toFixed(0)}%</span>`}</div></div>${sparkline(vals)}</div>
        <div class="sc-stats"><span><b>${num(s.cur.v)}</b> views</span><span><b>${dur(s.cur.sec)}</b> time</span><span><b>${dur(div(s.cur.sec, s.cur.u))}</b> / visitor</span><span><b>${num(s.cur.c)}</b> clicks</span></div>
      </a>`;
    }).join('');
    const wrap = document.createElement('section');
    wrap.innerHTML = '<h2 class="section-title">Sites</h2>';
    wrap.append(grid);
    app.append(wrap);

    const g = document.createElement('div');
    g.className = 'grid2';
    g.append(hoursCard(sites));
    const srcTotal = c.s;
    g.insertAdjacentHTML('beforeend', barList('Where visitors come from (visits)', top(sumG(sites, 'r'), 10), num, { total: srcTotal }));
    app.append(g);
    const g2 = document.createElement('div');
    g2.className = 'grid3';
    g2.innerHTML = barList('Devices (visitors)', top(sumG(sites, 'dev'))) + barList('Browsers (visitors)', top(sumG(sites, 'br'))) + barList('Regions (timezone)', top(sumG(sites, 'tz'), 10, (k) => ({ name: tzName(k) })));
    app.append(g2);

    const pages = pageRows(sites).sort((a, b) => b.views - a.views).slice(0, 10);
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = '<div class="card-head"><h2>Top pages</h2><a href="#/pages">All pages →</a></div><div class="tbl"></div>';
    app.append(card);
    table($('.tbl', card), pageCols(true), pages, { sort: 'views' });
    app.insertAdjacentHTML('beforeend', `<div class="grid2">${barList('Most clicked (all sites)', clickItems(sumG(sites, 'clk'), 12), num, { noPct: true })}<section class="card"><h2>About these numbers</h2><p class="note">Visitors = unique visitors per site per day, added up over the range (someone who comes back on 3 days counts 3). Visit = a new session after 30 min of no activity. Time spent counts only while the tab is visible and the person was active in the last 5 minutes (or a video is playing). Days are in IST.</p></section></div>`);
  }

  function pageCols(withHost) {
    const cols = [];
    if (withHost) cols.push({ key: 'host', label: 'Site', html: (r) => `<span class="site-cell">${favicon(r.host)}${siteLink(r.host)}</span>` });
    cols.push(
      { key: 'path', label: 'Page', cls: 'path', html: (r) => `<a href="https://${esc(r.host)}${esc(r.path)}" target="_blank" rel="noopener" title="${esc(r.path)}">${esc(r.path)}</a>${r.title ? `<span class="title" title="${esc(r.title)}">${esc(r.title)}</span>` : ''}` },
      { key: 'views', label: 'Views', num: true, fmt: num, bar: true },
      { key: 'users', label: 'Visitors', num: true, fmt: num },
      { key: 'time', label: 'Total time', num: true, fmt: dur, bar: true },
      { key: 'perUser', label: 'Avg / visitor', num: true, fmt: dur },
      { key: 'perView', label: 'Avg / view', num: true, fmt: dur },
      { key: 'clicks', label: 'Clicks', num: true, fmt: num },
    );
    return cols;
  }

  async function viewSite(R, alive, host) {
    const site = host.replace(/\./g, '_');
    const list = await load(R, site);
    if (!alive()) return;
    const s = list[0];
    const liveHere = liveNow().filter((x) => x.site === site);
    const title = `${favicon(host)}<a href="https://${esc(host)}" target="_blank" rel="noopener">${esc(host)} ↗</a>`;
    app.innerHTML = `<a class="crumb" href="#/">← All sites</a>` + hero('CodeLove Analytics', title, rangeText(R), liveHero(liveHere.length, site));
    if (!s || !(s.cur.v || s.prev.v)) { app.insertAdjacentHTML('beforeend', `<p class="muted">No visits for this site in ${rangeText(R)}.</p>` + emptyState()); return; }
    app.insertAdjacentHTML('beforeend', kpiSet(s.cur, s.prev));
    app.append(chart('Trend', series(R, [s])));
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = '<div class="card-head"><h2>Pages</h2></div><div class="tbl"></div><p class="note">Visitors per page are unique per day, added up over the range.</p>';
    app.append(card);
    table($('.tbl', card), pageCols(false), pageRows([s]), { sort: 'views', search: 'Search path or title' });
    const g = document.createElement('div');
    g.className = 'grid2';
    g.append(hoursCard([s]));
    g.insertAdjacentHTML('beforeend', barList('Most clicked', clickItems(s.clk, 12), num, { noPct: true }));
    app.append(g);
    const g2 = document.createElement('div');
    g2.className = 'grid3';
    g2.innerHTML = barList('Sources (visits)', top(s.r), num, { total: s.cur.s }) + barList('Devices (visitors)', top(s.dev)) + barList('Browsers (visitors)', top(s.br)) + barList('Regions (timezone)', top(s.tz, 10, (k) => ({ name: tzName(k) })));
    app.append(g2);
  }

  async function viewPages(R, alive) {
    const sites = await load(R);
    if (!alive()) return;
    const rows = pageRows(sites);
    const t = rows.reduce((a, p) => ((a.views += p.views), (a.time += p.time), (a.clicks += p.clicks), a), { views: 0, time: 0, clicks: 0 });
    app.innerHTML = hero('CodeLove Analytics', 'All pages', `${rangeText(R)} · ${num(rows.length)} pages · ${num(t.views)} views · ${dur(t.time)} total time · ${num(t.clicks)} clicks`);
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = '<div class="tbl"></div>';
    app.append(card);
    table($('.tbl', card), pageCols(true), rows, { sort: 'views', search: 'Search site, path or title' });
  }

  let liveRender = null;
  async function viewLive(alive) {
    cleanupLive();
    const render = () => {
      const titles = liveTitles;
      if (!alive()) { liveListeners.delete(render); return; }
      const live = liveNow();
      const bySite = {}, byPage = {};
      live.forEach((x) => { bySite[x.host] = (bySite[x.host] || 0) + 1; const k = x.host + x.path; (byPage[k] ||= { host: x.host, site: x.site, path: x.path, n: 0 }).n++; });
      const pages = Object.values(byPage).sort((a, b) => b.n - a.n).slice(0, 30);
      const pk = (p) => encodeURIComponent(p).replace(/\./g, '%2E').replace(/[*'()!~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      app.innerHTML = hero('CodeLove Analytics · live', 'Right now', `People with a CodeLove page open in the last ${LIVE_WINDOW / 1000} s · updates instantly`, `<div class="hero-live big"><span class="pulse${live.length ? '' : ' idle'}"></span><b>${num(live.length)}</b> online</div>`)
        + `<div class="grid2">${barList('Sites', Object.entries(bySite).sort((a, b) => b[1] - a[1]).map(([h, n]) => ({ name: h, html: `<span class="site-cell">${favicon(h)}${siteLink(h)}</span>`, value: n })), (v) => num(v) + ' online')}`
        + barList('Pages being viewed', pages.map((p) => ({ name: p.host + p.path, html: `<a href="https://${esc(p.host)}${esc(p.path)}" target="_blank" rel="noopener">${esc((titles[p.site] && titles[p.site][pk(p.path)]) || p.path)}</a> <span class="note">${esc(p.host)}${esc(p.path)}</span>`, value: p.n })), (v) => num(v) + ' online') + '</div>'
        + (live.length ? '' : '<p class="muted center">Nobody online right now. This page updates by itself.</p>');
    };
    liveRender = render;
    liveListeners.add(render);
    render();
  }

  function viewTracker() {
    app.innerHTML = hero('CodeLove Analytics', 'Tracker setup', 'One line on every site') + `<section class="card setup-card"><h2>Add to every site</h2><pre class="code">${esc(SNIPPET)}</pre>
      <ul><li>Put it in <code>&lt;head&gt;</code> (Next.js: in <code>app/layout.tsx</code> with <code>&lt;Script src=… strategy="afterInteractive" /&gt;</code>; Vite/static: in <code>index.html</code>).</li>
      <li>Only *.codelove.in hosts and localhost are accepted by the database rules.</li>
      <li>Single-page apps are handled automatically (pushState / back button).</li>
      <li>Bots, headless browsers and iframes are skipped.</li></ul></section>`;
  }

  function viewSignIn(msg) {
    app.innerHTML = `<section class="card setup" style="text-align:center"><div class="eyebrow">CodeLove Analytics</div><h1>Welcome back</h1><p class="muted">Private dashboard. Sign in with ${OWNER ? `<b>${esc(OWNER)}</b>` : 'the owner Google account'}.</p>
      ${msg ? `<div class="error">${esc(msg)}</div>` : ''}<button class="primary" id="ownSignin">Sign in with Google</button></section>`;
    $('#ownSignin').onclick = async () => {
      try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); } catch (e) { viewSignIn(e.code === 'auth/popup-closed-by-user' ? '' : e.message); }
    };
  }

  async function route(hash, R, alive) {
    init();
    if (!db) { app.innerHTML = '<div class="error">Firebase config missing in config.js.</div>'; return; }
    if (!authReady) { app.innerHTML = '<div class="center muted">Loading…</div>'; await new Promise((r) => onAuthChange.push(r)); if (!alive()) return; }
    if (!user) return viewSignIn();
    if (OWNER && user.email !== OWNER) return viewSignIn(`${user.email} is not allowed. Sign out and use ${OWNER}.`);
    app.innerHTML = '<div class="center muted">Loading analytics…</div>';
    try {
      if (hash.startsWith('#/site/')) await viewSite(R, alive, decodeURIComponent(hash.slice(7)));
      else if (hash.startsWith('#/pages')) await viewPages(R, alive);
      else if (hash.startsWith('#/live')) await viewLive(alive);
      else if (hash.startsWith('#/tracker')) viewTracker();
      else await viewOverview(R, alive);
    } catch (e) {
      if (!alive()) return;
      const denied = /permission|denied/i.test(e.message);
      app.innerHTML = `<div class="error"><b>Couldn't load analytics.</b><br>${esc(e.message)}${denied ? '<div class="note">The database only lets the owner account read. Sign out and sign in with the owner Gmail.</div>' : ''}</div><button class="ghost" id="retry">Try again</button>`;
      $('#retry').onclick = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  window.OWN = {
    route,
    init,
    signOut: () => auth && auth.signOut(),
    clear: () => cache.clear(),
    stop: () => { if (liveRender) liveListeners.delete(liveRender); liveRender = null; },
    user: () => user,
    onAuth: (f) => onAuthChange.push(f),
    updateBadge,
  };
})();
