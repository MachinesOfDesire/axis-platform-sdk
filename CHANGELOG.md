# Changelog

All notable changes to `axis-platform-sdk`. Pre-release; not yet published to npm.

## [0.2.1] — 2026-06-25

### Added — TypeScript declarations

- The package now ships `.d.ts` types (it stays authored in plain JS). A
  complete `src/index.d.ts` covers the full main-entry surface (verify,
  authorizer, scope, gate, client, ledger, blocklist, reportback); each subpath
  export (`./scope`, `./gate`, `./authorizer`, `./ledger`, `./blocklist`,
  `./reportback`) re-exports its slice. `package.json` exposes them via a
  top-level `types` field and per-subpath `types` conditions in `exports`.
- This lets TypeScript consumers (e.g. Owyhee "The Door", swapping its vendored
  copy for the npm dependency) drop their hand-maintained declaration and get
  types from the package. Verified by a clean-room install + strict `tsc` of a
  consumer importing from the root and a subpath.

## [0.2.0] — 2026-06-25

First npm publish + public repo. Adds the stateful half (ledger, blocklist,
reputation report-back) and reconciles it with Owyhee "The Door" (governor#27)
so the SDK and the product share one arrival/block shape.

### Added — the stateful half (ledger, blocklist, reputation report-back)

- **`AccessLedger` (`src/ledger.js`)** — the platform's "who showed up" record.
  Logs every verdict to a pluggable store (default in-memory `MemoryLedgerStore`;
  documented adapter shape for D1 / SQLite / Postgres). `recent()` / `byOperator()`
  query helpers. `loggedGate(gate, ledger, fields)` wraps any gate so verdicts are
  logged as a side effect (a store failure never changes the verdict). Only the
  trustworthy `effective_scope` is recorded.
- **`Blocklist` (`src/blocklist.js`)** — a runtime, stateful block list over the
  same adapter shape. Blocks by `operator_id` AND by `agent_id` (agent-level
  blocking is the SDK's superset over The Door's operator-only `operator_blocks`).
  `blockedOperatorIds()` feeds verifyAgent's `blockedOperators`; `checkVerdict()`
  enforces agent-level blocks post-verify (needs the resolved agent_id).
  `gatedWithBlocklist(gate, blocklist)` wraps a gate.

### Reconciled with The Door (single source of truth, no duplication)

- The ledger entry shape is now byte-compatible with The Door's `ArrivalRecord`
  / `arrivals` columns: carries `tier`, `delegation_valid`, `gate_id`,
  `requested_action`, `display_name`; `created_at` is epoch ms (was an ISO `ts`);
  `decision` uses the `auto_allow | denied | held | approved | booted` vocabulary
  (was `accepted | denied`), with the manual-review states available via a
  `recordEntry(..., { decision })` override.
- Blocklist meta is `{ reason, created_at }` (epoch ms), matching `operator_blocks`.
- The SDK is positioned as the **port + in-memory default**; The Door is the
  canonical **D1-backed adapter**. README documents the mapping table. The SDK
  ships the genuinely-new pieces The Door lacks (agent-level blocking, reputation
  emit); The Door keeps its own D1 state layer and, post-publish, depends on this
  package instead of vendoring it.
- **Reputation report-back (`src/reportback.js`)** — `reportFlag()` builds a
  protocol-shaped negative **Trust Attestation** (AXIS Layer 3; SPEC §4.5),
  signs it with the platform's own Ed25519 key (`getPlatformKey()`, WebCrypto,
  generated + persisted via a pluggable key store), and POSTs `{ attestation,
  platform_public_key, signature }` to a configurable `reputationUrl`. OFF by
  default — unconfigured is a graceful no-op (never throws). `blockAndReport()`
  blocks locally + reports. `buildAttestation` / `signAttestation` /
  `verifyAttestation` exposed. Zero-dep (no Buffer; WebCrypto + inline base64url
  + inline JCS, byte-for-byte matching axis-protocol-sdk's signing convention).
- **`examples/bouncer-worker.js`** — reference stateful bouncer: a Worker admin
  over the ledger + blocklist (`/admin/arrivals` enriched for display,
  `/admin/boot` = block + report, plus a tiny HTML console). A reference, not a
  product; in-memory stores.

### Notes

- The reputation index is a SEPARATE, future, commercial service — NOT the
  canonical registry, which stays identity-only (Layer 1 + Layer 2). The
  `axis-reputation` stub receiver accepts-and-discards until the index is built.
- New tests for ledger / blocklist / reportback + the Door-compatible shape.
  Full suite: 40 passing (`node --test`).

## [0.1.0] — 2026-06-16 (unreleased)

First cut of the platform/verifier ("bouncer") side of AXIS.

### Added

- **`verifyAgent(token, opts)`** — verifies an AIT against the registry
  (signature + revocation + delegation chain, all server-side) and applies a
  platform's policy (audience match, required scopes against the trustworthy
  `effective_scope`, blocked/approved operators, minimum verification tier).
  Returns one structured verdict.
- **`aitGate(opts)` / `extractToken()` / `denialResponse()`** — a drop-in
  request gate for Cloudflare Workers (and Request-like objects). Pulls the AIT
  from `Authorization: Bearer`, `X-AXIS-Token`, or `?ait=`.
- **`SwitchAuthorizer`** — the free-tier gate engine and the first implementation
  of the Authorizer port. Config-driven on/off gates with optional minimum tier,
  required scopes, and operator allow/block lists. Its `policy` object is what a
  "Door policy" screen edits and saves. The port is engine-agnostic so a paid
  `EngineAuthorizer` (Permify / OpenFGA sidecar) can drop into the same slot.
- **`scopeCovers` / `coversAll`** — AXIS scope matcher, ported verbatim from the
  operator-side gateway so both sides agree on scope semantics.
- **`enrich()`**, **`loadAccessPolicy()`**, **`decodeAitPayload()`** helpers.
- Worked example: `examples/toy-platform-worker.js` (a bouncer comments service
  gated by a `SwitchAuthorizer`).

### Tested

- 15 unit tests (`node --test`) across scope matching, the verify verdict
  matrix, and the SwitchAuthorizer gate logic. `loadAccessPolicy` additionally
  verified live against `registry.axisprime.ai`.

### Notes

- Zero runtime dependencies; runs in Node 20+, Cloudflare Workers, browsers.
- Identity verification is fixed/core; only the authorization decision is
  pluggable. The demo and the free tier need no external policy engine.
