/* CodeLove Admin — app shell: router, sidebar, filter dropdowns, account menu, theme.
 *   #/...        CodeLove Analytics (our own tracker, Firestore)  -> own.js
 *   #/ga/...     Google Analytics 4                               -> ga.js
 *   #/search/... Google Search (Search Console keywords)          -> gsc.js
 *   #/reports... Daily SEO/indexing/traffic report + History        -> report.js
 * Routes: #/  #/pages  #/live  #/tracker  #/ga  #/ga/pages  #/ga/live  #/search  #/search/pages  #/search/index  #/search/missing
 *         #/reports  #/reports/history  #/reports/view?id=…  #/reports/compare?a=…&b=…
 * Site filter: #/site/<host> (overview of one site) or ?site=<host> on the other tabs. */
(() => {
  'use strict';
  const { $, store, esc, icon, favicon, popover, closePop, PRESETS, range, rangeBounds, currentRange, setRange, rangeLabel, shortRange, hideTip, iso, istToday } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const SITES = CFG.sites || [];
  let renderId = 0;
  let state = { src: 'own', tab: 'overview', site: null };

  const NAV = [
    { src: 'rep', title: 'Reports', ic: 'calendar', items: [['overview', 'Daily report', 'file'], ['history', 'History', 'calendar']] },
    { src: 'own', title: 'CodeLove Analytics', ic: 'heart', items: [['overview', 'Overview', 'grid'], ['pages', 'Pages', 'file'], ['live', 'Live', 'live'], ['tracker', 'Tracker', 'code']] },
    { src: 'ga', title: 'Google Analytics', ic: 'bars', items: [['overview', 'Overview', 'grid'], ['pages', 'Pages', 'file'], ['live', 'Live', 'live']] },
    { src: 'gsc', title: 'Google Search', ic: 'search', items: [['overview', 'Keywords', 'key'], ['pages', 'Pages', 'file'], ['index', 'Index status', 'check'], ['missing', 'Not showing', 'eyeoff']] },
  ];
  const BASE = { own: '#', ga: '#/ga', gsc: '#/search', rep: '#/reports' };
  const SECTION = { own: () => OWN, ga: () => GA, gsc: () => GSC, rep: () => REP };

  function parse() {
    const raw = (location.hash || '#/').slice(1) || '/';
    const qi = raw.indexOf('?');
    let path = qi >= 0 ? raw.slice(0, qi) : raw;
    const params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
    let src = 'own';
    for (const [s, pre] of [['ga', '/ga'], ['gsc', '/search'], ['rep', '/reports']]) if (path === pre || path.startsWith(pre + '/')) { src = s; path = path.slice(pre.length) || '/'; }
    let site = params.get('site') || null, tab = 'overview';
    if (path.startsWith('/site/')) site = decodeURIComponent(path.slice(6));
    else if (path.startsWith('/pages')) tab = 'pages';
    else if (path.startsWith('/live') && src !== 'gsc') tab = 'live';
    else if (path.startsWith('/tracker') && src === 'own') tab = 'tracker';
    else if (path.startsWith('/missing') && src === 'gsc') tab = 'missing';
    else if (path.startsWith('/index') && src === 'gsc') tab = 'index';
    else if (src === 'rep') for (const t of ['history', 'view', 'compare']) if (path.startsWith('/' + t)) tab = t;
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
    if (src === 'rep') return null;
    if (src === 'own') return OWN.user() ? ['on', 'Signed in'] : ['off', 'Signed out'];
    const sc = src === 'ga' ? CL.GA_SCOPE : CL.GSC_SCOPE;
    return CL.gAuth.has(sc) ? ['on', 'Connected'] : CL.gAuth.known(sc) ? ['warn', 'Needs reconnect'] : ['off', 'Not connected'];
  }
  function renderNav() {
    $('#nav').innerHTML = NAV.map((g) => `<div class="nav-group"><div class="nav-label">${icon(g.ic)}<span>${esc(g.title)}</span>${srcState(g.src) ? `<span class="nav-dot ${srcState(g.src)[0]}" title="${esc(srcState(g.src)[1])}"></span>` : ''}</div>${g.items.map(([tab, label, ic]) => {
      const on = state.src === g.src && (state.tab === tab || (tab === 'history' && (state.tab === 'view' || state.tab === 'compare')));
      return `<a href="${link({ src: g.src, tab, site: tab === 'tracker' ? null : state.site })}" class="nav-item${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${g.src === 'own' && tab === 'live' ? '<span class="nav-count" data-live-count hidden></span>' : ''}</a>`;
    }).join('')}</div>`).join('');
  }
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
    const repOther = state.src === 'rep' && state.tab !== 'overview';
    rb.disabled = state.tab === 'live' || state.tab === 'tracker' || repOther;
    rb.title = rb.disabled ? (repOther ? 'Saved reports keep the range they were made with' : 'Live and Tracker are not date based') : '';
    sb.innerHTML = `${state.site ? favicon(state.site) : icon('globe')}<span class="dd-text"><b>${esc(state.site || 'All sites')}</b></span>${icon('chev')}`;
    sb.disabled = state.tab === 'tracker' || repOther;
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
    OWN.clear(); GA.clear(); GSC.clear(); REP.clear(); route();
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
  function renderAccount() { $('#accountBtn').innerHTML = OWN.user() ? avatar(OWN.user()) : icon('monitor'); }
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
  }, { align: 'end' }));
  CL.gAuth.onChange(() => { renderNav(); renderAccount(); });
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
  OWN.onAuth(() => { renderAccount(); renderNav(); OWN.updateBadge(); if (state.src === 'own') route(); });
  route();
})();
