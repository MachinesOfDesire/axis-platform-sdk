import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwitchAuthorizer } from '../src/authorizer.js';

const AUD = 'comments.mysite.com';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fakeAit({ aud = AUD } = {}) {
  return `${b64url({ typ: 'AIT', alg: 'EdDSA' })}.${b64url({ aud, iss: 'axis:op:agent', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}
function stub(routes) {
  return async (url) => {
    for (const [m, body] of routes) {
      if (String(url).includes(m)) {
        const status = body.__status || 200;
        return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body), json: async () => body };
      }
    }
    return { status: 404, ok: false, text: async () => '{}', json: async () => ({}) };
  };
}

const okVerify = ['/verify', { valid: true, agent_id: 'axis:op:agent', operator_id: 'axis:op:operator', delegation_valid: true, effective_scope: ['comments:write'] }];

test('disabled gate => gate_closed (no registry call)', async () => {
  let called = false;
  const auth = new SwitchAuthorizer({ audience: AUD, gates: { 'comments:write': { enabled: false } } });
  const v = await auth.authorize(fakeAit(), 'comments:write', { fetchImpl: async () => { called = true; return {}; } });
  assert.equal(v.accepted, false);
  assert.equal(v.code, 'gate_closed');
  assert.equal(called, false);
});

test('unknown gate, closed posture => gate_unknown', async () => {
  const auth = new SwitchAuthorizer({ audience: AUD, defaultAllow: false, gates: {} });
  const v = await auth.authorize(fakeAit(), 'nope:nope', {});
  assert.equal(v.accepted, false);
  assert.equal(v.code, 'gate_unknown');
});

test('enabled gate + valid AIT + sufficient scope => accepted', async () => {
  const auth = new SwitchAuthorizer({ audience: AUD, gates: { 'comments:write': { enabled: true, requireScopes: ['comments:write'] } } });
  const v = await auth.authorize(fakeAit(), 'comments:write', { fetchImpl: stub([okVerify]) });
  assert.equal(v.accepted, true);
  assert.equal(v.agent_id, 'axis:op:agent');
});

test('gate minTier propagates to a tier denial', async () => {
  const auth = new SwitchAuthorizer({ audience: AUD, gates: { 'comments:write': { enabled: true, minTier: 'verified' } } });
  const v = await auth.authorize(fakeAit(), 'comments:write', {
    fetchImpl: stub([
      ['/verify', { valid: true, agent_id: 'axis:op:agent', operator_id: 'o' }],
      ['/agents/', { agent_id: 'axis:op:agent', operator_verification_tier: 'domain' }],
    ]),
  });
  assert.equal(v.accepted, false);
  assert.equal(v.code, 'insufficient_tier');
});

test('global blockedOperators applies across gates', async () => {
  const auth = new SwitchAuthorizer({ audience: AUD, blockedOperators: ['axis:bad:operator'], gates: { 'comments:write': { enabled: true } } });
  const v = await auth.authorize(fakeAit(), 'comments:write', {
    fetchImpl: stub([['/verify', { valid: true, agent_id: 'a', operator_id: 'axis:bad:operator' }]]),
  });
  assert.equal(v.accepted, false);
  assert.equal(v.code, 'operator_blocked');
});
