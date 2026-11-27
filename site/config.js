// Public config (none of these are secrets; access is enforced by Google sign-in + database rules).
window.ADMIN_CONFIG = {
  // Only this Google account may read CodeLove Analytics (also enforced in firestore.rules).
  ownerEmail: 'gowthamraje1221@gmail.com',

  // First day t.js was live on the sites. Days before this are "no data", not zero visitors.
  trackingSince: '2026-11-13',

  // CodeLove Analytics (own tracker) — Firebase project "codelove-analytics", Cloud Firestore.
  firebase: {
    apiKey: 'AIzaSyDxvgBOnJBPpUNgoYk_8Dpk85ahxMrqv5I',
    authDomain: 'codelove-analytics.firebaseapp.com',
    projectId: 'codelove-analytics',
    appId: '1:698568650935:web:aa0e80d4e9a60d96765d32',
  },

  // Google Analytics 4 + Search Console — OAuth 2.0 Web client ID (Google Cloud Console -> Credentials).
  // Its Cloud project needs the GA Data/Admin APIs and the "Google Search Console API" enabled.
  clientId: '781001965138-9crgq57sfveht5kdt5frcieu4ear77l9.apps.googleusercontent.com',
  // Hostnames ending with any of these count as "my sites" in the GA view.
  siteSuffixes: ['codelove.in'],

  // Every site with the tracker. CodeLove Analytics shows a card for each one, even with 0 visitors.
  // Any other *.codelove.in host that sends data shows up too.
  sites: [
    'codelove.in',
    'models.codelove.in',
    'games.codelove.in',
    'downloader.codelove.in',
    'linkinbio.codelove.in',
    'videotogif.codelove.in',
    'videotoimages.codelove.in',
    'utubeflow.codelove.in',
    'javaplay.codelove.in',
    'videocut.codelove.in',
    'videomaker.codelove.in',
    'apps.codelove.in',
    'gowtham.codelove.in',
    'webly.codelove.in',
    'satisfying-video-maker.codelove.in',
    'voltarc.codelove.in',
    'iloveconvert.codelove.in',
  ],

  // Sites that run without AdSense on purpose. The AdSense "Sites & approval" table shows "Off" (grey) for them
  // instead of a red "Missing", and the reason as a tooltip.
  adsenseOff: {
    'downloader.codelove.in': 'AdSense is off on purpose: a downloader breaks the AdSense copyright policy and could put the whole account at risk.',
  },

  // Site health notes, for checks the page HTML can't show. ['ok', why] = installed but loaded by JavaScript
  // (green), ['skip', why] = not needed on this site (grey "Not needed"). A tag found in the HTML always wins.
  // Checked against each repo on 2026-11-20; update if a site changes how it loads a tag.
  healthNotes: {
    'games.codelove.in': { ga: ['ok', 'via Firebase Analytics (G-65L0LB1CJT + games property G-MEHYR05XXV), added by JavaScript'] },
    'models.codelove.in': { ga: ['ok', 'via Firebase Analytics (G-65L0LB1CJT), added by JavaScript'] },
    'linkinbio.codelove.in': { ga: ['ok', 'via Firebase Analytics (measurement ID from the deploy secret), added by JavaScript'] },
    'videomaker.codelove.in': { ga: ['ok', 'via Google Tag (gtag.js) & Firebase Analytics (G-E7XZ96YCVC)'] },
    'apps.codelove.in': { ga: ['skip', 'CodeLove Analytics covers this site; the Android apps use AdMob/Firebase instead'] },
    'gowtham.codelove.in': { ga: ['skip', 'personal portfolio; CodeLove Analytics covers it'] },
    'webly.codelove.in': { ga: ['skip', 'CodeLove Analytics & Webly Analytics cover this site'] },
    'satisfying-video-maker.codelove.in': { ga: ['ok', 'via Google Tag (gtag.js) G-E7XZ96YCVC'] },
    'voltarc.codelove.in': { ga: ['skip', 'CodeLove Analytics covers this site'], adsense: ['skip', 'monetized via Playgama partner games'] },
  },

  // Friendly names shown in the site picker (falls back to the subdomain).
  siteNames: {
    'codelove.in': 'CodeLove',
    'models.codelove.in': '3D Models',
    'games.codelove.in': '3D Games',
    'downloader.codelove.in': 'Insta Downloader',
    'linkinbio.codelove.in': 'Link in Bio',
    'videotogif.codelove.in': 'Video to GIF',
    'videotoimages.codelove.in': 'Video to Images',
    'utubeflow.codelove.in': 'UTubeFlow',
    'javaplay.codelove.in': 'JavaPlay',
    'videocut.codelove.in': 'Video Cut',
    'videomaker.codelove.in': 'Video Maker',
    'apps.codelove.in': 'Apps',
    'gowtham.codelove.in': 'Portfolio',
    'webly.codelove.in': 'Webly',
    'satisfying-video-maker.codelove.in': 'Satisfying Video Maker',
    'voltarc.codelove.in': 'VOLTARC (Cloud Arcade)',
    'iloveconvert.codelove.in': 'ILoveConvert',
  },

  // Reports → "Copy for AI": where each site's source code lives (folder under repoRoot).
  repoRoot: 'D:\\Gowtham\\My-Live-Websites',
  repoFolders: {
    'codelove.in': 'codelove-parent-domain',
    'models.codelove.in': 'three-d-models',
    'games.codelove.in': 'games.codelove.in',
    'downloader.codelove.in': 'downloader',
    'linkinbio.codelove.in': 'link-in-bio',
    'videotogif.codelove.in': 'video-to-gif',
    'videotoimages.codelove.in': 'video-to-images',
    'utubeflow.codelove.in': 'youtube-for-all',
    'javaplay.codelove.in': 'java-game-emu',
    'videocut.codelove.in': 'video-cut',
    'videomaker.codelove.in': 'video-maker',
    'apps.codelove.in': 'apps-codelove',
    'gowtham.codelove.in': 'gowtham-portfolio',
    'webly.codelove.in': 'webly-codelove',
    'satisfying-video-maker.codelove.in': 'satisfying-video-maker',
    'voltarc.codelove.in': 'playgama.codelove',
    'iloveconvert.codelove.in': 'i-love-convert',
  },

  // Google Search → "Not showing": searches each site should show up for. Edit freely.
  // A target counts as showing when a Google search containing it (any case) got an impression
  // for that site in Search Console. Seeded from each site's own SEO keywords (layout/seo files).
  searchKeywords: {
    'codelove.in': ['codelove', 'code love', 'code with love', 'codelove tools', 'free online tools', 'free video tools', 'web development tutorials', 'gowtham codelove'],
    'models.codelove.in': ['free 3d models', 'free 3d models download', 'free glb models', 'free gltf models', 'free 3d characters', 'rigged 3d characters', 'sketchfab alternative', 'three.js models', 'free car 3d models', 'codelove 3d models'],
    'games.codelove.in': ['free 3d games', 'free 3d games online', '3d games free no download', 'free online games no download', 'browser games', 'three.js games', 'codelove games'],
    'downloader.codelove.in': ['insta downloader', 'instagram downloader', 'instagram reels downloader', 'download instagram video', 'reels downloader', 'pinterest downloader', 'pinterest video downloader', 'multi url video downloader', 'codelove downloader'],
    'linkinbio.codelove.in': ['link in bio', 'free link in bio', 'link in bio for instagram', 'bio link maker', 'linktree alternative', 'free linktree alternative', 'whatsapp link in bio', 'codelove link in bio'],
    'videotogif.codelove.in': ['video to gif', 'video to gif converter free', 'mp4 to gif', 'gif maker free', 'compress gif online free', 'video compressor online', 'compress video for whatsapp', 'gif to mp4'],
    'videotoimages.codelove.in': ['video to frames', 'video to frame converter', 'extract frames from video', 'video frame extractor', 'video compressor online free', 'reduce video size online', 'compress mp4', 'compress video for whatsapp'],
    'utubeflow.codelove.in': ['free youtube automation', 'youtube automation free', 'free youtube automation tool', 'youtube scheduler free', 'schedule youtube videos free', 'youtube shorts scheduler', 'bulk upload youtube videos', 'youtube auto upload', 'utubeflow'],
    'javaplay.codelove.in': ['j2me emulator', 'java games online', 'play java games online', 'free java games', 'java game emulator', 'jar game player', 'old nokia games', 'javaplay'],
    'videocut.codelove.in': ['video cut', 'video shorts cutter', 'free video cutter', 'youtube shorts cutter', 'split video into parts', 'cut video into 30 second clips', 'video splitter online free', 'landscape to shorts converter', 'cut long video into shorts'],
    'videomaker.codelove.in': ['free video maker', 'ai video maker', 'free ai video maker', 'text to video ai free', 'cartoon video maker', 'talking cartoon maker', 'youtube shorts maker', 'tamil cartoon video maker', 'codelove video maker'],
    'apps.codelove.in': ['codelove apps', 'free android games', 'video cutter app', 'video to gif app', 'instagram downloader app', 'java game emulator apk'],
    'gowtham.codelove.in': ['gowtham', 'gowthamraj', 'gowtham codelove', 'creative web developer', '3d portfolio', 'three.js portfolio'],
    'webly.codelove.in': ['webly', 'website analytics', 'seo audit', 'website problem fixer', 'google analytics viewer', 'google search console dashboard', 'site health checker'],
    'satisfying-video-maker.codelove.in': ['satisfying video maker', 'asmr video generator', 'bouncing ball simulation', 'marble race generator', 'ring escape simulator', 'hydraulic press simulation', 'kinetic sand simulator', 'physics simulation games', 'codelove satisfying maker'],
    'voltarc.codelove.in': ['voltarc', 'free browser games', 'instant play games online', 'free html5 games', '3d webgl browser games', 'play online games no download', 'mobile browser games', 'codelove arcade'],
    'iloveconvert.codelove.in': ['iloveconvert', 'free online converter', 'image converter free', 'pdf tools online', 'json formatter', 'base64 encoder', 'qr code generator', 'codelove tools'],
  },

  // Google Search → "Index status": pages are read from each site's sitemap.xml + pages Google showed in
  // search. Add paths here for pages that are in neither (e.g. 'linkinbio.codelove.in': ['/new-page']).
  indexPages: {},

  // IndexNow key (key file /<key>.txt is at every site's root). Used by "Ping IndexNow" (Bing, Yandex…; not Google).
  indexNowKey: '2c7c5ee4ac3ac04bee95a85d3a1eb7e2',
};
