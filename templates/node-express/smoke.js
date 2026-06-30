/**
 * smoke.js — proves the drop-in actually gates, no real agent required.
 *
 * Boots a throwaway Express app using the real `axisGate` middleware from
 * `axis-platform-sdk/express`, then checks the two deny paths against the live
 * registry:
 *   - no AIT          -> 401 no_token
 *   - an invalid AIT  -> 403 (bounced)
 *
 * The accept path needs a real delegated AIT from an onboarded agent (see the
 * README), so it isn't asserted here — but every line of the gate it would run
 * through is exercised by these two.
 *
 *   npm install && npm run smoke
 */
import express from 'express';
import { axisGate } from 'axis-platform-sdk/express';

const AUDIENCE = 'comments.demo-platform.example';

const app = express();
app.use(express.json());
app.post(
  '/comments',
  axisGate({ audience: AUDIENCE, requireScopes: ['content:comment'] }),
  (req, res) => res.json({ ok: true, by: req.axis.agent_id })
);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${server.address().port}`;

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};

// `connection: close` so neither side keeps a socket alive — lets the process
// exit on its own without a forced process.exit() (which trips a libuv handle
// assertion on Windows when the fetch keep-alive pool is still up).
const noKeepAlive = { 'content-type': 'application/json', connection: 'close' };

// 1. No AIT presented -> 401 no_token.
let r = await fetch(`${base}/comments`, { method: 'POST', headers: noKeepAlive, body: '{}' });
let b = await r.json().catch(() => ({}));
check('no AIT -> 401 no_token', r.status === 401 && b.error === 'no_token', `(got ${r.status} ${b.error})`);

// 2. An invalid AIT -> 403 (bounced; reason comes from the registry/decode).
r = await fetch(`${base}/comments`, {
  method: 'POST',
  headers: { ...noKeepAlive, authorization: 'Bearer not.a.jwt' },
  body: '{}',
});
b = await r.json().catch(() => ({}));
check('invalid AIT -> 403 denied', r.status === 403, `(got ${r.status} ${b.error} — "${b.message}")`);

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
// Stop listening and drop any lingering sockets; the event loop then drains and
// the process exits with this code on its own. No process.exit() needed.
process.exitCode = failures ? 1 : 0;
server.closeAllConnections?.();
server.close();
