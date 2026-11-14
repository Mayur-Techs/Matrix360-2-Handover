'use strict';
// Real local Chrome, isolated HTTP fixtures; this does not verify LinkedIn authorization or publishing.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const server=require('./linkedin-ui-fixture.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function runBrowserPass() {
  const executable=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if(!fs.existsSync(executable))throw Error('Set CHROME_PATH to a local Chromium executable.');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'matrix360-linkedin-ui-'));
  let browser,socket;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=spawn(executable,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{windowsHide:true,stdio:'ignore'});
    const portFile=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<100&&!fs.existsSync(portFile);i++)await delay(100);
    const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
    const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let sequence=0;const pending=new Map(),errors=[];
    socket.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);}else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
    await call('Runtime.enable');await call('Page.enable');
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
    for(let i=0;i<100;i++){if(await evaluate('Boolean(window.Matrix360LinkedIn)'))break;await delay(50);}

    // Campaign flow handoff: carries draft text through to workspace
    await evaluate("window.Matrix360LinkedIn.open({text:'Handoff text from channel_draft_versions.LinkedIn',objective:'Prepare fixture post',correlation_id:'fixture-correlation'})");
    await delay(100);
    assert.equal(await evaluate("document.getElementById('m360-li-text').value"),'Handoff text from channel_draft_versions.LinkedIn');
    assert.equal(await evaluate("document.getElementById('m360-li-composer').hidden"),false);

    await evaluate(`document.getElementById('m360-li-title').value='Browser fixture';`);
    await delay(100);
    await evaluate(`document.querySelector('[data-li-action="prepare"]').click();`);
    await delay(100);
    assert.match(await evaluate("document.getElementById('m360-li-text').value"),/Fixture generated draft/,await evaluate("document.getElementById('m360-li-message').textContent"));
    await evaluate(`document.querySelector('[data-li-destination]').checked=true;const media=document.querySelector('[data-li-asset]');media.checked=true;media.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('m360-li-rights').checked=true;document.querySelector('[data-li-action="preview"]').click();`);
    assert.equal(await evaluate("document.getElementById('m360-li-preview').querySelectorAll('script').length"),0);
    await delay(50);await evaluate(`document.querySelector('[data-li-action="preview-media"]').click()`);await delay(150);
    assert.equal(await evaluate("document.querySelector('#m360-li-media-preview img')?.naturalWidth"),1);
    await evaluate(`document.querySelector('[data-li-action="save"]').click()`);await delay(150);
    assert.match(await evaluate("document.getElementById('m360-li-editing').textContent"),/Saved version 1/);
    assert.equal(await evaluate("fetch('/api/linkedin?op=campaigns&workspace_id=fixture-a').then(r=>r.json()).then(r=>r.campaigns[0].handover_id)"),'fixture-handover');
    await evaluate(`document.querySelector('[data-li-action="approve"]').click()`);await delay(150);
    assert.match(await evaluate("document.getElementById('m360-li-editing').textContent"),/Approved/);
    await evaluate(`document.querySelector('[data-li-action="schedule"]').click()`);await delay(150);
    assert.match(await evaluate("document.getElementById('m360-li-job-list').textContent"),/queued/);
    await evaluate(`document.querySelector('[data-li-action="cancel"]').click()`);await delay(150);
    assert.match(await evaluate("document.getElementById('m360-li-job-list').textContent"),/cancelled/);
    await evaluate(`document.getElementById('m360-li-attribution-campaign').selectedIndex=1;document.getElementById('m360-li-attribution-lead').value='fixture-existing-lead';document.getElementById('m360-li-attribution-url').value='https://example.test/enquiry';document.querySelector('[data-li-action="attribute"]').click();`);await delay(150);
    assert.match(await evaluate("document.getElementById('m360-li-attributions').textContent"),/fixture-existing-lead/);
    assert.match(await evaluate("document.getElementById('m360-li-attributions').textContent"),/Recorded by your team/);
    for(const width of [375,768,1440]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true,'Overflow at '+width);
    }

    // Guardrails ON vs OFF (team-test skips approval control)
    await evaluate(`document.getElementById('workspace').value='fixture-b';document.getElementById('workspace').dispatchEvent(new Event('change'));`);await delay(150);
    assert.equal(await evaluate("document.getElementById('m360-li-text').value"),'');
    assert.match(await evaluate("document.getElementById('m360-li-campaign-list').textContent"),/No saved campaigns/);
    assert.doesNotMatch(await evaluate("document.getElementById('m360-li-attributions').textContent"),/fixture-existing-lead/);
    assert.equal(await evaluate("document.querySelector('[data-li-action=approve]').hidden"),true, 'Guardrails OFF must skip approval control');
    assert.equal(await evaluate("document.getElementById('m360-li-rights').closest('label').hidden"),true);

    // Stage 1 & Stage 2 verification: Back button, unconfigured state, honest worker state
    const backBtnExists = await evaluate("Boolean(document.getElementById('m360-li-back-btn'))");
    assert.equal(backBtnExists, true, 'Back to dashboard button must exist');

    // Switch to unconfigured workspace (no keys configured)
    await evaluate("document.getElementById('workspace').value='unconfigured';document.getElementById('workspace').dispatchEvent(new Event('change'));");await delay(150);
    const bannerDisplay = await evaluate("document.getElementById('m360-li-banner')?.style.display");
    assert.equal(bannerDisplay, 'block');
    const bannerText = await evaluate("document.getElementById('m360-li-banner')?.textContent");
    assert.match(bannerText, /Setup incomplete on server/);
    assert.match(bannerText, /LINKEDIN_CLIENT_ID/);
    assert.match(bannerText, /LINKEDIN_TOKEN_ENCRYPTION_KEY/);
    const connectBtnText = await evaluate("document.querySelector('[data-li-action=connect]')?.textContent");
    assert.equal(connectBtnText, 'Setup not finished');
    const connectBtnDisabled = await evaluate("document.querySelector('[data-li-action=connect]')?.disabled");
    assert.equal(connectBtnDisabled, true);
    const workerOfflineText = await evaluate("document.getElementById('m360-li-worker-status')?.textContent");
    assert.match(workerOfflineText, /worker offline/i);
    const aiPrepareDisabled = await evaluate("document.querySelector('[data-li-action=prepare]')?.disabled");
    assert.equal(aiPrepareDisabled, true);
    const aiStatusText = await evaluate("document.getElementById('m360-li-ai-status')?.textContent");
    assert.match(aiStatusText, /AI drafting needs configuration/);
    const noAccountsText = await evaluate("document.getElementById('m360-li-connections')?.textContent");
    assert.match(noAccountsText, /No LinkedIn account connected/);

    // Switch to stale worker workspace
    await evaluate("document.getElementById('workspace').value='stale-worker';document.getElementById('workspace').dispatchEvent(new Event('change'));");await delay(150);
    const staleWorkerText = await evaluate("document.getElementById('m360-li-worker-status')?.textContent");
    assert.match(staleWorkerText, /offline \(last heartbeat:/i);

    assert.deepEqual(errors,[]);
    console.log('PASS: isolated Chrome fixture: AI draft, escaped preview, actual image Blob preview, save, approve, queue, cancel, workspace reset and optional guardrails off; 375/768/1440px no horizontal overflow; no runtime exceptions.');
  }finally{
    try { socket?.close(); } catch {}
    if (browser?.pid) {
      try {
        if (process.platform === 'win32') {
          require('node:child_process').execSync(`taskkill /pid ${browser.pid} /T /F`, { stdio: 'ignore' });
        } else {
          browser.kill('SIGKILL');
        }
      } catch {}
    }
    try { server.closeAllConnections?.(); } catch {}
    try { server.close(); } catch {}
    try { server.unref?.(); } catch {}
    await delay(200);
    if(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep)) {
      try { fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100}); } catch {}
    }
  }
}

module.exports = runBrowserPass;

if(require.main===module) {
  runBrowserPass().catch(error=>{console.error(error.message);process.exitCode=1;});
}
