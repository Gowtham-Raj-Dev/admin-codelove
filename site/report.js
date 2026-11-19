/* Reports: one daily SEO + indexing + traffic report for all sites (or the picked site).
 * Built from CodeLove Analytics (Firestore), Search Console (Search Analytics, URL Inspection, Sitemaps) and the
 * rule-based "what to do" advice of the Index status page. Shown as a page and as self-contained Markdown
 * ("Copy for AI", "Download .md").
 * Stored in Firestore (owner-only, see firestore.rules):
 *   reports/{YYYY-MM-DD[_host]}            small: date, site, createdAt, range, summary   (the History list reads only these)
 *   reports/{YYYY-MM-DD[_host]}/body/main  md (Markdown), data (report JSON), problems (compact JSON)
 * Routes: #/reports  #/reports/history  #/reports/view?id=…  #/reports/compare?a=…&b=… */
(() => {
  'use strict';
  const { $, $$, num, pct, dur, esc, div, iso, istToday, fmtDate, rangeText, rangeLabel, currentRange, deltaHtml, favicon, icon, pageHead, loading, paint, el, gAuth } = CL;
  const CFG = window.ADMIN_CONFIG || {};
  const app = $('#app');
  const EYEBROW = 'Reports';
  const STALE = 3 * 864e5;   // re-inspect pages whose saved check is older than this
  const MAX_CHECKS = 300;    // URL inspections per report run (Google allows ~2,000/day per property)
  const KEEP_FOR_DAILY_VIEW = 50; // inspections left for the Index status page today
  const WORKERS = 3;
  const BODY_MAX = 900e3;    // Firestore documents must stay under 1 MiB
  const repoOf = (h) => (CFG.repoFolders || {})[h] || '';
  const repoPath = (h) => (repoOf(h) ? `${CFG.repoRoot || ''}\\${repoOf(h)}` : '');
  const today = () => iso(istToday());
  const idFor = (date, site) => date + (site ? '_' + site : '');
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const link = (tab, q = '') => `#/reports${tab ? '/' + tab : ''}${q ? '?' + q : ''}`;

  // ---------- storage ----------
  const db = () => OWN.db();
  const metaRef = (id) => db().collection('reports').doc(id);
  const bodyRef = (id) => metaRef(id).collection('body').doc('main');
  let metas = null; // cached History list
  const bodies = new Map();
  async function getMeta(id) { const d = await metaRef(id).get(); return d.exists ? { id, ...d.data() } : null; }
  async function loadReport(id) {
    if (!bodies.has(id)) {
      bodies.set(id, bodyRef(id).get().then((d) => {
        if (!d.exists) return null;
        const b = d.data();
        return { md: b.md || '', rep: JSON.parse(b.data || 'null') };
      }).catch((e) => { bodies.delete(id); throw e; }));
    }
    return bodies.get(id);
  }
  async function listMetas() {
    if (!metas) {
      metas = db().collection('reports').orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(120).get().then((snap) => {
        const out = []; snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
        return out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
      }).catch((e) => { metas = null; throw e; });
    }
    return metas;
  }
  const bytes = (s) => new Blob([s]).size;
  async function save(rep, md) {
    let data = JSON.stringify(rep);
    // keep the body document well under 1 MiB: drop indexed pages without advice, then shorten keyword lists
    if (bytes(data) + bytes(md) > BODY_MAX) {
      rep.sites.forEach((s) => { if (s.gsc) s.gsc.pages = s.gsc.pages.filter((p) => p.st !== 'yes' || p.adv.some((a) => a.k !== 'info')); });
      data = JSON.stringify(rep);
    }
    if (bytes(data) + bytes(md) > BODY_MAX) {
      rep.sites.forEach((s) => { if (s.gsc) { s.gsc.top = s.gsc.top.slice(0, 15); s.gsc.pages = s.gsc.pages.filter((p) => p.st === 'no').slice(0, 60); } });
      data = JSON.stringify(rep); rep.trimmed = true;
    }
    const problems = JSON.stringify(rep.sites.flatMap((s) => s.problems.map((p) => [s.host, p.sev, p.title, p.url || '', p.status || ''])));
    await bodyRef(rep.id).set({ md, data, problems });
    await metaRef(rep.id).set({ date: rep.date, site: rep.site || '', createdAt: rep.createdAt, range: rep.range, summary: rep.totals, bytes: bytes(data) + bytes(md) + bytes(problems) });
    metas = null; bodies.set(rep.id, Promise.resolve({ md, rep }));
    todayKnown = null;
  }

  // ---------- generate ----------
  let job = null; // { site, phase, msg, done, total, stop, error, startedAt }
  const pickT = (t) => ({ u: t.u || 0, n: t.n || 0, s: t.s || 0, v: t.v || 0, sec: t.sec || 0, c: t.c || 0 });
  async function generate(site) {
    const R = currentRange();
    const hosts = site ? [site] : (CFG.sites || []).slice();
    const G = GSC.lib, O = OWN.lib;
    const step = (phase, msg, done = 0, total = 0) => { Object.assign(job, { phase, msg, done, total }); drawJob(); };

    step(1, 'Reading CodeLove Analytics');
    const own = await O.load(R, site ? O.siteOf(site) : undefined);

    step(2, 'Reading Search Console', 0, hosts.length);
    const { sites: gs, missing } = await G.resolve(site || undefined);
    const per = {};
    let n = 0;
    await Promise.all(gs.map(async (s) => {
      try {
        const [d, k, kp, ix] = await Promise.all([G.daily(s, R), G.keywords(s, R), G.keywordsPrev(s, R).catch(() => []), G.indexData(s, R)]);
        per[s.host] = { s, d, k, kp, ix };
      } catch (e) { per[s.host] = { s, error: e.message }; }
      step(2, 'Reading Search Console', ++n, gs.length);
    }));
    const errs = Object.values(per).filter((x) => x.error);
    if (gs.length && errs.length === gs.length && /expired|reconnect|401|auth/i.test(errs[0].error)) throw new Error(errs[0].error);

    // URL Inspection for pages never checked or checked more than 3 days ago (pages with impressions first), within the daily quota
    const stale = [];
    for (const h in per) for (const r of per[h].ix ? per[h].ix.rows : []) { const c = G.idx[r.url]; if (!c || Date.now() - c.at > STALE) stale.push({ s: per[h].s, r, seen: !!c }); }
    stale.sort((a, b) => b.r.impr - a.r.impr || a.seen - b.seen);
    const left = {}, list = [];
    for (const it of stale) {
      const p = it.s.prop.url;
      if (left[p] == null) left[p] = G.DAY_QUOTA - G.quotaUsed(p) - KEEP_FOR_DAILY_VIEW;
      if (left[p] > 0 && list.length < MAX_CHECKS) { left[p]--; list.push(it); }
    }
    const checks = { wanted: stale.length, queued: list.length, done: 0, failed: 0, err: '', stopped: false };
    step(3, 'Checking index status with Google', 0, list.length);
    let k = 0;
    const worker = async () => {
      while (!job.stop && k < list.length) {
        const it = list[k++];
        try { await G.inspect(it.s.prop, it.r.url); } catch (e) {
          checks.failed++; checks.err = e.message;
          if (/quota|rate limit|has not been used|disabled|permission|expired|reconnect/i.test(e.message)) job.stop = true;
        }
        checks.done++; step(3, 'Checking index status with Google', checks.done, list.length);
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    checks.stopped = job.stop && checks.done < list.length;
    for (const h in per) if (per[h].ix) per[h].ix.refresh();

    step(4, 'Writing the report');
    const rep = build(R, site, hosts, own, per, missing, checks);
    const md = toMarkdown(rep);
    step(5, 'Saving to History');
    await save(rep, md);
    return rep;
  }

  const SEV_ORDER = { fix: 0, win: 1, info: 2 };
  const fmtDay = (s) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  function statusLine(p) {
    if (!p.at) return 'Not checked with Google yet';
    const parts = [`Google says: "${p.cov || p.verdict || 'unknown'}"`];
    if (p.verdict) parts.push(`verdict ${p.verdict}`);
    if (p.state && p.state !== 'INDEXING_ALLOWED') parts.push(`indexing ${p.state}`);
    if (p.robots && p.robots !== 'ALLOWED') parts.push(`robots.txt ${p.robots}`);
    if (p.fetch && p.fetch !== 'SUCCESSFUL') parts.push(`page fetch ${p.fetch}`);
    parts.push(p.crawl ? `last crawl ${fmtDay(p.crawl)}` : 'never crawled');
    if (p.gc && p.uc && p.gc !== p.uc) parts.push(`Google canonical ${p.gc} but page canonical ${p.uc}`);
    return parts.join(' · ');
  }
  function build(R, site, hosts, own, per, missing, checks) {
    const G = GSC.lib;
    const ownBy = Object.fromEntries(own.map((o) => [o.host, o]));
    const noPrev = !!(OWN.lib.SINCE && R.prevEnd < OWN.lib.SINCE);
    const sites = hosts.map((host) => {
      const o = ownBy[host], g = per[host];
      const out = { host, url: `https://${host}/`, repo: repoOf(host), traffic: null, gsc: null, problems: [] };
      const add = (sev, impact, title, detail, extra = {}) => out.problems.push({ sev, impact, title, detail, ...extra });
      if (o) out.traffic = { cur: pickT(o.cur), prev: pickT(o.prev), noPrev, top: OWN.lib.pageRows([o]).sort((a, b) => b.views - a.views).slice(0, 5).map((p) => ({ path: p.path, title: p.title, views: p.views, users: p.users, time: p.time })) };
      if (!g) add('fix', 9e8, 'Not in Search Console', 'This Google account has no Search Console property for this site, so there is no Google search data and no index checks. Add the Domain property codelove.in in Search Console (it covers every subdomain).');
      else if (g.error) add('fix', 9e8, 'Search Console data could not be read', g.error);
      else {
        const S = G.series(R, [g.d]);
        const prevBy = new Map(g.kp.map((x) => [x.query, x]));
        const nowSet = new Set(g.k.map((x) => x.query));
        const kws = g.k.slice().sort((a, b) => b.impr - a.impr || a.pos - b.pos);
        const moves = kws.filter((x) => prevBy.has(x.query) && x.impr >= 3 && x.pos && prevBy.get(x.query).pos)
          .map((x) => ({ q: x.query, pos: +x.pos.toFixed(1), prev: +prevBy.get(x.query).pos.toFixed(1), impr: x.impr, d: +(prevBy.get(x.query).pos - x.pos).toFixed(1) }));
        const quick = kws.filter((x) => x.rank > 10 && x.rank <= 20 && x.impr).slice(0, 10).map((x) => ({ q: x.query, rank: x.rank, impr: x.impr, clicks: x.clicks }));
        const tr = G.targetRows({ host, k: g.k });
        const ix = g.ix;
        const pages = ix.rows.map((r) => {
          const x = G.idx[r.url] || {};
          return { url: r.url, path: r.path, st: r.st, cov: x.cov || '', verdict: x.v || '', state: x.state || '', robots: x.robots || '', fetch: x.fetch || '', crawl: x.crawl || '', gc: x.gc || '', uc: x.uc || '', mob: x.mob || '', at: x.at || 0, impr: r.impr, clicks: r.clicks, best: r.best, inSitemap: r.inSitemap, inSearch: r.inSearch, adv: r.adv.map((a) => ({ k: a.k, s: a.s, t: a.t })) };
        });
        const sm = Array.isArray(ix.maps) ? ix.maps.map((m) => ({ path: m.path, submitted: m.lastSubmitted || '', read: m.lastDownloaded || '', errors: Number(m.errors) || 0, warnings: Number(m.warnings) || 0, pending: !!m.isPending, urls: (m.contents || []).reduce((a, c) => a + Number(c.submitted || 0), 0) })) : null;
        const count = (st) => pages.filter((p) => p.st === st).length;
        out.gsc = {
          prop: g.s.prop.url, cur: S.cur, prev: S.prev, kws: g.k.length, page1: g.k.filter((x) => x.rank && x.rank <= 10).length,
          newKws: g.k.filter((x) => !prevBy.has(x.query)).length, lostKws: g.kp.filter((x) => !nowSet.has(x.query)).length,
          top: kws.slice(0, 50).map((x) => ({ q: x.query, clicks: x.clicks, impr: x.impr, ctr: +x.ctr.toFixed(4), pos: +x.pos.toFixed(1), rank: x.rank })),
          gainers: moves.filter((m) => m.d >= 1).sort((a, b) => b.d - a.d || b.impr - a.impr).slice(0, 8),
          losers: moves.filter((m) => m.d <= -1).sort((a, b) => a.d - b.d || b.impr - a.impr).slice(0, 8),
          quick, targets: { total: tr.length, missing: tr.filter((t) => !t.rank).map((t) => t.target), showing: tr.filter((t) => t.rank).map((t) => ({ t: t.target, rank: t.rank })) },
          index: { known: pages.length, indexed: count('yes'), notIndexed: count('no'), unchecked: count('unk') },
          pages, sitemaps: sm, sitemapsError: sm ? '' : ix.maps.error, sitemapRead: ix.sm.errors, sitemapUrls: ix.sm.urls.length,
        };
        // problems: sitemap first (affects every page), then per page (not indexed first, by impressions)
        if (!sm) add('fix', 8e8, 'Sitemaps could not be read from Search Console', ix.maps.error);
        else if (!sm.length) add('fix', 8e8, 'No sitemap submitted', `Search Console has no sitemap for ${host}. In Search Console → Sitemaps add https://${host}/sitemap.xml (make sure the site serves it).`, { url: `https://${host}/sitemap.xml`, gsc: true });
        sm?.forEach((m) => {
          if (m.errors) add('fix', 7e8, `Sitemap has ${m.errors} error${m.errors > 1 ? 's' : ''}`, 'Open the sitemap in Search Console → Sitemaps to see the errors; every <loc> must be a full https URL on this host that returns 200, then resubmit.', { url: m.path, status: `Submitted ${fmtDay(m.submitted)} · Google read it ${fmtDay(m.read) || 'never'}` });
          else if (m.warnings) add('win', 3e8, `Sitemap has ${m.warnings} warning${m.warnings > 1 ? 's' : ''}`, 'Open the sitemap in Search Console → Sitemaps to see the warnings and fix them, then resubmit.', { url: m.path, status: `Submitted ${fmtDay(m.submitted)} · Google read it ${fmtDay(m.read) || 'never'}` });
        });
        ix.sm.errors.forEach((e) => add('fix', 6e8, 'sitemap.xml could not be read', `${e}. The site must serve /sitemap.xml (with CORS * so this dashboard can read it) listing every public page.`, { url: `https://${host}/sitemap.xml` }));
        for (const p of pages) for (const a of p.adv) {
          if (a.k === 'info' && !(p.st === 'unk' && p.impr === 0 && a.s === 'Not checked yet')) continue;
          const impact = (a.k === 'fix' ? 1e6 : a.k === 'win' ? 1e3 : 0) + (p.st === 'no' ? 5e5 : 0) + p.impr;
          add(a.k, impact, a.s, a.t, { url: p.url, status: statusLine(p), impr: p.impr, best: p.best });
        }
        if (tr.length && out.gsc.targets.missing.length) add('win', 500, `${out.gsc.targets.missing.length} of ${tr.length} target keywords not in Google yet`, `No impression for: ${out.gsc.targets.missing.map((t) => `"${t}"`).join(', ')}. Use these phrases in page titles, H1s, headings and body text of the most relevant pages (or add a page per phrase), and link to those pages from the site's home and the network footer.`);
      }
      if (out.traffic && !out.traffic.cur.v && !out.traffic.cur.sec) add('info', 0, 'No visits recorded', 'CodeLove Analytics recorded no visits for this site in the range. If the site is live, check that the tracker snippet (https://admin.codelove.in/t.js) is in its <head>.');
      out.problems.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || b.impact - a.impact);
      return out;
    });
    const sum = (f) => sites.reduce((a, s) => a + (f(s) || 0), 0);
    const cnt = (sev) => sum((s) => s.problems.filter((p) => p.sev === sev).length);
    const totals = {
      sites: sites.length, fix: cnt('fix'), win: cnt('win'), info: cnt('info'),
      clicks: sum((s) => s.gsc?.cur.c), impr: sum((s) => s.gsc?.cur.i), prevClicks: sum((s) => s.gsc?.prev.c), prevImpr: sum((s) => s.gsc?.prev.i),
      indexed: sum((s) => s.gsc?.index.indexed), notIndexed: sum((s) => s.gsc?.index.notIndexed), unchecked: sum((s) => s.gsc?.index.unchecked),
      visitors: sum((s) => s.traffic?.cur.u), prevVisitors: sum((s) => s.traffic?.prev.u), views: sum((s) => s.traffic?.cur.v),
    };
    const date = today();
    return {
      v: 1, id: idFor(date, site), date, createdAt: Date.now(), site: site || null, missing,
      range: { start: R.start, end: R.end, prevStart: R.prevStart, prevEnd: R.prevEnd, days: R.days, label: rangeLabel() }, checks, sites, totals,
    };
  }

  // ---------- Markdown (self-contained, for pasting into an AI chat) ----------
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const SEV_MD = { fix: 'FIX', win: 'IMPROVE', info: 'NOTE' };
  function toMarkdown(rep) {
    const L = [], T = rep.totals, rng = `${fmtDate(rep.range.start)} – ${fmtDate(rep.range.end)}`;
    L.push(`# CodeLove SEO & indexing report · ${fmtDate(rep.date)}${rep.site ? ` · ${rep.site}` : ''}`, '');
    L.push(`> **Task:** Fix these SEO/indexing problems in the repos under \`${CFG.repoRoot || ''}\` (each site's repo folder is given in its section). Go through the problems in order (most important first). For each one: open that page's source in the repo, make the fix, keep the canonical URL, internal links and sitemap.xml consistent, and don't break other pages. Things that can only be done in Google Search Console (Request indexing, resubmit sitemap) — list them for me at the end. Then summarise what you changed in each repo.`, '');
    L.push(`- Generated: ${new Date(rep.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} (IST)`);
    L.push(`- Date range: ${rng} (${rep.range.days} days), compared with the ${rep.range.days} days before. Search Console data is 2–3 days late.`);
    L.push('- "Google page" = average position ÷ 10, rounded up (#1–10 = page 1). Lower position is better.');
    const c = rep.checks;
    L.push(`- Index checks (URL Inspection API) this run: ${c.done - c.failed} of ${c.queued} done${c.failed ? `, ${c.failed} failed (${c.err})` : ''}${c.wanted > c.queued ? `; ${c.wanted - c.queued} older/unchecked pages left for another day (daily quota)` : ''}${c.stopped ? '; stopped early' : ''}.`);
    if (rep.trimmed) L.push('- Note: lists were shortened to fit the stored report.');
    L.push('', '## Summary', '');
    L.push(`Problems to fix: **${T.fix}** · Improvements: **${T.win}** · Indexed pages: ${T.indexed} · Not indexed: ${T.notIndexed} · Not checked: ${T.unchecked} · Clicks: ${num(T.clicks)} · Impressions: ${num(T.impr)} · Visitors: ${num(T.visitors)}`, '');
    L.push('| Site | Repo folder | Fix | Improve | Clicks | Impressions | Avg position | Indexed / not | Visitors |', '|---|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const s of rep.sites) {
      const g = s.gsc;
      L.push(`| ${s.host} | ${cell(repoPath(s.host) || '–')} | ${s.problems.filter((p) => p.sev === 'fix').length} | ${s.problems.filter((p) => p.sev === 'win').length} | ${g ? num(g.cur.c) : '–'} | ${g ? num(g.cur.i) : '–'} | ${g && g.cur.pos ? g.cur.pos.toFixed(1) : '–'} | ${g ? `${g.index.indexed} / ${g.index.notIndexed}` : '–'} | ${s.traffic ? num(s.traffic.cur.u) : '–'} |`);
    }
    for (const s of rep.sites) {
      const g = s.gsc, t = s.traffic;
      L.push('', `## ${s.host}`, '');
      L.push(`- URL: ${s.url}`);
      L.push(`- Repo: \`${repoPath(s.host) || 'unknown (add it to repoFolders in admin-codelove/site/config.js)'}\``);
      if (g) L.push(`- Search Console property: ${g.prop}`);
      const probs = s.problems.filter((p) => p.sev !== 'info' || p.title !== 'Not checked yet');
      L.push('', '### Problems (most important first)', '');
      if (!probs.length) L.push('None found.');
      probs.forEach((p, i) => {
        L.push(`${i + 1}. **[${SEV_MD[p.sev]}] ${p.title}**${p.url ? ` — ${p.url}` : ''}`);
        if (p.status) L.push(`   - Status: ${p.status}`);
        if (p.impr != null && p.url) L.push(`   - Search: ${num(p.impr)} impressions in range${p.best ? `, best position #${p.best} (Google page ${Math.ceil(p.best / 10)})` : ''}`);
        L.push(`   - Fix: ${p.detail}`);
      });
      const unk = s.problems.filter((p) => p.title === 'Not checked yet').length;
      if (unk) L.push(`- ${unk} page${unk > 1 ? 's' : ''} not checked with Google yet (quota); run the report again tomorrow.`);
      if (g) {
        L.push('', '### Google Search keywords', '');
        L.push(`Clicks ${num(g.cur.c)} (prev ${num(g.prev.c)}) · Impressions ${num(g.cur.i)} (prev ${num(g.prev.i)}) · CTR ${pct(g.cur.i ? g.cur.ctr : null)} · Avg position ${g.cur.pos ? g.cur.pos.toFixed(1) : '–'} (prev ${g.prev.pos ? g.prev.pos.toFixed(1) : '–'}) · ${g.kws} keywords, ${g.page1} on page 1 · ${g.newKws} new, ${g.lostKws} gone vs previous period`, '');
        if (g.top.length) {
          L.push('| Keyword | Clicks | Impressions | CTR | Avg position | Google page |', '|---|---:|---:|---:|---:|---:|');
          g.top.slice(0, 12).forEach((k) => L.push(`| ${cell(k.q)} | ${k.clicks} | ${k.impr} | ${pct(k.ctr)} | ${k.pos} | ${k.rank ? Math.ceil(k.rank / 10) : '–'} |`));
        }
        if (g.quick.length) L.push('', `**Page-2 quick wins** (move to page 1 by targeting these phrases in title/H1/content + internal links): ${g.quick.map((q) => `"${q.q}" #${q.rank} (${q.impr} impr.)`).join('; ')}`);
        if (g.gainers.length) L.push('', `**Biggest gainers:** ${g.gainers.map((m) => `"${m.q}" ${m.prev} → ${m.pos}`).join('; ')}`);
        if (g.losers.length) L.push('', `**Biggest losers:** ${g.losers.map((m) => `"${m.q}" ${m.prev} → ${m.pos}`).join('; ')}`);
        if (g.targets.total) L.push('', `**Target keywords not in Google yet (${g.targets.missing.length} of ${g.targets.total}):** ${g.targets.missing.length ? g.targets.missing.map((x) => `"${x}"`).join(', ') : 'none'}`);
        L.push('', '### Index status', '');
        L.push(`${g.index.known} pages known (sitemap.xml has ${g.sitemapUrls} URLs) · indexed ${g.index.indexed} · not indexed ${g.index.notIndexed} · not checked ${g.index.unchecked}`);
        const bad = g.pages.filter((p) => p.st === 'no');
        if (bad.length) {
          L.push('', '| Page | Google says | Last crawl | In sitemap | Impressions |', '|---|---|---|---|---:|');
          bad.forEach((p) => L.push(`| ${cell(p.url)} | ${cell(p.cov || p.verdict)} | ${p.crawl ? fmtDay(p.crawl) : 'never'} | ${p.inSitemap ? 'yes' : 'no'} | ${p.impr} |`));
        }
        if (g.sitemaps?.length) {
          L.push('', '**Sitemaps in Search Console:**');
          g.sitemaps.forEach((m) => L.push(`- ${m.path}: ${m.pending ? 'pending' : m.errors ? `${m.errors} errors` : m.warnings ? `${m.warnings} warnings` : 'OK'} · submitted ${fmtDay(m.submitted) || '–'} · Google read it ${fmtDay(m.read) || 'never'} · ${m.urls} URLs`));
        }
      }
      if (t) {
        L.push('', '### Traffic (CodeLove Analytics)', '');
        const ch = (a, b) => (t.noPrev || !b ? '' : ` (${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(0)}%)`);
        L.push(`Visitors ${num(t.cur.u)}${ch(t.cur.u, t.prev.u)} · Visits ${num(t.cur.s)}${ch(t.cur.s, t.prev.s)} · Page views ${num(t.cur.v)}${ch(t.cur.v, t.prev.v)} · Time ${dur(t.cur.sec)} · Clicks ${num(t.cur.c)}`);
        if (t.top.length) L.push(`Top pages: ${t.top.map((p) => `${p.path} (${num(p.views)} views)`).join(', ')}`);
      }
    }
    if (rep.missing && rep.missing.length) L.push('', `Not in Search Console: ${rep.missing.join(', ')}`);
    L.push('');
    return L.join('\n');
  }

  // ---------- compare two reports ----------
  function compare(a, b) { // a = newer, b = older
    const key = (h, p) => `${h}|${p.url || ''}|${p.title}`;
    const map = (r) => { const m = new Map(); r.sites.forEach((s) => s.problems.filter((p) => p.sev !== 'info').forEach((p) => m.set(key(s.host, p), { host: s.host, ...p }))); return m; };
    const A = map(a), B = map(b);
    const added = [...A].filter(([k]) => !B.has(k)).map(([, v]) => v);
    const fixed = [...B].filter(([k]) => !A.has(k)).map(([, v]) => v);
    const moves = [], idx = [];
    for (const s of a.sites) {
      const o = b.sites.find((x) => x.host === s.host);
      if (!o || !s.gsc || !o.gsc) continue;
      const prev = new Map(o.gsc.top.map((k) => [k.q, k]));
      s.gsc.top.forEach((k) => { const p = prev.get(k.q); if (p && p.pos && k.pos && Math.abs(p.pos - k.pos) >= 0.5) moves.push({ host: s.host, q: k.q, from: p.pos, to: k.pos, d: +(p.pos - k.pos).toFixed(1), impr: k.impr }); });
      const st = new Map(o.gsc.pages.map((p) => [p.url, p.st]));
      s.gsc.pages.forEach((p) => { const was = st.get(p.url); if (was && was !== p.st && p.st !== 'unk' && was !== 'unk') idx.push({ host: s.host, url: p.url, from: was, to: p.st, cov: p.cov }); });
    }
    moves.sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || y.impr - x.impr);
    return { added, fixed, moves: moves.slice(0, 40), idx };
  }

  // ---------- views ----------
  const SEV = { fix: ['Fix', 'none'], win: ['Improve', 'p23'], info: ['Note', 'deep'] };
  const sevPill = (k) => `<span class="gp ${SEV[k][1]}">${SEV[k][0]}</span>`;
  const ST = { yes: ['Indexed', 'p1'], no: ['Not indexed', 'none'], unk: ['Not checked', 'deep'] };
  const stPill = (st) => `<span class="gp ${ST[st][1]}">${ST[st][0]}</span>`;
  const gpage = (rank, short) => (rank ? `<span class="gp ${rank <= 10 ? 'p1' : rank <= 30 ? 'p23' : 'deep'}" title="Average position ${rank}, Google results page ${Math.ceil(rank / 10)}">${short ? 'P' : 'Page '}${Math.ceil(rank / 10)} <span class="gp-rank">#${rank}</span></span>` : '<span class="muted">–</span>');
  const tile = (label, value, sub = '', cls = '') => `<div class="stat${cls ? ' ' + cls : ''}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;
  const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  function msgCard(ic, title, text, extra = '') {
    return `<section class="card state-card"><span class="state-ic neutral">${icon(ic)}</span><h2>${title}</h2><p>${text}</p>${extra}</section>`;
  }
  async function needOwner(alive) {
    const u = await OWN.authReady();
    if (!alive()) return false;
    const owner = CFG.ownerEmail;
    if (!u || (owner && u.email !== owner)) {
      paint(msgCard('key', 'Sign in first', `Reports are saved in CodeLove Analytics' database, which only the owner account${owner ? ` (<b>${esc(owner)}</b>)` : ''} can read. Sign in on the CodeLove Analytics page, then come back.`, `<a class="btn primary" href="#/">Go to sign-in</a>`), false);
      return false;
    }
    return true;
  }

  function jobCard() {
    if (!job) return '';
    const steps = [[1, 'Traffic from CodeLove Analytics'], [2, 'Keywords, pages and sitemaps from Search Console'], [3, 'Index status checks (URL Inspection)'], [4, 'Problems and advice'], [5, 'Saving to History']];
    const p = job.total ? Math.round(div(job.done, job.total) * 100) : 0;
    return `<section class="card job" id="repJob"><div class="card-head"><h2>${job.error ? 'Report failed' : 'Generating report'}${job.site ? ` · ${esc(job.site)}` : ' · all sites'}</h2>${job.error ? '' : `<button type="button" class="btn sm" id="repStop"${job.phase !== 3 || job.stop ? ' disabled' : ''}>${job.stop ? 'Stopping…' : 'Stop checks'}</button>`}</div>
      <ol class="steps">${steps.map(([n, label]) => `<li class="${job.phase > n ? 'done' : job.phase === n ? (job.error ? 'err' : 'now') : ''}"><span class="step-dot">${job.phase > n ? icon('check') : n}</span><span>${label}${job.phase === n && job.total ? ` <span class="muted">· ${num(job.done)} of ${num(job.total)}</span>` : ''}${job.phase === 3 && n === 3 && !job.total ? ' <span class="muted">· nothing to re-check</span>' : ''}</span></li>`).join('')}</ol>
      ${job.phase === 3 && job.total ? `<div class="idx-progress"><span class="bar"><i style="width:${p}%"></i></span><span>${p}% · pages checked more than 3 days ago or never; quota-safe</span></div>` : ''}
      ${job.error ? `<div class="error">${icon('alert')}<div>${esc(job.error)}</div></div><button type="button" class="btn" id="repRetry">Try again</button>` : ''}</section>`;
  }
  function drawJob() {
    const box = $('#repJob');
    if (!box) return;
    box.outerHTML = jobCard();
    wireJob();
  }
  function wireJob() {
    const s = $('#repStop'); if (s) s.onclick = () => { if (job) { job.stop = true; drawJob(); } };
    const r = $('#repRetry'); if (r) r.onclick = () => { job = null; rerender(); };
  }

  // Generate: Google must be ready first (this runs inside the click, so a silent renew may open Google's window).
  async function startGenerate(site, confirmed = false) {
    if (job && !job.error) return;
    const id = idFor(today(), site);
    if (!confirmed) {
      let exists = null;
      try { exists = await getMeta(id); } catch { /* ignore */ }
      if (exists) { showReplace(site, exists); return; }
    }
    const G = GSC.lib;
    if (!gAuth.has(G.SCOPE)) {
      try { if (gAuth.known(G.SCOPE)) await gAuth.renew(true); else await gAuth.connect(); } catch (e) { if (e.code !== 'popup_closed') flash(e.message); return; }
      if (!gAuth.has(G.SCOPE)) { flash('Search Console access is needed for the report. Press Generate again and allow it on the Google screen.'); return; }
    }
    job = { site, phase: 1, msg: '', done: 0, total: 0, stop: false, error: '', startedAt: Date.now() };
    const slot = $('#repJobSlot'); if (slot) { slot.innerHTML = jobCard(); wireJob(); }
    try {
      const rep = await generate(site);
      job = null;
      if (CL.state().src === 'rep' && CL.state().tab === 'overview') rerender();
    } catch (e) {
      job.error = e.reconnect ? 'Google access expired while the report was running. Press "Try again".' : e.message;
      drawJob();
    }
  }
  function flash(msg) {
    const slot = $('#repJobSlot');
    if (slot) slot.innerHTML = `<div class="error">${icon('alert')}<div>${esc(msg)}</div></div>`;
  }
  function showReplace(site, m) {
    const slot = $('#repJobSlot');
    if (!slot) return;
    slot.innerHTML = `<div class="banner warn">${icon('alert')}<div><b>Today's report${site ? ` for ${esc(site)}` : ''} already exists</b> (made ${esc(when(m.createdAt))}). Generating again replaces it.
      <div class="banner-actions"><button type="button" class="btn primary sm" id="repReplace">Replace it</button><button type="button" class="btn sm" id="repKeep">Keep the existing one</button></div></div></div>`;
    $('#repReplace').onclick = () => startGenerate(site, true);
    $('#repKeep').onclick = () => { slot.innerHTML = ''; };
  }

  function actionsBar(rep, md) {
    return `<section class="card rep-actions"><div class="ra-text"><b>Copy for AI</b><span class="note">Self-contained Markdown: every problem with page URL, Google's exact status, suggested fix and the repo folder. Paste it into an AI chat to get the fixes.</span></div>
      <div class="ra-btns"><button type="button" class="btn primary lg" id="repCopy">${icon('copy')}Copy for AI</button><button type="button" class="btn lg" id="repDl">${icon('download')}Download .md</button><button type="button" class="btn lg" id="repText">${icon('file')}Show text</button></div>
      <pre class="code md-text" id="repMd" hidden></pre></section>`;
  }
  function wireActions(rep, md) {
    $('#repMd').textContent = md;
    const cp = $('#repCopy');
    cp.onclick = async () => {
      try { await navigator.clipboard.writeText(md); } catch {
        const ta = Object.assign(document.createElement('textarea'), { value: md }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      cp.innerHTML = `${icon('check')}Copied`; setTimeout(() => { cp.innerHTML = `${icon('copy')}Copy for AI`; }, 2200);
    };
    $('#repDl').onclick = () => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: `codelove-report-${rep.id}.md` });
      document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    $('#repText').onclick = (e) => { const pre = $('#repMd'); pre.hidden = !pre.hidden; e.currentTarget.lastChild.textContent = pre.hidden ? 'Show text' : 'Hide text'; };
  }

  function siteSection(s, open) {
    const g = s.gsc, t = s.traffic;
    const fix = s.problems.filter((p) => p.sev === 'fix').length, win = s.problems.filter((p) => p.sev === 'win').length;
    const probs = s.problems.filter((p) => p.title !== 'Not checked yet');
    const unk = s.problems.length - probs.length;
    const kwRows = g ? g.top.slice(0, 8) : [];
    return `<details class="card rep-site"${open ? ' open' : ''}><summary class="rs-head">
        <span class="rs-title">${favicon(s.host)}<span><b>${esc(s.host)}</b>${s.repo ? `<span class="repo-chip" title="${esc(repoPath(s.host))}">${icon('code')}${esc(s.repo)}</span>` : ''}</span></span>
        <span class="rs-counts">${fix ? `<span class="gp none">${fix} to fix</span>` : ''}${win ? `<span class="gp p23">${win} to improve</span>` : ''}${!fix && !win ? '<span class="gp p1">All good</span>' : ''}${icon('chev', 'rs-chev')}</span></summary>
      <div class="rs-body">
        <div class="rs-sub">Problems${probs.length ? ` · ${probs.length}` : ''}</div>
        ${probs.length ? `<ol class="probs">${probs.map((p) => `<li class="prob k-${p.sev}"><div class="prob-top">${sevPill(p.sev)}<b>${esc(p.title)}</b>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\//, ''))}</a>` : ''}</div>${p.status ? `<div class="prob-status">${esc(p.status)}${p.impr ? ` · ${num(p.impr)} impressions` : ''}</div>` : ''}<div class="prob-fix">${esc(p.detail)}</div></li>`).join('')}</ol>` : '<p class="empty">No problems found.</p>'}
        ${unk ? `<p class="note">${unk} page${unk > 1 ? 's' : ''} not checked with Google yet (daily quota); the next report checks them.</p>` : ''}
        <div class="rs-grid">
          ${g ? `<div class="rs-col"><div class="rs-sub">Google Search</div>
            <div class="mini-stats">${tile('Clicks', num(g.cur.c), deltaHtml(g.cur.c, g.prev.c))}${tile('Impressions', num(g.cur.i), deltaHtml(g.cur.i, g.prev.i))}${tile('Avg position', g.cur.pos ? g.cur.pos.toFixed(1) : '–', g.cur.pos && g.prev.pos ? deltaHtml(g.cur.pos, g.prev.pos, { lower: true }) : '')}</div>
            ${kwRows.length ? `<div class="rs-tbl"><table class="mini"><thead><tr><th>Keyword</th><th class="num">Impressions</th><th class="num">Clicks</th><th class="num">Google</th></tr></thead><tbody>${kwRows.map((k) => `<tr><td class="kw" title="${esc(k.q)}">${esc(k.q)}</td><td class="num">${num(k.impr)}</td><td class="num">${num(k.clicks)}</td><td class="num">${gpage(k.rank, true)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No keywords in this range.</p>'}
            ${g.quick.length ? `<p class="rs-line"><b>Page-2 quick wins:</b> ${g.quick.slice(0, 5).map((q) => `${esc(q.q)} <span class="muted">#${q.rank}</span>`).join(' · ')}</p>` : ''}
            ${g.gainers.length ? `<p class="rs-line"><span class="delta up">▲</span> ${g.gainers.slice(0, 4).map((m) => `${esc(m.q)} <span class="muted">${m.prev} → ${m.pos}</span>`).join(' · ')}</p>` : ''}
            ${g.losers.length ? `<p class="rs-line"><span class="delta down">▼</span> ${g.losers.slice(0, 4).map((m) => `${esc(m.q)} <span class="muted">${m.prev} → ${m.pos}</span>`).join(' · ')}</p>` : ''}
            ${g.targets.total ? `<p class="rs-line"><b>Targets not in Google:</b> ${g.targets.missing.length ? g.targets.missing.map(esc).join(', ') : 'none'}</p>` : ''}
          </div>
          <div class="rs-col"><div class="rs-sub">Index status</div>
            <div class="mini-stats">${tile('Indexed', num(g.index.indexed), '', 'good')}${tile('Not indexed', num(g.index.notIndexed), '', g.index.notIndexed ? 'bad' : '')}${tile('Not checked', num(g.index.unchecked))}</div>
            <div class="ix-bar" title="${g.index.indexed} indexed · ${g.index.notIndexed} not indexed · ${g.index.unchecked} not checked"><i class="y" style="flex:${g.index.indexed}"></i><i class="n" style="flex:${g.index.notIndexed}"></i><i class="u" style="flex:${g.index.unchecked}"></i></div>
            <ul class="ix-list">${g.pages.filter((p) => p.st === 'no').slice(0, 8).map((p) => `<li>${stPill(p.st)}<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.path)}</a><span class="muted">${esc(p.cov)}</span></li>`).join('')}</ul>
            ${g.sitemaps ? `<p class="rs-line"><b>Sitemaps:</b> ${g.sitemaps.length ? g.sitemaps.map((m) => `${esc(m.path.replace(/^https?:\/\/[^/]+/, ''))} ${m.errors ? `<span class="delta down">${m.errors} errors</span>` : m.warnings ? `<span class="muted">${m.warnings} warnings</span>` : '<span class="delta up">OK</span>'}`).join(' · ') : 'none submitted'}</p>` : ''}
            <p class="rs-line"><a href="${CL.link({ src: 'gsc', tab: 'index', site: s.host })}">Open Index status →</a></p>
          </div>` : `<div class="rs-col"><div class="rs-sub">Google Search</div><p class="empty">Not in Search Console.</p></div>`}
          ${t ? `<div class="rs-col"><div class="rs-sub">Traffic · CodeLove Analytics</div>
            <div class="mini-stats">${tile('Visitors', num(t.cur.u), t.noPrev ? '' : deltaHtml(t.cur.u, t.prev.u))}${tile('Page views', num(t.cur.v), t.noPrev ? '' : deltaHtml(t.cur.v, t.prev.v))}${tile('Time', dur(t.cur.sec))}</div>
            ${t.top.length ? `<ul class="ix-list">${t.top.map((p) => `<li><a href="https://${esc(s.host)}${esc(p.path)}" target="_blank" rel="noopener">${esc(p.path)}</a><span class="muted">${num(p.views)} views</span></li>`).join('')}</ul>` : '<p class="empty">No visits in this range.</p>'}
          </div>` : ''}
        </div>
      </div></details>`;
  }

  function renderReport(rep, md, { head, extra = '' } = {}) {
    const T = rep.totals, c = rep.checks;
    const order = rep.sites.slice().sort((a, b) => {
      const f = (s) => s.problems.filter((p) => p.sev === 'fix').length * 1e3 + s.problems.filter((p) => p.sev === 'win').length;
      return f(b) - f(a) || (b.gsc?.cur.i || 0) - (a.gsc?.cur.i || 0);
    });
    paint(head + extra + '<div id="repJobSlot">' + jobCard() + '</div>'
      + `<div class="stat-grid">${tile('To fix', num(T.fix), 'problems that block indexing', T.fix ? 'bad' : 'good')}${tile('To improve', num(T.win), 'ranking quick wins')}${tile('Indexed', num(T.indexed), `${num(T.notIndexed)} not indexed · ${num(T.unchecked)} not checked`)}${tile('Clicks', num(T.clicks), deltaHtml(T.clicks, T.prevClicks))}${tile('Impressions', num(T.impr), deltaHtml(T.impr, T.prevImpr))}${tile('Visitors', num(T.visitors), deltaHtml(T.visitors, T.prevVisitors))}</div>`
      + actionsBar(rep, md)
      + `<p class="note rep-meta">${esc(rangeTextOf(rep))} · made ${esc(when(rep.createdAt))} · index checks this run: ${num(c.done - c.failed)} of ${num(c.queued)}${c.failed ? ` (${num(c.failed)} failed)` : ''}${c.wanted > c.queued ? ` · ${num(c.wanted - c.queued)} pages wait for tomorrow's quota` : ''}${c.stopped ? ' · stopped early' : ''}</p>`
      + `<div class="section-title"><h2>Sites</h2><span class="note">Most problems first · click a site to open or close it</span></div>`
      + order.map((s, i) => siteSection(s, order.length === 1 || (i < 3 && s.problems.some((p) => p.sev === 'fix')))).join(''));
    wireActions(rep, md);
    wireJob();
  }
  const rangeTextOf = (rep) => `${rep.range.label}: ${fmtDate(rep.range.start)} – ${fmtDate(rep.range.end)}`;

  function genButton(site) {
    return `<div class="ph-actions"><button type="button" class="btn primary" id="repGen"${job && !job.error ? ' disabled' : ''}>${icon('refresh')}Generate report</button><span class="note">${site ? esc(site) : 'All sites'} · ${esc(rangeLabel())}</span></div>`;
  }
  function wireGen(site) { const b = $('#repGen'); if (b) b.onclick = () => startGenerate(site); }

  async function viewToday(R, alive, site) {
    const id = idFor(today(), site);
    const [list, meta] = await Promise.all([listMetas(), getMeta(id)]);
    if (!alive()) return;
    const latest = meta ? meta : list.find((m) => (m.site || '') === (site || ''));
    const head = pageHead(EYEBROW, site ? `Daily report · ${esc(site)}` : 'Daily report', `SEO, indexing and traffic for ${site ? 'this site' : 'every site'}: problems first, with what to do · uses the date range above`, genButton(site));
    if (!latest) {
      paint(head + '<div id="repJobSlot">' + jobCard() + '</div>' + (job ? '' : msgCard('file', 'No report yet', `Press <b>Generate report</b>. It reads traffic and Search Console, re-checks pages whose index status is older than 3 days (within Google's daily limit), lists every problem with the fix, and saves it to History.`)));
      wireGen(site); wireJob();
      return;
    }
    const got = await loadReport(latest.id);
    if (!alive()) return;
    if (!got) { paint(head + msgCard('alert', 'Report body missing', 'Generate it again.')); wireGen(site); return; }
    const old = latest.date !== today();
    renderReport(got.rep, got.md, { head, extra: old ? `<div class="banner warn">${icon('info')}<div>Showing the last report, from <b>${esc(fmtDate(latest.date))}</b>. Today's report hasn't been generated yet.</div></div>` : '' });
    wireGen(site);
  }

  async function viewOne(alive, id) {
    const [meta, got] = await Promise.all([getMeta(id), loadReport(id)]);
    if (!alive()) return;
    const back = `<a class="crumb" href="${link('history')}">← History</a>`;
    if (!meta || !got) { paint(back + msgCard('alert', 'Report not found', esc(id))); return; }
    renderReport(got.rep, got.md, { head: back + pageHead(EYEBROW, `Report · ${esc(fmtDate(meta.date))}${meta.site ? ' · ' + esc(meta.site) : ''}`, esc(rangeTextOf(got.rep)), `<div class="ph-actions"><a class="btn" href="${link('compare', `a=${encodeURIComponent(id)}`)}">Compare with another report</a></div>`) });
  }

  async function viewHistory(alive) {
    const list = await listMetas();
    if (!alive()) return;
    paint(pageHead(EYEBROW, 'History', `${num(list.length)} saved report${list.length === 1 ? '' : 's'} · one per day (and per site when a site was picked)`, `<div class="ph-actions"><a class="btn primary" href="${link('')}">${icon('refresh')}Today's report</a></div>`));
    const card = el('section', 'card', '<div class="tbl"></div>');
    app.append(card);
    CL.table($('.tbl', card), [
      { key: 'date', label: 'Date', html: (m) => `<a href="${link('view', `id=${encodeURIComponent(m.id)}`)}"><b>${esc(fmtDate(m.date))}</b></a><span class="note block">made ${esc(when(m.createdAt))}</span>` },
      { key: 'site', label: 'Sites', html: (m) => (m.site ? `<span class="site-cell">${favicon(m.site)}${esc(m.site)}</span>` : `All sites <span class="muted">(${num(m.summary?.sites || 0)})</span>`) },
      { key: 'range', label: 'Range', html: (m) => `${esc(m.range?.label || '')}<span class="note block">${esc(m.range ? `${fmtDate(m.range.start)} – ${fmtDate(m.range.end)}` : '')}</span>` },
      { key: 'fix', label: 'To fix', num: true, html: (m) => (m.summary?.fix ? `<span class="gp none">${num(m.summary.fix)}</span>` : '<span class="gp p1">0</span>') },
      { key: 'win', label: 'To improve', num: true, html: (m) => num(m.summary?.win) },
      { key: 'indexed', label: 'Indexed / not', num: true, html: (m) => `${num(m.summary?.indexed)} <span class="muted">/ ${num(m.summary?.notIndexed)}</span>` },
      { key: 'clicks', label: 'Clicks', num: true, html: (m) => num(m.summary?.clicks) },
      { key: 'visitors', label: 'Visitors', num: true, html: (m) => num(m.summary?.visitors) },
      { key: 'act', label: '', html: (m) => `<span class="row-actions"><a class="btn sm" href="${link('view', `id=${encodeURIComponent(m.id)}`)}">Open</a><button type="button" class="btn sm hcopy" data-id="${esc(m.id)}">${icon('copy')}Copy</button>${(() => { const top = list.find((x) => (x.site || '') === (m.site || '')); return top && top.id !== m.id ? `<a class="btn sm" href="${link('compare', `a=${encodeURIComponent(top.id)}&b=${encodeURIComponent(m.id)}`)}" title="Compare with the newest report">Compare</a>` : ''; })()}</span>` },
    ], list.map((m) => ({ ...m, fix: m.summary?.fix || 0, win: m.summary?.win || 0, indexed: m.summary?.indexed || 0, clicks: m.summary?.clicks || 0, visitors: m.summary?.visitors || 0 })), { sort: 'date' });
    if (!list.length) $('.tbl', card).innerHTML = `<p class="empty">No reports saved yet. <a href="${link('')}">Generate the first one</a>.</p>`;
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('.hcopy'); if (!b) return;
      const got = await loadReport(b.dataset.id);
      if (got) { try { await navigator.clipboard.writeText(got.md); b.lastChild.textContent = 'Copied'; } catch { b.lastChild.textContent = 'Copy failed'; } }
    });
  }

  async function viewCompare(alive, aId, bId) {
    const list = await listMetas();
    if (!alive()) return;
    if (!aId) aId = list[0]?.id;
    const same = list.filter((m) => m.id !== aId);
    if (!bId) bId = same.find((m) => (m.site || '') === (list.find((x) => x.id === aId)?.site || ''))?.id || same[0]?.id;
    const opt = (sel) => list.map((m) => `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(fmtDate(m.date))}${m.site ? ' · ' + esc(m.site) : ' · all sites'}</option>`).join('');
    const head = `<a class="crumb" href="${link('history')}">← History</a>` + pageHead(EYEBROW, 'Compare reports', 'What changed between two saved reports: new problems, fixed problems, Google position changes and index changes')
      + `<section class="card cmp-pick"><label>Newer<select id="cmpA">${opt(aId)}</select></label><span class="cmp-vs">vs</span><label>Older<select id="cmpB">${opt(bId)}</select></label></section>`;
    if (!aId || !bId || aId === bId) { paint(head + msgCard('info', 'Need two reports', 'Generate reports on two different days to compare them.')); wirePick(); return; }
    const [A, B] = await Promise.all([loadReport(aId), loadReport(bId)]);
    if (!alive()) return;
    if (!A || !B) { paint(head + msgCard('alert', 'Report not found', '')); wirePick(); return; }
    const d = compare(A.rep, B.rep);
    const pl = (arr, cls) => (arr.length ? `<ol class="probs">${arr.map((p) => `<li class="prob k-${p.sev}"><div class="prob-top">${sevPill(p.sev)}<b>${esc(p.title)}</b><span class="muted">${esc(p.host)}</span>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\//, ''))}</a>` : ''}</div></li>`).join('')}</ol>` : `<p class="empty">${cls}</p>`);
    const TA = A.rep.totals, TB = B.rep.totals;
    paint(head + `<div class="stat-grid">${tile('New problems', num(d.added.length), '', d.added.length ? 'bad' : 'good')}${tile('Fixed problems', num(d.fixed.length), '', d.fixed.length ? 'good' : '')}${tile('Indexed', num(TA.indexed), deltaHtml(TA.indexed, TB.indexed))}${tile('Clicks', num(TA.clicks), deltaHtml(TA.clicks, TB.clicks))}${tile('Impressions', num(TA.impr), deltaHtml(TA.impr, TB.impr))}${tile('Visitors', num(TA.visitors), deltaHtml(TA.visitors, TB.visitors))}</div>`
      + `<div class="grid2"><section class="card"><div class="card-head"><h2>New problems</h2><span class="note">in the newer report only</span></div>${pl(d.added, 'No new problems.')}</section>
        <section class="card"><div class="card-head"><h2>Fixed problems</h2><span class="note">gone since the older report</span></div>${pl(d.fixed, 'Nothing fixed yet.')}</section></div>`
      + `<section class="card"><div class="card-head"><h2>Google position changes</h2><span class="note">avg position, lower is better</span></div><div class="tbl"></div></section>`
      + `<section class="card"><div class="card-head"><h2>Index status changes</h2></div>${d.idx.length ? `<ul class="ix-list">${d.idx.map((x) => `<li>${stPill(x.from)} → ${stPill(x.to)}<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url.replace(/^https?:\/\//, ''))}</a><span class="muted">${esc(x.cov)}</span></li>`).join('')}</ul>` : '<p class="empty">No page changed its index status.</p>'}</section>`);
    const tb = $$('.tbl', app).pop();
    if (d.moves.length) CL.table(tb, [
      { key: 'host', label: 'Site', html: (r) => esc(r.host) },
      { key: 'q', label: 'Keyword', cls: 'kw', html: (r) => esc(r.q) },
      { key: 'from', label: 'Before', num: true, fmt: (v) => v.toFixed(1) },
      { key: 'to', label: 'Now', num: true, fmt: (v) => v.toFixed(1) },
      { key: 'd', label: 'Change', num: true, html: (r) => `<span class="delta ${r.d > 0 ? 'up' : 'down'}">${r.d > 0 ? '▲' : '▼'} ${Math.abs(r.d).toFixed(1)}</span>` },
      { key: 'impr', label: 'Impressions', num: true, fmt: num },
    ], d.moves, { sort: 'd' });
    else tb.innerHTML = '<p class="empty">No keyword moved by half a position or more.</p>';
    wirePick();
    function wirePick() {
      const go = () => { location.hash = link('compare', `a=${encodeURIComponent($('#cmpA').value)}&b=${encodeURIComponent($('#cmpB').value)}`); };
      const a = $('#cmpA'), b = $('#cmpB'); if (a) a.onchange = go; if (b) b.onchange = go;
    }
  }

  async function route({ R, alive, site, tab, params }) {
    loading('Loading reports…');
    if (!(await needOwner(alive))) return;
    try {
      if (tab === 'history') await viewHistory(alive);
      else if (tab === 'view') await viewOne(alive, params.get('id'));
      else if (tab === 'compare') await viewCompare(alive, params.get('a'), params.get('b'));
      else await viewToday(R, alive, site);
    } catch (e) {
      if (!alive()) return;
      const denied = /permission|insufficient/i.test(e.message);
      paint(`<div class="error">${icon('alert')}<div><b>Couldn't load reports.</b><br>${esc(e.message)}${denied ? '<div class="note">The Firestore rules for <code>reports</code> may not be deployed yet (firebase deploy --only firestore:rules in admin-codelove).</div>' : ''}</div></div><button class="btn" id="retry">Try again</button>`, false);
      $('#retry').onclick = rerender;
    }
  }

  // Small "today's report not generated" banner on the dashboard (never runs a report by itself).
  let todayKnown = null; // { day, exists }
  async function banner(root, alive) {
    try {
      const day = today();
      if (CL.store.get('cl_rep_banner_off') === day) return;
      if (!todayKnown || todayKnown.day !== day) {
        const u = await OWN.authReady();
        if (!u) return;
        todayKnown = { day, exists: !!(await getMeta(idFor(day, null))) };
      }
      if (todayKnown.exists || !alive() || $('.rep-banner', root)) return;
      const b = el('div', 'banner rep-banner', `${icon('file')}<div class="rb-text"><b>Today's report isn't generated yet.</b> SEO, indexing and traffic problems for every site, ready to paste into an AI chat.</div><a class="btn primary sm" href="${link('')}">Generate</a><button type="button" class="icon-btn sm-x" aria-label="Hide for today">${icon('x')}</button>`);
      const head = $('.page-head', root);
      if (head) head.after(b); else root.prepend(b);
      $('.sm-x', b).onclick = () => { CL.store.set('cl_rep_banner_off', day); b.remove(); };
    } catch { /* rules not deployed or offline: no banner */ }
  }

  window.REP = { route, banner, clear: () => { metas = null; bodies.clear(); todayKnown = null; }, stop: () => {}, toMarkdown, compare };
})();
