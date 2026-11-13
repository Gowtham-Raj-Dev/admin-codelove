# CodeLove Admin — admin.codelove.in

Private analytics dashboard for every CodeLove site: users, sessions, views, time spent,
per-site and per-page, plus a live (last 30 min) view.

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
   `https://admin.codelove.in`, `http://localhost:5500`.
4. Put the client ID in `site/config.js` (`clientId`) and push.
5. DNS: `CNAME admin → gowtham-raj-dev.github.io`. GitHub repo → Settings → Pages → Source: GitHub Actions, custom domain `admin.codelove.in`, Enforce HTTPS.

## Run locally

```
npx serve site -l 5500
```

Open http://localhost:5500.
