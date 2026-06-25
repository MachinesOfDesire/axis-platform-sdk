/**
 * Decode an AIT (AXIS Identity Token, a JWT) payload WITHOUT verifying it.
 *
 * The cryptographic verification (signature, revocation, delegation chain)
 * happens server-side at the registry's GET /verify endpoint. The only reason
 * a platform decodes locally is to read the `aud` (audience) claim so it can
 * confirm the agent actually meant to present to THIS platform. The registry
 * enforces that `aud` is present and non-empty, but it does not know which
 * platform is asking, so audience-matching is the platform's job.
 *
 * Returns the parsed payload object, or null if the token is malformed.
 */
export function decodeAitPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}
