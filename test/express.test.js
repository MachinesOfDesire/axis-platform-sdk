import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisGate, extractToken } from '../src/express.js';

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
const okVerify = ['/verify', { valid: true, agent_id: 'axis:op:agent', operator_id: 'axis:op:operator', delegation_valid: true, effective_scope: ['content:comment'] }];

function mockReq({ headers = {}, query = {} } = {}) {
  return { headers, query };
}
function mockRes() {
  const r = { statusCode: 200, body: null, _status: null };
  r.status = (c) => { r._status = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

test('no token -> 401 no_token, next not called, req.axis set', async () => {
  const req = mockReq(); const res = mockRes(); let nexted = false;
  await axisGate({ audience: AUD, requireScopes: ['content:comment'] })(req, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res._status, 401);
  assert.equal(res.body.error, 'no_token');
  assert.equal(req.axis.accepted, false);
});

test('valid AIT + sufficient scope -> next called, req.axis verified', async () => {
  const req = mockReq({ headers: { authorization: `Bearer ${fakeAit()}` } }); const res = mockRes(); let nexted = false;
  await axisGate({ audience: AUD, requireScopes: ['content:comment'], fetchImpl: stub([okVerify]) })(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.axis.accepted, true);
  assert.equal(req.axis.agent_id, 'axis:op:agent');
});

test('insufficient scope -> 403, next not called', async () => {
  const noScope = ['/verify', { valid: true, agent_id: 'a', operator_id: 'o', delegation_valid: true, effective_scope: [] }];
  const req = mockReq({ headers: { authorization: `Bearer ${fakeAit()}` } }); const res = mockRes(); let nexted = false;
  await axisGate({ audience: AUD, requireScopes: ['content:comment'], fetchImpl: stub([noScope]) })(req, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res._status, 403);
  assert.equal(req.axis.code, 'insufficient_scope');
});

test('audience mismatch -> 403 (token addressed elsewhere)', async () => {
  const req = mockReq({ headers: { authorization: `Bearer ${fakeAit({ aud: 'someone.else' })}` } }); const res = mockRes(); let nexted = false;
  await axisGate({ audience: AUD, fetchImpl: stub([okVerify]) })(req, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res._status, 403);
  assert.equal(req.axis.code, 'audience_mismatch');
});

test('bare Node response (no res.json) still gets a JSON denial', async () => {
  const req = mockReq();
  let ended = null; let statusCode = 200;
  const res = { set statusCode(v) { statusCode = v; }, get statusCode() { return statusCode; }, setHeader() {}, end: (s) => { ended = s; } };
  await axisGate({ audience: AUD })(req, res, () => {});
  assert.equal(statusCode, 401);
  assert.equal(JSON.parse(ended).error, 'no_token');
});

test('extractToken: Bearer, X-AXIS-Token, ?ait, none', () => {
  assert.equal(extractToken({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(extractToken({ headers: { 'x-axis-token': 'xyz' } }), 'xyz');
  assert.equal(extractToken({ headers: {}, query: { ait: 'qqq' } }), 'qqq');
  assert.equal(extractToken({ headers: {} }), null);
});
