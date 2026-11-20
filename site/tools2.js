/* Tools, part 2 — every page of a site, ready to check with one click:
 *   #/tools/checker?site=…  Page checker list: all pages from the site's sitemap.xml; Check one / Check all
 *   #/tools/broken?site=…   Broken links: scans the pages, follows every link and image, lists 404s
 *   #/tools/uptime          Uptime: every site pinged every 5 min while the dashboard is open; red alert on
 *                           every page when one is down (+ browser notification if allowed)
 *   #/tools/ranks?site=…    Rank tracker: Google position of each target keyword per day (Search Console keeps
 *                           16 months, so the history is read from it — nothing to save by hand)
 * The site is picked automatically (the sidebar's site, else the last one used, else the first). */
(() => {
  'use strict';
  const { $, $$, num, esc, store, favicon, icon, pageHead, paint, gAuth, gGate, gSignIn, fmtDate } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const SITES = CFG.sites || [];
  const TARGETS = CFG.searchKeywords || {};
  const T = () => TOOLS.lib;
  const nameOf = (h) => (CFG.siteNames || {})[h] || h.split('.')[0];
  const EYEBROW = 'Tools';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isMine = (h) => h === 'codelove.in' || h.endsWith('.codelove.in');

  // ---------- shared: site picker + pages of a site ----------
  function pickSite(site) {
    const h = site && SITES.includes(site) ? site : SITES.includes(store.get('cl_tool_site')) ? store.get('cl_tool_site') : SITES[0];
    store.set('cl_tool_site', h);
    return h;
  }
  const sitePicker = (tab, host) => `<label class="site-pick">${favicon(host)}<select id="tSite" aria-label="Site">${SITES.map((h) => `<option value="${esc(h)}"${h === host ? ' selected' : ''}>${esc(nameOf(h))} — ${esc(h)}</option>`).join('')}</select>${icon('chev')}</label>`;
  const wirePicker = (tab) => { const s = $('#tSite'); if (s) s.onchange = () => { location.hash = CL.link({ src: 'tools', tab, site: s.value }); }; };

  function linksIn(html, base) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const out = [];
    const add = (raw, kind, text) => {
      if (!raw || /^(#|mailto:|tel:|javascript:|data:|blob:)/i.test(raw.trim())) return;
      try { const u = new URL(raw, base); if (!/^https?:$/.test(u.protocol)) return; u.hash = ''; out.push({ url: u.href, kind, text: (text || '').replace(/\s+/g, ' ').trim().slice(0, 80) }); } catch { /* ignore */ }
    };
    doc.querySelectorAll('a[href]').forEach((a) => add(a.getAttribute('href'), 'link', a.textContent || a.getAttribute('aria-label') || a.title));
    doc.querySelectorAll('img[src]').forEach((i) => add(i.getAttribute('src'), 'image', i.getAttribute('alt')));
    return out;
  }
  const pagesCache = new Map();
  /** Every page URL of a site: sitemap.xml (or a sitemap index), else the links on its home page. */
  function sitePages(host) {
    if (!pagesCache.has(host)) pagesCache.set(host, (async () => {
      const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
      const sm = await T().grab(`https://${host}/sitemap.xml`, 20e3);
      let urls = [], from = 'sitemap.xml';
      if (sm.ok && /<sitemapindex/i.test(sm.text)) {
        for (const k of locs(sm.text).slice(0, 40)) { const c = await T().grab(k, 20e3); if (c.ok) urls.push(...locs(c.text)); }
      } else if (sm.ok) urls = locs(sm.text);
      if (!urls.length) {
        from = 'home page links';
        const home = await T().grab(`https://${host}/`);
        urls = [`https://${host}/`, ...linksIn(home.text, `https://${host}/`).filter((l) => l.kind === 'link').map((l) => l.url)];
      }
      urls = [...new Set(urls.filter((u) => { try { return new URL(u).hostname === host; } catch { return false; } }))];
      return { urls, from };
    })().catch((e) => { pagesCache.delete(host); throw e; }));
    return pagesCache.get(host);
  }
  const pathOf = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
  /** Run fn over items, n at a time; stop() ends it early. */
  function pool(items, n, fn, onEach) {
    let i = 0, stopped = false;
    const p = Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (!stopped && i < items.length) { const k = i++; await fn(items[k], k); if (onEach) onEach(); }
    }));
    return { done: p, stop: () => { stopped = true; } };
  }

  // ---------- Page checker: all pages ----------
  const AUD_KEY = (h) => 'cl_pc_' + h;
  const audits = (h) => { try { return JSON.parse(store.get(AUD_KEY(h)) || '{}'); } catch { return {}; } };
  const full = new Map(); // url -> audit result (this session, for the expanded rows)
  let pcRun = null;
  async function viewPages({ alive, site }) {
    const host = pickSite(site);
    paint(pageHead(EYEBROW, 'Page checker', 'Every page of the site from its sitemap — check one page or all of them', `<div class="ph-actions">${sitePicker('checker', host)}</div>`)
      + '<div id="pcBar"></div><section class="card dash-sites"><div class="tbl"><p class="empty ad-wait"><span class="spinner"></span>Reading the sitemap…</p></div></section>', false);
    wirePicker('checker');
    const { urls, from } = await sitePages(host);
    if (!alive()) return;
    const saved = audits(host);
    const cell = (u) => { const a = saved[u]; return a ? `${T().scorePill(a.score)}` : '<span class="muted">–</span>'; };
    const counts = (u) => { const a = saved[u]; return a ? `${a.fix ? `<span class="gp none">${a.fix} fix</span>` : ''}${a.warn ? `<span class="gp p23">${a.warn} improve</span>` : ''}${!a.fix && !a.warn ? '<span class="gp p1">OK</span>' : ''}` : '<span class="muted">not checked</span>'; };
    const checked = () => urls.filter((u) => saved[u]).length;
    const bar = () => {
      const n = checked(), avg = n ? Math.round(urls.filter((u) => saved[u]).reduce((a, u) => a + saved[u].score, 0) / n) : 0;
      $('#pcBar').innerHTML = `<section class="card run-bar"><div class="rb-info"><b>${num(urls.length)} pages</b><span class="note">from ${esc(from)} · ${num(n)} checked${n ? ` · average score ${avg}` : ''}</span></div>
        <div class="ph-actions">${pcRun ? `<span class="note" id="pcProg"></span><button type="button" class="btn" id="pcStop">Stop</button>` : `<button type="button" class="btn primary" id="pcAll">${icon('check')}Check all ${num(urls.length)} pages</button>${n ? '<button type="button" class="btn" id="pcClear">Clear results</button>' : ''}`}</div></section>`;
      const a = $('#pcAll'); if (a) a.onclick = () => checkMany(urls.filter((u) => !saved[u]).length ? urls.filter((u) => !saved[u]) : urls);
      const s = $('#pcStop'); if (s) s.onclick = () => { if (pcRun) pcRun.stop(); };
      const c = $('#pcClear'); if (c) c.onclick = () => { store.set(AUD_KEY(host), null); for (const k in saved) delete saved[k]; bar(); refresh(); };
    };
    const refresh = () => $$('[data-pu]').forEach((el) => {
      const u = el.dataset.pu;
      if (el.dataset.k === 'score') el.innerHTML = cell(u); else el.innerHTML = counts(u);
    });
    async function checkOne(u) {
      const res = await T().grabPage(u, 20e3);
      const a = T().audit(res);
      full.set(u, a);
      saved[u] = { score: a.score, fix: a.C.filter((c) => c.lvl === 'fix').length, warn: a.C.filter((c) => c.lvl === 'warn').length, at: Date.now() };
    }
    const persist = () => store.set(AUD_KEY(host), JSON.stringify(saved));
    async function checkMany(list) {
      if (pcRun) return;
      let done = 0;
      pcRun = { stop: () => {} };
      bar();
      const run = pool(list, 4, checkOne, () => {
        done++; if (done % 5 === 0) persist();
        if (!alive()) { run.stop(); return; }
        const p = $('#pcProg'); if (p) p.textContent = `Checking ${num(done)} of ${num(list.length)}…`;
        refresh();
      });
      pcRun = run;
      await run.done;
      persist(); pcRun = null;
      if (alive()) { bar(); refresh(); }
    }
    bar();
    CL.table($('.dash-sites .tbl'), [
      { key: 'path', label: 'Page', cls: 'path', html: (r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.url)}">${esc(r.path)}</a>` },
      { key: 'score', label: 'Score', num: true, html: (r) => `<span data-pu="${esc(r.url)}" data-k="score">${cell(r.url)}</span>` },
      { key: 'issues', label: 'Result', html: (r) => `<span class="rs-counts" data-pu="${esc(r.url)}" data-k="n">${counts(r.url)}</span>` },
      { key: 'act', label: '', html: (r) => `<span class="row-actions"><button type="button" class="btn sm pc-one" data-u="${esc(r.url)}">${icon('check')}Check</button><a class="btn sm" href="${CL.link({ src: 'tools', tab: 'checker' })}?url=${encodeURIComponent(r.url)}">Details</a></span>` },
    ], urls.map((u) => ({ url: u, path: pathOf(u), score: saved[u] ? saved[u].score : -1, issues: saved[u] ? saved[u].fix * 100 + saved[u].warn : -1 })), {
      sort: 'path', asc: true, search: 'Search pages', pageSize: 50, rowKey: (r) => r.url,
      expand: (r) => (full.get(r.url) ? `<div class="h-detail">${T().checkList(full.get(r.url).C, true) || ''}</div>` : '<p class="empty">Press Check to audit this page.</p>'),
    });
    $('.dash-sites').addEventListener('click', async (e) => {
      const b = e.target.closest('.pc-one'); if (!b) return;
      e.stopPropagation(); b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
      await checkOne(b.dataset.u); persist();
      if (!alive()) return;
      b.disabled = false; b.innerHTML = `${icon('check')}Check`; refresh(); bar();
    });
  }

  // ---------- Broken links ----------
  const statusCache = new Map(); // url -> promise of status (number, or 'dead' for an unreachable external)
  async function statusOf(url, external) {
    if (!statusCache.has(url)) statusCache.set(url, (async () => {
      if (external) {
        // other websites block reading the answer (CORS); an opaque reply still proves the server exists
        try { await fetch(url, { mode: 'no-cors', cache: 'no-store' }); return 'ok?'; } catch { return 'dead'; }
      }
      try {
        let r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (r.status === 405 || r.status === 403) r = await fetch(url, { cache: 'no-store' });
        return r.status;
      } catch { return 0; }
    })());
    return statusCache.get(url);
  }
  let blRun = null, blResult = null; // last result per host stays while the page is open
  async function viewBroken({ alive, site }) {
    const host = pickSite(site);
    paint(pageHead(EYEBROW, 'Broken links', 'Scans the pages, follows every link and image, and lists the ones that are broken (404 etc.)', `<div class="ph-actions">${sitePicker('broken', host)}</div>`)
      + `<section class="card run-bar"><div class="rb-info"><b id="blPages">Reading the sitemap…</b><span class="note">Links inside the CodeLove sites are checked exactly; other websites can only be checked for "not reachable".</span></div>
          <div class="ph-actions"><label class="note blx"><input type="checkbox" id="blExt"${store.get('cl_bl_ext') === '1' ? ' checked' : ''}> also check other websites</label><button type="button" class="btn primary" id="blGo" disabled>${icon('search')}Check all links</button></div></section>
        <div id="blOut"></div>`, false);
    wirePicker('broken');
    const { urls } = await sitePages(host);
    if (!alive()) return;
    $('#blPages').textContent = `${num(urls.length)} pages to scan`;
    const go = $('#blGo'); go.disabled = false;
    $('#blExt').onchange = (e) => store.set('cl_bl_ext', e.target.checked ? '1' : null);
    const draw = (r, running) => {
      const broken = r.links.filter((l) => l.bad);
      $('#blOut').innerHTML = `<div class="stat-grid">
          <div class="stat"><span class="stat-label">Pages scanned</span><span class="stat-value">${num(r.pagesDone)} / ${num(r.pages)}</span><span class="stat-sub">${running ? 'running…' : 'done'}</span></div>
          <div class="stat"><span class="stat-label">Links found</span><span class="stat-value">${num(r.links.length)}</span><span class="stat-sub">${num(r.checked)} checked${(() => { const sk = r.links.filter((l) => l.external && l.status == null).length; return sk && !running ? ` · ${num(sk)} on other websites skipped` : ''; })()}</span></div>
          <div class="stat ${broken.length ? 'bad' : 'good'}"><span class="stat-label">Broken</span><span class="stat-value">${num(broken.length)}</span><span class="stat-sub">${broken.length ? 'fix or remove these links' : 'none found'}</span></div>
        </div>
        ${broken.length ? `<section class="card"><div class="card-head"><h2>Broken links</h2><button type="button" class="btn sm" id="blCopy">${icon('copy')}Copy for AI</button></div><ol class="probs">${broken.map((l) => `<li class="prob k-fix"><div class="prob-top"><span class="gp none">${l.status === 'dead' ? 'Not reachable' : l.status ? 'HTTP ' + l.status : 'Error'}</span><b>${l.kind === 'image' ? 'Image' : 'Link'}</b><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url.replace(/^https?:\/\//, ''))}</a></div>
          <div class="prob-status">Found on ${num(l.from.size)} page${l.from.size > 1 ? 's' : ''}${l.text ? ` · text "${esc(l.text)}"` : ''}</div>
          <details class="prob-urls"><summary>Show the pages</summary><ul class="ix-list">${[...l.from].slice(0, 100).map((p) => `<li><a href="${esc(p)}" target="_blank" rel="noopener">${esc(pathOf(p))}</a></li>`).join('')}</ul></details></li>`).join('')}</ol>
          <p class="note">A 404 on an app route can still work in the browser when the site uses a 404.html fallback (single-page apps). Open the link to be sure; such pages should still return 200 for Google.</p></section>` : (running ? '' : '<section class="card"><p class="empty">No broken links found.</p></section>')}`;
      const c = $('#blCopy'); if (c) c.onclick = async () => {
        const md = [`Fix these broken links on ${host} (repo ${(CFG.repoFolders || {})[host] ? CFG.repoRoot + '\\' + CFG.repoFolders[host] : host}):`, '', ...broken.map((l) => `- ${l.kind} ${l.url} → ${l.status === 'dead' ? 'not reachable' : 'HTTP ' + l.status}; found on: ${[...l.from].slice(0, 20).map(pathOf).join(', ')}${l.text ? ` (text "${l.text}")` : ''}`), '', 'Fix the URL, point it to the right page, or remove the link. Keep sitemap.xml in sync.'].join('\n');
        try { await navigator.clipboard.writeText(md); c.innerHTML = `${icon('check')}Copied`; } catch { /* ignore */ }
      };
    };
    if (blResult && blResult.host === host) draw(blResult, !!blRun);
    go.onclick = async () => {
      if (blRun) { blRun.stop(); return; }
      const ext = $('#blExt').checked;
      const r = blResult = { host, pages: urls.length, pagesDone: 0, checked: 0, links: [] };
      const byUrl = new Map();
      go.innerHTML = `${icon('x')}Stop`;
      // 1) read every page and collect its links (the page itself counts as a link from the sitemap)
      blRun = pool(urls, 4, async (u) => {
        const res = await T().grab(u, 20e3);
        const add = (l, from) => {
          let x = byUrl.get(l.url);
          if (!x) { x = { url: l.url, kind: l.kind, text: l.text, from: new Set(), status: null, bad: false, external: !isMine(new URL(l.url).hostname) }; byUrl.set(l.url, x); r.links.push(x); }
          x.from.add(from);
        };
        if (!res.ok) { add({ url: u, kind: 'link', text: '(listed in sitemap.xml)' }, `https://${host}/sitemap.xml`); const x = byUrl.get(u); x.status = res.status; x.bad = true; return; }
        for (const l of linksIn(res.text, res.url)) add(l, u);
      }, () => { r.pagesDone++; if (alive() && r.pagesDone % 3 === 0) draw(r, true); });
      await blRun.done;
      // 2) check every link found
      const todo = r.links.filter((l) => l.status == null && (!l.external || ext));
      const run2 = pool(todo, 6, async (l) => {
        const s = await statusOf(l.url, l.external);
        l.status = s; l.bad = s === 'dead' || (typeof s === 'number' && (s === 0 || s >= 400));
      }, () => { r.checked++; if (alive() && r.checked % 10 === 0) draw(r, true); });
      blRun = run2;
      await run2.done;
      blRun = null;
      if (!alive()) return;
      go.innerHTML = `${icon('search')}Check all links`;
      draw(r, false);
    };
  }

  // ---------- Uptime monitor (runs in the background on every page of the dashboard) ----------
  const UP_KEY = 'cl_uptime', EVERY = 5 * 60e3, KEEP = 3 * 864e5;
  const upData = () => { try { return JSON.parse(store.get(UP_KEY) || '{}'); } catch { return {}; } };
  const okStatus = (s) => s >= 200 && s < 400;
  const upListeners = new Set();
  let upBusy = false;
  async function ping(h) { const r = await T().grab(`https://${h}/`, 15e3); return [Date.now(), r.ms, r.ok ? r.status : r.status || 0]; }
  async function runUptime(force = false) {
    if (upBusy || !navigator.onLine) return;
    const last = +store.get('cl_uptime_at') || 0;
    if (!force && Date.now() - last < EVERY - 15e3) { renderAlert(); return; } // another tab checked recently
    upBusy = true; store.set('cl_uptime_at', String(Date.now()));
    const before = new Set(SITES.filter(isDown));
    const fresh = {};
    await pool(SITES, 4, async (h) => {
      let s = await ping(h);
      if (!okStatus(s[2])) { await sleep(15e3); s = await ping(h); } // confirm before calling it down
      fresh[h] = s;
    }).done;
    const data = upData(), cut = Date.now() - KEEP;
    // every site failing at once = this computer's network, not the sites
    const allFail = SITES.every((h) => !okStatus(fresh[h][2]));
    for (const h of SITES) {
      const arr = (data[h] || []).filter((x) => x[0] > cut);
      if (!allFail) arr.push(fresh[h]);
      data[h] = arr;
    }
    try { store.set(UP_KEY, JSON.stringify(data)); } catch { /* storage full: keep going */ }
    upBusy = false;
    renderAlert(allFail);
    if (!allFail && 'Notification' in window && Notification.permission === 'granted') {
      SITES.filter((h) => isDown(h) && !before.has(h)).forEach((h) => { try { new Notification(`${nameOf(h)} is down`, { body: `${h} — ${statusText(lastOf(h))}`, tag: 'cl-down-' + h }); } catch { /* ignore */ } });
    }
    upListeners.forEach((f) => f());
  }
  const lastOf = (h) => { const a = upData()[h] || []; return a[a.length - 1] || null; };
  const isDown = (h) => { const s = lastOf(h); return !!s && !okStatus(s[2]); };
  const statusText = (s) => (!s ? 'not checked' : okStatus(s[2]) ? `up · ${num(s[1])} ms` : s[2] ? `HTTP ${s[2]}` : 'not reachable');
  function downSince(h) {
    const a = upData()[h] || [];
    let t = null;
    for (let i = a.length - 1; i >= 0 && !okStatus(a[i][2]); i--) t = a[i][0];
    return t;
  }
  const hm = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  function renderAlert(netFail = false) {
    const box = $('#downAlert');
    if (!box) return;
    const down = SITES.filter(isDown);
    document.title = down.length ? `(${down.length} down) CodeLove Admin` : 'CodeLove Admin';
    if (!down.length && !netFail) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = netFail && !down.length
      ? `<div class="down-alert warn">${icon('alert')}<div><b>Couldn't reach any site.</b> Probably this computer's internet — the uptime check will try again in 5 minutes.</div></div>`
      : `<div class="down-alert">${icon('alert')}<div><b>${down.length === 1 ? '1 site is down' : `${down.length} sites are down`}:</b> ${down.map((h) => `${esc(nameOf(h))} <span>(${esc(statusText(lastOf(h)))} · since ${esc(hm(downSince(h)))})</span>`).join(', ')}</div><a class="btn sm" href="${CL.link({ src: 'tools', tab: 'uptime' })}">Uptime →</a></div>`;
  }
  let upStarted = false;
  function startUptime() {
    if (upStarted) return; upStarted = true;
    renderAlert();
    setTimeout(() => runUptime(), 4000); // let the dashboard load first
    setInterval(() => runUptime(), 60e3);
    addEventListener('storage', (e) => { if (e.key === UP_KEY) { renderAlert(); upListeners.forEach((f) => f()); } });
    addEventListener('online', () => runUptime());
  }

  function uptimeView({ alive }) {
    const draw = () => {
      if (!alive()) { upListeners.delete(draw); return; }
      const data = upData(), day = Date.now() - 864e5;
      const rows = SITES.map((h) => {
        const a = data[h] || [], d24 = a.filter((x) => x[0] > day), ok = d24.filter((x) => okStatus(x[2]));
        return { host: h, name: nameOf(h), last: a[a.length - 1] || null, up: d24.length ? ok.length / d24.length : null, avg: ok.length ? Math.round(ok.reduce((s, x) => s + x[1], 0) / ok.length) : null, n: d24.length, lastDown: [...a].reverse().find((x) => !okStatus(x[2])), d24 };
      });
      const down = rows.filter((r) => r.last && !okStatus(r.last[2]));
      const lastRun = +store.get('cl_uptime_at') || 0;
      const box = $('#upBody');
      if (!box) return;
      box.innerHTML = `<div class="stat-grid">
          <div class="stat ${down.length ? 'bad' : 'good'}"><span class="stat-label">Right now</span><span class="stat-value">${down.length ? `${down.length} down` : 'All up'}</span><span class="stat-sub">${lastRun ? 'checked ' + hm(lastRun) : 'first check running…'}</span></div>
          <div class="stat"><span class="stat-label">Uptime · 24 h</span><span class="stat-value">${(() => { const all = rows.flatMap((r) => r.d24); return all.length ? (all.filter((x) => okStatus(x[2])).length / all.length * 100).toFixed(2) + '%' : '–'; })()}</span><span class="stat-sub">all sites together</span></div>
          <div class="stat"><span class="stat-label">Checks</span><span class="stat-value">every 5 min</span><span class="stat-sub">while a dashboard tab is open</span></div>
        </div>
        <section class="card dash-sites"><div class="up-list">${rows.map((r) => {
          const st = !r.last ? ['–', 'deep'] : okStatus(r.last[2]) ? ['Up', 'p1'] : ['Down', 'none'];
          const ticks = r.d24.slice(-96);
          return `<div class="up-row"><a class="site-cell" href="https://${esc(r.host)}/" target="_blank" rel="noopener">${favicon(r.host)}<span><b>${esc(r.name)}</b><span class="note block">${esc(r.host)}</span></span></a>
            <span class="gp ${st[1]}">${st[0]}</span>
            <span class="up-ticks" title="last ${ticks.length} checks">${ticks.map((x) => `<i class="${okStatus(x[2]) ? (x[1] > 2000 ? 'slow' : 'ok') : 'bad'}" title="${esc(hm(x[0]))} · ${esc(statusText(x))}"></i>`).join('') || '<span class="muted">no checks yet</span>'}</span>
            <span class="up-num"><b>${r.up == null ? '–' : (r.up * 100).toFixed(1) + '%'}</b><span>uptime 24 h</span></span>
            <span class="up-num"><b>${r.avg == null ? '–' : num(r.avg) + ' ms'}</b><span>avg load</span></span>
            <span class="up-num"><b>${r.lastDown ? esc(hm(r.lastDown[0])) : 'never'}</b><span>last down (3 days)</span></span></div>`;
        }).join('')}</div></section>
        <p class="note">Checks run from this browser every 5 minutes while any dashboard tab is open (one tab does the work). A site that fails is checked again after 15 s before it counts as down. When every site fails at once it is treated as your internet, not the sites.</p>`;
    };
    const notif = 'Notification' in window ? Notification.permission : 'unsupported';
    paint(pageHead(EYEBROW, 'Uptime', 'Is every site up? Red alert on every dashboard page when one goes down',
      `<div class="ph-actions">${notif === 'default' ? `<button type="button" class="btn" id="upNotif">${icon('alert')}Turn on notifications</button>` : notif === 'granted' ? '<span class="note">Browser notifications on</span>' : ''}<button type="button" class="btn primary" id="upNow">${icon('refresh')}Check now</button></div>`)
      + '<div id="upBody"></div>', false);
    $('#upNow').onclick = async (e) => { const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span>Checking…'; await runUptime(true); if (alive()) { b.disabled = false; b.innerHTML = `${icon('refresh')}Check now`; } };
    const nb = $('#upNotif'); if (nb) nb.onclick = () => Notification.requestPermission().then(() => uptimeView({ alive }));
    upListeners.add(draw);
    draw();
  }

  // ---------- Rank tracker ----------
  function rankSvg(pts, w, h, big = false) {
    const have = pts.filter((p) => p.r);
    if (!have.length) return '<span class="muted">not in Google</span>';
    const max = Math.max(10, ...have.map((p) => p.r)), pad = big ? 18 : 3;
    const x = (i) => pad + (i / Math.max(1, pts.length - 1)) * (w - pad * 2);
    const y = (r) => pad + ((r - 1) / (max - 1)) * (h - pad * 2);
    let d = '', pen = false;
    pts.forEach((p, i) => { if (!p.r) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`; pen = true; });
    const dots = have.length <= 3 || big ? pts.map((p, i) => (p.r ? `<circle cx="${x(i).toFixed(1)}" cy="${y(p.r).toFixed(1)}" r="${big ? 2.6 : 1.8}"><title>${esc(p.label)} · #${p.r}</title></circle>` : '')).join('') : '';
    const p1 = max > 10 ? `<line class="rk-p1" x1="${pad}" x2="${w - pad}" y1="${y(10.5).toFixed(1)}" y2="${y(10.5).toFixed(1)}"/>` : '';
    const labels = big ? `<text x="2" y="${y(1) + 4}" class="rk-ax">#1</text><text x="2" y="${y(max) + 4}" class="rk-ax">#${max}</text>${max > 10 ? `<text x="${w - pad}" y="${y(10.5) - 4}" class="rk-ax" text-anchor="end">page 1 ↑</text>` : ''}` : '';
    return `<svg class="rk-svg${big ? ' big' : ''}" viewBox="0 0 ${w} ${h}" width="${big ? '100%' : w}" height="${h}" preserveAspectRatio="none">${p1}<path d="${d}"/>${dots}${labels}</svg>`;
  }
  async function viewRanks({ R, alive, site, params }) {
    const host = pickSite(site);
    const mode = params.get('m') === 'top' ? 'top' : 'targets';
    if (!(await gGate(CL.GSC_SCOPE, (msg) => gSignIn({ id: 'rkSignin', need: CL.GSC_SCOPE, msg, eyebrow: 'Rank tracker', title: 'Connect Google Search Console', text: 'Positions come from Search Console (read-only), the same Google sign-in as Google Search.' }), alive))) return;
    const base = CL.link({ src: 'tools', tab: 'ranks', site: host });
    paint(pageHead(EYEBROW, 'Rank tracker', `Google position of each keyword, day by day · ${esc(CL.rangeText(R))} (change it in the sidebar; Search Console keeps 16 months)`,
      `<div class="ph-actions">${sitePicker('ranks', host)}<div class="seg"><a class="seg-b${mode === 'targets' ? ' on' : ''}" href="${base}">Target keywords</a><a class="seg-b${mode === 'top' ? ' on' : ''}" href="${base}${base.includes('?') ? '&' : '?'}m=top">Top searches</a></div></div>`)
      + '<section class="card dash-sites"><div class="tbl"><p class="empty ad-wait"><span class="spinner"></span>Reading Search Console…</p></div></section>', false);
    wirePicker('ranks');
    const G = GSC.lib;
    const { sites } = await G.resolve(host);
    if (!alive()) return;
    if (!sites.length) { $('.dash-sites .tbl').innerHTML = '<p class="empty">This site is not in Search Console.</p>'; return; }
    const rows = await G.rows(sites[0], R.start, R.end, ['date', 'query']);
    if (!alive()) return;
    const days = []; CL.eachDay(R.start, R.end, (iso, d) => days.push({ iso, label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }));
    // keyword -> per day: best (lowest) position among searches that contain it, impressions summed
    const track = (match) => {
      const per = new Map();
      for (const r of rows) {
        if (!match(r.k[1].toLowerCase())) continue;
        const d = per.get(r.k[0]) || { r: 0, i: 0, c: 0 };
        const rk = G.rankOf(r.pos);
        if (rk && (!d.r || rk < d.r)) d.r = rk;
        d.i += r.i; d.c += r.c; per.set(r.k[0], d);
      }
      const pts = days.map((d) => ({ label: d.label, ...(per.get(d.iso) || { r: 0, i: 0, c: 0 }) }));
      const seen = pts.filter((p) => p.r);
      const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, p) => a + p.r, 0) / arr.length) : 0);
      const now = avg(seen.slice(-7)), start = avg(seen.slice(0, 7));
      return { pts, now, start, best: seen.length ? Math.min(...seen.map((p) => p.r)) : 0, days: seen.length, impr: pts.reduce((a, p) => a + p.i, 0), clicks: pts.reduce((a, p) => a + p.c, 0) };
    };
    let list;
    if (mode === 'top') {
      const tot = new Map(); for (const r of rows) tot.set(r.k[1], (tot.get(r.k[1]) || 0) + r.i);
      list = [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([q]) => ({ kw: q, ...track((s) => s === q.toLowerCase()) }));
    } else {
      list = (TARGETS[host] || []).map((t) => { const tl = String(t).toLowerCase().trim(); return { kw: t, ...track((s) => s.includes(tl)) }; });
    }
    if (!list.length) { $('.dash-sites .tbl').innerHTML = `<p class="empty">${mode === 'top' ? 'No searches in this range.' : 'No target keywords set for this site (config.js → searchKeywords).'}</p>`; return; }
    const pos = (r) => (r ? `<span class="gp ${r <= 10 ? 'p1' : r <= 30 ? 'p23' : 'deep'}">#${r} · page ${Math.ceil(r / 10)}</span>` : '<span class="gp none">Not in Google</span>');
    CL.table($('.dash-sites .tbl'), [
      { key: 'kw', label: mode === 'top' ? 'Search' : 'Target keyword', cls: 'kw', html: (r) => `<b>${esc(r.kw)}</b>` },
      { key: 'nowS', label: 'Now (7 days)', num: true, lowFirst: true, html: (r) => pos(r.now) },
      { key: 'chg', label: 'Change', num: true, html: (r) => (r.now && r.start && r.now !== r.start ? `<span class="delta ${r.now < r.start ? 'up' : 'down'}">${r.now < r.start ? '▲' : '▼'} ${Math.abs(r.start - r.now)}</span>` : '<span class="muted">–</span>') },
      { key: 'bestS', label: 'Best', num: true, lowFirst: true, html: (r) => (r.best ? '#' + r.best : '–') },
      { key: 'trend', label: 'Trend (1 = top)', html: (r) => rankSvg(r.pts, 150, 34) },
      { key: 'impr', label: 'Impressions', num: true, fmt: num },
      { key: 'clicks', label: 'Clicks', num: true, fmt: num },
    ], list.map((r) => ({ ...r, nowS: r.now || 999, bestS: r.best || 999, chg: r.now && r.start ? r.start - r.now : -999, trend: r.days })), {
      sort: 'nowS', asc: true, pageSize: 100, rowKey: (r) => r.kw,
      expand: (r) => `<div class="h-detail">${rankSvg(r.pts, 800, 180, true)}<p class="note">${r.days ? `In Google on ${r.days} of ${r.pts.length} days · first week avg #${r.start || '–'} → last week avg #${r.now || '–'}` : 'No Google impressions for this keyword in this range — see Dashboard → Target keywords for what to change.'}</p></div>`,
    });
    $('.dash-sites').insertAdjacentHTML('afterend', `<p class="note">Position = best Google position on that day for a search containing the keyword (Search Console data, 2–3 days late). Click a row for the big chart. Lower is better; page 1 = #1–10.</p>`);
  }

  window.TOOLS2 = {
    pages: viewPages, broken: viewBroken, uptimeView, ranks: viewRanks,
    startUptime, clear: () => { pagesCache.clear(); statusCache.clear(); blResult = null; },
  };
})();
