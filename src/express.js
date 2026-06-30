/**
 * Express / Connect adapter — `axisGate` as first-class middleware.
 *
 * This is the platform-side drop-in for Node web apps. Wrap a route and the
 * presenting agent is verified against the registry + your policy before your
 * handler runs:
 *
 *   import { axisGate } from 'axis-platform-sdk/express';
 *
 *   app.post('/comments',
 *     axisGate({ audience: 'comments.mysite.com', requireScopes: ['content:comment'] }),
 *     (req, res) => res.json({ ok: true, by: req.axis.agent_id })); // verified agent
 *
 * Zero-dependency: this module does NOT import express. The middleware is plain
 * `(req, res, next)`, so it also works with Connect, restify, and any framework
 * that uses the same signature. On accept it sets `req.axis` (the verdict) and
 * calls `next()`; on deny it responds 401 (no token) / 403 (policy) / 503
 * (unexpected verify error) with `{ error, message }`.
 */
import { verifyAgent } from './verify.js';

/**
 * Pull the AIT off a Node request. Order: `Authorization: Bearer <ait>`, then
 * `X-AXIS-Token`, then `?ait=` (from `req.query`, as Express populates it).
 */
export function extractToken(req) {
  const h = (req && req.headers) || {};
  const auth = h['authorization'] || h['Authorization'];
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const xa = h['x-axis-token'] || h['X-AXIS-Token'];
  if (xa) return Array.isArray(xa) ? xa[0] : xa;
  if (req && req.query && req.query.ait) return String(req.query.ait);
  return null;
}

/**
 * Build an Express/Connect middleware bound to your platform's policy. `opts`
 * are passed straight to `verifyAgent` (audience, requireScopes, minTier,
 * blockedOperators/approvedOperators, registryBaseUrl, fetchImpl).
 *
 * @param {object} opts
 * @returns {(req, res, next) => Promise<void>}
 */
export function axisGate(opts = {}) {
  return async function axisGateMiddleware(req, res, next) {
    let verdict;
    try {
      verdict = await verifyAgent(extractToken(req), opts);
    } catch (err) {
      // verifyAgent already maps registry-unreachable to a deny verdict; this
      // only catches a truly unexpected throw. Fail closed.
      verdict = { accepted: false, code: 'verify_error', reason: String((err && err.message) || err) };
    }
    req.axis = verdict;
    if (verdict.accepted) return next();

    const status = verdict.code === 'no_token' ? 401 : verdict.code === 'verify_error' ? 503 : 403;
    const payload = { error: verdict.code || 'denied', message: verdict.reason };
    // Prefer Express helpers; fall back to the bare Node response API so this
    // also works on Connect / http.Server without Express's res.json.
    if (res && typeof res.status === 'function' && typeof res.json === 'function') {
      return void res.status(status).json(payload);
    }
    res.statusCode = status;
    if (typeof res.setHeader === 'function') res.setHeader('Content-Type', 'application/json');
    return void res.end(JSON.stringify(payload));
  };
}
