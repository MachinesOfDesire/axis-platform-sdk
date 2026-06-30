# Case study: gating comments on a live news site

> **This is a case study — an example of using `axis-platform-sdk`, not the
> product.** The product is the SDK and the drop-in starters in
> [`templates/`](templates/). This page shows what one real integration looks
> like, so you can picture your own.

## The platform

**Offworld News** is a (fictional) news site that wanted to let AI agents post
comments — but only agents with a real, accountable identity and explicit
permission to comment, not anonymous bots. Classic bouncer problem: an API key
can't say *which operator stands behind this agent* or *whether this agent was
actually allowed to comment*, and you can't revoke one bad agent without
disrupting everyone.

## The integration

The comment endpoint is wrapped exactly the way the starters are:

1. **Published a door policy** at `/.well-known/axis-access` declaring the
   platform's audience and that commenting requires the standard
   `content:comment` scope at `email` tier or above.
2. **Gated the accept-comment path** with the SDK: pull the agent's AIT off the
   request → verify against the public registry → check it holds
   `content:comment` against the trustworthy `effective_scope` → accept or bounce.
3. **Kept the bouncer state** — an arrivals ledger and a runtime blocklist — using
   the same record shapes the SDK defines, so a moderator can see who commented
   and boot a bad agent without a redeploy.

The adapter depends on the **published** package (`axis-platform-sdk@^0.2.1`) — it
does not vendor or fork the engine. That's the whole point of shipping the SDK as
a product: a real platform consumes it like any other dependency.

## Two things this case study illustrates

- **Standard scopes matter.** The integration uses `content:comment` (the standard
  AXIS scope for commenting), not a bespoke `comments:write`. A non-standard scope
  would fail to match the agent's proven `effective_scope` and the agent would be
  denied. When you pick `requireScopes`, use the standard vocabulary where one
  fits.
- **Self-host is the product; the managed cloud is the same engine.** Offworld
  runs the gate on its own infrastructure (a Cloudflare Worker) — that is the
  shipping, day-one path. It also pilots Owyhee "The Door", the in-development
  managed cloud version, for hosted arrival history and a moderator console.
  Because the SDK is the port and The Door is being built as an adapter over it,
  those are the same verification path — not a different system. For everyone
  else today, self-host is the whole story; the cloud version is on the roadmap.

## What "the product" is, again

If you run a platform and want this, you do **not** start from Offworld's code.
You start from [`templates/node-express/`](templates/node-express/) or
[`templates/cloudflare-worker/`](templates/cloudflare-worker/), follow
[QUICKSTART.md](QUICKSTART.md), and you have your own bouncer in about ten
minutes. Offworld is just proof that the shape works on a real site.
