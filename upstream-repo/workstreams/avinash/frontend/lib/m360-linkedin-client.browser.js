'use strict';
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeLink = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } };
  function scheduledInstant(value) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) throw Error('Choose a valid publication date and time.');
    const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    if (local !== value) throw Error('That local time does not exist. Choose another time.');
    return date.toISOString();
  }
  function proposalLocal(proposal) {
    if(!proposal||typeof proposal.scheduled_at!=='string'||!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(proposal.scheduled_at))throw Error('The proposed time needs an explicit timezone offset.');
    const date=new Date(proposal.scheduled_at);if(!Number.isFinite(date.valueOf()))throw Error('The proposed time is invalid.');
    if(proposal.time_zone)new Intl.DateTimeFormat('en',{timeZone:proposal.time_zone});
    return new Date(date.valueOf()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
  async function scheduleCampaignBatch(campaigns,enqueue) {
    const results=[];
    for(const campaign of campaigns){
      try{await enqueue({campaign_id:campaign.id,revision:campaign.revision});results.push({id:campaign.id,title:campaign.title,queued:true});}
      catch(error){results.push({id:campaign.id,title:campaign.title,queued:false,error:error.message||'Publication could not be queued.'});}
    }
    return results;
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { escape, safeLink, scheduledInstant, proposalLocal, scheduleCampaignBatch }; return; }
  if (window.Matrix360LinkedIn) return;
  const $ = id => document.getElementById('m360-li-' + id);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const workspace = () => document.getElementById('workspace')?.value || sessionStorage.getItem('matrix360_active_workspace') || '';
  const token = () => +sessionStorage.getItem('matrix360_pilot_expires_at') > Date.now() ? sessionStorage.getItem('matrix360_pilot_token') : null;
  const state = { workspace:'', status:{}, campaigns:[], jobs:[], assets:[], studio:[], contentRequests:[], attributions:[], current:null, handoverId:null, handoverPromise:null, draftEpoch:0, scheduleProposal:null, selectedAssets:[], busy:false, callback:false, mediaUrls:[], previewVersion:0 };
  const array = value => Array.isArray(value) ? value : [];
  const stamp = value => value ? new Date(value).toLocaleString(undefined, {timeZone:zone}) : 'Not scheduled';
  function announce(message, failed=false) { if ($('message')) { $('message').textContent=message; $('message').dataset.error=String(failed); } }
  async function api(op, body, expectedWorkspace=workspace()) {
    const bearer=token();
    if (!bearer || !expectedWorkspace) throw Error('Sign in and select a client workspace first.');
    const response=await fetch('/api/linkedin?'+new URLSearchParams({op,workspace_id:expectedWorkspace}), {
      method:body === undefined ? 'GET' : 'POST', cache:'no-store',
      headers:{Authorization:'Bearer '+bearer,...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify({...body,workspace_id:expectedWorkspace})})
    });
    const result=await response.json().catch(()=>({message:'LinkedIn service returned an invalid response.'}));
    if (expectedWorkspace!==workspace()) throw Error('The workspace changed. Reload LinkedIn for the selected client.');
    if (!response.ok || result.error) throw Error(result.message || (typeof result.error==='string'?result.error:'LinkedIn operation failed.'));
    return result;
  }
  function updateConfiguredControls() {
    const config=state.status?.configuration||{};
    const activeKey=sessionStorage.getItem('matrix360_user_openai_key')||'';
    const isAiReady=Boolean(config.ai_ready||activeKey);
    const connectBtn=$('panel')?.querySelector('[data-li-action="connect"]');
    if(connectBtn&&(!config.oauth_ready||!config.token_encryption_ready)){
      connectBtn.disabled=true;
      connectBtn.textContent='Setup not finished';
    }
    const prepareBtn=$('panel')?.querySelector('[data-li-action="prepare"]');
    if(prepareBtn&&!isAiReady)prepareBtn.disabled=true;
    const reviseBtn=$('panel')?.querySelector('[data-li-action="revise"]');
    if(reviseBtn&&!isAiReady)reviseBtn.disabled=true;
  }
  async function run(task) {
    if(state.busy)return;
    state.busy=true; $('panel')?.setAttribute('aria-busy','true');
    $('panel')?.querySelectorAll('[data-li-action]').forEach(button=>button.disabled=true);
    try{await task();}catch(error){announce(error.message,true);}
    finally{state.busy=false;$('panel')?.setAttribute('aria-busy','false');$('panel')?.querySelectorAll('[data-li-action]').forEach(button=>button.disabled=false);updateConfiguredControls();}
  }
  function mount() {
    const host=document.getElementById('marketing-centre');
    if(!host || $('panel'))return;
    const style=document.createElement('style');
    style.textContent=`#m360-li-panel{margin:18px 0;border:1px solid #aac4d6;border-radius:12px;background:var(--ws-panel,#fff);color:var(--ws-text,#172a39);padding:16px}#m360-li-panel summary{font-size:19px;font-weight:700;cursor:pointer}#m360-li-panel button,#m360-li-panel input,#m360-li-panel select,#m360-li-panel textarea{font:inherit}#m360-li-panel button{padding:8px 12px;border:1px solid #9eb8c7;border-radius:6px;cursor:pointer;background:var(--ws-soft,#f1f6fa);color:inherit}#m360-li-panel button:focus-visible,#m360-li-panel input:focus-visible,#m360-li-panel textarea:focus-visible{outline:3px solid #0077b5;outline-offset:2px}#m360-li-panel button:disabled{opacity:.55;cursor:wait}#m360-li-panel .li-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0}#m360-li-panel .li-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:16px}#m360-li-panel label{display:block;font-size:13px;margin:9px 0}#m360-li-panel input:not([type=checkbox]),#m360-li-panel select,#m360-li-panel textarea{width:100%;box-sizing:border-box;padding:9px;border:1px solid #a6bcc9;border-radius:5px;background:var(--ws-panel,#fff);color:inherit}#m360-li-panel textarea{min-height:110px;resize:vertical}#m360-li-panel fieldset{border:1px solid #c5d4dc;border-radius:7px;padding:12px;margin:12px 0}#m360-li-panel legend{font-weight:650}#m360-li-panel .li-card{padding:12px;border:1px solid #d0dde4;border-radius:7px;margin:10px 0;overflow-wrap:anywhere}#m360-li-panel .li-muted{font-size:12px;color:var(--ws-muted,#49616f)}#m360-li-message{min-height:1.5em;font-weight:600}#m360-li-message[data-error=true]{color:#a32626}#m360-li-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}#m360-li-panel [hidden]{display:none!important}#m360-li-panel .li-primary{background:#096b9e;color:white;border-color:#096b9e}#m360-li-panel img,#m360-li-panel video{max-width:100%;max-height:260px}#m360-li-panel table{width:100%;border-collapse:collapse;font-size:13px}#m360-li-panel td,#m360-li-panel th{padding:9px;text-align:left;border-bottom:1px solid #d5e0e6}#m360-li-panel .li-table{overflow-x:auto}`;
    document.head.appendChild(style);
    const panel=document.createElement('details');panel.id='m360-li-panel';
    panel.innerHTML=`<summary>LinkedIn Campaigns &amp; Publishing</summary>
      <div class="li-row" style="margin-bottom:8px"><button type="button" id="m360-li-back-btn" class="li-muted" style="cursor:pointer;border:none;background:transparent;padding:4px 0;font-size:13px;font-weight:600;color:#0a695e;">← Back to dashboard</button></div>
      <p>Connect a profile or company Page, prepare your content and manage publication from this workspace.</p>
      <div class="li-row"><button type="button" data-li-action="refresh">Refresh</button><button type="button" data-li-action="new">New campaign</button><span id="m360-li-workspace" class="li-muted"></span></div>
      <p id="m360-li-message" role="status" aria-live="polite"></p>
      <nav class="li-row" aria-label="LinkedIn sections"><button type="button" data-li-tab="accounts">Accounts</button><button type="button" data-li-tab="composer">Composer</button><button type="button" data-li-tab="campaigns">Campaigns &amp; calendar</button><button type="button" data-li-tab="results">Published &amp; performance</button></nav>
      <section id="m360-li-accounts"><h3>Connected accounts</h3><div id="m360-li-banner" style="display:none"></div><p id="m360-li-setup" class="li-muted"></p><button type="button" class="li-primary" data-li-action="connect">Connect LinkedIn</button><div id="m360-li-connections"></div><h4>Publishing destinations</h4><div id="m360-li-destination-list"></div></section>
      <section id="m360-li-composer" hidden><h3>Prepare a campaign</h3><p id="m360-li-editing" class="li-muted">New draft</p>
      <div id="m360-li-ai-connector" class="li-card" style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px;margin:10px 0;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <strong id="m360-li-ai-badge" style="color:#166534;">● AI Drafting Ready (Connected)</strong>
            <p id="m360-li-ai-subtext" class="li-muted" style="margin:2px 0 0 0;">Connected for company-grounded LinkedIn drafts and revisions.</p>
          </div>
          <button type="button" id="m360-li-ai-toggle-btn" data-li-action="toggle-ai-key" style="font-size:12px;padding:4px 8px;">Configure API Key</button>
        </div>
        <div id="m360-li-ai-key-drawer" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid #dcfce7;">
          <label style="font-size:12px;font-weight:600;margin-bottom:4px;display:block;">OpenAI API Key (sk-...)
            <input type="password" id="m360-li-ai-key-input" placeholder="sk-..." maxlength="256" autocomplete="off" style="font-family:monospace;margin-top:4px;">
          </label>
          <div class="li-row" style="margin:6px 0 0 0;">
            <button type="button" class="li-primary" data-li-action="save-ai-key">Connect &amp; Verify Key</button>
            <span id="m360-li-ai-key-status" class="li-muted" style="font-size:12px;"></span>
          </div>
        </div>
      </div>
      <div class="li-grid"><div><label>Campaign name<input id="m360-li-title" maxlength="160"></label><label>Business objective<textarea id="m360-li-objective" maxlength="4000" placeholder="Describe your offering, audience and the outcome you want."></textarea></label><label>Language<select id="m360-li-language"><option value="English">English</option><option value="Hindi">Hindi</option><option value="Bengali">Bengali</option></select></label><button type="button" data-li-action="prepare">Prepare with AI</button><div id="m360-li-concepts"></div><label>Post text<textarea id="m360-li-text" maxlength="3000" style="min-height:210px"></textarea></label><p id="m360-li-length" class="li-muted"></p><label>Revision request<input id="m360-li-revision-request" maxlength="1000" placeholder="For example: make the opening more concise"></label><button type="button" data-li-action="revise">Revise with AI</button><label>Link URL, optional<input id="m360-li-link" type="url" placeholder="https://"></label></div>
      <div><fieldset><legend>Publish as</legend><div id="m360-li-destination-options"></div></fieldset><fieldset><legend>Media</legend><p class="li-muted">Use a saved Content Studio creative or upload an image, MP4 video or PDF. Choose one asset per post.</p><label>Upload media<input id="m360-li-file" type="file" accept="image/jpeg,image/png,video/mp4,application/pdf"></label><button type="button" data-li-action="upload">Upload selected file</button><p id="m360-li-upload-progress" role="status"></p><label>Saved Content Studio version<select id="m360-li-studio"><option value="">Choose a saved creative</option></select></label><button type="button" data-li-action="attach">Use this creative</button><div id="m360-li-asset-options"></div><label><input type="checkbox" id="m360-li-rights"> I have permission to publish this media.</label></fieldset>
      <fieldset><legend>Publication time</legend><label>Date and time<input id="m360-li-date" type="datetime-local"></label><p class="li-muted">Timezone: <strong>${escape(zone)}</strong>. Leave blank to queue publication now.</p><p id="m360-li-guardrails" class="li-muted"></p></fieldset></div></div>
      <div class="li-row"><button type="button" data-li-action="preview">Preview</button><button type="button" class="li-primary" data-li-action="save">Save draft</button><button type="button" data-li-action="approve">Approve saved version</button><button type="button" data-li-action="schedule">Queue saved version</button></div><div id="m360-li-preview" class="li-card" hidden></div><details><summary>Saved version history</summary><div id="m360-li-versions"></div></details></section>
      <section id="m360-li-campaigns" hidden><h3>Campaigns &amp; calendar</h3><p class="li-muted">Times shown in ${escape(zone)}. Each publishing destination has its own result.</p><div class="li-row"><button type="button" data-li-action="batch-approve">Approve selected saved versions</button><button type="button" data-li-action="batch-schedule">Schedule selected</button></div><p id="m360-li-batch-result" role="status"></p><div id="m360-li-campaign-list"></div><div id="m360-li-calendar"></div></section>
      <section id="m360-li-results" hidden><h3>Publication results</h3><p class="li-muted">Publication, audience response and business enquiries are separate outcomes. Unavailable metrics are not reported as zero.</p><div id="m360-li-job-list"></div><div id="m360-li-performance" aria-live="polite"></div></section>`;
    host.insertBefore(panel,host.children[1]||null);
    $('upload-progress').insertAdjacentHTML('afterend','<details><summary>Create media with Content Studio</summary><label>Creative brief<textarea id="m360-li-content-prompt" maxlength="4000" placeholder="Describe the image or video using your approved brand facts."></textarea></label><p class="li-muted">Uses your configured Content Studio providers. Provider generation charges may apply.</p><div class="li-row"><button type="button" data-li-action="content-image">Generate image</button><button type="button" data-li-action="content-reel">Generate video</button></div><div id="m360-li-content-requests"></div></details>');
    $('date').closest('label').insertAdjacentHTML('afterend','<div id="m360-li-schedule-proposal" class="li-card" hidden></div>');
    $('performance').insertAdjacentHTML('afterend','<fieldset><legend>Record enquiry attribution</legend><p class="li-muted">Links an existing workspace CRM record; attribution is recorded by your team, separate from LinkedIn metrics.</p><label>Campaign<select id="m360-li-attribution-campaign"><option value="">Choose a saved campaign</option></select></label><label>Existing CRM lead ID<input id="m360-li-attribution-lead" maxlength="160" autocomplete="off"></label><label>Evidence URL, optional<input id="m360-li-attribution-url" type="url" maxlength="2048" placeholder="https://"></label><button type="button" data-li-action="attribute">Record enquiry attribution</button></fieldset><div id="m360-li-attributions"></div>');
    panel.addEventListener('click',event=>{const back=event.target.closest('#m360-li-back-btn');if(back){if(window.Matrix360Router?.navigateToPage)window.Matrix360Router.navigateToPage('dashboard');else{window.location.hash='#home';window.scrollTo({top:0,behavior:'smooth'});}return;}const tab=event.target.closest('[data-li-tab]');if(tab)showTab(tab.dataset.liTab);const button=event.target.closest('[data-li-action]');if(button)run(()=>action(button.dataset.liAction,button));});
    panel.addEventListener('toggle',()=>{if(panel.open)run(refresh);});
    panel.addEventListener('input',()=>{$('length').textContent=$('text').value.length+' / 3,000 characters';$('preview').hidden=true;releaseMedia();});
    panel.addEventListener('change',event=>{if(event.target.matches('[data-li-asset]'))state.selectedAssets=event.target.checked?[event.target.value]:[];});
    document.getElementById('workspace')?.addEventListener('change',resetWorkspace);
    document.addEventListener('m360:crm-loaded',()=>{if(state.workspace!==workspace())resetWorkspace();resumeCallback();});
    showTab('accounts');resumeCallback();
  }
  function showTab(name) {
    for(const key of ['accounts','composer','campaigns','results'])$(key).hidden=key!==name;
    $('panel').querySelectorAll('[data-li-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.liTab===name)));
  }
  function resetWorkspace() {
    releaseMedia();
    state.workspace=workspace();state.status={};state.campaigns=[];state.jobs=[];state.assets=[];state.studio=[];state.contentRequests=[];state.attributions=[];state.current=null;state.selectedAssets=[];
    for(const id of ['connections','destination-list','destination-options','asset-options','campaign-list','calendar','job-list','performance','versions','concepts','content-requests','attributions','batch-result'])$(id)?.replaceChildren();
    if($('content-prompt'))$('content-prompt').value='';
    for(const id of ['attribution-lead','attribution-url','attribution-campaign'])if($(id))$(id).value='';
    newDraft();if($('panel')?.open&&!state.busy)run(refresh);
  }
  async function refresh() {
    const current=workspace();
    const [status,saved,assets]=await Promise.all([api('status',undefined,current),api('campaigns',undefined,current),api('assets',undefined,current)]);
    state.workspace=current;state.status=status;state.campaigns=array(saved.campaigns);state.jobs=array(saved.jobs);state.assets=array(assets.assets||saved.assets);state.studio=array(assets.content_studio?.assets);state.contentRequests=array(saved.content_requests);state.attributions=array(saved.attributions);
    for(const request of state.contentRequests.filter(r=>!['completed','failed','cancelled'].includes(r.status)).slice(0,5)){
      try{const result=await api('content-status',{request_id:request.id},current);Object.assign(request,result.request||{});if(result.asset&&!state.assets.some(a=>a.id===result.asset.id))state.assets.push(result.asset);}catch(error){request.display_error=error.message;}
    }
    render();announce('LinkedIn workspace refreshed.');
  }
  function render() {
    const config=state.status.configuration||{}, guard=state.status.guardrails||{}, destinations=array(state.status.destinations);
    $('workspace').textContent='Workspace: '+state.workspace;
    const banner=$('banner'),connectBtn=$('panel').querySelector('[data-li-action="connect"]');
    const missingKeys=config.missing_keys||[];
    const setupIncomplete=!config.oauth_ready||!config.token_encryption_ready;
    if(setupIncomplete){
      const keys=missingKeys.length?missingKeys.join(', '):'LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI, LINKEDIN_TOKEN_ENCRYPTION_KEY';
      if(banner){
        banner.className='li-card';
        banner.style.cssText='display:block;background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:12px;margin:12px 0;border-radius:8px;';
        banner.innerHTML=`<strong>Setup incomplete on server:</strong> Missing <code>${escape(keys)}</code> in environment. LinkedIn OAuth and secure token storage cannot launch until these variables are configured.`;
      }
      if(connectBtn){
        connectBtn.disabled=true;
        connectBtn.textContent='Setup not finished';
        connectBtn.title='Missing required environment variables: '+keys;
      }
    }else{
      if(banner){banner.style.display='none';banner.innerHTML='';}
      if(connectBtn){connectBtn.disabled=false;connectBtn.textContent='Connect LinkedIn';connectBtn.title='';}
    }
    const workerText=config.worker_ready===true?'Publication worker is active and verified.':(config.worker_last_seen?'⚠️ Publication worker is offline (last heartbeat: '+stamp(config.worker_last_seen)+'). Scheduled publications will not dispatch until the worker is restarted.':'⚠️ Publication worker health has not been verified (worker offline).');
    $('setup').innerHTML=(config.oauth_ready?'LinkedIn authorization is configured. Each connection grants its own access.':'An administrator must configure the LinkedIn developer app before connecting.')+'<br><span id="m360-li-worker-status" class="li-muted" style="'+(config.worker_ready===true?'color:#0a695e':'color:#b91c1c')+'">'+escape(workerText)+'</span>';
    const activeKey=sessionStorage.getItem('matrix360_user_openai_key')||'';
    const isAiReady=Boolean(config.ai_ready||activeKey);
    const prepareBtn=$('panel').querySelector('[data-li-action="prepare"]'),reviseBtn=$('panel').querySelector('[data-li-action="revise"]');
    const aiBadge=$('ai-badge'),aiSubtext=$('ai-subtext'),aiBox=$('ai-connector'),aiDrawer=$('ai-key-drawer');
    if(isAiReady){
      if(aiBadge){aiBadge.style.color='#166534';aiBadge.textContent='● AI Drafting Ready (Connected)';}
      if(aiSubtext)aiSubtext.textContent='Grounded to company facts. Active for B2B drafting and revisions.';
      if(aiBox){aiBox.style.background='#f0fdf4';aiBox.style.borderColor='#bbf7d0';}
      if(prepareBtn){prepareBtn.disabled=false;prepareBtn.title='Prepare grounded post from business objective';}
      if(reviseBtn){reviseBtn.disabled=false;reviseBtn.title='Revise current post draft with instructions';}
      const aiStatusEl=document.getElementById('m360-li-ai-status');if(aiStatusEl)aiStatusEl.remove();
    }else{
      if(aiBadge){aiBadge.style.color='#b45309';aiBadge.textContent='⚠️ AI Key Required';}
      if(aiSubtext)aiSubtext.textContent='Connect your OpenAI API key below to enable "Prepare with AI" and "Revise with AI".';
      if(aiBox){aiBox.style.background='#fffbeb';aiBox.style.borderColor='#fde68a';}
      if(aiDrawer)aiDrawer.style.display='block';
      if(prepareBtn){prepareBtn.disabled=true;prepareBtn.title='Connect an OpenAI API key above to enable AI drafting';}
      if(reviseBtn){reviseBtn.disabled=true;reviseBtn.title='Connect an OpenAI API key above to enable AI revisions';}
      let aiStatusEl=document.getElementById('m360-li-ai-status');
      if(!aiStatusEl&&$('concepts'))$('concepts').insertAdjacentHTML('beforebegin','<p id="m360-li-ai-status" class="li-muted" style="color:#856404;font-size:12px;">AI drafting needs configuration. Enter your OpenAI API key above or set OPENAI_API_KEY in environment.</p>');
    }
    $('guardrails').textContent=guard.approval_required?'Approval of the saved version is required before it is queued.':'Authorized users can queue a saved version directly.';
    $('rights').closest('label').hidden=!guard.media_rights_required;
    $('panel').querySelector('[data-li-action="approve"]').hidden=!guard.approval_required;
    $('connections').innerHTML=array(state.status.connections).map(c=>`<article class="li-card"><strong>${escape(c.name||c.id)}</strong><p>${escape(c.status||'Connected')} · Expires ${escape(stamp(c.expires_at))}</p><p class="li-muted">Granted scopes: ${escape(array(c.scopes).join(', ')||'Not available')}</p><div class="li-row"><button type="button" data-li-action="destinations" data-id="${escape(c.id)}">Refresh destinations</button><button type="button" data-li-action="reconnect" data-id="${escape(c.id)}">Reconnect</button><button type="button" data-li-action="disconnect" data-id="${escape(c.id)}">Disconnect</button></div></article>`).join('')||'<p>No LinkedIn account connected for this workspace.</p>';
    $('destination-list').innerHTML=destinations.map(d=>`<div class="li-card"><strong>${escape(d.name||d.urn||d.id)}</strong><p class="li-muted">${escape(d.type||'')} · ${escape(d.urn||d.id)}</p><p class="li-muted">${escape(Object.entries(d.capabilities||{}).map(([key,value])=>key+': '+(value===true?'available':value===false?'unavailable':typeof value==='object'?(value.available?'available':value.reason||'unavailable'):String(value))).join(' · '))}</p></div>`).join('')||'<p>Connect an account to discover its publishing destinations.</p>';
    const selected=new Set([...$('destination-options').querySelectorAll('input:checked')].map(el=>el.value));
    $('destination-options').innerHTML=destinations.map(d=>`<label><input type="checkbox" data-li-destination value="${escape(d.id)}" ${selected.has(d.id)?'checked':''}> ${escape(d.name||d.urn||d.id)} <span class="li-muted">${escape(d.type||'')}</span></label>`).join('')||'<p class="li-muted">Connect LinkedIn first.</p>';
    $('asset-options').innerHTML=state.assets.map(a=>`<label><input type="radio" name="m360-li-asset" data-li-asset value="${escape(a.id)}" ${state.selectedAssets.includes(a.id)?'checked':''}> ${escape(a.filename||a.title||a.id)} <span class="li-muted">${escape(a.mime||a.kind||'')}</span></label>`).join('')+'<button type="button" data-li-action="clear-media">Remove media from draft</button>';
    $('studio').innerHTML='<option value="">Choose a saved creative</option>'+state.studio.map(a=>`<option value="${escape(a.id)}">${escape(a.metadata?.headline||a.id)} · ${escape(a.id)}</option>`).join('');
    $('content-requests').innerHTML=state.contentRequests.map(r=>`<article class="li-card"><strong>${escape(r.kind||'Creative')}</strong><p>${escape(r.status||'pending')}</p>${r.error||r.display_error?`<p>${escape(typeof r.error==='string'?r.error:r.display_error||r.error?.message||'Content creation failed.')}</p>`:''}${r.asset_id?`<button type="button" data-li-action="select-asset" data-id="${escape(r.asset_id)}">Use completed media</button>`:`<button type="button" data-li-action="content-status" data-id="${escape(r.id)}">Check progress</button>`}</article>`).join('');
    $('campaign-list').innerHTML=state.campaigns.map(c=>`<article class="li-card"><label><input type="checkbox" data-li-batch value="${escape(c.id)}"> <strong>${escape(c.title||'Untitled campaign')}</strong></label><p>Version ${escape(c.revision)} · ${escape(c.status||'draft')} · ${escape(stamp(c.scheduled_at))}</p><p class="li-muted">${escape(c.text?.slice(0,180)||'')}</p><button type="button" data-li-action="open" data-id="${escape(c.id)}">Open campaign</button></article>`).join('')||'<p>No saved campaigns yet.</p>';
    const jobs=[...state.jobs].sort((a,b)=>String(a.scheduled_for||'').localeCompare(String(b.scheduled_for||'')));
    $('calendar').innerHTML=jobs.length?`<h4>Publication calendar</h4><div class="li-table"><table><thead><tr><th>Date</th><th>Destination</th><th>Status</th></tr></thead><tbody>${jobs.map(j=>`<tr><td>${escape(stamp(j.scheduled_for))}</td><td>${escape(destinationName(j.destination_id||j.author))}</td><td>${escape(j.status)}</td></tr>`).join('')}</tbody></table></div>`:'';
    $('job-list').innerHTML=[...state.jobs].reverse().map(j=>`<article class="li-card"><strong>${escape(destinationName(j.destination_id||j.author))}</strong><p>${escape(j.status)} · ${escape(stamp(j.scheduled_for))}</p>${j.error?`<p>${escape(typeof j.error==='object'?j.error.message||JSON.stringify(j.error):j.error)}</p>`:''}${j.provider_post_id?`<p>Provider ID: ${escape(j.provider_post_id)}</p>`:''}${safeLink(j.provider_url)?`<a href="${escape(safeLink(j.provider_url))}" target="_blank" rel="noopener noreferrer">View LinkedIn post</a>`:''}<div class="li-row">${['queued','retry','processing'].includes(j.status)?`<button type="button" data-li-action="cancel" data-id="${escape(j.id)}">Cancel publication</button>`:''}${j.provider_post_id?`<button type="button" data-li-action="verify" data-id="${escape(j.id)}">Verify publication</button><button type="button" data-li-action="performance" data-id="${escape(j.id)}">Retrieve performance</button>`:''}</div></article>`).join('')||'<p>No publication jobs yet.</p>';
    const badge=document.getElementById('m360-linkedin-provider-status');if(badge)badge.textContent=array(state.status.connections).length+' connected account(s)';
    const attributedCampaign=$('attribution-campaign').value;
    $('attribution-campaign').innerHTML='<option value="">Choose a saved campaign</option>'+state.campaigns.map(c=>`<option value="${escape(c.id)}" ${c.id===attributedCampaign?'selected':''}>${escape(c.title||c.id)}</option>`).join('');
    $('attributions').innerHTML=state.attributions.length?'<h4>Team-recorded enquiry attribution</h4>'+state.attributions.map(a=>`<article class="li-card"><strong>${escape(state.campaigns.find(c=>c.id===a.campaign_id)?.title||a.campaign_id)}</strong><p>CRM lead: ${escape(a.lead_id)} · Stage: ${escape(a.stage||'Not provided')}</p><p class="li-muted">Source: ${escape(a.source||'Not provided')} · Recorded ${escape(stamp(a.recorded_at))}</p>${safeLink(a.source_url)?`<a href="${escape(safeLink(a.source_url))}" target="_blank" rel="noopener noreferrer">View attribution evidence</a>`:''}<p class="li-muted">Recorded by your team; separate from LinkedIn metrics.</p></article>`).join(''):'<p class="li-muted">No enquiry attribution has been recorded for these campaigns.</p>';
    [...state.jobs].reverse().forEach((job,index)=>{
      const card=$('job-list').children[index];if(!card)return;
      if(job.status==='failed')card.insertAdjacentHTML('beforeend',`<button type="button" data-li-action="retry" data-id="${escape(job.id)}">Retry failed publication</button>`);
      if(job.status==='unknown')card.insertAdjacentHTML('beforeend',`<p>The provider outcome is unknown. Check LinkedIn before reconciling; this job will not repost automatically.</p><label>Existing LinkedIn post URN<input data-li-reconcile="${escape(job.id)}" placeholder="urn:li:share:…"></label><button type="button" data-li-action="reconcile" data-id="${escape(job.id)}">Verify existing publication</button>`);
    });
  }
  function destinationName(id) {const d=array(state.status.destinations).find(item=>item.id===id||item.urn===id);return d?.name||id||'Destination unavailable';}
  function newDraft() {
    releaseMedia();
    state.current=null;state.selectedAssets=[];state.handoverId=null;state.handoverPromise=null;state.scheduleProposal=null;state.draftEpoch++;
    for(const id of ['title','objective','text','link','date','revision-request'])if($(id))$(id).value='';
    if(!$('panel'))return;
    $('rights').checked=false;$('preview').hidden=true;$('editing').textContent='New draft';$('versions').replaceChildren();$('concepts').replaceChildren();
    $('schedule-proposal').hidden=true;
    $('destination-options').querySelectorAll('input').forEach(el=>el.checked=false);$('asset-options').querySelectorAll('input').forEach(el=>el.checked=false);showTab('composer');
  }
  function draft() {return {
    ...(state.current?{id:state.current.id,revision:state.current.revision}:{}),title:$('title').value.trim(),objective:$('objective').value.trim(),text:$('text').value,
    destination_ids:[...$('destination-options').querySelectorAll('input:checked')].map(el=>el.value),asset_ids:state.selectedAssets,link:$('link').value.trim(),
    scheduled_at:scheduledInstant($('date').value),time_zone:zone,media_rights:$('rights').checked,...(state.handoverId?{handover_id:state.handoverId}:{})
  };}
  function loadCampaign(campaign) {
    state.current=campaign;state.selectedAssets=array(campaign.asset_ids);state.handoverId=campaign.handover_id||null;state.handoverPromise=null;state.draftEpoch++;state.scheduleProposal=null;$('schedule-proposal').hidden=true;
    for(const key of ['title','objective','text','link'])$(key).value=campaign[key]||'';
    $('date').value=campaign.scheduled_at?new Date(new Date(campaign.scheduled_at).valueOf()-new Date(campaign.scheduled_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
    $('rights').checked=Boolean(campaign.media_rights);$('editing').textContent='Saved version '+campaign.revision+' · '+(campaign.approval?'Approved':'Draft');
    $('destination-options').querySelectorAll('input').forEach(el=>el.checked=array(campaign.destination_ids).includes(el.value));
    $('versions').innerHTML=array(campaign.versions||campaign.history).map(v=>`<article class="li-card"><strong>Version ${escape(v.revision)}</strong><p>${escape(stamp(v.updated_at||v.created_at))}</p><pre>${escape(v.text||v.content?.text||'')}</pre></article>`).join('')||'<p>This is the first saved version.</p>';
    render();showTab('composer');preview();
  }
  function preview() {
    releaseMedia();
    const d=draft();
    $('preview').hidden=false;$('preview').innerHTML=`<h4>Publication preview</h4><p><strong>Author:</strong> ${escape(d.destination_ids.map(destinationName).join(', ')||'Choose a publishing destination')}</p><pre>${escape(d.text)}</pre>${safeLink(d.link)?`<p><a href="${escape(safeLink(d.link))}" target="_blank" rel="noopener noreferrer">${escape(d.link)}</a></p>`:''}<p><strong>Media:</strong> ${escape(d.asset_ids.map(id=>{const a=state.assets.find(item=>item.id===id);return a?.filename||a?.title||id;}).join(', ')||'None')}</p>${d.asset_ids.length?'<button type="button" data-li-action="preview-media">Load media preview</button><div id="m360-li-media-preview"></div>':''}<p><strong>When:</strong> ${escape(d.scheduled_at?stamp(d.scheduled_at)+' ('+zone+')':'Queue now')}</p><p class="li-muted">Organic publication does not guarantee delivery to named CRM contacts.</p>`;
  }
  function releaseMedia() {state.previewVersion++;for(const url of state.mediaUrls)URL.revokeObjectURL(url);state.mediaUrls=[];}
  async function previewMedia() {
    const asset=state.assets.find(item=>item.id===state.selectedAssets[0]);if(!asset)throw Error('Select a saved media asset first.');
    const w=workspace(),generation=state.previewVersion,bearer=token();if(!bearer)throw Error('Sign in again to preview media.');
    const parts=[],count=asset.size>3*1024*1024?Math.ceil(asset.size/1048576):1;
    for(let index=0;index<count;index++){
      const params=new URLSearchParams({op:'asset',workspace_id:w,id:asset.id,...(count>1?{index:String(index)}:{})});
      const response=await fetch('/api/linkedin?'+params,{headers:{Authorization:'Bearer '+bearer},cache:'no-store'});
      if(!response.ok)throw Error('Saved media preview is unavailable.');
      parts.push(await response.blob());
      if(w!==workspace()||generation!==state.previewVersion||!token())return;
      $('media-preview').textContent='Loading media '+Math.round((index+1)/count*100)+'%';
    }
    const url=URL.createObjectURL(new Blob(parts,{type:asset.mime}));state.mediaUrls.push(url);
    const element=document.createElement(asset.mime?.startsWith('image/')?'img':asset.mime?.startsWith('video/')?'video':'a');
    if(element.tagName==='IMG'){element.src=url;element.alt=asset.filename||'Campaign image';}
    else if(element.tagName==='VIDEO'){element.src=url;element.controls=true;element.preload='metadata';}
    else {element.href=url;element.target='_blank';element.rel='noopener';element.textContent='Open saved PDF preview';}
    $('media-preview').replaceChildren(element);
  }
  async function save() {if(state.handoverPromise)await state.handoverPromise;const result=await api('save',{campaign:draft()});state.current=result.campaign||result;await refresh();loadCampaign(state.current);announce('Draft saved. Review this exact version before queuing.');return state.current;}
  function requireSaved() {if(!state.current)throw Error('Save this draft first.');const current=draft();for(const key of ['title','objective','text','link','scheduled_at','time_zone','media_rights','destination_ids','asset_ids'])if(JSON.stringify(current[key])!==JSON.stringify(state.current[key]??(Array.isArray(current[key])?[]:current[key]===null?null:typeof current[key]==='boolean'?false:'')))throw Error('Save your changes before approving or queuing.');return state.current;}
  async function action(name,button) {
    if(name==='refresh')return refresh();
    if(name==='new')return newDraft();
    if(name==='connect'||name==='reconnect'){if(!state.status.configuration?.oauth_ready||!state.status.configuration?.token_encryption_ready)throw Error('Setup not finished. Required LinkedIn environment variables are missing.');const result=await api('connect',name==='reconnect'?{connection_id:button.dataset.id}:{});const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='www.linkedin.com')throw Error('The authorization URL is invalid.');sessionStorage.setItem('m360_linkedin_oauth_workspace',workspace());window.location.assign(url.href);return;}
    if(name==='disconnect'||name==='destinations'){await api(name,{connection_id:button.dataset.id});return refresh();}
    if(name==='open'){const c=state.campaigns.find(item=>item.id===button.dataset.id);if(c)loadCampaign(c);return;}
    if(name==='clear-media'){state.selectedAssets=[];render();return;}
    if(name==='select-asset'){if(!state.assets.some(a=>a.id===button.dataset.id))throw Error('Completed media has not been saved yet. Refresh its progress.');state.selectedAssets=[button.dataset.id];render();announce('Completed media selected. Save the campaign to attach it.');return;}
    if(name==='content-image'||name==='content-reel'){
      const prompt=$('content-prompt').value.trim();if(!prompt)throw Error('Describe the creative you want Content Studio to prepare.');
      const result=await api('content-start',{request_id:crypto.randomUUID(),kind:name==='content-image'?'image':'reel',prompt});
      if(result.asset)state.selectedAssets=[result.asset.id];await refresh();announce(result.asset?'Completed media selected. Save your campaign.':'Content Studio request saved. Progress will appear here when the actual asset is ready.');return;
    }
    if(name==='content-status'){await api('content-status',{request_id:button.dataset.id});await refresh();return;}
    if(name==='preview')return preview();
    if(name==='preview-media')return previewMedia();
    if(name==='save')return save();
    if(name==='toggle-ai-key'){
      const d=$('ai-key-drawer');
      if(d)d.style.display=d.style.display==='none'?'block':'none';
      return;
    }
    if(name==='save-ai-key'){
      const key=$('ai-key-input')?.value?.trim();
      if(!key||!key.startsWith('sk-')||key.length<20)throw Error('Enter a valid OpenAI API key starting with sk-.');
      announce('Verifying API key with OpenAI…');
      const statusEl=$('ai-key-status');
      if(statusEl)statusEl.textContent='Verifying with OpenAI…';
      await api('configure-ai',{api_key:key});
      sessionStorage.setItem('matrix360_user_openai_key',key);
      if(state.status?.configuration)state.status.configuration.ai_ready=true;
      if(statusEl)statusEl.textContent='Verified and connected!';
      announce('OpenAI API key verified and connected successfully!');
      await refresh();
      const d=$('ai-key-drawer');if(d)d.style.display='none';
      return;
    }
    if(name==='prepare'||name==='revise'){
      const activeKey=sessionStorage.getItem('matrix360_user_openai_key')||$('ai-key-input')?.value?.trim()||'';
      if(!state.status.configuration?.ai_ready&&!activeKey)throw Error('AI drafting needs configuration. Enter your OpenAI API key above or configure OPENAI_API_KEY on the server.');
      if(name==='revise'&&!$('text').value.trim()&&!$('revision-request').value.trim())throw Error('Enter revision instructions in the Revision request field.');
      announce(name==='revise'?'Revising draft with company grounding…':'Preparing content from your business objective…');
      const result=await api('prepare',{
        objective:$('objective').value.trim()||(name==='revise'?'Revise post according to instructions':''),
        language:$('language').value,
        time_zone:zone,
        campaign_id:state.current?.id,
        ...(activeKey?{api_key:activeKey}:{}),
        ...(state.handoverId?{handover_id:state.handoverId}:{}),
        ...(name==='revise'?{revision_request:$('revision-request').value,text:$('text').value}:{})
      });
      if(typeof result.text!=='string'||!result.text.trim())throw Error('AI returned no draft. Your current content is unchanged.');
      $('text').value=result.text;$('length').textContent=result.text.length+' / 3,000 characters';
      state.scheduleProposal=null;$('schedule-proposal').hidden=true;
      if(result.schedule_proposal){try{proposalLocal(result.schedule_proposal);state.scheduleProposal=result.schedule_proposal;$('schedule-proposal').hidden=false;$('schedule-proposal').innerHTML='<strong>Suggested publication time</strong><p>'+escape(stamp(result.schedule_proposal.scheduled_at)+' ('+zone+')')+'</p><p>'+escape(result.schedule_proposal.explanation||'')+'</p><button type="button" data-li-action="apply-schedule">Use this time in the draft</button>';}catch{announce('AI returned an invalid time proposal. Choose the publication time manually.',true);}}
      $('concepts').innerHTML=(array(result.missing_information).length?'<div class="li-card"><strong>Information still needed</strong><ul>'+result.missing_information.map(item=>'<li>'+escape(item)+'</li>').join('')+'</ul></div>':'')+array(result.concepts).map((c,i)=>`<div class="li-card"><strong>Concept ${i+1}</strong><p>${escape(typeof c==='string'?c:c.title||c.name||'')}</p><p>${escape(typeof c==='object'?c.summary||c.description||c.text||'':'')}</p>${typeof c==='object'&&c.text?`<button type="button" data-li-action="concept" data-index="${i}">Use this concept</button>`:''}</div>`).join('');state.concepts=array(result.concepts);
      announce(name==='revise'?'AI draft revised with your instructions. Review and save your chosen content.':'AI draft prepared. Review and save your chosen content.');
      preview();
      return;
    }
    if(name==='concept'){const c=state.concepts?.[Number(button.dataset.index)];if(c?.text)$('text').value=c.text;preview();return;}
    if(name==='apply-schedule'){if(!state.scheduleProposal)throw Error('Prepare a valid schedule suggestion first.');$('date').value=proposalLocal(state.scheduleProposal);preview();announce('Suggested time added to the draft. Save it before queuing publication.');return;}
    if(name==='approve'||name==='schedule'){const c=requireSaved();await api(name,{campaign_id:c.id,revision:c.revision});await refresh();loadCampaign(state.campaigns.find(item=>item.id===c.id)||c);announce(name==='approve'?'Saved version approved.':'Publication queued. The worker will record each destination’s outcome.');if(name==='schedule')showTab('results');return;}
    if(name==='batch-approve'){const ids=[...$('campaign-list').querySelectorAll('[data-li-batch]:checked')].map(el=>el.value);if(!ids.length)throw Error('Select saved campaigns to approve.');let done=0;for(const id of ids){const c=state.campaigns.find(item=>item.id===id);await api('approve',{campaign_id:c.id,revision:c.revision});done++;announce('Approved '+done+' of '+ids.length+' saved versions.');}await refresh();announce(done+' saved versions approved.');return;}
    if(name==='batch-schedule'){
      const ids=new Set([...$('campaign-list').querySelectorAll('[data-li-batch]:checked')].map(el=>el.value)),campaigns=state.campaigns.filter(c=>ids.has(c.id)),w=workspace();
      if(!campaigns.length)throw Error('Select saved campaigns to schedule.');
      const results=await scheduleCampaignBatch(campaigns,body=>api('schedule',body,w)),queued=results.filter(r=>r.queued).length,failed=results.filter(r=>!r.queued);
      if(w!==workspace())return;
      let refreshError;try{await refresh();}catch(error){refreshError=error;}
      const message=queued+' of '+results.length+' saved campaigns queued.'+(failed.length?' '+failed.map(r=>(r.title||r.id)+': '+r.error).join(' · '):'')+(refreshError?' Status refresh failed: '+refreshError.message:'');
      $('batch-result').textContent=message;announce(message,failed.length>0||Boolean(refreshError));return;
    }
    if(name==='cancel'||name==='verify'){await api(name,{job_id:button.dataset.id});await refresh();announce(name==='cancel'?'Cancellation recorded.':'Publication verification completed.');return;}
    if(name==='retry'||name==='reconcile'){
      const body={job_id:button.dataset.id};
      if(name==='reconcile'){body.provider_post_id=[...$('job-list').querySelectorAll('[data-li-reconcile]')].find(el=>el.dataset.liReconcile===button.dataset.id)?.value.trim();if(!body.provider_post_id)throw Error('Enter the existing post URN from LinkedIn.');}
      await api(name,body);await refresh();announce(name==='retry'?'Eligible failed publication queued again.':'Existing publication verified and reconciled.');return;
    }
    if(name==='performance'){
      const data=await api('performance',{job_id:button.dataset.id}),performance=data.performance||data,values=performance.metrics||performance.values||{};
      const rows=Object.entries(values).map(([key,value])=>`<tr><th>${escape(key.replace(/_/g,' '))}</th><td>${escape(typeof value==='number'?value.toLocaleString():value==null?'Unavailable':typeof value==='object'?value.value??'Unavailable':value)}</td></tr>`).join('');
      $('performance').innerHTML='<h4>Retrieved performance</h4><p>'+escape(performance.reason||performance.status||'Metrics retrieved from LinkedIn.')+'</p>'+(performance.retrieved_at?'<p class="li-muted">Retrieved '+escape(stamp(performance.retrieved_at))+'</p>':'')+(rows?'<table><tbody>'+rows+'</tbody></table>':'<p>No entitled metrics were returned.</p>');return;
    }
    if(name==='attribute'){
      const campaign_id=$('attribution-campaign').value,lead_id=$('attribution-lead').value.trim(),source_url=$('attribution-url').value.trim();
      if(!campaign_id||!lead_id)throw Error('Choose a saved campaign and enter an existing CRM lead ID.');
      if(source_url&&!safeLink(source_url))throw Error('Use an HTTPS evidence URL.');
      await api('attribute',{campaign_id,lead_id,...(source_url?{source_url}:{})});$('attribution-lead').value='';$('attribution-url').value='';await refresh();announce('Existing CRM enquiry linked to the campaign as team-recorded attribution.');return;
    }
    if(name==='attach'){const a=state.studio.find(item=>item.id===$('studio').value);if(!a)throw Error('Choose a saved Content Studio version.');const result=await api('attach-content',{poster_id:a.metadata?.poster_id,version:a.metadata?.version});state.selectedAssets=[result.asset.id];await refresh();announce('Saved creative attached to your draft.');return;}
    if(name==='upload'){
      const file=$('file').files?.[0];if(!file)throw Error('Choose a media file first.');if(!['image/jpeg','image/png','video/mp4','application/pdf'].includes(file.type))throw Error('Choose a JPEG, PNG, MP4 or PDF.');if(!file.size||file.size>200*1024*1024)throw Error('Upload a file between 1 byte and 200 MB.');
      const w=workspace(),start=await api('upload-start',{filename:file.name,mime:file.type,size:file.size},w);const size=start.chunk_bytes||1048576;
      for(let offset=0,index=0;offset<file.size;offset+=size,index++){const bytes=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));await api('upload-chunk',{upload_id:start.upload_id,index,base64:btoa(binary)},w);$('upload-progress').textContent='Uploaded '+Math.round(Math.min(offset+size,file.size)/file.size*100)+'%';}
      const result=await api('upload-complete',{upload_id:start.upload_id},w);state.selectedAssets=[result.asset.id];$('file').value='';await refresh();announce('Media uploaded and selected. Save the draft to keep this selection.');return;
    }
  }
  async function open(brief={}) {
    mount();if(!$('panel'))return;
    if(brief.workspace_id&&brief.workspace_id!==workspace()){announce('Select the workspace that owns this LinkedIn brief.',true);return;}
    $('panel').open=true;$('panel').scrollIntoView({behavior:'smooth',block:'start'});
    const objective=String(brief.objective||brief.prompt||'');
    if(objective||brief.text){
      newDraft();$('objective').value=objective;$('text').value=String(brief.text||'');$('title').value=String(brief.title||'');state.handoverId=brief.handover_id||null;showTab('composer');
      if(objective&&!state.handoverId){const epoch=state.draftEpoch;state.handoverPromise=api('handover',{objective,correlation_id:brief.correlation_id||crypto.randomUUID()}).then(result=>{if(state.draftEpoch===epoch)state.handoverId=result.handover?.id||null;});}
    }
    let handoverError;
    if(state.handoverPromise)try{await state.handoverPromise;}catch(error){handoverError=error;}
    if(!state.busy)await run(refresh);
    if(handoverError)announce(handoverError.message,true);
  }
  function captureCallback() {
    const params=new URLSearchParams(location.search);
    if(params.get('linkedin_callback')!=='1')return;
    const callback={code:params.get('code'),state:params.get('state'),error:params.get('error'),at:Date.now()};
    sessionStorage.setItem('m360_linkedin_callback',JSON.stringify(callback));
    for(const key of ['code','state','error','error_description','linkedin_callback'])params.delete(key);
    history.replaceState(history.state,'',location.pathname+(params.size?'?'+params:'')+location.hash);
  }
  async function resumeCallback() {
    if(state.callback||!$('panel')||!token()||!workspace())return;
    const raw=sessionStorage.getItem('m360_linkedin_callback');if(!raw)return;
    state.callback=true;
    try{
      const callback=JSON.parse(raw),expected=sessionStorage.getItem('m360_linkedin_oauth_workspace');
      $('panel').open=true;showTab('accounts');
      if(expected&&expected!==workspace()){announce('Select the workspace where you started the LinkedIn connection.',true);return;}
      if(Date.now()-callback.at>600000)throw Error('The LinkedIn connection request expired. Connect again.');
      if(callback.error)throw Error('LinkedIn authorization was not completed. You can connect again.');
      await api('callback',{code:callback.code,state:callback.state});sessionStorage.removeItem('m360_linkedin_callback');sessionStorage.removeItem('m360_linkedin_oauth_workspace');await refresh();announce('LinkedIn connected. Choose a publishing destination.');
    }catch(error){sessionStorage.removeItem('m360_linkedin_callback');announce(error.message,true);}finally{state.callback=false;}
  }
  window.Matrix360LinkedIn={open};
  document.addEventListener('m360:outreach-brief',event=>{if(event.detail?.workspace===workspace()&&event.detail?.channel==='LinkedIn')open({objective:event.detail.prompt});});
  captureCallback();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  const observer=new MutationObserver(()=>{if(!$('panel'))mount();});observer.observe(document.documentElement,{childList:true,subtree:true});
  setInterval(()=>{if(!token()&&state.workspace){resetWorkspace();state.workspace='';announce('Sign in to view this workspace.');}if($('panel')?.open&&!document.hidden&&!state.busy&&token()){if(state.workspace!==workspace())resetWorkspace();else run(refresh);}resumeCallback();},15000);
})();
