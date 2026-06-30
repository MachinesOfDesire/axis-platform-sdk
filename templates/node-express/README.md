# AXIS gate — Node / Express starter

Gate any Express platform on **AXIS verified-agent identity** in a few lines. When
an AI agent shows up and wants to act (post a comment, call your API, place an
order), this verifies *who it is* and *what it's allowed to do* before your
handler runs.

No Cloudflare. No account with us. No infra to stand up. The only network call is
one HTTPS GET to the public AXIS registry, which does the cryptography
(signature + revocation + delegation-chain walk) server-side and hands back a
trustworthy verdict.

## Run it

```bash
npm install
npm start         # http://localhost:8787
```

Then, in another terminal:

```bash
# Your published door policy (what agents must satisfy to get in):
curl -s localhost:8787/.well-known/axis-access

# No AIT -> 401. The bouncer turns away anyone who doesn't present an identity:
curl -i -X POST localhost:8787/comments -H 'content-type: application/json' -d '{"text":"hi"}'

# Open the admin console to watch arrivals and boot a bad agent:
open http://localhost:8787/admin
```

To prove the gate works without a real agent:

```bash
npm run smoke     # boots the real middleware, asserts the deny paths
```

## The whole integration is one import + one line

`axisGate` is a real export of the package — `axis-platform-sdk/express`. You
don't copy a file; you import it:

```js
import express from 'express';
import { axisGate } from 'axis-platform-sdk/express';

const app = express();
app.use(express.json());

app.post('/comments',
  axisGate({ audience: 'comments.mysite.com', requireScopes: ['content:comment'] }),
  (req, res) => {
    // req.axis.agent_id is a VERIFIED agent. Proceed with your real logic.
    res.json({ ok: true, by: req.axis.agent_id });
  });

app.listen(8787);
```

`axisGate(opts)` pulls the AIT off the request (`Authorization: Bearer …`,
`X-AXIS-Token`, or `?ait=`), verifies it, and either calls `next()` with
`req.axis` set to the verdict, or responds `401` (no token) / `403` (policy) /
`503` (unexpected verify error) with `{ error, message }`. It imports nothing
from Express, so it works with Connect and bare `http` servers too.

### Options (passed straight through to `verifyAgent`)

| option | meaning |
| --- | --- |
| `audience` | **Required-ish.** Your platform's stable id. The AIT's `aud` must equal it, so an agent's token for *another* site can't be replayed at yours. |
| `requireScopes` | Scopes the agent must hold, checked against the **trustworthy `effective_scope`** (the registry's chain-walked result — never the AIT's self-declared scope). |
| `minTier` | Minimum operator verification tier: `email` < `domain` < `verified` < `kyb_individual` < `kyb_organization`. |
| `blockedOperators` / `approvedOperators` | Deny-list / allow-list by operator id. |
| `registryBaseUrl` | Defaults to `https://registry.axisprime.ai`. Point at your own registry if you run one. |

## What `server.js` adds (the stateful bouncer)

A real platform wants more than a yes/no. `server.js` shows the rest, all
zero-infra by default:

- **Door policy as config** — a `SwitchAuthorizer` with named, on/off gates.
  Flip `enabled: false` and a gate closes with no code change. This object is
  exactly what a "door policy" admin screen would edit.
- **Access ledger** — every arrival (accepted *or* denied) is logged so you can
  answer "who's been using my platform."
- **Runtime blocklist** — boot one agent, or a whole operator, without a deploy.
- **`/admin` console** — a tiny HTML page listing arrivals with a **boot** button.

## Persisting state in production

The ledger and blocklist default to in-memory stores — fine for the demo, gone
when the process restarts. For production, implement the documented adapter
shape (a small CRUD interface) against whatever database you already run
(Postgres, SQLite, Redis, …) and pass it in:

```js
new AccessLedger({ store: myPostgresLedgerStore });
new Blocklist({ store: myPostgresBlocklistStore });
```

The adapter shape is documented in the SDK's `ledger.js` / `blocklist.js`. The
entry shape is byte-compatible with Owyhee "The Door" (the planned managed cloud
version), so if you move to it later, your arrival records already line up.

## Letting a real agent in

The accept path needs an agent that has actually been delegated `content:comment`
by its operator and presents an AIT addressed to your `audience`. That agent gets
its identity from the **[AXIS Prime MCP](https://github.com/MachinesOfDesire/axis-mcp)**
(the agent side). Point a test agent at your `audience`, have its operator grant
`content:comment`, and POST its AIT to `/comments` — you'll see a `200` and the
arrival turns green in `/admin`.
