'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/m360-linkedin-store');
const { createService } = require('../lib/m360-linkedin-service');

const ctx = { workspace: 'tenant-a', actor: 'actor-a', role: 'client_admin', membership: { name: 'Acme Commercial Properties' } };

function fixture(t, overrides = {}) {
  const store = createStore({ path: ':memory:', backend: 'sqlite', env: {} });
  t.after(() => store.close());
  const calls = [];
  const env = {
    LINKEDIN_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    LINKEDIN_SAFETY_GUARDRAILS: 'true',
    OPENAI_API_KEY: 'test-server-key',
    M360_OPENAI_SPEND_APPROVED: 'yes',
    ...overrides.env
  };
  const provider = {
    authorizationUrl: state => 'https://www.linkedin.com/oauth/v2/authorization?state=' + state,
    exchangeCode: async () => ({ access_token: 'FAKE_PROVIDER_TOKEN', scopes: ['w_member_social'], expires_at: new Date(Date.now() + 3600000).toISOString() }),
    identity: async () => ({ urn: 'urn:li:person:fixture', name: 'Fixture Member' }),
    destinations: async () => [{ urn: 'urn:li:person:fixture', name: 'Fixture Member', capabilities: { publish: true } }],
    ...overrides.provider
  };
  const fetchImpl = overrides.fetchImpl || (async () => { throw Error('Unexpected network call'); });
  const profile = overrides.profile || (async () => null); // Default: no saved Supabase brand profile
  const service = createService({ store, provider, env, fetchImpl, profile, now: () => 1731564000000 });
  return { store, service, provider, env, calls };
}

test('prepare uses request-level api_key when server environment key is missing', async t => {
  let requestPayload;
  const f = fixture(t, {
    env: { OPENAI_API_KEY: '', M360_OPENAI_SPEND_APPROVED: 'false' },
    fetchImpl: async (url, opts) => {
      requestPayload = JSON.parse(opts.body);
      assert.equal(opts.headers.Authorization, 'Bearer sk-request-level-key-12345');
      return {
        ok: true,
        json: async () => ({
          model: 'gpt-4.1-mini',
          choices: [{
            message: {
              content: JSON.stringify({
                text: 'Acme Commercial Properties offers verified grade-A logistics warehousing.',
                concepts: [{ title: 'Logistics Focus', summary: 'Operational warehousing', text: 'Verified logistics space available.' }],
                missing_information: []
              })
            }
          }]
        })
      };
    }
  });

  const res = await f.service.handle('prepare', ctx, {
    objective: 'Announce logistics facilities availability',
    api_key: 'sk-request-level-key-12345'
  });

  assert.equal(res.source, 'live_ai');
  assert.ok(res.text.includes('Acme Commercial Properties'));
  assert.equal(res.concepts.length, 1);
});

test('prepare grounds to membership company name when Supabase profile is absent without failing 409', async t => {
  let sentPrompt;
  const f = fixture(t, {
    profile: async () => null, // Empty database
    fetchImpl: async (url, opts) => {
      sentPrompt = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          model: 'gpt-4.1-mini',
          choices: [{
            message: {
              content: JSON.stringify({
                text: 'Acme Commercial Properties provides verified enterprise workspace solutions.',
                concepts: [],
                missing_information: []
              })
            }
          }]
        })
      };
    }
  });

  const res = await f.service.handle('prepare', ctx, {
    objective: 'Promote commercial properties'
  });

  const userMsg = JSON.parse(sentPrompt.messages[1].content);
  assert.equal(userMsg.brand.business_name, 'Acme Commercial Properties');
  assert.ok(sentPrompt.messages[0].content.includes('sober industrial authority'));
  assert.ok(sentPrompt.messages[0].content.includes('sycophantic flattery'));
  assert.equal(res.source, 'live_ai');
});

test('prepare parses OpenAI 401 error and fails with AI_KEY_REJECTED and detail', async t => {
  const f = fixture(t, {
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          message: 'Your API key has expired. Create a new API key to continue.',
          type: 'invalid_request_error',
          code: 'expired_secret_key'
        }
      })
    })
  });

  await assert.rejects(
    f.service.handle('prepare', ctx, { objective: 'Test objective' }),
    err => {
      assert.equal(err.code, 'AI_KEY_REJECTED');
      assert.equal(err.status, 401);
      assert.ok(err.message.includes('Your API key has expired'));
      return true;
    }
  );
});

test('prepare handles revision_request with existing draft text and sober grounding', async t => {
  let sentPrompt;
  const f = fixture(t, {
    fetchImpl: async (url, opts) => {
      sentPrompt = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          model: 'gpt-4.1-mini',
          choices: [{
            message: {
              content: JSON.stringify({
                text: 'Acme Commercial Properties announces 50,000 sq ft industrial facility in Pune.',
                concepts: [],
                missing_information: []
              })
            }
          }]
        })
      };
    }
  });

  const res = await f.service.handle('prepare', ctx, {
    text: 'Long draft text needing conciseness',
    revision_request: 'Make the headline focus on Pune facility'
  });

  const userMsg = JSON.parse(sentPrompt.messages[1].content);
  assert.equal(userMsg.current_text, 'Long draft text needing conciseness');
  assert.equal(userMsg.revision_request, 'Make the headline focus on Pune facility');
  assert.ok(res.text.includes('Pune'));
});

test('configure-ai validates key, tests with provider, and updates active configuration', async t => {
  let providerVerified = false;
  const f = fixture(t, {
    fetchImpl: async (url, opts) => {
      if (url === 'https://api.openai.com/v1/models') {
        assert.equal(opts.headers.Authorization, 'Bearer sk-valid-new-key-1234567890');
        providerVerified = true;
        return { ok: true, json: async () => ({ data: [] }) };
      }
      throw Error('Unexpected url');
    }
  });

  const res = await f.service.handle('configure-ai', ctx, {
    api_key: 'sk-valid-new-key-1234567890'
  });

  assert.equal(res.verified, true);
  assert.equal(res.configured, true);
  assert.equal(providerVerified, true);
  assert.equal(f.env.OPENAI_API_KEY, 'sk-valid-new-key-1234567890');
  assert.equal(f.env.M360_OPENAI_SPEND_APPROVED, 'yes');
});
