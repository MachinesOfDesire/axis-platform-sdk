/**
 * The Authorizer port + the free-tier SwitchAuthorizer.
 *
 * The cloud-hosted version (and any platform) always does IDENTITY verification
 * first — is this a real, non-revoked agent with a trustworthy effective_scope (verifyAgent ->
 * registry). That part is fixed and never pluggable.
 *
 * The authorization DECISION is the pluggable, monetizable layer. Every
 * Authorizer implements the same shape:
 *
 *     authorize(token, gateId, { registryBaseUrl, fetchImpl }) -> verdict
 *
 * where `verdict` is exactly what verifyAgent returns
 * ({ accepted, reason?, code?, agent_id?, operator_id?, effective_scope?, tier?, ... }).
 *
 * Profiles (Josh's "simple on/off -> granular -> really complicated"):
 *   - SwitchAuthorizer  (this file)  — FREE tier. Config-driven on/off gates
 *                                      + optional tier / scope / operator rules.
 *   - EngineAuthorizer  (not here)   — PAID. Same port, delegates the decision
 *                                      to Permify / OpenFGA (sidecar) for
 *                                      relationship/attribute rules.
 *   - EnterpriseAuthorizer (not here)— full ReBAC/ABAC, same port.
 *
 * The SwitchAuthorizer's `policy` object is exactly what a "Door policy" screen
 * edits and saves.
 */
import { verifyAgent } from './verify.js';
import { extractToken } from './gate.js';

const deny = (reason, code, extra = {}) => ({ accepted: false, reason, code, ...extra });

/**
 * Free-tier gate engine: a set of named gates, each on/off, with optional
 * minimum tier, required scopes, and operator allow/block lists.
 *
 * policy = {
 *   audience: 'comments.mysite.com',   // your platform id; applied to every gate
 *   defaultAllow: false,               // posture for a gateId with no policy
 *   blockedOperators: [],              // global blocklist, applied to all gates
 *   gates: {
 *     'comments:write': {
 *       enabled: true,
 *       minTier: 'domain',             // optional
 *       requireScopes: ['comments:write'], // optional
 *       blockedOperators: [],          // optional, gate-specific
 *       approvedOperators: null        // optional allowlist
 *     }
 *   }
 * }
 */
export class SwitchAuthorizer {
  constructor(policy = {}) {
    this.policy = policy || {};
  }

  /** The verifyAgent options this policy implies for a given gate. */
  optsForGate(gateId) {
    const p = this.policy;
    const gate = (p.gates && p.gates[gateId]) || null;
    return {
      audience: p.audience,
      requireScopes: (gate && gate.requireScopes) || [],
      minTier: gate && gate.minTier,
      blockedOperators: [...(p.blockedOperators || []), ...((gate && gate.blockedOperators) || [])],
      approvedOperators: (gate && gate.approvedOperators) || null,
    };
  }

  /**
   * Decide whether `token` may act at `gateId`. Denies if the gate is turned
   * off, or unknown when the posture is closed. Otherwise runs identity
   * verification + this gate's policy.
   */
  async authorize(token, gateId, { registryBaseUrl, fetchImpl } = {}) {
    const p = this.policy;
    const gate = (p.gates && p.gates[gateId]) || null;

    if (!gate) {
      if (p.defaultAllow) {
        return verifyAgent(token, {
          audience: p.audience,
          blockedOperators: p.blockedOperators || [],
          registryBaseUrl,
          fetchImpl,
        });
      }
      return deny(`No policy for gate '${gateId}' and the default posture is closed`, 'gate_unknown');
    }

    if (gate.enabled === false) {
      return deny(`Gate '${gateId}' is turned off`, 'gate_closed');
    }

    return verifyAgent(token, { ...this.optsForGate(gateId), registryBaseUrl, fetchImpl });
  }

  /** Bind this authorizer to a gateId as a request gate: (request) => verdict. */
  gate(gateId, opts = {}) {
    return async (request) => this.authorize(extractToken(request), gateId, opts);
  }
}
