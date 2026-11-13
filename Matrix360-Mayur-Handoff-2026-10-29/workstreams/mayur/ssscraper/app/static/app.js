const statusEl = document.querySelector('#status');
const summaryEl = document.querySelector('#summary');
const eventsEl = document.querySelector('#events');
const planButton = document.querySelector('#plan-button');
const startBtn = document.querySelector('#start');
const countSlider = document.querySelector('#count');
const countValue = document.querySelector('#count-value');
const planPanel = document.querySelector('#plan-panel');
const planSummary = document.querySelector('#plan-summary');
const filtersList = document.querySelector('#filters');
const planNote = document.querySelector('#plan-note');
const renderPanel = document.querySelector('#render-panel');
const renderPreview = document.querySelector('#render-preview');
const leadsPanel = document.querySelector('#leads-panel');
const leadsBody = document.querySelector('#leads-body');
const downloadCsv = document.querySelector('#download-csv');
const downloadReport = document.querySelector('#download-report');
const aiBadge = document.querySelector('#ai-status-badge');
const searchBadge = document.querySelector('#search-status-badge');

let activeJob = null;
let activePlan = null;

const esc = value => {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
};

countSlider.addEventListener('input', () => {
  countValue.textContent = countSlider.value;
});

// Check system API status on page load
async function checkSystemStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.has_ai_key) {
      aiBadge.textContent = `🤖 AI Active (${data.ai_model})`;
      aiBadge.className = 'badge badge-success';
    } else {
      aiBadge.textContent = '🤖 AI: Preview Mode (Add Key in .env)';
      aiBadge.className = 'badge';
    }
    if (data.has_maps_key) {
      searchBadge.textContent = '📍 Google Maps & Web Active';
      searchBadge.className = 'badge badge-success';
    } else {
      searchBadge.textContent = '🔍 Multi-Engine Web & LinkedIn Search Active';
      searchBadge.className = 'badge badge-secondary';
    }
  } catch (e) {
    // ignore
  }
}
checkSystemStatus();

function renderPlan(result) {
  activePlan = result;
  const plan = result.plan;
  planPanel.hidden = false;
  planSummary.textContent = plan.client_goal;

  filtersList.innerHTML = plan.plain_filters
    .map(item => `<li>${esc(item)}</li>`)
    .join('');

  const notes = [...(plan.cautions || []), result.setup_message].filter(Boolean);
  planNote.textContent = notes.join(' · ');

  startBtn.disabled = !result.ready_to_start;
  statusEl.innerHTML = result.ready_to_start
    ? '<p>✅ <strong>Research plan ready.</strong> Click <strong>Start Lead Research</strong> below when ready.</p>'
    : `<p>${esc(result.setup_message)}</p>`;
}

function renderReport(report, jobId) {
  if (!report) return;
  const pipeline = report.pipeline || {};
  const qualified = pipeline.qualified_contact_rows ?? report.contacts_extracted;
  const target = pipeline.target_qualified_leads ?? '—';
  const targetMet = pipeline.target_met ? 'Yes' : 'In Progress';

  summaryEl.innerHTML = `
    <div class="metric-card"><b>${esc(report.source_rows || 0)}</b><span>Businesses Discovered</span></div>
    <div class="metric-card"><b>${esc(report.pages_fetched || 0)}</b><span>Websites Inspected</span></div>
    <div class="metric-card"><b>${esc(qualified || 0)}</b><span>Qualified Leads</span></div>
    <div class="metric-card"><b>${esc(target)}</b><span>Target Goal</span></div>
    <div class="metric-card"><b>${esc(targetMet)}</b><span>Target Status</span></div>
  `;

  // Render preview table of leads if available
  const companies = report.companies || [];
  if (companies.length > 0 && jobId) {
    leadsPanel.hidden = false;
    downloadCsv.href = `/api/jobs/${encodeURIComponent(jobId)}/leads.csv`;
    downloadReport.href = `/api/jobs/${encodeURIComponent(jobId)}/report.json`;

    const qualifiedRows = [];
    companies.forEach(company => {
      const contacts = company.contacts || [];
      if (contacts.length > 0) {
        contacts.forEach(c => qualifiedRows.push({ ...c, company_name: company.company_name, domain: company.domain }));
      } else {
        qualifiedRows.push({
          company_name: company.company_name,
          domain: company.domain,
          fit_score: company.fit_score || 50,
          company_size: company.company_size || 'Unknown',
          qualification_summary: company.qualification_summary || (company.reasons || []).join('; ') || 'Candidate identified',
          named_contact: '',
          role: '',
          company_email: '',
          company_phone: '',
        });
      }
    });

    leadsBody.innerHTML = qualifiedRows.slice(0, 50).map(row => `
      <tr>
        <td><strong>${esc(row.company_name)}</strong></td>
        <td><a href="https://${esc(row.domain)}" target="_blank" rel="noopener" class="link">${esc(row.domain)}</a></td>
        <td><span class="score-badge">${esc(row.fit_score || 75)}</span></td>
        <td>${esc(row.company_size || 'Small (11-50)')}</td>
        <td>${esc(row.qualification_summary || 'Qualified business')}</td>
        <td>${esc(row.named_contact || '—')}</td>
        <td>${esc(row.role || '—')}</td>
        <td>${esc(row.company_email || '—')}</td>
        <td>${esc(row.company_phone || '—')}</td>
      </tr>
    `).join('');
  }
}

