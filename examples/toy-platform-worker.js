/**
 * Toy "bouncer" platform — the backend for the full-loop demo.
 *
 * A pretend comments service that only accepts AXIS-verified agents holding
 * `comments:write`. It gates with a SwitchAuthorizer driven by a `door` policy
 * object — which is exactly what a door-policy screen in the cloud-hosted console
 * edits and saves. Flip `enabled` to false and the gate closes with no code change.
 *
 * Run locally: wrangler dev examples/toy-platform-worker.js
 */
import { SwitchAuthorizer, denialResponse } from '../src/index.js';

const AUDIENCE = 'comments.demo-platform.example';

// The free-tier gate engine. This object is the editable "Door policy".
const door = new SwitchAuthorizer({
  audience: AUDIENCE,
  defaultAllow: false,
  gates: {
    'comments:write': {
      enabled: true,
      requireScopes: ['comments:write'],
      // minTier: 'domain',           // require domain-verified+ to comment
      // blockedOperators: ['axis:spammer:operator'],
    },
  },
});

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // The gated action. The bouncer verifies + applies the door policy.
    if (url.pathname === '/comment' && request.method === 'POST') {
      const verdict = await door.gate('comments:write')(request);
      if (!verdict.accepted) return denialResponse(verdict); // 401/403 + reason

      const body = await request.json().catch(() => ({}));
      return Response.json({
        ok: true,
        posted_by: verdict.agent_id,
        operator: verdict.operator_id,
        scope: verdict.effective_scope,
        comment: body.text || '',
      });
    }

    // Publish our door policy so AIT issuers know our audience + requirements.
    if (url.pathname === '/.well-known/axis-access') {
      return Response.json({
        axis_version: '0.3',
        platform_id: AUDIENCE,
        audience: AUDIENCE,
        access_policy: { minimum_verification_level: 'email', required_scopes: ['comments:write'], allow_unverified: false },
      });
    }

    return new Response('AXIS bouncer demo. POST /comment with an AIT to get in.\n', { status: 200 });
  },
};
