/**
 * Access ledger — the platform's "who showed up at my door" record.
 *
 * Every time an agent presents and the gate reaches a verdict, the platform can
 * log the arrival here. This is the STATEFUL half of the bouncer: verifyAgent /
 * aitGate are stateless verdict machines; the ledger is the platform's own
 * append-only record of what those verdicts were, kept in the platform's OWN
 * store. Zero-infra by default (in-memory); a real platform plugs in D1 /
 * SQLite / Postgres via the adapter shape below.
 *
 * Canonical adapter: Owyhee "The Door" (kipple-governor, governor#27) is the
 * shipped, D1-backed product instance of this port — its `arrivals` table +
 * `recordArrival()` ARE this ledger over D1. This module is the library form
 * (the shape + an in-memory default); The Door is the production adapter. The
 * entry shape below is deliberately byte-compatible with The Door's
 * `ArrivalRecord` / `arrivals` columns so there is ONE arrival record across
 * the SDK and the product, not two.
 *
 * Trust note: the only scope worth recording is `effective_scope` (the
 * registry's chain-walked, trustworthy scope), which is exactly what a verdict
 * carries. We never persist the AIT's self-declared scope.
 *
 * --- Adapter shape -------------------------------------------------------
 * A store is any object implementing:
 *
 *   async append(entry)                  -> void     // persist one arrival
 *   async recent({ limit })              -> entry[]  // newest first
 *   async byOperator(operatorId, { limit }) -> entry[] // newest first
 *
 * `entry` is the record shape produced by `recordEntry()` — the same fields The
 * Door's `arrivals` table holds (minus the adapter's own PK/org columns):
 *   {
 *     agent_id, operator_id, created_at,          // created_at = epoch ms (Date.now())
 *     tier, delegation_valid, effective_scope: string[],
 *     gate_id, requested_action, display_name,
 *     decision: 'auto_allow'|'denied'|'held'|'approved'|'booted',
 *     reason, audience
 *   }
 *
 * The same adapter shape is shared with blocklist.js (a tiny CRUD port). A
 * platform implements both against whatever it already runs. The defaults here
 * keep the demo and the free tier zero-infra.
 */

/**
 * Default in-memory ledger store. Newest-first iteration. Bounded so a
 * long-running Worker isolate doesn't grow without limit; override `max` (0 =
 * unbounded) when you want the full history and have a real store behind it.
 */
export class MemoryLedgerStore {
  constructor({ max = 10000 } = {}) {
    this._entries = []; // chronological; newest pushed to the end
    this.max = max;
  }

  async append(entry) {
    this._entries.push(entry);
    if (this.max && this._entries.length > this.max) {
      this._entries.splice(0, this._entries.length - this.max);
    }
  }

  async recent({ limit = 50 } = {}) {
    const out = this._entries.slice(-limit);
    out.reverse();
    return out;
  }

  async byOperator(operatorId, { limit = 50 } = {}) {
    const out = [];
    for (let i = this._entries.length - 1; i >= 0 && out.length < limit; i--) {
      if (this._entries[i].operator_id === operatorId) out.push(this._entries[i]);
    }
    return out;
  }
}

/**
 * Normalize a verdict (from verifyAgent) into a ledger entry. The output is
 * byte-compatible with The Door's `ArrivalRecord` (governor#27) so the SDK and
 * the product share one arrival shape.
 *
 * `decision` defaults from the verdict (accepted -> 'auto_allow', else
 * 'denied'); a caller may override it with a manual-review state a real bouncer
 * needs ('held' | 'approved' | 'booted'). `created_at` is epoch ms (Date.now()),
 * matching The Door's column; for an ISO string use
 * `new Date(entry.created_at).toISOString()`.
 *
 * @param {object} verdict             A verifyAgent verdict.
 * @param {object} [fields]
 * @param {string} [fields.audience]          Platform audience (optional metadata; The Door doesn't persist it).
 * @param {string} [fields.gate_id]           Which gate was requested.
 * @param {string} [fields.requested_action]  Human-facing action label.
 * @param {string} [fields.display_name]      Enriched presentation name.
 * @param {string} [fields.decision]          Override decision ('held'|'approved'|'booted').
 * @param {number} [fields.created_at]        Override timestamp (epoch ms).
 */
export function recordEntry(verdict, { audience, gate_id, requested_action, display_name, decision, created_at } = {}) {
  const v = verdict || {};
  return {
    agent_id: v.agent_id || null,
    operator_id: v.operator_id || null,
    created_at: created_at || Date.now(),
    tier: v.tier || null,
    delegation_valid: v.delegation_valid === true,
    effective_scope: Array.isArray(v.effective_scope) ? v.effective_scope : [],
    gate_id: gate_id || null,
    requested_action: requested_action || null,
    display_name: display_name || null,
    decision: decision || (v.accepted ? 'auto_allow' : 'denied'),
    reason: v.accepted ? null : v.reason || v.code || 'denied',
    audience: audience || null,
  };
}

/**
 * The platform's access ledger. Wraps a store and gives you the log helpers a
 * "who's using my platform" view needs.
 */
export class AccessLedger {
  constructor({ store } = {}) {
    this.store = store || new MemoryLedgerStore();
  }

  /**
   * Log a verdict. Returns the persisted entry. `fields` carries the same
   * optional arrival fields as `recordEntry` (audience, gate_id,
   * requested_action, display_name, decision override).
   */
  async record(verdict, fields = {}) {
    const entry = recordEntry(verdict, fields);
    await this.store.append(entry);
    return entry;
  }

  /** Most recent arrivals, newest first. */
  async recent(opts = {}) {
    return this.store.recent(opts);
  }

  /** Recent arrivals from a single operator, newest first. */
  async byOperator(operatorId, opts = {}) {
    return this.store.byOperator(operatorId, opts);
  }
}

/**
 * Wrap a gate (or any `(request) => Promise<verdict>`) so every verdict is
 * logged to a ledger before it's returned. Drop-in around `aitGate(...)` or
 * `authorizer.gate(gateId)`:
 *
 *   const ledger = new AccessLedger();
 *   const gate = loggedGate(aitGate({ audience }), ledger, { audience, gate_id });
 *   const verdict = await gate(request);   // logged as a side effect
 *
 * `fields` are the static arrival fields to stamp on every entry (audience,
 * gate_id, requested_action, display_name). Logging failures never block the
 * request — a store hiccup must not turn an accepted agent away. The verdict is
 * always returned.
 */
export function loggedGate(gate, ledger, fields = {}) {
  return async function loggingGate(request) {
    const verdict = await gate(request);
    try {
      await ledger.record(verdict, fields);
    } catch {
      /* never let a ledger write failure change the verdict */
    }
    return verdict;
  };
}
