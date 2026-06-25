/**
 * Persistent block / allow list — the runtime, stateful counterpart to the
 * static `blockedOperators` / `approvedOperators` arrays that verifyAgent and
 * SwitchAuthorizer already take.
 *
 * The static lists are policy-at-config-time (what the door policy screen
 * saves). This is policy-at-runtime: a platform operator clicks "boot this
 * agent" and the decision sticks in the platform's OWN store, no redeploy. It
 * adds two things the static arrays don't have:
 *
 *   1. Agent-level blocking (block one misbehaving agent without blocking its
 *      whole operator).
 *   2. Mutation at runtime (block / unblock) backed by a pluggable store.
 *
 * Canonical adapter: Owyhee "The Door" (governor#27) ships the OPERATOR-level
 * half of this port as its `operator_blocks` table + `blockedOperators()`,
 * merged into the SwitchAuthorizer policy at authorize time. This module is the
 * library form of that, plus the AGENT-level half The Door does not have yet
 * (an additive `agent_blocks` table is the natural way for it to adopt it — a
 * fast-follow, not a requirement). Block metadata is `{ reason, created_at }`
 * (epoch ms), matching The Door's columns so the shapes are one.
 *
 * Same adapter shape as the ledger — a tiny CRUD port a platform implements
 * against D1 / SQLite / Postgres. Default is in-memory.
 *
 * --- Adapter shape -------------------------------------------------------
 * A store is any object implementing:
 *
 *   async add(kind, id, meta)     -> void              // kind: 'operator'|'agent'
 *   async remove(kind, id)        -> void
 *   async has(kind, id)           -> boolean
 *   async list(kind)              -> { id, meta }[]     // all entries of a kind
 *
 * Integration: build the verifyAgent opts from a Blocklist and merge them with
 * your static policy (`opts(staticBlocked)` -> { blockedOperators }), and call
 * `checkVerdict(verdict)` AFTER verifyAgent to catch agent-level blocks (the
 * registry verdict carries operator_id and agent_id, and operator blocking is
 * already enforced by verifyAgent via blockedOperators, but agent-level
 * blocking needs the resolved agent_id, which only exists post-verify).
 */

/** Default in-memory block/allow store. */
export class MemoryBlocklistStore {
  constructor() {
    this._sets = { operator: new Map(), agent: new Map() };
  }

  async add(kind, id, meta = {}) {
    const m = this._sets[kind];
    if (!m) throw new Error(`MemoryBlocklistStore: unknown kind '${kind}'`);
    m.set(id, { ...meta, created_at: meta.created_at || Date.now() });
  }

  async remove(kind, id) {
    const m = this._sets[kind];
    if (m) m.delete(id);
  }

  async has(kind, id) {
    const m = this._sets[kind];
    return !!(m && m.has(id));
  }

  async list(kind) {
    const m = this._sets[kind];
    if (!m) return [];
    return [...m.entries()].map(([id, meta]) => ({ id, meta }));
  }
}

/**
 * Runtime block list. Holds two kinds of blocks — by operator_id and by
 * agent_id — over a pluggable store.
 */
export class Blocklist {
  constructor({ store } = {}) {
    this.store = store || new MemoryBlocklistStore();
  }

  /** Block an operator (every agent under it). `reason` is recorded as meta. */
  async blockOperator(operatorId, reason) {
    await this.store.add('operator', operatorId, { reason });
  }

  /** Block a single agent without blocking its whole operator. */
  async blockAgent(agentId, reason) {
    await this.store.add('agent', agentId, { reason });
  }

  async unblockOperator(operatorId) {
    await this.store.remove('operator', operatorId);
  }

  async unblockAgent(agentId) {
    await this.store.remove('agent', agentId);
  }

  async isOperatorBlocked(operatorId) {
    if (!operatorId) return false;
    return this.store.has('operator', operatorId);
  }

  async isAgentBlocked(agentId) {
    if (!agentId) return false;
    return this.store.has('agent', agentId);
  }

  /** All blocked operator ids (for merging into verifyAgent's blockedOperators). */
  async blockedOperatorIds() {
    return (await this.store.list('operator')).map((e) => e.id);
  }

  async listOperators() {
    return this.store.list('operator');
  }

  async listAgents() {
    return this.store.list('agent');
  }

  /**
   * The verifyAgent option fragment this blocklist implies. Merge with your
   * static policy so a runtime-blocked operator is denied BEFORE the scope/tier
   * checks run:
   *
   *   const dyn = await blocklist.verifyOpts();
   *   const verdict = await verifyAgent(token, {
   *     ...staticOpts,
   *     blockedOperators: [...(staticOpts.blockedOperators||[]), ...dyn.blockedOperators],
   *   });
   *   const final = await blocklist.checkVerdict(verdict); // agent-level catch
   */
  async verifyOpts() {
    return { blockedOperators: await this.blockedOperatorIds() };
  }

  /**
   * Post-verify agent-level enforcement. verifyAgent already denies blocked
   * OPERATORS (when you fed it `blockedOperators`), but agent-level blocking
   * needs the resolved agent_id, which only exists after the registry verify.
   * Pass an accepted verdict through this; it flips it to denied if the agent
   * (or, as a safety net, the operator) is blocked. Pass-through otherwise.
   */
  async checkVerdict(verdict) {
    if (!verdict || !verdict.accepted) return verdict;
    if (await this.isAgentBlocked(verdict.agent_id)) {
      return {
        accepted: false,
        code: 'agent_blocked',
        reason: 'Agent is blocked at this platform',
        agent_id: verdict.agent_id,
        operator_id: verdict.operator_id,
      };
    }
    if (await this.isOperatorBlocked(verdict.operator_id)) {
      return {
        accepted: false,
        code: 'operator_blocked',
        reason: 'Operator is blocked at this platform',
        agent_id: verdict.agent_id,
        operator_id: verdict.operator_id,
      };
    }
    return verdict;
  }
}

/**
 * Wrap a gate so a runtime-blocked agent/operator is denied even if it's
 * globally valid and within policy. Sits OUTSIDE the verify call: it merges the
 * dynamic operator blocks into the verdict path via checkVerdict (agent-level)
 * and is the simplest way to bolt a Blocklist onto an existing gate.
 *
 * Note: operator-level dynamic blocks are most efficiently injected by feeding
 * `await blocklist.blockedOperatorIds()` into the gate's policy, but checkVerdict
 * also catches them here as a safety net, so this wrapper is correct on its own.
 */
export function gatedWithBlocklist(gate, blocklist) {
  return async function blocklistGate(request) {
    const verdict = await gate(request);
    return blocklist.checkVerdict(verdict);
  };
}
