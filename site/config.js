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

  // Google Analytics 4 — OAuth 2.0 Web client ID (Google Cloud Console -> Credentials).
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
  ],
};
