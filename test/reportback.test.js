import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reportFlag,
  blockAndReport,
  getPlatformKey,
  buildAttestation,
  signAttestation,
  verifyAttestation,
  MemoryKeyStore,
} from '../src/reportback.js';
import { Blocklist } from '../src/blocklist.js';
// Import the actual stub-receiver verification so the SDK test exercises the
// real acceptance logic (no network), matching the "against a local instance of
// the stub receiver" requirement.
import { verifyReport } from '../../axis-reputation/src/attestation.js';

const PLATFORM = 'axis:demo-platform:door';

test('reportFlag produces a valid, self-verifying signed attestation', async () => {
  const keyStore = new MemoryKeyStore();
  const { sent, reason, attestation } = await reportFlag(
    { platformId: PLATFORM, agentId: 'axis:acme:bot', category: 'abuse:spam', reason: 'flooded comments' },
    { keyStore } // no reputationUrl -> graceful no-op send, but TA still built+signed
  );
  assert.equal(sent, false);
  assert.equal(reason, 'reputation_disabled');
  assert.equal(attestation.type, 'TrustAttestation');
  assert.equal(attestation.issued_by, PLATFORM);
  assert.equal(attestation.subject, 'axis:acme:bot');
  assert.equal(attestation.scope, 'abuse:spam');
  assert.match(attestation.id, /^ta:demo-platform:door:/);
  assert.ok(attestation.signature);

  const { publicKeyB64 } = await getPlatformKey({ keyStore });
  assert.equal(await verifyAttestation(attestation, publicKeyB64), true);
});

test('tampered attestation fails verification', async () => {
  const keyStore = new MemoryKeyStore();
  const { privateKey, publicKeyB64 } = await getPlatformKey({ keyStore });
  const signed = await signAttestation(
    buildAttestation({ platformId: PLATFORM, agentId: 'axis:acme:bot', category: 'abuse', reason: 'x' }),
    privateKey
  );
  assert.equal(await verifyAttestation(signed, publicKeyB64), true);
  const tampered = { ...signed, statement: 'rewritten after signing' };
  assert.equal(await verifyAttestation(tampered, publicKeyB64), false);
});

test('reportFlag POSTs to a configured index and a signed report gets 202', async () => {
  const keyStore = new MemoryKeyStore();
  // fetchImpl routes the POST body through the REAL stub-receiver logic.
  const fetchImpl = async (url, init) => {
    const report = JSON.parse(init.body);
    const result = await verifyReport(report);
    const status = result.ok ? 202 : 400;
    return { status, ok: status >= 200 && status < 300, json: async () => result, text: async () => JSON.stringify(result) };
  };
  const { sent, status, attestation } = await reportFlag(
    { platformId: PLATFORM, agentId: 'axis:acme:bot', category: 'abuse:spam', reason: 'flooded' },
    { reputationUrl: 'https://axis-reputation.test/attestations', keyStore, fetchImpl }
  );
  assert.equal(sent, true);
  assert.equal(status, 202);
  assert.ok(attestation.signature);
});

test('the stub receiver rejects a tampered report with 4xx', async () => {
  const keyStore = new MemoryKeyStore();
  const { privateKey, publicKeyB64 } = await getPlatformKey({ keyStore });
  const attestation = await signAttestation(
    buildAttestation({ platformId: PLATFORM, agentId: 'axis:acme:bot', category: 'abuse', reason: 'x' }),
    privateKey
  );
  // Tamper AFTER signing: change the statement, keep the old signature.
  const badReport = {
    attestation: { ...attestation, statement: 'changed' },
    platform_public_key: publicKeyB64,
    signature: attestation.signature,
  };
  const result = await verifyReport(badReport);
  assert.equal(result.ok, false);

  const goodReport = { attestation, platform_public_key: publicKeyB64, signature: attestation.signature };
  assert.equal((await verifyReport(goodReport)).ok, true);
});

test('reportFlag is a graceful no-op (never throws) when unconfigured', async () => {
  const out = await reportFlag(
    { platformId: PLATFORM, agentId: 'axis:acme:bot', category: 'abuse', reason: 'x' },
    { keyStore: new MemoryKeyStore() }
  );
  assert.equal(out.sent, false);
  assert.equal(out.reason, 'reputation_disabled');
});

test('reportFlag does not throw on a network failure', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const out = await reportFlag(
    { platformId: PLATFORM, agentId: 'axis:acme:bot', category: 'abuse', reason: 'x' },
    { reputationUrl: 'https://down.test/attestations', keyStore: new MemoryKeyStore(), fetchImpl }
  );
  assert.equal(out.sent, false);
  assert.match(out.reason, /reputation_unreachable/);
});

test('blockAndReport blocks locally and reports', async () => {
  const bl = new Blocklist();
  const out = await blockAndReport(
    bl,
    { platformId: PLATFORM, agentId: 'axis:acme:bot', category: 'abuse', reason: 'spam' },
    { keyStore: new MemoryKeyStore() }
  );
  assert.equal(out.blocked, true);
  assert.equal(await bl.isAgentBlocked('axis:acme:bot'), true);
  assert.ok(out.report.attestation.signature);
});

test('getPlatformKey persists the key across calls (same store)', async () => {
  const keyStore = new MemoryKeyStore();
  const a = await getPlatformKey({ keyStore });
  const b = await getPlatformKey({ keyStore });
  assert.equal(a.publicKeyB64, b.publicKeyB64); // stable, not regenerated
});