function renderJob(job) {
  const isComplete = job.status === 'COMPLETE';
  const isFailed = job.status === 'FAILED';

  statusEl.innerHTML = `
    <h2>Research Job ${esc(job.id)} — <span>${esc(job.status)}</span></h2>
    ${job.error ? `<p class="error-msg">⚠️ ${esc(job.error)}</p>` : ''}
    ${isComplete ? `
      <p>🎉 <strong>Research complete!</strong> All discovered businesses have been qualified and formatted.</p>
    ` : isFailed ? `
      <p>Job failed: ${esc(job.error)}</p>
    ` : `
      <p>🤖 Autonomous agents are discovering businesses, reading official websites, and qualifying decision-makers...</p>
    `}
  `;

  // Render events feed
  const events = job.events || [];
  eventsEl.innerHTML = events
    .slice(-35)
    .reverse()
    .map(event => {
      const d = event.data || {};
      const detail = d.agent || d.company || d.query || d.url || d.error || (d.qualified_contacts !== undefined ? `${d.qualified_contacts} qualified leads` : '');
      return `<li><b>${esc(event.name)}</b> ${esc(detail)}</li>`;
    })
    .join('') || '<li>Waiting for agent activity...</li>';

  // Render screenshot if available
  const latestWithShot = [...events].reverse().find(e => e.data && e.data.screenshot);
  if (latestWithShot) {
    const filename = latestWithShot.data.screenshot.split(/[\\/]/).pop();
    renderPanel.hidden = false;
    renderPreview.src = `/api/jobs/${encodeURIComponent(job.id)}/screenshots/${encodeURIComponent(filename)}`;
  }

  renderReport(job.report, job.id);
  startBtn.disabled = ['QUEUED', 'RUNNING'].includes(job.status);
}

async function poll() {
  if (!activeJob) return;
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(activeJob)}`);
    if (!res.ok) return;
    const jobData = await res.json();
    renderJob(jobData);
    if (['QUEUED', 'RUNNING'].includes(jobData.status)) {
      setTimeout(poll, 1200);
    }
  } catch (err) {
    // retry on transient network hiccup
    setTimeout(poll, 2000);
  }
}

planButton.addEventListener('click', async () => {
  const prompt = document.querySelector('#prompt').value.trim();
  if (prompt.length < 12) {
    statusEl.innerHTML = '<p>⚠️ Please describe your ideal customers in a bit more detail (at least a full sentence).</p>';
    return;
  }
  planButton.disabled = true;
  statusEl.innerHTML = '<p>🤖 <em>AI Planner is analyzing your goal and formulating a multi-source research plan...</em></p>';

  try {
    const response = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, lead_count: Number(countSlider.value) }),
    });
    planButton.disabled = false;
    if (!response.ok) {
      statusEl.innerHTML = `<p>⚠️ Could not create a plan: ${esc(await response.text())}</p>`;
      return;
    }
    const data = await response.json();
    renderPlan(data);
  } catch (err) {
    planButton.disabled = false;
    statusEl.innerHTML = `<p>⚠️ Error contacting server: ${esc(err.message)}</p>`;
  }
});

startBtn.addEventListener('click', async () => {
  if (!activePlan) return;
  startBtn.disabled = true;
  statusEl.innerHTML = '<p>🚀 Launching autonomous research pipeline...</p>';

  try {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_id: activePlan.id }),
    });
    if (!response.ok) {
      startBtn.disabled = false;
      statusEl.innerHTML = `<p>Could not start job: ${esc(await response.text())}</p>`;
      return;
    }
    const data = await response.json();
    activeJob = data.id;
    poll();
  } catch (err) {
    startBtn.disabled = false;
    statusEl.innerHTML = `<p>Failed to trigger research: ${esc(err.message)}</p>`;
  }
});
