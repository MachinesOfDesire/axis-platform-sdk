import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Blocklist, gatedWithBlocklist } from '../src/blocklist.js';

test('blockAgent denies an otherwise-accepted verdict', async () => {
  const bl = new Blocklist();
  await bl.blockAgent('axis:acme:bot', 'spammed');
  const verdict = await bl.checkVerdict({ accepted: true, agent_id: 'axis:acme:bot', operator_id: 'axis:acme:op' });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'agent_blocked');
  assert.equal(verdict.agent_id, 'axis:acme:bot');
});

test('a non-blocked agent passes through unchanged', async () => {
  const bl = new Blocklist();
  await bl.blockAgent('axis:acme:other');
  const original = { accepted: true, agent_id: 'axis:acme:bot', operator_id: 'o' };
  const verdict = await bl.checkVerdict(original);
  assert.equal(verdict.accepted, true);
  assert.equal(verdict, original); // pass-through
});

test('blockOperator catches the operator at verdict time', async () => {
  const bl = new Blocklist();
  await bl.blockOperator('axis:bad:op', 'whole operator booted');
  const verdict = await bl.checkVerdict({ accepted: true, agent_id: 'axis:bad:bot', operator_id: 'axis:bad:op' });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'operator_blocked');
});

test('unblock reverses a block', async () => {
  const bl = new Blocklist();
  await bl.blockAgent('axis:acme:bot');
  assert.equal(await bl.isAgentBlocked('axis:acme:bot'), true);
  await bl.unblockAgent('axis:acme:bot');
  assert.equal(await bl.isAgentBlocked('axis:acme:bot'), false);
  const verdict = await bl.checkVerdict({ accepted: true, agent_id: 'axis:acme:bot', operator_id: 'o' });
  assert.equal(verdict.accepted, true);
});

test('blockedOperatorIds returns the dynamic list for verifyAgent', async () => {
  const bl = new Blocklist();
  await bl.blockOperator('axis:a:op');
  await bl.blockOperator('axis:b:op');
  const ids = await bl.blockedOperatorIds();
  assert.deepEqual(ids.sort(), ['axis:a:op', 'axis:b:op']);
  const opts = await bl.verifyOpts();
  assert.deepEqual(opts.blockedOperators.sort(), ['axis:a:op', 'axis:b:op']);
});

test('checkVerdict never resurrects an already-denied verdict', async () => {
  const bl = new Blocklist();
  const denied = { accepted: false, code: 'insufficient_scope' };
  const verdict = await bl.checkVerdict(denied);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'insufficient_scope');
});

test('gatedWithBlocklist wraps a gate and enforces agent blocks', async () => {
  const bl = new Blocklist();
  await bl.blockAgent('axis:acme:bot');
  const gate = gatedWithBlocklist(async () => ({ accepted: true, agent_id: 'axis:acme:bot', operator_id: 'o' }), bl);
  const verdict = await gate({});
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, 'agent_blocked');
});

test('listAgents / listOperators expose entries with meta', async () => {
  const bl = new Blocklist();
  await bl.blockAgent('axis:acme:bot', 'flooded');
  const agents = await bl.listAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, 'axis:acme:bot');
  assert.equal(agents[0].meta.reason, 'flooded');
  assert.equal(typeof agents[0].meta.created_at, 'number'); // epoch ms, matches the cloud-hosted version's operator_blocks
});
