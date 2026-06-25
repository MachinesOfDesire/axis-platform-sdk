/**
 * Reputation report-back — the platform's outbound "this agent misbehaved"
 * signal.
 *
 * A platform that boots an agent has knowledge the rest of the network doesn't:
 * THIS agent spammed / abused / violated policy here. AXIS Layer 3 (Reputation)
 * is exactly the channel for that signal, as a signed **Trust Attestation** (a
 * negative one). This module builds a protocol-shaped TA (axis-protocol
 * SPEC §4.5 / schemas/trust-attestation.json), signs it with the PLATFORM'S OWN
 * Ed25519 key, and POSTs it to a configurable reputation index.
 *
 * Crucial scoping note (per the locked decision):
 *   - The canonical registry is IDENTITY-ONLY (Layer 1 + Layer 2). Trust
 *     Attestations MUST NOT be stored there.
 *   - The reputation index is a SEPARATE, future, commercial service. It does
 *     not exist yet. This module ships the SENDING mechanism; `axis-reputation`
 *     ships a stub receiver that accepts-and-discards until the real index is
 *     built. Default REPUTATION_URL is OFF — unconfigured = graceful no-op.
 *
 * Zero-dep: signing uses WebCrypto (`crypto.subtle`) Ed25519, the same
 * primitive axis-protocol-sdk uses. The platform keypair is generated once and
 * persisted via a tiny pluggable key store (default in-memory; a real platform
 * persists the JWK to its secret store / KV / D1).
 */

// --- base64url (no Buffer dependency; Workers/browser/Node 20+) -------------

function bytesToB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToBytes(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- RFC 8785 JCS (kept minimal + identical in spirit to axis-protocol jcs) --

function jcsCanonicalize(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number not representable in JCS');
    return JSON.stringify(value);
  }
  if (t === 'string' || t === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((el) => (el === undefined ? 'null' : jcsCanonicalize(el))).join(',') + ']';
  }
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      const v = value[k];
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      parts.push(JSON.stringify(k) + ':' + jcsCanonicalize(v));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError(`value of type ${t} not representable in JCS`);
}

// --- platform key store -----------------------------------------------------

/**
 * Default in-memory platform key store. Generate once, hold for the isolate's
 * lifetime. A real platform implements the same `load()` / `save(jwk)` shape
 * over its secret store / KV / D1 so the key is stable across restarts.
 */
export class MemoryKeyStore {
  constructor() {
    this._jwk = null;
  }
  async load() {
    return this._jwk;
  }
  async save(jwk) {
    this._jwk = jwk;
  }
}

let _defaultKeyStore = null;
function defaultKeyStore() {
  if (!_defaultKeyStore) _defaultKeyStore = new MemoryKeyStore();
  return _defaultKeyStore;
}

/**
 * Get (generating + persisting on first use) this platform's Ed25519 signing
 * key. Returns { privateKey: CryptoKey, publicKeyB64: string }.
 *
 * @param {object} [opts]
 * @param {object} [opts.keyStore]  Pluggable store with async load()/save(jwk).
 */
export async function getPlatformKey({ keyStore } = {}) {
  const store = keyStore || defaultKeyStore();
  let jwk = await store.load();
  if (!jwk) {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    await store.save(jwk);
  }
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  // Derive the raw public key from the private JWK's `x` (Ed25519 public bytes).
  const publicKeyB64 = jwk.x; // already base64url in a JWK
  return { privateKey, publicKeyB64, jwk };
}

// --- Trust Attestation build + sign -----------------------------------------

/**
 * Build a (negative) Trust Attestation document MINUS its signature, in the
 * protocol shape (axis-protocol SPEC §4.5). `category` becomes the TA `scope`
 * (the domain of the attestation); `reason` becomes the `statement`.
 *
 * @returns the unsigned TA object (no `signature` field yet).
 */
export function buildAttestation({ platformId, agentId, category, reason, issuedAt }) {
  if (!platformId) throw new Error('buildAttestation: platformId is required (this platform\'s AXIS id)');
  if (!agentId) throw new Error('buildAttestation: agentId (subject) is required');
  const ts = issuedAt || new Date().toISOString();
  // id convention: ta:{operator-of-platform-or-platform-slug}:{descriptor}
  const slug = String(platformId).replace(/^axis:/, '').replace(/[^a-z0-9:-]/gi, '-').toLowerCase();
  const cat = String(category || 'abuse').replace(/[^a-z0-9:-]/gi, '-').toLowerCase();
  const idDescriptor = `${cat}-${ts.replace(/[^0-9]/g, '').slice(0, 14)}`;
  return {
    axis_version: '0.1',
    type: 'TrustAttestation',
    id: `ta:${slug}:${idDescriptor}`,
    issued_by: platformId,
    subject: agentId,
    issued_at: ts,
    scope: cat,
    statement: reason ? String(reason).slice(0, 1000) : `Flagged at ${platformId}`,
  };
}

