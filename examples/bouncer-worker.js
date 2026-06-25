/**
 * Reference bouncer — the STATEFUL demo.
 *
 * The toy-platform-worker shows the stateless verdict path (verify + door
 * policy). THIS worker adds the stateful half: an access ledger ("who showed
 * up") and a runtime blocklist ("boot this one"), plus a tiny admin surface
 * over both. It's a REFERENCE — wiring you'd copy into a real platform — not a
 * product. The stores here are in-memory, so state resets when the isolate
 * recycles; a real deployment plugs D1 / KV / Postgres into the same adapter
 * shape (see ledger.js / blocklist.js).
 *
 * Run locally: wrangler dev examples/bouncer-worker.js
 *
 * Endpoints:
 *   POST /comment            the gated action (verify + ledger + blocklist)
 *   GET  /admin/arrivals     recent agents, enriched for display
 *   POST /admin/boot         { agent_id | operator_id, reason } -> block + report
 *   GET  /admin              a tiny HTML page over the two above
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
} from '../src/index.js';

const AUDIENCE = 'comments.demo-platform.example';
const PLATFORM_ID = 'axis:demo-platform:door'; // this platform's AXIS id, the attestor on reports
// const REPUTATION_URL = 'https://axis-reputation.example/attestations'; // OFF by default

// Stateless verdict engine (the editable "Door policy").
const door = new SwitchAuthorizer({
  audience: AUDIENCE,
  defaultAllow: false,
  gates: { 'comments:write': { enabled: true, requireScopes: ['comments:write'] } },
});

// Stateful stores (in-memory reference; swap in D1/KV/Postgres in production).
const ledger = new AccessLedger();
const blocklist = new Blocklist();

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // --- the gated action ---------------------------------------------------
    if (url.pathname === '/comment' && request.method === 'POST') {
      // Inject runtime operator-blocks into the policy, then verify.
      const dynBlocked = await blocklist.blockedOperatorIds();
      const base = door.optsForGate('comments:write');
      let verdict = await verifyAgent(extractToken(request), {
        ...base,
        blockedOperators: [...(base.blockedOperators || []), ...dynBlocked],
      });
      // Agent-level runtime block (needs the resolved agent_id from the verdict).
      verdict = await blocklist.checkVerdict(verdict);

      // Log the arrival regardless of decision.
      await ledger.record(verdict, { audience: AUDIENCE }).catch(() => {});

      if (!verdict.accepted) return denialResponse(verdict);
      const body = await request.json().catch(() => ({}));
      return Response.json({ ok: true, posted_by: verdict.agent_id, comment: body.text || '' });
    }

    // --- admin: recent arrivals (enriched for display) ----------------------
    if (url.pathname === '/admin/arrivals' && request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') || 25);
      const rows = await ledger.recent({ limit });
      // Enrich accepted arrivals with display name / tier for the console. We
      // have no AIT here (presentation layer needs one), so this resolves only
      // the public layer — display_name/tier may be null. That's expected.
      const enriched = await Promise.all(
        rows.map(async (r) => {
          let display_name = null;
          let tier = null;
          if (r.agent_id) {
            try {
              const info = await enrich(r.agent_id, null);
              display_name = info.display_name;
              tier = info.tier;
            } catch {
              /* registry unreachable; show raw id */
            }
          }
          return { ...r, display_name, tier };
        })
      );
      return Response.json({ arrivals: enriched });
    }

    // --- admin: boot an agent or operator (block + best-effort report) ------
    if (url.pathname === '/admin/boot' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const reason = body.reason || 'booted by platform admin';
      if (body.agent_id) {
        // Block the agent locally AND report it (no-op send unless REPUTATION_URL set).
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

    return new Response('AXIS stateful bouncer reference. See /admin.\n', { status: 200 });
  },
};

const ADMIN_HTML =`<!doctype html><meta charset=utf-8>
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
