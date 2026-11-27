/* Shared helpers for CodeLove Admin: formatting, dates, range state, icons, dropdowns, charts, tables, Google sign-in. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const CFG = window.ADMIN_CONFIG || {};

  const store = {
    get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
    set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---------- formatting ----------
  const nf = new Intl.NumberFormat('en-IN');
  const num = (n) => nf.format(Math.round(n || 0));
  const compact = (n) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  const pct = (n) => (n == null || !isFinite(n) ? '–' : (n * 100).toFixed(1) + '%');
  function dur(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + 's';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h >= 24) { const d = Math.floor(h / 24); return `${d}d ${h % 24}h`; }
    if (h) return `${h}h ${m}m`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  // Axis tick labels. Ticks are multiples of a step from axisMax(), so they come out whole.
  const durAxis = (v) => { v = Math.round(v); return v && v % 86400 === 0 ? v / 86400 + 'd' : v && v % 3600 === 0 ? v / 3600 + 'h' : v && v % 60 === 0 ? v / 60 + 'm' : v + 's'; };
  durAxis.kind = 'dur';
  const pctAxis = (v) => Math.round(v * 100) + '%';
  pctAxis.kind = 'pct';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const div = (a, b) => (b ? a / b : 0);

  // ---------- dates (local calendar days; the site runs in IST) ----------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const istToday = () => parseIso(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const fmtDate = (s) => parseIso(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const rangeText = (R) => (R.start === R.end ? fmtDate(R.start) : `${fmtDate(R.start)} – ${fmtDate(R.end)}`);
  function shortRange(start, end) {
    const a = parseIso(start), b = parseIso(end), y = istToday().getFullYear();
    const f = (d, withYear) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
    if (start === end) return f(a, a.getFullYear() !== y);
    const yrs = a.getFullYear() !== b.getFullYear() || b.getFullYear() !== y;
    return `${f(a, yrs)} – ${f(b, yrs)}`;
  }
  function eachDay(start, end, fn) { for (let d = parseIso(start); d <= parseIso(end); d = addDays(d, 1)) fn(iso(d), d); }

  // ---------- date range state (shared by both sections) ----------
  const PRESETS = [
    { v: 'today', label: 'Today' },
    { v: 'yesterday', label: 'Yesterday' },
    { v: '7', label: 'Last 7 days' },
    { v: '28', label: 'Last 28 days' },
    { v: '90', label: 'Last 90 days' },
    { v: '365', label: 'Last 12 months' },
    { v: 'mtd', label: 'This month' },
    { v: 'lastmonth', label: 'Last month' },
    { v: 'since', label: 'Since tracking started' },
  ];
  const range = { preset: '28', from: '', to: '' };
  (() => {
    const p = store.get('cl_admin_range');
    if (p && (p === 'custom' || PRESETS.some((x) => x.v === p))) range.preset = p;
    range.from = store.get('cl_admin_from') || '';
    range.to = store.get('cl_admin_to') || '';
    if (range.preset === 'custom' && !(range.from && range.to)) range.preset = '28';
  })();
  function rangeBounds(preset, from, to) {
    const today = istToday();
    let start, end = today;
    switch (preset) {
      case 'today': start = today; break;
      case 'yesterday': start = end = addDays(today, -1); break;
      case 'mtd': start = new Date(today.getFullYear(), today.getMonth(), 1); break;
      case 'lastmonth': start = new Date(today.getFullYear(), today.getMonth() - 1, 1); end = new Date(today.getFullYear(), today.getMonth(), 0); break;
      case 'since': start = CFG.trackingSince ? parseIso(CFG.trackingSince) : addDays(today, -27); if (start > today) start = today; break;
      case 'custom':
        start = from ? parseIso(from) : addDays(today, -27);
        end = to ? parseIso(to) : today;
        if (start > end) [start, end] = [end, start];
        break;
      default: start = addDays(today, -((Number(preset) || 28) - 1));
    }
    return { start: iso(start), end: iso(end) };
  }
  function currentRange() {
    const { start, end } = rangeBounds(range.preset, range.from, range.to);
    const days = Math.round((parseIso(end) - parseIso(start)) / 864e5) + 1;
    const prevEnd = addDays(parseIso(start), -1), prevStart = addDays(prevEnd, -(days - 1));
    return { start, end, prevStart: iso(prevStart), prevEnd: iso(prevEnd), days, preset: range.preset };
  }
  function setRange(preset, from = '', to = '') {
    range.preset = preset;
    store.set('cl_admin_range', preset);
    if (preset === 'custom') { range.from = from; range.to = to; store.set('cl_admin_from', from); store.set('cl_admin_to', to); }
  }
  const rangeLabel = () => (PRESETS.find((p) => p.v === range.preset) || { label: 'Custom range' }).label;

  // ---------- icons: Google Material Symbols (Rounded, 24px, fill = currentColor) ----------
  // Paths come from fonts.gstatic.com/s/i/short-term/release/materialsymbolsrounded/<name>/default/24px.svg
  const ICONS = {
    grid: 'M520-640v-160q0-17 11.5-28.5T560-840h240q17 0 28.5 11.5T840-800v160q0 17-11.5 28.5T800-600H560q-17 0-28.5-11.5T520-640ZM120-480v-320q0-17 11.5-28.5T160-840h240q17 0 28.5 11.5T440-800v320q0 17-11.5 28.5T400-440H160q-17 0-28.5-11.5T120-480Zm400 320v-320q0-17 11.5-28.5T560-520h240q17 0 28.5 11.5T840-480v320q0 17-11.5 28.5T800-120H560q-17 0-28.5-11.5T520-160Zm-400 0v-160q0-17 11.5-28.5T160-360h240q17 0 28.5 11.5T440-320v160q0 17-11.5 28.5T400-120H160q-17 0-28.5-11.5T120-160Zm80-360h160v-240H200v240Zm400 320h160v-240H600v240Zm0-480h160v-80H600v80ZM200-200h160v-80H200v80Zm160-320Zm240-160Zm0 240ZM360-280Z',
    file: 'M360-240h240q17 0 28.5-11.5T640-280q0-17-11.5-28.5T600-320H360q-17 0-28.5 11.5T320-280q0 17 11.5 28.5T360-240Zm0-160h240q17 0 28.5-11.5T640-440q0-17-11.5-28.5T600-480H360q-17 0-28.5 11.5T320-440q0 17 11.5 28.5T360-400ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h287q16 0 30.5 6t25.5 17l194 194q11 11 17 25.5t6 30.5v447q0 33-23.5 56.5T720-80H240Zm280-560v-160H240v640h480v-440H560q-17 0-28.5-11.5T520-640ZM240-800v200-200 640-640Z',
    live: 'M160-480q0 56 17 105.5t49 89.5q11 14 11 30.5T225-226q-12 12-29 11.5T168-229q-42-52-65-115.5T80-480q0-72 23-136t65-115q11-14 28-14.5t29 11.5q12 12 12 28.5T226-675q-32 41-49 90.5T160-480Zm160 0q0 23 6 43.5t17 38.5q9 14 8.5 31T339-338q-12 12-29 11.5T284-341q-21-29-32.5-65T240-480q0-39 11.5-74.5T284-619q10-14 26.5-14t28.5 12q12 12 12.5 28.5T343-562q-11 18-17 38.5t-6 43.5Zm103.5 56.5Q400-447 400-480t23.5-56.5Q447-560 480-560t56.5 23.5Q560-513 560-480t-23.5 56.5Q513-400 480-400t-56.5-23.5ZM640-480q0-23-6-43.5T617-562q-9-14-8-31t13-29q12-12 28-11.5t26 14.5q21 29 32.5 64.5T720-480q0 38-11.5 74T676-341q-9 14-26 14t-29-12q-12-12-12.5-28.5T617-398q11-18 17-38.5t6-43.5Zm160 0q0-56-17-105.5T734-675q-11-14-11.5-30.5T734-734q12-12 29.5-11.5T792-731q42 51 65 115t23 136q0 72-23 135.5T792-229q-11 14-28 14.5T735-226q-12-12-12-28.5t11-30.5q32-41 49-90.5T800-480Z',
    code: 'm193-479 155 155q11 11 11 28t-11 28q-11 11-28 11t-28-11L108-452q-6-6-8.5-13T97-480q0-8 2.5-15t8.5-13l184-184q12-12 28.5-12t28.5 12q12 12 12 28.5T349-635L193-479Zm574-2L612-636q-11-11-11-28t11-28q11-11 28-11t28 11l184 184q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L668-268q-12 12-28 11.5T612-269q-12-12-12-28.5t12-28.5l155-155Z',
    calendar: 'M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-40q0-17 11.5-28.5T280-880q17 0 28.5 11.5T320-840v40h320v-40q0-17 11.5-28.5T680-880q17 0 28.5 11.5T720-840v40h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Zm280 240q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z',
    globe: 'M325-111.5q-73-31.5-127.5-86t-86-127.5Q80-398 80-480.5t31.5-155q31.5-72.5 86-127t127.5-86Q398-880 480.5-880t155 31.5q72.5 31.5 127 86t86 127Q880-563 880-480.5T848.5-325q-31.5 73-86 127.5t-127 86Q563-80 480.5-80T325-111.5ZM480-162q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z',
    refresh: 'M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-70q0-17 11.5-28.5T760-800q17 0 28.5 11.5T800-760v200q0 17-11.5 28.5T760-520H560q-17 0-28.5-11.5T520-560q0-17 11.5-28.5T560-600h128q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q68 0 124.5-34.5T692-367q8-14 22.5-19.5t29.5-.5q16 5 23 21t-1 30q-41 80-117 128t-169 48Z',
    chev: 'M465-364.5q-7-2.5-13-8.5L268-557q-11-11-11-28t11-28q11-11 28-11t28 11l156 156 156-156q11-11 28-11t28 11q11 11 11 28t-11 28L508-373q-6 6-13 8.5t-15 2.5q-8 0-15-2.5Z',
    check: 'm382-354 339-339q12-12 28-12t28 12q12 12 12 28.5T777-636L410-268q-12 12-28 12t-28-12L182-440q-12-12-11.5-28.5T183-497q12-12 28.5-12t28.5 12l142 143Z',
    menu: 'M160-240q-17 0-28.5-11.5T120-280q0-17 11.5-28.5T160-320h640q17 0 28.5 11.5T840-280q0 17-11.5 28.5T800-240H160Zm0-200q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520h640q17 0 28.5 11.5T840-480q0 17-11.5 28.5T800-440H160Zm0-200q-17 0-28.5-11.5T120-680q0-17 11.5-28.5T160-720h640q17 0 28.5 11.5T840-680q0 17-11.5 28.5T800-640H160Z',
    x: 'M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z',
    sun: 'M565-395q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Zm-226.5 56.5Q280-397 280-480t58.5-141.5Q397-680 480-680t141.5 58.5Q680-563 680-480t-58.5 141.5Q563-280 480-280t-141.5-58.5ZM80-440q-17 0-28.5-11.5T40-480q0-17 11.5-28.5T80-520h80q17 0 28.5 11.5T200-480q0 17-11.5 28.5T160-440H80Zm720 0q-17 0-28.5-11.5T760-480q0-17 11.5-28.5T800-520h80q17 0 28.5 11.5T920-480q0 17-11.5 28.5T880-440h-80ZM451.5-771.5Q440-783 440-800v-80q0-17 11.5-28.5T480-920q17 0 28.5 11.5T520-880v80q0 17-11.5 28.5T480-760q-17 0-28.5-11.5Zm0 720Q440-63 440-80v-80q0-17 11.5-28.5T480-200q17 0 28.5 11.5T520-160v80q0 17-11.5 28.5T480-40q-17 0-28.5-11.5ZM226-678l-43-42q-12-11-11.5-28t11.5-29q12-12 29-12t28 12l42 43q11 12 11 28t-11 28q-11 12-27.5 11.5T226-678Zm494 495-42-43q-11-12-11-28.5t11-27.5q11-12 27.5-11.5T734-282l43 42q12 11 11.5 28T777-183q-12 12-29 12t-28-12Zm-42-495q-12-11-11.5-27.5T678-734l42-43q11-12 28-11.5t29 11.5q12 12 12 29t-12 28l-43 42q-12 11-28 11t-28-11ZM183-183q-12-12-12-29t12-28l43-42q12-11 28.5-11t27.5 11q12 11 11.5 27.5T282-226l-42 43q-11 12-28 11.5T183-183Zm297-297Z',
    moon: 'M480-120q-151 0-255.5-104.5T120-480q0-138 90-239.5T440-838q13-2 23 3.5t16 14.5q6 9 6.5 21t-7.5 23q-17 26-25.5 55t-8.5 61q0 90 63 153t153 63q31 0 61.5-9t54.5-25q11-7 22.5-6.5T819-479q10 5 15.5 15t3.5 24q-14 138-117.5 229T480-120Zm0-80q88 0 158-48.5T740-375q-20 5-40 8t-40 3q-123 0-209.5-86.5T364-660q0-20 3-40t8-40q-78 32-126.5 102T200-480q0 116 82 198t198 82Zm-10-270Z',
    monitor: 'M400-200v-80H160q-33 0-56.5-23.5T80-360v-400q0-33 23.5-56.5T160-840h640q33 0 56.5 23.5T880-760v400q0 33-23.5 56.5T800-280H560v80h40q17 0 28.5 11.5T640-160q0 17-11.5 28.5T600-120H360q-17 0-28.5-11.5T320-160q0-17 11.5-28.5T360-200h40ZM160-360h640v-400H160v400Zm0 0v-400 400Z',
    logout: 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h240q17 0 28.5 11.5T480-800q0 17-11.5 28.5T440-760H200v560h240q17 0 28.5 11.5T480-160q0 17-11.5 28.5T440-120H200Zm487-320H400q-17 0-28.5-11.5T360-480q0-17 11.5-28.5T400-520h287l-75-75q-11-11-11-27t11-28q11-12 28-12.5t29 11.5l143 143q12 12 12 28t-12 28L669-309q-12 12-28.5 11.5T612-310q-11-12-10.5-28.5T613-366l74-74Z',
    ext: 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h240q17 0 28.5 11.5T480-800q0 17-11.5 28.5T440-760H200v560h560v-240q0-17 11.5-28.5T800-480q17 0 28.5 11.5T840-440v240q0 33-23.5 56.5T760-120H200Zm560-584L416-360q-11 11-28 11t-28-11q-11-11-11-28t11-28l344-344H600q-17 0-28.5-11.5T560-800q0-17 11.5-28.5T600-840h200q17 0 28.5 11.5T840-800v200q0 17-11.5 28.5T800-560q-17 0-28.5-11.5T760-600v-104Z',
    bars: 'M680-160q-17 0-28.5-11.5T640-200v-200q0-17 11.5-28.5T680-440h80q17 0 28.5 11.5T800-400v200q0 17-11.5 28.5T760-160h-80Zm-240 0q-17 0-28.5-11.5T400-200v-560q0-17 11.5-28.5T440-800h80q17 0 28.5 11.5T560-760v560q0 17-11.5 28.5T520-160h-80Zm-240 0q-17 0-28.5-11.5T160-200v-360q0-17 11.5-28.5T200-600h80q17 0 28.5 11.5T320-560v360q0 17-11.5 28.5T280-160h-80Z',
    heart: 'M451.5-152q-14.5-5-25.5-16l-69-63q-106-97-191.5-192.5T80-634q0-94 63-157t157-63q53 0 100 22.5t80 61.5q33-39 80-61.5T660-854q94 0 157 63t63 157q0 115-85 211T602-230l-68 62q-11 11-25.5 16t-28.5 5q-14 0-28.5-5ZM442-690q-29-41-62-62.5T300-774q-60 0-100 40t-40 100q0 52 37 110.5T285.5-410q51.5 55 106 103t88.5 79q34-31 88.5-79t106-103Q726-465 763-523.5T800-634q0-60-40-100t-100-40q-47 0-80 21.5T518-690q-7 10-17 15t-21 5q-11 0-21-5t-17-15Zm38 189Z',
    info: 'M508.5-291.5Q520-303 520-320v-160q0-17-11.5-28.5T480-520q-17 0-28.5 11.5T440-480v160q0 17 11.5 28.5T480-280q17 0 28.5-11.5Zm0-320Q520-623 520-640t-11.5-28.5Q497-680 480-680t-28.5 11.5Q440-657 440-640t11.5 28.5Q463-600 480-600t28.5-11.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z',
    search: 'M380-320q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l224 224q11 11 11 28t-11 28q-11 11-28 11t-28-11L532-372q-30 24-69 38t-83 14Zm0-80q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z',
    download: 'M465-339.5q-7-2.5-13-8.5L308-492q-12-12-11.5-28t11.5-28q12-12 28.5-12.5T365-549l75 75v-286q0-17 11.5-28.5T480-800q17 0 28.5 11.5T520-760v286l75-75q12-12 28.5-11.5T652-548q11 12 11.5 28T652-492L508-348q-6 6-13 8.5t-15 2.5q-8 0-15-2.5ZM240-160q-33 0-56.5-23.5T160-240v-80q0-17 11.5-28.5T200-360q17 0 28.5 11.5T240-320v80h480v-80q0-17 11.5-28.5T760-360q17 0 28.5 11.5T800-320v80q0 33-23.5 56.5T720-160H240Z',
    copy: 'M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-520q0-17 11.5-28.5T160-720q17 0 28.5 11.5T200-680v520h400q17 0 28.5 11.5T640-120q0 17-11.5 28.5T600-80H200Zm160-240v-480 480Z',
    alert: 'M109-120q-11 0-20-5.5T75-140q-5-9-5.5-19.5T75-180l370-640q6-10 15.5-15t19.5-5q10 0 19.5 5t15.5 15l370 640q6 10 5.5 20.5T885-140q-5 9-14 14.5t-20 5.5H109Zm69-80h604L480-720 178-200Zm330.5-51.5Q520-263 520-280t-11.5-28.5Q497-320 480-320t-28.5 11.5Q440-297 440-280t11.5 28.5Q463-240 480-240t28.5-11.5Zm0-120Q520-383 520-400v-120q0-17-11.5-28.5T480-560q-17 0-28.5 11.5T440-520v120q0 17 11.5 28.5T480-360q17 0 28.5-11.5ZM480-460Z',
    key: 'M223.5-423.5Q200-447 200-480t23.5-56.5Q247-560 280-560t56.5 23.5Q360-513 360-480t-23.5 56.5Q313-400 280-400t-56.5-23.5ZM280-240q-100 0-170-70T40-480q0-100 70-170t170-70q67 0 121.5 33t86.5 87h335q8 0 15.5 3t13.5 9l80 80q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L805-325q-5 5-12 8t-14 4q-7 1-14-1t-13-7l-52-39-57 43q-5 4-11 6t-12 2q-6 0-12.5-2t-11.5-6l-61-43h-47q-32 54-86.5 87T280-240Zm0-80q56 0 98.5-34t56.5-86h125l58 41v.5-.5l82-61 71 55 75-75h-.5.5l-40-40v-.5.5H435q-14-52-56.5-86T280-640q-66 0-113 47t-47 113q0 66 47 113t113 47Z',
    tool: 'M360-360q-100 0-170-70t-70-170q0-20 3-40t11-38q5-10 12.5-15t16.5-7q9-2 18.5.5T199-689l105 105 72-72-105-105q-8-8-10.5-17.5T260-797q2-9 7-16.5t15-12.5q18-8 38-11t40-3q100 0 170 70t70 170q0 23-4 43.5T584-516l202 200q29 29 29 71t-29 71q-29 29-71 29t-71-30L444-376q-20 8-40.5 12t-43.5 4Zm0-80q26 0 52-8t47-25l243 243q5 5 13.5 4.5T729-231q5-5 5-13.5t-5-13.5L486-500q18-20 26-46.5t8-53.5q0-60-38.5-104.5T386-758l74 74q12 12 12 28t-12 28L332-500q-12 12-28 12t-28-12l-74-74q9 57 53.5 95.5T360-440Zm109-51Z',
    gauge: 'M480-316.5q38-.5 56-27.5l169-253q9-14-2.5-25.5T677-625L424-456q-27 18-28.5 55t22.5 61q24 24 62 23.5Zm0-483.5q36 0 71 6t68 19q16 6 34 22.5t10 31.5q-8 15-36 20t-45-1q-25-9-50.5-13.5T480-720q-133 0-226.5 93.5T160-400q0 42 11.5 83t32.5 77h552q23-38 33.5-79t10.5-85q0-26-4.5-51T782-504q-6-17-2-33t18-27q13-10 28.5-6t21.5 18q15 35 23 71.5t9 74.5q1 57-13 109t-41 99q-11 18-30 28t-40 10H204q-21 0-40-10t-30-28q-26-45-40-95.5T80-400q0-83 31.5-155.5t86-127Q252-737 325-768.5T480-800Zm7 313Z',
    link: 'M280-280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h120q17 0 28.5 11.5T440-640q0 17-11.5 28.5T400-600H280q-50 0-85 35t-35 85q0 50 35 85t85 35h120q17 0 28.5 11.5T440-320q0 17-11.5 28.5T400-280H280Zm80-160q-17 0-28.5-11.5T320-480q0-17 11.5-28.5T360-520h240q17 0 28.5 11.5T640-480q0 17-11.5 28.5T600-440H360Zm200 160q-17 0-28.5-11.5T520-320q0-17 11.5-28.5T560-360h120q50 0 85-35t35-85q0-50-35-85t-85-35H560q-17 0-28.5-11.5T520-640q0-17 11.5-28.5T560-680h120q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H560Z',
    coin: 'M324-370q14 48 43.5 77.5T444-252v17q0 14 10.5 24.5T479-200q14 0 24.5-10.5T514-235v-15q50-9 86-39t36-89q0-42-24-77t-96-61q-60-20-83-35t-23-41q0-26 18.5-41t53.5-15q32 0 50 15.5t26 38.5l64-26q-11-35-40.5-61T516-710v-15q0-14-10.5-24.5T481-760q-14 0-24.5 10.5T446-725v15q-50 11-78 44t-28 74q0 47 27.5 76t86.5 50q63 23 87.5 41t24.5 47q0 33-23.5 48.5T486-314q-33 0-58.5-20.5T390-396l-66 26ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z',
    eyeoff: 'M607-627q29 29 42.5 66t9.5 76q0 15-11 25.5T622-449q-15 0-25.5-10.5T586-485q5-26-3-50t-25-41q-17-17-41-26t-51-4q-15 0-25.5-11T430-643q0-15 10.5-25.5T466-679q38-4 75 9.5t66 42.5Zm-127-93q-19 0-37 1.5t-36 5.5q-17 3-30.5-5T358-742q-5-16 3.5-31t24.5-18q23-5 46.5-7t47.5-2q137 0 250.5 72T904-534q4 8 6 16.5t2 17.5q0 9-1.5 17.5T905-466q-18 40-44.5 75T802-327q-12 11-28 9t-26-16q-10-14-8.5-30.5T753-392q24-23 44-50t35-58q-50-101-144.5-160.5T480-720Zm0 520q-134 0-245-72.5T60-463q-5-8-7.5-17.5T50-500q0-10 2-19t7-18q20-40 46.5-76.5T166-680l-83-84q-11-12-10.5-28.5T84-820q11-11 28-11t28 11l680 680q11 11 11.5 27.5T820-84q-11 11-28 11t-28-11L624-222q-35 11-71 16.5t-73 5.5ZM222-624q-29 26-53 57t-41 67q50 101 144.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z',
    history: 'M480-120q-126 0-223-76.5T131-392q-4-15 6-27.5t27-14.5q16-2 29 6t18 24q24 90 99 147t170 57q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h70q17 0 28.5 11.5T360-600q0 17-11.5 28.5T320-560H160q-17 0-28.5-11.5T120-600v-160q0-17 11.5-28.5T160-800q17 0 28.5 11.5T200-760v54q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm40-376 100 100q11 11 11 28t-11 28q-11 11-28 11t-28-11L452-452q-6-6-9-13.5t-3-15.5v-159q0-17 11.5-28.5T480-680q17 0 28.5 11.5T520-640v144Z',
    health: 'M420-440v60q0 17 11.5 28.5T460-340h40q17 0 28.5-11.5T540-380v-60h60q17 0 28.5-11.5T640-480v-40q0-17-11.5-28.5T600-560h-60v-60q0-17-11.5-28.5T500-660h-40q-17 0-28.5 11.5T420-620v60h-60q-17 0-28.5 11.5T320-520v40q0 17 11.5 28.5T360-440h60Zm47 355q-6-1-12-3-135-45-215-166.5T160-516v-189q0-25 14.5-45t37.5-29l240-90q14-5 28-5t28 5l240 90q23 9 37.5 29t14.5 45v189q0 140-80 261.5T505-88q-6 2-12 3t-13 1q-7 0-13-1Zm13-79q104-33 172-132t68-220v-189l-240-90-240 90v189q0 121 68 220t172 132Zm0-316Z',
    uptime: 'M80-720q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v80q0 17-11.5 28.5T840-600q-17 0-28.5-11.5T800-640v-80H160v80q0 17-11.5 28.5T120-600q-17 0-28.5-11.5T80-640v-80Zm80 560q-33 0-56.5-23.5T80-240v-80q0-17 11.5-28.5T120-360q17 0 28.5 11.5T160-320v80h640v-80q0-17 11.5-28.5T840-360q17 0 28.5 11.5T880-320v80q0 33-23.5 56.5T800-160H160Zm261-125.5q10-5.5 15-16.5l124-248 44 88q5 11 15 16.5t21 5.5h200q17 0 28.5-11.5T880-480q0-17-11.5-28.5T840-520H665l-69-138q-5-11-15-15.5t-21-4.5q-11 0-21 4.5T524-658L400-410l-44-88q-5-11-15-16.5t-21-5.5H120q-17 0-28.5 11.5T80-480q0 17 11.5 28.5T120-440h175l69 138q5 11 15 16.5t21 5.5q11 0 21-5.5ZM480-480Z',
    fact: 'M160-120q-33 0-56.5-23.5T80-200v-560q0-33 23.5-56.5T160-840h640q33 0 56.5 23.5T880-760v560q0 33-23.5 56.5T800-120H160Zm0-80h640v-560H160v560Zm200-80q17 0 28.5-11.5T400-320q0-17-11.5-28.5T360-360H240q-17 0-28.5 11.5T200-320q0 17 11.5 28.5T240-280h120Zm222-193-29-29q-12-12-28-11.5T497-501q-11 12-11.5 28t11.5 28l57 57q12 12 28 12t28-12l142-142q12-12 12-28t-12-28q-12-12-28.5-12T695-586L582-473Zm-222 33q17 0 28.5-11.5T400-480q0-17-11.5-28.5T360-520H240q-17 0-28.5 11.5T200-480q0 17 11.5 28.5T240-440h120Zm0-160q17 0 28.5-11.5T400-640q0-17-11.5-28.5T360-680H240q-17 0-28.5 11.5T200-640q0 17 11.5 28.5T240-600h120ZM160-200v-560 560Z',
    linkoff: 'm625-449-71-71h46q17 0 28.5 11.5T640-480q0 10-4 18t-11 13ZM820-84q-11 11-28 11t-28-11L84-764q-11-11-11-28t11-28q11-11 28-11t28 11l680 680q11 11 11 28t-11 28ZM280-280q-83 0-141.5-58.5T80-480q0-69 42-123t108-71l74 74h-24q-50 0-85 35t-35 85q0 50 35 85t85 35h120q17 0 28.5 11.5T440-320q0 17-11.5 28.5T400-280H280Zm80-160q-17 0-28.5-11.5T320-480q0-17 11.5-28.5T360-520h25l79 80H360Zm380 112q-9-14-6.5-30t16.5-25q23-17 36.5-42t13.5-55q0-50-35-85t-85-35H560q-17 0-28.5-11.5T520-640q0-17 11.5-28.5T560-680h120q83 0 141.5 58.5T880-480q0 49-22.5 91.5T795-318q-14 9-30 6.5T740-328Z',
    trend: 'M108-255q-12-12-11.5-28.5T108-311l211-214q23-23 57-23t57 23l103 104 208-206h-64q-17 0-28.5-11.5T640-667q0-17 11.5-28.5T680-707h160q17 0 28.5 11.5T880-667v160q0 17-11.5 28.5T840-467q-17 0-28.5-11.5T800-507v-64L593-364q-23 23-57 23t-57-23L376-467 164-255q-11 11-28 11t-28-11Z',
    addlink: 'M680-280h-81q-17 0-28-11.5T560-320q0-17 11.5-28.5T600-360h80v-80q0-17 11.5-28.5T720-480q17 0 28.5 11.5T760-440v80h80q17 0 28.5 11.5T880-320q0 17-11.5 28.5T840-280h-80v80q0 17-11.5 28.5T720-160q-17 0-28.5-11.5T680-200v-80Zm-280 0H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h120q17 0 28.5 11.5T440-640q0 17-11.5 28.5T400-600H280q-50 0-85 35t-35 85q0 50 35 85t85 35h120q17 0 28.5 11.5T440-320q0 17-11.5 28.5T400-280Zm-40-160q-17 0-28.5-11.5T320-480q0-17 11.5-28.5T360-520h240q17 0 28.5 11.5T640-480q0 17-11.5 28.5T600-440H360Zm520-40h-80q0-50-35-85t-85-35H559q-17 0-28-11.5T520-640q0-17 11.5-28.5T560-680h120q83 0 141.5 58.5T880-480Z',
    bookmarks: 'm400-200-182 91q-20 10-39-1.5T160-145v-495q0-33 23.5-56.5T240-720h320q33 0 56.5 23.5T640-640v495q0 23-19 34.5t-39 1.5l-182-91Zm-160-1 122-66q18-10 38-10t38 10l122 66v-439H240v439Zm491.5-50.5Q720-263 720-280v-520H320q-17 0-28.5-11.5T280-840q0-17 11.5-28.5T320-880h400q33 0 56.5 23.5T800-800v520q0 17-11.5 28.5T760-240q-17 0-28.5-11.5ZM240-640h320-320Z',
    task: 'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q48 0 93.5 11t87.5 32q15 8 19.5 24t-5.5 30q-10 14-26.5 18t-32.5-4q-32-15-66.5-23t-69.5-8q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-8-.5-15.5T798-511q-2-17 6.5-32.5T830-564q16-5 30 3t16 24q2 14 3 28t1 29q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-56-328 372-373q11-11 27.5-11.5T852-781q11 11 11 28t-11 28L452-324q-12 12-28 12t-28-12L282-438q-11-11-11-28t11-28q11-11 28-11t28 11l86 86Z',
    pages: 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Zm120 480h200q17 0 28.5-11.5T560-320q0-17-11.5-28.5T520-360H320q-17 0-28.5 11.5T280-320q0 17 11.5 28.5T320-280Zm0-160h320q17 0 28.5-11.5T680-480q0-17-11.5-28.5T640-520H320q-17 0-28.5 11.5T280-480q0 17 11.5 28.5T320-440Zm0-160h320q17 0 28.5-11.5T680-640q0-17-11.5-28.5T640-680H320q-17 0-28.5 11.5T280-640q0 17 11.5 28.5T320-600Z',
    overview: 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h240v-560H200v560Zm320 0h240v-280H520v280Zm0-360h240v-200H520v200Z',
    report: 'M348.5-611.5Q360-623 360-640t-11.5-28.5Q337-680 320-680t-28.5 11.5Q280-657 280-640t11.5 28.5Q303-600 320-600t28.5-11.5Zm0 160Q360-463 360-480t-11.5-28.5Q337-520 320-520t-28.5 11.5Q280-497 280-480t11.5 28.5Q303-440 320-440t28.5-11.5Zm0 160Q360-303 360-320t-11.5-28.5Q337-360 320-360t-28.5 11.5Q280-337 280-320t11.5 28.5Q303-280 320-280t28.5-11.5ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h407q16 0 30.5 6t25.5 17l154 154q11 11 17 25.5t6 30.5v407q0 33-23.5 56.5T760-120H200Zm0-80h560v-400H640q-17 0-28.5-11.5T600-640v-120H200v560Zm0-560v160-160 560-560Z',
    setup: 'M433-80q-27 0-46.5-18T363-142l-9-66q-13-5-24.5-12T307-235l-62 26q-25 11-50 2t-39-32l-47-82q-14-23-8-49t27-43l53-40q-1-7-1-13.5v-27q0-6.5 1-13.5l-53-40q-21-17-27-43t8-49l47-82q14-23 39-32t50 2l62 26q11-8 23-15t24-12l9-66q4-26 23.5-44t46.5-18h94q27 0 46.5 18t23.5 44l9 66q13 5 24.5 12t22.5 15l62-26q25-11 50-2t39 32l47 82q14 23 8 49t-27 43l-53 40q1 7 1 13.5v27q0 6.5-2 13.5l53 40q21 17 27 43t-8 49l-48 82q-14 23-39 32t-50-2l-60-26q-11 8-23 15t-24 12l-9 66q-4 26-23.5 44T527-80h-94Zm7-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z',
    verified: 'm438-452-58-57q-11-11-27.5-11T324-508q-11 11-11 28t11 28l86 86q12 12 28 12t28-12l170-170q12-12 11.5-28T636-592q-12-12-28.5-12.5T579-593L438-452ZM326-90l-58-98-110-24q-15-3-24-15.5t-7-27.5l11-113-75-86q-10-11-10-26t10-26l75-86-11-113q-2-15 7-27.5t24-15.5l110-24 58-98q8-13 22-17.5t28 1.5l104 44 104-44q14-6 28-1.5t22 17.5l58 98 110 24q15 3 24 15.5t7 27.5l-11 113 75 86q10 11 10 26t-10 26l-75 86 11 113q2 15-7 27.5T802-212l-110 24-58 98q-8 13-22 17.5T584-74l-104-44-104 44q-14 6-28 1.5T326-90Zm52-72 102-44 104 44 56-96 110-26-10-112 74-84-74-86 10-112-110-24-58-96-102 44-104-44-56 96-110 24 10 112-74 86 74 84-10 114 110 24 58 96Zm102-318Z',
  };
  const icon = (name, cls = '') => `<svg class="ic ic-${name}${cls ? ' ' + cls : ''}" viewBox="0 -960 960 960" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;
  // Real product logos (site/img) for the Google services and CodeLove itself.
  const LOGOS = { own: 'img/codelove.png', ga: 'img/ga.svg', gsc: 'img/search-console.png', ads: 'img/adsense.png', speed: 'img/pagespeed.png' };
  const logo = (key, cls = '') => LOGOS[key] ? `<img class="logo-img${cls ? ' ' + cls : ''}" src="${LOGOS[key]}" alt="" width="20" height="20" decoding="async">` : '';
  // Site favicon. Next.js / static sites may serve /favicon.ico, /icon.svg, /favicon.svg, or /favicon-48.png,
  // so try common icon paths in order, remember the working path in sessionStorage, and fall back to first letter.
  const FAV_PATHS = ['/favicon.ico', '/icon.svg', '/favicon.svg', '/favicon-48.png', '/apple-icon.png', '/apple-touch-icon.png'];
  const favPick = {}; // host -> index into FAV_PATHS that loaded (only successes are remembered; a network blip retries next time)
  try { Object.assign(favPick, JSON.parse(sessionStorage.getItem('cl_fav2') || '{}')); } catch { /* ignore */ }
  const saveFav = () => store.set('cl_fav2', JSON.stringify(favPick), sessionStorage);
  const favHost = (host) => String(host || '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
  const favLetter = (h) => (h.replace(/^www\./, '').charAt(0) || '?').toUpperCase();
  const favicon = (host) => {
    const h = favHost(host), i = favPick[h] ?? 0;
    return `<img class="fav" src="https://${h}${FAV_PATHS[i]}" alt="" loading="lazy" data-host="${h}" data-i="${i}" onload="CL.favOk(this)" onerror="CL.favErr(this)">`;
  };
  function favOk(img) { const h = img.dataset.host; if (favPick[h] !== +img.dataset.i) { favPick[h] = +img.dataset.i; saveFav(); } }
  function favErr(img) {
    const h = img.dataset.host, tries = (+img.dataset.t || 1) + 1, i = (+img.dataset.i + 1) % FAV_PATHS.length;
    if (tries <= FAV_PATHS.length) { img.dataset.t = tries; img.dataset.i = i; img.src = `https://${h}${FAV_PATHS[i]}`; return; }
    img.replaceWith(Object.assign(document.createElement('span'), { className: 'fav fav-x', textContent: favLetter(h) }));
  }

  // ---------- popover / dropdown ----------
  let openPop = null;
  function closePop(focusBack = true) {
    if (!openPop) return;
    const { el, scrim, trigger } = openPop;
    openPop = null;
    el.remove(); if (scrim) scrim.remove();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('open');
    if (focusBack && document.contains(trigger)) trigger.focus({ preventScroll: true });
  }
  // Keep a popover fully inside the visible viewport (clientWidth excludes the scrollbar, innerWidth doesn't):
  // 16px margin, start- or end-aligned with the trigger and shifted to fit, flipped above when there is more room there.
  const EDGE = 16;
  function place(el, trigger, align) {
    const r = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    if (el.classList.contains('pop-gridmenu')) el.style.width = Math.min(760, vw - EDGE * 2) + 'px';
    el.style.minWidth = Math.min(Math.max(r.width, 240), vw - EDGE * 2) + 'px';
    el.style.left = '0px'; el.style.top = '0px'; el.style.maxHeight = '';
    const w = el.offsetWidth;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
    const below = vh - r.bottom - 8 - EDGE, above = r.top - 8 - EDGE, h = el.scrollHeight;
    const up = h > below && above > below + 40;
    const room = Math.max(200, up ? above : below);
    el.style.maxHeight = room + 'px';
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(up ? r.top - 8 - Math.min(h, room) : r.bottom + 8) + 'px';
    el.classList.toggle('up', up);
  }
  /** Opens a popover under `trigger`; build(el, close) fills it. Clicking the trigger again closes it. */
  function popover(trigger, build, opts = {}) {
    if (openPop && openPop.trigger === trigger) { closePop(); return null; }
    closePop(false);
    const sheet = document.documentElement.clientWidth < 560;
    const el = document.createElement('div');
    el.className = 'pop' + (sheet ? ' sheet' : '') + (opts.cls ? ' ' + opts.cls : '');
    let scrim = null;
    if (sheet) { scrim = document.createElement('div'); scrim.className = 'pop-scrim'; document.body.append(scrim); }
    document.body.append(el);
    openPop = { el, scrim, trigger };
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('open');
    build(el, (back = true) => closePop(back));
    if (!sheet) place(el, trigger, opts.align);
    const first = el.querySelector('[data-autofocus]') || el.querySelector('.mi[aria-selected="true"]') || el.querySelector('.mi, input, button');
    if (first && !sheet) first.focus({ preventScroll: true });
    return el;
  }
  document.addEventListener('pointerdown', (e) => {
    if (openPop && !openPop.el.contains(e.target) && !openPop.trigger.contains(e.target)) closePop(false);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!openPop) return;
    if (e.key === 'Escape') { e.preventDefault(); closePop(); return; }
    const k = e.key, vert = k === 'ArrowDown' || k === 'ArrowUp', horiz = k === 'ArrowLeft' || k === 'ArrowRight';
    if (!vert && !horiz) return;
    const grid = openPop.el.classList.contains('pop-gridmenu');
    if (horiz && (!grid || document.activeElement.tagName === 'INPUT')) return; // let the caret move in the search box
    const items = $$('.mi', openPop.el).filter((x) => !x.hidden && !x.disabled);
    if (!items.length) return;
    e.preventDefault();
    let i = items.indexOf(document.activeElement);
    const fwd = k === 'ArrowDown' || k === 'ArrowRight';
    if (i < 0) { items[fwd ? 0 : items.length - 1].focus(); return; }
    if (grid) {
      // columns = how many tiles share the first row's top
      const cols = vert ? items.filter((x) => x.offsetTop === items[0].offsetTop).length || 1 : 1;
      const inp = $('input', openPop.el);
      if (k === 'ArrowUp' && i - cols < 0 && inp) { inp.focus(); return; } // top row ↑ goes back to search
      i = Math.max(0, Math.min(items.length - 1, i + (fwd ? cols : -cols)));
    } else i = fwd ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1;
    items[i].focus();
  });
  addEventListener('resize', () => { if (openPop && !openPop.el.classList.contains('sheet')) closePop(false); });

  /** Single-select dropdown. items: [{value, label, icon?, hint?} | {sep:true}] */
  function selectMenu(trigger, { items, value, onSelect, search, title, align }) {
    return popover(trigger, (el, close) => {
      el.innerHTML = `${title ? `<div class="pop-title">${esc(title)}</div>` : ''}${search ? `<div class="pop-search">${icon('search')}<input type="search" data-autofocus placeholder="${esc(search)}" aria-label="${esc(search)}" autocomplete="off"></div>` : ''}
        <div class="pop-list" role="listbox">${items.map((it, i) => (it.sep ? '<div class="pop-sep" role="separator"></div>' : `<button type="button" class="mi" role="option" data-i="${i}" aria-selected="${it.value === value}">${icon('check', 'mi-check')}${it.icon || ''}<span class="mi-label">${esc(it.label)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}</button>`)).join('')}</div>
        <div class="pop-empty" hidden>No match</div>`;
      $$('.mi', el).forEach((b) => b.addEventListener('click', () => { const it = items[+b.dataset.i]; close(); onSelect(it.value); }));
      const input = $('input[type=search]', el);
      if (input) {
        input.addEventListener('input', () => {
          const q = input.value.trim().toLowerCase();
          let any = false;
          $$('.mi', el).forEach((b) => { const hit = !q || items[+b.dataset.i].label.toLowerCase().includes(q); b.hidden = !hit; any ||= hit; });
          $$('.pop-sep', el).forEach((s) => (s.hidden = !!q));
          $('.pop-empty', el).hidden = any;
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $$('.mi', el).find((x) => !x.hidden); if (b) b.click(); } });
      }
    }, { align });
  }

  // ---------- tooltip ----------
  const tip = $('#tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 14, top = y - h - 12;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (top < 8) top = y + 16;
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = top + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  addEventListener('scroll', hideTip, { passive: true });

  // ---------- charts ----------
  // Nice axis: max = n × step, step from 1/2/2.5/5 × 10^k (whole numbers for counts), or a clock step for durations.
  function niceStep(raw, whole) {
    if (whole && raw <= 1) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5]) { const s = m * p; if (s >= raw * 0.9999 && (!whole || Number.isInteger(s))) return s; }
    return 10 * p;
  }
  const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 345600, 604800, 1209600, 2592000];
  function axisMax(v, kind, n = 4) {
    if (!(v > 0)) return kind === 'pct' ? 1 : kind === 'dur' ? 60 * n : n;
    const raw = v / n;
    if (kind === 'dur') return (TIME_STEPS.find((t) => t >= raw) || niceStep(raw / 86400, true) * 86400) * n;
    if (kind === 'pct') return Math.min(1, niceStep(raw) * n);
    return niceStep(raw, true) * n;
  }
  let gid = 0;
  // Single-series area chart with crosshair tooltip. pts: [{label, short, ...values}], summary(p) -> html
  function lineChart(el, pts, key, fmt, axisFmt, summary) {
    el.innerHTML = '';
    if (!pts.length) { el.innerHTML = '<div class="chart-empty">No data in this range</div>'; return; }
    const W = el.clientWidth || 600, H = el.clientHeight || 260;
    const pad = { l: 48, r: 14, t: 12, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = axisMax(Math.max(...pts.map((p) => p[key] || 0)), axisFmt.kind);
    const x = (i) => pad.l + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1));
    const y = (v) => pad.t + ih - ((v || 0) / max) * ih;
    const id = 'ag' + ++gid;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(key)} over time"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--series)" stop-opacity=".22"/><stop offset="1" stop-color="var(--series)" stop-opacity="0"/></linearGradient></defs>`;
    for (let i = 1; i <= 4; i++) {
      const v = (max * i) / 4, yy = y(v);
      s += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="tick" x="${pad.l - 8}" y="${yy + 4}" text-anchor="end">${esc(axisFmt(v))}</text>`;
    }
    s += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/><text class="tick" x="${pad.l - 8}" y="${y(0) + 4}" text-anchor="end">0</text>`;
    const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(iw / 72))));
    pts.forEach((p, i) => { if (i % step === 0) s += `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.short)}</text>`; });
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    if (pts.length > 1) s += `<path fill="url(#${id})" d="${line}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z"/>`;
    s += `<path class="line" d="${line}"/>`;
    if (pts.length === 1) s += `<circle class="dot" cx="${x(0)}" cy="${y(pts[0][key])}" r="5"/>`;
    s += `<line class="cross" y1="${pad.t}" y2="${y(0)}" visibility="hidden"/><circle class="dot hov" r="5" visibility="hidden"/>`;
    s += `<rect x="${pad.l - 10}" y="0" width="${iw + 20}" height="${H}" fill="transparent" class="hit"/></svg>`;
    el.innerHTML = s;
    const svg = el.firstChild, cx = $('.cross', svg), cd = $('.hov', svg), hit = $('.hit', svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(pts.length === 1 ? 0 : ((px - pad.l) / iw) * (pts.length - 1))));
      const p = pts[i];
      cx.setAttribute('x1', x(i)); cx.setAttribute('x2', x(i)); cx.setAttribute('visibility', 'visible');
      cd.setAttribute('cx', x(i)); cd.setAttribute('cy', y(p[key])); cd.setAttribute('visibility', 'visible');
      showTip(`<b>${esc(fmt(p[key] || 0))}</b><span class="muted">${esc(p.label)}</span>${summary ? `<span class="tip-sum">${summary(p)}</span>` : ''}`, ev.clientX, ev.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cx.setAttribute('visibility', 'hidden'); cd.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  /** KPI tiles that double as the chart's metric switch, plus a table view of the same points.
   * metrics: [{k, label, value (html), delta (html), fmt, axis}] — every metric must exist on each point. */
  function kpiChart({ metrics, pts, storeKey, summary, unit = 'day', note = '' }) {
    const card = document.createElement('section');
    card.className = 'card kc';
    card.innerHTML = `<div class="kc-tabs" role="tablist" aria-label="Metric">${metrics.map((m) => `<button type="button" role="tab" class="kc-tab" data-k="${m.k}"><span class="kc-label">${esc(m.label)}</span><span class="kc-value">${m.value}</span>${m.delta || ''}</button>`).join('')}</div>
      <div class="kc-body"><div class="kc-head"><h2 class="kc-title"></h2><button type="button" class="link-btn kc-toggle">Table view</button></div><div class="chart"></div><div class="kc-table" hidden></div>${note ? `<p class="note">${note}</p>` : ''}</div>`;
    const el = $('.chart', card), tbl = $('.kc-table', card), toggle = $('.kc-toggle', card), titleEl = $('.kc-title', card);
    let k = store.get(storeKey);
    if (!metrics.some((m) => m.k === k)) k = metrics[0].k;
    let asTable = false;
    const draw = () => {
      const m = metrics.find((x) => x.k === k);
      $$('.kc-tab', card).forEach((b) => { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      titleEl.textContent = `${m.label} by ${unit}`;
      if (!asTable) lineChart(el, pts, k, m.fmt, m.axis, summary);
    };
    $$('.kc-tab', card).forEach((b) => b.addEventListener('click', () => { k = b.dataset.k; store.set(storeKey, k); draw(); }));
    toggle.addEventListener('click', () => {
      asTable = !asTable;
      el.hidden = asTable; tbl.hidden = !asTable;
      toggle.textContent = asTable ? 'Chart view' : 'Table view';
      if (asTable) table(tbl, [{ key: 'iso', label: unit === 'hour' ? 'Hour' : 'Date', html: (r) => esc(r.label) }, ...metrics.map((m) => ({ key: m.k, label: m.label, num: true, fmt: m.fmt }))], pts.slice(), { sort: 'iso', pageSize: 60 });
      else draw();
    });
    let w = 0;
    new ResizeObserver(() => { if (el.clientWidth && el.clientWidth !== w) { w = el.clientWidth; draw(); } }).observe(el);
    draw();
    return card;
  }

  // Vertical columns (e.g. 24 hours). items: [{label, value, tip}]
  function columns(el, items, fmt) {
    const draw = () => {
      const W = el.clientWidth || 600, H = el.clientHeight || 190;
      const pad = { l: 38, r: 6, t: 8, b: 22 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      const max = axisMax(Math.max(0, ...items.map((i) => i.value)), 'count');
      const bw = iw / items.length, gap = Math.max(2, Math.min(4, bw * 0.25));
      let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`;
      for (let i = 1; i <= 4; i++) { const yy = pad.t + ih - (ih * i) / 4; s += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="tick" x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${compact((max * i) / 4)}</text>`; }
      s += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>`;
      const every = Math.ceil(items.length / Math.max(2, Math.floor(iw / 34)));
      items.forEach((it, i) => {
        const h = (it.value / max) * ih, x0 = pad.l + i * bw + gap / 2, w = Math.max(1, bw - gap), y0 = pad.t + ih - h;
        const r = Math.min(4, w / 2, h);
        if (h > 0) s += `<path class="col" data-i="${i}" d="M${x0},${pad.t + ih}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${pad.t + ih}Z"/>`;
        s += `<rect class="colhit" data-i="${i}" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}" fill="transparent"/>`;
        if (i % every === 0) s += `<text class="tick" x="${x0 + w / 2}" y="${H - 6}" text-anchor="middle">${esc(it.label)}</text>`;
      });
      el.innerHTML = s + '</svg>';
      el.querySelectorAll('.colhit').forEach((r) => {
        const it = items[+r.dataset.i], col = el.querySelector(`.col[data-i="${r.dataset.i}"]`);
        const f = (ev) => { if (col) col.classList.add('hov'); showTip(`<b>${esc(fmt(it.value))}</b><span class="muted">${esc(it.tip || it.label)}</span>`, ev.clientX, ev.clientY); };
        r.addEventListener('pointermove', f); r.addEventListener('pointerdown', f);
        r.addEventListener('pointerleave', () => { if (col) col.classList.remove('hov'); hideTip(); });
      });
    };
    let w = 0;
    new ResizeObserver(() => { if (el.clientWidth && el.clientWidth !== w) { w = el.clientWidth; draw(); } }).observe(el);
  }

  // Tiny sparkline (no axes) for site cards.
  function sparkline(values) {
    const W = 120, H = 32, max = Math.max(1, ...values);
    if (values.length < 2) return '';
    const pts = values.map((v, i) => `${((i * W) / (values.length - 1)).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="M${pts.join('L')}L${W},${H}L0,${H}Z" class="spark-area"/><path d="M${pts.join('L')}" class="spark-line"/></svg>`;
  }

  /** Change vs previous period. opts.none = text when there's nothing to compare with. */
  function deltaHtml(cur, prev, opts = {}) {
    if (opts.none) return `<span class="delta">${esc(opts.none)}</span>`;
    if (!prev) return '<span class="delta">no data before</span>';
    const ch = (cur - prev) / prev;
    if (Math.abs(ch) < 0.0005) return '<span class="delta">same as before</span>';
    const good = opts.lower ? ch < 0 : ch > 0;
    return `<span class="delta ${good ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(1)}% <span class="muted">vs prev</span></span>`;
  }

  // ---------- tables & lists ----------
  // Sortable, searchable table. cols: {key,label,num?,fmt?,bar?,html?,cls?,lowFirst? (first click sorts ascending)}
  // opts: {sort, asc, search, pageSize, expand(r) -> html of a detail row, rowKey(r) -> stable id for expanded rows}
  function table(container, cols, data, opts = {}) {
    let sortKey = opts.sort || cols.find((c) => c.num)?.key, asc = !!opts.asc, q = '', shown = opts.pageSize || 50;
    const X = opts.expand, open = new Set();
    container.innerHTML = `${opts.search ? `<div class="table-tools"><label class="search">${icon('search')}<input type="search" placeholder="${esc(opts.search)}" aria-label="Search"></label><span class="muted count"></span></div>` : ''}<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th data-k="${c.key}" class="${c.num ? 'num' : ''}" tabindex="0" aria-sort="none">${esc(c.label)}</th>`).join('')}</tr></thead><tbody></tbody></table></div><div class="more"></div>`;
    const tbody = $('tbody', container), more = $('.more', container), count = $('.count', container);
    const draw = () => {
      const d = q ? data.filter((r) => cols.some((c) => !c.num && String(r[c.key] ?? '').toLowerCase().includes(q)) || String(r.title || '').toLowerCase().includes(q)) : data.slice();
      const col = cols.find((c) => c.key === sortKey);
      d.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; const r = col?.num ? (x ?? -1) - (y ?? -1) : String(x).localeCompare(String(y)); return asc ? r : -r; });
      const maxes = {};
      cols.filter((c) => c.bar).forEach((c) => (maxes[c.key] = Math.max(1, ...d.map((r) => r[c.key] || 0))));
      tbody.innerHTML = d.slice(0, shown).map((r) => {
        const k = X ? String(opts.rowKey(r)) : '', on = X && open.has(k);
        const tds = cols.map((c, ci) => {
          let v = c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key]);
          if (X && ci === 0) v = `<span class="xcell"><button type="button" class="xbtn" aria-expanded="${on}" aria-label="${on ? 'Hide' : 'Show'} details">${icon('chev')}</button><span class="xbody">${v}</span></span>`;
          if (c.bar) return `<td class="num"><span class="cellbar"><span>${v}</span><span class="cb-track" aria-hidden="true"><i style="width:${Math.max(3, Math.round(((r[c.key] || 0) / maxes[c.key]) * 100))}%"></i></span></span></td>`;
          return `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${v}</td>`;
        }).join('');
        return `<tr${X ? ` class="xrow${on ? ' open' : ''}" data-x="${esc(k)}"` : ''}>${tds}</tr>${on ? `<tr class="xsub"><td colspan="${cols.length}">${X(r)}</td></tr>` : ''}`;
      }).join('') || `<tr><td colspan="${cols.length}" class="empty-row">No data yet</td></tr>`;
      container.querySelectorAll('th').forEach((th) => {
        const on = th.dataset.k === sortKey;
        th.classList.toggle('sorted', on); th.classList.toggle('asc', on && asc);
        th.setAttribute('aria-sort', on ? (asc ? 'ascending' : 'descending') : 'none');
      });
      if (count) count.textContent = `${num(d.length)} ${d.length === 1 ? 'row' : 'rows'}`;
      more.innerHTML = d.length > shown ? `<button class="btn">Show more (${num(d.length - shown)} left)</button>` : '';
      const btn = $('button', more); if (btn) btn.onclick = () => { shown += 100; draw(); };
    };
    const sortBy = (th) => { if (sortKey === th.dataset.k) asc = !asc; else { sortKey = th.dataset.k; asc = !!cols.find((c) => c.key === sortKey)?.lowFirst; } draw(); };
    container.querySelectorAll('th').forEach((th) => {
      th.addEventListener('click', () => sortBy(th));
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(th); } });
    });
    // Expandable rows: click a row (or its arrow button) to open the detail row under it; links still work.
    if (X) tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.xrow');
      if (!tr || e.target.closest('a, input, button:not(.xbtn)')) return;
      const k = tr.dataset.x, viaBtn = !!e.target.closest('.xbtn');
      if (open.has(k)) open.delete(k); else open.add(k);
      draw();
      if (viaBtn) [...tbody.querySelectorAll('tr.xrow')].find((x) => x.dataset.x === k)?.querySelector('.xbtn').focus();
    });
    const input = $('input[type=search]', container);
    if (input) input.addEventListener('input', () => { q = input.value.trim().toLowerCase(); shown = opts.pageSize || 50; draw(); });
    draw();
    return { redraw: draw }; // after the row objects in `data` change
  }

  function barList(title, items, fmt = num, opts = {}) {
    const max = Math.max(1, ...items.map((i) => i.value));
    const total = opts.total ?? items.reduce((a, i) => a + i.value, 0);
    return `<section class="card"><div class="card-head"><h2>${esc(title)}</h2>${opts.right || ''}</div>${items.length ? `<ul class="bars">${items.map((i) => `<li title="${esc(i.name)}: ${esc(fmt(i.value))}"><span class="name">${i.html || esc(i.name || '(not set)')}</span><span class="val"><b>${esc(fmt(i.value))}</b>${opts.noPct ? '' : `<span class="muted"> ${pct(div(i.value, total))}</span>`}</span><span class="track"><i style="width:${Math.max(1, (i.value / max) * 100)}%"></i></span></li>`).join('')}</ul>` : '<p class="empty">No data yet</p>'}</section>`;
  }

  // ---------- page chrome ----------
  const app = $('#app');
  /** Header at the top of a view. */
  function pageHead(eyebrow, title, sub, right = '') {
    return `<div class="page-head"><div class="ph-text"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${right ? `<div class="ph-right">${right}</div>` : ''}</div>`;
  }
  /** While data reloads, keep the previous render dimmed instead of flashing a spinner. */
  function loading(msg = 'Loading…') {
    if (app.dataset.filled) app.classList.add('busy');
    else app.innerHTML = `<div class="loading"><span class="spinner"></span>${esc(msg)}</div>`;
  }
  /** Replace the view. keep=false for sign-in / error screens (next load shows the spinner again). */
  function paint(html, keep = true) {
    app.classList.remove('busy');
    if (keep) app.dataset.filled = '1'; else delete app.dataset.filled;
    app.innerHTML = html;
  }
  const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

  // ---------- Google sign-in: one OAuth token shared by Google Analytics and Google Search ----------
  // Browser-only token model (no client secret, so no refresh token): an access token lives ~1 hour.
  //  * One consent asks for every read scope at once (GA + Search Console + email), so both sections connect together.
  //  * The token, its expiry and the granted scopes are kept in localStorage and reused across reloads / new tabs
  //    until 2 minutes before expiry: no popup at all while it is valid.
  //  * After it expires it is renewed with prompt '' + login_hint (Google closes the window by itself, no consent
  //    screen). Browsers only allow that window right after a click, so a renew runs only inside a user gesture
  //    (a nav click or the "Reconnect Google" button); a page load with an expired token shows that button instead.
  //  * prompt 'select_account' is used only by "Switch Google account". The write scope (sitemap Resubmit) is
  //    asked only on that click.
  const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
  const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
  const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
  // AdSense (read-only) is asked only when the AdSense section is opened the first time, then kept with the rest.
  const ADS_SCOPE = 'https://www.googleapis.com/auth/adsense.readonly';
  const READ_SCOPES = [GA_SCOPE, GSC_SCOPE, EMAIL_SCOPE];
  const G_KEY = 'cl_google', EARLY = 120e3;
  const gAuth = (() => {
    const blank = () => ({ access: '', exp: 0, scopes: [], granted: [], email: '' });
    let s = blank();
    try { Object.assign(s, JSON.parse(store.get(G_KEY) || '{}')); } catch { /* ignore */ }
    try { // one-time move of the old per-tab token (sessionStorage) into localStorage
      const old = JSON.parse(sessionStorage.getItem('cl_admin_token') || 'null');
      if (old && old.access && !s.access && old.exp > Date.now()) Object.assign(s, { access: old.access, exp: old.exp + 60e3, scopes: old.scopes || [GA_SCOPE] });
      sessionStorage.removeItem('cl_admin_token');
    } catch { /* ignore */ }
    if (!Array.isArray(s.scopes)) s.scopes = [];
    if (!Array.isArray(s.granted)) s.granted = [];
    s.granted = [...new Set([...s.granted, ...s.scopes])];
    const listeners = new Set();
    // another tab signed in / renewed / signed out: use its token here too
    addEventListener('storage', (e) => {
      if (e.key !== G_KEY) return;
      try { s = Object.assign(blank(), JSON.parse(e.newValue || '{}')); } catch { s = blank(); }
      listeners.forEach((f) => { try { f(); } catch { /* ignore */ } });
    });
    const changed = () => { store.set(G_KEY, s.access || s.granted.length ? JSON.stringify(s) : null); listeners.forEach((f) => { try { f(); } catch { /* ignore */ } }); };
    const valid = () => !!s.access && s.exp - EARLY > Date.now();
    const canPopup = () => !!(navigator.userActivation && navigator.userActivation.isActive);
    let client = null, waiter = null, inflight = null, timer = 0;

    function gErr(err, resp) {
      const t = (err && err.type) || (resp && resp.error) || '';
      const e = new Error(t === 'popup_closed' ? 'The Google window was closed before it finished.'
        : t === 'popup_failed_to_open' ? 'The browser blocked the Google window. Press the button again, or allow pop-ups for this site.'
          : t === 'access_denied' ? 'Google access was not allowed.'
            : (resp && (resp.error_description || resp.error)) || (err && err.message) || t || 'Google sign-in failed.');
      e.code = t;
      if (t === 'popup_failed_to_open') e.reconnect = true;
      return e;
    }
    function settle(resp, err) {
      const w = waiter; waiter = null; inflight = null; clearTimeout(timer);
      if (!w) return;
      if (err || !resp || resp.error || !resp.access_token) { w.reject(gErr(err, resp)); return; }
      const scopes = String(resp.scope || '').split(/\s+/).filter(Boolean);
      if (w.switching) s = blank();
      // include_granted_scopes: the reply lists everything this Google account has granted the app
      Object.assign(s, { access: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3599) * 1000, scopes, granted: scopes.slice() });
      changed();
      if (scopes.includes(EMAIL_SCOPE) && !s.email) fetchEmail();
      w.resolve(s.access);
    }
    function fetchEmail() {
      fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + s.access } })
        .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.email) { s.email = j.email; changed(); } }).catch(() => {});
    }
    function getClient() {
      if (client) return client;
      if (!window.google?.accounts?.oauth2) return null;
      client = google.accounts.oauth2.initTokenClient({
        client_id: CFG.clientId, scope: READ_SCOPES.join(' '), include_granted_scopes: true,
        callback: (resp) => settle(resp), error_callback: (err) => settle(null, err),
      });
      return client;
    }
    /** Opens Google's window. Only call from a click (or right after one). */
    function request(scopes, { prompt = '', hint = s.email || CFG.ownerEmail || '', switching = false } = {}) {
      if (inflight) return inflight;
      const c = getClient();
      if (!c) return Promise.reject(new Error('Google sign-in is still loading. Try again in a second.'));
      inflight = new Promise((resolve, reject) => { waiter = { resolve, reject, switching }; });
      // safety net: if Google never answers (window closed in an odd way), let the next click try again
      timer = setTimeout(() => settle(null, { type: 'popup_closed' }), 180e3);
      const o = { scope: [...new Set(scopes)].join(' '), prompt, include_granted_scopes: true };
      if (hint) o.login_hint = hint;
      c.requestAccessToken(o);
      return inflight;
    }
    const reconnectErr = () => Object.assign(new Error('Google access expired. Press "Reconnect Google".'), { reconnect: true, code: 'reconnect' });
    return {
      READ_SCOPES,
      token: () => (valid() ? s.access : null),
      /** Usable right now for this scope. */
      has: (scope) => valid() && s.scopes.includes(scope),
      /** Granted before (token may have expired): a renew needs no consent screen. */
      known: (scope) => s.granted.includes(scope),
      email: () => s.email,
      minutesLeft: () => (valid() ? Math.max(1, Math.round((s.exp - EARLY - Date.now()) / 60e3)) : 0),
      canPopup,
      /** First sign-in: every read scope in one consent (+ `extra`, e.g. the write scope). */
      connect: (extra = []) => request([...READ_SCOPES, ...s.granted, ...extra]),
      /** Silent renew of what was granted before. Without a user gesture it rejects with e.reconnect (caller shows the button). */
      renew(force = false) {
        if (!force && !canPopup()) return Promise.reject(reconnectErr());
        return request(s.granted.length ? s.granted : READ_SCOPES);
      },
      switchAccount: () => request(READ_SCOPES, { prompt: 'select_account', hint: '', switching: true }),
      /** The API said 401: the token is dead even if the clock says otherwise. */
      expire() { s.exp = 0; changed(); },
      /** Forget the token here (no revoke, so signing in again needs no new consent screen). */
      forget() { s = blank(); changed(); },
      onChange: (f) => listeners.add(f),
    };
  })();
  const G_LOGO = '<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  /** Expired Google token on a page load (no click to open Google's window from): one small button. */
  function gReconnect(msg = '') {
    const email = gAuth.email() || CFG.ownerEmail || '';
    paint(`<section class="card state-card"><span class="state-ic">${icon('key')}</span>
      <h2>Reconnect Google</h2>
      <p>Google access tokens last one hour. One click renews it; you won't see the permission screen again.${email ? `<br><span class="muted">${esc(email)}</span>` : ''}</p>
      ${msg ? `<div class="error">${icon('alert')}<div>${esc(msg)}</div></div>` : ''}
      <div class="state-actions"><button type="button" class="btn primary" id="gReconnect">${G_LOGO}Reconnect Google</button>
      <button type="button" class="link-btn" id="gSwitch">Use another account</button></div></section>`, false);
    const go = (fn) => async (e) => {
      e.currentTarget.disabled = true;
      try { await fn(); rerender(); } catch (err) { gReconnect(err.code === 'popup_closed' ? '' : err.message); }
    };
    $('#gReconnect').onclick = go(() => gAuth.renew(true));
    $('#gSwitch').onclick = go(() => gAuth.switchAccount());
  }
  /** Gate for a Google section. true = token ready; otherwise the sign-in or reconnect view is painted. */
  async function gGate(scope, signInView, alive) {
    if (gAuth.has(scope)) return true;
    if (!gAuth.known(scope)) { signInView(); return false; }
    if (!gAuth.canPopup()) { gReconnect(); return false; } // page load / timer: never open Google's window by itself
    loading('Reconnecting Google…');
    try { await gAuth.renew(); } catch (e) { if (alive()) gReconnect(e.reconnect || e.code === 'popup_closed' ? '' : e.message); return false; }
    if (!alive()) return false;
    if (gAuth.has(scope)) return true;
    signInView(); return false;
  }

  /** Fixes for the usual Google sign-in errors, folded under the sign-in button. */
  function oauthHelp(extra = '') {
    const id = CFG.clientId || '', project = id.split('-')[0];
    return `<details class="help"><summary>Trouble signing in?</summary><div class="help-body"><b>Google shows "Error 400: origin_mismatch"?</b> The OAuth client doesn't allow this address yet. One-time fix:
        <ol><li>Open <a href="https://console.cloud.google.com/apis/credentials/oauthclient/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}" target="_blank" rel="noopener">this OAuth client in Google Cloud</a> (signed in as the owner Gmail).</li>
        <li>Under <i>Authorized JavaScript origins</i> click <b>Add URI</b> and enter <code>${esc(location.origin)}</code> (no slash at the end).</li>
        <li>Click <b>Save</b>.</li>
        <li>Wait 5 minutes, then sign in again.</li></ol>
        <div class="help-p"><b>"Access blocked … not completed the Google verification process"?</b> Google Auth Platform → Audience → add this Gmail under <b>Test users</b>.</div>
        <div class="help-p"><b>"Google hasn't verified this app"?</b> Normal for a personal app: click <b>Continue</b>. It shows only on the permission screen, which this dashboard asks for once (not on every visit).</div>${extra}</div></details>`;
  }
  /** Sign-in card for a Google section. */
  function gSignIn({ eyebrow, title, text, msg, button = 'Sign in with Google', help = '', id, need }) {
    paint(`<section class="card signin"><span class="logo" aria-hidden="true"></span><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1>
      <p>${text}</p>
      ${msg ? `<div class="error">${icon('alert')}<div>${esc(msg)}</div></div>` : ''}
      <button class="btn lg primary-g" id="${id}">${G_LOGO}${esc(button)}</button>
      <p class="signin-note">One Google sign-in connects Google Analytics and Search Console together (read-only). It stays connected on this browser.</p>
      ${oauthHelp(help)}</section>`, false);
    $('#' + id).onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        await gAuth.connect(need ? [need] : []);
        if (!gAuth.has(need)) throw new Error('Google did not give the read-only permission this page needs. Press the button again and tick every checkbox on the Google screen.');
        rerender();
      } catch (err) { gSignIn({ eyebrow, title, text, msg: err.code === 'popup_closed' ? '' : err.message, button, help, id, need }); }
    };
  }

  window.CL = {
    $, $$, store, num, compact, pct, dur, durAxis, pctAxis, esc, div, iso, addDays, parseIso, istToday, fmtDate, rangeText, shortRange, eachDay,
    PRESETS, range, rangeBounds, currentRange, setRange, rangeLabel, axisMax,
    icon, logo, favicon, favOk, favErr, popover, closePop, selectMenu,
    showTip, hideTip, lineChart, kpiChart, columns, sparkline, deltaHtml, table, barList,
    pageHead, loading, paint, el, gAuth, gGate, gReconnect, gSignIn, oauthHelp, G_LOGO, GA_SCOPE, GSC_SCOPE, ADS_SCOPE, rerender,
  };
})();
