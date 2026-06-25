// Scope matching for the AXIS scope grammar (spec v0.2 §4.4).
//
// Ported verbatim from kipple-governor/src/scope-match.ts so the operator side
// (Governor proxy chain-walk) and the platform side (this SDK) agree on scope
// semantics exactly. Colon-separated segments; `*` is a wildcard for ONE
// segment, not multi; no recursion. If the protocol grammar changes, change it
// in both places.

/**
 * Does `granted` cover `required`? I.e. can a caller granted `granted` claim
 * the permission `required`?
 *
 *   scopeCovers('admin:*',            'admin:users')        === true
 *   scopeCovers('admin:users',        'admin:users')        === true
 *   scopeCovers('admin:users',        'admin:roles')        === false
 *   scopeCovers('admin:*',            'admin:users:delete') === false  // * = 1 segment
 *   scopeCovers('anthropic:complete', 'anthropic:complete') === true
 */
export function scopeCovers(granted, required) {
  if (!granted || !required) return false;
  if (granted === required) return true;
  const g = granted.split(':');
  const r = required.split(':');
  if (g.length !== r.length) return false;
  for (let i = 0; i < g.length; i++) {
    if (g[i] === '*') continue;
    if (g[i] !== r[i]) return false;
  }
  return true;
}

/**
 * Do the granted scopes cover EVERY required scope? Empty `required` is
 * trivially satisfied. Returns the missing required scopes on failure so a
 * caller can put them in a denial reason.
 *
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function coversAll(granted, required) {
  const grantedList = Array.isArray(granted) ? granted : [];
  const missing = [];
  for (const req of required) {
    if (!grantedList.some((g) => scopeCovers(g, req))) missing.push(req);
  }
  return { ok: missing.length === 0, missing };
}
