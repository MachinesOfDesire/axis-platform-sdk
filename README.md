# axis-platform-sdk

**Let verified agents into your platform. Boot the bad ones. Free, drop-in, no account required.**

AI agents are starting to show up at your platform — to post, to buy, to call your
API on a human's behalf. An API key can't tell you *which human is behind this
agent*, *whether they're allowed to do this*, or *let you revoke one bad agent
without nuking the key everyone shares*.

`axis-platform-sdk` is the **bouncer at your door**. When an AXIS agent shows up
and presents a token, this verifies — cryptographically, against a public
registry — **who it is, who's accountable for it, and exactly what it's been
authorized to do**, then lets it through or bounces it. A few lines of code.

On a Node/Express server:

```js
import { axisGate } from 'axis-platform-sdk/express';

app.post('/comments',
  axisGate({ audience: 'comments.mysite.com', requireScopes: ['content:comment'] }),
  (req, res) => res.json({ ok: true, by: req.axis.agent_id })); // verified agent; proceed
```

On a Cloudflare Worker (or any `fetch` handler):

```js
import { aitGate, denialResponse } from 'axis-platform-sdk';

const gate = aitGate({ audience: 'comments.mysite.com', requireScopes: ['content:comment'] });

export default {
  async fetch(request) {
    const verdict = await gate(request);
    if (!verdict.accepted) return denialResponse(verdict); // 401/403 + a real reason
    return Response.json({ ok: true, by: verdict.agent_id }); // verified agent; proceed
  },
};
```

That's the whole integration. No SDK account, no API key from us, no infra to run.

---

## Why it's free, and what "no account required" means

The hard part — checking the signature, checking revocation, walking the
delegation chain to compute what the agent is *actually* allowed to do — is done
**server-side by the public AXIS registry** (`registry.axisprime.ai`). This SDK
is the thin, zero-dependency client that calls it and applies *your* policy. Your
platform makes **one outbound HTTPS call** and gets back a trustworthy verdict.

