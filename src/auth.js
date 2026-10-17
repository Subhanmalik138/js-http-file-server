/**
 * Parse an `Authorization: Basic <base64>` header into { username, password },
 * or return `null` when the header is missing or malformed.
 */
export function parseBasicAuth(header) {
  if (!header || !header.startsWith('Basic ')) return null;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const colon = decoded.indexOf(':');
  if (colon === -1) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/** Constant-time comparison so wrong passwords don't fail measurably faster. */
function safeEqual(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** True when the request satisfies the configured credentials (or none are set). */
export function checkAuth(req, auth) {
  if (!auth) return true;
  const creds = parseBasicAuth(req.headers.authorization);
  return (
    creds !== null &&
    safeEqual(creds.username, auth.username) &&
    safeEqual(creds.password, auth.password)
  );
}
