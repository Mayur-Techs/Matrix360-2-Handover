const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '../workstreams/avinash/frontend/lib/m360-control-client.js');
let content = fs.readFileSync(targetPath, 'utf8');

// Replace corrupted chars
content = content.replaceAll('·', '-').replaceAll('…', '...');

const pattern = /async function startMarketingEngine\(message, handover, ws, auth\) \{[\s\S]*?\}\s*async function analyse/;

const replacement = `async function startMarketingEngine(message, handover, ws, auth) {
    const progress = $('m360-engine-progress');
    if (progress) {
      progress.dataset.running = 'true';
      progress.textContent = 'Marketing engine working... Preparing campaign brief...';
    }
    setStatus('Marketing engine working...', true);
    try {
      const res = await fetch('/api/marketing/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth },
        body: JSON.stringify({ workspace_id: ws, prompt: message, origin_module: 'overview' })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to dispatch marketing task');
      const corrId = result.correlation_id;
      window.M360ActiveCampaign = { correlation_id: corrId, channel: null };
      let done = false, pollCount = 0;
      while (!done && pollCount < 40) {
        pollCount++;
        await new Promise(r => setTimeout(r, 600));
        if (ws !== workspace() || auth !== token()) break;
        const tRes = await fetch('/api/marketing/tasks?workspace_id=' + encodeURIComponent(ws) + '&correlation_id=' + encodeURIComponent(corrId), {
          headers: { Authorization: 'Bearer ' + auth }
        });
        if (tRes.ok) {
          const tData = await tRes.json();
          const t = tData.task;
          if (t) {
            const step = t.status;
            const label = step === 'requesting_leads' ? 'Marketing requesting audience from Leads Engine...'
              : step === 'audience_received' ? 'Audience leads received. Requesting content from Studio...'
              : step === 'audience_empty' ? 'No CRM leads found. Proceeding with campaign positioning...'
              : step === 'requesting_content' ? 'Creative Studio assembling headlines & asset briefs...'
              : step === 'content_blocked' ? 'Creative brief created (visual assets pending). Assembling campaign package...'
              : step === 'assets_ready' ? 'Assets ready. Generating 10-channel campaign package...'
              : step === 'draft_ready' ? 'Campaign drafts & 3-gate readiness ready for review!'
              : step;
            if (progress) progress.textContent = label;
            if (step === 'draft_ready') {
              done = true;
              if (progress) {
                progress.dataset.running = 'false';
                const pitch = t.affinity_strategy?.pitch_framing || t.marketing_pitch || {};
                const valueProp = pitch.value_proposition || 'Targeted multi-channel campaign strategy prepared.';
                const channels = Object.keys(t.channel_draft_versions || {});
                const displayChans = ['WhatsApp', 'Email', 'LinkedIn', 'Instagram', 'Facebook', 'SMS'].filter(c => channels.includes(c));
                let buttonsHtml = displayChans.map(c => '<button type="button" class="m360-channel-jump-btn" data-channel="' + c + '" style="padding:5px 12px;font-size:12px;border:1px solid #729286;border-radius:6px;background:#fff;color:#163c32;cursor:pointer;font-weight:600;">' + c + '</button>').join('');
                buttonsHtml += '<button type="button" class="m360-channel-jump-btn" data-channel="Full Plan" style="padding:5px 12px;font-size:12px;border:1px solid #155b49;border-radius:6px;background:#155b49;color:#fff;cursor:pointer;font-weight:600;">Open Marketing Workspace</button>';
                
                const waBody = t.channel_draft_versions?.WhatsApp?.versions?.[0]?.body || '';
                const emailSubject = t.channel_draft_versions?.Email?.versions?.[0]?.subject || '';
                const emailBody = t.channel_draft_versions?.Email?.versions?.[0]?.body || '';
                
                let previewHtml = '';
                if (waBody || emailBody) {
                  previewHtml = '<details style="margin-top:10px;background:#fff;border:1px solid #c1d3cb;border-radius:8px;padding:10px;"><summary style="cursor:pointer;font-weight:650;color:#155b49;">Quick Copy Preview in Overview</summary><div style="margin-top:8px;display:grid;gap:8px;font-size:13px;">' +
                    (waBody ? '<div><strong style="color:#128C7E;">WhatsApp:</strong><p style="margin:4px 0;background:#f0f7f4;padding:8px;border-radius:6px;white-space:pre-wrap;">' + waBody + '</p></div>' : '') +
                    (emailBody ? '<div><strong style="color:#1a5276;">Email (' + emailSubject + '):</strong><p style="margin:4px 0;background:#f4f6f9;padding:8px;border-radius:6px;white-space:pre-wrap;">' + emailBody + '</p></div>' : '') +
                    '</div></details>';
                }

                progress.innerHTML = '<div style="display:grid;gap:8px;width:100%;"><strong>Campaign Package Ready - 10 Channel Drafts Prepared</strong><p style="margin:0;font-size:13px;color:#163c32;">' + valueProp + '</p><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">' + buttonsHtml + '</div>' + previewHtml + '</div>';

                progress.querySelectorAll('.m360-channel-jump-btn').forEach(btn => {
                  btn.addEventListener('click', () => {
                    const ch = btn.dataset.channel;
                    window.M360ActiveCampaign = { correlation_id: corrId, channel: ch === 'Full Plan' ? null : ch };
                    openEngine('marketing_activation', handover, ws, auth);
                  });
                });
              }
              setStatus('Ready - Campaign package prepared in Marketing.');
              notify('Marketing campaign package ready for review.', 'success');
            } else if (step === 'failed') {
              done = true;
              if (progress) { progress.dataset.running = 'false'; progress.textContent = 'Marketing task stopped.'; }
              setStatus('Marketing task stopped.');
            }
          }
        }
      }
    } catch {
      if (progress) { progress.dataset.running = 'false'; progress.textContent = 'Open Marketing to continue with this prepared task.'; }
    }
  }
  async function analyse`;

if (!pattern.test(content)) {
  console.error('Pattern not found');
  process.exit(1);
}

const updated = content.replace(pattern, replacement);
fs.writeFileSync(targetPath, updated, 'utf8');
console.log('Successfully updated m360-control-client.js');
