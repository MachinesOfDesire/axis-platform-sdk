import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAgent } from '../src/verify.js';

const AUD = 'comments.mysite.com';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fakeAit({ aud = AUD } = {}) {
  const header = b64url({ typ: 'AIT', alg: 'EdDSA' });
  const payload = b64url({ aud, iss: 'axis:op:agent', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${header}.${payload}.signature`;
}

// Stub fetch that routes by URL substring. Each route returns a Response-like.
function stub(routes) {
  return async (url) => {
    for (const [match, body] of routes) {
      if (String(url).includes(match)) {
        const status = body.__status || 200;
        return {
          status,
          ok: status >= 200 && status < 300,
          text: async () => JSON.stringify(body),
          json: async () => body,
        };
      }
    }
    return { status: 404, ok: false, text: async () => '{}', json: async () => ({}) };
  };
}

test('accepts a valid AIT: matching audience + sufficient delegated scope', async () => {
  const verdict = await verifyAgent(fakeAit(), {
    audience: AUD,
    requireScopes: ['comments:write'],
    fetchImpl: stub([
      ['/verify', { valid: true, agent_id: 'axis:op:agent', operator_id: 'axis:op:operator', delegation_valid: true, effective_scope: ['comments:write'], expires_at: null }],
    ]),
  });
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.agent_id, 'axis:op:agent');
  assert.deepEqual(verdict.effective_scope, ['comments:write']);
});

test('rejects audience mismatch locally, without calling the registry', async () => {
  let called = false;
  const verdict = await verifyAgent(fakeAit({ aud: 'other.example' }), {
    audience: AUD,
    fetchImpl: async () => {
      called = true;
      return { status: 200, text: async () => '{}' };
    },
  });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'audience_mismatch');
  assert.equal(called, false);
});

test('rejects a revoked agent (registry valid:false)', async () => {
  const verdict = await verifyAgent(fakeAit(), {
    audience: AUD,
    fetchImpl: stub([
      ['/verify', { valid: false, code: 'agent_revoked', agent_id: 'axis:op:agent', reason: 'Agent status: revoked' }],
    ]),
  });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'agent_revoked');
});

test('denies when a required scope is missing from effective_scope', async () => {
  const verdict = await verifyAgent(fakeAit(), {
    audience: AUD,
    requireScopes: ['comments:write', 'admin:users'],
    fetchImpl: stub([
      ['/verify', { valid: true, agent_id: 'a', operator_id: 'o', delegation_valid: true, effective_scope: ['comments:write'] }],
    ]),
  });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'insufficient_scope');
  assert.deepEqual(verdict.missing, ['admin:users']);
});

test('denies required scope when there is no valid delegation', async () => {
  const verdict = await verifyAgent(fakeAit(), {
    audience: AUD,
    requireScopes: ['comments:write'],
    fetchImpl: stub([['/verify', { valid: true, agent_id: 'a', operator_id: 'o', delegation_valid: false }]]),
  });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'insufficient_scope');
});

test('blocks a blocked operator', async () => {
  const verdict = await verifyAgent(fakeAit(), {
    audience: AUD,
    blockedOperators: ['axis:bad:operator'],
    fetchImpl: stub([['/verify', { valid: true, agent_id: 'a', operator_id: 'axis:bad:operator' }]]),
  });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'operator_blocked');
});

test('enforces minTier via the presentation-layer fetch', async () => {
  const verdict = await verifyAgent(fakeAit(), {
    audience: AUD,
    minTier: 'verified',
    fetchImpl: stub([
      ['/verify', { valid: true, agent_id: 'axis:op:agent', operator_id: 'o' }],
      ['/agents/', { agent_id: 'axis:op:agent', operator_verification_tier: 'domain' }],
    ]),
  });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'insufficient_tier');
  assert.equal(verdict.tier, 'domain');
});

test('no token => no_token', async () => {
  const verdict = await verifyAgent(null, { audience: AUD });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'no_token');
});
