// Identity comes from a server-verified Google OAuth sign-in (see doGet in Code.gs),
// never from Session.getActiveUser() — that only works reliably when the deployment
// is domain-restricted, which blocks non-CISO-Series accounts (like an outside
// collaborator's Gmail) before the script even runs. Every server function receives
// the verified email as an explicit argument and re-checks it against ALLOWED_EMAILS
// itself — nothing is trusted from the client beyond what doGet already verified
// when it rendered the page with that email baked in.

function getAllowedEmails_() {
  var raw = PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '';
  return raw.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

function isUserAllowed_(email) {
  if (!email) return false;
  return getAllowedEmails_().indexOf(String(email).toLowerCase()) !== -1;
}

function assertAllowed_(email) {
  if (!isUserAllowed_(email)) {
    throw new Error('Access denied for ' + (email || 'unknown user') + '. Ask Josh to add this email to ALLOWED_EMAILS.');
  }
  return email;
}

// ── Google sign-in (OAuth 2.0 authorization code flow) ─────────────────────

// ScriptApp.getService().getUrl() is execution-context-dependent (it returns the
// /dev test URL when called from the editor, and has been inconsistent for
// domain-installed deployments even at request time) — too unreliable to build
// an OAuth redirect_uri from. OAUTH_REDIRECT_URI is instead a Script Property set
// by hand to the exact string registered with Google, so the two can never drift.
function getOAuthRedirectUri_() {
  var uri = PropertiesService.getScriptProperties().getProperty('OAUTH_REDIRECT_URI');
  if (!uri) throw new Error('OAUTH_REDIRECT_URI not set in Script Properties, tell Josh.');
  return uri;
}

function buildGoogleAuthUrl_() {
  var clientId = PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID');
  if (!clientId) throw new Error('OAUTH_CLIENT_ID not set in Script Properties, tell Josh.');
  var params = {
    client_id: clientId,
    redirect_uri: getOAuthRedirectUri_(),
    response_type: 'code',
    scope: 'openid email',
    access_type: 'online',
    prompt: 'select_account',
  };
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
}

// Exchanges a one-time auth code for a Google-verified email address. Throws on
// any failure (bad code, audience mismatch, unverified email) — callers must not
// treat a thrown error as "signed in."
function exchangeCodeForEmail_(code) {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('OAUTH_CLIENT_ID');
  var clientSecret = props.getProperty('OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET not set in Script Properties, tell Josh.');

  var tokenResp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getOAuthRedirectUri_(),
      grant_type: 'authorization_code',
    },
  });
  var tokenBody = JSON.parse(tokenResp.getContentText());
  if (!tokenBody.id_token) {
    throw new Error('Google sign-in failed: ' + (tokenBody.error_description || tokenBody.error || 'no token returned'));
  }

  // Verify with Google's own endpoint rather than checking the JWT signature
  // ourselves — confirms the token is genuine, unexpired, and really ours.
  var verifyResp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokenBody.id_token),
    { muteHttpExceptions: true }
  );
  var claims = JSON.parse(verifyResp.getContentText());
  if (claims.aud !== clientId) throw new Error('Google sign-in failed: token audience mismatch.');
  if (claims.email_verified !== 'true' && claims.email_verified !== true) {
    throw new Error('Google sign-in failed: email not verified by Google.');
  }
  return claims.email;
}
