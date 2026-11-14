'use strict';

const API = 'https://api.linkedin.com';
const OAUTH = 'https://www.linkedin.com/oauth/v2';
const AUTHOR = /^urn:li:(person|organization):[A-Za-z0-9_-]+$/;
const POST = /^urn:li:(share|ugcPost):[0-9]+$/;
const MEDIA = /^urn:li:(image|video|document):[A-Za-z0-9_-]+$/;
const scopesOf = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[\s,]+/)).filter(Boolean))];

class ProviderError extends Error {
  constructor(code, message, { status = 0, retryAfter = 0, uncertain = false, retryable = false } = {}) {
    super(message); Object.assign(this, { name: 'ProviderError', code, status, retryAfter, uncertain, retryable });
  }
}
function assert(value, code, message) { if (!value) throw new ProviderError(code, message); }
function retrySeconds(value) {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000)) || 0;
}
function capabilities(author, scopes) {
  const member = author.startsWith('urn:li:person:');
  const has = scope => scopes.includes(scope);
  return { publish: has(member ? 'w_member_social' : 'w_organization_social'),
    read: has(member ? 'r_member_social' : 'r_organization_social'),
    analytics: has(member ? 'r_member_postAnalytics' : 'rw_organization_admin'),
    comments: has(member ? 'w_member_social' : 'w_organization_social'),
    leadSync: has('r_marketing_leadgen_automation'), ads: has('rw_ads') };
}

