/* CRM-authorized persistent brand library; backend never trusts browser workspace alone. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const host=$('verified'),services=$('services');
 if(!host||!services||$('m360-brand-profile'))return;
 const panel=document.createElement('section');panel.id='m360-brand-profile';panel.className='card';
 panel.setAttribute('aria-labelledby','m360-brand-title');
 panel.innerHTML=[
 '<div class="m360-brand-head"><div><span class="eyebrow">LONG-TERM BUSINESS MEMORY</span><h2 id="m360-brand-title">Business Profile</h2><p>Save core facts once. Matrix360 uses this reviewed profile instead of repeatedly questioning you.</p></div><span class="tag" id="m360-brand-version">Not loaded</span></div>',
 '<p id="m360-brand-status" role="status" aria-live="polite">Waiting for CRM authorization…</p>',
 '<form id="m360-brand-form"><div class="m360-brand-fields">',
 '<label>Company name<input name="business_name" maxlength="120" placeholder="Your business name"></label>',
 '<label>Website<input name="website" maxlength="240" placeholder="https://"></label>',
 '<label>Industry<input name="industry" maxlength="240" placeholder="Industry or business category"></label>',
 '<label>Email<input name="email" maxlength="240" type="email"></label>',
 '<label>Telephone<input name="phone" maxlength="160"></label>',
 '<label>WhatsApp<input name="whatsapp" maxlength="160"></label>',
 '<label>Address<input name="address" maxlength="480"></label>',
 '<label>Brand colors<input name="colors" maxlength="350" placeholder="#163E35, #E8EFEB"></label>',
 '<label>Typography<input name="typography" maxlength="500" placeholder="Font and hierarchy guidance"></label>',
 '<label class="wide">Business description<textarea name="description" maxlength="2500" rows="3"></textarea></label>',
 '<label class="wide">Products and services, one per line<textarea name="products_services" maxlength="2400" rows="3"></textarea></label>',
 '<label class="wide">Approved claims, one per line<textarea name="approved_claims" maxlength="2400" rows="3"></textarea></label>',
 '<label class="wide">Creative style and inspiration guidance<textarea name="style_preferences" maxlength="2500" rows="3"></textarea></label>',
 '</div><div class="m360-brand-actions"><button class="btn" id="m360-brand-research" type="button" disabled>Research company &amp; fill gaps</button><button class="btn primary" id="m360-brand-save" type="submit" disabled>Save business profile</button><button class="btn" id="m360-brand-reload" type="button">Reload saved profile</button></div><div id="m360-brand-research-sources" aria-live="polite"></div></form>',
 '<div class="m360-brand-assets"><h3>Saved logos &amp; inspiration</h3><p>Selected references guide future creative. Images are private and are not published.</p>',
 '<div class="m360-brand-actions"><label>Image category<select id="m360-brand-role"><option value="primary_logo">Primary logo</option><option value="alternate_logo">Alternate logo</option><option value="photograph">Approved photograph</option><option value="inspiration">Inspiration / reference</option><option value="approved_creative">Approved creative</option></select></label>',
 '<label>Choose PNG, JPEG or WEBP (under 1.9 MB)<input id="m360-brand-file" type="file" accept="image/png,image/jpeg,image/webp"></label>',
 '<button class="btn" id="m360-brand-upload" type="button" disabled>Upload private asset</button></div>',
 '<div id="m360-brand-assets-list" class="m360-brand-assets-list" aria-live="polite"></div></div>'
 ].join('');
 services.before(panel);
 const nav=document.querySelector('.workspace-nav');if(nav){const a=document.createElement('a');a.href='#m360-brand-profile';a.textContent='Brand profile & assets';nav.append(a);}
 const css=document.createElement('style');
 css.textContent='#m360-brand-profile{scroll-margin-top:24px;padding:24px;margin:24px 0;border:1px solid #d1e4db;background:linear-gradient(145deg,#fff,#f8fbf8)}'+
 '.m360-brand-head{display:flex;justify-content:space-between;align-items:flex-start;gap:15px;flex-wrap:wrap}.m360-brand-head h2{color:#173e38;font-size:clamp(22px,2.8vw,29px);margin:8px 0}'+
 '#m360-brand-profile p{color:#526f65;line-height:1.5}#m360-brand-status{font-size:13px;min-height:1.5em}.m360-brand-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:16px 0}'+
 '.m360-brand-fields label,.m360-brand-assets label{display:grid;gap:6px;color:#284b43;font-size:13px;font-weight:600}'+
 '.m360-brand-fields input,.m360-brand-fields textarea,.m360-brand-assets input,.m360-brand-assets select{width:100%;box-sizing:border-box;border:1px solid #c9d9d0;border-radius:9px;background:#fff;color:#203f38;padding:11px;font:inherit;font-weight:400}'+
 '.m360-brand-fields .wide{grid-column:1/-1}.m360-brand-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin:16px 0}'+
 '.m360-brand-assets{border-top:1px solid #d6e4df;padding-top:18px;margin-top:20px}.m360-brand-assets-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:15px}'+
 '.m360-brand-asset{background:#fff;border:1px solid #d4e1d8;border-radius:12px;padding:14px;display:grid;gap:9px;min-width:0}.m360-brand-asset img{width:100%;height:140px;object-fit:contain;background:#f4f7f5;border-radius:8px}'+
 '.m360-brand-asset strong{font-size:13px;overflow-wrap:anywhere}.m360-brand-asset-actions{display:flex;flex-wrap:wrap;gap:8px}.m360-brand-asset-actions button{font-size:12px;padding:7px 10px}'+
 '@media(max-width:690px){.m360-brand-fields{grid-template-columns:1fr}#m360-brand-profile{padding:16px}}';
 document.head.append(css);
 const form=$('m360-brand-form'),names=['business_name','website','industry','email','phone','whatsapp','address','colors','typography','description','products_services','approved_claims','style_preferences'];
 let workspace='',revision=0,seq=0,busy=false,assets=[];
 const status=s=>{$('m360-brand-status').textContent=s;};
 function token(){try{const t=sessionStorage.getItem('matrix360_pilot_token');return t&&Number(sessionStorage.getItem('matrix360_pilot_expires_at'))>Date.now()?t:null;}catch{return null;}}
 function allow(enabled){$('m360-brand-save').disabled=!enabled;$('m360-brand-upload').disabled=!enabled;$('m360-brand-research').disabled=!enabled;}
 function reset(){seq++;workspace='';revision=0;assets=[];busy=false;form.reset();$('m360-brand-file').value='';$('m360-brand-version').textContent='Not loaded';$('m360-brand-assets-list').replaceChildren();allow(false);status('Waiting for authorized workspace…');}
 async function api(method,data){const t=token();if(!t)throw Error('Your CRM session has expired');
  const r=await fetch('/api/brand'+(method==='GET'?'?'+new URLSearchParams(data).toString():''),
   {method,cache:'no-store',headers:{Authorization:'Bearer '+t,Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{})},body:method==='POST'?JSON.stringify(data):undefined});
  const value=await r.json().catch(()=>({message:'Unreadable brand server response'}));
  if(!r.ok)throw Error(value.message||'Brand request denied (HTTP '+r.status+')');return value;
 }
 function populate(p){for(const k of names){const elem=form.elements.namedItem(k);if(!elem)continue;const v=p[k];elem.value=k==='colors'?(Array.isArray(v)?v.join(', '):''):['approved_claims','products_services'].includes(k)?(Array.isArray(v)?v.join('\n'):''):typeof v==='string'?v:'';}}
 function serialize(){const out={};for(const k of names){const x=form.elements.namedItem(k)?.value?.trim()||'';if(!x)continue;if(k==='colors')out[k]=x.split(/[\s,]+/).filter(Boolean);else if(['approved_claims','products_services'].includes(k))out[k]=x.split(/\n+/).map(v=>v.trim()).filter(Boolean);else out[k]=x;}return out;}
 async function reload(ws,n){status('Loading saved business identity…');const result=await api('GET',{workspace_id:ws,action:'profile'});if(ws!==workspace||n!==seq||!token())return;
  revision=result.version||0;assets=Array.isArray(result.assets)?result.assets:[];
  const topbar=$('m360-mp-topbar');
  if(revision){host.append(panel);}else if(topbar){topbar.after(panel);queueMicrotask(()=>document.querySelector('[data-m360-goto="profile"]')?.click());}
  $('m360-brand-version').textContent=revision?'Version '+revision:'New business';
  populate(result.profile||{business_name:result.business_name||''});allow(true);
  status(revision?'Saved profile restored, '+assets.length+' reference assets.':'No saved profile yet. Creative can still work without a reference.');
  await listAssets(ws,n);
 }
 async function listAssets(ws,n){const list=$('m360-brand-assets-list');list.replaceChildren();
  if(!assets.length){const p=document.createElement('p');p.textContent='No uploaded brand references. Inspiration images are optional.';list.append(p);return;}
  for(const a of assets){if(n!==seq||workspace!==ws)return;const c=document.createElement('article');c.className='m360-brand-asset';
   const title=document.createElement('strong');title.textContent=(a.role||'Asset').replaceAll('_',' ')+' · '+(a.filename||a.id);c.append(title);
   const img=document.createElement('img');img.alt='Private saved reference';img.loading='lazy';c.append(img);
   const actions=document.createElement('div');actions.className='m360-brand-asset-actions';
   const select=document.createElement('button');select.type='button';select.className='btn';select.textContent=a.selected?'Reference selected ✓':'Select reference';
   const del=document.createElement('button');del.type='button';del.className='btn';del.textContent='Delete';
   actions.append(select,del);c.append(actions);list.append(c);
   select.addEventListener('click',async()=>{if(busy||workspace!==ws)return;busy=true;select.disabled=true;try{await api('POST',{workspace_id:ws,action:'select',asset_id:a.id,selected:!a.selected});await reload(ws,seq);}catch(e){status(e.message);}finally{busy=false;select.disabled=false;}});
   del.addEventListener('click',async()=>{if(busy||workspace!==ws||!confirm('Remove this brand reference from your business library?'))return;busy=true;del.disabled=true;try{await api('POST',{workspace_id:ws,action:'delete',asset_id:a.id});await reload(ws,seq);}catch(e){status(e.message);}finally{busy=false;del.disabled=false;}});
   api('GET',{workspace_id:ws,action:'signed',asset_id:a.id}).then(v=>{if(n===seq&&workspace===ws)img.src=v.asset_url;}).catch(()=>{if(n===seq&&workspace===ws)img.alt='Private image preview unavailable';});
  }
 }
 document.addEventListener('m360:workspace-changing',reset);document.addEventListener('m360:session-ended',reset);
 document.addEventListener('m360:crm-loaded',event=>{const ws=event.detail?.workspace;if(ws!==$('workspace')?.value||!token())return reset();reset();workspace=ws;reload(ws,seq).catch(e=>{status(e.message);allow(false);});});
 $('m360-brand-reload').addEventListener('click',()=>{if(workspace&&token())reload(workspace,seq).catch(e=>status(e.message));});
 $('m360-brand-research').addEventListener('click',async()=>{if(!workspace||busy||!token())return;const company=form.elements.business_name.value.trim();if(!company)return status('Enter the company name before research.');busy=true;allow(false);status('Researching public company sources…');
  try{const result=await api('POST',{workspace_id:workspace,action:'research',business_name:company,website:form.elements.website.value.trim()});for(const [field,value] of Object.entries(result.suggestions||{})){const elem=form.elements.namedItem(field);if(!elem||elem.value.trim())continue;elem.value=Array.isArray(value)?value.join('\n'):value||'';}
   const sources=$('m360-brand-research-sources');sources.replaceChildren();if(result.sources?.length){const p=document.createElement('p');p.textContent='Research sources: ';for(const [index,url] of result.sources.entries()){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=new URL(url).hostname;p.append(index?', ':'',a);}sources.append(p);}status('Research filled empty fields only. Review every fact, then save the profile.');}
  catch(e){status(e.message);}finally{busy=false;allow(true);}
 });
 form.addEventListener('submit',async e=>{e.preventDefault();if(!workspace||busy||!token())return;const ws=workspace,n=seq;busy=true;allow(false);status('Saving your confirmed brand identity…');
  try{const r=await api('POST',{workspace_id:ws,action:'save',expected_version:revision,profile:serialize()});if(seq===n&&workspace===ws){revision=r.version;$('m360-brand-version').textContent='Version '+revision;status('Brand profile saved permanently as version '+revision+'.');}}
  catch(e){if(seq===n)status(e.message+' Reload if edited elsewhere.');}finally{busy=false;if(seq===n)allow(true);}
 });
 $('m360-brand-upload').addEventListener('click',async()=>{const ws=workspace,n=seq,f=$('m360-brand-file').files[0];
  if(!ws||busy||!token()||!f)return status('Choose a valid image.');
  if(!revision)return status('Save the business profile once before uploading references.');
  if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size<128||f.size>1900000)return status('Choose PNG/JPEG/WEBP smaller than 1.9 MB.');
  busy=true;allow(false);status('Uploading to the private business library…');
  try{const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Image could not be read'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(f);});
   const result=await api('POST',{workspace_id:ws,action:'upload',role:$('m360-brand-role').value,mime:f.type,filename:f.name,base64,selected:true});
   if(seq===n&&workspace===ws){$('m360-brand-file').value='';status('Image saved: '+result.asset_id);await reload(ws,n);}}
  catch(e){if(seq===n)status(e.message);}finally{busy=false;if(seq===n)allow(true);}
 });
})();
