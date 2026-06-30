import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessLedger, MemoryLedgerStore, loggedGate, recordEntry } from '../src/ledger.js';

test('records an accepted arrival (Door-compatible shape)', async () => {
  const ledger = new AccessLedger();
  await ledger.record(
    {
      accepted: true,
      agent_id: 'axis:acme:bot',
      operator_id: 'axis:acme:op',
      effective_scope: ['comments:write'],
      tier: 'domain',
      delegation_valid: true,
    },
    { audience: 'comments.mysite.com', gate_id: 'comments:write' }
  );
  const rows = await ledger.recent();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent_id, 'axis:acme:bot');
  assert.equal(rows[0].decision, 'auto_allow'); // Door vocabulary, not 'accepted'
  assert.equal(rows[0].audience, 'comments.mysite.com');
  assert.deepEqual(rows[0].effective_scope, ['comments:write']);
  // Fields carried through from the verdict, matching the cloud-hosted version's arrivals columns:
  assert.equal(rows[0].tier, 'domain');
  assert.equal(rows[0].delegation_valid, true);
  assert.equal(rows[0].gate_id, 'comments:write');
  assert.equal(typeof rows[0].created_at, 'number'); // epoch ms, not an ISO string
});

test('decision override carries a manual-review state', () => {
  const e = recordEntry(
    { accepted: true, agent_id: 'a', operator_id: 'o' },
    { decision: 'held', requested_action: 'post a comment' }
  );
  assert.equal(e.decision, 'held');
  assert.equal(e.requested_action, 'post a comment');
});

test('records a denied arrival with a reason', async () => {
  const ledger = new AccessLedger();
  await ledger.record({ accepted: false, code: 'insufficient_scope', reason: 'Missing scope', agent_id: 'a', operator_id: 'o' });
  const rows = await ledger.recent();
  assert.equal(rows[0].decision, 'denied');
  assert.equal(rows[0].reason, 'Missing scope');
});

test('recent returns newest first and respects limit', async () => {
  const ledger = new AccessLedger();
  for (let i = 0; i < 5; i++) {
    await ledger.record({ accepted: true, agent_id: 'a' + i, operator_id: 'o' });
  }
  const rows = await ledger.recent({ limit: 2 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].agent_id, 'a4'); // newest first
  assert.equal(rows[1].agent_id, 'a3');
});

test('byOperator filters', async () => {
  const ledger = new AccessLedger();
  await ledger.record({ accepted: true, agent_id: 'a1', operator_id: 'op-x' });
  await ledger.record({ accepted: true, agent_id: 'a2', operator_id: 'op-y' });
  await ledger.record({ accepted: true, agent_id: 'a3', operator_id: 'op-x' });
  const rows = await ledger.byOperator('op-x');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.agent_id), ['a3', 'a1']);
});

test('MemoryLedgerStore bounds at max', async () => {
  const store = new MemoryLedgerStore({ max: 3 });
  const ledger = new AccessLedger({ store });
  for (let i = 0; i < 10; i++) await ledger.record({ accepted: true, agent_id: 'a' + i, operator_id: 'o' });
  const rows = await ledger.recent({ limit: 100 });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].agent_id, 'a9');
});

test('loggedGate logs the verdict and returns it unchanged', async () => {
  const ledger = new AccessLedger();
  const fakeGate = async () => ({ accepted: true, agent_id: 'axis:acme:bot', operator_id: 'o', effective_scope: [] });
  const gate = loggedGate(fakeGate, ledger, { audience: 'aud' });
  const verdict = await gate({});
  assert.equal(verdict.accepted, true);
  const rows = await ledger.recent();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent_id, 'axis:acme:bot');
});

test('loggedGate never lets a store failure change the verdict', async () => {
  const brokenLedger = { record: async () => { throw new Error('store down'); } };
  const fakeGate = async () => ({ accepted: true, agent_id: 'a', operator_id: 'o' });
  const gate = loggedGate(fakeGate, brokenLedger, {});
  const verdict = await gate({});
  assert.equal(verdict.accepted, true); // not thrown, not changed
});

test('recordEntry normalizes missing fields', () => {
  const e = recordEntry({ accepted: false, code: 'no_token' });
  assert.equal(e.agent_id, null);
  assert.equal(e.decision, 'denied');
  assert.deepEqual(e.effective_scope, []);
});
