// Public config (none of these are secrets; access is enforced by Google sign-in + database rules).
window.ADMIN_CONFIG = {
  // Only this Google account may read CodeLove Analytics (also enforced in database.rules.json).
  ownerEmail: 'gowthamraje1221@gmail.com',

  // CodeLove Analytics (own tracker) — Firebase project "codelove-analytics".
  firebase: {
    apiKey: 'AIzaSyDxvgBOnJBPpUNgoYk_8Dpk85ahxMrqv5I',
    authDomain: 'codelove-analytics.firebaseapp.com',
    databaseURL: 'https://codelove-analytics-default-rtdb.firebaseio.com',
    projectId: 'codelove-analytics',
    appId: '1:698568650935:web:aa0e80d4e9a60d96765d32',
  },

  // Google Analytics 4 — OAuth 2.0 Web client ID (Google Cloud Console -> Credentials).
  clientId: '781001965138-9crgq57sfveht5kdt5frcieu4ear77l9.apps.googleusercontent.com',
  // Hostnames ending with any of these count as "my sites" in the GA view.
  siteSuffixes: ['codelove.in'],
};
