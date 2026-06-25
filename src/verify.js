/**
 * verifyAgent — the one function that matters.
 *
 * An AXIS agent shows up at your platform and presents an AIT. This calls the
 * registry to verify it (signature + revocation + delegation chain, all done
 * server-side), then applies YOUR platform's gate: audience match, required
 * scopes, blocked/approved operators, minimum verification tier. Returns a
 * single structured verdict you can act on.
 *
 * Trust model notes:
 *  - The registry's `effective_scope` (returned when a valid delegation is
 *    presented) is the trustworthy, chain-walked scope. The AIT's self-declared
 *    `scope` is NOT trusted. An agent acting on its own identity with no
 *    delegation has NO proven scope, so any non-empty `requireScopes` denies it.
 *  - Audience is matched locally: the registry only checks that `aud` exists,
 *    not that it equals your platform. That check is yours.
 */
import { decodeAitPayload } from './decode.js';
import { coversAll } from './scope.js';
import { registryGet, enrich, TIER_RANK, DEFAULT_REGISTRY } from './client.js';

/**
 * @param {string} token  The AIT the agent presented.
 * @param {object} opts
 * @param {string} [opts.audience]          Your platform's audience id. If set, the AIT's `aud` must equal it.
 * @param {string[]} [opts.requireScopes]   Scopes the agent must hold (checked against trustworthy effective_scope).
 * @param {string} [opts.minTier]           Minimum operator verification tier (email|domain|verified|kyb_individual|kyb_organization).
 * @param {string[]} [opts.blockedOperators] Operator ids to reject outright.
 * @param {string[]|null} [opts.approvedOperators] If set, only these operator ids are accepted.
 * @param {string} [opts.registryBaseUrl]   Defaults to https://registry.axisprime.ai
 * @param {function} [opts.fetchImpl]       Injectable fetch (testing).
 * @returns {Promise<object>} verdict: { accepted, reason?, code?, agent_id?, operator_id?, effective_scope?, delegation_valid?, tier?, expires_at? }
 */
export async function verifyAgent(token, opts = {}) {
  const {
    audience,
    requireScopes = [],
    minTier,
    blockedOperators = [],
    approvedOperators = null,
    registryBaseUrl = DEFAULT_REGISTRY,
    fetchImpl = fetch,
  } = opts;

  const deny = (reason, code, extra = {}) => ({ accepted: false, reason, code, ...extra });

  if (!token) return deny('No AIT presented', 'no_token');

  // 1. Audience: the agent must have addressed THIS platform.
  if (audience) {
    const payload = decodeAitPayload(token);
    if (!payload || !payload.aud) return deny('AIT is missing an audience (aud) claim', 'missing_aud');
    if (payload.aud !== audience) {
      return deny(`AIT audience '${payload.aud}' does not match this platform ('${audience}')`, 'audience_mismatch');
    }
  }

  // 2. Registry verification (signature + revocation + chain walk).
  let res;
  try {
    res = await registryGet(registryBaseUrl, `/verify?token=${encodeURIComponent(token)}`, { fetchImpl });
  } catch {
    return deny('Registry unreachable', 'registry_error');
  }
  const body = res.body || {};
  if (res.status !== 200) {
    return deny(body?.error?.message || 'Verification request failed', body?.error?.code || 'verify_failed');
  }
  if (body.valid !== true) {
    // valid:false carries a stable `code` (invalid_signature|token_expired|agent_revoked|agent_suspended).
    return deny(body.reason || 'AIT is not valid', body.code || 'invalid_ait', { agent_id: body.agent_id });
  }

  const agentId = body.agent_id;
  const operatorId = body.operator_id;

  // 3. Operator allow / block.
  if (blockedOperators.includes(operatorId)) {
    return deny('Operator is blocked at this platform', 'operator_blocked', { agent_id: agentId, operator_id: operatorId });
  }
  if (approvedOperators && !approvedOperators.includes(operatorId)) {
    return deny('Operator is not on this platform\'s approved list', 'operator_not_approved', { agent_id: agentId, operator_id: operatorId });
  }

  // 4. Scope. Trustworthy scope is effective_scope, and only when the
  // delegation actually validated. A direct AIT (no valid delegation) has
  // no proven scope.
  const delegationValid = body.delegation_valid === true;
  const grantedScopes = delegationValid && Array.isArray(body.effective_scope) ? body.effective_scope : [];
  if (requireScopes.length) {
    const check = delegationValid ? coversAll(grantedScopes, requireScopes) : { ok: false, missing: requireScopes };
    if (!check.ok) {
      return deny(`Missing required scope(s): ${check.missing.join(', ')}`, 'insufficient_scope', {
        agent_id: agentId,
        operator_id: operatorId,
        effective_scope: grantedScopes,
        missing: check.missing,
      });
    }
  }

  // 5. Minimum tier (optional; needs a presentation-layer fetch).
  let tier = null;
  if (minTier) {
    const info = await enrich(agentId, token, { registryBaseUrl, fetchImpl });
    tier = info.tier;
    if ((TIER_RANK[tier] || 0) < (TIER_RANK[minTier] || 0)) {
      return deny(`Operator tier '${tier || 'unknown'}' is below the required '${minTier}'`, 'insufficient_tier', {
        agent_id: agentId,
        operator_id: operatorId,
        tier,
      });
    }
  }

  return {
    accepted: true,
    agent_id: agentId,
    operator_id: operatorId,
    effective_scope: grantedScopes,
    delegation_valid: delegationValid,
    tier,
    expires_at: body.expires_at || null,
  };
}
