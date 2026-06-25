/**
 * Thin registry-call helpers. The registry does the cryptographic heavy
 * lifting (signature, revocation, delegation chain walk) at its public
 * endpoints; these wrappers just call them.
 */

export const DEFAULT_REGISTRY = 'https://registry.axisprime.ai';

/**
 * GET a registry path. `fetchImpl` is injectable for testing. Returns
 * { status, body } where body is the parsed JSON (or { raw } if not JSON).
 */
export async function registryGet(base, path, { headers, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${base}${path}`, headers ? { headers } : undefined);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

/**
 * Tier rank for minimum-tier gating. Higher = stronger verification.
 * `kyb_business` is an accepted legacy alias for `kyb_organization`.
 */
export const TIER_RANK = {
  email: 1,
  domain: 2,
  verified: 3,
  kyb_individual: 4,
  kyb_organization: 5,
  kyb_business: 5,
};

/**
 * Resolve an agent's presentation layer (display_name, operator verification
 * tier, etc.). Pass the agent's AIT to unlock the presentation layer; without
 * it you get only the public layer.
 *
 * @returns {{ agent_id, did, display_name, tier, status, raw }}
 */
export async function enrich(agentId, token, { registryBaseUrl = DEFAULT_REGISTRY, fetchImpl = fetch } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const { body } = await registryGet(registryBaseUrl, `/agents/${encodeURIComponent(agentId)}`, { headers, fetchImpl });
  return {
    agent_id: body.agent_id || agentId,
    did: body.did || null,
    display_name: body.display_name || null,
    tier: pickTier(body),
    status: body.status || null,
    raw: body,
  };
}

/**
 * Read an operator's verification tier from a resolved agent record.
 * Defensive across the field shapes the registry uses for the tier.
 */
export function pickTier(agentBody) {
  if (!agentBody) return null;
  return (
    agentBody.operator_verification_tier ||
    (agentBody.operator && agentBody.operator.verification_tier) ||
    agentBody.verification_tier ||
    null
  );
}

/**
 * Load a platform's published access policy (`/.well-known/axis-access`).
 * Useful if you want your gate to read its own door policy rather than
 * hard-coding it.
 */
export async function loadAccessPolicy(platformBaseUrl, { fetchImpl = fetch } = {}) {
  const base = String(platformBaseUrl || '').replace(/\/$/, '');
  const res = await fetchImpl(`${base}/.well-known/axis-access`);
  if (!res.ok) throw new Error(`axis-access fetch failed: ${res.status}`);
  return res.json();
}
