# AXIS gate — Cloudflare Worker starter

Gate a Cloudflare Worker on **AXIS verified-agent identity**. When an AI agent
shows up and wants to act, this verifies *who it is* and *what it's allowed to
do* before your handler runs.

Use this template if your platform already runs on Workers. **You do not need to
adopt Cloudflare just to use AXIS** — if you run a Node backend, use the
`node-express` starter instead. Both wrap the same zero-dependency engine.

## Run it

```bash
npm install
npx wrangler dev        # http://localhost:8787
```

```bash
# Your published door policy:
curl -s localhost:8787/.well-known/axis-access

# No AIT -> 401:
curl -i -X POST localhost:8787/comments -H 'content-type: application/json' -d '{"text":"hi"}'

# Arrivals + boot console:
open http://localhost:8787/admin
```

## Deploy it

```bash
npx wrangler deploy
```

No bindings are required for the free standalone path — the Worker's only
outbound call is one HTTPS GET to the public AXIS registry.

## The drop-in

The minimal version is a few lines:

```js
import { aitGate, denialResponse } from 'axis-platform-sdk';

const gate = aitGate({ audience: 'comments.mysite.com', requireScopes: ['content:comment'] });

export default {
  async fetch(request) {
    const verdict = await gate(request);
    if (!verdict.accepted) return denialResponse(verdict); // 401/403 + reason
    // verdict.agent_id is verified. Proceed.
    return Response.json({ ok: true, by: verdict.agent_id });
  },
};
```

`src/worker.js` is the fuller version: a `SwitchAuthorizer` door policy (named
on/off gates you can edit like config), an access ledger ("who showed up"), a
runtime blocklist ("boot this one"), and a tiny `/admin` console.

## Options

`aitGate(opts)` / `verifyAgent(token, opts)` take:

| option | meaning |
| --- | --- |
| `audience` | Your platform's stable id. The AIT's `aud` must equal it. |
| `requireScopes` | Scopes checked against the trustworthy `effective_scope`. |
| `minTier` | `email` < `domain` < `verified` < `kyb_individual` < `kyb_organization`. |
| `blockedOperators` / `approvedOperators` | Deny / allow by operator id. |
| `registryBaseUrl` | Defaults to `https://registry.axisprime.ai`. |

## Persisting state in production

The in-memory ledger/blocklist reset when the isolate recycles. For durable
arrivals + blocks, add a D1 binding in `wrangler.toml` and implement the SDK's
documented store adapter shape against it (see `ledger.js` / `blocklist.js` in
the SDK). The arrival record shape is byte-compatible with the cloud-hosted version
(in alpha, Q3 2026), so moving to it later is a lift, not a rewrite.
