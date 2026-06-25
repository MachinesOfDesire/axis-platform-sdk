// Type declarations for axis-platform-sdk (the package is authored in plain JS).
// Covers the full main-entry surface. Subpath entry points (./scope, ./gate,
// ./authorizer, ./ledger, ./blocklist, ./reportback) re-export their slice of
// this declaration. Keep in sync with src/*.js.

export type Tier = 'email' | 'domain' | 'verified' | 'kyb_individual' | 'kyb_organization';

// --- verify -----------------------------------------------------------------

/** The single structured verdict verifyAgent / SwitchAuthorizer.authorize return. */
export interface Verdict {
  accepted: boolean;
  code?: string;
  reason?: string;
  agent_id?: string;
  operator_id?: string;
  effective_scope?: string[];
  delegation_valid?: boolean;
  tier?: Tier | null;
  expires_at?: number | null;
  /** present on an insufficient_scope denial */
  missing?: string[];
}

export interface VerifyOptions {
  audience?: string;
  requireScopes?: string[];
  minTier?: Tier;
  blockedOperators?: string[];
  approvedOperators?: string[] | null;
  registryBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function verifyAgent(token: string, opts?: VerifyOptions): Promise<Verdict>;

// --- authorizer (the pluggable gate engine; SwitchAuthorizer = free tier) ----

export interface GateConfig {
  enabled?: boolean;
  minTier?: Tier;
  requireScopes?: string[];
  blockedOperators?: string[];
  approvedOperators?: string[] | null;
}

/** Exactly what the "Door policy" screen edits + saves (door_policy.policy_json). */
export interface SwitchPolicy {
  audience?: string;
  defaultAllow?: boolean;
  blockedOperators?: string[];
  gates?: Record<string, GateConfig>;
}

export interface AuthorizeContext {
  registryBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class SwitchAuthorizer {
  constructor(policy?: SwitchPolicy);
  policy: SwitchPolicy;
  optsForGate(gateId: string): VerifyOptions;
  authorize(token: string, gateId: string, ctx?: AuthorizeContext): Promise<Verdict>;
  gate(gateId: string, opts?: AuthorizeContext): (request: Request) => Promise<Verdict>;
}

// --- scope ------------------------------------------------------------------

export function scopeCovers(granted: string, required: string): boolean;
/** Returns { ok, missing } — NOT a boolean. */
export function coversAll(granted: string[], required: string[]): { ok: boolean; missing: string[] };

// --- gate (Worker request middleware) ---------------------------------------

export function aitGate(opts: VerifyOptions): (request: Request) => Promise<Verdict>;
export function extractToken(request: Request): string | null;
export function denialResponse(verdict: Verdict): Response;

// --- client (registry-call helpers) -----------------------------------------

export interface EnrichResult {
  agent_id: string;
  did?: string | null;
  display_name?: string | null;
  tier?: Tier | null;
  operator_id?: string;
  status?: string | null;
  raw?: unknown;
  [k: string]: unknown;
}
export function enrich(
  agentId: string,
  token: string | null,
  opts?: { registryBaseUrl?: string; fetchImpl?: typeof fetch },
): Promise<EnrichResult>;

export function registryGet(
  base: string,
  path: string,
  opts?: { headers?: Record<string, string>; fetchImpl?: typeof fetch },
): Promise<{ status: number; body: any }>;

/** Read an operator's verification tier from a resolved agent record. */
export function pickTier(agentBody: any): Tier | null;

/** Load a platform's published `/.well-known/axis-access` door policy. */
export function loadAccessPolicy(
  platformBaseUrl: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<SwitchPolicy & Record<string, unknown>>;

export function decodeAitPayload(token: string): Record<string, unknown> | null;
export const TIER_RANK: Record<string, number>;
export const DEFAULT_REGISTRY: string;

// --- ledger (the "who showed up" arrival record) ----------------------------

export type ArrivalDecision = 'auto_allow' | 'denied' | 'held' | 'approved' | 'booted';

/**
 * One arrival record. Byte-compatible with Owyhee "The Door"'s `arrivals`
 * columns / `ArrivalRecord` (minus the adapter's own id/org_id PKs).
 * `created_at` is epoch ms.
 */
export interface ArrivalEntry {
  agent_id: string | null;
  operator_id: string | null;
  created_at: number;
  tier: Tier | null;
  delegation_valid: boolean;
  effective_scope: string[];
  gate_id: string | null;
  requested_action: string | null;
  display_name: string | null;
  decision: ArrivalDecision;
  reason: string | null;
  audience: string | null;
}

/** Optional fields stamped onto an entry alongside the verdict. */
export interface RecordFields {
  audience?: string;
  gate_id?: string;
  requested_action?: string;
  display_name?: string;
  decision?: ArrivalDecision;
  created_at?: number;
}

export function recordEntry(verdict: Verdict, fields?: RecordFields): ArrivalEntry;

/** The pluggable ledger store port (the default is in-memory). */
export interface LedgerStore {
  append(entry: ArrivalEntry): Promise<void>;
  recent(opts?: { limit?: number }): Promise<ArrivalEntry[]>;
  byOperator(operatorId: string, opts?: { limit?: number }): Promise<ArrivalEntry[]>;
}

export class MemoryLedgerStore implements LedgerStore {
  constructor(opts?: { max?: number });
  append(entry: ArrivalEntry): Promise<void>;
  recent(opts?: { limit?: number }): Promise<ArrivalEntry[]>;
  byOperator(operatorId: string, opts?: { limit?: number }): Promise<ArrivalEntry[]>;
}

export class AccessLedger {
  constructor(opts?: { store?: LedgerStore });
  store: LedgerStore;
  record(verdict: Verdict, fields?: RecordFields): Promise<ArrivalEntry>;
  recent(opts?: { limit?: number }): Promise<ArrivalEntry[]>;
  byOperator(operatorId: string, opts?: { limit?: number }): Promise<ArrivalEntry[]>;
}

export function loggedGate(
  gate: (request: Request) => Promise<Verdict>,
  ledger: AccessLedger,
  fields?: RecordFields,
): (request: Request) => Promise<Verdict>;

// --- blocklist (runtime block/allow, by operator AND agent) -----------------

export type BlockKind = 'operator' | 'agent';
export interface BlockMeta { reason?: string; created_at?: number; [k: string]: unknown; }
export interface BlockEntry { id: string; meta: BlockMeta; }

/** The pluggable block-store port (the default is in-memory). */
export interface BlocklistStore {
  add(kind: BlockKind, id: string, meta?: BlockMeta): Promise<void>;
  remove(kind: BlockKind, id: string): Promise<void>;
  has(kind: BlockKind, id: string): Promise<boolean>;
  list(kind: BlockKind): Promise<BlockEntry[]>;
}

export class MemoryBlocklistStore implements BlocklistStore {
  add(kind: BlockKind, id: string, meta?: BlockMeta): Promise<void>;
  remove(kind: BlockKind, id: string): Promise<void>;
  has(kind: BlockKind, id: string): Promise<boolean>;
  list(kind: BlockKind): Promise<BlockEntry[]>;
}

export class Blocklist {
  constructor(opts?: { store?: BlocklistStore });
  store: BlocklistStore;
  blockOperator(operatorId: string, reason?: string): Promise<void>;
  blockAgent(agentId: string, reason?: string): Promise<void>;
  unblockOperator(operatorId: string): Promise<void>;
  unblockAgent(agentId: string): Promise<void>;
  isOperatorBlocked(operatorId: string): Promise<boolean>;
  isAgentBlocked(agentId: string): Promise<boolean>;
  blockedOperatorIds(): Promise<string[]>;
  listOperators(): Promise<BlockEntry[]>;
  listAgents(): Promise<BlockEntry[]>;
  verifyOpts(): Promise<{ blockedOperators: string[] }>;
  checkVerdict(verdict: Verdict): Promise<Verdict>;
}

export function gatedWithBlocklist(
  gate: (request: Request) => Promise<Verdict>,
  blocklist: Blocklist,
): (request: Request) => Promise<Verdict>;

// --- reportback (sign + emit a negative Trust Attestation) ------------------

export interface TrustAttestation {
  axis_version: string;
  type: 'TrustAttestation';
  id: string;
  issued_by: string;
  subject: string;
  issued_at: string;
  scope: string;
  statement: string;
  signature?: string;
}

export interface KeyStore {
  load(): Promise<JsonWebKey | null>;
  save(jwk: JsonWebKey): Promise<void>;
}

export class MemoryKeyStore implements KeyStore {
  load(): Promise<JsonWebKey | null>;
  save(jwk: JsonWebKey): Promise<void>;
}

export function getPlatformKey(
  opts?: { keyStore?: KeyStore },
): Promise<{ privateKey: CryptoKey; publicKeyB64: string; jwk: JsonWebKey }>;

export function buildAttestation(args: {
  platformId: string;
  agentId: string;
  category?: string;
  reason?: string;
  issuedAt?: string;
}): TrustAttestation;

export function signAttestation(attestation: TrustAttestation, privateKey: CryptoKey): Promise<TrustAttestation>;
export function verifyAttestation(attestation: TrustAttestation, publicKeyB64: string): Promise<boolean>;

export interface ReportArgs {
  platformId: string;
  agentId: string;
  operatorId?: string;
  category: string;
  reason: string;
}
export interface ReportResult {
  sent: boolean;
  status?: number;
  attestation?: TrustAttestation;
  reason?: string;
}
export interface ReportOptions {
  reputationUrl?: string | null;
  keyStore?: KeyStore;
  fetchImpl?: typeof fetch;
}

export function reportFlag(args: ReportArgs, opts?: ReportOptions): Promise<ReportResult>;
export function blockAndReport(
  blocklist: Blocklist,
  args: ReportArgs,
  opts?: ReportOptions,
): Promise<{ blocked: boolean; agent_id: string; report: ReportResult }>;

export const DEFAULT_REPUTATION_URL: string | null;
