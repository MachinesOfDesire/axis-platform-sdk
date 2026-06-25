/**
 * axis-platform-sdk — the platform/verifier ("bouncer") side of AXIS.
 *
 * When an AXIS agent shows up at your platform and wants to act, verify its
 * identity + delegation + scope and decide: accept, scope, or boot.
 *
 * The whole point: the registry already does the cryptography (signature,
 * revocation, delegation chain walk) server-side. This SDK packages the
 * verdict + policy layer so a platform integrates in a few lines instead of
 * hand-rolling it.
 */
export { verifyAgent } from './verify.js';
export { SwitchAuthorizer } from './authorizer.js';
export { aitGate, extractToken, denialResponse } from './gate.js';
export { scopeCovers, coversAll } from './scope.js';
export { enrich, loadAccessPolicy, registryGet, pickTier, TIER_RANK, DEFAULT_REGISTRY } from './client.js';
export { decodeAitPayload } from './decode.js';

// --- Stateful platform store (the "who showed up / who's blocked" half) ---
export { AccessLedger, MemoryLedgerStore, loggedGate, recordEntry } from './ledger.js';
export { Blocklist, MemoryBlocklistStore, gatedWithBlocklist } from './blocklist.js';
export {
  reportFlag,
  blockAndReport,
  getPlatformKey,
  buildAttestation,
  signAttestation,
  verifyAttestation,
  MemoryKeyStore,
  DEFAULT_REPUTATION_URL,
} from './reportback.js';
