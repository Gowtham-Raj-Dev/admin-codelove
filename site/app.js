/* CodeLove Admin — app shell: router, sidebar, filter dropdowns, account menu, theme.
 *   #/...    CodeLove Analytics (our own tracker, Firestore)  -> own.js
 *   #/ga/... Google Analytics 4                               -> ga.js
 * Routes: #/  #/pages  #/live  #/tracker  #/ga  #/ga/pages  #/ga/live
 * Site filter: #/site/<host> (overview of one site) or ?site=<host> on pages/live. */
(() => {
  'use strict';
  const { $, store, esc, icon, favicon, popover, selectMenu, closePop, PRESETS, range, rangeBounds, currentRange, setRange, rangeLabel, shortRange, hideTip, iso, istToday } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const SITES = CFG.sites || [];
  let renderId = 0;
  let state = { src: 'own', tab: 'overview', site: null };

  const NAV = [
    { src: 'own', title: 'CodeLove Analytics', ic: 'heart', items: [['overview', 'Overview', 'grid'], ['pages', 'Pages', 'file'], ['live', 'Live', 'live'], ['tracker', 'Tracker', 'code']] },
    { src: 'ga', title: 'Google Analytics', ic: 'bars', items: [['overview', 'Overview', 'grid'], ['pages', 'Pages', 'file'], ['live', 'Live', 'live']] },
  ];

  function parse() {
    const raw = (location.hash || '#/').slice(1) || '/';
    const qi = raw.indexOf('?');
    let path = qi >= 0 ? raw.slice(0, qi) : raw;
    const params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
    let src = 'own';
    if (path === '/ga' || path.startsWith('/ga/')) { src = 'ga'; path = path.slice(3) || '/'; }
    let site = params.get('site') || null, tab = 'overview';
    if (path.startsWith('/site/')) site = decodeURIComponent(path.slice(6));
    else if (path.startsWith('/pages')) tab = 'pages';
    else if (path.startsWith('/live')) tab = 'live';
    else if (path.startsWith('/tracker') && src === 'own') tab = 'tracker';
    if (site) site = site.toLowerCase().replace(/[^a-z0-9.-]/g, '') || null;
    return { src, tab, site };
  }
  function link({ src = state.src, tab = 'overview', site = null } = {}) {
    const base = src === 'ga' ? '#/ga' : '#';
    if (tab === 'tracker') return '#/tracker';
    if (tab === 'overview') return site ? `${base}/site/${encodeURIComponent(site)}` : src === 'ga' ? '#/ga' : '#/';
    return `${base}/${tab}${site ? '?site=' + encodeURIComponent(site) : ''}`;
  }
  CL.link = link;
  CL.state = () => state;

  // ---------- sidebar ----------
  function renderNav() {
    $('#nav').innerHTML = NAV.map((g) => `<div class="nav-group"><div class="nav-label">${icon(g.ic)}${esc(g.title)}</div>${g.items.map(([tab, label, ic]) => {
      const on = state.src === g.src && state.tab === tab;
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
    rb.disabled = state.tab === 'live' || state.tab === 'tracker';
    rb.title = rb.disabled ? 'Live and Tracker are not date based' : '';
    sb.innerHTML = `${state.site ? favicon(state.site) : icon('globe')}<span class="dd-text"><b>${esc(state.site || 'All sites')}</b></span>${icon('chev')}`;
    sb.disabled = state.tab === 'tracker';
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

  $('#siteBtn').addEventListener('click', () => {
    const list = SITES.slice();
    if (state.site && !list.includes(state.site)) list.push(state.site);
    selectMenu($('#siteBtn'), {
      title: 'Site',
      search: list.length > 6 ? 'Search sites' : '',
      value: state.site || '',
      items: [{ value: '', label: 'All sites', icon: icon('globe') }, { sep: true }, ...list.map((h) => ({ value: h, label: h, icon: favicon(h) }))],
      onSelect: (v) => { location.hash = link({ src: state.src, tab: state.tab, site: v || null }); },
    });
  });

  $('#refresh').addEventListener('click', () => {
    const b = $('#refresh');
    b.classList.add('spin'); setTimeout(() => b.classList.remove('spin'), 700);
    OWN.clear(); GA.clear(); route();
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
    const u = OWN.user();
    el.setAttribute('role', 'menu');
    el.innerHTML = `${u ? `<div class="acct"><span class="acct-av">${avatar(u)}</span><div style="min-width:0"><div class="acct-name">${esc(u.displayName || 'Signed in')}</div><div class="note">${esc(u.email || '')}</div></div></div>` : '<div class="pop-title">Not signed in</div>'}
      <div class="acct-rows">
        <div class="acct-row"><span>CodeLove Analytics</span><span class="status${u ? ' on' : ''}">${u ? 'Signed in' : 'Signed out'}</span></div>
        <div class="acct-row"><span>Google Analytics</span><span class="status${GA.signedIn() ? ' on' : ''}">${GA.signedIn() ? 'Connected' : 'Not connected'}</span></div>
      </div>
      <div class="pop-sep"></div>
      <div class="pop-title">Theme</div>
      <div class="theme-seg">${THEMES.map(([v, l, ic]) => `<button type="button" data-t="${v}" aria-pressed="${theme() === v}">${icon(ic)}${l}</button>`).join('')}</div>
      ${u || GA.signedIn() ? `<div class="pop-sep"></div><button type="button" class="mi danger" id="signoutBtn" role="menuitem">${icon('logout')}<span class="mi-label">Sign out of both</span></button>` : ''}`;
    el.querySelectorAll('.theme-seg button').forEach((b) => b.addEventListener('click', () => {
      setTheme(b.dataset.t);
      el.querySelectorAll('.theme-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      window.dispatchEvent(new Event('resize'));
    }));
    const so = $('#signoutBtn', el);
    if (so) so.addEventListener('click', () => { close(false); GA.signOut(); OWN.signOut(); route(); });
  }, { align: 'end' }));
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
    const ctx = { R: currentRange(), alive, site: state.site, tab: state.tab };
    (state.src === 'ga' ? GA : OWN).route(ctx);
    if (prev.tab !== state.tab || prev.src !== state.src) scrollTo({ top: 0 });
  }
  addEventListener('hashchange', route);

  OWN.init();
  OWN.onAuth(() => { renderAccount(); OWN.updateBadge(); if (state.src === 'own') route(); });
  route();
})();
