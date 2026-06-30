/**
 * worker.js — a complete, deployable AXIS-gated platform on Cloudflare Workers.
 *
 * A pretend comments service that only accepts AXIS-verified agents holding
 * `content:comment`, with the stateful half a real platform needs: an access
 * ledger ("who showed up") and a runtime blocklist ("boot this one"), plus a
 * tiny admin console over both.
 *
 *   npm install
 *   npx wrangler dev        # local:  http://localhost:8787
 *   npx wrangler deploy     # ship it
 *
 * What's the "real" integration vs. the demo scaffolding?
 *   - the SwitchAuthorizer door policy   -> COPY; it's your editable gate config.
 *   - the gate + ledger + blocklist wiring on POST /comments -> COPY.
 *   - the in-memory stores               -> SWAP for D1 / KV in production (the
 *                                           stores reset when the isolate recycles).
 *   - the /admin HTML                    -> demo only; build your own console.
 */
import {
  SwitchAuthorizer,
  verifyAgent,
  extractToken,
  denialResponse,
  AccessLedger,
  Blocklist,
  enrich,
  blockAndReport,
} from 'axis-platform-sdk';

const AUDIENCE = 'comments.demo-platform.example'; // your platform's stable audience id
const PLATFORM_ID = 'axis:demo-platform:door';     // this platform's AXIS id (attestor on boot-reports)
// const REPUTATION_URL = 'https://axis-reputation.example/attestations'; // OFF by default

// The editable "Door policy": named gates, each on/off, with optional tier/scope.
const door = new SwitchAuthorizer({
  audience: AUDIENCE,
  defaultAllow: false,
  gates: {
    'content:comment': {
      enabled: true,
      requireScopes: ['content:comment'],
      // minTier: 'domain',
      // blockedOperators: ['axis:spammer:operator'],
    },
  },
});

// Stateful stores. In-memory reference (resets on isolate recycle); swap in
// D1 / KV via the documented adapter shape for production.
const ledger = new AccessLedger();
const blocklist = new Blocklist();

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // --- the gated action ---------------------------------------------------
    if (url.pathname === '/comments' && request.method === 'POST') {
      const base = door.optsForGate('content:comment');
      const dynBlocked = await blocklist.blockedOperatorIds();
      let verdict = await verifyAgent(extractToken(request), {
        ...base,
        blockedOperators: [...(base.blockedOperators || []), ...dynBlocked],
      });
      verdict = await blocklist.checkVerdict(verdict);

      await ledger.record(verdict, { audience: AUDIENCE, gate_id: 'content:comment', requested_action: 'post a comment' }).catch(() => {});

      if (!verdict.accepted) return denialResponse(verdict);
      const body = await request.json().catch(() => ({}));
      return Response.json({ ok: true, posted_by: verdict.agent_id, operator: verdict.operator_id, scope: verdict.effective_scope, comment: body.text || '' });
    }

    // --- publish your door policy ------------------------------------------
    if (url.pathname === '/.well-known/axis-access') {
      return Response.json({
        axis_version: '0.3',
        platform_id: AUDIENCE,
        audience: AUDIENCE,
        access_policy: { minimum_verification_level: 'email', required_scopes: ['content:comment'], allow_unverified: false },
      });
    }

    // --- admin: recent arrivals (enriched for display) ----------------------
    if (url.pathname === '/admin/arrivals' && request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') || 25);
      const rows = await ledger.recent({ limit });
      const enriched = await Promise.all(rows.map(async (r) => {
        if (!r.agent_id) return r;
        try {
          const info = await enrich(r.agent_id, null);
          return { ...r, display_name: info.display_name, tier: info.tier };
        } catch {
          return r;
        }
      }));
      return Response.json({ arrivals: enriched });
    }

    // --- admin: boot an agent or operator (block + best-effort report) ------
    if (url.pathname === '/admin/boot' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const reason = body.reason || 'booted by platform admin';
      if (body.agent_id) {
        const out = await blockAndReport(
          blocklist,
          { platformId: PLATFORM_ID, agentId: body.agent_id, operatorId: body.operator_id, category: body.category || 'abuse', reason },
          { /* reputationUrl: REPUTATION_URL */ }
        );
        return Response.json({ ok: true, ...out });
      }
      if (body.operator_id) {
        await blocklist.blockOperator(body.operator_id, reason);
        return Response.json({ ok: true, blocked_operator: body.operator_id });
      }
      return Response.json({ ok: false, error: 'provide agent_id or operator_id' }, { status: 400 });
    }

    // --- admin: tiny HTML console ------------------------------------------
    if (url.pathname === '/admin') {
      return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return new Response('AXIS-gated comments demo. POST /comments with an AIT to get in. See /admin.\n', { status: 200 });
  },
};

const ADMIN_HTML = `<!doctype html><meta charset=utf-8>
<title>AXIS bouncer — admin</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:2rem;max-width:60rem}
 h1{font-size:1.2rem} table{border-collapse:collapse;width:100%;margin:1rem 0}
 th,td{border:1px solid #ccc;padding:.35rem .5rem;text-align:left;font-size:13px}
 .denied,.booted{color:#b00} .auto_allow,.approved{color:#070} .held{color:#a60}
 button{cursor:pointer} code{background:#f3f3f3;padding:0 .25rem}
</style>
<h1>AXIS bouncer — arrivals</h1>
<p>Who showed up at <code>${AUDIENCE}</code>. Click <b>boot</b> to block + report an agent.</p>
<table id=t><thead><tr><th>when</th><th>agent</th><th>operator</th><th>scope</th><th>decision</th><th></th></tr></thead><tbody></tbody></table>
<script>
async function load(){
 const r=await fetch('/admin/arrivals?limit=50');const {arrivals}=await r.json();
 const tb=document.querySelector('#t tbody');tb.innerHTML='';
 for(const a of arrivals){
  const tr=document.createElement('tr');
  const name=a.display_name?a.display_name+' ':'';
  const when=a.created_at?new Date(a.created_at).toISOString().replace('T',' ').slice(0,19):'';
  tr.innerHTML='<td>'+when+'</td><td>'+name+'<code>'+(a.agent_id||'?')+'</code></td>'+
    '<td><code>'+(a.operator_id||'?')+'</code></td><td>'+(a.effective_scope||[]).join(', ')+'</td>'+
    '<td class="'+a.decision+'">'+a.decision+'</td>'+
    '<td>'+(a.agent_id?'<button data-a="'+a.agent_id+'">boot</button>':'')+'</td>';
  tb.appendChild(tr);
 }
 tb.querySelectorAll('button').forEach(b=>b.onclick=async()=>{
  await fetch('/admin/boot',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({agent_id:b.dataset.a,reason:'booted from console',category:'abuse'})});
  load();
 });
}
load();
</script>`;