- **Zero dependencies.** Runs on Node 20+, Cloudflare Workers, and modern browsers.
- **Nothing to host.** No database, no key management, no service to deploy.
- **No relationship with us.** You verify against the public registry directly —
  no signup, no key. The only thing that reaches us is the verification call your
  server makes (the agent's token); we never see your content or your users.
- **Apache-2.0.** Use it, fork it, ship it.

Self-host is the whole product today. A cloud-hosted version — a hosted console,
durable arrival history, and a richer policy engine — is in alpha testing, planned
for release in Q3 2026, for teams who'd rather not run it themselves. You will
never need it to run the self-host path. See [Self-host today / cloud-hosted in
alpha](#self-host-today--cloud-hosted-in-alpha).

---

## Gate your platform in 10 minutes

There's a step-by-step guide in **[QUICKSTART.md](QUICKSTART.md)**, and two
complete, runnable drop-in starters — copy the one that matches your stack:

| Your stack | Starter | What it is |
| --- | --- | --- |
| Node / Express (or any Node HTTP server) | **[`templates/node-express/`](templates/node-express/)** | The `axisGate(...)` middleware from `axis-platform-sdk/express` (one import, one line) + a full worked server (door policy, arrivals ledger, boot console). `npm install && npm start`. |
| Cloudflare Workers | **[`templates/cloudflare-worker/`](templates/cloudflare-worker/)** | The same, as a deployable Worker. `npx wrangler dev`. |

Both wrap the identical engine. **You do not need to adopt Cloudflare to use
AXIS** — the Worker template is just one runtime we provide a starter for. If you
run Node, Python, Go, or anything else, the integration is the same shape: pull
the token off the request, call the verifier, act on the verdict.

The Express starter ships a `smoke` test you can run right now to watch the gate
turn away an unidentified agent:

```
$ cd templates/node-express && npm install && npm run smoke
PASS — no AIT -> 401 no_token
PASS — invalid AIT -> 403 denied
All checks passed.
```

---

## What a verdict gives you

`verifyAgent(token, opts)` (and the `aitGate` / middleware that wrap it) return a
single structured verdict:

```js
// accepted:
{ accepted: true, agent_id, operator_id, effective_scope, delegation_valid, tier, expires_at }
// or denied:
{ accepted: false, code, reason, ... }   // code is stable: no_token | audience_mismatch |
                                         // agent_revoked | insufficient_scope | insufficient_tier | ...
```

You decide the policy; the SDK enforces it:

- **`audience`** — the AIT's `aud` must equal *you*, so an agent's token for some
  other site can't be replayed at yours.
- **`requireScopes`** — checked against the trustworthy **`effective_scope`** (the
  registry's chain-walked result), never the token's self-declared scope.
- **`minTier`** — require `email` / `domain` / `verified` / `kyb_individual` /
  `kyb_organization`-level operator verification.
- **`blockedOperators` / `approvedOperators`** — deny-list or allow-list by operator.

And the stateful half a real bouncer needs (all zero-infra by default):

- **Access ledger** — log every arrival, accepted or denied: "who's been using my platform."
- **Runtime blocklist** — boot one agent, or a whole operator, **without a deploy**.
- **Reputation report-back** — when you boot a bad actor, optionally sign a Trust
  Attestation and emit it onward (off by default).

---

## Self-host today / cloud-hosted in alpha

Today this SDK *is* the product: you run it in your own backend, free. A
cloud-hosted version is in alpha testing (planned for release in Q3 2026) for
teams who'd rather not host the console and the state themselves.

| | **This SDK (free, self-hosted) — available now** | **Cloud-hosted — alpha, Q3 2026** |
| --- | --- | --- |
| Identity verification | ✅ full (against the public registry) | same engine |
| Scope / tier / operator policy | ✅ `SwitchAuthorizer` (on/off gates) | + granular relationship/attribute rules |
| Arrivals + blocklist | ✅ your store (in-memory default; D1/SQLite/Postgres adapter) | hosted, durable, multi-tenant |
| Admin console | ✅ a reference HTML page you own | a hosted console |
| Cost / setup | free, nothing to run | a hosted product (alpha) |

The SDK is designed as the **port**; the cloud-hosted version is built as an
**adapter** over the same engine, with byte-compatible arrival/block record
shapes. That's a deliberate design choice so that when the cloud version ships,
moving to it is a lift, not a rewrite — and you are never forced up.

---

## Adoption tiers: start small, add as you need

You don't have to do everything at once. Most platforms start at **A** and stop
there; regulated or higher-stakes platforms add **B** and **C**.

| Tier | What you do | What it takes |
| --- | --- | --- |
| **A — Identity acceptance** | Accept any AXIS-verified agent the way you accept a signed-in human. Pass/fail at request time. | `verifyAgent(token, { audience })` — that's it. |
| **B — Access policy** | Also publish your requirements at `/.well-known/axis-access`, so agents and operators can check before they even call you. | A small JSON doc (the starters serve it). |
| **C — Scope + tier enforcement** | Additionally require specific permissions and a minimum verification level. | Add `requireScopes` / `minTier` (and `blockedOperators`) to the gate. |

All three are the same `verifyAgent` call with more of its options set — moving up
a tier is adding arguments, not re-architecting. (For an upstream you can't put the
SDK inside — a legacy service, a non-Node runtime — the separate
[`axis-gateway`](https://github.com/MachinesOfDesire/axis-gateway) reverse proxy
enforces Tier C in front of it.)

---

## Trust model (read this)

- **`effective_scope` is the only trustworthy scope.** It's the registry's
  server-side chain-walk result, returned only when a valid delegation is
  presented. The AIT's self-declared `scope` is **not** trusted and is never used
  for `requireScopes`.
- **A direct AIT with no valid delegation has no proven scope.** Any non-empty
  `requireScopes` will deny it. That's intentional.
- **Audience matching is the platform's job.** The registry guarantees `aud`
  exists; *you* guarantee it equals you. (The starters do this for you.)

### Forward compatibility (gating signals coming later)

Today you can gate on **scope**, **operator verification tier**, and
**operator allow/block lists**. Richer **provenance** signals — operator account
age, signup method, prior abuse flags — are defined in the protocol but **not yet
exposed by the registry**, so they aren't available to gate on right now.

When they ship, they arrive **additively and backward-compatibly**:

- The verdict object only *gains* fields; it never changes existing ones. Your code
  keeps working untouched.
- Provenance gating will be **new optional `verifyAgent` options** (e.g. a minimum
  account age), exactly like `minTier` is today. Unknown options are ignored, so an
  older integration is never broken by a newer registry.
- You opt in when you want it: bump the SDK and set the new option. Platforms that
  don't care do nothing and are unaffected.

So adding provenance later requires a **registry update** (to populate and expose
the fields) and an **SDK minor** (to read them) — but **no breaking change and no
forced migration** for platforms already running. Build to Tier A/B/C now; the
provenance knobs slot into the same gate when they land.

---

## Where it sits

```
agent (axis-protocol-sdk)  ──presents AIT──>  YOUR PLATFORM (axis-platform-sdk)
                                                     │
                                                     └── GET /verify ──> registry (does the crypto)
```

The [`axis-protocol-sdk`](https://github.com/MachinesOfDesire/axis-protocol-sdk)
and the [AXIS Prime MCP](https://github.com/MachinesOfDesire/axis-mcp) are what an
*agent* uses to get and present an identity. **This** SDK is the other end of the
wire — the inbound identity gate. It is distinct from the operator-side
*outbound* gateway, and from generic AI gateways (TrueFoundry, Portkey, …), which
govern an operator's outbound LLM calls. This is the *inbound*
bouncer.

A worked, real-world integration is documented in
**[CASE-STUDY-offworld.md](CASE-STUDY-offworld.md)** (gating comments on a live
news site). That's a *case study* — an example of using the tool, not the product
itself.

---

## API reference

- **`verifyAgent(token, opts)`** — the core. Verifies against the registry and
  applies your policy. Returns a structured verdict.
  - `audience` — your platform id. The AIT's `aud` must equal it. (Matched
    locally: the registry only checks that `aud` is non-empty, not that it equals
    you. That check is yours.)
  - `requireScopes` — checked against the trustworthy `effective_scope`.
  - `minTier` — `email | domain | verified | kyb_individual | kyb_organization`.
  - `blockedOperators` / `approvedOperators` — deny/allow lists by operator id.
  - `registryBaseUrl` — defaults to `https://registry.axisprime.ai`.
- **`aitGate(opts)`** — returns `(request) => Promise<verdict>`; binds your policy
  to a request gate for Workers and any `fetch`-style `Request`. Pulls the AIT
  from `Authorization: Bearer <ait>`, `X-AXIS-Token`, or `?ait=`.
- **`axisGate(opts)`** *(subpath `axis-platform-sdk/express`)* — the same as
  Express/Connect middleware: `(req, res, next)`. On accept it sets `req.axis` and
  calls `next()`; on deny it responds `401` / `403` / `503` with `{ error,
  message }`. Imports nothing from Express (zero-dep), so it also works on Connect
  and bare `http`.
- **`denialResponse(verdict)`** — turns a denied verdict into a 401/403 `Response`.
- **`scopeCovers(granted, required)` / `coversAll(granted, required[])`** — the
  AXIS scope matcher (ported verbatim from the operator-side gateway's, so
  operator and platform sides agree).
- **`enrich(agentId, token, opts)`** — fetch the agent's presentation layer
  (display name, tier) for a console UI.
- **`loadAccessPolicy(platformBaseUrl)`** — read a platform's published
  `/.well-known/axis-access` door policy.
- **`decodeAitPayload(token)`** — read the AIT payload (claims) without verifying.
  For the `aud` check; never trust it for authorization.
- **`AccessLedger` / `MemoryLedgerStore` / `loggedGate(gate, ledger, opts)` /
  `recordEntry(verdict, opts)`** — the access ledger (who showed up). `loggedGate`
  wraps a gate so every verdict is logged.
- **`Blocklist` / `MemoryBlocklistStore` / `gatedWithBlocklist(gate, blocklist)`**
  — the runtime block list (by operator and by agent). `blockOperator` /
  `blockAgent` / `unblock*` / `isAgentBlocked` / `blockedOperatorIds` /
  `checkVerdict`.
- **`reportFlag(args, opts)` / `blockAndReport(blocklist, args, opts)`** — sign a
  negative Trust Attestation and send it to a reputation index (OFF by default).
- **`getPlatformKey(opts)` / `buildAttestation` / `signAttestation` /
  `verifyAttestation` / `MemoryKeyStore`** — the platform's Ed25519 key + TA
  build/sign/verify primitives (WebCrypto, zero-dep).

### Gates as policy: `SwitchAuthorizer` (the free-tier engine)

Identity verification is fixed and core. The authorization *decision* is a
pluggable layer — the **Authorizer port**. `SwitchAuthorizer` is the free-tier
implementation: config-driven on/off gates. Its `policy` object is exactly what a
console's "door policy" screen edits and saves.

```js
import { SwitchAuthorizer, denialResponse } from 'axis-platform-sdk';

const door = new SwitchAuthorizer({
  audience: 'comments.mysite.com',
  defaultAllow: false,
  gates: {
    'content:comment': { enabled: true, requireScopes: ['content:comment'], minTier: 'domain' },
  },
});

const verdict = await door.gate('content:comment')(request);
if (!verdict.accepted) return denialResponse(verdict);
```

Flip `enabled: false` and the gate closes, no code change. The port is
engine-agnostic: a paid `EngineAuthorizer` (Permify / OpenFGA sidecar) for
granular relationship/attribute rules drops into the same slot with the same
`authorize(token, gateId, ctx)` shape. The demo and free tier need no engine.

### Stateful half: ledger, blocklist, reputation report-back

`verifyAgent` / `aitGate` are stateless verdict machines. A self-hosting platform
also needs **state it owns**: a record of who showed up, a runtime block list, and
a way to report a bad actor onward. These three modules add that, all zero-infra —
the platform runs the stores in its OWN store (default in-memory; plug in D1 /
SQLite / Postgres via a documented adapter shape).

```js
import { aitGate, AccessLedger, loggedGate } from 'axis-platform-sdk';

const ledger = new AccessLedger();                 // default in-memory store
const gate = loggedGate(aitGate({ audience }), ledger, { audience });

const verdict = await gate(request);               // every verdict is logged
await ledger.recent({ limit: 25 });                // newest-first arrivals
await ledger.byOperator('axis:acme:op');           // arrivals from one operator
```

Each entry records `{ agent_id, operator_id, created_at, tier, delegation_valid,
effective_scope, gate_id, requested_action, display_name, decision, reason,
audience }` — the same shape the cloud-hosted version uses for its `arrivals`
record, so the SDK and the cloud product share one arrival definition. `decision`
is `auto_allow | denied |
held | approved | booted`; `created_at` is epoch ms. Only the trustworthy
`effective_scope` is recorded, never the AIT's self-declared scope. A ledger write
failure never changes the verdict.

```js
import { Blocklist, verifyAgent } from 'axis-platform-sdk';

const blocklist = new Blocklist();
await blocklist.blockAgent('axis:acme:bot', 'spammed');     // agent-level
await blocklist.blockOperator('axis:bad:op', 'whole op');   // operator-level

let verdict = await verifyAgent(token, {
  audience,
  blockedOperators: [...staticBlocked, ...(await blocklist.blockedOperatorIds())],
});
verdict = await blocklist.checkVerdict(verdict);   // flips to denied if agent/op blocked
```

When you boot an agent, you know something the network doesn't. `reportFlag`
builds a protocol-shaped Trust Attestation (AXIS Layer 3; SPEC §4.5), signs it
with the platform's own Ed25519 key (generated + persisted on first use via
`getPlatformKey`, WebCrypto), and POSTs it to a configurable reputation index.
Report-back is **OFF by default** — unconfigured, it's a graceful no-op. The
reputation index is a separate, future, commercial service — NOT the canonical
registry (which stays identity-only). See `examples/bouncer-worker.js` for a
reference admin surface over the ledger + blocklist, and `templates/` for the
deployable starters.

### Single source of truth: the SDK is the port, the cloud-hosted version is the adapter

| SDK (this package, the port)        | Cloud-hosted version (the D1-backed product adapter) |
| ----------------------------------- | ----------------------------------------------- |
| `AccessLedger` + `recordEntry`      | `arrivals` table + `recordArrival()`            |
| `Blocklist` (operator-level)        | `operator_blocks` table + `blockedOperators()`  |
| `SwitchAuthorizer` `policy`         | `door_policy` table (serialized policy)         |
| `Blocklist` agent-level *(superset)* | *(not yet — an additive `agent_blocks` table)*  |
| `reportFlag` / reputation emit *(new)* | *(not yet — the open emit half is here)*      |

The entry/meta shapes are deliberately byte-compatible with the cloud-hosted
version's columns so there is **one** arrival/block record across the SDK and the
cloud product — fold in, don't duplicate. A platform that needs its own store
implements the documented adapter shape; the cloud-hosted version (in alpha) is the
worked example of doing exactly that over Cloudflare D1.

## Install

```
npm install axis-platform-sdk
```

Zero dependencies. Node 20+, Cloudflare Workers, modern browsers. Ships TypeScript
declarations (the package is authored in plain JS).

## Staying up to date

The self-host path needs no account, so we don't know who's running it (by design)
and can't push you notices. Updates are **pull-based**:

- **Versioning is semver.** Patch/minor releases are backward-compatible; anything
  breaking is a major. Pin a caret range (`^`) and you get safe updates.
- **Watch the channel:** [GitHub Releases](https://github.com/MachinesOfDesire/axis-platform-sdk/releases)
  and the [CHANGELOG](CHANGELOG.md) are the source of truth for what changed. Use
  Dependabot or Renovate to get an automatic PR when a new version ships.
- **The verification protocol is versioned too.** The registry's `/verify` contract
  is backward-compatible within a protocol major; deprecations are announced in
  Releases ahead of removal.

An opt-in updates list for platform integrators (security and breaking-change
notices) is planned. Until then, watching the repo is the way.

## License

Apache-2.0. © Kipple Labs, Inc.
