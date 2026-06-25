# axis-platform-sdk

The **platform side** of AXIS. The bouncer at the door.

The [`axis-protocol-sdk`](https://github.com/MachinesOfDesire/axis-protocol-sdk) is what an *agent* uses to prove who it is. This SDK is the other end of the wire: what a **consuming platform** uses when an AXIS agent shows up and wants to do something, so the platform can **verify** it, check its **scope**, and decide to **accept** or **boot** it.

> Status: v0.2. Built for the full-loop demo and as the adoption surface for third-party platforms. Owyhee "The Door" is the first production consumer (it depends on this package rather than vendoring it).

## Why this exists

The registry already does the hard part. `GET /verify?token=<AIT>` checks the signature, checks revocation, and walks the delegation chain server-side, returning the trustworthy `effective_scope`. This SDK packages the verdict + your platform's policy (audience, required scopes, blocked operators, minimum tier) into one call, so you integrate in a few lines instead of hand-rolling it.

## Install (once published)

```
npm install axis-platform-sdk
```

Zero dependencies. Runs in Node 20+, Cloudflare Workers, and modern browsers. Ships TypeScript declarations (the package is authored in plain JS).

## Quickstart — gate a Worker endpoint

```js
import { aitGate, denialResponse } from 'axis-platform-sdk';

const gate = aitGate({
  audience: 'comments.mysite.com',      // your platform's stable audience id
  requireScopes: ['comments:write'],    // what the agent must be allowed to do
  // minTier: 'domain',                 // optionally require domain-verified+
  // blockedOperators: ['axis:spammer:operator'],
});

export default {
  async fetch(request) {
    const verdict = await gate(request);
    if (!verdict.accepted) return denialResponse(verdict); // 401/403 + reason
    // verdict.agent_id is verified. Proceed.
    return Response.json({ ok: true, by: verdict.agent_id });
  },
};
```

The gate pulls the AIT from `Authorization: Bearer <ait>`, `X-AXIS-Token`, or `?ait=`.

## Or call the verifier directly

```js
import { verifyAgent } from 'axis-platform-sdk';

const verdict = await verifyAgent(token, {
  audience: 'comments.mysite.com',
  requireScopes: ['comments:write'],
});
// -> { accepted: true, agent_id, operator_id, effective_scope, delegation_valid, tier, expires_at }
// or { accepted: false, code, reason, ... }
```

## API

- **`verifyAgent(token, opts)`** — the core. Verifies against the registry and applies your policy. Returns a structured verdict.
  - `audience` — your platform id. The AIT's `aud` must equal it. (Matched locally: the registry only checks that `aud` is non-empty, not that it equals you. That check is yours.)
  - `requireScopes` — checked against the trustworthy `effective_scope`.
  - `minTier` — `email | domain | verified | kyb_individual | kyb_organization`.
  - `blockedOperators` / `approvedOperators` — deny/allow lists by operator id.
  - `registryBaseUrl` — defaults to `https://registry.axisprime.ai`.
- **`aitGate(opts)`** — returns `(request) => Promise<verdict>`; binds your policy to a request gate.
- **`denialResponse(verdict)`** — turns a denied verdict into a 401/403 `Response`.
- **`scopeCovers(granted, required)` / `coversAll(granted, required[])`** — the AXIS scope matcher (ported verbatim from the Governor's, so operator and platform sides agree).
- **`enrich(agentId, token, opts)`** — fetch the agent's presentation layer (display name, tier) for a console UI.
- **`loadAccessPolicy(platformBaseUrl)`** — read a platform's published `/.well-known/axis-access` door policy.
- **`decodeAitPayload(token)`** — read the AIT payload (claims) without verifying. For the `aud` check; never trust it for authorization.
- **`AccessLedger` / `MemoryLedgerStore` / `loggedGate(gate, ledger, opts)` / `recordEntry(verdict, opts)`** — the access ledger (who showed up). `loggedGate` wraps a gate so every verdict is logged.
- **`Blocklist` / `MemoryBlocklistStore` / `gatedWithBlocklist(gate, blocklist)`** — the runtime block list (by operator and by agent). `blockOperator` / `blockAgent` / `unblock*` / `isAgentBlocked` / `blockedOperatorIds` / `checkVerdict`.
- **`reportFlag(args, opts)` / `blockAndReport(blocklist, args, opts)`** — sign a negative Trust Attestation and send it to a reputation index (OFF by default).
- **`getPlatformKey(opts)` / `buildAttestation` / `signAttestation` / `verifyAttestation` / `MemoryKeyStore`** — the platform's Ed25519 key + TA build/sign/verify primitives (WebCrypto, zero-dep).

## Gates as policy: `SwitchAuthorizer` (the free-tier engine)

Identity verification is fixed and core. The authorization *decision* is a pluggable layer — the **Authorizer port**. `SwitchAuthorizer` is the free-tier implementation: config-driven on/off gates. Its `policy` object is exactly what a console's "door policy" screen edits and saves.

```js
import { SwitchAuthorizer, denialResponse } from 'axis-platform-sdk';

const door = new SwitchAuthorizer({
  audience: 'comments.mysite.com',
  defaultAllow: false,
  gates: {
    'comments:write': { enabled: true, requireScopes: ['comments:write'], minTier: 'domain' },
  },
});

const verdict = await door.gate('comments:write')(request);
if (!verdict.accepted) return denialResponse(verdict);
```

Flip `enabled: false` and the gate closes, no code change. The port is engine-agnostic: a paid `EngineAuthorizer` (Permify / OpenFGA sidecar) for granular relationship/attribute rules drops into the same slot with the same `authorize(token, gateId, ctx)` shape. The demo and free tier need no engine.

## Stateful half: ledger, blocklist, reputation report-back

`verifyAgent` / `aitGate` are stateless verdict machines. A self-hosting
platform also needs **state it owns**: a record of who showed up, a runtime
block list, and a way to report a bad actor onward. These three modules add that,
all zero-infra — the platform runs the stores in its OWN store (default
in-memory; plug in D1 / SQLite / Postgres via a documented adapter shape).

### Access ledger — "who's using my platform"

```js
import { aitGate, AccessLedger, loggedGate } from 'axis-platform-sdk';

const ledger = new AccessLedger();                 // default in-memory store
const gate = loggedGate(aitGate({ audience }), ledger, { audience });

const verdict = await gate(request);               // every verdict is logged
// ...
await ledger.recent({ limit: 25 });                // newest-first arrivals
await ledger.byOperator('axis:acme:op');           // arrivals from one operator
```

Each entry records `{ agent_id, operator_id, created_at, tier, delegation_valid,
effective_scope, gate_id, requested_action, display_name, decision, reason,
audience }` — the same shape as Owyhee "The Door"'s `arrivals` record, so the
SDK and the product share one arrival definition (see "Single source of truth"
below). `decision` is `auto_allow | denied | held | approved | booted`;
`created_at` is epoch ms. Only the trustworthy `effective_scope` is recorded,
never the AIT's self-declared scope. A ledger write failure never changes the
verdict.

### Persistent block / allow list — runtime, by operator AND by agent

The static `blockedOperators` / `approvedOperators` are config-time policy. The
`Blocklist` is runtime policy the platform mutates without a redeploy, and it
adds **agent-level** blocking (boot one agent without booting its operator).

```js
import { Blocklist, verifyAgent } from 'axis-platform-sdk';

const blocklist = new Blocklist();
await blocklist.blockAgent('axis:acme:bot', 'spammed');     // agent-level
await blocklist.blockOperator('axis:bad:op', 'whole op');   // operator-level

// Inject dynamic operator blocks into verify, then catch agent-level post-verify:
let verdict = await verifyAgent(token, {
  audience,
  blockedOperators: [...staticBlocked, ...(await blocklist.blockedOperatorIds())],
});
verdict = await blocklist.checkVerdict(verdict);   // flips to denied if agent/op blocked
```

### Reputation report-back — sign a negative Trust Attestation and send it onward

When you boot an agent, you know something the network doesn't. `reportFlag`
builds a protocol-shaped **Trust Attestation** (AXIS Layer 3; SPEC §4.5), signs
it with the platform's own Ed25519 key (generated + persisted on first use via
`getPlatformKey`, WebCrypto), and POSTs `{ attestation, platform_public_key,
signature }` to a configurable reputation index.

```js
import { reportFlag, blockAndReport, Blocklist } from 'axis-platform-sdk';

// Report-back is OFF by default. Unconfigured -> graceful no-op (never throws).
await reportFlag(
  { platformId: 'axis:my-platform:door', agentId: 'axis:acme:bot', category: 'abuse:spam', reason: 'flooded comments' },
  { reputationUrl: 'https://axis-reputation.example/attestations' }   // when the index exists
);

// Convenience: block locally AND report (local block is authoritative; report is best-effort).
const blocklist = new Blocklist();
await blockAndReport(blocklist, { platformId: 'axis:my-platform:door', agentId: 'axis:acme:bot', category: 'abuse', reason: 'spam' });
```

The reputation **index is a separate, future, commercial service** — NOT the
canonical registry (which stays identity-only, Layer 1 + Layer 2). The
[`axis-reputation`](https://github.com/MachinesOfDesire/axis-reputation) stub
receiver accepts-and-discards (verifies signature, returns 202) until the real
index is built. See `examples/bouncer-worker.js` for a reference admin surface
over the ledger + blocklist.

### Single source of truth: the SDK is the port, The Door is the adapter

The ledger and blocklist are a **port + in-memory default**, not a competing
implementation. Owyhee **"The Door"** (the inbound surface of the Owyhee
console) is the first production **adapter**:

| SDK (this package, the port)        | The Door (the D1-backed product adapter)        |
| ----------------------------------- | ----------------------------------------------- |
| `AccessLedger` + `recordEntry`      | `arrivals` table + `recordArrival()`            |
| `Blocklist` (operator-level)        | `operator_blocks` table + `blockedOperators()`  |
| `SwitchAuthorizer` `policy`         | `door_policy` table (serialized policy)         |
| `Blocklist` agent-level *(superset)* | *(not yet — an additive `agent_blocks` table)*  |
| `reportFlag` / reputation emit *(new)* | *(not yet — the open emit half is here)*      |

The entry/meta shapes above are deliberately byte-compatible with The Door's
columns (`created_at` epoch ms; the `auto_allow|denied|held|approved|booted`
decision vocabulary) so there is **one** arrival/block record across the SDK and
the product — fold in, don't duplicate. A platform that needs its own store
implements the documented adapter shape; The Door is the worked, deployed
example of doing exactly that over Cloudflare D1.

## Trust model (read this)

- **`effective_scope` is the only trustworthy scope.** It's the registry's server-side chain-walk result, returned when a valid delegation is presented. The AIT's self-declared `scope` is NOT trusted and is never used for `requireScopes`.
- **A direct AIT with no valid delegation has no proven scope.** Any non-empty `requireScopes` will deny it. That's intentional.
- **Audience matching is the platform's job.** The registry guarantees `aud` exists; you guarantee it's *you*.

## Where it sits

```
agent (axis-protocol-sdk)  ──presents AIT──>  YOUR PLATFORM (axis-platform-sdk)
                                                     │
                                                     └── GET /verify ──> registry (does the crypto)
```

This is distinct from the Governor (the operator-side outbound gateway) and from generic AI gateways (TrueFoundry, Portkey, etc.), which govern an operator's *outbound* LLM calls. This SDK is the *inbound* identity gate.

## License

Apache-2.0. (c) Kipple Labs, Inc.
