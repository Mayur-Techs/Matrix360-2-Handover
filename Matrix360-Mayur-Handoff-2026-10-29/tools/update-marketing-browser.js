const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '../workstreams/avinash/frontend/lib/m360-marketing-client.browser.js');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Update loadSavedTaskForWorkspace
const oldLoadFn = `  async function loadSavedTaskForWorkspace(workspaceId) {
    if (!workspaceId || !auth()) return setMktStatus('Sign in and choose an authorized workspace.');
    try {
      const data = await api('/api/marketing/tasks?' + new URLSearchParams({ workspace_id: workspaceId }));
      if (!data.tasks?.length) return setMktStatus('No Marketing task exists for this workspace yet.');
      await loadTask(data.tasks[0].correlation_id);
      setMktStatus(activeTask.status === 'draft_ready' ? 'Latest review draft loaded. Persistence is not yet durable.' : 'Latest Marketing task: ' + activeTask.status);
    } catch (error) { setMktStatus(error.message); }
  }`;

const newLoadFn = `  async function loadSavedTaskForWorkspace(workspaceId) {
    if (!workspaceId || !auth()) return setMktStatus('Sign in and choose an authorized workspace.');
    try {
      const activeCtx = window.M360ActiveCampaign;
      if (activeCtx && activeCtx.channel && CHANNELS.includes(activeCtx.channel)) {
        activeChannel = activeCtx.channel;
      }
      if (activeCtx && activeCtx.correlation_id) {
        try {
          await loadTask(activeCtx.correlation_id);
          setMktStatus('Active campaign loaded from Overview.');
          return;
        } catch (_) {}
      }
      const data = await api('/api/marketing/tasks?' + new URLSearchParams({ workspace_id: workspaceId }));
      if (!data.tasks?.length) return setMktStatus('No Marketing task exists for this workspace yet.');
      await loadTask(data.tasks[0].correlation_id);
      setMktStatus(activeTask.status === 'draft_ready' ? 'Latest review draft loaded.' : 'Latest Marketing task: ' + activeTask.status);
    } catch (error) { setMktStatus(error.message); }
  }`;

if (!content.includes(oldLoadFn)) {
  console.error('Target loadSavedTaskForWorkspace not found');
  process.exit(1);
}

content = content.replace(oldLoadFn, newLoadFn);

// 2. Add popstate and hashchange listeners before auto-mount
const oldMount = `  // Auto-mount and synchronize with router
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountMarketingCenter);
  } else {
    mountMarketingCenter();
  }`;

const newMount = `  // Auto-mount and synchronize with router
  window.addEventListener('popstate', () => { mountMarketingCenter(); loadSavedTaskForWorkspace(ws()); });
  window.addEventListener('hashchange', () => { mountMarketingCenter(); loadSavedTaskForWorkspace(ws()); });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountMarketingCenter);
  } else {
    mountMarketingCenter();
  }`;

content = content.replace(oldMount, newMount);

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Successfully updated m360-marketing-client.browser.js');
