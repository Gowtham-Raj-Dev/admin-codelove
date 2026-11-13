/* CodeLove Analytics tracker. Add to every site:  <script defer src="https://admin.codelove.in/t.js"></script>
 * Counts visitors, visits, page views, time on page (visible + active), clicks, sources and live
 * visitors into Cloud Firestore (project codelove-analytics). No cookies; one random id in localStorage.
 * Everything is pre-aggregated into ONE document per site per day (IST): d/{YYYY-MM-DD}_{host_with_underscores},
 * so every flush is a single Firestore write. */
(function () {
  'use strict';
  var PROJECT = 'codelove-analytics';
  var API_KEY = 'AIzaSyDxvgBOnJBPpUNgoYk_8Dpk85ahxMrqv5I';
  var COMMIT = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents:commit?key=' + API_KEY;
  var DOC = 'projects/' + PROJECT + '/databases/(default)/documents/d/';
  var FLUSH_MS = 60000, IDLE_MS = 5 * 60 * 1000, SESSION_MS = 30 * 60 * 1000;
  if (window.__clTracker) return;
  window.__clTracker = 1;
  try { if (navigator.webdriver || /bot|crawl|spider|headless|lighthouse|preview/i.test(navigator.userAgent)) return; } catch (e) { return; }
  try { if (window.top !== window.self) return; } catch (e) { return; }

  var host = location.hostname.replace(/^www\./, '').toLowerCase();
  if (!/(^|\.)codelove\.in$/.test(host) && host !== 'localhost') return;
  var site = host.replace(/\./g, '_');

  function lg(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function ls(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  function sg(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ss(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } }

  var fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  var fmtHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' });
  function day() { return fmtDay.format(new Date()); }
  function hour() { return fmtHour.format(new Date()).slice(0, 2); }
  // Map keys: URL-encoded, dots encoded too, so they are safe Firestore field names.
  function key(s) { return encodeURIComponent(String(s)).replace(/\./g, '%2E').replace(/[*'()!~]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }).slice(0, 300); }
  function fp(parts) { return parts.map(function (p) { return '`' + String(p).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`'; }).join('.'); }

  var vid = lg('cl_vid');
  var isNew = !vid;
  if (!vid) { vid = (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 20); ls('cl_vid', vid); }

  // pending: { day: { 'a\u0001b\u0001c': n } }, titles: { day: { pageKey: title } }
  var pend = {}, titles = {}, titleSent = {}, curPath = '', liveDay = '', dirty = false;
  function inc(parts, n) {
    var d = day(), k = parts.join('\u0001');
    var m = pend[d] || (pend[d] = {});
    m[k] = (m[k] || 0) + (n || 1);
    dirty = true;
  }

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
      if (h === host) return null;
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

  function visit(first) {
    var d = day();
    var path = (location.pathname || '/').replace(/\/{2,}/g, '/');
    if (path.length > 1 && /\/index\.html?$/.test(path)) path = path.replace(/index\.html?$/, '');
    if (path === curPath && !first) return;
    curPath = path;
    var pk = key(path);

    if (lg('cl_day_' + site) !== d) {
      ls('cl_day_' + site, d);
      inc(['t', 'u']);
      inc(['dev', device()]);
      inc(['br', key(browser())]);
      var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { }
      inc(['tz', key(tz || 'unknown')]);
      if (isNew) inc(['t', 'n']);
      ls('cl_pages_' + site, '{}');
    }
    var last = Number(sg('cl_last_' + site) || 0);
    if (!last || Date.now() - last > SESSION_MS) {
      inc(['t', 's']);
      var src = source();
      if (src) inc(['r', key(src)]);
    }
    ss('cl_last_' + site, String(Date.now()));

    inc(['t', 'v']);
    inc(['p', pk, 'v']);
    inc(['h', hour()]);
    var seen = {}; try { seen = JSON.parse(lg('cl_pages_' + site) || '{}') || {}; } catch (e) { }
    if (!seen[pk]) {
      inc(['p', pk, 'u']);
      seen[pk] = 1;
      if (Object.keys(seen).length < 400) ls('cl_pages_' + site, JSON.stringify(seen));
    }
    flushSoon();
  }

  var timer = null;
  function flushSoon() { clearTimeout(timer); timer = setTimeout(function () { flush(false); }, 2000); }

  // time on page: seconds while visible and active (or media playing)
  var lastActive = Date.now(), lastTick = Date.now(), secAcc = 0;
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove', 'wheel'].forEach(function (ev) {
    addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true, capture: true });
  });
  function tick() {
    var now = Date.now(), dt = Math.min(now - lastTick, 5000);
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
      inc(['t', 'sec'], s);
      inc(['p', key(curPath), 'sec'], s);
    }
  }

  addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('a,button,[role=button],input[type=submit],input[type=button],summary,select,label');
    if (!el) return;
    var label = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    if (!label) { var img = el.querySelector && el.querySelector('img[alt]'); label = img ? img.alt.slice(0, 50) : el.tagName.toLowerCase(); }
    if (el.tagName === 'A' && el.href) {
      try { var u = new URL(el.href); if (u.hostname && u.hostname.replace(/^www\./, '') !== host) label += ' → ' + u.hostname.replace(/^www\./, ''); } catch (err) { }
    }
    inc(['t', 'c']);
    inc(['p', key(curPath), 'c']);
    inc(['clk', key(curPath.slice(0, 80) + ' :: ' + label)]);
    flushSoon();
  }, { capture: true, passive: true });

  // ---- build one Firestore write per day document ----
  function nest(fields, parts, value) {
    var f = fields;
    for (var i = 0; i < parts.length - 1; i++) {
      var p = parts[i];
      if (!f[p]) f[p] = { mapValue: { fields: {} } };
      f = f[p].mapValue.fields;
    }
    f[parts[parts.length - 1]] = value;
  }
  function buildWrites(final) {
    takeSeconds();
    var today = day(), cpk = key(curPath), ct = (document.title || '').trim().slice(0, 200);
    if (ct && titleSent[cpk] !== ct) { (titles[today] || (titles[today] = {}))[cpk] = ct; titleSent[cpk] = ct; }
    var visible = document.visibilityState === 'visible';
    var days = {};
    for (var d in pend) days[d] = 1;
    for (var t in titles) days[t] = 1;
    if (final || visible) days[today] = 1;
    if (liveDay && liveDay !== today) days[liveDay] = 1;
    var writes = [];
    for (var dd in days) {
      var fields = {}, mask = [], transforms = [];
      var m = pend[dd] || {};
      for (var k in m) transforms.push({ fieldPath: fp(k.split('\u0001')), increment: { integerValue: String(m[k]) } });
      var tt = titles[dd] || {};
      for (var pk in tt) { nest(fields, ['p', pk, 'ti'], { stringValue: tt[pk] }); mask.push(fp(['p', pk, 'ti'])); }
      // live presence: live.{vid} = {p, t}; removed when the tab is hidden or closed
      if (dd === today && !final && visible) {
        nest(fields, ['live', vid, 'p'], { stringValue: curPath.slice(0, 300) });
        mask.push(fp(['live', vid, 'p']));
        transforms.push({ fieldPath: fp(['live', vid, 't']), setToServerValue: 'REQUEST_TIME' });
        liveDay = today;
      } else if (liveDay === dd) {
        mask.push(fp(['live', vid])); // in mask without a value = delete
        liveDay = '';
      }
      if (!mask.length && !transforms.length) continue;
      var w = { update: { name: DOC + dd + '_' + site, fields: fields }, updateMask: { fieldPaths: mask } };
      if (transforms.length) w.updateTransforms = transforms;
      writes.push(w);
    }
    return writes;
  }

  var sending = false;
  function flush(final) {
    if (sending && !final) return;
    var sentPend = pend, sentTitles = titles;
    var writes = buildWrites(final);
    pend = {}; titles = {}; dirty = false;
    if (!writes.length) return;
    sending = true;
    fetch(COMMIT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: writes }), keepalive: !!final })
      .then(function (r) {
        sending = false;
        if (!r.ok && r.status >= 500) restore(sentPend, sentTitles);
      })
      .catch(function () { sending = false; if (!final) restore(sentPend, sentTitles); });
  }
  function restore(p, t) {
    for (var d in p) { var m = pend[d] || (pend[d] = {}); for (var k in p[d]) m[k] = (m[k] || 0) + p[d][k]; }
    for (var x in t) { var tm = titles[x] || (titles[x] = {}); for (var y in t[x]) if (!tm[y]) tm[y] = t[x][y]; }
    dirty = true;
  }
  // heartbeat: keeps "live" fresh and saves time spent; skipped while idle with nothing new
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (!dirty && secAcc < 1000 && Date.now() - lastActive > IDLE_MS) return;
    flush(false);
  }, FLUSH_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
    else { lastActive = lastTick = Date.now(); flushSoon(); }
  });
  addEventListener('pagehide', function () { flush(true); });

  // SPA navigation
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); setTimeout(function () { takeSeconds(); visit(false); }, 50); return r; };
  });
  addEventListener('popstate', function () { setTimeout(function () { takeSeconds(); visit(false); }, 50); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { visit(true); });
  else visit(true);
})();
