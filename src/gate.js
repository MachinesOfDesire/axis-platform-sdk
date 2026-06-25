/**
 * aitGate — a drop-in request gate for a consuming platform (the "bouncer").
 *
 * Wrap your handler: pull the AIT off the incoming request, verify it against
 * the registry + your policy, and either let it through or bounce it.
 *
 *   import { aitGate, denialResponse } from 'axis-platform-sdk';
 *
 *   const gate = aitGate({ audience: 'comments.mysite.com', requireScopes: ['comments:write'] });
 *
 *   export default {
 *     async fetch(request) {
 *       const verdict = await gate(request);
 *       if (!verdict.accepted) return denialResponse(verdict);
 *       // ...verdict.agent_id is verified; proceed.
 *     }
 *   };
 */
import { verifyAgent } from './verify.js';

/**
 * Pull the AIT off a request. Accepts a Fetch API Request, or any object with
 * a `headers` (Headers or plain object) and optional `url`. Looks at, in order:
 * Authorization: Bearer <ait>, X-AXIS-Token, ?ait= query param.
 */
export function extractToken(request) {
  const h = request && request.headers;
  const get = (k) => {
    if (!h) return null;
    if (typeof h.get === 'function') return h.get(k);
    return h[k] || h[k.toLowerCase()] || null;
  };
  const auth = get('authorization') || get('Authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const xa = get('x-axis-token') || get('X-AXIS-Token');
  if (xa) return xa;
  try {
    if (request && request.url) {
      const q = new URL(request.url).searchParams.get('ait');
      if (q) return q;
    }
  } catch {
    /* not a URL; ignore */
  }
  return null;
}

/**
 * Build a gate function bound to your platform's policy. Returns
 * `(request) => Promise<verdict>`.
 */
export function aitGate(opts = {}) {
  return async function gate(request) {
    const token = extractToken(request);
    return verifyAgent(token, opts);
  };
}

/**
 * Turn a denied verdict into an HTTP Response (403 by default). 401 when no
 * token was presented at all.
 */
export function denialResponse(verdict, status) {
  const code = verdict && verdict.code;
  const httpStatus = status || (code === 'no_token' ? 401 : 403);
  return new Response(
    JSON.stringify({ error: code || 'denied', message: verdict ? verdict.reason : 'Denied' }),
    { status: httpStatus, headers: { 'Content-Type': 'application/json' } }
  );
}
