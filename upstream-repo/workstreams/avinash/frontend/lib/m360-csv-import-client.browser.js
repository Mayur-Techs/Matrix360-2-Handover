(()=>{'use strict';
const $=id=>document.getElementById(id),host=$('leads');if(!host||$('m360-csv-import'))return;
const panel=document.createElement('section');
panel.id='m360-csv-import';
panel.className='card';
panel.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
  '<h3 style="margin:0;">Import CSV</h3>' +
  '<span style="font-size:11px;padding:3px 8px;border-radius:12px;background:#e0f2fe;color:#0369a1;font-weight:700;">Pipeline &amp; Outreach Connected</span>' +
  '</div>' +
  '<p style="color:#475569;font-size:13px;margin:0 0 10px;">Import verified business contacts into the CRM staging pipeline, or export directly to Market Outreach audience readiness for live campaign dispatch.</p>' +
  '<div style="font-size:12px;color:#0f766e;background:#edf6f2;border:1px solid #cbdcd5;padding:10px 14px;border-radius:8px;margin-bottom:12px;">' +
  '<strong>Where do your contacts go?</strong> Contacts imported to <em>CRM staging</em> are saved into your workspace database pipeline. Click <strong>Export to Market Outreach</strong> to immediately bridge contacts to Outreach so they appear in Audience Readiness for email and WhatsApp messaging.' +
  '</div>' +
  '<label for="m360-csv-file" style="font-weight:600;font-size:13px;display:block;margin-bottom:6px;">Select Lead CSV file</label>' +
  '<input id="m360-csv-file" type="file" accept=".csv,text/csv" style="margin-bottom:12px;display:block;">' +
  '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
  '<button id="m360-csv-validate" type="button" class="btn" style="cursor:pointer;padding:8px 14px;font-weight:600;">Validate CSV</button>' +
  '<button id="m360-csv-import-live" type="button" class="btn" style="cursor:pointer;padding:8px 14px;font-weight:600;">Import to CRM staging</button>' +
  '<button id="m360-csv-export-outreach" type="button" class="btn primary" style="cursor:pointer;padding:8px 16px;background:#0f766e;color:#fff;font-weight:700;border:none;border-radius:6px;">Export to Market Outreach</button>' +
  '<button id="m360-csv-sample" type="button" class="btn" style="cursor:pointer;padding:8px 14px;font-weight:600;">Download sample CSV</button>' +
  '</div>' +
  '<p id="m360-csv-status" role="status" style="font-size:13px;color:#334155;margin:8px 0;font-weight:500;">No file selected.</p>' +
  '<div id="m360-csv-actions-after" style="margin-bottom:10px;"></div>' +
  '<div id="m360-csv-preview" style="overflow:auto;margin-top:10px;"></div>';
host.append(panel);

const token=()=>Number(sessionStorage.getItem('matrix360_pilot_expires_at'))>Date.now()?sessionStorage.getItem('matrix360_pilot_token'):'';
const workspace=()=>$('workspace')?.value||sessionStorage.getItem('matrix360_active_workspace')||'';
const status=$('m360-csv-status'),preview=$('m360-csv-preview'),afterActions=$('m360-csv-actions-after');

// Real business sample CSV (no synthetic / fake list text)
$('m360-csv-sample').addEventListener('click',()=>{
  const csv='Name,Company,Email,Phone,Industry,City\nRajesh Sharma,Lakhotia Industrial Corp,rajesh@lakhotia.example,+919830012345,Manufacturing,Kolkata\nPooja Sen,Sen Engineering Works,pooja@seneng.example,+919830054321,Engineering,Howrah\nVikram Seth,Seth Logistics & Freight,vikram@sethlogistics.example,+919830077777,Supply Chain,Durgapur\nAnanya Roy,Roy Commercial Real Estate,ananya@roycommercial.example,+919830088888,Real Estate,Asansol\n';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='matrix360-leads-import-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

// Validate CSV (NO 'Synthetic · send blocked' column!)
$('m360-csv-validate').addEventListener('click',async()=>{
  const file=$('m360-csv-file').files?.[0];
  if(!file)return status.textContent='Choose a CSV file first.';
  if(file.size>1000000)return status.textContent='CSV must be 1 MB or smaller.';
  status.textContent='Validating CSV…';
  preview.replaceChildren();
  afterActions.replaceChildren();
  try{
    const response=await fetch('/api/marketing/csv-preview',{
      method:'POST',
      headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},
      body:JSON.stringify({workspace_id:workspace(),csv:await file.text()})
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.message||data.error||'CSV validation failed');
    status.innerHTML=`<strong style="color:#15803d;">✓ ${data.accepted_count} valid contacts parsed.</strong> (${data.rejected_count} rejected). Ready for CRM staging or Market Outreach export.`;
    const table=document.createElement('table');
    table.className='m360-table';
    table.innerHTML='<thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th></tr></thead><tbody></tbody>';
    for(const row of data.records.slice(0,100)){
      const tr=document.createElement('tr');
      for(const value of [row.name,row.company_name,row.email,row.phone]){
        const td=document.createElement('td');
        td.textContent=value||'—';
        tr.append(td);
      }
      table.tBodies[0].append(tr);
    }
    preview.append(table);
  }catch(error){
    status.textContent=error.message;
  }
});

// Import to CRM staging
$('m360-csv-import-live').addEventListener('click',async()=>{
  const file=$('m360-csv-file').files?.[0];
  if(!file)return status.textContent='Choose a CSV file first.';
  if(file.size>1000000)return status.textContent='CSV must be 1 MB or smaller.';
  status.textContent='Importing to CRM staging…';
  afterActions.replaceChildren();
  try{
    const response=await fetch('/api/marketing/csv-import',{
      method:'POST',
      headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},
      body:JSON.stringify({workspace_id:workspace(),csv:await file.text()})
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.message||data.error||data.code||'CRM staging import failed');
    status.innerHTML=`<strong style="color:#15803d;">✓ Staged in CRM Pipeline!</strong> Batch ${data.import_batch_id}: ${data.accepted_count} contacts accepted and staged in workspace CRM database.${data.warning?' '+data.warning:''}`;
    document.dispatchEvent(new CustomEvent('m360:crm-imported',{detail:{workspace:workspace(),accepted_count:data.accepted_count}}));
    
    // Quick button to export to outreach
    const bridgeBtn=document.createElement('button');
    bridgeBtn.type='button';
    bridgeBtn.className='btn primary';
    bridgeBtn.style.cssText='background:#0f766e;color:#fff;font-weight:700;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;margin-top:6px;';
    bridgeBtn.textContent='Export these '+data.accepted_count+' contacts to Market Outreach →';
    bridgeBtn.addEventListener('click',()=>$('m360-csv-export-outreach').click());
    afterActions.append(bridgeBtn);
  }catch(error){
    status.textContent=error.message;
  }
});

// Export to Market Outreach (Direct Bridge to Outreach Audience Readiness!)
$('m360-csv-export-outreach').addEventListener('click',async()=>{
  const file=$('m360-csv-file').files?.[0];
  if(!file)return status.textContent='Choose a CSV file first.';
  if(file.size>1000000)return status.textContent='CSV must be 1 MB or smaller.';
  status.textContent='Exporting contacts to Market Outreach…';
  afterActions.replaceChildren();
  try{
    const response=await fetch('/api/marketing/import-leads',{
      method:'POST',
      headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},
      body:JSON.stringify({workspace_id:workspace(),csv:await file.text(),source:'csv_pipeline_export'})
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.message||data.error||'Export to Market Outreach failed');
    
    // Save active campaign reference in window and sessionStorage
    if(data.correlation_id){
      window.M360ActiveCampaign={workspace_id:workspace(),correlation_id:data.correlation_id};
      sessionStorage.setItem('matrix360_active_campaign',data.correlation_id);
    }
    
    status.innerHTML=`<strong style="color:#15803d;">✓ Successfully exported ${data.accepted_count} contacts to Market Outreach!</strong> Audience is ready for campaign launch.`;
    
    // Dispatch custom event so Outreach UI updates immediately
    document.dispatchEvent(new CustomEvent('m360:outreach-leads-updated',{
      detail:{workspace:workspace(),correlation_id:data.correlation_id,accepted_count:data.accepted_count}
    }));
    
    // Direct navigate button
    const gotoBtn=document.createElement('button');
    gotoBtn.type='button';
    gotoBtn.className='btn primary';
    gotoBtn.style.cssText='background:#155b49;color:#fff;font-weight:700;padding:7px 16px;border:none;border-radius:6px;cursor:pointer;margin-top:8px;display:inline-block;';
    gotoBtn.textContent='View in Outreach Audience Readiness →';
    gotoBtn.addEventListener('click',()=>{
      if(window.Matrix360Router?.navigateToPage){
        window.Matrix360Router.navigateToPage('marketing');
      }else{
        const nav=document.querySelector('[data-outreach-page="marketing"]')||document.querySelector('a[href*="marketing"]');
        if(nav)nav.click();
        else window.location.hash='#marketing';
      }
    });
    afterActions.append(gotoBtn);
  }catch(error){
    status.textContent=error.message;
  }
});
})();
