/* CodeLove Analytics tracker — <script defer src="https://admin.codelove.in/t.js"></script>
 * Counts visitors, visits, page views, time on page (visible + active), clicks, sources and live
 * visitors into the CodeLove Firebase Realtime Database. No cookies; one random id in localStorage.
 * Everything is pre-aggregated per day (Asia/Kolkata), so nothing personal is stored. */
(function () {
  'use strict';
  var DB = 'https://codelove-analytics-default-rtdb.firebaseio.com';
  var FLUSH_MS = 15000, IDLE_MS = 5 * 60 * 1000, SESSION_MS = 30 * 60 * 1000;
  if (window.__clTracker) return;
  window.__clTracker = 1;
  try { if (navigator.webdriver || /bot|crawl|spider|headless|lighthouse|preview/i.test(navigator.userAgent)) return; } catch (e) { return; }
  try { if (window.top !== window.self) return; } catch (e) { return; }

  var host = location.hostname.replace(/^www\./, '').toLowerCase();
  if (!/(^|\.)codelove\.in$/.test(host) && host !== 'localhost') return;
  var site = host.replace(/\./g, '_');

  // ---- storage (never required) ----
  function lg(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function ls(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  function sg(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ss(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } }

  var fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  var fmtHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' });
  function day() { return fmtDay.format(new Date()); }
  function hour() { return fmtHour.format(new Date()).slice(0, 2); }
  function key(s) { return encodeURIComponent(String(s)).replace(/\./g, '%2E').replace(/[*'()!~]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }).slice(0, 380); }

  var vid = lg('cl_vid');
  var isNew = !vid;
  if (!vid) { vid = (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 20); ls('cl_vid', vid); }

  // ---- pending increments, flushed in one multi-path PATCH ----
  var pend = {}, liveDirty = true, curPath = '';
  function inc(path, n) { pend[path] = (pend[path] || 0) + (n || 1); }
  function base() { return 'd/' + day() + '/' + site + '/'; }

  function device() {
    var ua = navigator.userAgent;
    if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'Tablet';
    if (/Mobi|iPhone|iPod|Android.*Mobile|Opera Mini|IEMobile/i.test(ua)) return 'Mobile';
    return 'Desktop';
  }
  function browser() {
    var ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/SamsungBrowser/.test(ua)) return 'Samsung';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return /; wv\)/.test(ua) ? 'Android WebView' : 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Other';
  }
  function source() {
    var q = new URLSearchParams(location.search);
    var utm = q.get('utm_source') || q.get('ref') || q.get('source');
    if (utm) return utm.toLowerCase().slice(0, 60);
    var r = document.referrer;
    if (!r) return 'direct';
    try {
      var h = new URL(r).hostname.replace(/^www\./, '').toLowerCase();
      if (h === host) return null; // internal navigation
      if (/(^|\.)google\./.test(h)) return 'google';
      if (/(^|\.)bing\.com$/.test(h)) return 'bing';
      if (/youtube\.com$|youtu\.be$/.test(h)) return 'youtube';
      if (/facebook\.com$|fb\.com$/.test(h)) return 'facebook';
      if (/instagram\.com$/.test(h)) return 'instagram';
      if (/t\.co$|twitter\.com$|x\.com$/.test(h)) return 'x/twitter';
      if (/whatsapp/.test(h)) return 'whatsapp';
      if (/duckduckgo/.test(h)) return 'duckduckgo';
      if (/yahoo\./.test(h)) return 'yahoo';
      return h;
    } catch (e) { return 'direct'; }
  }

  // ---- visitor / session / page view ----
  function visit(first) {
    var d = day(), b = base();
    var path = (location.pathname || '/').replace(/\/{2,}/g, '/');
    if (path.length > 1 && /\/index\.html?$/.test(path)) path = path.replace(/index\.html?$/, '');
    if (path === curPath && !first) return;
    curPath = path;
    var pk = key(path);

    // user per day (per site)
    if (lg('cl_day_' + site) !== d) {
      ls('cl_day_' + site, d);
      inc(b + 't/u');
      inc(b + 'dev/' + device());
      inc(b + 'br/' + key(browser()));
      var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { }
      inc(b + 'tz/' + key(tz || 'unknown'));
      if (isNew) inc(b + 't/n');
      ls('cl_pages_' + site, '{}');
    }
    // session (visit): new after 30 min of no activity
    var last = Number(sg('cl_last_' + site) || 0);
    if (!last || Date.now() - last > SESSION_MS) {
      inc(b + 't/s');
      var src = source();
      if (src) inc(b + 'r/' + key(src));
    }
    ss('cl_last_' + site, String(Date.now()));

    // page view + unique viewer of this page today
    inc(b + 't/v');
    inc(b + 'p/' + pk + '/v');
    inc(b + 'h/' + hour());
    var seen = {}; try { seen = JSON.parse(lg('cl_pages_' + site) || '{}') || {}; } catch (e) { }
    if (!seen[pk]) {
      inc(b + 'p/' + pk + '/u');
      seen[pk] = 1;
      var keys = Object.keys(seen); if (keys.length < 400) ls('cl_pages_' + site, JSON.stringify(seen));
    }
    liveDirty = true;
    flushSoon();
  }

  var titles = {}, titleSent = {};
  var timer = null;
  function flushSoon() { clearTimeout(timer); timer = setTimeout(flush, 1500); }

  // ---- time on page: count seconds while visible and active ----
  var lastActive = Date.now(), lastTick = Date.now(), secAcc = 0;
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove', 'wheel'].forEach(function (ev) {
    addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true, capture: true });
  });
  function tick() {
    var now = Date.now();
    var dt = Math.min(now - lastTick, 5000);
    lastTick = now;
    var playing = false;
    try { playing = Array.prototype.some.call(document.querySelectorAll('video,audio'), function (m) { return !m.paused && !m.ended; }); } catch (e) { }
    if (document.visibilityState === 'visible' && (now - lastActive < IDLE_MS || playing)) secAcc += dt;
  }
  setInterval(tick, 1000);
  function takeSeconds() {
    tick();
    var s = Math.floor(secAcc / 1000);
    if (s > 0) {
      secAcc -= s * 1000;
      s = Math.min(s, 600);
      var b = base();
      inc(b + 't/sec', s);
      inc(b + 'p/' + key(curPath) + '/sec', s);
    }
  }

  // ---- clicks ----
  addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('a,button,[role=button],input[type=submit],input[type=button],summary,select,label');
    if (!el) return;
    var label = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    if (!label) { var img = el.querySelector && el.querySelector('img[alt]'); label = img ? img.alt.slice(0, 50) : el.tagName.toLowerCase(); }
    if (el.tagName === 'A' && el.href) {
      try { var u = new URL(el.href); if (u.hostname && u.hostname.replace(/^www\./, '') !== host) label += ' → ' + u.hostname.replace(/^www\./, ''); } catch (err) { }
    }
    var b = base();
    inc(b + 't/c');
    inc(b + 'p/' + key(curPath) + '/c');
    inc(b + 'clk/' + key(curPath + ' :: ' + label));
    flushSoon();
  }, { capture: true, passive: true });

  // ---- send ----
  var sending = false;
  function body(final) {
    takeSeconds();
    var cpk = key(curPath), ct = (document.title || '').trim().slice(0, 280);
    if (ct && titleSent[cpk] !== ct) { titles[cpk] = ct; titleSent[cpk] = ct; }
    var out = {}, any = false;
    for (var k in pend) { out[k] = { '.sv': { increment: pend[k] } }; any = true; }
    for (var t in titles) { out['titles/' + site + '/' + t] = titles[t]; any = true; }
    if (final) { out['live/' + site + '/' + vid] = null; any = true; }
    else if (document.visibilityState === 'visible' && (liveDirty || any || Date.now() - lastActive < IDLE_MS)) {
      out['live/' + site + '/' + vid] = { p: curPath, t: { '.sv': 'timestamp' } }; any = true;
    }
    return any ? out : null;
  }
  function flush(final) {
    if (sending && !final) return;
    var b = body(final);
    if (!b) return;
    var sent = pend, sentTitles = titles;
    pend = {}; titles = {}; liveDirty = false;
    sending = true;
    var opts = { method: 'PATCH', body: JSON.stringify(b), keepalive: !!final };
    fetch(DB + '/.json', opts).then(function (r) {
      sending = false;
      if (!r.ok && r.status !== 401 && r.status !== 403) restore(sent, sentTitles);
    }).catch(function () { sending = false; if (!final) restore(sent, sentTitles); });
  }
  function restore(p, t) {
    for (var k in p) pend[k] = (pend[k] || 0) + p[k];
    for (var x in t) if (!titles[x]) titles[x] = t[x];
  }
  setInterval(function () { flush(false); }, FLUSH_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
    else { lastActive = lastTick = Date.now(); liveDirty = true; flushSoon(); }
  });
  addEventListener('pagehide', function () { flush(true); });

  // ---- SPA navigation ----
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); setTimeout(function () { takeSeconds(); visit(false); }, 50); return r; };
  });
  addEventListener('popstate', function () { setTimeout(function () { takeSeconds(); visit(false); }, 50); });

  // seconds belong to the page that was open, so attribute before switching (handled in takeSeconds call above)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { visit(true); });
  else visit(true);
})();
