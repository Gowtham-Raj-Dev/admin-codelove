/* CodeLove Analytics section: our own tracker data (t.js) from Cloud Firestore.
 * Collection d, one document per site per IST day: d/{YYYY-MM-DD}_{host_with_underscores}
 *   t: {v,u,n,s,sec,c}  p: {pageKey: {v,u,sec,c,ti}}  h/r/dev/tz/br/clk: {key: count}  live: {vid: {p, t}}
 * Every number shown here is read from those documents — nothing is sampled or made up. */
(() => {
  'use strict';
  const { $, num, compact, dur, durAxis, esc, div, iso, addDays, istToday, fmtDate, rangeText, eachDay, kpiChart, columns, sparkline, deltaHtml, table, barList, favicon, icon, pageHead, loading, paint, el } = CL;
  const ADMIN = window.ADMIN_CONFIG || {};
  const CFG = ADMIN.firebase || {};
  const OWNER = ADMIN.ownerEmail || '';
  const SINCE = ADMIN.trackingSince || '';
  const app = $('#app');
  const LIVE_WINDOW = 90e3; // tracker heartbeat is 60 s

  let db = null, auth = null, user = null, authReady = false;
  const onAuthChange = [];
  function init() {
    if (db || !window.firebase || !CFG.apiKey) return;
    firebase.initializeApp(CFG);
    auth = firebase.auth();
    db = firebase.firestore();
    auth.onAuthStateChanged((u) => { user = u; authReady = true; onAuthChange.slice().forEach((f) => f(u)); if (u) watchLive(); else unwatchLive(); });
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
  const siteOf = (host) => host.replace(/\./g, '_');
  const dec = (k) => { try { return decodeURIComponent(k); } catch { return k; } };
  const T0 = () => ({ v: 0, u: 0, n: 0, s: 0, sec: 0, c: 0 });
  function addT(a, t) { if (t) for (const k in a) a[k] += t[k] || 0; }
  function addMap(a, m) { if (m) for (const k in m) a[k] = (a[k] || 0) + (m[k] || 0); }

  // Aggregate a date range into per-site stats (+ previous period totals).
  async function load(R, onlySite) {
    const raw = await getDays(R.prevStart, R.end);
    const sites = {};
    const get = (site) => (sites[site] ||= { site, host: hostOf(site), cur: T0(), prev: T0(), daily: {}, pages: {}, h: {}, r: {}, dev: {}, tz: {}, clk: {}, br: {} });
    // Every listed site gets a card, even with no data yet.
    if (onlySite) get(onlySite); else (ADMIN.sites || []).forEach((h) => get(siteOf(h)));
    for (const day in raw) {
      const inCur = day >= R.start && day <= R.end;
      for (const site in raw[day]) {
        // All-sites views: only *.codelove.in (localhost = test data, only on its own page).
        if (onlySite ? site !== onlySite : !/(^|_)codelove_in$/.test(site)) continue;
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
  // Days before the tracker existed are "no data", not "zero visitors" — leave them off the chart.
  const chartStart = (R) => (SINCE && R.start < SINCE && R.end >= SINCE ? SINCE : R.start);
  function series(R, sites) {
    const pts = [];
    eachDay(chartStart(R), R.end, (day, d) => {
      const t = T0();
      for (const s of sites) addT(t, s.daily[day]);
      pts.push({
        iso: day,
        label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
        short: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        u: t.u, n: t.n, s: t.s, v: t.v, sec: t.sec, avg: div(t.sec, t.u), c: t.c,
      });
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
  let liveUnsub = null, liveDayKey = '', liveData = {}, liveTitles = {};
  const liveListeners = new Set();
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
    for (const site in liveData) {
      if (!/(^|_)codelove_in$/.test(site)) continue;
      for (const vid in liveData[site]) { const e = liveData[site][vid]; if (e && ms(e.t) > cut) out.push({ site, host: hostOf(site), path: e.p || '/', vid }); }
    }
    return out;
  }
  const pulse = (n) => `<span class="pulse${n ? '' : ' idle'}"></span>`;
  function updateBadge() {
    const n = user ? liveNow().length : 0;
    const b = $('#liveBadge');
    if (b) { b.hidden = !user; b.innerHTML = `${pulse(n)}${num(n)} live`; }
    document.querySelectorAll('[data-live-count]').forEach((c) => { c.hidden = !user || !n; c.textContent = num(n); });
    document.querySelectorAll('.chip-live[data-site]').forEach((h) => {
      const s = h.dataset.site, c = s ? liveNow().filter((x) => x.site === s).length : n;
      h.innerHTML = `${pulse(c)}<b>${num(c)}</b> on site now`;
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

  // ---------- building blocks ----------
  const EYEBROW = 'CodeLove Analytics';
  const liveChip = (n, site = '') => `<a class="chip-live" data-site="${esc(site)}" href="${CL.link({ src: 'own', tab: 'live', site: site ? hostOf(site) : null })}">${pulse(n)}<b>${num(n)}</b> on site now</a>`;
  const siteHref = (host) => CL.link({ src: 'own', tab: 'overview', site: host });
  const siteLink = (host) => `<a href="${siteHref(host)}">${esc(host)}</a>`;
  const SNIPPET = '<script defer src="https://admin.codelove.in/t.js"></script>';
  const summary = (p) => `${num(p.u)} visitors · ${num(p.s)} visits · ${num(p.v)} views · ${dur(p.sec)} · ${num(p.c)} clicks`;
  function rangeSub(R, extra = '') {
    let s = rangeText(R) + extra;
    if (SINCE && R.start < SINCE) s += ` · tracking started ${fmtDate(SINCE)}`;
    return s;
  }

  function metricChart(R, c, p, pts) {
    const none = SINCE && R.prevEnd < SINCE ? 'no earlier data' : '';
    const d = (a, b) => deltaHtml(a, b, { none });
    return kpiChart({
      storeKey: 'cl_own_metric2', summary, unit: 'day', pts,
      metrics: [
        { k: 'u', label: 'Visitors', value: num(c.u), delta: d(c.u, p.u), fmt: num, axis: compact },
        { k: 'n', label: 'New visitors', value: num(c.n), delta: d(c.n, p.n), fmt: num, axis: compact },
        { k: 's', label: 'Visits', value: num(c.s), delta: d(c.s, p.s), fmt: num, axis: compact },
        { k: 'v', label: 'Page views', value: num(c.v), delta: d(c.v, p.v), fmt: num, axis: compact },
        { k: 'sec', label: 'Time spent', value: dur(c.sec), delta: d(c.sec, p.sec), fmt: dur, axis: durAxis },
        { k: 'avg', label: 'Avg time / visitor', value: dur(div(c.sec, c.u)), delta: d(div(c.sec, c.u), div(p.sec, p.u)), fmt: dur, axis: durAxis },
        { k: 'c', label: 'Clicks', value: num(c.c), delta: d(c.c, p.c), fmt: num, axis: compact },
      ],
    });
  }
  function hoursCard(sites, title = 'Busy hours · IST · page views') {
    const h = sumG(sites, 'h');
    const items = Array.from({ length: 24 }, (_, i) => { const k = String(i).padStart(2, '0'); return { label: k, tip: `${k}:00 – ${k}:59 IST`, value: h[k] || 0 }; });
    const card = el('section', 'card', `<div class="card-head"><h2>${esc(title)}</h2></div><div class="chart cols"></div>`);
    columns($('.chart', card), items, (v) => num(v) + ' views');
    return card;
  }
  function clickItems(m, n = 10, withPage = true) {
    return top(m, n, (k) => {
      const s = dec(k), i = s.indexOf(' :: ');
      const page = i >= 0 ? s.slice(0, i) : '', label = i >= 0 ? s.slice(i + 4) : s;
      return { name: s, html: `${esc(label)}${withPage && page ? `<span class="note">on ${esc(page)}</span>` : ''}` };
    });
  }
  const tzName = (k) => dec(k).replace(/_/g, ' ');
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
  function emptyState(R) {
    return `<section class="card setup-card"><div class="card-head"><h2>No visits recorded in ${esc(rangeText(R))}</h2></div>
      <p class="note">Visits appear here within seconds of someone opening a page that has the tracker. Check the <a href="#/tracker">Tracker</a> page to see which sites are sending data.</p></section>`;
  }
  const aboutCard = `<section class="card"><div class="card-head"><h2>How these numbers are counted</h2></div><ul class="note" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">
    <li>Everything comes from the tracker (t.js) on the live sites. Nothing is sample or demo data.</li>
    <li><b>Visitors</b> = unique visitors per site per day, added up over the range (someone who comes back on 3 days counts 3).</li>
    <li><b>Visit</b> = a new session after 30 min of no activity.</li>
    <li><b>Time spent</b> counts only while the tab is visible and the person was active in the last 5 min (or a video is playing).</li>
    <li>Bots, headless browsers, iframes and localhost are skipped. Days are in IST.</li></ul></section>`;

  // ---------- views ----------
  async function viewOverview(R, alive) {
    const all = await load(R);
    if (!alive()) return;
    const sites = all.sort((a, b) => b.cur.u - a.cur.u || b.cur.v - a.cur.v || a.host.localeCompare(b.host));
    const c = sumT(sites, 'cur'), p = sumT(sites, 'prev');
    const live = liveNow();
    paint(pageHead(EYEBROW, 'All sites', rangeSub(R, ` · ${sites.length} sites`), liveChip(live.length)));
    if (!sites.some((s) => s.cur.v || s.cur.sec)) app.insertAdjacentHTML('beforeend', emptyState(R));
    app.append(metricChart(R, c, p, series(R, sites)));

    const liveBy = {}; live.forEach((x) => (liveBy[x.site] = (liveBy[x.site] || 0) + 1));
    const noPrev = SINCE && R.prevEnd < SINCE;
    const head = el('div', 'section-title', `<h2>Sites</h2><span class="note">Sorted by visitors · click a site for details</span>`);
    const grid = el('div', 'site-grid');
    grid.innerHTML = sites.map((s) => {
      const vals = []; eachDay(chartStart(R), R.end, (d) => vals.push(s.daily[d]?.u || 0));
      const ch = !noPrev && s.prev.u ? (s.cur.u - s.prev.u) / s.prev.u : null;
      return `<a class="site-card${s.cur.u || s.cur.v ? '' : ' zero'}" href="${siteHref(s.host)}">
        <div class="sc-head">${favicon(s.host)}<span class="sc-host">${esc(s.host)}</span>${liveBy[s.site] ? `<span class="sc-live"><span class="pulse"></span>${liveBy[s.site]}</span>` : ''}</div>
        <div class="sc-main"><div><div class="sc-num">${num(s.cur.u)}</div><div class="note">visitors ${ch == null ? '' : `<span class="delta ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'}${Math.abs(ch * 100).toFixed(0)}%</span>`}</div></div>${sparkline(vals)}</div>
        <div class="sc-stats"><span><b>${num(s.cur.v)}</b> views</span><span><b>${dur(s.cur.sec)}</b> time</span><span><b>${dur(div(s.cur.sec, s.cur.u))}</b> / visitor</span><span><b>${num(s.cur.c)}</b> clicks</span></div>
      </a>`;
    }).join('');
    app.append(head, grid);

    const g = el('div', 'grid2');
    g.append(hoursCard(sites));
    g.insertAdjacentHTML('beforeend', barList('Where visitors come from · visits', top(sumG(sites, 'r'), 10), num, { total: c.s }));
    app.append(g);
    app.insertAdjacentHTML('beforeend', `<div class="grid3">${barList('Devices · visitors', top(sumG(sites, 'dev')))}${barList('Browsers · visitors', top(sumG(sites, 'br')))}${barList('Regions (time zone) · visitors', top(sumG(sites, 'tz'), 10, (k) => ({ name: tzName(k) })))}</div>`);

    const pages = pageRows(sites).sort((a, b) => b.views - a.views).slice(0, 10);
    const card = el('section', 'card', `<div class="card-head"><h2>Top pages</h2><a href="${CL.link({ src: 'own', tab: 'pages' })}">All pages →</a></div><div class="tbl"></div>`);
    app.append(card);
    table($('.tbl', card), pageCols(true), pages, { sort: 'views' });
    app.insertAdjacentHTML('beforeend', `<div class="grid2">${barList('Most clicked · all sites', clickItems(sumG(sites, 'clk'), 12), num, { noPct: true })}${aboutCard}</div>`);
  }

  async function viewSite(R, alive, host) {
    const site = siteOf(host);
    const s = (await load(R, site))[0];
    if (!alive()) return;
    const liveHere = liveNow().filter((x) => x.site === site);
    const title = `${favicon(host)}<a href="https://${esc(host)}" target="_blank" rel="noopener" title="Open ${esc(host)}">${esc(host)}${icon('ext')}</a>`;
    paint(`<a class="crumb" href="${CL.link({ src: 'own' })}">← All sites</a>` + pageHead(EYEBROW, title, rangeSub(R), liveChip(liveHere.length, site)));
    if (!(s.cur.v || s.cur.sec)) app.insertAdjacentHTML('beforeend', emptyState(R));
    app.append(metricChart(R, s.cur, s.prev, series(R, [s])));
    const card = el('section', 'card', `<div class="card-head"><h2>Pages</h2><span class="note">Visitors per page are unique per day, added up over the range</span></div><div class="tbl"></div>`);
    app.append(card);
    table($('.tbl', card), pageCols(false), pageRows([s]), { sort: 'views', search: 'Search path or title' });
    const g = el('div', 'grid2');
    g.append(hoursCard([s]));
    g.insertAdjacentHTML('beforeend', barList('Most clicked', clickItems(s.clk, 12), num, { noPct: true }));
    app.append(g);
    app.insertAdjacentHTML('beforeend', `<div class="grid2">${barList('Sources · visits', top(s.r), num, { total: s.cur.s })}${barList('Devices · visitors', top(s.dev))}${barList('Browsers · visitors', top(s.br))}${barList('Regions (time zone) · visitors', top(s.tz, 10, (k) => ({ name: tzName(k) })))}</div>`);
  }

  async function viewPages(R, alive, host) {
    const sites = host ? await load(R, siteOf(host)) : await load(R);
    if (!alive()) return;
    const rows = pageRows(sites);
    const t = rows.reduce((a, p) => ((a.views += p.views), (a.time += p.time), (a.clicks += p.clicks), a), { views: 0, time: 0, clicks: 0 });
    paint(pageHead(EYEBROW, host ? `Pages · ${esc(host)}` : 'All pages', rangeSub(R, ` · ${num(rows.length)} pages · ${num(t.views)} views · ${dur(t.time)} total time · ${num(t.clicks)} clicks`)));
    const card = el('section', 'card', '<div class="tbl"></div>');
    app.append(card);
    table($('.tbl', card), pageCols(!host), rows, { sort: 'views', search: host ? 'Search path or title' : 'Search site, path or title' });
  }

  let liveRender = null;
  async function viewLive(alive, host) {
    cleanupLive();
    const only = host ? siteOf(host) : '';
    const pk = (p) => encodeURIComponent(p).replace(/\./g, '%2E').replace(/[*'()!~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const render = () => {
      if (!alive()) { liveListeners.delete(render); return; }
      const titles = liveTitles;
      const live = liveNow().filter((x) => !only || x.site === only);
      const bySite = {}, byPage = {};
      live.forEach((x) => { bySite[x.host] = (bySite[x.host] || 0) + 1; const k = x.host + x.path; (byPage[k] ||= { host: x.host, site: x.site, path: x.path, n: 0 }).n++; });
      const pages = Object.values(byPage).sort((a, b) => b.n - a.n).slice(0, 30);
      paint(pageHead(EYEBROW + ' · live', host ? `Right now · ${esc(host)}` : 'Right now', `People with a page open in the last ${LIVE_WINDOW / 1000} s · updates by itself`, `<div class="chip-live big">${pulse(live.length)}<b>${num(live.length)}</b> online</div>`)
        + `<div class="grid2">${host ? '' : barList('Sites', Object.entries(bySite).sort((a, b) => b[1] - a[1]).map(([h, n]) => ({ name: h, html: `<span class="site-cell">${favicon(h)}${siteLink(h)}</span>`, value: n })), (v) => num(v) + ' online')}`
        + barList('Pages being viewed', pages.map((p) => ({ name: p.host + p.path, html: `<a href="https://${esc(p.host)}${esc(p.path)}" target="_blank" rel="noopener">${esc((titles[p.site] && titles[p.site][pk(p.path)]) || p.path)}</a><span class="note">${host ? '' : esc(p.host)}${esc(p.path)}</span>`, value: p.n })), (v) => num(v) + ' online') + '</div>'
        + (live.length ? '' : '<p class="empty" style="text-align:center">Nobody online right now. This page updates by itself.</p>'));
    };
    liveRender = render;
    liveListeners.add(render);
    render();
  }

  // Tracker page: the snippet + a health check of which sites actually sent data (proof the numbers are real).
  async function viewTracker(alive) {
    const today = istToday(), start = iso(addDays(today, -6)), end = iso(today);
    const raw = await getDays(start, end);
    if (!alive()) return;
    const rows = (ADMIN.sites || []).map((host) => {
      const site = siteOf(host);
      let last = '', views = 0, users = 0;
      for (const day of Object.keys(raw).sort()) { const t = raw[day][site] && raw[day][site].t; if (t && (t.v || t.sec)) { last = day; views += t.v || 0; users += t.u || 0; } }
      return { host, last, views, users };
    });
    const ok = rows.filter((r) => r.last).length;
    paint(pageHead(EYEBROW, 'Tracker', `${ok} of ${rows.length} sites sent data in the last 7 days`) + `
      <section class="card setup-card"><div class="card-head"><h2>Add to a new site</h2></div>
        <div class="code-row"><pre class="code">${esc(SNIPPET)}</pre><button type="button" class="btn" id="copySnippet">${icon('copy')}Copy</button></div>
        <ul><li>Put it in <code>&lt;head&gt;</code> (Next.js: <code>app/layout.tsx</code>; Vite/static: <code>index.html</code>).</li>
        <li>Also add the host to <code>sites</code> in <code>config.js</code> so it gets a card even at 0 visitors.</li>
        <li>Only *.codelove.in hosts and localhost are accepted by the database rules. Single-page apps are handled automatically.</li>
        <li>Bots, headless browsers and iframes are skipped. No cookies; one random id in localStorage.</li></ul></section>
      <section class="card health"><div class="card-head"><h2>Sites sending data · last 7 days</h2><span class="note">${esc(fmtDate(start))} – ${esc(fmtDate(end))}</span></div><div class="tbl"></div></section>`);
    table($('.health .tbl', app), [
      { key: 'host', label: 'Site', html: (r) => `<span class="site-cell">${favicon(r.host)}${siteLink(r.host)}</span>` },
      { key: 'last', label: 'Status', html: (r) => (r.last ? `<span class="status on">Receiving</span>` : '<span class="status">No data yet</span>') },
      { key: 'last2', label: 'Last data', html: (r) => (r.last ? esc(r.last === end ? 'Today' : fmtDate(r.last)) : '<span class="muted">–</span>') },
      { key: 'users', label: 'Visitors (7d)', num: true, fmt: num },
      { key: 'views', label: 'Views (7d)', num: true, fmt: num, bar: true },
    ], rows, { sort: 'views' });
    const cp = $('#copySnippet');
    cp.onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(SNIPPET).then(() => { cp.lastChild.textContent = 'Copied'; }, () => {}); };
  }

  const G_LOGO = '<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  CL.G_LOGO = G_LOGO;
  function viewSignIn(msg) {
    paint(`<section class="card signin"><span class="logo" aria-hidden="true"></span><div class="eyebrow">CodeLove Analytics</div><h1>Welcome back</h1>
      <p>Private dashboard. Sign in with ${OWNER ? `<b>${esc(OWNER)}</b>` : 'the owner Google account'}.</p>
      ${msg ? `<div class="error">${icon('alert')}<div>${esc(msg)}</div></div>` : ''}
      <button class="btn lg" id="ownSignin">${G_LOGO}Sign in with Google</button></section>`, false);
    $('#ownSignin').onclick = async () => {
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        if (OWNER) provider.setCustomParameters({ login_hint: OWNER });
        await auth.signInWithPopup(provider);
      } catch (e) {
        const m = {
          'auth/popup-closed-by-user': '', 'auth/cancelled-popup-request': '',
          'auth/popup-blocked': 'The browser blocked the sign-in popup. Allow popups for admin.codelove.in and try again.',
          'auth/unauthorized-domain': `${location.hostname} is not in Firebase → Authentication → Settings → Authorized domains.`,
        }[e.code];
        viewSignIn(m ?? e.message);
      }
    };
  }

  async function route({ R, alive, site, tab }) {
    init();
    if (!db) { paint(`<div class="error">${icon('alert')}<div>Firebase config missing in config.js.</div></div>`, false); return; }
    if (!authReady) { loading(); await new Promise((r) => onAuthChange.push(r)); if (!alive()) return; }
    if (!user) return viewSignIn();
    if (OWNER && user.email !== OWNER) return viewSignIn(`${user.email} is not allowed. Sign out (top right) and use ${OWNER}.`);
    loading('Loading analytics…');
    try {
      if (tab === 'pages') await viewPages(R, alive, site);
      else if (tab === 'live') await viewLive(alive, site);
      else if (tab === 'tracker') await viewTracker(alive);
      else if (site) await viewSite(R, alive, site);
      else await viewOverview(R, alive);
    } catch (e) {
      if (!alive()) return;
      const denied = /permission|denied/i.test(e.message);
      paint(`<div class="error">${icon('alert')}<div><b>Couldn't load analytics.</b><br>${esc(e.message)}${denied ? '<div class="note">The database only lets the owner account read. Sign out and sign in with the owner Gmail.</div>' : ''}</div></div><button class="btn" id="retry">Try again</button>`, false);
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
