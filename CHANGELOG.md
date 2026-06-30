# Changelog

All notable changes to `axis-platform-sdk`.

## [0.3.0] — Unreleased

Productization pass: repackages the published SDK as a free, drop-in **product
for platforms** — the platform-side equivalent of the AXIS Prime MCP's tester
packaging — and adds a first-class Express/Connect adapter. The engine
(`verify` / `authorizer` / `ledger` / `blocklist` / `reportback`) is unchanged.

### Added — Express/Connect middleware (new subpath export)

- **`axis-platform-sdk/express`** exports **`axisGate(opts)`** (and `extractToken`)
  — the same verify-and-bounce logic as `aitGate`, but as Express/Connect
  middleware `(req, res, next)`. On accept it sets `req.axis` and calls `next()`;
  on deny it responds `401` (no token) / `403` (policy) / `503` (unexpected verify
  error) with `{ error, message }`. Zero-dependency: it imports nothing from
  Express, so it also runs on Connect, restify, and bare `http`. Ships
  `src/express.d.ts` and an `exports` map entry. 6 new unit tests (suite now 46).
  This is the first-class home for the Node drop-in (previously a copy-paste
  template file).

### Added — adoption tiers, badge kit, forward-compat docs

- **Adoption tiers (A/B/C)** documented in the README: identity acceptance →
  access policy → scope/tier enforcement, all the same `verifyAgent` call with more
  options set.
- **"Verified by AXIS" badge kit** (`badges/`): three zero-dependency SVGs (light,
  dark, compact) for platforms that show verification status on agent-authored
  content, plus a usage README. Shipped in the package `files`.
- **Forward-compatibility note** on provenance gating: account-age / signup-method /
  abuse-flag signals are protocol-defined but not yet registry-exposed; when they
  ship they arrive as additive optional `verifyAgent` options + additive verdict
  fields — no breaking change for existing integrations.
- **"Staying up to date"** section: self-host is pull-based (semver + GitHub
  Releases + CHANGELOG; Dependabot/Renovate); an opt-in integrator updates list is
  planned.

### Added — product wrapper (docs + drop-in starters)

- **README rewritten as a product pitch** ("let verified agents into your
  platform; boot the bad ones; free, drop-in, no account required"). The full API
  reference is preserved lower in the same file. Headlines the free, standalone,
  registry-only path; positions Owyhee "The Door" as the optional managed upgrade,
  not a requirement.
- **`QUICKSTART.md`** — "gate your platform in 10 minutes": pick a starter →
  decide audience + scope → drop in the gate → publish `/.well-known/axis-access`
  → test a deny → test an admit.
- **`templates/node-express/`** — a complete, runnable Express drop-in: a ~30-line
  `axisGate(...)` middleware (`axis-gate.js`), a full worked server with door
  policy + arrivals ledger + runtime blocklist + `/admin` console, and a `smoke`
  test that asserts the deny paths against the live registry (verified passing).
- **`templates/cloudflare-worker/`** — the same as a deployable Worker
  (`wrangler dev` / `wrangler deploy`), promoting `examples/bouncer-worker.js`
  into a clean starter with `wrangler.toml` + `package.json`.
- **`CASE-STUDY-offworld.md`** — the Offworld News comment-gating integration,
  explicitly labeled as a case study (an example of using the tool), not the
  product.

### Notes

- Standard scope vocabulary: starters and docs use `content:comment` (the standard
  AXIS scope for commenting), not the older non-standard `comments:write`.
- `examples/` are left in place as teaching references; `templates/` are the
  copy-paste starting point. `templates/` is added to the published `files` list.
- The only code change is the additive `src/express.js` adapter + its `.d.ts` and
  `exports` entry; the existing engine modules are untouched. The 40 prior tests
  are unchanged (suite now 46 with the Express tests). The previously published
  surface remains fully backward-compatible — `/express` is purely additive.

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
