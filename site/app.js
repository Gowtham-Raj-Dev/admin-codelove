/* CodeLove Admin — app shell: router, sidebar, filter dropdowns, account menu, theme.
 *   #/...        CodeLove Analytics (our own tracker, Firestore)  -> own.js
 *   #/ga/...     Google Analytics 4                               -> ga.js
 *   #/search/... Google Search (Search Console keywords)          -> gsc.js
 *   #/reports    Dashboard: every site at a glance + suggestions       -> dash.js
 *   #/reports/…  Daily SEO/indexing/traffic report + History         -> report.js
 * Routes: #/  #/pages  #/live  #/tracker  #/ga  #/ga/pages  #/ga/live  #/search  #/search/pages  #/search/index  #/search/missing
 *         #/reports  #/reports/daily  #/reports/history  #/reports/view?id=…  #/reports/compare?a=…&b=…
 * Site filter: #/site/<host> (overview of one site) or ?site=<host> on the other tabs. */
(() => {
  'use strict';
  const { $, $$, store, esc, icon, favicon, popover, closePop, PRESETS, range, rangeBounds, currentRange, setRange, rangeLabel, shortRange, hideTip, iso, istToday } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const SITES = CFG.sites || [];
  let renderId = 0;
  let state = { src: 'own', tab: 'overview', site: null };

  const NAV = [
    { src: 'rep', tabLabel: 'Dashboard', title: 'Dashboard', ic: 'grid', items: [['overview', 'Overview', 'grid'], ['daily', 'Daily report', 'file'], ['history', 'History', 'calendar']] },
    { src: 'own', tabLabel: 'Analytics', title: 'CodeLove Analytics', ic: 'heart', items: [['overview', 'Overview', 'grid'], ['pages', 'Pages', 'file'], ['live', 'Live', 'live'], ['tracker', 'Tracker', 'code']] },
    { src: 'ga', tabLabel: 'Google Analytics', title: 'Google Analytics', ic: 'bars', items: [['overview', 'Overview', 'grid'], ['pages', 'Pages', 'file'], ['live', 'Live', 'live']] },
    { src: 'gsc', tabLabel: 'Google Search', title: 'Google Search', ic: 'search', items: [['overview', 'Keywords', 'key'], ['pages', 'Pages', 'file'], ['index', 'Index status', 'check'], ['missing', 'Not showing', 'eyeoff']] },
    { src: 'ads', tabLabel: 'AdSense', title: 'AdSense', ic: 'coin', items: [['overview', 'Overview', 'grid'], ['sites', 'Sites & approval', 'check'], ['setup', 'Setup', 'code']] },
    { src: 'tools', tabLabel: 'Tools', title: 'Tools', ic: 'tool', items: [['overview', 'Site health', 'live'], ['uptime', 'Uptime', 'alert'], ['checker', 'Page checker', 'search'], ['broken', 'Broken links', 'x'], ['ranks', 'Rank tracker', 'bars'], ['speed', 'PageSpeed', 'gauge'], ['utm', 'UTM link builder', 'link'], ['links', 'Quick links', 'ext']] },
  ];
  // Last sub-page opened in each section, so going back to a tab returns to where you were.
  const lastTab = {};
  const BASE = { own: '#', ga: '#/ga', gsc: '#/search', rep: '#/reports', ads: '#/adsense', tools: '#/tools' };
  const SECTION = { own: () => OWN, ga: () => GA, gsc: () => GSC, rep: () => REP, ads: () => ADS, tools: () => TOOLS };

  function parse() {
    const raw = (location.hash || '#/').slice(1) || '/';
    const qi = raw.indexOf('?');
    let path = qi >= 0 ? raw.slice(0, qi) : raw;
    const params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
    let src = 'own';
    for (const [s, pre] of [['ga', '/ga'], ['gsc', '/search'], ['rep', '/reports'], ['ads', '/adsense'], ['tools', '/tools']]) if (path === pre || path.startsWith(pre + '/')) { src = s; path = path.slice(pre.length) || '/'; }
    let site = params.get('site') || null, tab = 'overview';
    if (path.startsWith('/site/')) site = decodeURIComponent(path.slice(6));
    else if (path.startsWith('/pages')) tab = 'pages';
    else if (path.startsWith('/live') && src !== 'gsc') tab = 'live';
    else if (path.startsWith('/tracker') && src === 'own') tab = 'tracker';
    else if (path.startsWith('/missing') && src === 'gsc') tab = 'missing';
    else if (path.startsWith('/index') && src === 'gsc') tab = 'index';
    else if (src === 'ads' && path.startsWith('/sites')) tab = 'sites';
    else if (src === 'ads' && path.startsWith('/setup')) tab = 'setup';
    else if (src === 'tools') for (const t of ['checker', 'speed', 'utm', 'links', 'broken', 'uptime', 'ranks']) if (path.startsWith('/' + t)) tab = t;
    else if (src === 'rep') for (const t of ['daily', 'history', 'view', 'compare']) if (path.startsWith('/' + t)) tab = t;
    if (site) site = site.toLowerCase().replace(/[^a-z0-9.-]/g, '') || null;
    return { src, tab, site, params };
  }
  function link({ src = state.src, tab = 'overview', site = null } = {}) {
    const base = BASE[src] || '#';
    if (tab === 'tracker') return '#/tracker';
    if (tab === 'overview') return site ? `${base}/site/${encodeURIComponent(site)}` : base === '#' ? '#/' : base;
    return `${base}/${tab}${site ? '?site=' + encodeURIComponent(site) : ''}`;
  }
  CL.link = link;
  CL.state = () => state;

  // ---------- sidebar ----------
  // connection dot per data source: on = ready, warn = Google token expired (one click to reconnect), off = not connected
  function srcState(src) {
    if (src === 'rep' || src === 'tools') return null;
    if (src === 'own') return OWN.user() ? ['on', 'Signed in'] : ['off', 'Signed out'];
    const sc = src === 'ga' ? CL.GA_SCOPE : src === 'ads' ? CL.ADS_SCOPE : CL.GSC_SCOPE;
    return CL.gAuth.has(sc) ? ['on', 'Connected'] : CL.gAuth.known(sc) ? ['warn', 'Needs reconnect'] : ['off', 'Not connected'];
  }
  const dot = (src) => { const s = srcState(src); return s ? `<span class="nav-dot ${s[0]}" title="${esc(s[1])}"></span>` : ''; };
  // Sidebar: every section as an accordion group, only one open at a time (the current section opens by itself).
  let openSrc = null;
  const ACC_COLOR = { rep: '#7c7cf5', own: '#ec5f9e', ga: '#f2a33a', gsc: '#2fbf71', ads: '#3d8bfd', tools: '#14b8a6' };
  function renderNav() {
    if (openSrc === null) openSrc = state.src;
    $('#nav').innerHTML = NAV.map((g) => {
      const open = openSrc === g.src, cur = state.src === g.src;
      const st = srcState(g.src);
      const sub = st ? `<span class="acc-sub"><span class="nav-dot ${st[0]}"></span>${esc(st[1])}</span>` : `<span class="acc-sub">${g.items.length} ${g.src === 'tools' ? 'tools' : 'pages'}</span>`;
      return `<div class="nav-group acc${open ? ' open' : ''}${cur ? ' cur' : ''}" data-src="${g.src}" style="--c:${ACC_COLOR[g.src]}">
        <button type="button" class="acc-head" aria-expanded="${open}" aria-controls="acc-${g.src}"><span class="acc-ic">${icon(g.ic)}</span><span class="acc-title"><span class="acc-name">${esc(g.title)}</span>${sub}</span>${icon('chev', 'acc-chev')}</button>
        <div class="acc-body" id="acc-${g.src}"><div class="acc-inner">${g.items.map(([tab, label, ic]) => {
          const on = cur && (state.tab === tab || (tab === 'history' && (state.tab === 'view' || state.tab === 'compare')));
          return `<a href="${link({ src: g.src, tab, site: tab === 'tracker' ? null : state.site })}" class="nav-item${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''}${open ? '' : ' tabindex="-1"'}>${icon(ic)}<span>${label}</span>${g.src === 'own' && tab === 'live' ? '<span class="nav-count" data-live-count hidden></span>' : ''}</a>`;
        }).join('')}</div></div></div>`;
    }).join('');
  }
  $('#nav').addEventListener('click', (e) => {
    const h = e.target.closest('.acc-head');
    if (!h) return;
    const src = h.parentElement.dataset.src;
    openSrc = openSrc === src ? '' : src; // open this one, close the others (click again to close it)
    $$('#nav .acc').forEach((g) => {
      const open = g.dataset.src === openSrc;
      g.classList.toggle('open', open);
      $('.acc-head', g).setAttribute('aria-expanded', String(open));
      g.querySelectorAll('.nav-item').forEach((a) => (open ? a.removeAttribute('tabindex') : a.setAttribute('tabindex', '-1')));
    });
  });
  const openNav = (open) => document.body.classList.toggle('nav-open', open);
  $('#menuBtn').innerHTML = icon('menu');
  $('#sideClose').innerHTML = icon('x');
  $('#menuBtn').addEventListener('click', () => openNav(true));
  $('#sideClose').addEventListener('click', () => openNav(false));
  $('#scrim').addEventListener('click', () => openNav(false));
  $('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) openNav(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) openNav(false); });

  // ---------- filters ----------
  function renderFilters() {
    const R = currentRange();
    const rb = $('#rangeBtn'), sb = $('#siteBtn');
    rb.innerHTML = `${icon('calendar')}<span class="dd-text"><b>${esc(rangeLabel())}</b><span class="dd-sub">${esc(shortRange(R.start, R.end))}</span></span>${icon('chev')}`;
    const repOther = state.src === 'rep' && ['history', 'view', 'compare'].includes(state.tab);
    const adsOther = state.src === 'ads' && state.tab !== 'overview';
    const tools = state.src === 'tools', toolsNoSite = tools && !['overview', 'speed', 'checker', 'broken', 'ranks'].includes(state.tab);
    rb.disabled = state.tab === 'live' || state.tab === 'tracker' || repOther || adsOther || (tools && state.tab !== 'ranks');
    rb.title = rb.disabled ? (repOther ? 'Saved reports keep the range they were made with' : 'Live and Tracker are not date based') : '';
    sb.innerHTML = `${state.site ? favicon(state.site) : icon('globe')}<span class="dd-text"><b>${esc(state.site || 'All sites')}</b></span>${icon('chev')}`;
    sb.disabled = state.tab === 'tracker' || repOther || adsOther || toolsNoSite;
    $('#refresh').innerHTML = icon('refresh');
  }

  $('#rangeBtn').addEventListener('click', () => popover($('#rangeBtn'), (el, close) => {
    const today = iso(istToday());
    const cur = currentRange();
    el.innerHTML = `<div class="pop-title">Date range</div>
      <div class="pop-list" role="listbox" aria-label="Date range">${PRESETS.map((p) => {
        const b = rangeBounds(p.v);
        return `<button type="button" class="mi" role="option" data-v="${p.v}" aria-selected="${range.preset === p.v}">${icon('check', 'mi-check')}<span class="mi-label">${esc(p.label)}</span><span class="mi-hint">${esc(shortRange(b.start, b.end))}</span></button>`;
      }).join('')}</div>
      <form class="pop-foot" novalidate>
        <div class="pop-sub">Custom range${range.preset === 'custom' ? ' <span class="note">(selected)</span>' : ''}</div>
        <div class="custom-row">
          <label>From<input type="date" name="from" max="${today}" value="${esc(range.preset === 'custom' ? range.from : cur.start)}" required></label>
          <label>To<input type="date" name="to" max="${today}" value="${esc(range.preset === 'custom' ? range.to : cur.end)}" required></label>
        </div>
        <button class="btn primary sm" type="submit">Apply custom range</button>
      </form>`;
    el.querySelectorAll('.mi').forEach((b) => b.addEventListener('click', () => { close(); setRange(b.dataset.v); route(); }));
    $('form', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target.from.value, t = e.target.to.value;
      if (!f || !t) { (f ? e.target.to : e.target.from).focus(); return; }
      close(); setRange('custom', f < t ? f : t, f < t ? t : f); route();
    });
  }));

  // Site picker: a grid of tiles (3 columns on desktop, fewer on small screens) with search; stays inside the viewport.
  const NAMES = CFG.siteNames || {};
  const siteName = (h) => NAMES[h] || h.split('.')[0];
  $('#siteBtn').addEventListener('click', () => popover($('#siteBtn'), (el, close) => {
    const list = SITES.slice();
    if (state.site && !list.includes(state.site)) list.push(state.site);
    const items = [
      { v: '', name: 'All sites', host: `${SITES.length} sites together`, ic: `<span class="sm-ic">${icon('globe')}</span>` },
      ...list.map((h) => ({ v: h, name: siteName(h), host: h, ic: favicon(h) })),
    ];
    const cur = state.site || '';
    el.innerHTML = `<div class="sm-head"><div class="pop-title">Choose a site</div>
        <label class="pop-search">${icon('search')}<input type="search" data-autofocus placeholder="Search sites" aria-label="Search sites" autocomplete="off"></label></div>
      <div class="sm-grid" role="listbox" aria-label="Sites">${items.map((it, i) => `<button type="button" class="mi sm-tile" role="option" data-i="${i}" aria-selected="${it.v === cur}" title="${esc(it.v || it.name)}">${it.ic}<span class="sm-text"><span class="sm-name">${esc(it.name)}</span><span class="sm-host">${esc(it.host)}</span></span>${icon('check', 'mi-check')}</button>`).join('')}</div>
      <div class="pop-empty" hidden>No site matches</div>`;
    const tiles = [...el.querySelectorAll('.sm-tile')];
    tiles.forEach((b) => b.addEventListener('click', () => { close(); location.hash = link({ src: state.src, tab: state.tab, site: items[+b.dataset.i].v || null }); }));
    const input = $('input', el);
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      let any = false;
      tiles.forEach((b) => { const it = items[+b.dataset.i]; const hit = !q || (it.v + ' ' + it.name).toLowerCase().includes(q); b.hidden = !hit; any ||= hit; });
      $('.pop-empty', el).hidden = any;
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = tiles.find((x) => !x.hidden); if (b) b.click(); } });
  }, { cls: 'pop-gridmenu' }));

  $('#refresh').addEventListener('click', () => {
    const b = $('#refresh');
    b.classList.add('spin'); setTimeout(() => b.classList.remove('spin'), 700);
    OWN.clear(); GA.clear(); GSC.clear(); REP.clear(); ADS.clear(); TOOLS.clear(); route();
  });

  // ---------- account + theme ----------
  const THEMES = [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']];
  const theme = () => store.get('cl_theme') || 'system';
  function setTheme(t) {
    store.set('cl_theme', t === 'system' ? null : t);
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  }
  function avatar(u) {
    if (u && u.photoURL) return `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`;
    return esc(((u && (u.displayName || u.email)) || '?').trim().charAt(0).toUpperCase());
  }
  // Sidebar footer: avatar + name + email; opens the account / theme menu.
  function renderAccount() {
    const u = OWN.user();
    $('#accountBtn').innerHTML = `<span class="acct-av-sm">${u ? avatar(u) : icon('monitor')}</span><span class="acct-txt"><b>${esc(u ? u.displayName || 'Signed in' : 'Not signed in')}</b><span>${esc(u ? u.email || '' : 'Account & theme')}</span></span>${icon('chev', 'acct-chev')}`;
  }
  $('#accountBtn').addEventListener('click', () => popover($('#accountBtn'), (el, close) => {
    const u = OWN.user(), G = CL.gAuth;
    const gKnown = G.known(CL.GA_SCOPE) || G.known(CL.GSC_SCOPE), gLive = !!G.token();
    const row = (label, src, extra = '') => { const [k, t] = srcState(src); return `<div class="acct-row"><span>${label}</span><span class="status ${k}">${t}${extra}</span></div>`; };
    el.setAttribute('role', 'menu');
    el.innerHTML = `${u ? `<div class="acct"><span class="acct-av">${avatar(u)}</span><div style="min-width:0"><div class="acct-name">${esc(u.displayName || 'Signed in')}</div><div class="note">${esc(u.email || '')}</div></div></div>` : '<div class="pop-title">Not signed in</div>'}
      <div class="pop-title">Data sources</div>
      <div class="acct-rows">
        ${row('CodeLove Analytics', 'own')}
        ${row('Google Analytics', 'ga')}
        ${row('Search Console', 'gsc')}
        ${row('AdSense', 'ads')}
        ${gKnown ? `<div class="acct-g note">${G.email() ? `Google: ${esc(G.email())}` : 'Google account connected'}${gLive ? ` · renews in ${G.minutesLeft()} min` : ''}</div>` : ''}
      </div>
      ${gKnown ? `${gLive ? '' : `<button type="button" class="mi" id="gRecon" role="menuitem">${icon('refresh')}<span class="mi-label">Reconnect Google</span></button>`}
        <button type="button" class="mi" id="gSwitchBtn" role="menuitem">${icon('globe')}<span class="mi-label">Switch Google account</span></button>
        <button type="button" class="mi" id="gForget" role="menuitem">${icon('x')}<span class="mi-label">Disconnect Google</span></button>` : ''}
      <div class="pop-sep"></div>
      <div class="pop-title">Theme</div>
      <div class="theme-seg">${THEMES.map(([v, l, ic]) => `<button type="button" data-t="${v}" aria-pressed="${theme() === v}">${icon(ic)}${l}</button>`).join('')}</div>
      ${u || gKnown ? `<div class="pop-sep"></div><button type="button" class="mi danger" id="signoutBtn" role="menuitem">${icon('logout')}<span class="mi-label">Sign out of everything</span></button>` : ''}`;
    el.querySelectorAll('.theme-seg button').forEach((b) => b.addEventListener('click', () => {
      setTheme(b.dataset.t);
      el.querySelectorAll('.theme-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      window.dispatchEvent(new Event('resize'));
    }));
    const on = (id, fn) => { const b = $('#' + id, el); if (b) b.addEventListener('click', fn); };
    // these open Google's window, so they run straight from the click
    on('gRecon', () => { close(false); G.renew(true).then(route, (e) => { if (e.code !== 'popup_closed') alert(e.message); }); });
    on('gSwitchBtn', () => { close(false); G.switchAccount().then(() => { GA.clear(); GSC.clear(); route(); }, (e) => { if (e.code !== 'popup_closed') alert(e.message); }); });
    on('gForget', () => { close(false); GA.signOut(); GSC.clear(); route(); });
    on('signoutBtn', () => { close(false); GA.signOut(); GSC.clear(); OWN.signOut(); route(); });
  }));
  CL.gAuth.onChange(() => { renderNav(); renderAccount(); });

  // Keep Google connected without asking: Google tokens last 1 hour and the browser only lets the (self-closing,
  // no-consent) renew window open right after a click. So the first click anywhere after expiry renews it quietly.
  let renewing = false;
  document.addEventListener('pointerdown', () => {
    const G = CL.gAuth;
    if (renewing || G.token() || !(G.known(CL.GA_SCOPE) || G.known(CL.GSC_SCOPE))) return;
    if (state.src === 'own') return; // CodeLove Analytics doesn't use Google data
    renewing = true;
    G.renew(true).then(() => { if (state.src !== 'own') route(); }, () => {}).finally(() => { renewing = false; });
  }, true);
  // charts read CSS colours at draw time; redraw them when the OS theme flips
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (theme() === 'system') route(); });

  // ---------- router ----------
  function route() {
    const id = ++renderId;
    const alive = () => id === renderId;
    hideTip(); closePop(false);
    OWN.stop(); GA.stop();
    const prev = state;
    state = parse();
    lastTab[state.src] = state.tab;
    openSrc = state.src; // the current section's group is always the open one after a page change
    if (prev.src !== state.src) delete $('#app').dataset.filled; // don't dim one section's page while the other loads
    document.body.dataset.src = state.src;
    renderNav(); renderFilters(); renderAccount();
    OWN.updateBadge();
    const ctx = { R: currentRange(), alive, site: state.site, tab: state.tab, params: state.params };
    SECTION[state.src]().route(ctx);
    if (prev.tab !== state.tab || prev.src !== state.src) scrollTo({ top: 0 });
  }
  addEventListener('hashchange', route);

  OWN.init();
  TOOLS2.startUptime(); // background uptime checks + red alert on every page when a site is down
  OWN.onAuth(() => { renderAccount(); renderNav(); OWN.updateBadge(); if (state.src === 'own') route(); });
  route();
})();
