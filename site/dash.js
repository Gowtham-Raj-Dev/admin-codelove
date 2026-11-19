/* Dashboard (#/reports): every site at a glance.
 *   - Totals: visitors, page views (CodeLove Analytics) + Google clicks, impressions, position (Search Console)
 *   - "What to do": suggestions for every site, most important first (live rules + the last Daily report's
 *     indexing problems)
 *   - Sites table: one row per site
 *   - Target keywords: the keywords set for each site (config.js → searchKeywords), where each one is in Google,
 *     which ones to change (a similar search people already use) and searches to add as new targets
 * Google data is read only when the Google token is valid; the page never opens Google's window by itself. */
(() => {
  'use strict';
  const { $, $$, num, pct, dur, esc, div, fmtDate, rangeLabel, deltaHtml, favicon, icon, pageHead, loading, paint, gAuth, G_LOGO } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const TARGETS = CFG.searchKeywords || {};
  const NAMES = CFG.siteNames || {};
  const nameOf = (h) => NAMES[h] || h.split('.')[0];
  const EYEBROW = 'Dashboard';
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  // words that don't tell two searches apart
  const STOP = new Set(['free', 'online', 'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'and', 'or', 'with', 'no', 'best', 'top', 'app', 'apps', 'tool', 'tools', 'how', 'what', 'is', 'my', 'your', 'site', 'website', 'codelove', 'com', 'in', 'by', 'without', 'download']);
  const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));

  // ---------- data ----------
  async function loadGsc(R, site) {
    const G = GSC.lib;
    if (!gAuth.has(G.SCOPE)) return { state: gAuth.known(G.SCOPE) ? 'expired' : 'none', per: {}, missing: [] };
    try {
      const { sites, missing } = await G.resolve(site || undefined);
      const per = {};
      await Promise.all(sites.map(async (s) => {
        try {
          const [d, k] = await Promise.all([G.daily(s, R), G.keywords(s, R)]);
          per[s.host] = { S: G.series(R, [d]), k, tr: G.targetRows({ host: s.host, k }) };
        } catch (e) { per[s.host] = { error: e.message }; }
      }));
      return { state: 'ok', per, missing };
    } catch (e) {
      return { state: /expired|reconnect|401/i.test(e.message) ? 'expired' : 'error', error: e.message, per: {}, missing: [] };
    }
  }
  async function lastReport(site) {
    try {
      const list = await REP.lib.listMetas(); // newest first
      const m = list.find((x) => !x.site || x.site === site);
      if (!m) return null;
      const got = await REP.lib.loadReport(m.id);
      return got && got.rep ? { meta: m, rep: got.rep } : null;
    } catch { return null; }
  }

  // ---------- per-site model + suggestions ----------
  function keywordIdeas(host, k, tr) {
    const tl = (TARGETS[host] || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
    const untargeted = (k || []).filter((q) => !tl.some((t) => q.query.toLowerCase().includes(t)))
      .sort((a, b) => b.impr - a.impr || a.pos - b.pos);
    // missing target → the real search that shares the most words with it (ties: more impressions)
    const swaps = [];
    for (const t of tr.filter((x) => !x.rank)) {
      const tw = words(t.target);
      if (!tw.length) continue;
      let best = null, bestScore = 0;
      for (const q of untargeted) {
        const qw = new Set(words(q.query));
        const score = tw.filter((w) => qw.has(w)).length;
        // close enough only when half of both phrases' meaningful words are shared
        if (!score || score < Math.ceil(tw.length / 2) || score < Math.ceil(qw.size / 2)) continue;
        if (score > bestScore || (score === bestScore && q.impr > best.impr)) { best = q; bestScore = score; }
      }
      if (best && bestScore) swaps.push({ target: t.target, to: best.query, impr: best.impr, rank: best.rank });
    }
    return { untargeted, swaps };
  }

  function buildSite(host, ctx) {
    const { R, ownBy, gsc, repBy, noPrev, reportDate } = ctx;
    const o = ownBy[host] || null, g = gsc.per[host] || null, r = repBy[host] || null;
    const targets = TARGETS[host] || [];
    const gOk = !!(g && !g.error);
    const tr = gOk ? g.tr : targets.map((t) => ({ target: t, rank: 0, impr: 0, clicks: 0, match: '', unknown: true }));
    const ideas = gOk ? keywordIdeas(host, g.k, tr) : { untargeted: [], swaps: [] };
    const out = [];
    const add = (sev, kind, impact, title, detail, url = '') => out.push({ host, sev, kind, impact, title, detail, url });

    // Google
    if (gsc.state === 'ok') {
      if (gsc.missing.includes(host)) add('fix', 'search', 9e9, 'Not in Search Console', 'There is no Search Console property for this site, so Google data and index checks are missing. Add the Domain property codelove.in in Search Console; it covers every subdomain.');
      else if (g && g.error) add('fix', 'search', 9e9, 'Search Console data could not be read', g.error);
    }
    if (gOk) {
      const c = g.S.cur, p = g.S.prev;
      if (!c.i) add('fix', 'search', 8e9, 'Not showing in Google at all', `No Google impressions in ${rangeLabel().toLowerCase()}. Check Index status for this site, make sure sitemap.xml is submitted, use "Request indexing" on the home page, and link to it from codelove.in and the other sites.`, `https://${host}/`);
      const missing = tr.filter((t) => !t.rank);
      if (targets.length && missing.length) {
        add('win', 'keywords', 5e6 + missing.length, `${missing.length} of ${targets.length} target keywords not in Google`,
          `Not found yet: ${missing.map((t) => `"${t.target}"`).join(', ')}. Use these exact phrases in the page title, H1, headings and body text of the best page (or make one page per phrase), and link to that page from the home page.`);
      }
      ideas.swaps.slice(0, 3).forEach((s) => add('win', 'keywords', 4e6 + s.impr, `Change target "${s.target}" → "${s.to}"`,
        `People already find this site with "${s.to}" (${num(s.impr)} impressions, position #${s.rank}), but "${s.target}" gets nothing. Replace it in config.js → searchKeywords and use "${s.to}" in the title and H1.`));
      const newOnes = ideas.untargeted.filter((q) => q.impr >= 3 && !ideas.swaps.some((s) => s.to === q.query)).slice(0, 5);
      if (newOnes.length) add('win', 'keywords', 3e6 + newOnes[0].impr, `Add ${newOnes.length} new target keyword${newOnes.length > 1 ? 's' : ''}`,
        `Google already shows this site for searches that are not in your targets: ${newOnes.map((q) => `"${q.query}" (${num(q.impr)} impr., #${q.rank})`).join(', ')}. Add them to config.js → searchKeywords and give each a heading or section on the page.`);
      const quick = g.k.filter((q) => q.rank > 10 && q.rank <= 20 && q.impr >= 3).sort((a, b) => b.impr - a.impr).slice(0, 4);
      if (quick.length) add('win', 'keywords', 2e6 + quick[0].impr, 'Push these from page 2 to page 1',
        `${quick.map((q) => `"${q.query}" #${q.rank} (${num(q.impr)} impr.)`).join(', ')}. Put the phrase in the title tag and H1 of the page that ranks, add a short paragraph that answers it, and link to that page from other pages.`);
      const lowCtr = g.k.filter((q) => q.rank && q.rank <= 10 && q.impr >= 40 && q.ctr < 0.02).sort((a, b) => b.impr - a.impr).slice(0, 3);
      if (lowCtr.length) add('win', 'search', 1.5e6 + lowCtr[0].impr, 'On page 1 but few people click',
        `${lowCtr.map((q) => `"${q.query}" (#${q.rank}, ${num(q.impr)} impr., ${pct(q.ctr)} CTR)`).join(', ')}. Rewrite the title and meta description so they match the search and promise what the page gives.`);
      if (p.pos && c.pos && c.i >= 20 && c.pos - p.pos >= 3) add('info', 'search', 1e6, `Average Google position dropped ${p.pos.toFixed(1)} → ${c.pos.toFixed(1)}`, 'Compare the keywords in Google Search → Keywords; check that recent changes did not remove titles, headings or text from the pages.');
      if (p.i >= 50 && c.i < p.i * 0.6) add('info', 'search', 9e5, `Google impressions down ${Math.round((1 - c.i / p.i) * 100)}%`, `${num(c.i)} impressions now vs ${num(p.i)} before. Check Index status for pages that dropped out of Google.`);
    }
    if (!targets.length) add('info', 'keywords', 8e5, 'No target keywords set', `Add the searches this site should show up for to config.js → searchKeywords['${host}'].`);

    // Traffic
    if (o) {
      if (!o.cur.v && !o.cur.sec) add('info', 'traffic', 7e5, 'No visits recorded', 'CodeLove Analytics saw no visits in this range. If the site is live, check that https://admin.codelove.in/t.js is in its <head>, then share it and link it from the other sites.');
      else if (!noPrev && o.prev.u >= 10 && o.cur.u < o.prev.u * 0.6) add('win', 'traffic', 6e5, `Visitors down ${Math.round((1 - o.cur.u / o.prev.u) * 100)}%`, `${num(o.cur.u)} visitors now vs ${num(o.prev.u)} before. Look at Analytics → Pages for the pages that lost visits.`);
    }

    // Indexing (last Daily report)
    if (r) {
      const fixes = r.problems.filter((x) => x.sev === 'fix');
      if (fixes.length) add('fix', 'index', 7e9 + fixes.length, `${fixes.length} indexing problem${fixes.length > 1 ? 's' : ''} to fix`,
        `From the Daily report of ${fmtDate(reportDate)}: ${fixes.slice(0, 3).map((x) => x.title + (x.url ? ` (${x.url.replace(/^https?:\/\//, '')})` : '')).join('; ')}${fixes.length > 3 ? `; +${fixes.length - 3} more` : ''}. Open the Daily report for each fix.`);
    }
    out.sort((a, b) => SEV[a.sev] - SEV[b.sev] || b.impact - a.impact);

    const c = gOk ? g.S.cur : null, p = gOk ? g.S.prev : null;
    return {
      host, name: nameOf(host), o, gOk, gErr: g && g.error, c, p, tr, ideas, sugg: out,
      ix: r && r.gsc ? r.gsc.index : null,
      visitors: o ? o.cur.u : 0, views: o ? o.cur.v : 0, time: o ? o.cur.sec : 0,
      clicks: c ? c.c : 0, impr: c ? c.i : 0, pos: c && c.pos ? c.pos : 0,
      tShow: tr.filter((t) => t.rank).length, tTotal: targets.length,
      fix: out.filter((x) => x.sev === 'fix').length, win: out.filter((x) => x.sev === 'win').length,
    };
  }
  const SEV = { fix: 0, win: 1, info: 2 };

  // ---------- view ----------
  const tile = (label, value, sub = '', cls = '') => `<div class="stat${cls ? ' ' + cls : ''}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-sub">${sub}</span></div>`;
  const SEV_PILL = { fix: ['Fix', 'none'], win: ['Improve', 'p23'], info: ['Check', 'deep'] };
  const sevPill = (k) => `<span class="gp ${SEV_PILL[k][1]}">${SEV_PILL[k][0]}</span>`;
  const gp = (rank, unknown) => (unknown ? '<span class="gp deep">–</span>'
    : rank ? `<span class="gp ${rank <= 10 ? 'p1' : rank <= 30 ? 'p23' : 'deep'}" title="Average position ${rank} → Google page ${Math.ceil(rank / 10)}">Page ${Math.ceil(rank / 10)} <span class="gp-rank">#${rank}</span></span>`
      : '<span class="gp none">Not in Google</span>');
  const siteLink = (h) => CL.link({ src: 'rep', tab: 'overview', site: h });

  function googleBanner(gsc) {
    if (gsc.state === 'ok') return '';
    if (gsc.state === 'none') return `<div class="banner">${icon('info')}<div><b>Connect Google to see search data.</b> Keywords, Google positions and keyword suggestions need Search Console (read-only). You do this once.<div class="banner-actions"><button type="button" class="btn primary sm" id="dGConnect">${G_LOGO}Connect Google</button></div></div></div>`;
    if (gsc.state === 'expired') return `<div class="banner warn">${icon('refresh')}<div><b>Google access needs a quick renew.</b> Click anywhere on the page (or the button) — no permission screen.<div class="banner-actions"><button type="button" class="btn primary sm" id="dGRenew">${G_LOGO}Renew Google</button></div></div></div>`;
    return `<div class="banner warn">${icon('alert')}<div><b>Search Console couldn't be read.</b> ${esc(gsc.error || '')}</div></div>`;
  }

  function todoCard(all) {
    const kinds = [['all', 'All'], ['fix', 'To fix'], ['keywords', 'Keywords'], ['search', 'Google'], ['index', 'Indexing'], ['traffic', 'Traffic']];
    const count = (k) => (k === 'all' ? all.length : k === 'fix' ? all.filter((x) => x.sev === 'fix').length : all.filter((x) => x.kind === k).length);
    return `<section class="card dash-todo"><div class="card-head"><h2>What to do</h2><span class="note">Most important first · every site</span></div>
      <div class="chips" role="group" aria-label="Filter suggestions">${kinds.filter(([k]) => k === 'all' || count(k)).map(([k, l], i) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${i === 0}">${l}<span class="chip-n">${count(k)}</span></button>`).join('')}</div>
      ${all.length ? `<ol class="probs todo-list">${all.map((x, i) => `<li class="prob k-${x.sev}" data-sev="${x.sev}" data-kind="${x.kind}"${i >= 10 ? ' data-more hidden' : ''}><div class="prob-top">${sevPill(x.sev)}<a class="todo-site" href="${siteLink(x.host)}">${favicon(x.host)}${esc(nameOf(x.host))}</a><b>${esc(x.title)}</b></div><div class="prob-fix">${esc(x.detail)}</div></li>`).join('')}</ol>
        ${all.length > 10 ? `<button type="button" class="btn todo-more" id="todoMore">Show all ${all.length}</button>` : ''}`
        : '<p class="empty">Nothing to do right now. Everything looks fine.</p>'}</section>`;
  }

  function targetCard(s, gscState) {
    const unknown = gscState !== 'ok' || !s.gOk;
    const swapOf = new Map(s.ideas.swaps.map((x) => [x.target, x]));
    const extra = s.ideas.untargeted.filter((q) => q.impr >= 2).slice(0, 5);
    const share = s.tTotal ? Math.round((s.tShow / s.tTotal) * 100) : 0;
    return `<section class="card tk-card"><div class="tk-head"><a class="tk-title" href="${siteLink(s.host)}">${favicon(s.host)}<span><b>${esc(s.name)}</b><span class="note">${esc(s.host)}</span></span></a>
        ${s.tTotal ? (unknown ? `<span class="gp deep">${s.tTotal} targets</span>` : `<span class="gp ${share >= 60 ? 'p1' : share >= 25 ? 'p23' : 'none'}">${s.tShow} of ${s.tTotal} in Google</span>`) : '<span class="gp deep">No targets</span>'}</div>
      ${s.tTotal && !unknown ? `<div class="tk-bar" aria-hidden="true"><i style="width:${share}%"></i></div>` : ''}
      ${s.tr.length ? `<ul class="tk-list">${s.tr.slice().sort((a, b) => (a.rank || 1e3) - (b.rank || 1e3)).map((t) => {
        const sw = swapOf.get(t.target);
        return `<li><span class="tk-kw">${esc(t.target)}${t.rank && t.match && t.match.toLowerCase() !== String(t.target).toLowerCase() ? `<span class="tk-hint">as "${esc(t.match)}"</span>` : ''}${sw ? `<span class="tk-hint swap">${icon('refresh')}change to "${esc(sw.to)}" · ${num(sw.impr)} impr.</span>` : ''}</span>
          <span class="tk-num">${t.impr ? num(t.impr) : ''}</span>${gp(t.rank, unknown)}</li>`;
      }).join('')}</ul>` : '<p class="empty">No target keywords set. Add them in config.js → searchKeywords.</p>'}
      ${extra.length ? `<div class="tk-sub">People also find it with · add as targets</div><ul class="tk-list tk-extra">${extra.map((q) => `<li><span class="tk-kw">${icon('search')}${esc(q.query)}</span><span class="tk-num">${num(q.impr)}</span>${gp(q.rank)}</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  // ---------- live now ----------
  const pulse = (n) => `<span class="pulse${n ? '' : ' idle'}"></span>`;
  const liveBy = () => {
    const by = {};
    for (const x of OWN.lib.liveNow()) by[x.host] = (by[x.host] || 0) + 1;
    return by;
  };
  function liveCard(hosts, today) {
    const only = new Set(hosts);
    const live = OWN.lib.liveNow().filter((x) => only.has(x.host));
    const bySite = {}, byPage = {};
    live.forEach((x) => {
      bySite[x.host] = (bySite[x.host] || 0) + 1;
      const k = x.host + x.path;
      (byPage[k] ||= { host: x.host, site: x.site, path: x.path, n: 0 }).n++;
    });
    const sites = Object.entries(bySite).sort((a, b) => b[1] - a[1]);
    const pages = Object.values(byPage).sort((a, b) => b.n - a.n).slice(0, 12);
    const max = Math.max(1, ...sites.map((s) => s[1]), ...pages.map((p) => p.n));
    const bar = (n) => `<span class="lv-bar"><i style="width:${Math.max(6, Math.round((n / max) * 100))}%"></i></span>`;
    const win = Math.round((OWN.lib.LIVE_WINDOW || 90e3) / 1000);
    return `<div class="lv-head">
        <div class="lv-count">${pulse(live.length)}<b>${num(live.length)}</b><span>${live.length === 1 ? 'person' : 'people'} on the sites right now</span></div>
        <div class="lv-today">${today ? `<span><b>${num(today.u)}</b> visitors today</span><span><b>${num(today.v)}</b> page views today</span>` : ''}<a href="${CL.link({ src: 'own', tab: 'live' })}">Open Live →</a></div>
      </div>
      ${live.length ? `<div class="lv-grid">
        <div><div class="tk-sub">By site</div><ul class="lv-list">${sites.map(([h, n]) => `<li><a class="lv-name" href="${siteLink(h)}">${favicon(h)}<span>${esc(nameOf(h))}</span></a>${bar(n)}<b class="lv-n">${num(n)}</b></li>`).join('')}</ul></div>
        <div><div class="tk-sub">Pages being viewed</div><ul class="lv-list">${pages.map((p) => { const t = OWN.lib.liveTitle(p.site, p.path); return `<li><a class="lv-name lv-page" href="https://${esc(p.host)}${esc(p.path)}" target="_blank" rel="noopener">${favicon(p.host)}<span><span class="lv-t">${esc(t || p.path)}</span><span class="note">${esc(p.host)}${esc(p.path)}</span></span></a>${bar(p.n)}<b class="lv-n">${num(p.n)}</b></li>`; }).join('')}</ul></div>
      </div>` : `<p class="empty">Nobody has a page open right now. This updates by itself every few seconds (page open in the last ${win} s).</p>`}`;
  }

  function sitesTable(box, rows, noPrev) {
    const hasIx = rows.some((s) => s.ix), live = liveBy();
    CL.table(box, [
      { key: 'name', label: 'Site', html: (s) => `<a class="site-cell" href="${siteLink(s.host)}">${favicon(s.host)}<span><b>${esc(s.name)}</b><span class="note block">${esc(s.host)}</span></span></a>` },
      { key: 'live', label: 'Live', num: true, html: (s) => `<span class="live-cell" data-live="${esc(s.host)}">${liveCell(live[s.host] || 0)}</span>` },
      { key: 'visitors', label: 'Visitors', num: true, html: (s) => `${num(s.visitors)}${s.o && !noPrev && s.o.prev.u ? `<span class="block">${deltaHtml(s.o.cur.u, s.o.prev.u)}</span>` : ''}` },
      { key: 'views', label: 'Views', num: true, fmt: num },
      { key: 'clicks', label: 'Clicks', num: true, html: (s) => (s.gOk ? num(s.clicks) : '<span class="muted">–</span>') },
      { key: 'impr', label: 'Impr.', num: true, html: (s) => (s.gOk ? num(s.impr) : '<span class="muted">–</span>') },
      { key: 'pos', label: 'Position', num: true, lowFirst: true, html: (s) => (s.pos ? s.pos.toFixed(1) : '<span class="muted">–</span>') },
      { key: 'tShow', label: 'Targets', num: true, html: (s) => (s.tTotal ? (s.gOk ? `${s.tShow} <span class="muted">/ ${s.tTotal}</span>` : `<span class="muted">${s.tTotal} set</span>`) : '<span class="muted">none</span>') },
      ...(hasIx ? [{ key: 'idx', label: 'Indexed', num: true, html: (s) => (s.ix ? `${num(s.ix.indexed)} <span class="muted">/</span> ${s.ix.notIndexed ? `<span class="delta down">${num(s.ix.notIndexed)}</span>` : '0'}` : '<span class="muted">–</span>') }] : []),
      { key: 'todo', label: 'To do', num: true, html: (s) => `<span class="rs-counts">${s.fix ? `<span class="gp none">${s.fix} fix</span>` : ''}${s.win ? `<span class="gp p23">${s.win} improve</span>` : ''}${!s.fix && !s.win ? '<span class="gp p1">OK</span>' : ''}</span>` },
    ], rows.map((s) => ({ ...s, live: live[s.host] || 0, idx: s.ix ? s.ix.indexed : -1, todo: s.fix * 100 + s.win })), { sort: 'visitors', pageSize: 100 });
  }
  const liveCell = (n) => (n ? `<span class="live-n">${pulse(n)}${num(n)}</span>` : '<span class="muted">0</span>');

  // ---------- Markdown for an AI chat ----------
  function toMarkdown(rows, R, gsc) {
    const L = [`# CodeLove sites · dashboard suggestions · ${fmtDate(R.end)}`, ''];
    L.push(`> **Task:** Improve these sites' Google search results. For each site, go through "To do" in order: edit the page source in the repo folder given (titles, H1, headings, body text, meta description, internal links, sitemap.xml). When a target keyword should change, also update \`searchKeywords\` in \`${CFG.repoRoot || ''}\\admin-codelove\\site\\config.js\`. List anything that can only be done in Google Search Console at the end, then summarise what you changed per repo.`, '');
    L.push(`- Range: ${rangeLabel()} (${fmtDate(R.start)} – ${fmtDate(R.end)}). Google page = position ÷ 10 rounded up (#1–10 = page 1).`);
    if (gsc.state !== 'ok') L.push('- Note: Google Search Console data was not loaded, so keyword positions are missing.');
    for (const s of rows) {
      L.push('', `## ${s.name} — ${s.host}`, '');
      const repo = REP.lib.repoPath(s.host);
      if (repo) L.push(`- Repo: \`${repo}\``);
      if (s.o) L.push(`- Traffic: ${num(s.o.cur.u)} visitors, ${num(s.o.cur.v)} page views, ${dur(s.o.cur.sec)} total time`);
      if (s.gOk) L.push(`- Google: ${num(s.clicks)} clicks, ${num(s.impr)} impressions, avg position ${s.pos ? s.pos.toFixed(1) : '–'}`);
      if (s.ix) L.push(`- Index: ${s.ix.indexed} indexed, ${s.ix.notIndexed} not indexed, ${s.ix.unchecked} not checked`);
      if (s.tr.length) {
        L.push('', '**Target keywords:**');
        const sw = new Map(s.ideas.swaps.map((x) => [x.target, x]));
        s.tr.forEach((t) => L.push(`- "${t.target}": ${t.unknown ? 'unknown' : t.rank ? `Google page ${Math.ceil(t.rank / 10)} (#${t.rank}), ${num(t.impr)} impressions` : 'NOT IN GOOGLE'}${sw.has(t.target) ? ` → suggest "${sw.get(t.target).to}" (${num(sw.get(t.target).impr)} impressions)` : ''}`));
      }
      const extra = s.ideas.untargeted.filter((q) => q.impr >= 2).slice(0, 8);
      if (extra.length) L.push('', `**Searches not in targets:** ${extra.map((q) => `"${q.query}" (#${q.rank}, ${num(q.impr)} impr.)`).join('; ')}`);
      L.push('', '**To do:**');
      if (!s.sugg.length) L.push('- Nothing.');
      s.sugg.forEach((x, i) => L.push(`${i + 1}. [${x.sev === 'fix' ? 'FIX' : x.sev === 'win' ? 'IMPROVE' : 'CHECK'}] ${x.title} — ${x.detail}`));
    }
    L.push('');
    return L.join('\n');
  }

  async function view({ R, alive, site }) {
    loading('Loading dashboard…');
    const hosts = site ? [site] : (CFG.sites || []).slice();
    const [own, gsc, last] = await Promise.all([
      OWN.lib.load(R, site ? OWN.lib.siteOf(site) : undefined).catch(() => []),
      loadGsc(R, site),
      lastReport(site),
    ]);
    if (!alive()) return;
    const ownBy = Object.fromEntries(own.map((o) => [o.host, o]));
    const repBy = last ? Object.fromEntries(last.rep.sites.map((s) => [s.host, s])) : {};
    const noPrev = !!(OWN.lib.SINCE && R.prevEnd < OWN.lib.SINCE);
    const ctx = { R, ownBy, gsc, repBy, noPrev, reportDate: last ? last.meta.date : '' };
    const rows = hosts.map((h) => buildSite(h, ctx));
    const all = rows.flatMap((s) => s.sugg).sort((a, b) => SEV[a.sev] - SEV[b.sev] || b.impact - a.impact);

    const sum = (f) => rows.reduce((a, s) => a + (f(s) || 0), 0);
    const vis = sum((s) => s.o?.cur.u), visP = sum((s) => s.o?.prev.u), views = sum((s) => s.o?.cur.v), viewsP = sum((s) => s.o?.prev.v);
    const gc = sum((s) => s.c?.c), gcP = sum((s) => s.p?.c), gi = sum((s) => s.c?.i), giP = sum((s) => s.p?.i);
    const pos = div(sum((s) => (s.c ? s.c.pos * s.c.i : 0)), gi), posP = div(sum((s) => (s.p ? s.p.pos * s.p.i : 0)), giP);
    const tShow = sum((s) => s.tShow), tTotal = sum((s) => s.tTotal);
    const fixN = all.filter((x) => x.sev === 'fix').length, winN = all.filter((x) => x.sev === 'win').length;
    const gOk = gsc.state === 'ok';
    const noP = noPrev ? { none: 'tracking is new' } : {};
    const dash = '<span class="muted">–</span>';

    const head = pageHead(EYEBROW, site ? `${favicon(site)}${esc(nameOf(site))}` : 'All sites overview',
      site ? `${esc(site)} · traffic, Google search, target keywords and what to do` : `${hosts.length} sites · traffic, Google search, target keywords and what to do next`,
      `<div class="ph-actions">${site ? `<a class="btn" href="${siteLink(null)}">← All sites</a>` : ''}<button type="button" class="btn primary" id="dCopy">${icon('copy')}Copy for AI</button><a class="btn" href="${CL.link({ src: 'rep', tab: 'daily', site })}">${icon('file')}Daily report</a></div>`);

    paint(head + googleBanner(gsc)
      + `<div class="stat-grid dash-stats">
          ${tile('Visitors', num(vis), deltaHtml(vis, visP, noP))}
          ${tile('Page views', num(views), deltaHtml(views, viewsP, noP))}
          ${tile('Google clicks', gOk ? num(gc) : dash, gOk ? deltaHtml(gc, gcP) : 'connect Google')}
          ${tile('Impressions', gOk ? num(gi) : dash, gOk ? deltaHtml(gi, giP) : '')}
          ${tile('Avg position', gOk && pos ? pos.toFixed(1) : dash, gOk && pos && posP ? deltaHtml(pos, posP, { lower: true }) : 'lower is better')}
          ${tile('Targets in Google', gOk ? `${num(tShow)}<span class="stat-of"> / ${num(tTotal)}</span>` : num(tTotal), gOk ? `${Math.round(div(tShow, tTotal) * 100)}% of target keywords` : 'keywords set')}
          ${tile('To fix', num(fixN), `${num(winN)} to improve`, fixN ? 'bad' : 'good')}
        </div>`
      + `<section class="card dash-live" id="dLive"></section>`
      + (last ? '' : `<div class="banner">${icon('file')}<div><b>No Daily report yet.</b> Indexing problems (pages not in Google, sitemap errors) appear here after the first one. <a href="${CL.link({ src: 'rep', tab: 'daily' })}">Generate it →</a></div></div>`)
      + todoCard(all)
      + (site ? '' : `<div class="section-title"><h2>Sites</h2><span class="note">Click a site for its own overview · click a column to sort</span></div><section class="card dash-sites"><div class="tbl"></div></section>`)
      + `<div class="section-title"><h2>Target keywords</h2><span class="note">Set in config.js → searchKeywords · ${gOk ? 'position = best Google position for a search that contains the keyword' : 'connect Google to see positions'}</span></div>`
      + `<div class="tk-grid">${rows.slice().sort((a, b) => b.impr - a.impr || b.visitors - a.visitors).map((s) => targetCard(s, gsc.state)).join('')}</div>`
      + (last ? `<p class="note rep-meta">Indexing data from the Daily report of ${esc(fmtDate(last.meta.date))}.</p>` : ''));

    if (!site) sitesTable($('.dash-sites .tbl'), rows, noPrev);

    // live: redraw the card and the table's "Live now" cells whenever the live data changes (every few seconds)
    const todayIso = CL.iso(CL.istToday());
    const today = R.end >= todayIso ? rows.reduce((a, s) => { const d = s.o && s.o.daily && s.o.daily[todayIso]; if (d) { a.u += d.u || 0; a.v += d.v || 0; } return a; }, { u: 0, v: 0 }) : null;
    const drawLive = () => {
      if (!alive()) { off(); return; }
      const box = $('#dLive');
      if (box) box.innerHTML = liveCard(hosts, today);
      const by = liveBy();
      $$('[data-live]').forEach((c) => { c.innerHTML = liveCell(by[c.dataset.live] || 0); });
    };
    const off = OWN.lib.onLive(drawLive);
    drawLive();

    // suggestion filters
    const list = $('.todo-list');
    let filter = 'all', expanded = false;
    const applyFilter = () => {
      if (!list) return;
      let n = 0;
      $$('li', list).forEach((li) => {
        const hit = filter === 'all' || (filter === 'fix' ? li.dataset.sev === 'fix' : li.dataset.kind === filter);
        li.hidden = !hit || (!expanded && n >= 10);
        if (hit) n++;
      });
      const more = $('#todoMore');
      if (more) { more.hidden = expanded || n <= 10; more.textContent = `Show all ${n}`; }
    };
    $$('.chip').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.k;
      $$('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      applyFilter();
    }));
    const more = $('#todoMore'); if (more) more.onclick = () => { expanded = true; applyFilter(); };

    const md = toMarkdown(rows, R, gsc);
    const cp = $('#dCopy');
    cp.onclick = async () => {
      try { await navigator.clipboard.writeText(md); } catch {
        const ta = Object.assign(document.createElement('textarea'), { value: md }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      cp.innerHTML = `${icon('check')}Copied`; setTimeout(() => { cp.innerHTML = `${icon('copy')}Copy for AI`; }, 2200);
    };
    const go = (fn) => async (e) => { e.currentTarget.disabled = true; try { await fn(); } catch { /* closed */ } rerender(); };
    const c1 = $('#dGConnect'); if (c1) c1.onclick = go(() => gAuth.connect());
    const c2 = $('#dGRenew'); if (c2) c2.onclick = go(() => gAuth.renew(true));
  }

  window.DASH = { view };
})();
