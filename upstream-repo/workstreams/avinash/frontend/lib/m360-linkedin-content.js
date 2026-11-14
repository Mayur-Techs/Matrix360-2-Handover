'use strict';
const { createHash, randomUUID } = require('node:crypto');
const creativeMedia = require('../api/creative-media');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOCIAL = 'https://matrix360-socialmanager-recovery-staging.onrender.com';
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };

// Match the existing creative-media tenant contract; never accept a caller-supplied client slug.
function clientFor(workspace) {
  let map = {}; try { map = JSON.parse(process.env.M360_SOCIAL_WORKSPACE_MAP || '{}'); } catch { /* same default as Creative Studio */ }
  const previous = map && typeof map === 'object' && !Array.isArray(map) ? map[workspace] : undefined;
  if (previous !== undefined) {
    if (typeof previous !== 'string' || !/^[a-z0-9][a-z0-9-]{2,59}$/.test(previous) || previous === 'matrix360-demo') fail('CONTENT_TENANT', 'Creative workspace mapping is invalid.', 503);
    return previous;
  }
  return 'm360-' + createHash('sha256').update('matrix360-crm-tenant-v1:' + workspace).digest('hex').slice(0, 28);
}
function trustedAsset(value, workspace, kind, job) {
  let url; try { url = new URL(value); } catch { fail('CONTENT_ASSET_URL', 'Creative Studio did not return a valid asset URL.', 502); }
  const client = clientFor(workspace);
  const nativePath = kind === 'image' ? `/api/v2/image-file/${client}/${job}` : `/api/v2/video/${client}/${job}`;
  const native = url.origin === SOCIAL && url.pathname === nativePath;
  const archive = kind === 'reel' && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) && url.pathname === `/storage/v1/object/sign/matrix360-media-staging/${client}/${job}.mp4`;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || (url.searchParams.get('token') || '').length <= 12 || !(native || archive)) fail('CONTENT_ASSET_URL', 'Creative asset does not belong to the requested workspace and job.', 502);
  return url.href;
}

