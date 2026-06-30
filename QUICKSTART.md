# Gate your platform in 10 minutes

Goal: an endpoint on your platform that only accepts **AXIS-verified agents** with
the right permission, turns everyone else away with a clear reason, and lets you
boot a bad actor without a redeploy.

You need: Node 20+ (or a Cloudflare Workers project). You do **not** need an
account with us, a Cloudflare account (unless you choose the Worker path), a
database, or any hosted service. The free path is one outbound HTTPS call to the
public AXIS registry.

---

## 0. Pick a starter (1 min)

Copy the folder that matches your stack and work inside it:

- **Node / Express** → [`templates/node-express/`](templates/node-express/)
- **Cloudflare Workers** → [`templates/cloudflare-worker/`](templates/cloudflare-worker/)

Already have an app? Skip the copy and just `npm install axis-platform-sdk`, then
follow the inline code below.

```
npm install axis-platform-sdk     # zero dependencies
```

---

## 1. Decide two things (1 min)

- **Your audience** — a stable id for *your* platform, e.g. `comments.mysite.com`.
  Agents address their token to this; you reject tokens addressed to anyone else.
- **The scope an agent must hold** — e.g. `content:comment`. Use a standard AXIS
  scope where one fits (`content:comment` for commenting). This is checked against
  the agent's **proven** permission, not what its token claims.

---

## 2. Drop the gate in front of your action (3 min)

**Express:**

```js
import express from 'express';
import { axisGate } from 'axis-platform-sdk/express';   // first-class middleware export

const app = express();
app.use(express.json());

app.post('/comments',
  axisGate({ audience: 'comments.mysite.com', requireScopes: ['content:comment'] }),
  (req, res) => {
    // req.axis.agent_id is a VERIFIED agent id. Run your real handler.
    res.json({ ok: true, by: req.axis.agent_id });
  });

app.listen(8787);
```

**Cloudflare Worker:**

```js
import { aitGate, denialResponse } from 'axis-platform-sdk';

const gate = aitGate({ audience: 'comments.mysite.com', requireScopes: ['content:comment'] });

export default {
  async fetch(request) {
    const verdict = await gate(request);
    if (!verdict.accepted) return denialResponse(verdict);
    return Response.json({ ok: true, by: verdict.agent_id });
  },
};
```

The gate pulls the token from `Authorization: Bearer <ait>`, `X-AXIS-Token`, or
`?ait=`, verifies it against the registry, applies your policy, and either runs
your handler or returns `401` (no token) / `403` (bounced) with a real reason.

---

## 3. Publish your door policy (2 min)

Tell agents (and their operators) what your platform requires by serving a small
JSON document at **`/.well-known/axis-access`**:

```js
// GET /.well-known/axis-access
{
  "axis_version": "0.3",
  "platform_id": "comments.mysite.com",
  "audience": "comments.mysite.com",
  "access_policy": {
    "minimum_verification_level": "email",
    "required_scopes": ["content:comment"],
    "allow_unverified": false
  }
}
```

Both starters already serve this. An agent's tooling can read it with
`loadAccessPolicy('https://comments.mysite.com')` to know how to get in. (For a
live example, `curl https://registry.axisprime.ai/.well-known/axis-access`.)

---

## 4. Test the deny path — right now, no agent needed (1 min)

A request with no identity must be turned away:

```bash
curl -i -X POST localhost:8787/comments -H 'content-type: application/json' -d '{"text":"hi"}'
# HTTP/1.1 401 Unauthorized
# {"error":"no_token","message":"No AIT presented"}
```

The Express starter automates this:

```
npm run smoke
# PASS — no AIT -> 401 no_token
# PASS — invalid AIT -> 403 denied
```

If you see those, your bouncer is live and refusing unidentified traffic. That's
the free path working end-to-end against the public registry.

---

## 5. Test the accept path — let a real agent in (2 min)

To see a `200`, you need an agent that has actually been **delegated**
`content:comment` by its operator and presents a token addressed to your
`audience`. Agents get their identity from the
**[AXIS Prime MCP](https://github.com/MachinesOfDesire/axis-mcp)** (the agent
side):

1. The agent onboards via the MCP and registers with an operator.
2. The operator **grants** it `content:comment` (`axis grant content:comment`).
3. The agent mints an AIT with `aud = comments.mysite.com` and presents it:

```bash
curl -X POST https://comments.mysite.com/comments \
  -H "Authorization: Bearer <the-agents-AIT>" \
  -H 'content-type: application/json' \
  -d '{"text":"hello from a verified agent"}'
# {"ok":true,"posted_by":"axis:acme:bot","operator":"axis:acme:op","scope":["content:comment"], ... }
```

In the starter's `/admin` console, that arrival turns **green** — and you can
**boot** it (block + optionally report) with one click if it misbehaves.

---

## Where to go next

- **Require stronger identity:** add `minTier: 'domain'` (or `verified`,
  `kyb_organization`) to the gate to demand domain- or KYB-verified operators.
- **Persist arrivals + blocks:** the in-memory stores reset on restart. Implement
  the store adapter shape (see `ledger.js` / `blocklist.js` in the SDK) against
  your database. The record shape matches the cloud-hosted version, so moving to
  it later won't mean reshaping data.
- **Turn on reputation report-back:** set a `reputationUrl` so booting a bad agent
  emits a signed Trust Attestation onward. Off by default.
- **Don't want to host the console + state yourself?** A cloud-hosted version is in
  alpha testing (planned for Q3 2026) over this exact engine. For now, self-host is
  the way — and it's the whole product.
