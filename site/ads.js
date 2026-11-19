/* AdSense section: AdSense Management API v2, read in the browser with the owner's Google login
 * (scope adsense.readonly, asked the first time this section opens; same token as GA + Search Console).
 *   #/adsense         Overview: account, alerts, earnings chart, earnings per site, payments
 *   #/adsense/sites   Sites & approval: AdSense status of codelove.in + a live check of every site
 *                     (ads.txt, AdSense code, policy pages) with what to do
 *   #/adsense/setup   Setup: the exact code / ads.txt line for this account + how to apply
 * AdSense approves the top-level domain (codelove.in); its subdomains are covered by that approval. */
(() => {
  'use strict';
  const { $, $$, num, compact, pct, pctAxis, esc, div, iso, parseIso, addDays, rangeText, kpiChart, deltaHtml, table, favicon, icon, pageHead, loading, paint, el, gAuth, gGate, gReconnect, gSignIn } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const SCOPE = CL.ADS_SCOPE;
  const API = 'https://adsense.googleapis.com/v2';
  const PROJECT = (CFG.clientId || '').split('-')[0];
  const ENABLE_URL = `https://console.cloud.google.com/apis/library/adsense.googleapis.com?project=${encodeURIComponent(PROJECT)}`;
  const ADSENSE = 'https://adsense.google.com/adsense/u/0';
  const ROOT = 'codelove.in'; // the domain AdSense reviews; every *.codelove.in site is covered by it
  const SITES = CFG.sites || [];
  const NAMES = CFG.siteNames || {};
  const nameOf = (h) => NAMES[h] || h.split('.')[0];
  const app = $('#app');
  const EYEBROW = 'AdSense';

  // ---------- API ----------
  const cache = new Map();
  async function api(url, retried = false) {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + gAuth.token() } });
    if (res.status === 401 && !retried) { gAuth.expire(); await gAuth.renew(); return api(url, true); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    return json;
  }
  function cached(key, fn) {
    if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
    return cache.get(key);
  }
  const list = (url, key) => cached(url, async () => {
    const out = []; let tok = '';
    do {
      const j = await api(`${url}${url.includes('?') ? '&' : '?'}pageSize=200${tok ? '&pageToken=' + encodeURIComponent(tok) : ''}`);
      out.push(...(j[key] || []));
      tok = j.nextPageToken || '';
    } while (tok);
    return out;
  });

  async function getAccount() {
    const accs = await list(`${API}/accounts`, 'accounts');
    // more than one (rare): prefer an open one
    return accs.find((a) => a.state !== 'CLOSED') || accs[0] || null;
  }
  const pubOf = (acc) => (acc ? acc.name.split('/')[1] : (CFG.adsensePublisherId || '').replace(/^ca-/, ''));

  const dp = (k, d) => { const [y, m, dd] = d.split('-'); return `${k}.year=${+y}&${k}.month=${+m}&${k}.day=${+dd}`; };
  const METRICS = ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS', 'CLICKS'];
  async function report(acc, start, end, dims = [], filter = '') {
    const q = ['dateRange=CUSTOM', dp('startDate', start), dp('endDate', end), ...dims.map((d) => 'dimensions=' + d), ...METRICS.map((m) => 'metrics=' + m), 'reportingTimeZone=ACCOUNT_TIME_ZONE'];
    if (filter) q.push('filters=' + encodeURIComponent(filter));
    const j = await cached('r|' + q.join('&'), () => api(`${API}/${acc.name}/reports:generate?${q.join('&')}`));
    const heads = (j.headers || []).map((h) => h.name);
    const currency = (j.headers || []).find((h) => h.currencyCode)?.currencyCode || 'INR';
    const obj = (cells) => Object.fromEntries((cells || []).map((c, i) => [heads[i], c.value]));
    const n = (o) => ({ e: Number(o.ESTIMATED_EARNINGS) || 0, v: Number(o.PAGE_VIEWS) || 0, i: Number(o.IMPRESSIONS) || 0, c: Number(o.CLICKS) || 0 });
    return {
      currency,
      rows: (j.rows || []).map((r) => { const o = obj(r.cells); return { ...o, ...n(o) }; }),
      totals: n(obj(j.totals && j.totals.cells)),
    };
  }
  const money = (v, cur) => { try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: v && Math.abs(v) < 10 ? 2 : 0 }).format(v || 0); } catch { return (v || 0).toFixed(2) + ' ' + cur; } };
  const rpm = (t) => div(t.e * 1000, t.v);
  const ctr = (t) => div(t.c, t.v);
  const ymd = (d) => (d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : '');
  const fmtYmd = (d) => (d ? new Date(d.year, d.month - 1, d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  // ---------- live check of a site (its own HTML + ads.txt; GitHub Pages allows cross-origin reads) ----------
  async function fetchText(url) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10e3);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' };
    } catch (e) { return { ok: false, status: 0, text: '', blocked: true }; } finally { clearTimeout(t); }
  }
  const checks = new Map();
  function checkSite(host, pub) {
    const key = host + '|' + pub;
    if (!checks.has(key)) checks.set(key, (async () => {
      const [home, ads] = await Promise.all([fetchText(`https://${host}/`), host === ROOT ? fetchText(`https://${host}/ads.txt`) : Promise.resolve(null)]);
      const h = home.text.toLowerCase();
      const has = (re) => re.test(h);
      return {
        host, reachable: home.ok, blocked: home.blocked,
        code: !!pub && h.includes(pub.toLowerCase()) && has(/adsbygoogle|google-adsense-account/),
        codeOther: !pub && has(/ca-pub-\d+/),
        meta: has(/name=["']google-adsense-account["']/),
        privacy: has(/href=["'][^"']*privacy/), about: has(/href=["'][^"']*about/), contact: has(/href=["'][^"']*contact/), terms: has(/href=["'][^"']*(terms|conditions)/),
        adsTxt: ads ? { ok: ads.ok, blocked: ads.blocked, status: ads.status, line: !!pub && ads.text.toLowerCase().includes(pub.toLowerCase()) && /google\.com/i.test(ads.text) } : null,
      };
    })());
    return checks.get(key);
  }

  // ---------- building blocks ----------
  const STATE = {
    READY: ['Ready', 'p1', 'Approved: ads can show on this domain and its subdomains.'],
    GETTING_READY: ['Getting ready', 'p23', 'Google is reviewing the site. This usually takes a few days, sometimes 2–4 weeks.'],
    REQUIRES_REVIEW: ['Requires review', 'p23', 'The site is added but the review has not been requested yet (or ownership is not verified).'],
    NEEDS_ATTENTION: ['Needs attention', 'none', 'Google found a problem. Open AdSense → Sites to see it, fix it, then request review again.'],
    NONE: ['Not added', 'deep', 'This domain is not in your AdSense account yet.'],
  };
  const statePill = (s) => { const x = STATE[s] || STATE.NONE; return `<span class="gp ${x[1]}">${x[0]}</span>`; };
  const okPill = (v, yes = 'Yes', no = 'Missing') => (v == null ? '<span class="gp deep">–</span>' : v ? `<span class="gp p1">${yes}</span>` : `<span class="gp none">${no}</span>`);
  const tile = (label, value, sub = '', cls = '') => `<div class="stat${cls ? ' ' + cls : ''}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-sub">${sub}</span></div>`;
  const copyBox = (id, label, code) => `<div class="copy-box"><div class="cb-head"><b>${label}</b><button type="button" class="btn sm" data-copy="${id}">${icon('copy')}Copy</button></div><pre class="code" id="${id}">${esc(code)}</pre></div>`;
  function wireCopy(root = app) {
    root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const text = $('#' + b.dataset.copy).textContent;
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = Object.assign(document.createElement('textarea'), { value: text }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      b.innerHTML = `${icon('check')}Copied`; setTimeout(() => { b.innerHTML = `${icon('copy')}Copy`; }, 2000);
    }));
  }
  const snippets = (pub) => ({
    head: `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${pub}" crossorigin="anonymous"></script>`,
    meta: `<meta name="google-adsense-account" content="ca-${pub}">`,
    adsTxt: `google.com, ${pub}, DIRECT, f08c47fec0942fa0`,
  });
  const steps = (arr) => `<ol class="ad-steps">${arr.map((s) => `<li>${s}</li>`).join('')}</ol>`;

  function noAccount() {
    paint(pageHead(EYEBROW, 'No AdSense account on this Google login', '')
      + `<section class="card state-card"><span class="state-ic neutral">${icon('coin')}</span><h2>Sign up for AdSense first</h2>
        <p>The Google account connected here${gAuth.email() ? ` (<b>${esc(gAuth.email())}</b>)` : ''} has no AdSense account. Sign up with this same account, then come back.</p>
        <div class="state-actions"><a class="btn primary" href="https://adsense.google.com/start/" target="_blank" rel="noopener">${icon('ext')}Open AdSense sign-up</a></div></section>`, false);
  }

  // ---------- views ----------
  async function viewOverview(R, alive, site) {
    const acc = await getAccount();
    if (!alive()) return;
    if (!acc) { noAccount(); return; }
    const filter = site ? `DOMAIN_NAME==${site}` : '';
    const [cur, prev, byDay, byDomain, alerts, payments, sites] = await Promise.all([
      report(acc, R.start, R.end, [], filter), report(acc, R.prevStart, R.prevEnd, [], filter),
      report(acc, R.start, R.end, ['DATE'], filter), site ? null : report(acc, R.start, R.end, ['DOMAIN_NAME']),
      list(`${API}/${acc.name}/alerts`, 'alerts').catch(() => []), list(`${API}/${acc.name}/payments`, 'payments').catch(() => []),
      list(`${API}/${acc.name}/sites`, 'sites').catch(() => []),
    ]);
    if (!alive()) return;
    const C = cur.currency, c = cur.totals, p = prev.totals;
    const pub = pubOf(acc);
    const rootSite = sites.find((s) => s.domain === ROOT);
    const unpaid = payments.find((x) => /\/unpaid$/.test(x.name));
    const paid = payments.filter((x) => !/\/unpaid$/.test(x.name)).sort((a, b) => ymd(b.date).localeCompare(ymd(a.date)));

    const head = pageHead(EYEBROW, site ? `${favicon(site)}${esc(site)}` : 'Overview', `${rangeText(R)} · ${esc(acc.displayName || pub)} · ${esc(pub)}`,
      `<div class="ph-actions"><a class="btn" href="${ADSENSE}/${esc(pub)}/home" target="_blank" rel="noopener">${icon('ext')}Open AdSense</a></div>`);
    const banners = [
      acc.state && acc.state !== 'READY' ? `<div class="banner warn">${icon('alert')}<div><b>Account status: ${esc(acc.state.replace(/_/g, ' ').toLowerCase())}.</b> Open AdSense to see what it needs.</div></div>` : '',
      ...(acc.pendingTasks || []).map((t) => `<div class="banner warn">${icon('alert')}<div><b>To do in AdSense:</b> ${esc(t)}</div></div>`),
      ...alerts.map((a) => `<div class="banner${a.severity === 'SEVERE' || a.severity === 'WARNING' ? ' warn' : ''}">${icon(a.severity === 'INFO' ? 'info' : 'alert')}<div>${esc(a.message || a.type)}</div></div>`),
      rootSite && rootSite.state !== 'READY' ? `<div class="banner">${icon('info')}<div><b>${ROOT}: ${STATE[rootSite.state]?.[0] || rootSite.state}.</b> ${STATE[rootSite.state]?.[2] || ''} <a href="${CL.link({ src: 'ads', tab: 'sites' })}">See approval checklist →</a></div></div>` : '',
      !rootSite ? `<div class="banner">${icon('info')}<div><b>${ROOT} is not added to AdSense yet.</b> <a href="${CL.link({ src: 'ads', tab: 'setup' })}">How to apply →</a></div></div>` : '',
    ].join('');

    paint(head + banners
      + `<div class="stat-grid">
          ${tile('Balance (unpaid)', unpaid ? esc(unpaid.amount) : money(0, C), 'paid out after it reaches the threshold')}
          ${tile('Last payment', paid[0] ? esc(paid[0].amount) : '–', paid[0] ? fmtYmd(paid[0].date) : 'no payment yet')}
          ${tile('Account', esc((acc.state || 'unknown').replace(/_/g, ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase())), `${esc(acc.timeZone?.id || '')}${acc.createTime ? ' · since ' + new Date(acc.createTime).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : ''}`, acc.state === 'READY' ? 'good' : '')}
          ${tile(ROOT, rootSite ? (STATE[rootSite.state]?.[0] || rootSite.state) : 'Not added', rootSite ? (rootSite.autoAdsEnabled ? 'Auto ads on' : 'Auto ads off') : 'add it in AdSense → Sites', rootSite && rootSite.state === 'READY' ? 'good' : '')}
        </div>`);

    // earnings chart (estimated earnings, page views, RPM, impressions, clicks, CTR per day)
    const by = new Map(byDay.rows.map((r) => [r.DATE, r]));
    const pts = [];
    for (let d = parseIso(R.start); d <= parseIso(R.end); d = addDays(d, 1)) {
      const k = iso(d), r = by.get(k) || { e: 0, v: 0, i: 0, c: 0 };
      pts.push({ iso: k, label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), short: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), e: r.e, v: r.v, i: r.i, c: r.c, rpm: rpm(r), ctr: ctr(r) });
    }
    const m = (v) => money(v, C);
    app.append(kpiChart({
      storeKey: 'cl_ads_metric', unit: 'day', pts,
      summary: (x) => `${m(x.e)} · ${num(x.v)} page views · ${num(x.i)} impressions · ${num(x.c)} clicks`,
      note: 'Estimated earnings (final numbers come at the start of next month). Page RPM = earnings per 1,000 page views.',
      metrics: [
        { k: 'e', label: 'Estimated earnings', value: m(c.e), delta: deltaHtml(c.e, p.e), fmt: m, axis: (v) => m(v) },
        { k: 'v', label: 'Page views', value: num(c.v), delta: deltaHtml(c.v, p.v), fmt: num, axis: compact },
        { k: 'rpm', label: 'Page RPM', value: m(rpm(c)), delta: deltaHtml(rpm(c), rpm(p)), fmt: m, axis: (v) => m(v) },
        { k: 'i', label: 'Impressions', value: num(c.i), delta: deltaHtml(c.i, p.i), fmt: num, axis: compact },
        { k: 'c', label: 'Clicks', value: num(c.c), delta: deltaHtml(c.c, p.c), fmt: num, axis: compact },
        { k: 'ctr', label: 'CTR', value: pct(ctr(c)), delta: deltaHtml(ctr(c), ctr(p)), fmt: pct, axis: pctAxis },
      ],
    }));

    if (byDomain) {
      const card = el('section', 'card', `<div class="card-head"><h2>Earnings by site</h2><span class="note">AdSense "domain" report · ${esc(rangeText(R))}</span></div><div class="tbl"></div>`);
      app.append(card);
      const rows = byDomain.rows.map((r) => ({ host: r.DOMAIN_NAME, e: r.e, v: r.v, i: r.i, c: r.c, rpm: rpm(r), ctr: ctr(r) }));
      table($('.tbl', card), [
        { key: 'host', label: 'Site', html: (r) => `<a class="site-cell" href="${CL.link({ src: 'ads', tab: 'overview', site: r.host })}">${favicon(r.host)}<span><b>${esc(nameOf(r.host))}</b><span class="note block">${esc(r.host)}</span></span></a>` },
        { key: 'e', label: 'Earnings', num: true, fmt: m, bar: true },
        { key: 'v', label: 'Page views', num: true, fmt: num },
        { key: 'rpm', label: 'Page RPM', num: true, fmt: m },
        { key: 'i', label: 'Impressions', num: true, fmt: num },
        { key: 'c', label: 'Clicks', num: true, fmt: num },
        { key: 'ctr', label: 'CTR', num: true, fmt: pct },
      ], rows, { sort: 'e' });
      if (!rows.length) $('.tbl', card).innerHTML = `<p class="empty">No ad traffic in this range yet. Ads show only after ${ROOT} is approved and the AdSense code is on the pages.</p>`;
    }

    if (paid.length) {
      app.append(el('section', 'card', `<div class="card-head"><h2>Payments</h2><a href="${ADSENSE}/${esc(pub)}/payments" target="_blank" rel="noopener">Open in AdSense →</a></div>
        <ul class="ix-list">${paid.slice(0, 12).map((x) => `<li><b>${esc(x.amount)}</b><span class="muted">${esc(fmtYmd(x.date))}</span></li>`).join('')}</ul>`));
    }
  }

  async function viewSites(alive) {
    const acc = await getAccount();
    if (!alive()) return;
    if (!acc) { noAccount(); return; }
    const pub = pubOf(acc);
    const [sites, issues] = await Promise.all([
      list(`${API}/${acc.name}/sites`, 'sites').catch(() => []),
      list(`${API}/${acc.name}/policyIssues`, 'policyIssues').catch(() => []),
    ]);
    if (!alive()) return;
    const root = sites.find((s) => s.domain === ROOT);
    const st = root ? root.state : 'NONE';
    paint(pageHead(EYEBROW, 'Sites & approval', `AdSense reviews <b>${ROOT}</b>; once it is approved, every *.${ROOT} site can show ads · live check of each site's code`,
      `<div class="ph-actions"><a class="btn" href="${ADSENSE}/${esc(pub)}/sites/my-sites" target="_blank" rel="noopener">${icon('ext')}AdSense → Sites</a><button type="button" class="btn" id="adRecheck">${icon('refresh')}Check again</button></div>`)
      + `<section class="card ad-status"><div class="ad-status-top">${favicon(ROOT)}<div><div class="ad-status-name"><b>${ROOT}</b>${statePill(st)}${root ? `<span class="gp deep">${root.autoAdsEnabled ? 'Auto ads on' : 'Auto ads off'}</span>` : ''}</div><p>${esc((STATE[st] || STATE.NONE)[2])}</p></div></div>
          <div class="rs-sub">Approval checklist for ${ROOT}</div><ul class="ad-check" id="adRootChecks"><li class="muted">Checking ${ROOT}…</li></ul>
          <div class="rs-sub">What to do now</div>${steps(nextSteps(st, pub))}</section>`
      + (issues.length ? `<section class="card"><div class="card-head"><h2>Policy issues</h2><span class="note">from AdSense · fix these first</span></div><ol class="probs">${issues.map((x) => `<li class="prob k-${(x.policyTopics || []).some((t) => t.mustFix) ? 'fix' : 'win'}"><div class="prob-top"><span class="gp none">${esc((x.action || '').replace(/_/g, ' ').toLowerCase() || 'issue')}</span><b>${esc((x.policyTopics || []).map((t) => t.topic).join(', ') || 'Policy issue')}</b>${x.uri ? `<a href="${esc(x.uri)}" target="_blank" rel="noopener">${esc(x.uri)}</a>` : `<span class="muted">${esc(x.site || '')}</span>`}</div><div class="prob-status">Last seen ${esc(fmtYmd(x.lastDetectedDate))}${x.adRequestCount ? ` · ${num(+x.adRequestCount)} ad requests` : ''}</div></li>`).join('')}</ol></section>` : '')
      + `<div class="section-title"><h2>Every site</h2><span class="note">Read straight from each live site (its home page HTML)</span></div><section class="card dash-sites"><div class="tbl"><p class="empty ad-wait"><span class="spinner"></span>Checking ${SITES.length} sites…</p></div></section>`
      + (sites.filter((s) => s.domain !== ROOT).length ? `<p class="note">Other domains in this AdSense account: ${sites.filter((s) => s.domain !== ROOT).map((s) => `${esc(s.domain)} ${statePill(s.state)}`).join(' · ')}</p>` : ''));
    $('#adRecheck').onclick = () => { checks.clear(); window.dispatchEvent(new HashChangeEvent('hashchange')); };

    const rows = await Promise.all(SITES.map((h) => checkSite(h, pub)));
    if (!alive()) return;
    const r0 = rows.find((r) => r.host === ROOT) || await checkSite(ROOT, pub);
    if (!alive()) return;
    const li = (ok, text, fix) => `<li class="${ok == null ? 'unk' : ok ? 'ok' : 'bad'}">${icon(ok ? 'check' : ok == null ? 'info' : 'x')}<div><b>${text}</b>${!ok && fix ? `<span>${fix}</span>` : ''}</div></li>`;
    $('#adRootChecks').innerHTML = r0.blocked
      ? li(null, `${ROOT} could not be read from here`, 'The browser blocked reading it (CORS) or it did not answer. Open the site and check by hand.')
      : [
        li(st !== 'NONE', 'Added to AdSense', `AdSense → Sites → "New site" → ${ROOT}.`),
        li(r0.code || r0.meta, 'AdSense code (or verification meta tag) on the home page', `Paste the code from <a href="${CL.link({ src: 'ads', tab: 'setup' })}">Setup</a> into the &lt;head&gt; of ${ROOT}.`),
        li(r0.adsTxt && r0.adsTxt.line, `ads.txt at https://${ROOT}/ads.txt has your publisher line`, r0.adsTxt && !r0.adsTxt.ok ? `ads.txt is missing (HTTP ${r0.adsTxt.status || 'error'}). Create it with the line from <a href="${CL.link({ src: 'ads', tab: 'setup' })}">Setup</a>.` : 'Add the line from Setup to ads.txt.'),
        li(r0.privacy, 'Privacy policy page linked', 'Add a /privacy page (what data is collected, cookies, Google ads and third-party cookies) and link it in the footer.'),
        li(r0.about, 'About page linked', 'Add an /about page: who runs the site and what it offers.'),
        li(r0.contact, 'Contact page linked', 'Add a /contact page or an email address in the footer.'),
        li(r0.terms, 'Terms page linked (recommended)', 'Add /terms and link it in the footer.'),
      ].join('');

    table($('.dash-sites .tbl'), [
      { key: 'name', label: 'Site', html: (r) => `<a class="site-cell" href="https://${esc(r.host)}/" target="_blank" rel="noopener">${favicon(r.host)}<span><b>${esc(nameOf(r.host))}</b><span class="note block">${esc(r.host)}</span></span></a>` },
      { key: 'reach', label: 'Readable', num: true, html: (r) => (r.blocked ? '<span class="gp deep" title="The browser could not read this site (CORS or offline)">Can\'t check</span>' : okPill(r.reachable, 'Yes', 'Error')) },
      { key: 'code', label: 'AdSense code', num: true, html: (r) => (r.blocked ? '–' : okPill(r.code || r.meta, r.code ? 'Yes' : 'Meta tag', 'Missing')) },
      { key: 'privacy', label: 'Privacy', num: true, html: (r) => (r.blocked ? '–' : okPill(r.privacy)) },
      { key: 'about', label: 'About', num: true, html: (r) => (r.blocked ? '–' : okPill(r.about)) },
      { key: 'contact', label: 'Contact', num: true, html: (r) => (r.blocked ? '–' : okPill(r.contact)) },
      { key: 'issues', label: 'Policy issues', num: true, html: (r) => { const n = issues.filter((x) => (x.uri || '').includes('//' + r.host + '/') || x.site === r.host).length; return n ? `<span class="gp none">${n}</span>` : '<span class="muted">0</span>'; } },
    ], rows.map((r) => ({ ...r, name: nameOf(r.host), reach: r.reachable ? 1 : 0, code: r.code || r.meta ? 1 : 0, privacy: +r.privacy, about: +r.about, contact: +r.contact, issues: 0 })), { sort: 'name', asc: true, pageSize: 100 });
    app.insertAdjacentHTML('beforeend', '<p class="note">Links are searched in the page HTML. A site that builds its footer with JavaScript can show "Missing" even when the page exists — open the site to be sure.</p>');
  }

  function nextSteps(st, pub) {
    const setup = `<a href="${CL.link({ src: 'ads', tab: 'setup' })}">Setup</a>`;
    if (st === 'READY') return [
      `${ROOT} is approved. Turn on <b>Auto ads</b> in AdSense → Ads → By site (Google places ads by itself), or place ad units by hand.`,
      `Make sure the AdSense code from ${setup} is in the &lt;head&gt; of <b>every</b> site that should show ads (all *.${ROOT} sites are covered by this approval).`,
      `Keep https://${ROOT}/ads.txt with your line; it covers the subdomains too.`,
      'Watch Overview for earnings and AdSense alerts; fix any policy issue quickly.',
    ];
    if (st === 'GETTING_READY') return [
      'Google is reviewing the site. Do not remove the AdSense code or ads.txt while it reviews.',
      'Keep adding useful, original content and make sure every page loads fast and works on mobile.',
      'Reviews usually take a few days, sometimes 2–4 weeks. You get an email when it is done.',
    ];
    if (st === 'NEEDS_ATTENTION') return [
      'Open AdSense → Sites, click the site and read the reason (for example "Low value content", "Site down or unavailable", "Policy violations").',
      'Fix it on the site: more original, helpful text on the main pages, working navigation, privacy / about / contact pages, no broken or empty pages.',
      'Check the list below until everything is green, then press "Request review" again in AdSense.',
    ];
    if (st === 'REQUIRES_REVIEW') return [
      `Connect the site: put the AdSense code (or the meta tag) from ${setup} into the &lt;head&gt; of ${ROOT}, deploy, then in AdSense → Sites press "Verify".`,
      `Add the ads.txt line from ${setup} at https://${ROOT}/ads.txt.`,
      'Make the checklist above green (privacy, about, contact pages).',
      'Press "Request review" in AdSense → Sites.',
    ];
    return [
      `Open <a href="${ADSENSE}/${esc(pub)}/sites/my-sites" target="_blank" rel="noopener">AdSense → Sites</a> → "New site" and enter <b>${ROOT}</b> (only the main domain; its subdomains are covered).`,
      `Put the AdSense code from ${setup} into the &lt;head&gt; of ${ROOT} and deploy.`,
      `Create https://${ROOT}/ads.txt with the line from ${setup}.`,
      'Make the checklist above green (privacy, about, contact pages, real content).',
      'In AdSense press "Verify", then "Request review". Approval takes a few days to 2–4 weeks.',
    ];
  }

  async function viewSetup(alive) {
    const acc = await getAccount();
    if (!alive()) return;
    if (!acc) { noAccount(); return; }
    const pub = pubOf(acc), S = snippets(pub);
    const repo = (CFG.repoFolders || {})[ROOT];
    paint(pageHead(EYEBROW, 'Setup', `Codes for your AdSense account <b>${esc(pub)}</b> and how to apply`)
      + `<div class="grid2">
          <section class="card">${copyBox('adHead', '1 · AdSense code — put in the &lt;head&gt; of every site', S.head)}<p class="note">One line, the same on every page. It verifies the site for review and later shows Auto ads. Root layout of each site (e.g. ${esc(repo ? CFG.repoRoot + '\\' + repo : ROOT)}).</p></section>
          <section class="card">${copyBox('adTxt', `2 · ads.txt — file at https://${ROOT}/ads.txt`, S.adsTxt)}<p class="note">A plain text file at the root of ${ROOT} (in its public/ folder). It covers the subdomains as well. Missing ads.txt = lower earnings.</p></section>
          <section class="card">${copyBox('adMeta', '(Optional) verification meta tag instead of the code', S.meta)}<p class="note">Only if you don't want the script yet: AdSense accepts this tag to verify ${ROOT}.</p></section>
          <section class="card"><div class="cb-head"><b>Publisher ID</b></div><p class="ad-pub"><code>${esc(pub)}</code> · ad client <code>ca-${esc(pub)}</code></p><p class="note">Account: ${esc(acc.displayName || '')} · time zone ${esc(acc.timeZone?.id || '')}</p></section>
        </div>
        <section class="card"><div class="card-head"><h2>How to get approved</h2><a href="${CL.link({ src: 'ads', tab: 'sites' })}">Approval checklist →</a></div>
          ${steps([
            `<b>Apply with the main domain only:</b> AdSense → Sites → "New site" → <b>${ROOT}</b>. Subdomains (models, games, …) don't need their own approval.`,
            `<b>Code:</b> paste code 1 into the &lt;head&gt; of ${ROOT} (and later every site), deploy.`,
            `<b>ads.txt:</b> create https://${ROOT}/ads.txt with line 2, deploy, open the URL to check it shows.`,
            '<b>Policy pages:</b> Privacy policy (mention Google AdSense cookies), About, Contact — linked in the footer of every site.',
            '<b>Content:</b> the home page and main pages need real, original text (what the tools do, how to use them, FAQs), clear menus and no "coming soon" / empty pages. Thin pages are the #1 rejection reason.',
            '<b>Request review</b> in AdSense → Sites. Keep the code in place; it takes a few days to 2–4 weeks.',
            `<b>After approval:</b> AdSense → Ads → turn on Auto ads for ${ROOT}; check earnings here in Overview.`,
          ])}</section>`);
    wireCopy();
  }

  function viewSignIn(msg) {
    gSignIn({
      id: 'adsSignin', need: SCOPE, msg, eyebrow: 'AdSense', title: 'Connect AdSense',
      text: `Allow read-only AdSense access for the Google account that owns your AdSense account${CFG.ownerEmail ? ` (<b>${esc(CFG.ownerEmail)}</b>)` : ''}: earnings, sites, approval status and payments.`,
      button: gAuth.token() ? 'Allow AdSense access' : 'Sign in with Google',
      help: `<div class="help-p"><b>"AdSense Management API has not been used … or it is disabled"?</b> <a href="${ENABLE_URL}" target="_blank" rel="noopener">Enable the AdSense Management API</a> in Google Cloud, wait a minute, then try again.</div>`,
    });
  }

  async function route({ R, alive, site, tab }) {
    if (!CFG.clientId) { paint(`<div class="error">${icon('alert')}<div>Set <code>clientId</code> in config.js.</div></div>`, false); return; }
    if (!(await gGate(SCOPE, viewSignIn, alive))) return;
    loading('Loading AdSense…');
    try {
      if (tab === 'sites') await viewSites(alive);
      else if (tab === 'setup') await viewSetup(alive);
      else await viewOverview(R, alive, site);
    } catch (e) {
      if (!alive()) return;
      if (e.reconnect) { gReconnect(); return; }
      if (/insufficient authentication scopes/i.test(e.message)) { viewSignIn('Google did not give AdSense access to this sign-in. Press the button and allow it.'); return; }
      const disabled = /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(e.message);
      paint(`<div class="error">${icon('alert')}<div><b>Couldn't load AdSense.</b><br>${esc(e.message)}<div class="note">${disabled ? `Turn on <a href="${ENABLE_URL}" target="_blank" rel="noopener">AdSense Management API</a> in the Google Cloud project of the OAuth client, wait a minute, then try again.` : 'If permission is denied, sign in with the Google account that owns the AdSense account.'}</div></div></div><button class="btn" id="retry">Try again</button>`, false);
      $('#retry').onclick = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  // for the Dashboard: earnings in a range (null when AdSense isn't connected)
  async function totals(R) {
    if (!gAuth.has(SCOPE)) return null;
    const acc = await getAccount();
    if (!acc) return null;
    const [c, p] = await Promise.all([report(acc, R.start, R.end), report(acc, R.prevStart, R.prevEnd)]);
    return { cur: c.totals, prev: p.totals, currency: c.currency, money: (v) => money(v, c.currency) };
  }

  window.ADS = { route, clear: () => { cache.clear(); checks.clear(); }, stop: () => {}, signedIn: () => gAuth.has(SCOPE), lib: { totals } };
})();
