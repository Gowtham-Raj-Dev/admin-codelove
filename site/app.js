/* CodeLove Admin — router and header. Two data sources:
 *   #/...    CodeLove Analytics (our own tracker, Firebase)   -> own.js
 *   #/ga/... Google Analytics 4                               -> ga.js */
(() => {
  'use strict';
  const { $, store, iso, addDays, istToday, currentRange, hideTip } = CL;
  let renderId = 0;

  const TABS = {
    own: [['#/', 'Overview', 'overview'], ['#/pages', 'All pages', 'pages'], ['#/live', 'Live', 'live'], ['#/tracker', 'Tracker', 'tracker']],
    ga: [['#/ga', 'Overview', 'overview'], ['#/ga/pages', 'All pages', 'pages'], ['#/ga/live', 'Live', 'live']],
  };

  function route() {
    const id = ++renderId;
    const alive = () => id === renderId;
    hideTip();
    OWN.stop(); GA.stop();
    const hash = location.hash || '#/';
    const src = hash.startsWith('#/ga') ? 'ga' : 'own';
    const rest = src === 'ga' ? hash.slice(4) : hash.slice(1);
    const tab = rest.startsWith('/pages') ? 'pages' : rest.startsWith('/live') ? 'live' : rest.startsWith('/tracker') ? 'tracker' : 'overview';
    document.querySelectorAll('#source a').forEach((a) => a.classList.toggle('on', a.dataset.src === src));
    $('#tabs').innerHTML = TABS[src].map(([href, label, t]) => `<a href="${href}" class="${t === tab && !rest.startsWith('/site/') ? 'active' : ''}">${label}</a>`).join('');
    $('#range').disabled = tab === 'live' || tab === 'tracker';
    document.body.dataset.src = src;
    const R = currentRange();
    (src === 'ga' ? GA : OWN).route(hash, R, alive);
  }

  // range controls
  const savedRange = store.get('cl_admin_range');
  if (savedRange && [...$('#range').options].some((o) => o.value === savedRange)) $('#range').value = savedRange;
  $('#from').value = store.get('cl_admin_from') || iso(addDays(istToday(), -27));
  $('#to').value = store.get('cl_admin_to') || iso(istToday());
  $('#customRange').hidden = $('#range').value !== 'custom';
  $('#range').addEventListener('change', () => { store.set('cl_admin_range', $('#range').value); $('#customRange').hidden = $('#range').value !== 'custom'; route(); });
  ['from', 'to'].forEach((k) => $('#' + k).addEventListener('change', () => { store.set('cl_admin_' + k, $('#' + k).value); route(); }));
  $('#refresh').addEventListener('click', () => { OWN.clear(); GA.clear(); route(); });
  $('#signout').addEventListener('click', () => { GA.signOut(); OWN.signOut(); route(); });
  addEventListener('hashchange', route);

  OWN.init();
  OWN.onAuth((u) => { $('#signout').hidden = !u; OWN.updateBadge(); if ((location.hash || '#/').startsWith('#/ga') === false) route(); });
  route();
})();
