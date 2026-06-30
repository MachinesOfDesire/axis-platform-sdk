import { VerifyOptions, Verdict } from './index.js';

/** Minimal request shape the middleware reads (Express/Connect compatible). */
export interface AxisRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  /** Set by `axisGate` to the verdict before `next()` / the denial response. */
  axis?: Verdict;
  [key: string]: unknown;
}

/** Minimal response shape the middleware writes to (Express helpers or bare Node). */
export interface AxisResponse {
  status?: (code: number) => AxisResponse;
  json?: (body: unknown) => unknown;
  statusCode?: number;
  setHeader?: (name: string, value: string) => void;
  end?: (chunk?: string) => unknown;
  [key: string]: unknown;
}

export type AxisNext = (err?: unknown) => void;

/** Pull the AIT off a Node request: Bearer header, X-AXIS-Token, then ?ait=. */
export function extractToken(req: AxisRequest): string | null;

/** Build an Express/Connect middleware bound to your platform's verify policy. */
export function axisGate(
  opts?: VerifyOptions
): (req: AxisRequest, res: AxisResponse, next: AxisNext) => Promise<void>;
