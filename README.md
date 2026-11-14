# CodeLove Admin — admin.codelove.in

Two sections:

- **CodeLove Analytics** (default, `#/…`): our own tracker. `site/t.js` is added to every site with
  `<script defer src="https://admin.codelove.in/t.js"></script>` and writes pre-aggregated counts to
  Cloud Firestore (Firebase project `codelove-analytics`): one document per site per IST day,
  `d/{YYYY-MM-DD}_{host_with_underscores}`, so every flush is one write (page load, every 60 s while
  active, tab hide). Rules: `firestore.rules` (read = owner Gmail only; writes only to *.codelove.in /
  localhost docs with known fields). Big maps are excluded from indexing (`firestore.indexes.json`).
  Deploy: `firebase deploy --only firestore`.
  Free plan: 20k writes + 50k reads per day.
- **Google Analytics** (`#/ga/…`): GA4 Data/Admin API with the owner's Google login.

Private analytics dashboard for every CodeLove site: users, sessions, views, time spent,
per-site and per-page, plus a live (last 30 min) view.

Layout: sidebar (both sections) + one filter row on top: **Date range** dropdown (presets + custom),
**Site** dropdown (searchable; "All sites" or one site, kept when switching tabs), refresh, live count
and the account menu (sign-in status, theme, sign out). The KPI tiles double as the chart's metric
switch, and every chart has a table view. `config.js` → `trackingSince` is the day t.js went live;
earlier days are shown as "no data", not as zero.

- Plain static site in `site/` (no build). Deployed to GitHub Pages by `.github/workflows/deploy.yml`.
- Data comes from Google Analytics 4 (Data API + Admin API), called from the browser with the
  owner's Google login (`analytics.readonly`). Nothing is stored on a server; without a Google
  account that has access to the GA4 properties the page shows nothing. `robots.txt` + `noindex` keep it out of search.
- Sites are grouped by GA4 `hostName`. A host that reports into two properties (games) is counted
  once, from the property with the most page views for it.

## One-time setup

1. Google Cloud (the project the GA4/Firebase properties live in, or any project):
   enable **Google Analytics Data API** and **Google Analytics Admin API**.
2. OAuth consent screen: External, keep in **Testing**, add your Gmail as a **test user**.
3. Credentials → OAuth client ID → Web application. Authorized JavaScript origins:
   `https://admin.codelove.in`, `http://localhost:5500`. (Missing origin = Google shows
   "Error 400: origin_mismatch" when you press Sign in on the Google Analytics page.)
4. Put the client ID in `site/config.js` (`clientId`) and push.
5. DNS: `CNAME admin → gowtham-raj-dev.github.io`. GitHub repo → Settings → Pages → Source: GitHub Actions, custom domain `admin.codelove.in`, Enforce HTTPS.

## Run locally

```
npx serve site -l 5500
```

Open http://localhost:5500.
