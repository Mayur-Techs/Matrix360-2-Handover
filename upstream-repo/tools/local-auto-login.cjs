'use strict';
// Loaded only by the loopback preview server.
const gateway = require('../workstreams/avinash/frontend/api/gateway');
const loginRoute = '/__matrix360-local-login';
let pending;
const enabled = () => process.env.M360_LOCAL_AUTO_LOGIN_ENABLED === 'true';
async function authenticate() {
  if (pending) return pending;
  pending = (async () => {
    const username = process.env.M360_LOCAL_AUTO_LOGIN_USERNAME;
    const password = process.env.M360_LOCAL_AUTO_LOGIN_PASSWORD;
    if (!username || !password) throw Error('LOCAL_CREDENTIALS_REQUIRED');
    const headers = {};
    let output = '';
    const response = {statusCode: 200, setHeader(name, value) { headers[name.toLowerCase()] = value; }, end(value) { output = String(value); }};
    await gateway({method: 'POST', query: {kind: 'crm', path: 'auth/login'}, headers: {'content-type': 'application/json'}, body: {username, password}}, response);
    if ([502,503,504].includes(response.statusCode)) {
      response.statusCode=200;output='';
      await gateway({method:'POST',query:{kind:'crm',path:'auth/login'},headers:{'content-type':'application/json'},body:{username,password}},response);
    }
    const data = JSON.parse(output);
    if (response.statusCode !== 200) throw Error('LOCAL_LOGIN_HTTP_' + response.statusCode);
    if (typeof data.access_token !== 'string' || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 30) throw Error('LOCAL_LOGIN_INVALID_SESSION');
    return {
      token: data.access_token,
      lifetime: Math.min(3300, Number(data.expires_in)),
      cookies: headers['set-cookie']
    };
  })();
  try { return await pending; } finally { pending = null; }
}
async function prepare(req, res, pathname) {
  if (!enabled() || (pathname !== '/login.html' && pathname !== loginRoute)) return false;
  const host = '127.0.0.1:' + (process.env.PORT || '8000');
  const site = req.headers['sec-fetch-site'];
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const isLocalSubmit = req.method === 'POST' && req.headers.origin === 'http://' + host && site === 'same-origin';
  if (!isLoopback || req.headers.host !== host ||
      (pathname === loginRoute ? !isLocalSubmit : site && !['none', 'same-origin'].includes(site))) {
    res.statusCode = 403; res.end('Local workspace access denied.'); return true;
  }
  if (pathname === '/login.html') {
    if (req.method !== 'GET') return false;
    const end = res.end.bind(res);
    res.end = (chunk, ...args) => {
      const source = String(chunk || '');
      const normalRequest = "fetch(API_BASE+'/auth/login',";
      if (res.statusCode === 200 && source.includes(normalRequest)) {
        // Keep the existing submit handler, including its CRM membership check.
        chunk = source
          .replace(/<label for="(username|password)">[^<]*<\/label><input\b[^>]*>/g, '<input type="hidden" id="$1">')
          .replace('<head>', '<head><style>#signin .m360-password-field{display:none}</style>')
          .replace(normalRequest, "fetch('" + loginRoute + "',")
          .replace("throw Error('The sign-in service is temporarily unavailable. Please try again.');",
            "throw Error(data.message || 'The sign-in service is temporarily unavailable. Please try again.');")
          .replace("throw Error('Unable to sign in. Check your credentials or contact Matrix 360.');",
            "throw Error(data.message || 'Unable to connect to the configured CRM account.');");
        res.removeHeader('Content-Length');
      }
      return end(chunk, ...args);
    };
    return false;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const current = await authenticate();
    if (current.cookies) res.setHeader('Set-Cookie', current.cookies);
    res.end(JSON.stringify({access_token: current.token, expires_in: current.lifetime}));
  } catch (error) {
    console.warn('Local auto-login:', /^LOCAL_[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_LOGIN_FAILED');
    res.statusCode = 503;
    const message = error.message === 'LOCAL_CREDENTIALS_REQUIRED'
      ? 'Configure the authorized account in the private frontend .env.local file and restart the preview.'
      : 'Unable to connect to the configured CRM account. Check account access and try again.';
    res.end(JSON.stringify({message}));
  }
  return true;
}
module.exports = {enabled, prepare};