/**
 * Sign an unsigned TA with an Ed25519 private key. The signed bytes are the
 * RFC 8785 JCS canonicalization of the TA WITHOUT its `signature` field — the
 * same minus-the-proof convention every other AXIS signed body uses. Returns
 * the TA with `signature` attached (base64url, no padding).
 */
export async function signAttestation(attestation, privateKey) {
  const { signature, ...unsigned } = attestation;
  const bytes = new TextEncoder().encode(jcsCanonicalize(unsigned));
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, bytes));
  return { ...unsigned, signature: bytesToB64url(sig) };
}

/**
 * Verify a TA's self-consistency: does `signature` verify against the supplied
 * Ed25519 public key (base64url raw 32 bytes) over the JCS of the TA minus its
 * signature? This is what the stub receiver runs. It proves the report wasn't
 * tampered with in transit and that the holder of `platform_public_key` signed
 * it — NOT that the public key belongs to a trusted platform (that's the
 * index's policy job later).
 */
export async function verifyAttestation(attestation, publicKeyB64) {
  if (!attestation || typeof attestation !== 'object' || !attestation.signature) return false;
  const { signature, ...unsigned } = attestation;
  let key;
  try {
    key = await crypto.subtle.importKey('raw', b64urlToBytes(publicKeyB64), { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return false;
  }
  const bytes = new TextEncoder().encode(jcsCanonicalize(unsigned));
  let sig;
  try {
    sig = b64urlToBytes(signature);
  } catch {
    return false;
  }
  return crypto.subtle.verify('Ed25519', key, sig, bytes);
}

// --- report-back ------------------------------------------------------------

/**
 * Default reputation index URL. OFF by default — reputation is a separate,
 * future commercial service. When the real `axis-reputation` index ships, set
 * this (or pass `reputationUrl`) to its `/attestations` endpoint.
 */
export const DEFAULT_REPUTATION_URL = null;

/**
 * Report a negative reputation flag about an agent.
 *
 * Builds a signed Trust Attestation and POSTs
 *   { attestation, platform_public_key, signature }
 * to the reputation index. If no index is configured (the default), this is a
 * graceful no-op: it returns { sent: false, reason: 'reputation_disabled' } and
 * NEVER throws — a platform's boot flow must not break because reputation isn't
 * wired up yet.
 *
 * @param {object} args
 * @param {string} args.platformId    This platform's AXIS id (the attestor).
 * @param {string} args.agentId       Subject agent's AXIS id.
 * @param {string} [args.operatorId]  Subject's operator id (recorded, not signed into TA core).
 * @param {string} args.category      Flag category -> TA scope (e.g. 'abuse:spam').
 * @param {string} args.reason        Human-readable reason -> TA statement.
 * @param {object} [opts]
 * @param {string|null} [opts.reputationUrl=DEFAULT_REPUTATION_URL]
 * @param {object} [opts.keyStore]    Platform key store (default in-memory).
 * @param {function} [opts.fetchImpl=fetch]
 * @returns {Promise<{ sent: boolean, status?: number, attestation?: object, reason?: string }>}
 */
export async function reportFlag(
  { platformId, agentId, operatorId, category, reason },
  { reputationUrl = DEFAULT_REPUTATION_URL, keyStore, fetchImpl = fetch } = {}
) {
  let attestation;
  let publicKeyB64;
  try {
    const { privateKey, publicKeyB64: pk } = await getPlatformKey({ keyStore });
    publicKeyB64 = pk;
    const unsigned = buildAttestation({ platformId, agentId, category, reason });
    attestation = await signAttestation(unsigned, privateKey);
  } catch (e) {
    // Building/signing failed (e.g. missing platformId). Don't throw out of a
    // boot flow; surface the reason.
    return { sent: false, reason: `report_build_failed: ${e.message}` };
  }

  if (!reputationUrl) {
    // Reputation index not configured. No-op, but hand back the signed TA so a
    // caller can hold it as a portfolio item or send it later.
    return { sent: false, reason: 'reputation_disabled', attestation };
  }

  try {
    const res = await fetchImpl(reputationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attestation,
        platform_public_key: publicKeyB64,
        signature: attestation.signature,
        operator_id: operatorId || null,
      }),
    });
    return { sent: res.status >= 200 && res.status < 300, status: res.status, attestation };
  } catch (e) {
    // Network failure to the index must not break the platform's boot flow.
    return { sent: false, reason: `reputation_unreachable: ${e.message}`, attestation };
  }
}

/**
 * Convenience: block the agent locally AND report it. The local block is the
 * authoritative action (it sticks regardless of the report's fate); the report
 * is best-effort. Returns both outcomes.
 *
 * @param {import('./blocklist.js').Blocklist} blocklist
 * @param {object} args  Same as reportFlag, plus the agentId is what gets blocked.
 * @param {object} [opts] reportFlag opts.
 */
export async function blockAndReport(blocklist, args, opts = {}) {
  await blocklist.blockAgent(args.agentId, args.reason);
  const report = await reportFlag(args, opts);
  return { blocked: true, agent_id: args.agentId, report };
}