function createContentBridge({ store, service, handler = creativeMedia, fetchImpl = fetch }) {
  async function invoke(method, req, body) {
    let result;
    const response = { statusCode: 200, setHeader() {}, end(value) {
      if (typeof value !== 'string' || value.length > 100000) fail('CONTENT_RESPONSE', 'Creative Studio response is invalid.', 502);
      try { result = { code: this.statusCode, body: JSON.parse(value) }; } catch { fail('CONTENT_RESPONSE', 'Creative Studio response is invalid.', 502); }
    } };
    await handler({ method, headers: { authorization: req.headers?.authorization || '' }, ...(method === 'POST' ? { body } : { query: body }) }, response);
    if (!result) fail('CONTENT_RESPONSE', 'Creative Studio did not return a result.', 502);
    return result;
  }
  async function current(ctx, id) {
    if (!UUID.test(id || '')) fail('CONTENT_REQUEST_ID', 'A valid content request ID is required.');
    const record = await store.get(ctx.workspace, 'content_requests', id);
    if (!record) fail('NOT_FOUND', 'Content request was not found in this workspace.', 404);
    return record;
  }
  async function output(ctx, record) {
    const asset = record.asset_id ? await store.get(ctx.workspace, 'assets', record.asset_id) : null;
    return { request: record, ...(asset ? { asset } : {}) };
  }
  async function update(ctx, record, patch) {
    return store.put(ctx.workspace, 'content_requests', record.id, { ...record, ...patch, updated_at: new Date().toISOString() }, { expectedRevision: record.revision });
  }
  async function start(ctx, req, body) {
    if (!UUID.test(body.request_id || '') || !['image', 'reel'].includes(body.kind) || typeof body.prompt !== 'string' || body.prompt.trim().length < 12 || body.prompt.length > 900) fail('CONTENT_BRIEF', 'Choose an image or reel and a 12–900-character brief with a request ID.');
    let record = await store.get(ctx.workspace, 'content_requests', body.request_id);
    if (record) {
      if (record.kind !== body.kind || record.prompt !== body.prompt.trim()) fail('CONTENT_REQUEST_CONFLICT', 'This request ID already belongs to another creative brief.', 409);
      return output(ctx, record);
    }
    const stamp = new Date().toISOString();
    try {
      record = await store.put(ctx.workspace, 'content_requests', body.request_id, { id: body.request_id, kind: body.kind, prompt: body.prompt.trim(), status: 'starting', actor: ctx.actor, correlation_id: body.request_id, created_at: stamp, updated_at: stamp }, { expectedRevision: 0 });
    } catch (error) {
      if (error.code === 'REVISION_CONFLICT') return output(ctx, await current(ctx, body.request_id));
      throw error;
    }
    try {
      const result = await invoke('POST', req, { workspace_id: ctx.workspace, kind: record.kind, prompt: record.prompt, platform: 'LinkedIn', confirm: true });
      if (result.code === 202 && UUID.test(result.body.job_id || '') && result.body.workspace_id === ctx.workspace && result.body.kind === record.kind) {
        record = await update(ctx, record, { status: 'queued', job_id: result.body.job_id });
      } else {
        const knownFailure = result.body.job_started === false || result.code < 500 || ['not_configured', 'approval_required', 'provider_unavailable', 'provisioning_failed'].includes(result.body.status);
        record = await update(ctx, record, { status: knownFailure ? 'failed' : 'unknown', error: { code: 'CONTENT_START_FAILED', message: typeof result.body.message === 'string' ? result.body.message.slice(0, 300) : 'Creative Studio did not confirm a generation job.' } });
      }
    } catch {
      record = await update(ctx, record, { status: 'unknown', error: { code: 'CONTENT_START_UNKNOWN', message: 'Creative generation may have started. Check Content Studio before making a new request.' } });
    }
    return output(ctx, record);
  }
  async function download(url, kind) {
    let response; try { response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(120000) }); }
    catch { fail('CONTENT_DOWNLOAD', 'The generated asset could not be downloaded. Poll again to retry the import.', 503); }
    if (!response.ok || !response.body?.getReader) fail('CONTENT_DOWNLOAD', 'The generated asset is not available for import.', 503);
    const limit = (kind === 'reel' ? 200 : 20) * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); fail('CONTENT_TOO_LARGE', 'Generated media exceeds the LinkedIn workspace upload limit.', 413); }
    const parts = [], reader = response.body.getReader(); let length = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > limit) { await reader.cancel(); fail('CONTENT_TOO_LARGE', 'Generated media exceeds the LinkedIn workspace upload limit.', 413); }
        parts.push(Buffer.from(part.value));
      }
    } finally { reader.releaseLock(); }
    if (!length) fail('CONTENT_EMPTY', 'Creative Studio returned an empty media file.', 502);
    const mime = kind === 'reel' ? 'video/mp4' : response.headers.get('content-type')?.split(';')[0] === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    return { bytes: Buffer.concat(parts, length), mime };
  }
  async function poll(ctx, req, body) {
    let record = await current(ctx, body.request_id);
    if (record.status === 'completed' || ['failed', 'unknown', 'starting'].includes(record.status)) return output(ctx, record);
    if (record.upload_id) {
      const existing = await store.get(ctx.workspace, 'assets', record.upload_id);
      if (existing) return output(ctx, await update(ctx, record, { status: 'completed', asset_id: existing.id, import_until: null, error: null }));
    }
    if (record.status === 'importing' && Date.parse(record.import_until) > Date.now()) return output(ctx, record);
    if (!UUID.test(record.job_id || '')) fail('CONTENT_JOB', 'This request has no confirmed Creative Studio job.', 409);
    const result = await invoke('GET', req, { workspace_id: ctx.workspace, kind: record.kind, job_id: record.job_id });
    if (result.code !== 200) fail('CONTENT_POLL', typeof result.body.message === 'string' ? result.body.message.slice(0, 300) : 'Creative Studio status is unavailable.', result.code >= 400 && result.code <= 599 ? result.code : 503);
    if (result.body.workspace_id !== ctx.workspace || result.body.job_id !== record.job_id || result.body.kind !== record.kind) fail('CONTENT_TENANT', 'Creative Studio returned a different workspace or job.', 502);
    if (!['queued', 'processing', 'completed', 'failed'].includes(result.body.status)) fail('CONTENT_STATUS', 'Creative Studio returned an unknown job status.', 502);
    if (result.body.status !== 'completed') return output(ctx, await update(ctx, record, { status: result.body.status, error: result.body.error ? { code: 'CONTENT_GENERATION_FAILED', message: String(result.body.error).slice(0, 300) } : null }));
    const url = trustedAsset(result.body.asset_url, ctx.workspace, record.kind, record.job_id);
    try { record = await update(ctx, record, { status: 'importing', import_until: new Date(Date.now() + 5 * 60000).toISOString(), import_token: randomUUID() }); }
    catch (error) { if (error.code === 'REVISION_CONFLICT') return output(ctx, await current(ctx, record.id)); throw error; }
    try {
      const { bytes, mime } = await download(url, record.kind);
      let uploadId = record.upload_id;
      if (uploadId) {
        const upload = await store.get(ctx.workspace, 'uploads', uploadId);
        if (!upload || Date.parse(upload.expires_at) <= Date.now()) uploadId = null;
      }
      if (!uploadId) {
        const upload = await service.handle('upload-start', ctx, { filename: `linkedin-${record.job_id}.${record.kind === 'reel' ? 'mp4' : mime === 'image/jpeg' ? 'jpg' : 'png'}`, mime, size: bytes.length });
        uploadId = upload.upload_id;
        record = await update(ctx, record, { upload_id: uploadId });
      }
      const chunkSize = 1024 * 1024;
      for (let index = 0; index < Math.ceil(bytes.length / chunkSize); index++) await service.handle('upload-chunk', ctx, { upload_id: uploadId, index, base64: bytes.subarray(index * chunkSize, (index + 1) * chunkSize).toString('base64') });
      const completed = await service.handle('upload-complete', ctx, { upload_id: uploadId });
      if (!completed.asset?.id) fail('CONTENT_IMPORT', 'Generated asset import was not confirmed.', 502);
      record = await update(ctx, record, { status: 'completed', asset_id: completed.asset.id, import_until: null, error: null });
    } catch (error) {
      const latest = await current(ctx, record.id);
      if (latest.import_token === record.import_token) record = await update(ctx, latest, { status: 'processing', import_until: null, error: { code: error.code || 'CONTENT_IMPORT', message: 'Generated media was not imported. Poll again to retry importing the same job.' } });
      else record = latest;
    }
    return output(ctx, record);
  }
  return { start, poll };
}
module.exports = { createContentBridge };
