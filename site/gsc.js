/* Google Search section: Search Console APIs read in the browser with the owner's Google login.
 *   Keywords / Pages / Not showing: Search Analytics — which searches each site shows up for and on which
 *     results page (position 1–10 = page 1).
 *   Index status: URL Inspection (on demand, cached in localStorage) + Sitemaps API + rule-based "what to do".
 * Numbers come straight from the Search Console API (same data as search.google.com/search-console). */
(() => {
  'use strict';
  const { $, store, num, compact, pct, pctAxis, esc, div, iso, istToday, rangeText, eachDay, kpiChart, deltaHtml, table, favicon, icon, pageHead, loading, paint, el, gAuth, gGate, gReconnect, gSignIn, selectMenu } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const SCOPE = CL.GSC_SCOPE;
  const SCOPE_W = 'https://www.googleapis.com/auth/webmasters'; // only for "Resubmit sitemap", asked on that click
  const API = 'https://www.googleapis.com/webmasters/v3';
  const INSPECT_API = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
  const SITES = CFG.sites || [];
  const TARGETS = CFG.searchKeywords || {};
  const PROJECT = (CFG.clientId || '').split('-')[0];
  const ENABLE_URL = `https://console.cloud.google.com/apis/library/searchconsole.googleapis.com?project=${encodeURIComponent(PROJECT)}`;
  const GSC_URL = 'https://search.google.com/search-console';
  const app = $('#app');
  const EYEBROW = 'Google Search';

  // ---------- API ----------
  const cache = new Map();
  async function api(url, body, retried = false, method = body ? 'POST' : 'GET') {
    const res = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + gAuth.token(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    // 401 = token died early: renew silently if this run started from a click, else the route shows Reconnect
    if (res.status === 401 && !retried) { gAuth.expire(); await gAuth.renew(); return api(url, body, true, method); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    return json;
  }
  function cached(key, fn) {
    if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
    return cache.get(key);
  }

  // Search Console properties this Google account can read: "sc-domain:codelove.in" (domain property, covers
  // every subdomain) or URL-prefix ones like "https://games.codelove.in/".
  const listProps = () => cached('sites', () => api(`${API}/sites`).then((j) => (j.siteEntry || [])
    .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
    .map((s) => ({ url: s.siteUrl, level: s.permissionLevel }))));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The property to read a host from: its own URL-prefix property first, else the closest domain property
  // filtered to that host's pages (RE2 regex on the page URL).
  function propFor(host, list) {
    for (const u of [`https://${host}/`, `http://${host}/`, `https://www.${host}/`, `http://www.${host}/`]) {
      if (list.some((p) => p.url === u)) return { url: u, filter: null };
    }
    const dom = list.map((p) => p.url).filter((u) => u.startsWith('sc-domain:')).map((u) => u.slice(10))
      .filter((d) => host === d || host.endsWith('.' + d)).sort((a, b) => b.length - a.length)[0];
    return dom ? { url: 'sc-domain:' + dom, filter: `^https?://(www\\.)?${reEsc(host)}(/|:|$)` } : null;
  }
  async function resolve(only) {
    const list = await listProps();
    const all = (only ? [only] : SITES).map((host) => ({ host, prop: propFor(host, list) }));
    return { list, sites: all.filter((s) => s.prop), missing: all.filter((s) => !s.prop).map((s) => s.host) };
  }

  const PAGE_ROWS = 25000, MAX_ROWS = 100000;
  function query(prop, start, end, dimensions) {
    // dataState 'all' includes the newest (still preliminary) days, like the Search Console website.
    const body = { startDate: start, endDate: end, dimensions, type: 'web', dataState: 'all', rowLimit: PAGE_ROWS };
    if (prop.filter) body.dimensionFilterGroups = [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: prop.filter }] }];
    return cached(prop.url + JSON.stringify(body), async () => {
      const out = [];
      for (let startRow = 0; startRow < MAX_ROWS; startRow += PAGE_ROWS) {
        const j = await api(`${API}/sites/${encodeURIComponent(prop.url)}/searchAnalytics/query`, { ...body, startRow });
        const rows = j.rows || [];
        for (const r of rows) out.push({ k: r.keys || [], c: r.clicks || 0, i: r.impressions || 0, ctr: r.ctr || 0, pos: r.position || 0 });
        if (rows.length < PAGE_ROWS) break;
      }
      return out;
    });
  }
  // Google shows 10 results per page: #1–10 = page 1, #11–20 = page 2, …
  const rankOf = (pos) => (pos > 0 ? Math.max(1, Math.round(pos)) : 0);
  const daily = (s, R) => query(s.prop, R.prevStart, R.end, ['date']);
  const keywords = (s, R) => query(s.prop, R.start, R.end, ['query']).then((rows) => rows.map((r) => ({ host: s.host, query: r.k[0], clicks: r.c, impr: r.i, ctr: r.ctr, pos: r.pos, rank: rankOf(r.pos) })));
  async function pages(s, R) {
    const by = new Map();
    for (const r of await query(s.prop, R.start, R.end, ['page', 'query'])) {
      const [url, q] = r.k;
      let p = by.get(url);
      if (!p) by.set(url, (p = { host: s.host, url, path: pathOf(url, s.host), clicks: 0, impr: 0, posI: 0, kws: [] }));
      p.clicks += r.c; p.impr += r.i; p.posI += r.pos * r.i;
      p.kws.push({ query: q, clicks: r.c, impr: r.i, ctr: r.ctr, pos: r.pos, rank: rankOf(r.pos) });
    }
    return [...by.values()].map((p) => {
      p.kws.sort((a, b) => b.impr - a.impr || a.pos - b.pos);
      const best = Math.min(...p.kws.map((k) => k.rank || Infinity));
      return { ...p, ctr: div(p.clicks, p.impr), pos: div(p.posI, p.impr), best: isFinite(best) ? best : 0, count: p.kws.length, top: p.kws[0]?.query || '' };
    });
  }
  function pathOf(url, host) {
    try { const u = new URL(url); return (u.hostname === host ? '' : u.hostname) + u.pathname + u.search; } catch { return url; }
  }

  // Run fn for every site; one failing site shows as a warning, all failing = the whole view fails.
  async function each(sites, fn) {
    const errs = [];
    const out = await Promise.all(sites.map((s) => fn(s).then((v) => ({ ...s, ...v })).catch((e) => { errs.push({ host: s.host, e }); return null; })));
    if (sites.length && errs.length === sites.length) throw errs[0].e;
    return { ok: out.filter(Boolean), errors: errs.map((x) => `${x.host}: ${x.e.message}`) };
  }

  // Daily clicks / impressions / CTR / position for the chart (several sites added up; position weighted by impressions).
  function series(R, dailies) {
    const sum = new Map();
    for (const rows of dailies) for (const r of rows) {
      const a = sum.get(r.k[0]) || [0, 0, 0];
      a[0] += r.c; a[1] += r.i; a[2] += r.pos * r.i;
      sum.set(r.k[0], a);
    }
    const total = (from, to) => {
      const t = [0, 0, 0];
      for (const [d, a] of sum) if (d >= from && d <= to) a.forEach((v, j) => (t[j] += v));
      return { c: t[0], i: t[1], ctr: div(t[0], t[1]), pos: div(t[2], t[1]) };
    };
    const pts = [];
    eachDay(R.start, R.end, (day, d) => {
      const a = sum.get(day) || [0, 0, 0];
      pts.push({
        iso: day,
        label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
        short: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        c: a[0], i: a[1], ctr: div(a[0], a[1]), pos: div(a[2], a[1]),
      });
    });
    return { pts, cur: total(R.start, R.end), prev: total(R.prevStart, R.prevEnd) };
  }

  // Target keywords vs the searches Search Console saw: case-insensitive "search contains target".
  function targetRows(s) {
    const qs = (s.k || []).map((k) => ({ ...k, ql: k.query.toLowerCase() }));
    return (TARGETS[s.host] || []).map((t) => {
      const tl = String(t).toLowerCase().trim();
      const hits = tl ? qs.filter((q) => q.ql.includes(tl)) : [];
      const best = hits.reduce((b, q) => (q.rank && (!b || q.rank < b.rank) ? q : b), null);
      const rank = best ? best.rank : 0;
      return {
        host: s.host, target: t, rank, sortRank: rank || 1000, match: best ? best.query : '', more: Math.max(0, hits.length - 1),
        impr: hits.reduce((a, q) => a + q.impr, 0), clicks: hits.reduce((a, q) => a + q.clicks, 0),
        group: !rank ? 'none' : rank <= 10 ? 'p1' : rank <= 30 ? 'p23' : 'deep',
      };
    });
  }

  // ---------- building blocks ----------
  const posFmt = (v) => (v ? v.toFixed(1) : '–');
  const posAxis = (v) => String(Math.round(v));
  function gpage(rank) {
    if (!rank) return '<span class="gp none">Not in Google yet</span>';
    const p = Math.ceil(rank / 10);
    return `<span class="gp ${p === 1 ? 'p1' : p <= 3 ? 'p23' : 'deep'}" title="Average position ${rank} → results page ${p}">Page ${p} <span class="gp-rank">(#${rank})</span></span>`;
  }
  const summary = (p) => `${num(p.c)} clicks · ${num(p.i)} impressions · ${pct(p.ctr)} CTR · position ${posFmt(p.pos)}`;
  function metricChart(S) {
    const { cur: c, prev: p } = S;
    return kpiChart({
      storeKey: 'cl_gsc_metric', summary, unit: 'day', pts: S.pts,
      note: 'Avg position: lower is better (1 = top of Google). Days with no impressions show 0.',
      metrics: [
        { k: 'c', label: 'Clicks', value: num(c.c), delta: deltaHtml(c.c, p.c), fmt: num, axis: compact },
        { k: 'i', label: 'Impressions', value: num(c.i), delta: deltaHtml(c.i, p.i), fmt: num, axis: compact },
        { k: 'ctr', label: 'CTR', value: pct(c.i ? c.ctr : null), delta: c.i ? deltaHtml(c.ctr, p.ctr) : deltaHtml(0, 0, { none: 'no impressions' }), fmt: pct, axis: pctAxis },
        { k: 'pos', label: 'Avg position', value: posFmt(c.pos), delta: c.pos ? deltaHtml(c.pos, p.pos, { lower: true }) : deltaHtml(0, 0, { none: 'no impressions' }), fmt: posFmt, axis: posAxis },
      ],
    });
  }
  const lagBanner = `<div class="banner">${icon('info')}<div>Search Console data comes <b>2–3 days late</b>, so the newest days are empty or still change. <b>Google page</b> = average position ÷ 10, rounded up (#1–10 = page 1).</div></div>`;
  const missingBanner = (hosts) => (hosts.length ? `<div class="banner">${icon('info')}<div><b>${hosts.length} ${hosts.length === 1 ? 'site is' : 'sites are'} not in Search Console</b> for this Google account: ${hosts.map(esc).join(', ')}. Add them in <a href="${GSC_URL}" target="_blank" rel="noopener">Search Console</a>: one Domain property <code>codelove.in</code> covers every subdomain.</div></div>` : '');
  const errorBox = (errs) => (errs.length ? `<div class="error">${icon('alert')}<div><b>Some sites failed:</b><br>${errs.map(esc).join('<br>')}<div class="note">Check that this Google account has access to the property in Search Console → Settings → Users and permissions.</div></div></div>` : '');
  const siteHref = (host) => CL.link({ src: 'gsc', tab: 'overview', site: host });
  const siteCol = { key: 'host', label: 'Site', html: (r) => `<span class="site-cell">${favicon(r.host)}<a href="${siteHref(r.host)}">${esc(r.host)}</a></span>` };
  const crumb = (tab) => `<a class="crumb" href="${CL.link({ src: 'gsc', tab })}">← All sites</a>`;
  const hostTitle = (host) => `${favicon(host)}<a href="https://${esc(host)}" target="_blank" rel="noopener" title="Open ${esc(host)}">${esc(host)}${icon('ext')}</a>`;
  const vsText = (R) => `compared with the ${R.days === 1 ? 'day' : `${R.days} days`} before`;
  function noPropCard(host) {
    return `<section class="card setup-card"><div class="card-head"><h2>${esc(host)} is not in Search Console</h2></div>
      <p class="note" style="margin:0">This Google account has no Search Console property for it. Add it in <a href="${GSC_URL}" target="_blank" rel="noopener">Search Console</a> (a Domain property <code>codelove.in</code> covers every subdomain), or sign out and use the account that owns it.</p></section>`;
  }
  function noPropsView() {
    paint(pageHead(EYEBROW, 'No Search Console properties', '') + `<section class="card setup-card"><div class="card-head"><h2>Nothing to read yet</h2></div>
      <p class="note" style="margin:0">This Google account can't see any verified Search Console property.</p>
      <ul><li>Open <a href="${GSC_URL}" target="_blank" rel="noopener">Search Console</a> with ${CFG.ownerEmail ? `<b>${esc(CFG.ownerEmail)}</b>` : 'the owner Gmail'} and add <code>codelove.in</code> as a <b>Domain</b> property (one DNS TXT record, covers every subdomain), or add each site as a URL-prefix property.</li>
      <li>Already added under another Gmail? Add this one in Search Console → Settings → Users and permissions, or sign out (top right) and sign in with that account.</li></ul></section>`);
  }
  const kwCell = (q) => `<a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener" title="Open this search on Google">${esc(q)}</a>`;
  function kwCols(withHost) {
    const cols = [];
    if (withHost) cols.push(siteCol);
    cols.push(
      { key: 'query', label: 'Keyword', cls: 'kw', html: (r) => kwCell(r.query) },
      { key: 'clicks', label: 'Clicks', num: true, fmt: num, bar: true },
      { key: 'impr', label: 'Impressions', num: true, fmt: num, bar: true },
      { key: 'ctr', label: 'CTR', num: true, fmt: pct },
      { key: 'pos', label: 'Avg position', num: true, fmt: posFmt, lowFirst: true },
      { key: 'rank', label: 'Google page', num: true, lowFirst: true, html: (r) => gpage(r.rank) },
    );
    return cols;
  }
  const aboutKw = 'Keyword = the Google search people typed. Searches Google keeps private (rare ones) are left out, so these add up to less than the totals above.';

  // ---------- views ----------
  async function viewKeywords(R, alive, host) {
    const { list, sites, missing } = await resolve(host);
    if (!alive()) return;
    if (!list.length) return noPropsView();
    if (host && !sites.length) { paint(crumb('overview') + pageHead(EYEBROW, hostTitle(host), rangeText(R)) + noPropCard(host)); return; }
    const { ok, errors } = await each(sites, (s) => Promise.all([daily(s, R), keywords(s, R)]).then(([d, k]) => ({ d, k })));
    if (!alive()) return;
    const S = series(R, ok.map((s) => s.d));
    if (host) {
      const s = ok[0];
      const tr = targetRows(s), notYet = tr.filter((t) => !t.rank).length;
      paint(errorBox(errors) + crumb('overview') + pageHead(`${EYEBROW} · ${esc(s.prop.url)}`, hostTitle(host), `${rangeText(R)} · ${num(s.k.length)} keywords · ${vsText(R)}`) + lagBanner);
      app.append(metricChart(S));
      const card = el('section', 'card', `<div class="card-head"><h2>Keywords</h2>${tr.length ? `<a href="${CL.link({ src: 'gsc', tab: 'missing', site: host })}">Target keywords: ${notYet ? `${num(notYet)} of ${num(tr.length)} not in Google yet` : `all ${num(tr.length)} show up`} →</a>` : ''}</div><div class="tbl"></div><p class="note">${aboutKw}</p>`);
      app.append(card);
      table($('.tbl', card), kwCols(false), s.k, { sort: 'impr', search: 'Search keywords' });
      return;
    }
    const all = ok.flatMap((s) => s.k);
    paint(errorBox(errors) + pageHead(EYEBROW, 'All sites', `${rangeText(R)} · ${ok.length} sites in Search Console · ${num(all.length)} keywords · ${vsText(R)}`) + lagBanner + missingBanner(missing));
    app.append(metricChart(S));
    const rows = ok.map((s) => {
      const t = series(R, [s.d]).cur, tr = targetRows(s);
      return {
        host: s.host, prop: s.prop.url, clicks: t.c, impr: t.i, ctr: t.i ? t.ctr : null, pos: t.pos,
        kws: s.k.length, page1: s.k.filter((k) => k.rank && k.rank <= 10).length,
        targets: tr.length, notYet: tr.length ? tr.filter((x) => !x.rank).length : null,
      };
    });
    const sitesCard = el('section', 'card', '<div class="card-head"><h2>Sites</h2><span class="note">Click a site for its keywords</span></div><div class="tbl"></div>');
    app.append(sitesCard);
    table($('.tbl', sitesCard), [
      { key: 'host', label: 'Site', html: (r) => `<span class="site-cell">${favicon(r.host)}<span><a href="${siteHref(r.host)}">${esc(r.host)}</a><span class="note block">${esc(r.prop)}</span></span></span>` },
      { key: 'clicks', label: 'Clicks', num: true, fmt: num, bar: true },
      { key: 'impr', label: 'Impressions', num: true, fmt: num, bar: true },
      { key: 'ctr', label: 'CTR', num: true, fmt: pct },
      { key: 'pos', label: 'Avg position', num: true, fmt: posFmt, lowFirst: true },
      { key: 'kws', label: 'Keywords', num: true, fmt: num },
      { key: 'page1', label: 'On page 1', num: true, fmt: num },
      { key: 'notYet', label: 'Targets not showing', num: true, html: (r) => (r.notYet == null ? '<span class="muted">–</span>' : `<a href="${CL.link({ src: 'gsc', tab: 'missing', site: r.host })}">${num(r.notYet)} of ${num(r.targets)}</a>`) },
    ], rows, { sort: 'impr' });
    const card = el('section', 'card', `<div class="card-head"><h2>Keywords · all sites</h2></div><div class="tbl"></div><p class="note">${aboutKw}</p>`);
    app.append(card);
    table($('.tbl', card), kwCols(true), all, { sort: 'impr', search: 'Search keyword or site' });
  }

  function pageDetail(p) {
    const list = p.kws.slice(0, 100);
    return `<table class="mini"><thead><tr><th>Keyword</th><th class="num">Clicks</th><th class="num">Impressions</th><th class="num">CTR</th><th class="num">Avg position</th><th class="num">Google page</th></tr></thead><tbody>${list.map((k) => `<tr><td class="kw">${kwCell(k.query)}</td><td class="num">${num(k.clicks)}</td><td class="num">${num(k.impr)}</td><td class="num">${pct(k.ctr)}</td><td class="num">${posFmt(k.pos)}</td><td class="num">${gpage(k.rank)}</td></tr>`).join('')}</tbody></table>${p.kws.length > list.length ? `<p class="note">Showing the top ${list.length} of ${num(p.kws.length)} keywords by impressions.</p>` : ''}`;
  }
  async function viewPages(R, alive, host) {
    const { list, sites, missing } = await resolve(host);
    if (!alive()) return;
    if (!list.length) return noPropsView();
    if (host && !sites.length) { paint(crumb('pages') + pageHead(EYEBROW, `Pages · ${esc(host)}`, rangeText(R)) + noPropCard(host)); return; }
    const { ok, errors } = await each(sites, (s) => pages(s, R).then((p) => ({ p })));
    if (!alive()) return;
    const rows = ok.flatMap((s) => s.p);
    const t = rows.reduce((a, p) => ((a.clicks += p.clicks), (a.impr += p.impr), a), { clicks: 0, impr: 0 });
    paint(errorBox(errors) + pageHead(EYEBROW, host ? `Pages · ${esc(host)}` : 'All pages', `${rangeText(R)} · ${num(rows.length)} pages in Google${host ? '' : ` across ${ok.length} sites`} · ${num(t.clicks)} clicks · ${num(t.impr)} impressions`) + lagBanner + (host ? '' : missingBanner(missing)));
    const card = el('section', 'card', '<div class="card-head"><h2>Pages and their keywords</h2><span class="note">Click a page to see every search it shows up for</span></div><div class="tbl"></div><p class="note">Avg position of a page = its keywords\' positions weighted by impressions. Best spot = its best-ranking keyword.</p>');
    app.append(card);
    const cols = [];
    if (!host) cols.push(siteCol);
    cols.push(
      { key: 'path', label: 'Page', cls: 'path', html: (r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.url)}">${esc(r.path)}</a>${r.top ? `<span class="title" title="${esc(r.top)}">Top search: ${esc(r.top)}</span>` : ''}` },
      { key: 'count', label: 'Keywords', num: true, fmt: num },
      { key: 'clicks', label: 'Clicks', num: true, fmt: num, bar: true },
      { key: 'impr', label: 'Impressions', num: true, fmt: num, bar: true },
      { key: 'ctr', label: 'CTR', num: true, fmt: pct },
      { key: 'pos', label: 'Avg position', num: true, fmt: posFmt, lowFirst: true },
      { key: 'best', label: 'Best spot', num: true, lowFirst: true, html: (r) => gpage(r.best) },
    );
    table($('.tbl', card), cols, rows, { sort: 'impr', search: host ? 'Search page or top keyword' : 'Search site, page or top keyword', expand: pageDetail, rowKey: (r) => r.url });
  }

  const GROUPS = [['all', 'All targets'], ['p1', 'On page 1'], ['p23', 'Page 2–3'], ['deep', 'Page 4 or deeper'], ['none', 'Not in Google yet']];
  async function viewMissing(R, alive, host) {
    const { list, sites, missing } = await resolve(host);
    if (!alive()) return;
    if (!list.length) return noPropsView();
    const title = host ? `Not showing yet · ${esc(host)}` : 'Not showing yet';
    if (host && !sites.length) { paint(crumb('missing') + pageHead(EYEBROW, title, rangeText(R)) + noPropCard(host)); return; }
    const { ok, errors } = await each(sites, (s) => keywords(s, R).then((k) => ({ k })));
    if (!alive()) return;
    const rows = ok.flatMap(targetRows);
    const count = (g) => (g === 'all' ? rows.length : rows.filter((r) => r.group === g).length);
    const noTargets = ok.filter((s) => !(TARGETS[s.host] || []).length).map((s) => s.host);
    paint(errorBox(errors) + (host ? crumb('missing') : '') + pageHead(EYEBROW, title, `${rangeText(R)} · ${num(rows.length)} target keywords · ${num(count('none'))} not in Google yet`) + lagBanner + (host ? '' : missingBanner(missing.filter((h) => (TARGETS[h] || []).length))));
    const tiles = el('section', 'card kc', `<div class="kc-tabs" role="tablist" aria-label="Filter by Google page">${GROUPS.map(([g, label]) => `<button type="button" role="tab" class="kc-tab" data-g="${g}"><span class="kc-label">${esc(label)}</span><span class="kc-value">${num(count(g))}</span><span class="delta">${g === 'all' ? 'show all' : pct(div(count(g), rows.length))}</span></button>`).join('')}</div>`);
    const card = el('section', 'card', `<div class="card-head"><h2>Target keywords</h2><span class="note">Not in Google yet first</span></div><div class="tbl"></div>
      <p class="note">A target counts as showing when a Google search containing it (any case) got at least one impression for the site in this range. "Best match" is that search with the best position. Edit the list in <code>config.js</code> → <code>searchKeywords</code>.${noTargets.length ? ` No targets yet for: ${noTargets.map(esc).join(', ')}.` : ''}</p>`);
    app.append(tiles, card);
    const cols = [];
    if (!host) cols.push(siteCol);
    cols.push(
      { key: 'target', label: 'Target keyword', cls: 'kw', html: (r) => kwCell(r.target) },
      { key: 'sortRank', label: 'Google page', num: true, lowFirst: true, html: (r) => gpage(r.rank) },
      { key: 'match', label: 'Best match', cls: 'kw', html: (r) => (r.match ? `${esc(r.match)}${r.more ? ` <span class="note">+${num(r.more)} more</span>` : ''}` : '<span class="muted">–</span>') },
      { key: 'impr', label: 'Impressions', num: true, fmt: num, bar: true },
      { key: 'clicks', label: 'Clicks', num: true, fmt: num },
    );
    let g = 'all';
    const draw = () => {
      tiles.querySelectorAll('.kc-tab').forEach((b) => { const on = b.dataset.g === g; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      table($('.tbl', card), cols, g === 'all' ? rows : rows.filter((r) => r.group === g), { sort: 'sortRank', search: host ? 'Search target keywords' : 'Search keyword or site' });
    };
    tiles.querySelectorAll('.kc-tab').forEach((b) => b.addEventListener('click', () => { g = b.dataset.g; draw(); }));
    draw();
  }

  // ---------- index status: URL Inspection API (on demand) + Sitemaps API ----------
  // Google allows ~2,000 inspections a day and 600 a minute per property, so nothing is inspected
  // automatically: the owner presses Check (a batch, 3 at a time) and results are kept in localStorage.
  const DAY_QUOTA = 2000, BATCH_SIZES = [10, 25, 50, 100, 200, 500], WORKERS = 3;
  const IDX_KEY = 'cl_gsc_idx', QUOTA_KEY = 'cl_gsc_quota';
  const INDEXNOW_KEY = CFG.indexNowKey || '';
  const readJson = (k) => { try { return JSON.parse(store.get(k) || '{}') || {}; } catch { return {}; } };
  const idx = readJson(IDX_KEY); // url -> trimmed inspection result + at (ms)
  function saveIdx() {
    try { localStorage.setItem(IDX_KEY, JSON.stringify(idx)); } catch {
      // storage full: forget the oldest half and try once more
      Object.entries(idx).sort((a, b) => a[1].at - b[1].at).slice(0, Math.ceil(Object.keys(idx).length / 2)).forEach(([u]) => delete idx[u]);
      store.set(IDX_KEY, JSON.stringify(idx));
    }
  }
  // Inspections used today per property (counted here; Google's own counter resets at midnight Pacific time).
  const quotaUsed = (prop) => { const q = readJson(QUOTA_KEY); return q.day === iso(istToday()) ? q[prop] || 0 : 0; };
  function useQuota(prop) {
    let q = readJson(QUOTA_KEY);
    if (q.day !== iso(istToday())) q = { day: iso(istToday()) };
    q[prop] = (q[prop] || 0) + 1;
    store.set(QUOTA_KEY, JSON.stringify(q));
  }
  async function inspect(prop, url) {
    const j = await api(INSPECT_API, { inspectionUrl: url, siteUrl: prop.url, languageCode: 'en-US' });
    useQuota(prop.url);
    const s = j.inspectionResult || {}, i = s.indexStatusResult || {}, m = s.mobileUsabilityResult;
    idx[url] = {
      at: Date.now(), v: i.verdict || '', cov: i.coverageState || '', state: i.indexingState || '', robots: i.robotsTxtState || '',
      fetch: i.pageFetchState || '', crawl: i.lastCrawlTime || '', gc: i.googleCanonical || '', uc: i.userCanonical || '',
      sm: (i.sitemap || []).length, refs: (i.referringUrls || []).length, as: i.crawledAs || '',
      mob: (m && m.verdict) || '', mobIssues: ((m && m.issues) || []).map((x) => x.message || x.issueType).slice(0, 5), link: s.inspectionResultLink || '',
    };
    saveIdx();
    return idx[url];
  }
  const normUrl = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return u; } };
  const hostOfUrl = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  // Sitemaps Search Console knows for this site (a domain property lists every subdomain's, so keep this host's).
  const listSitemaps = (s) => cached('sml|' + s.prop.url, () => api(`${API}/sites/${encodeURIComponent(s.prop.url)}/sitemaps`))
    .then((j) => (j.sitemap || []).filter((m) => hostOfUrl(m.path) === s.host));
  // URLs from the site's own sitemap.xml (+ sitemap indexes). Every CodeLove site serves it with CORS *.
  function sitemapUrls(host, extra) {
    return cached('smx|' + host + '|' + extra.join(','), async () => {
      const seen = new Set(), urls = new Set(), queue = [`https://${host}/sitemap.xml`, ...extra], errors = [];
      let files = 0;
      while (queue.length && files < 25 && urls.size < 50000) {
        const f = queue.shift();
        if (seen.has(f)) continue;
        seen.add(f); files++;
        try {
          const res = await fetch(f, { cache: 'no-cache' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
          const locs = [...doc.getElementsByTagName('loc')].map((x) => x.textContent.trim()).filter(Boolean);
          if (doc.getElementsByTagName('sitemapindex').length) queue.push(...locs); else locs.forEach((u) => urls.add(normUrl(u)));
        } catch (e) { errors.push(`${f}: ${e.message === 'Failed to fetch' ? 'blocked (CORS) or offline' : e.message}`); }
      }
      return { urls: [...urls], errors, files: files - errors.length };
    });
  }
  const resubmitSitemap = async (s, path) => {
    if (!gAuth.has(SCOPE_W)) await gAuth.connect([SCOPE_W]); // runs inside the Resubmit click
    await api(`${API}/sites/${encodeURIComponent(s.prop.url)}/sitemaps/${encodeURIComponent(path)}`, null, false, 'PUT');
  };
  const inspectLink = (prop, url) => `${GSC_URL}/inspect?resource_id=${encodeURIComponent(prop.url)}&id=${encodeURIComponent(url)}`;
  const fmtDay = (s) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
  const ago = (t) => { const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

  // Rule-based advice from the inspection + search data. k: fix (blocks indexing) | win (ranking quick win) | info
  const FETCH_ADVICE = {
    SOFT_404: ['Soft 404: add content or 404', 'Google treats it as a "soft 404" (looks empty or like an error page but returns 200). Add real content, or return a real 404 and remove it from the sitemap.'],
    NOT_FOUND: ['404: fix or remove', 'The page returns 404. Fix the page or link, or remove the URL from the sitemap and internal links.'],
    ACCESS_DENIED: ['401: make it public', 'Google got "401 unauthorized". Public pages must load without a login.'],
    ACCESS_FORBIDDEN: ['403: make it public', 'Google got "403 forbidden". Check hosting/firewall rules so Googlebot can load the page.'],
    SERVER_ERROR: ['Server error: fix hosting', 'Google got a 5xx server error. Make the page load reliably, then request indexing.'],
    REDIRECT_ERROR: ['Redirect error', 'Redirect loop or too long a chain. Point links and the sitemap straight at the final URL.'],
    BLOCKED_ROBOTS_TXT: ['Blocked by robots.txt', 'robots.txt blocks Googlebot from this URL. Allow it in robots.txt.'],
    INVALID_URL: ['Invalid URL', 'Google says the URL is invalid. Fix the URL in the sitemap and links.'],
  };
  function advise(r, sitemapOk) {
    const a = [], x = idx[r.url], add = (k, s, t) => a.push({ k, s, t });
    if (!x) {
      if (r.impr) add('info', 'Probably indexed: check', 'It already shows up in Google searches, so it is very likely indexed. Press Check to confirm.');
      else add('info', 'Not checked yet', 'Press Check to ask Google whether this page is indexed.');
    } else {
      const cov = x.cov.toLowerCase(), canonMismatch = x.gc && x.uc && x.gc !== x.uc;
      if (FETCH_ADVICE[x.fetch]) add('fix', ...FETCH_ADVICE[x.fetch]);
      if (x.robots === 'DISALLOWED' && x.fetch !== 'BLOCKED_ROBOTS_TXT') add('fix', ...FETCH_ADVICE.BLOCKED_ROBOTS_TXT);
      if (x.state === 'BLOCKED_BY_META_TAG' || x.state === 'BLOCKED_BY_HTTP_HEADER' || cov.includes('noindex')) add('fix', 'Remove noindex', `The page says "noindex" (${x.state === 'BLOCKED_BY_HTTP_HEADER' ? 'X-Robots-Tag header' : 'robots meta tag'}). Remove it if the page should be in Google.`);
      if (canonMismatch) add('fix', 'Fix the canonical', `Google chose ${x.gc} as the main URL, but the page's canonical says ${x.uc}. Make the canonical tag, internal links and sitemap all use one URL, and make this page clearly different from the one Google picked.`);
      if (cov.includes('discovered')) add('fix', 'Get it crawled: links + sitemap', 'Discovered – currently not indexed: Google knows the URL but has not crawled it yet. Link to it from pages that are already indexed (home, network footer, related pages), keep it in sitemap.xml and resubmit the sitemap, ping IndexNow, then press "Request indexing" in Search Console.');
      else if (cov.includes('crawled')) add('fix', 'Make the content unique', 'Crawled – currently not indexed: Google read the page and chose not to index it (thin or duplicate content). Add unique, useful text that answers the search, give it its own title and meta description, link to it from related indexed pages, then request indexing.');
      else if (cov.includes('unknown')) add('fix', 'Google has never seen it', 'URL is unknown to Google: add it to sitemap.xml, link to it from an indexed page, resubmit the sitemap, then request indexing.');
      else if (cov.includes('duplicate') && !canonMismatch) add('fix', 'Duplicate: make it distinct', `${x.cov}. Make the page clearly different, or point its canonical at the main version.`);
      else if (cov.includes('redirect')) add('info', 'Redirects', 'This URL redirects. Use the final URL in the sitemap and internal links.');
      else if (cov.includes('alternate page')) add('info', 'Fine: canonical is indexed', 'Alternate page with proper canonical tag: Google indexes the canonical version instead. Nothing to do.');
      if (x.mob === 'FAIL' || x.mob === 'PARTIAL') add('fix', 'Fix mobile issues', `Mobile usability: ${x.mobIssues.join(', ') || 'problems found'}.`);
      if (x.v === 'PASS') {
        const p2 = (r.kws || []).filter((k) => k.rank > 10 && k.rank <= 20 && k.impr).sort((p, q) => q.impr - p.impr);
        if (p2.length) add('win', `Page 2 → 1: "${p2[0].query}"`, `${p2.length} ${p2.length === 1 ? 'search is' : 'searches are'} on Google page 2 (biggest: "${p2[0].query}", #${p2[0].rank}). Quickest wins: put that phrase in the title and H1, add a section that answers it, and link to this page from related pages with that phrase as the link text.`);
        else if (r.best > 20) add('win', `Best spot is page ${Math.ceil(r.best / 10)}`, 'Put the main search phrase in the title and H1, add more helpful content than the pages above it, and add internal links to this page.');
        if (r.impr >= 100 && r.ctr < 0.02 && r.best && r.best <= 10) add('win', 'Rewrite title + description', `${num(r.impr)} impressions but only ${pct(r.ctr)} click. Rewrite the title and meta description around "${r.kws[0].query}" so people want to click.`);
        if (!r.impr && !a.length) add('info', 'Indexed, no searches yet', 'Indexed, but no impressions in this date range. Aim the title and H1 at one clear search phrase and link to the page from related pages.');
        if (!a.length) add('info', 'All good', r.best && r.best <= 10 ? 'Indexed and on Google page 1. Keep it fresh.' : 'Indexed. Keep it fresh.');
      } else if (!a.length) add('fix', x.cov || 'Not indexed', `${x.cov || 'Not indexed'}. Open the full report in Search Console, fix what it lists, then request indexing.`);
    }
    if (sitemapOk && !r.inSitemap) add('fix', 'Add to sitemap.xml', 'This page is not in sitemap.xml. Add it so Google finds it and comes back to re-crawl it.');
    return a;
  }
  const STATUS = { no: ['Not indexed', 'none', 0], unk: ['Not checked', 'deep', 1], yes: ['Indexed', 'p1', 2] };
  const statusOf = (url) => (!idx[url] ? 'unk' : idx[url].v === 'PASS' ? 'yes' : 'no');
  const statusPill = (st) => `<span class="gp ${STATUS[st][1]}">${STATUS[st][0]}</span>`;

  function indexDetail(r, prop) {
    const x = idx[r.url];
    const facts = x ? [
      ['Google says', x.cov || x.v], ['Verdict', x.v], ['Indexing allowed', x.state], ['robots.txt', x.robots], ['Page fetch', x.fetch],
      ['Last crawl', x.crawl ? `${fmtDay(x.crawl)}${x.as ? ` · ${x.as === 'MOBILE' ? 'smartphone' : x.as.toLowerCase()} crawler` : ''}` : 'never'],
      ['Google canonical', x.gc || '–'], ['Your canonical', x.uc || '–'], ['Sitemaps Google saw it in', num(x.sm)], ['Pages linking to it (Google knows)', num(x.refs)],
      ['Mobile usability', x.mob ? x.mob + (x.mobIssues.length ? ': ' + x.mobIssues.join(', ') : '') : 'not reported'], ['Checked', `${fmtDay(x.at)} (${ago(x.at)})`],
    ] : [];
    const kw = (r.kws || []).slice(0, 8);
    return `<div class="idx-detail">
      ${x ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v || '–')}</dd></div>`).join('')}</dl>` : '<p class="note" style="margin:0 0 10px">Not checked with Google yet.</p>'}
      <div class="sub-h">What to do</div>
      <ul class="advice">${r.adv.map((d) => `<li class="k-${d.k}"><b>${esc(d.s)}</b> ${esc(d.t)}</li>`).join('')}</ul>
      <div class="idx-links"><a class="btn sm" href="${inspectLink(prop, r.url)}" target="_blank" rel="noopener">${icon('ext')}Request indexing in Search Console</a>${x && x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">Full inspection report</a>` : ''}<a href="${esc(r.url)}" target="_blank" rel="noopener">Open the page</a></div>
      ${kw.length ? `<div class="sub-h">Searches it shows up for</div><table class="mini"><thead><tr><th>Keyword</th><th class="num">Impressions</th><th class="num">Clicks</th><th class="num">Google page</th></tr></thead><tbody>${kw.map((k) => `<tr><td class="kw">${kwCell(k.query)}</td><td class="num">${num(k.impr)}</td><td class="num">${num(k.clicks)}</td><td class="num">${gpage(k.rank)}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>`;
  }

  function indexOverview(R, sites, missing) {
    const rows = sites.map((s) => {
      const mine = Object.entries(idx).filter(([u]) => hostOfUrl(u) === s.host);
      return {
        host: s.host, prop: s.prop.url, checked: mine.length, yes: mine.filter(([, v]) => v.v === 'PASS').length, no: mine.filter(([, v]) => v.v !== 'PASS').length,
        last: mine.reduce((m, [, v]) => Math.max(m, v.at), 0), used: quotaUsed(s.prop.url),
      };
    });
    paint(pageHead(EYEBROW, 'Index status', `Is each page in Google, and what to do if not · ${sites.length} sites in Search Console`)
      + `<div class="banner">${icon('info')}<div>Pick a site. Pages are checked one by one with Google's <b>URL Inspection API</b> (about 2,000 checks a day per property), only when you press <b>Check</b>; results are saved in this browser.</div></div>` + missingBanner(missing));
    const card = el('section', 'card', '<div class="card-head"><h2>Sites</h2><span class="note">Counts are from checks saved in this browser</span></div><div class="tbl"></div>');
    app.append(card);
    table($('.tbl', card), [
      { key: 'host', label: 'Site', html: (r) => `<span class="site-cell">${favicon(r.host)}<span><a href="${CL.link({ src: 'gsc', tab: 'index', site: r.host })}">${esc(r.host)}</a><span class="note block">${esc(r.prop)}</span></span></span>` },
      { key: 'checked', label: 'Pages checked', num: true, fmt: num },
      { key: 'yes', label: 'Indexed', num: true, fmt: num, bar: true },
      { key: 'no', label: 'Not indexed', num: true, fmt: num },
      { key: 'last', label: 'Last check', num: true, html: (r) => (r.last ? esc(ago(r.last)) : '<span class="muted">never</span>') },
      { key: 'used', label: 'Checks used today', num: true, html: (r) => `${num(r.used)} <span class="muted">/ ${num(DAY_QUOTA)}</span>` },
    ], rows, { sort: 'checked' });
  }

  async function viewIndex(R, alive, host) {
    const { list, sites, missing } = await resolve(host);
    if (!alive()) return;
    if (!list.length) return noPropsView();
    if (!host) return indexOverview(R, sites, missing);
    if (!sites.length) { paint(crumb('index') + pageHead(EYEBROW, `Index status · ${esc(host)}`, '') + noPropCard(host)); return; }
    const s = sites[0];
    const [maps, pg] = await Promise.all([listSitemaps(s).catch((e) => ({ error: e.message })), pages(s, R)]);
    const sm = await sitemapUrls(host, Array.isArray(maps) ? maps.map((m) => m.path) : []);
    if (!alive()) return;
    const sitemapOk = sm.urls.length > 0;

    // every known page: sitemap.xml + pages Google showed in search + config.js indexPages (+ home)
    const byUrl = new Map();
    const add = (url) => { const u = normUrl(url); let r = byUrl.get(u); if (!r) byUrl.set(u, (r = { url: u, path: pathOf(u, host), inSitemap: false, inSearch: false, clicks: 0, impr: 0, ctr: 0, pos: 0, best: 0, kws: [] })); return r; };
    sm.urls.forEach((u) => (add(u).inSitemap = true));
    pg.forEach((p) => Object.assign(add(p.url), { inSearch: true, clicks: p.clicks, impr: p.impr, ctr: p.ctr, pos: p.pos, best: p.best, kws: p.kws }));
    ['/', ...((CFG.indexPages || {})[host] || [])].forEach((p) => add(new URL(p, `https://${host}/`).href));
    const rows = [...byUrl.values()];
    const refresh = () => rows.forEach((r) => {
      const x = idx[r.url];
      r.st = statusOf(r.url); r.stSort = STATUS[r.st][2]; r.cov = x ? x.cov || x.v : ''; r.at = x ? x.at : 0;
      r.adv = advise(r, sitemapOk); r.todo = r.adv[0].s; r.win = r.adv.some((d) => d.k === 'win');
    });
    refresh();

    paint(crumb('index') + pageHead(`${EYEBROW} · ${esc(s.prop.url)}`, `Index status · ${esc(host)}`, `${num(rows.length)} pages known · search data ${rangeText(R)}`)
      + `<div class="banner">${icon('info')}<div>Google's Indexing API only accepts job-posting and live-stream pages, so asking Google to index a normal page is done by hand: open a page below → <b>Request indexing in Search Console</b> (Google allows about 10 a day). Index checks use the URL Inspection API and are saved in this browser.</div></div>`);
    const tiles = el('section', 'card kc');
    const wins = el('section', 'card');
    const mapsCard = el('section', 'card');
    const card = el('section', 'card', `<div class="card-head"><h2>Pages</h2><div class="idx-tools">
        <button type="button" class="btn primary sm" id="idxRun"></button>
        <button type="button" class="dd" id="idxN" aria-haspopup="listbox" aria-expanded="false" aria-label="How many pages to check"></button>
        <button type="button" class="btn sm" id="idxPing" title="Tell Bing, Yandex and other IndexNow engines about the pages that aren't indexed"></button></div></div>
      <div class="idx-progress" hidden><span class="bar"><i></i></span><span class="idx-ptext"></span><button type="button" class="link-btn" id="idxStop">Stop</button></div>
      <div class="idx-ping" hidden></div>
      <div class="tbl"></div>
      <p class="note">Page list = the site's sitemap.xml${sm.errors.length ? ` (<b>could not read:</b> ${sm.errors.map(esc).join('; ')})` : ` (${num(sm.urls.length)} URLs)`} + pages Google showed in search + <code>indexPages</code> in config.js. <span id="idxQuota"></span></p>`);
    app.append(tiles, wins, mapsCard, card);

    // sitemaps (Sitemaps API)
    const drawMaps = (msg = '') => {
      mapsCard.innerHTML = `<div class="card-head"><h2>Sitemaps in Search Console</h2><span class="note">${msg ? esc(msg) : 'Resubmit after adding pages; it asks Google for one extra permission the first time'}</span></div><div class="tbl"></div>`;
      if (!Array.isArray(maps)) { $('.tbl', mapsCard).innerHTML = `<div class="error">${icon('alert')}<div>${esc(maps.error)}</div></div>`; return; }
      const sum = (m, k) => (m.contents || []).reduce((a, c) => a + Number(c[k] || 0), 0);
      table($('.tbl', mapsCard), [
        { key: 'path', label: 'Sitemap', cls: 'path', html: (m) => `<a href="${esc(m.path)}" target="_blank" rel="noopener">${esc(pathOf(m.path, host))}</a>` },
        { key: 'lastSubmitted', label: 'Submitted', html: (m) => esc(fmtDay(m.lastSubmitted)) },
        { key: 'lastDownloaded', label: 'Google read it', html: (m) => esc(fmtDay(m.lastDownloaded)) },
        { key: 'errors', label: 'Status', html: (m) => (m.isPending ? '<span class="status">Pending</span>' : Number(m.errors) ? `<span class="gp none">${num(m.errors)} errors</span>` : Number(m.warnings) ? `<span class="gp p23">${num(m.warnings)} warnings</span>` : '<span class="status on">OK</span>') },
        { key: 'sub', label: 'URLs submitted', num: true, fmt: num },
        { key: 'ind', label: 'Indexed', num: true, html: (m) => (m.ind ? num(m.ind) : '<span class="muted" title="Google no longer reports this number for most sitemaps">–</span>') },
        { key: 'act', label: '', html: (m) => `<button type="button" class="btn sm resub" data-path="${esc(m.path)}">Resubmit</button>` },
      ], maps.map((m) => ({ ...m, sub: sum(m, 'submitted'), ind: sum(m, 'indexed') })), { sort: 'sub' });
      if (!maps.length) $('.tbl', mapsCard).innerHTML = `<p class="empty">No sitemap submitted for ${esc(host)}. In <a href="${GSC_URL}/sitemaps?resource_id=${encodeURIComponent(s.prop.url)}" target="_blank" rel="noopener">Search Console → Sitemaps</a> add <code>https://${esc(host)}/sitemap.xml</code>.</p>`;
    };
    mapsCard.addEventListener('click', async (e) => {
      const b = e.target.closest('.resub');
      if (!b) return;
      b.disabled = true; b.textContent = 'Sending…';
      try { await resubmitSitemap(s, b.dataset.path); b.textContent = 'Resubmitted'; } catch (err) { b.disabled = false; b.textContent = 'Resubmit'; drawMaps(''); mapsCard.insertAdjacentHTML('beforeend', `<div class="error">${icon('alert')}<div><b>Resubmit failed.</b> ${esc(err.message)}</div></div>`); }
    });
    drawMaps();

    // tiles (filter) + quick wins
    const FILTERS = [['all', 'All pages', () => true], ['yes', 'Indexed', (r) => r.st === 'yes'], ['no', 'Not indexed', (r) => r.st === 'no'], ['unk', 'Not checked', (r) => r.st === 'unk'], ['win', 'Quick wins', (r) => r.win]];
    let f = 'all', tbl = null;
    const drawTiles = () => {
      tiles.innerHTML = `<div class="kc-tabs" role="tablist" aria-label="Filter pages">${FILTERS.map(([k, label, fn]) => { const n = rows.filter(fn).length; return `<button type="button" role="tab" class="kc-tab${k === f ? ' on' : ''}" aria-selected="${k === f}" data-f="${k}"><span class="kc-label">${esc(label)}</span><span class="kc-value">${num(n)}</span><span class="delta">${k === 'all' ? 'show all' : pct(div(n, rows.length))}</span></button>`; }).join('')}</div>`;
      const top = rows.filter((r) => r.win || (r.st === 'no' && r.adv[0].k === 'fix')).sort((a, b) => b.impr - a.impr || (b.st === 'no') - (a.st === 'no')).slice(0, 6);
      wins.innerHTML = `<div class="card-head"><h2>Top things to do</h2><span class="note">Biggest impact first (by impressions)</span></div>${top.length ? `<ul class="advice">${top.map((r) => { const d = r.adv.find((x) => x.k === 'win') || r.adv[0]; return `<li class="k-${d.k}"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.path)}</a> <b>${esc(d.s)}</b> ${esc(d.t)}</li>`; }).join('')}</ul>` : `<p class="empty">${rows.some((r) => r.st !== 'unk') ? 'Nothing urgent in the pages checked so far.' : 'Press "Check" below to find out which pages are indexed.'}</p>`}`;
    };
    const cols = [
      { key: 'path', label: 'Page', cls: 'path', html: (r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.url)}">${esc(r.path)}</a><span class="title">${[r.inSitemap ? 'in sitemap' : 'not in sitemap', r.inSearch ? 'shows in search' : ''].filter(Boolean).join(' · ')}</span>` },
      { key: 'stSort', label: 'Index', num: true, lowFirst: true, html: (r) => statusPill(r.st) },
      { key: 'cov', label: 'Google says', cls: 'wrap', html: (r) => (r.cov ? `${esc(r.cov)}${idx[r.url].crawl ? `<span class="title">crawled ${esc(fmtDay(idx[r.url].crawl))}</span>` : ''}` : '<span class="muted">–</span>') },
      { key: 'impr', label: 'Impressions', num: true, fmt: num, bar: true },
      { key: 'best', label: 'Best spot', num: true, lowFirst: true, html: (r) => (r.best ? gpage(r.best) : '<span class="muted">–</span>') },
      { key: 'todo', label: 'What to do', cls: 'wrap', html: (r) => `<span class="todo-txt k-${r.adv[0].k}" title="${esc(r.adv[0].t)}">${esc(r.todo)}</span>` },
      { key: 'at', label: 'Checked', num: true, html: (r) => `<button type="button" class="btn sm chk" data-u="${esc(r.url)}"${running ? ' disabled' : ''}>${r.at ? 'Re-check' : 'Check'}</button>${r.at ? `<span class="note block">${esc(ago(r.at))}</span>` : ''}` },
    ];
    const visible = () => rows.filter(FILTERS.find((x) => x[0] === f)[2]);
    const drawTable = () => { tbl = table($('.tbl', card), cols, visible(), { sort: 'stSort', asc: true, search: 'Search pages', expand: (r) => indexDetail(r, s.prop), rowKey: (r) => r.url }); };
    tiles.addEventListener('click', (e) => { const b = e.target.closest('.kc-tab'); if (b) { f = b.dataset.f; drawTiles(); drawTable(); drawTools(); } });

    // check runner: N unchecked pages from the current filter (pages with impressions first), 3 at a time
    let running = null, nPick = Number(store.get('cl_gsc_idx_n')) || 50;
    if (!BATCH_SIZES.includes(nPick)) nPick = 50;
    const queue = () => visible().filter((r) => r.st === 'unk').sort((a, b) => b.impr - a.impr);
    const notIndexed = () => rows.filter((r) => r.st === 'no');
    function drawTools() {
      const left = Math.max(0, DAY_QUOTA - quotaUsed(s.prop.url)), q = queue().length;
      const run = $('#idxRun', card);
      run.innerHTML = running ? 'Checking…' : q ? `${icon('search')}Check next ${num(Math.min(nPick, q))} unchecked` : 'All pages here checked';
      run.disabled = !!running || !q || !left;
      $('#idxN', card).innerHTML = `<span class="dd-text"><b>${nPick} pages</b></span>${icon('chev')}`;
      $('#idxN', card).disabled = !!running;
      const ni = notIndexed().length, ping = $('#idxPing', card);
      ping.textContent = `Ping IndexNow (${num(Math.min(ni, 100))} not indexed)`;
      ping.disabled = !ni || !INDEXNOW_KEY;
      $('#idxQuota', card).textContent = `Index checks used today for this property: ${num(quotaUsed(s.prop.url))} of ${num(DAY_QUOTA)}.`;
    }
    let redrawT = 0;
    const redrawSoon = () => { if (redrawT) return; redrawT = setTimeout(() => { redrawT = 0; if (!alive()) return; refresh(); drawTiles(); tbl.redraw(); drawTools(); }, 400); };
    const prog = $('.idx-progress', card);
    function showProgress(job) {
      prog.hidden = false;
      $('.bar i', prog).style.width = `${Math.round(div(job.done, job.total) * 100)}%`;
      $('.idx-ptext', prog).innerHTML = `${num(job.done)} of ${num(job.total)} checked${job.fail ? ` · <span class="delta down">${num(job.fail)} failed: ${esc(job.err)}</span>` : ''}${job.msg ? ` · ${esc(job.msg)}` : ''}`;
      $('#idxStop', prog).hidden = !!job.end;
    }
    async function runChecks(list) {
      const job = (running = { done: 0, total: list.length, fail: 0, err: '', stop: false });
      drawTools(); tbl.redraw(); showProgress(job);
      let i = 0;
      const worker = async () => {
        while (!job.stop && i < list.length && alive()) {
          if (quotaUsed(s.prop.url) >= DAY_QUOTA) { job.stop = true; job.msg = 'daily limit reached, try again tomorrow'; break; }
          const r = list[i++];
          try { await inspect(s.prop, r.url); } catch (e) {
            job.fail++; job.err = e.message;
            if (/quota|rate limit|has not been used|disabled|permission/i.test(e.message)) { job.stop = true; job.msg = 'stopped'; }
          }
          job.done++; showProgress(job); redrawSoon();
        }
      };
      await Promise.all(Array.from({ length: WORKERS }, worker));
      job.end = true; running = null;
      if (!alive()) return;
      showProgress(job); refresh(); drawTiles(); tbl.redraw(); drawTools();
    }
    $('#idxRun', card).addEventListener('click', () => runChecks(queue().slice(0, nPick)));
    $('#idxStop', card).addEventListener('click', () => { if (running) { running.stop = true; running.msg = 'stopped'; } });
    $('#idxN', card).addEventListener('click', (e) => selectMenu(e.currentTarget, {
      title: 'Pages per check', value: nPick, items: BATCH_SIZES.map((n) => ({ value: n, label: `${n} pages`, hint: `${Math.ceil(n / 60)} min or less` })),
      onSelect: (v) => { nPick = v; store.set('cl_gsc_idx_n', String(v)); drawTools(); },
    }));
    card.addEventListener('click', (e) => {
      const b = e.target.closest('.chk');
      if (!b || running) return;
      const r = rows.find((x) => x.url === b.dataset.u);
      if (r) runChecks([r]);
    });

    // IndexNow: Bing, Yandex, Seznam, Naver… (Google does not use it). The API has no CORS, so each URL is
    // sent as a fire-and-forget GET; the reply can't be read. The curl command does the same in one POST.
    $('#idxPing', card).addEventListener('click', async () => {
      const urls = notIndexed().slice(0, 100).map((r) => r.url), box = $('.idx-ping', card), b = $('#idxPing', card);
      b.disabled = true;
      let sent = 0;
      for (let i = 0; i < urls.length; i += 5) {
        await Promise.all(urls.slice(i, i + 5).map((u) => fetch(`https://api.indexnow.org/indexnow?url=${encodeURIComponent(u)}&key=${encodeURIComponent(INDEXNOW_KEY)}`, { mode: 'no-cors' }).then(() => sent++, () => {})));
      }
      const body = JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `https://${host}/${INDEXNOW_KEY}.txt`, urlList: urls });
      const cmd = `curl -X POST "https://api.indexnow.org/indexnow" -H "Content-Type: application/json; charset=utf-8" -d '${body.replace(/'/g, "'\\''")}'`;
      box.hidden = false;
      box.innerHTML = `<div class="banner">${icon('info')}<div><b>Sent ${num(sent)} of ${num(urls.length)} URLs to IndexNow.</b> IndexNow tells Bing, Yandex and other engines; <b>Google does not use it</b>. The browser can't read IndexNow's reply, so to see the result run this (Git Bash / macOS / Linux; 200 or 202 = accepted):
        <div class="code-row" style="margin-top:8px"><pre class="code">${esc(cmd)}</pre><button type="button" class="btn" id="copyPing">${icon('copy')}Copy</button></div></div></div>`;
      const cp = $('#copyPing', box);
      cp.onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(cmd).then(() => { cp.lastChild.textContent = 'Copied'; }, () => {}); };
      drawTools();
    });

    drawTiles(); drawTable(); drawTools();
  }

  function viewSignIn(msg) {
    const more = !!gAuth.token();
    gSignIn({
      id: 'gscSignin', need: SCOPE, msg, eyebrow: 'Google Search', title: 'Connect Search Console',
      text: `See which Google searches your sites show up for, and on which results page. Sign in with the Google account that has the Search Console properties${CFG.ownerEmail ? ` (<b>${esc(CFG.ownerEmail)}</b>)` : ''}. Read-only access.`,
      button: more ? 'Allow Search Console access' : 'Sign in with Google',
      help: `<div class="help-p"><b>"Google Search Console API has not been used … or it is disabled"?</b> <a href="${ENABLE_URL}" target="_blank" rel="noopener">Enable Google Search Console API</a> in the same Google Cloud project.</div>
        <div class="help-p"><b>Google warns about the <code>webmasters.readonly</code> permission?</b> Google Auth Platform → Data access → <b>Add or remove scopes</b> → tick <code>…/auth/webmasters.readonly</code> → Save.</div>`,
    });
  }

  async function route({ R, alive, site, tab }) {
    if (!CFG.clientId) { paint(`<div class="error">${icon('alert')}<div>Set <code>clientId</code> in config.js to use Google Search.</div></div>`, false); return; }
    if (!(await gGate(SCOPE, viewSignIn, alive))) return;
    loading('Loading Search Console…');
    try {
      if (tab === 'pages') await viewPages(R, alive, site);
      else if (tab === 'missing') await viewMissing(R, alive, site);
      else if (tab === 'index') await viewIndex(R, alive, site);
      else await viewKeywords(R, alive, site);
    } catch (e) {
      if (!alive()) return;
      if (e.reconnect) { gReconnect(); return; }
      if (/insufficient authentication scopes/i.test(e.message)) { viewSignIn('Google did not give Search Console access to this sign-in. Press the button and allow it.'); return; }
      const disabled = /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(e.message);
      const denied = /permission|forbidden|not.*access/i.test(e.message);
      const hint = disabled
        ? `Turn on <a href="${ENABLE_URL}" target="_blank" rel="noopener">Google Search Console API</a> in the Google Cloud project of the OAuth client, wait a minute, then try again.`
        : denied
          ? 'This Google account has no access to that Search Console property. Add it in Search Console → Settings → Users and permissions, or sign out (top right) and sign in with the owner account.'
          : 'If the API is disabled, enable "Google Search Console API" in Google Cloud. If permission is denied, sign in with the account that has access to the Search Console properties.';
      paint(`<div class="error">${icon('alert')}<div><b>Couldn't load Search Console.</b><br>${esc(e.message)}<div class="note">${hint}</div></div></div><button class="btn" id="retry">Try again</button>`, false);
      $('#retry').onclick = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  window.GSC = { route, clear: () => cache.clear(), stop: () => {}, signedIn: () => gAuth.has(SCOPE) };
})();
