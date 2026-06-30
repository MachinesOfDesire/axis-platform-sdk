/**
 * server.js — a complete, runnable AXIS-gated platform on Express.
 *
 * This is the worked example: a pretend comments service that only accepts
 * AXIS-verified agents holding `content:comment`, plus the stateful half a real
 * platform needs — an access ledger ("who showed up") and a runtime blocklist
 * ("boot this one") with a tiny admin console over both.
 *
 *   npm install
 *   npm start           # http://localhost:8787
 *
 * Then:
 *   curl -s localhost:8787/.well-known/axis-access | jq      # your published door policy
 *   curl -s -XPOST localhost:8787/comments -d '{"text":"hi"}' # 401: no AIT
 *   open http://localhost:8787/admin                          # arrivals + boot console
 *
 * The simplest integration is one import + one line:
 *   import { axisGate } from 'axis-platform-sdk/express';
 *   app.post('/comments', axisGate({ audience, requireScopes: ['content:comment'] }), handler);
 * This file shows the fuller, stateful version (door policy + ledger + blocklist
 * + admin) — it inlines verify + the runtime blocklist so it can log arrivals and
 * boot agents, which a bare `axisGate` doesn't do.
 *
 * What's the "real" integration vs. the demo scaffolding?
 *   - axisGate (from axis-platform-sdk/express) -> the one-liner above, for simple routes.
 *   - the SwitchAuthorizer door policy below   -> COPY; it's your editable gate config.
 *   - the AccessLedger + Blocklist wiring       -> COPY if you want arrivals/boot.
 *   - the in-memory stores                      -> SWAP for your DB in production
 *                                                  (see "Persisting state" in the README).
 *   - the /admin HTML                           -> demo only; build your own console.
 */
import express from 'express';
import {
  SwitchAuthorizer,
  verifyAgent,
  AccessLedger,
  Blocklist,
  enrich,
  blockAndReport,
} from 'axis-platform-sdk';
import { extractToken } from 'axis-platform-sdk/express';

// --- your platform's identity + policy --------------------------------------
const AUDIENCE = process.env.AXIS_AUDIENCE || 'comments.demo-platform.example';
const PLATFORM_ID = process.env.AXIS_PLATFORM_ID || 'axis:demo-platform:door'; // attestor id on boot-reports
const PORT = Number(process.env.PORT || 8787);
// const REPUTATION_URL = process.env.AXIS_REPUTATION_URL; // OFF by default

// The editable "Door policy": named gates, each on/off, with optional tier/scope.
// Flip `enabled: false` and the gate closes with no code change.
const door = new SwitchAuthorizer({
  audience: AUDIENCE,
  defaultAllow: false,
  gates: {
    'content:comment': {
      enabled: true,
      requireScopes: ['content:comment'],
      // minTier: 'domain',                 // require domain-verified+ to comment
      // blockedOperators: ['axis:spammer:operator'],
    },
  },
});

// Stateful stores. In-memory here (zero-infra); swap in your DB in production.
const ledger = new AccessLedger();
const blocklist = new Blocklist();

const app = express();
app.use(express.json());

// --- the gated action -------------------------------------------------------
// Identity verify + door policy + runtime blocklist + arrival logging, all in one.
app.post('/comments', async (req, res) => {
  // Inject runtime operator-blocks into the policy, then verify.
  const base = door.optsForGate('content:comment');
  const dynBlocked = await blocklist.blockedOperatorIds();
  let verdict = await verifyAgent(extractToken(req), {
    ...base,
    blockedOperators: [...(base.blockedOperators || []), ...dynBlocked],
  });
  // Agent-level runtime block (needs the resolved agent_id from the verdict).
  verdict = await blocklist.checkVerdict(verdict);

  // Log the arrival regardless of decision; a ledger hiccup never changes it.
  await ledger.record(verdict, { audience: AUDIENCE, gate_id: 'content:comment', requested_action: 'post a comment' }).catch(() => {});

  if (!verdict.accepted) {
    const status = verdict.code === 'no_token' ? 401 : 403;
    return res.status(status).json({ error: verdict.code || 'denied', message: verdict.reason });
  }
  return res.json({ ok: true, posted_by: verdict.agent_id, operator: verdict.operator_id, scope: verdict.effective_scope, comment: req.body?.text || '' });
});

// --- publish your door policy so AIT issuers know your audience + requirements
app.get('/.well-known/axis-access', (_req, res) => {
  res.json({
    axis_version: '0.3',
    platform_id: AUDIENCE,
    audience: AUDIENCE,
    access_policy: { minimum_verification_level: 'email', required_scopes: ['content:comment'], allow_unverified: false },
  });
});

// --- admin: recent arrivals (enriched for display) --------------------------
app.get('/admin/arrivals', async (req, res) => {
  const limit = Number(req.query.limit || 25);
  const rows = await ledger.recent({ limit });
  const enriched = await Promise.all(rows.map(async (r) => {
    if (!r.agent_id) return r;
    try {
      const info = await enrich(r.agent_id, null); // public layer only (no AIT here)
      return { ...r, display_name: info.display_name, tier: info.tier };
    } catch {
      return r; // registry unreachable; show the raw id
    }
  }));
  res.json({ arrivals: enriched });
});

// --- admin: boot an agent or operator (block + best-effort report) ----------
app.post('/admin/boot', async (req, res) => {
  const reason = req.body?.reason || 'booted by platform admin';
  if (req.body?.agent_id) {
    const out = await blockAndReport(
      blocklist,
      { platformId: PLATFORM_ID, agentId: req.body.agent_id, operatorId: req.body.operator_id, category: req.body.category || 'abuse', reason },
      { /* reputationUrl: REPUTATION_URL */ }
    );
    return res.json({ ok: true, ...out });
  }
  if (req.body?.operator_id) {
    await blocklist.blockOperator(req.body.operator_id, reason);
    return res.json({ ok: true, blocked_operator: req.body.operator_id });
  }
  return res.status(400).json({ ok: false, error: 'provide agent_id or operator_id' });
});

// --- admin: tiny HTML console ----------------------------------------------
app.get('/admin', (_req, res) => res.type('html').send(ADMIN_HTML));

app.get('/', (_req, res) => res.type('text').send('AXIS-gated comments demo. POST /comments with an AIT to get in. See /admin.\n'));

app.listen(PORT, () => {
  console.log(`AXIS-gated platform on http://localhost:${PORT}  (audience: ${AUDIENCE})`);
  console.log(`  door policy:  http://localhost:${PORT}/.well-known/axis-access`);
  console.log(`  admin:        http://localhost:${PORT}/admin`);
});

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
