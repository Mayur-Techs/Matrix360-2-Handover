'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const localLoginRoute = '/__matrix360-local-login';
const origin = 'http://127.0.0.1:8050';
const request = (site = 'same-origin') => ({
  method: 'POST', socket: {remoteAddress: '127.0.0.1'},
  headers: {host: '127.0.0.1:8050', origin, 'sec-fetch-site': site}
});
test('local auto-login uses real authentication, keeps credentials server-side and denies cross-site access', async () => {
  const names = ['M360_LOCAL_AUTO_LOGIN_ENABLED','M360_LOCAL_AUTO_LOGIN_USERNAME','M360_LOCAL_AUTO_LOGIN_PASSWORD','M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY','PORT'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const oldFetch = global.fetch;
  Object.assign(process.env, {M360_LOCAL_AUTO_LOGIN_ENABLED:'true',M360_LOCAL_AUTO_LOGIN_USERNAME:'test@example.com',M360_LOCAL_AUTO_LOGIN_PASSWORD:'synthetic-private-password',M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY:'synthetic-gateway-secret-at-least-32-characters',PORT:'8050'});
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++; assert.match(url, /\/auth\/login$/);
    assert.equal(JSON.parse(options.body).username, 'test@example.com');
    assert.equal(JSON.parse(options.body).password, 'synthetic-private-password');
    if(calls===1)return {status:503,headers:new Headers(),arrayBuffer:async()=>Buffer.from('{"message":"Temporarily unavailable"}')};
    return {status:200, headers:new Headers(), arrayBuffer:async () => Buffer.from(JSON.stringify({access_token:'synthetic-real-session-long-enough',expires_in:3600}))};
  };
  const response = () => ({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},removeHeader(k){delete this.headers[k];},end(value){this.output=String(value||'');}});
  try {
    const login = require('../../../../tools/local-auto-login.cjs');
    for (const invalid of [
      request('cross-site'),
      {...request(), method: 'GET'},
      {...request(), headers: {...request().headers, origin: 'https://other.example'}},
      {...request(), socket: {remoteAddress: '192.0.2.1'}}
    ]) {
      const denied = response();
      assert.equal(await login.prepare(invalid, denied, localLoginRoute), true);
      assert.equal(denied.statusCode, 403);
    }
    const dashboard = response();
    assert.equal(await login.prepare({...request('none'), method: 'GET'}, dashboard, '/client-dashboard.html'), false);
    assert.equal(dashboard.headers['Set-Cookie'], undefined);
    const page = response();
    assert.equal(await login.prepare({...request('none'), method: 'GET'}, page, '/login.html'), false);
    page.end(fs.readFileSync(path.join(__dirname, '../frontend-source/login.html'), 'utf8'));
    assert.match(page.output, /<input type="hidden" id="username">/);
    assert.match(page.output, /<input type="hidden" id="password">/);
    assert.match(page.output, /fetch\('\/__matrix360-local-login'/);
    assert.match(page.output, /\/me\/workspaces/);
    assert.doesNotMatch(page.output, /synthetic-private-password|synthetic-real-session/);
    assert.equal(calls, 0);
    const submitted = response();
    assert.equal(await login.prepare(request(), submitted, localLoginRoute), true);
    assert.equal(submitted.statusCode, 200);
    assert.deepEqual(JSON.parse(submitted.output), {access_token: 'synthetic-real-session-long-enough', expires_in: 3300});
    assert.ok(submitted.headers['Set-Cookie']);
    assert.equal(calls, 2);
  } finally {
    global.fetch=oldFetch;
    for(const name of names)if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];
  }
});

test('local auto-login cannot fabricate a session after a rejected CRM login', async () => {
  const names=['M360_LOCAL_AUTO_LOGIN_ENABLED','M360_LOCAL_AUTO_LOGIN_USERNAME','M360_LOCAL_AUTO_LOGIN_PASSWORD','M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY','PORT'];
  const before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const oldFetch=global.fetch;
  Object.assign(process.env,{M360_LOCAL_AUTO_LOGIN_ENABLED:'true',M360_LOCAL_AUTO_LOGIN_USERNAME:'test@example.com',M360_LOCAL_AUTO_LOGIN_PASSWORD:'synthetic-password',M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY:'synthetic-gateway-secret-at-least-32-characters',PORT:'8050'});
  global.fetch=async()=>({status:401,headers:new Headers(),arrayBuffer:async()=>Buffer.from('{"detail":"Invalid credentials"}')});
  delete require.cache[require.resolve('../../../../tools/local-auto-login.cjs')];
  try {
    const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.output=String(value);}};
    assert.equal(await require('../../../../tools/local-auto-login.cjs').prepare(request(),res,localLoginRoute),true);
    assert.equal(res.statusCode,503);
    assert.equal(res.headers['Set-Cookie'],undefined);
    assert.doesNotMatch(res.output,/synthetic-password|sessionStorage|test@example.com/);
  } finally {
    global.fetch=oldFetch;
    for(const name of names)if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];
  }
});
