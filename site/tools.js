/* Tools section: handy checks for every CodeLove site, run straight from the browser (no login needed).
 *   #/tools          Site health: every site's home page, robots.txt and sitemap.xml checked live
 *                    (status, speed, title, description, canonical, social tags, H1, noindex, tracker, AdSense…)
 *   #/tools/checker  Page checker: full SEO audit of one page + Google result and social card previews
 *   #/tools/speed    PageSpeed: Google Lighthouse scores (performance, accessibility, best practices, SEO)
 *   #/tools/utm      UTM link builder: tagged links for YouTube, Instagram, WhatsApp…
 *   #/tools/links    Quick links: every console and per-site test tool in one place
 * The sites are on GitHub Pages, which allows cross-origin reads, so their HTML can be fetched from here. */
(() => {
  'use strict';
  const { $, $$, num, esc, store, favicon, icon, pageHead, loading, paint, el } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const SITES = CFG.sites || [];
  const NAMES = CFG.siteNames || {};
  const nameOf = (h) => NAMES[h] || h.split('.')[0];
  const app = $('#app');
  const EYEBROW = 'Tools';
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  // ---------- fetch + audit ----------
  async function grab(url, ms = 12e3) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    const t0 = performance.now();
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal, redirect: 'follow' });
      const text = await r.text();
      return { ok: r.ok, status: r.status, ms: Math.round(performance.now() - t0), size: new Blob([text]).size, text, url: r.url || url };
    } catch (e) {
      return { ok: false, status: 0, ms: Math.round(performance.now() - t0), size: 0, text: '', url, blocked: e.name !== 'AbortError', timeout: e.name === 'AbortError' };
    } finally { clearTimeout(t); }
  }

  /** Everything we can read from a page's HTML, plus a list of checks (fix / warn / ok). */
  function audit(res) {
    const doc = new DOMParser().parseFromString(res.text || '', 'text/html');
    const q = (s) => doc.querySelector(s);
    const meta = (n) => (q(`meta[name="${n}" i]`)?.getAttribute('content') || '').trim();
    const prop = (p) => (q(`meta[property="${p}" i]`)?.getAttribute('content') || '').trim();
    let host = ''; try { host = new URL(res.url).hostname; } catch { /* ignore */ }
    const raw = res.text || '';
    const d = {
      title: (doc.title || '').trim(), desc: meta('description'), robots: meta('robots').toLowerCase(), viewport: meta('viewport'),
      canonical: q('link[rel="canonical" i]')?.getAttribute('href') || '', lang: doc.documentElement.getAttribute('lang') || '',
      ogTitle: prop('og:title'), ogDesc: prop('og:description'), ogImage: prop('og:image'), ogUrl: prop('og:url'), twCard: meta('twitter:card'),
      icon: !!q('link[rel~="icon" i]'), ld: doc.querySelectorAll('script[type="application/ld+json" i]').length,
      tracker: /admin\.codelove\.in\/t\.js/.test(raw), ga: /googletagmanager\.com\/gtag|gtag\(['"]config['"]/.test(raw), adsense: /adsbygoogle|ca-pub-\d+/.test(raw),
      h: [...doc.querySelectorAll('h1,h2,h3')].map((x) => ({ l: +x.tagName[1], t: x.textContent.replace(/\s+/g, ' ').trim() })).filter((x) => x.t).slice(0, 60),
    };
    d.h1 = d.h.filter((x) => x.l === 1);
    const imgs = [...doc.querySelectorAll('img')];
    d.imgs = imgs.length; d.noAlt = imgs.filter((i) => !i.hasAttribute('alt')).length;
    const links = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    d.internal = links.filter((h) => h && !/^(https?:)?\/\//i.test(h) || (host && h.includes('//' + host))).length;
    d.external = links.length - d.internal;
    doc.querySelectorAll('script,style,noscript,template,svg').forEach((x) => x.remove());
    const text = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim();
    d.words = text ? text.split(' ').length : 0;

    const C = [];
    const add = (lvl, label, value, fix = '') => C.push({ lvl, label, value, fix });
    if (!res.ok) add('fix', 'Page loads', res.timeout ? 'Timed out' : res.blocked ? 'Could not be read (CORS or offline)' : `HTTP ${res.status}`, 'The page must return 200.');
    else add('ok', 'Page loads', `HTTP ${res.status} · ${num(res.ms)} ms · ${num(Math.round(res.size / 1024))} KB HTML`);
    if (!res.ok) return { d, C, score: 0 };
    // measured from this browser (includes your network), so slow = "improve", never "fix"
    add(res.ms > 2000 ? 'warn' : 'ok', 'Load time (from this browser)', `${num(res.ms)} ms`, 'Slow to load the HTML from here. Press "Check again"; if it stays slow, check the hosting. GitHub Pages is usually under 800 ms.');
    if (!d.title) add('fix', 'Title', 'Missing', 'Add a <title> with the main search phrase first.');
    else add(d.title.length < 25 || d.title.length > 65 ? 'warn' : 'ok', 'Title', `${d.title.length} chars · "${d.title}"`, 'Keep it 30–60 characters, main phrase first, brand last.');
    if (!d.desc) add('fix', 'Meta description', 'Missing', 'Add <meta name="description"> (120–160 characters) saying what the page gives.');
    else add(d.desc.length < 70 || d.desc.length > 170 ? 'warn' : 'ok', 'Meta description', `${d.desc.length} chars`, 'Aim for 120–160 characters.');
    add(d.h1.length === 1 ? 'ok' : 'warn', 'H1 heading', d.h1.length ? `${d.h1.length} × "${d.h1[0].t.slice(0, 60)}"` : 'None in the HTML', d.h1.length ? 'Use exactly one H1 per page.' : 'Add one H1 with the main phrase (if the page renders it with JavaScript, Google still sees it, but HTML is safer).');
    if (/noindex/.test(d.robots)) add('fix', 'Indexing allowed', `robots: ${d.robots}`, 'Remove noindex if this page should be in Google.');
    else add('ok', 'Indexing allowed', d.robots || 'no robots meta (allowed)');
    if (!d.canonical) add('warn', 'Canonical URL', 'Missing', 'Add <link rel="canonical" href="https://…"> with the page\'s own URL.');
    else { let ch = ''; try { ch = new URL(d.canonical, res.url).hostname; } catch { /* ignore */ } add(ch && ch !== host ? 'warn' : 'ok', 'Canonical URL', d.canonical, 'The canonical points to another host — make sure that is intended.'); }
    add(d.viewport ? 'ok' : 'fix', 'Mobile viewport', d.viewport || 'Missing', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
    add(d.lang ? 'ok' : 'warn', 'Language', d.lang || 'Missing', 'Add lang="en" (or ta) on <html>.');
    add(d.ogTitle && d.ogImage ? 'ok' : 'warn', 'Social share (Open Graph)', d.ogImage ? 'og:title + og:image' : 'No og:image', 'Add og:title, og:description and og:image (1200×630) so WhatsApp / Facebook show a card.');
    add(d.twCard ? 'ok' : 'warn', 'Twitter / X card', d.twCard || 'Missing', 'Add <meta name="twitter:card" content="summary_large_image">.');
    add(d.ld ? 'ok' : 'warn', 'Structured data (JSON-LD)', d.ld ? `${d.ld} block${d.ld > 1 ? 's' : ''}` : 'None', 'Add JSON-LD (WebSite / SoftwareApplication / FAQPage) for rich results.');
    add(d.icon ? 'ok' : 'warn', 'Favicon', d.icon ? 'Yes' : 'Missing', 'Add <link rel="icon">.');
    add(!d.noAlt ? 'ok' : 'warn', 'Image alt text', d.imgs ? `${d.imgs - d.noAlt} of ${d.imgs} images have alt` : 'No images in the HTML', 'Give every <img> an alt text.');
    add(d.words >= 250 ? 'ok' : 'warn', 'Text in the HTML', `${num(d.words)} words`, 'Little text in the HTML (often a JavaScript app). Add real text — what the tool does, how to use it, FAQs — Google and AdSense need it.');
    add(d.tracker ? 'ok' : 'warn', 'CodeLove Analytics tracker', d.tracker ? 'Installed' : 'Missing', 'Add <script defer src="https://admin.codelove.in/t.js"></script> to <head>.');
    add(d.ga ? 'ok' : 'warn', 'Google Analytics tag', d.ga ? 'Installed' : 'Not found', 'Add the GA4 gtag snippet if you want GA data for this site.');
    add(d.adsense ? 'ok' : 'warn', 'AdSense code', d.adsense ? 'Installed' : 'Not found', 'Add the AdSense code from AdSense → Setup.');
    const w = { ok: 1, warn: 0.5, fix: 0 };
    const score = Math.round((C.reduce((a, c) => a + w[c.lvl], 0) / C.length) * 100);
    return { d, C, score };
  }

  const LVL = { fix: ['Fix', 'none', 'x'], warn: ['Improve', 'p23', 'alert'], ok: ['OK', 'p1', 'check'] };
  const scorePill = (s) => `<span class="score ${s >= 85 ? 'good' : s >= 60 ? 'mid' : 'bad'}">${s}</span>`;
  const checkList = (C, onlyBad = false) => `<ul class="chk">${C.filter((c) => !onlyBad || c.lvl !== 'ok').map((c) => `<li class="chk-${c.lvl}">${icon(LVL[c.lvl][2])}<div><b>${esc(c.label)}</b><span class="chk-v">${esc(c.value)}</span>${c.lvl !== 'ok' && c.fix ? `<span class="chk-fix">${esc(c.fix)}</span>` : ''}</div></li>`).join('')}</ul>`;

  // ---------- Site health ----------
  const health = new Map(); // host -> promise
  function checkHost(host) {
    if (!health.has(host)) health.set(host, (async () => {
      // home page first and alone, so its response time isn't inflated by the other requests
      const home = await grab(`https://${host}/`, 15e3);
      const [robots, sitemap] = await Promise.all([grab(`https://${host}/robots.txt`, 15e3), grab(`https://${host}/sitemap.xml`, 15e3)]);
      const a = audit(home);
      const locs = (sitemap.text.match(/<loc>/gi) || []).length;
      a.C.push(
        { lvl: robots.ok ? (/^\s*sitemap:/im.test(robots.text) ? 'ok' : 'warn') : 'warn', label: 'robots.txt', value: robots.ok ? (/^\s*sitemap:/im.test(robots.text) ? 'OK, lists the sitemap' : 'No "Sitemap:" line') : `HTTP ${robots.status || 'error'}`, fix: `Add robots.txt with "Sitemap: https://${host}/sitemap.xml".` },
        { lvl: sitemap.ok && locs ? 'ok' : 'fix', label: 'sitemap.xml', value: sitemap.ok ? `${num(locs)} URLs` : `HTTP ${sitemap.status || 'error'}`, fix: 'Add sitemap.xml listing every public page, then submit it in Search Console.' },
      );
      const w = { ok: 1, warn: 0.5, fix: 0 };
      if (home.ok) a.score = Math.round((a.C.reduce((s, c) => s + w[c.lvl], 0) / a.C.length) * 100);
      return { host, home, ...a, locs };
    })());
    return health.get(host);
  }

  async function viewHealth(alive, site) {
    const hosts = site ? [site] : SITES;
    paint(pageHead(EYEBROW, 'Site health', `${hosts.length} site${hosts.length > 1 ? 's' : ''} checked live: speed, SEO tags, social cards, robots.txt, sitemap.xml, tracker, AdSense`,
      `<div class="ph-actions"><button type="button" class="btn" id="hRe">${icon('refresh')}Check again</button></div>`)
      + `<div class="stat-grid" id="hStats"></div><section class="card dash-sites"><div class="tbl"><p class="empty ad-wait"><span class="spinner"></span>Checking ${hosts.length} sites…</p></div></section>`, false);
    $('#hRe').onclick = () => { health.clear(); rerender(); };
    // 3 sites at a time: 13 × 3 requests at once would queue in the browser and look slow / time out
    const rows = new Array(hosts.length);
    let next = 0, done = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < hosts.length) {
        const i = next++;
        rows[i] = await checkHost(hosts[i]);
        const w = $('.ad-wait'); if (w && alive()) w.innerHTML = `<span class="spinner"></span>Checking ${hosts.length} sites… ${++done} done`;
      }
    }));
    if (!alive()) return;
    const up = rows.filter((r) => r.home.ok).length;
    const avg = Math.round(rows.filter((r) => r.home.ok).reduce((a, r) => a + r.home.ms, 0) / Math.max(1, up));
    const fixes = rows.reduce((a, r) => a + r.C.filter((c) => c.lvl === 'fix').length, 0);
    const avgScore = Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length);
    $('#hStats').innerHTML = [
      ['Sites up', `${up} / ${rows.length}`, up === rows.length ? 'all answering' : 'some are down', up === rows.length ? 'good' : 'bad'],
      ['Avg response', `${num(avg)} ms`, 'home page HTML', avg > 1200 ? 'bad' : ''],
      ['Health score', `${avgScore}`, 'average of all checks', avgScore >= 85 ? 'good' : ''],
      ['To fix', num(fixes), 'checks failing', fixes ? 'bad' : 'good'],
    ].map(([l, v, s, c]) => `<div class="stat${c ? ' ' + c : ''}"><span class="stat-label">${l}</span><span class="stat-value">${v}</span><span class="stat-sub">${s}</span></div>`).join('');
    CL.table($('.dash-sites .tbl'), [
      { key: 'name', label: 'Site', html: (r) => `<a class="site-cell" href="https://${esc(r.host)}/" target="_blank" rel="noopener">${favicon(r.host)}<span><b>${esc(nameOf(r.host))}</b><span class="note block">${esc(r.host)}</span></span></a>` },
      { key: 'score', label: 'Score', num: true, html: (r) => scorePill(r.score) },
      { key: 'status', label: 'Status', num: true, html: (r) => (r.home.ok ? `<span class="gp p1">${r.home.status}</span>` : `<span class="gp none">${r.home.timeout ? 'Timeout' : r.home.status || 'Down'}</span>`) },
      { key: 'ms', label: 'Load time', num: true, lowFirst: true, html: (r) => (r.home.ok ? `<span class="${r.home.ms > 1200 ? 'delta down' : ''}">${num(r.home.ms)} ms</span>` : '–') },
      { key: 'locs', label: 'Sitemap URLs', num: true, fmt: num },
      { key: 'fixN', label: 'To fix', num: true, html: (r) => (r.fixN ? `<span class="gp none">${r.fixN}</span>` : '<span class="muted">0</span>') },
      { key: 'warnN', label: 'To improve', num: true, html: (r) => (r.warnN ? `<span class="gp p23">${r.warnN}</span>` : '<span class="muted">0</span>') },
    ], rows.map((r) => ({ ...r, name: nameOf(r.host), status: r.home.status, ms: r.home.ok ? r.home.ms : 99999, fixN: r.C.filter((c) => c.lvl === 'fix').length, warnN: r.C.filter((c) => c.lvl === 'warn').length })), {
      sort: 'score', asc: true, pageSize: 100,
      rowKey: (r) => r.host,
      expand: (r) => `<div class="h-detail">${checkList(r.C)}<p class="note"><a href="${CL.link({ src: 'tools', tab: 'checker' })}?url=${encodeURIComponent('https://' + r.host + '/')}">Open in Page checker →</a></p></div>`,
    });
    $('.dash-sites').insertAdjacentHTML('afterend', '<p class="note">Click a row to see every check with what to do. Words / H1 are read from the HTML Google first receives; apps that build the page with JavaScript show fewer.</p>');
  }

  // ---------- Page checker ----------
  async function viewChecker(alive, params) {
    const url = (params.get('url') || '').trim();
    const form = `<section class="card"><form class="tool-form" id="pcForm"><label class="grow">Page URL<input type="url" name="url" required placeholder="https://models.codelove.in/" value="${esc(url)}" list="pcSites"></label><datalist id="pcSites">${SITES.map((h) => `<option value="https://${esc(h)}/">`).join('')}</datalist><button class="btn primary" type="submit">${icon('search')}Check page</button></form><p class="note">Works for every *.codelove.in page (other websites usually block reading their HTML from a browser).</p></section>`;
    let ph = ''; try { ph = new URL(url).hostname; } catch { /* ignore */ }
    const crumb = ph ? `<a class="crumb" href="${CL.link({ src: 'tools', tab: 'checker', site: ph })}">← All pages of ${esc(nameOf(ph))}</a>` : '';
    paint(crumb + pageHead(EYEBROW, 'Page checker', 'SEO audit of one page, with the Google result and social share previews') + form, false);
    $('#pcForm').onsubmit = (e) => { e.preventDefault(); location.hash = `${CL.link({ src: 'tools', tab: 'checker' })}?url=${encodeURIComponent(e.target.url.value.trim())}`; };
    if (!url) return;
    app.insertAdjacentHTML('beforeend', '<p class="empty ad-wait" id="pcWait"><span class="spinner"></span>Reading the page…</p>');
    const res = await grab(url);
    if (!alive()) return;
    $('#pcWait')?.remove();
    const { d, C, score } = audit(res);
    if (!res.ok) { app.insertAdjacentHTML('beforeend', `<section class="card">${checkList(C)}</section>`); return; }
    let u; try { u = new URL(res.url); } catch { u = { hostname: '', pathname: '' }; }
    const crumbs = `${u.hostname}${u.pathname.replace(/\/$/, '').split('/').filter(Boolean).map((p) => ' › ' + p).join('')}`;
    let img = d.ogImage; try { if (img) img = new URL(img, res.url).href; } catch { /* ignore */ }
    app.insertAdjacentHTML('beforeend', `
      <div class="grid2">
        <section class="card"><div class="card-head"><h2>Score</h2>${scorePill(score)}</div>
          <div class="mini-stats">${[['Words', num(d.words)], ['Links', `${num(d.internal)} in · ${num(d.external)} out`], ['Images', `${num(d.imgs)} (${num(d.noAlt)} no alt)`]].map(([l, v]) => `<div class="stat"><span class="stat-label">${l}</span><span class="stat-value">${v}</span></div>`).join('')}</div>
          ${checkList(C)}</section>
        <div>
          <section class="card"><div class="card-head"><h2>Google result preview</h2></div>
            <div class="serp"><div class="serp-site">${favicon(u.hostname)}<span><b>${esc(nameOf(u.hostname))}</b><span>${esc(crumbs)}</span></span></div>
            <div class="serp-title">${esc((d.title || 'No title').slice(0, 65))}${d.title.length > 65 ? '…' : ''}</div>
            <div class="serp-desc">${esc((d.desc || 'No meta description: Google will pick text from the page.').slice(0, 160))}${d.desc.length > 160 ? '…' : ''}</div></div></section>
          <section class="card"><div class="card-head"><h2>Share card preview</h2><span class="note">WhatsApp / Facebook / X</span></div>
            <div class="og">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="og-none">No og:image — links shared on WhatsApp show no picture</div>'}
            <div class="og-body"><span>${esc(u.hostname)}</span><b>${esc(d.ogTitle || d.title || '')}</b><p>${esc(d.ogDesc || d.desc || '')}</p></div></div></section>
          <section class="card"><div class="card-head"><h2>Headings</h2><span class="note">H1–H3 in the HTML</span></div>
            ${d.h.length ? `<ul class="hlist">${d.h.map((x) => `<li class="hl${x.l}"><span>H${x.l}</span>${esc(x.t.slice(0, 120))}</li>`).join('')}</ul>` : '<p class="empty">No headings in the HTML.</p>'}</section>
        </div>
      </div>`);
  }

  // ---------- PageSpeed (Lighthouse) ----------
  const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const psiKey = (host, strat) => `${host}|${strat}`;
  const psiStore = () => { try { return JSON.parse(store.get('cl_psi') || '{}'); } catch { return {}; } };
  const psiSave = (all) => store.set('cl_psi', JSON.stringify(all));
  async function runPsi(host, strat) {
    const q = new URLSearchParams({ url: `https://${host}/`, strategy: strat });
    ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'].forEach((c) => q.append('category', c));
    if (CFG.pagespeedKey) q.set('key', CFG.pagespeedKey);
    const r = await fetch(`${PSI}?${q}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
    const L = j.lighthouseResult || {}, cat = L.categories || {}, au = L.audits || {};
    const sc = (k) => (cat[k] && cat[k].score != null ? Math.round(cat[k].score * 100) : null);
    const out = {
      at: Date.now(), perf: sc('performance'), a11y: sc('accessibility'), bp: sc('best-practices'), seo: sc('seo'),
      lcp: au['largest-contentful-paint']?.displayValue || '', cls: au['cumulative-layout-shift']?.displayValue || '', tbt: au['total-blocking-time']?.displayValue || '', fcp: au['first-contentful-paint']?.displayValue || '',
      opps: Object.values(au).filter((a) => a.details && a.details.type === 'opportunity' && a.score != null && a.score < 0.9).sort((a, b) => (b.details.overallSavingsMs || 0) - (a.details.overallSavingsMs || 0)).slice(0, 5).map((a) => ({ t: a.title, v: a.displayValue || '' })),
    };
    const all = psiStore(); all[psiKey(host, strat)] = out; psiSave(all);
    return out;
  }
  let psiRunning = false;
  function viewSpeed(alive, site, params) {
    const strat = params.get('s') === 'desktop' ? 'desktop' : 'mobile';
    const hosts = site ? [site] : SITES;
    const draw = () => {
      const all = psiStore();
      const rows = hosts.map((h) => ({ host: h, name: nameOf(h), ...(all[psiKey(h, strat)] || {}) }));
      const cell = (v) => (v == null ? '<span class="muted">–</span>' : scorePill(v));
      CL.table($('#psiTbl'), [
        { key: 'name', label: 'Site', html: (r) => `<span class="site-cell">${favicon(r.host)}<span><b>${esc(r.name)}</b><span class="note block">${r.at ? 'tested ' + new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'not tested yet'}</span></span></span>` },
        { key: 'perf', label: 'Performance', num: true, html: (r) => cell(r.perf) },
        { key: 'a11y', label: 'Accessibility', num: true, html: (r) => cell(r.a11y) },
        { key: 'bp', label: 'Best practices', num: true, html: (r) => cell(r.bp) },
        { key: 'seo', label: 'SEO', num: true, html: (r) => cell(r.seo) },
        { key: 'lcp', label: 'LCP', html: (r) => esc(r.lcp || '–') },
        { key: 'act', label: '', html: (r) => `<button type="button" class="btn sm psi-one" data-h="${esc(r.host)}">${icon('refresh')}Test</button>` },
      ], rows, {
        sort: 'name', asc: true, pageSize: 100, rowKey: (r) => r.host,
        expand: (r) => (r.at ? `<div class="h-detail"><p><b>FCP</b> ${esc(r.fcp)} · <b>LCP</b> ${esc(r.lcp)} · <b>TBT</b> ${esc(r.tbt)} · <b>CLS</b> ${esc(r.cls)}</p>${r.opps && r.opps.length ? `<div class="rs-sub">Biggest speed-ups</div><ul class="ix-list">${r.opps.map((o) => `<li><b>${esc(o.t)}</b><span class="muted">${esc(o.v)}</span></li>`).join('')}</ul>` : '<p class="empty">No big speed-ups suggested.</p>'}<p class="note"><a href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent('https://' + r.host + '/')}" target="_blank" rel="noopener">Full report on pagespeed.web.dev →</a></p></div>` : '<p class="empty">Press Test to run Lighthouse for this site.</p>'),
      });
    };
    paint(pageHead(EYEBROW, 'PageSpeed', `Google Lighthouse scores · ${strat} · results are kept on this browser`,
      `<div class="ph-actions"><div class="seg">${['mobile', 'desktop'].map((s) => `<a class="seg-b${s === strat ? ' on' : ''}" href="${CL.link({ src: 'tools', tab: 'speed', site })}${s === 'desktop' ? (site ? '&' : '?') + 's=desktop' : ''}">${s === 'mobile' ? 'Mobile' : 'Desktop'}</a>`).join('')}</div><button type="button" class="btn primary" id="psiAll"${psiRunning ? ' disabled' : ''}>${icon('refresh')}Test ${site ? 'this site' : 'all sites'}</button></div>`)
      + '<div id="psiMsg"></div><section class="card dash-sites"><div id="psiTbl"></div></section><p class="note">Each test takes 10–30 s (Google runs it on its servers). Scores: 90+ good, 50–89 needs work, under 50 poor. Click a row for details.</p>', false);
    draw();
    const msg = (t, err) => { const m = $('#psiMsg'); if (m) m.innerHTML = t ? `<div class="${err ? 'error' : 'banner'}">${icon(err ? 'alert' : 'info')}<div>${t}</div></div>` : ''; };
    const run = async (list) => {
      if (psiRunning) return; psiRunning = true;
      const b = $('#psiAll'); if (b) b.disabled = true;
      let done = 0;
      for (const h of list) {
        if (!alive()) break;
        msg(`<span class="spinner"></span> Testing ${esc(h)} (${done + 1} of ${list.length})…`);
        try { await runPsi(h, strat); } catch (e) {
          msg(`${esc(h)}: ${esc(e.message)}${/quota|rate/i.test(e.message) ? '<div class="note">Google limits tests without an API key. Wait a minute, or add <code>pagespeedKey</code> (a free Google Cloud API key) in config.js.</div>' : ''}`, true);
          psiRunning = false; if (alive()) draw(); const bb = $('#psiAll'); if (bb) bb.disabled = false; return;
        }
        done++; if (alive()) draw();
      }
      psiRunning = false; if (alive()) { msg(''); const bb = $('#psiAll'); if (bb) bb.disabled = false; }
    };
    $('#psiAll').onclick = () => run(hosts);
    $('#psiTbl').addEventListener('click', (e) => { const b = e.target.closest('.psi-one'); if (b) { e.stopPropagation(); run([b.dataset.h]); } });
  }

  // ---------- UTM link builder ----------
  const PRESETS = [
    ['YouTube description', 'youtube', 'video'], ['YouTube Shorts', 'youtube', 'shorts'], ['Instagram bio', 'instagram', 'bio'], ['Instagram story', 'instagram', 'story'],
    ['WhatsApp', 'whatsapp', 'share'], ['Facebook post', 'facebook', 'social'], ['X / Twitter', 'twitter', 'social'], ['Email', 'newsletter', 'email'],
  ];
  function viewUtm() {
    const saved = (() => { try { return JSON.parse(store.get('cl_utm') || '{}'); } catch { return {}; } })();
    paint(pageHead(EYEBROW, 'UTM link builder', 'Tagged links show where visitors came from (Google Analytics → Traffic sources)')
      + `<div class="grid2"><section class="card"><form class="tool-form col" id="utmForm">
          <label>Page<select name="site">${SITES.map((h) => `<option value="${esc(h)}"${saved.site === h ? ' selected' : ''}>${esc(nameOf(h))} — ${esc(h)}</option>`).join('')}</select></label>
          <label>Path <span class="muted">(optional)</span><input name="path" placeholder="/" value="${esc(saved.path || '')}"></label>
          <div class="rs-sub">Where you share it</div>
          <div class="chips">${PRESETS.map(([l, s, m], i) => `<button type="button" class="chip" data-i="${i}">${esc(l)}</button>`).join('')}</div>
          <label>Source <span class="muted">utm_source</span><input name="source" required placeholder="youtube" value="${esc(saved.source || '')}"></label>
          <label>Medium <span class="muted">utm_medium</span><input name="medium" required placeholder="video" value="${esc(saved.medium || '')}"></label>
          <label>Campaign <span class="muted">utm_campaign</span><input name="campaign" placeholder="tamil-short-12" value="${esc(saved.campaign || '')}"></label>
          <label>Content <span class="muted">utm_content (optional)</span><input name="content" placeholder="pinned-comment" value="${esc(saved.content || '')}"></label>
        </form></section>
        <section class="card"><div class="card-head"><h2>Your link</h2></div><pre class="code utm-out" id="utmOut"></pre>
          <div class="ph-actions"><button type="button" class="btn primary" id="utmCopy">${icon('copy')}Copy link</button><a class="btn" id="utmOpen" target="_blank" rel="noopener">${icon('ext')}Open</a></div>
          <p class="note">Use lowercase and dashes. The same campaign name across videos lets you compare them in Google Analytics.</p></section></div>`, false);
    const f = $('#utmForm');
    const build = () => {
      const v = Object.fromEntries(new FormData(f));
      store.set('cl_utm', JSON.stringify(v));
      const u = new URL(`https://${v.site}${(v.path || '/').startsWith('/') ? v.path || '/' : '/' + v.path}`);
      const clean = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '-');
      [['utm_source', v.source], ['utm_medium', v.medium], ['utm_campaign', v.campaign], ['utm_content', v.content]].forEach(([k, x]) => { if (clean(x)) u.searchParams.set(k, clean(x)); });
      $('#utmOut').textContent = u.href; $('#utmOpen').href = u.href;
    };
    f.addEventListener('input', build);
    $$('.chip', f).forEach((b) => b.addEventListener('click', () => { const [, s, m] = PRESETS[+b.dataset.i]; f.source.value = s; f.medium.value = m; $$('.chip', f).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); build(); }));
    $('#utmCopy').onclick = async (e) => { const t = $('#utmOut').textContent; try { await navigator.clipboard.writeText(t); } catch { /* ignore */ } e.currentTarget.innerHTML = `${icon('check')}Copied`; setTimeout(() => { const b = $('#utmCopy'); if (b) b.innerHTML = `${icon('copy')}Copy link`; }, 2000); };
    build();
  }

  // ---------- Quick links ----------
  function viewLinks() {
    const L = (href, label, sub = '') => `<a class="ql" href="${esc(href)}" target="_blank" rel="noopener"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}${icon('ext')}</a>`;
    const consoles = [
      ['https://search.google.com/search-console', 'Search Console', 'indexing, sitemaps, keywords'],
      ['https://analytics.google.com/', 'Google Analytics', 'GA4 properties'],
      ['https://adsense.google.com/', 'AdSense', 'earnings, sites, ads'],
      ['https://console.firebase.google.com/project/codelove-analytics/firestore', 'Firebase · Firestore', 'CodeLove Analytics data'],
      ['https://console.cloud.google.com/apis/dashboard', 'Google Cloud APIs', 'enable APIs, OAuth client'],
      ['https://github.com/Gowtham-Raj-Dev?tab=repositories', 'GitHub repos', 'code + Pages deploys'],
      ['https://www.bing.com/webmasters', 'Bing Webmaster', 'Bing + IndexNow'],
      ['https://pagespeed.web.dev/', 'PageSpeed Insights', 'full Lighthouse reports'],
      ['https://search.google.com/test/rich-results', 'Rich Results Test', 'structured data'],
      ['https://www.whatsmydns.net/', 'DNS checker', 'CNAME / propagation'],
    ];
    paint(pageHead(EYEBROW, 'Quick links', 'Every console, and per-site test tools, in one place')
      + `<section class="card"><div class="card-head"><h2>Consoles</h2></div><div class="ql-grid">${consoles.map(([h, l, s]) => L(h, l, s)).join('')}</div></section>`
      + `<div class="tk-grid">${SITES.map((h) => {
        const u = `https://${h}/`, e = encodeURIComponent(u);
        return `<section class="card ql-site"><div class="tk-head"><span class="tk-title">${favicon(h)}<span><b>${esc(nameOf(h))}</b><span class="note">${esc(h)}</span></span></span></div>
          <div class="ql-mini">${[
            [u, 'Open site'], [`${u}sitemap.xml`, 'sitemap.xml'], [`${u}robots.txt`, 'robots.txt'], [`https://www.google.com/search?q=site%3A${encodeURIComponent(h)}`, 'site: search'],
            [`https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent('sc-domain:codelove.in')}&id=${e}`, 'URL Inspection'],
            [`https://pagespeed.web.dev/analysis?url=${e}`, 'PageSpeed'], [`https://search.google.com/test/rich-results?url=${e}`, 'Rich results'],
            [`https://developers.facebook.com/tools/debug/?q=${e}`, 'Share preview'],
          ].map(([hh, l]) => `<a href="${esc(hh)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}
          <a href="${CL.link({ src: 'tools', tab: 'checker' })}?url=${e}">Page checker</a></div></section>`;
      }).join('')}</div>`, false);
  }

  async function route(ctx) {
    const { alive, site, tab, params } = ctx;
    if (tab === 'checker' && !params.get('url')) await TOOLS2.pages(ctx); // every page of the site, Check per page / all
    else if (tab === 'broken') await TOOLS2.broken(ctx);
    else if (tab === 'uptime') TOOLS2.uptimeView(ctx);
    else if (tab === 'ranks') await TOOLS2.ranks(ctx);
    else if (tab === 'checker') await viewChecker(alive, params);
    else if (tab === 'speed') viewSpeed(alive, site, params);
    else if (tab === 'utm') viewUtm();
    else if (tab === 'links') viewLinks();
    else await viewHealth(alive, site);
  }
  window.TOOLS = { route, clear: () => { health.clear(); if (window.TOOLS2) TOOLS2.clear(); }, stop: () => {}, lib: { grab, audit, checkList, scorePill, nameOf } };
})();