function createProvider(config = {}, fetchImpl = globalThis.fetch) {
  const clientId = config.clientId || process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = config.redirectUri || process.env.LINKEDIN_REDIRECT_URI;
  const version = config.apiVersion || process.env.LINKEDIN_API_VERSION || '202610';
  const requestedScopes = scopesOf(config.scopes || process.env.LINKEDIN_SCOPES || 'openid profile w_member_social');
  assert(/^20\d{2}(0[1-9]|1[0-2])$/.test(version), 'CONFIGURATION', 'LinkedIn API version must use YYYYMM.');
  const headers = token => ({ Authorization: `Bearer ${token}`, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' });

  async function request(url, options = {}, publishing = false) {
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(60000) }); }
    catch { throw new ProviderError('LINKEDIN_CONNECTION', publishing ? 'Publication outcome is unknown; reconcile before retrying.' : 'LinkedIn request did not complete.', { uncertain: publishing, retryable: !publishing }); }
    if (!response.ok) {
      // Provider bodies can echo credentials or customer content; expose only status.
      throw new ProviderError(`LINKEDIN_HTTP_${response.status}`, `LinkedIn returned HTTP ${response.status}.`, {
        status: response.status, retryAfter: retrySeconds(response.headers.get('retry-after')),
        uncertain: publishing && response.status >= 500,
        retryable: response.status === 429 || (!publishing && response.status >= 500)
      });
    }
    return response;
  }
  async function json(url, options = {}) {
    const response = await request(url, options);
    try { return await response.json(); }
    catch { throw new ProviderError('LINKEDIN_RESPONSE', 'LinkedIn returned an invalid JSON response.'); }
  }
  const get = (token, path) => json(`${API}/rest/${path}`, { headers: headers(token) });
  const post = (token, path, body) => json(`${API}/rest/${path}`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
  const form = (path, values) => json(`${OAUTH}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString() });
  function configuration() {
    assert(clientId && clientSecret && redirectUri, 'CONFIGURATION', 'LinkedIn application credentials and callback URL are required.');
    let url; try { url = new URL(redirectUri); } catch { /* validated below */ }
    assert(url && !url.username && !url.password && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))), 'CONFIGURATION', 'LinkedIn callback must be HTTPS or localhost.');
  }
  async function introspect(token) {
    configuration();
    const data = await form('introspectToken', { client_id: clientId, client_secret: clientSecret, token });
    assert(data.active === true && (!data.client_id || data.client_id === clientId), 'GRANT_INACTIVE', 'LinkedIn authorization expired or was revoked.');
    return { ...data, scopes: scopesOf(data.scope) };
  }
  async function normalizedTokens(data) {
    assert(typeof data.access_token === 'string' && data.access_token && Number(data.expires_in) > 0, 'OAUTH_TOKEN', 'LinkedIn did not return a usable access token.');
    const verified = data.scope ? null : await introspect(data.access_token);
    const scopes = scopesOf(data.scope || verified?.scopes);
    assert(scopes.length, 'OAUTH_SCOPES', 'LinkedIn did not confirm the granted permissions.');
    return { access_token: data.access_token, refresh_token: data.refresh_token || null, scopes,
      expires_at: new Date(Date.now() + Number(data.expires_in) * 1000).toISOString(),
      refresh_expires_at: data.refresh_token && Number(data.refresh_token_expires_in) > 0 ? new Date(Date.now() + Number(data.refresh_token_expires_in) * 1000).toISOString() : null };
  }
  async function exchangeCode(code) {
    configuration(); assert(typeof code === 'string' && code.length > 0, 'OAUTH_CODE', 'LinkedIn authorization code is required.');
    return normalizedTokens(await form('accessToken', { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }));
  }
  async function refreshToken(token) {
    configuration(); assert(typeof token === 'string' && token.length > 0, 'REFRESH_TOKEN', 'A provider-issued refresh token is required.');
    const data = await form('accessToken', { grant_type: 'refresh_token', refresh_token: token, client_id: clientId, client_secret: clientSecret });
    return normalizedTokens({ ...data, refresh_token: data.refresh_token || token });
  }
  async function identity(token) {
    const data = await json(`${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
    assert(typeof data.sub === 'string' && /^[A-Za-z0-9_-]+$/.test(data.sub), 'MEMBER_ID', 'LinkedIn did not identify the connected member.');
    return { id: data.sub, urn: `urn:li:person:${data.sub}`, name: data.name || [data.given_name, data.family_name].filter(Boolean).join(' ') || data.sub, picture: data.picture || null };
  }
  async function organizationAuthority(token, member, organization) {
    const path = `organizationAuthorizations/(impersonator:${encodeURIComponent(member)},organization:${encodeURIComponent(organization)},action:(organizationContentAuthorizationAction:(actionType:ORGANIC_SHARE_CREATE)))`;
    const data = await get(token, path);
    assert(data.status && Object.hasOwn(data.status, 'com.linkedin.organization.Approved'), 'PAGE_AUTHORITY', 'The connected member cannot publish organic posts to this Page.');
  }
  async function checkAuthority(token, destination) {
    const author = typeof destination === 'string' ? destination : destination?.urn;
    assert(AUTHOR.test(author), 'AUTHOR', 'Select a valid LinkedIn member or Page.');
    const grant = await introspect(token);
    assert(capabilities(author, grant.scopes).publish, 'PUBLISH_SCOPE', 'This connection has not granted publishing permission for the selected author.');
    const member = await identity(token);
    if (author.startsWith('urn:li:person:')) assert(author === member.urn, 'AUTHOR', 'The selected author does not match this connection.');
    else await organizationAuthority(token, member.urn, author);
    return true;
  }
  async function destinations(token, scopes) {
    scopes = scopesOf(scopes);
    const member = await identity(token);
    const items = [{ urn: member.urn, type: 'member', name: member.name, capabilities: capabilities(member.urn, scopes), authority_checked_at: new Date().toISOString() }];
    if (!scopes.includes('w_organization_social') || !scopes.includes('rw_organization_admin')) return items;
    let start = 0;
    while (true) {
      const page = await get(token, `organizationAcls?q=roleAssignee&state=APPROVED&start=${start}&count=100`);
      assert(Array.isArray(page.elements), 'PAGE_DISCOVERY', 'LinkedIn did not return a valid Page list.');
      for (const acl of page.elements) {
        const urn = acl.organization;
        if (!AUTHOR.test(urn) || !urn.startsWith('urn:li:organization:') || items.some(item => item.urn === urn)) continue;
        try { await organizationAuthority(token, member.urn, urn); }
        catch (error) { if (error.code === 'PAGE_AUTHORITY' || error.status === 403) continue; throw error; }
        let name = urn;
        try { const org = await get(token, `organizations/${encodeURIComponent(urn.split(':').pop())}`); name = org.localizedName || urn; }
        catch (error) { if (error.status !== 403 && error.status !== 404) throw error; }
        items.push({ urn, type: 'organization', name, capabilities: capabilities(urn, scopes), authority_checked_at: new Date().toISOString() });
      }
      if (!page.paging?.links?.some(link => link.rel === 'next')) break;
      assert(page.elements.length > 0 && start < 10000, 'PAGE_DISCOVERY', 'LinkedIn Page pagination could not complete.');
      start += Number(page.paging.count) || 100;
    }
    return items;
  }
  function uploadUrl(value) {
    let url; try { url = new URL(value); } catch { /* validated below */ }
    assert(url && url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com') || url.hostname === 'licdn.com' || url.hostname.endsWith('.licdn.com')), 'UPLOAD_URL', 'LinkedIn returned an unsupported upload destination.');
    return url;
  }
  async function upload(token, urlValue, bytes, mime) {
    const url = uploadUrl(urlValue);
    const uploadHeaders = { 'Content-Type': mime };
    if (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')) uploadHeaders.Authorization = `Bearer ${token}`;
    return request(url.href, { method: 'PUT', headers: uploadHeaders, body: bytes });
  }
  async function mediaStatus(token, media) {
    assert(MEDIA.test(media?.id), 'MEDIA_ID', 'LinkedIn media identifier is invalid.');
    const kind = media.id.split(':')[2];
    try {
      const data = await get(token, `${kind}s/${encodeURIComponent(media.id)}`);
      return { ...media, status: data.status || 'UNKNOWN', owner: data.owner || null };
    } catch (error) {
      if (error.status === 403) return { ...media, status: 'STATUS_UNAVAILABLE', reason: 'The grant cannot read this media processing status.' };
      throw error;
    }
  }
  async function uploadMedia(token, author, { kind, bytes, mime, title = '' }) {
    assert(AUTHOR.test(author), 'AUTHOR', 'Select a valid author.');
    assert(Buffer.isBuffer(bytes) && bytes.length > 0, 'MEDIA_BYTES', 'A nonempty saved media file is required.');
    const allowed = { image: ['image/jpeg', 'image/png', 'image/gif'], video: ['video/mp4'], document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'] };
    assert(allowed[kind]?.includes(mime), 'MEDIA_FORMAT', 'This file format is not supported for LinkedIn publishing.');
    if (kind === 'video') assert(bytes.length >= 75000 && bytes.length <= 500000000, 'MEDIA_SIZE', 'LinkedIn MP4 videos must be between 75 KB and 500 MB.');
    if (kind === 'document') assert(bytes.length <= 100 * 1024 * 1024, 'MEDIA_SIZE', 'LinkedIn documents must not exceed 100 MB.');
    const body = { initializeUploadRequest: { owner: author } };
    if (kind === 'video') Object.assign(body.initializeUploadRequest, { fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false });
    const result = await post(token, `${kind}s?action=initializeUpload`, body);
    const value = result.value;
    const id = value?.[kind];
    assert(MEDIA.test(id) && id.split(':')[2] === kind, 'MEDIA_ID', 'LinkedIn did not return a valid media identifier.');
    if (kind === 'video') {
      assert(Array.isArray(value.uploadInstructions) && value.uploadInstructions.length, 'VIDEO_PARTS', 'LinkedIn did not provide video upload instructions.');
      const ids = []; let position = 0;
      for (const part of value.uploadInstructions) {
        assert(Number.isInteger(part.firstByte) && Number.isInteger(part.lastByte) && part.firstByte === position && part.lastByte >= position && part.lastByte < bytes.length, 'VIDEO_PARTS', 'LinkedIn video upload byte ranges are invalid.');
        const response = await upload(token, part.uploadUrl, bytes.subarray(part.firstByte, part.lastByte + 1), mime);
        const etag = response.headers.get('etag')?.replace(/^"|"$/g, '');
        assert(etag, 'VIDEO_ETAG', 'LinkedIn did not acknowledge a video part.');
        ids.push(etag); position = part.lastByte + 1;
      }
      assert(position === bytes.length, 'VIDEO_PARTS', 'LinkedIn video instructions did not cover the complete file.');
      await request(`${API}/rest/videos?action=finalizeUpload`, { method: 'POST', headers: headers(token), body: JSON.stringify({ finalizeUploadRequest: { video: id, uploadToken: value.uploadToken || '', uploadedPartIds: ids } }) });
    } else await upload(token, value.uploadUrl, bytes, mime);
    return mediaStatus(token, { id, kind, title, status: 'UPLOADED' });
  }
  async function publish(token, { author, text, media, link }) {
    assert(AUTHOR.test(author), 'AUTHOR', 'Select a valid author.');
    assert(typeof text === 'string' && text.trim() && [...text].length <= 3000, 'POST_TEXT', 'LinkedIn posts require text of at most 3,000 characters.');
    assert(!(media && link), 'POST_CONTENT', 'Choose a media attachment or a link attachment.');
    const body = { author, commentary: text, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false };
    if (media) {
      assert(MEDIA.test(media.id), 'MEDIA_ID', 'LinkedIn media identifier is invalid.');
      assert(media.status === 'AVAILABLE' || media.status === 'STATUS_UNAVAILABLE', 'MEDIA_PROCESSING', 'LinkedIn media is still processing.');
      body.content = { media: { id: media.id, title: media.title || '' } };
    }
    if (link) {
      let url; try { url = new URL(typeof link === 'string' ? link : link.url); } catch { /* validated below */ }
      assert(url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'POST_LINK', 'Enter a valid public web link.');
      body.content = { article: { source: url.href, ...(link.title ? { title: link.title } : {}), ...(link.description ? { description: link.description } : {}) } };
    }
    const response = await request(`${API}/rest/posts`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) }, true);
    const id = response.headers.get('x-restli-id');
    if (!POST.test(id)) throw new ProviderError('POST_ACK_UNKNOWN', 'LinkedIn did not return a post identifier; reconcile before retrying.', { uncertain: true });
    return { id, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`, accepted: true };
  }
  async function readPost(token, id) {
    assert(POST.test(id), 'POST_ID', 'LinkedIn post identifier is invalid.');
    return get(token, `posts/${encodeURIComponent(id)}?viewContext=AUTHOR`);
  }
  async function metrics(token, { author, id, scopes }) {
    assert(AUTHOR.test(author) && POST.test(id), 'POST_ID', 'A valid author and LinkedIn post identifier are required.');
    scopes = scopesOf(scopes);
    if (!capabilities(author, scopes).analytics) return { available: false, metrics: null, retrieved_at: null, reason: 'Analytics permission has not been granted.' };
    try {
      if (author.startsWith('urn:li:organization:')) {
        const field = id.startsWith('urn:li:ugcPost:') ? 'ugcPosts' : 'shares';
        const data = await get(token, `organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(author)}&${field}=List(${encodeURIComponent(id)})`);
        const row = data.elements?.find(element => (element.share || element.ugcPost) === id);
        return { available: Boolean(row?.totalShareStatistics), metrics: row?.totalShareStatistics || null, retrieved_at: new Date().toISOString(), reason: row ? null : 'LinkedIn has not returned statistics for this post.' };
      }
      const values = {};
      const entityType = id.startsWith('urn:li:ugcPost:') ? 'ugc' : 'share';
      for (const metric of ['IMPRESSION', 'MEMBERS_REACHED', 'REACTION', 'COMMENT', 'RESHARE']) {
        const data = await get(token, `memberCreatorPostAnalytics?q=entity&entity=(${entityType}:${encodeURIComponent(id)})&queryType=${metric}&aggregation=TOTAL`);
        const count = data.elements?.[0]?.count;
        values[metric] = typeof count === 'number' && Number.isFinite(count) ? count : null;
      }
      return { available: Object.values(values).some(value => value !== null), metrics: values, retrieved_at: new Date().toISOString() };
    } catch (error) {
      if (error.status === 403) return { available: false, metrics: null, retrieved_at: new Date().toISOString(), reason: 'LinkedIn denied analytics access for this destination.' };
      throw error;
    }
  }
  return { authorizationUrl(state) { configuration(); assert(typeof state === 'string' && state.length >= 32, 'OAUTH_STATE', 'A one-time OAuth state is required.'); return `${OAUTH}/authorization?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope: requestedScopes.join(' ') })}`; },
    exchangeCode, refreshToken, introspect, identity, destinations, checkAuthority, uploadMedia, mediaStatus, publish, readPost, metrics };
}

module.exports = { createProvider, ProviderError, capabilities };
