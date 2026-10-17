import path from 'node:path';

/**
 * Resolve a URL path against the server root without ever escaping it.
 * Throws a 400-range Error for malformed input; returns `null` when the
 * resolved path points outside the root (directory traversal attempt).
 */
export function resolvePath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    const err = new Error('Malformed URL encoding');
    err.status = 400;
    throw err;
  }
  const resolved = path.resolve(root, '.' + decoded);
  const rootWithSep = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && !resolved.startsWith(rootWithSep)) {
    return null;
  }
  return resolved;
}

/**
 * Parse a single-range `Range` header ("bytes=start-end").
 * Returns { start, end } clamped to `size`, or `null` for unsatisfiable
 * / multi-range requests (we intentionally serve only single ranges).
 */
export function parseRange(header, size) {
  if (!header || !header.startsWith('bytes=')) return null;
  const spec = header.slice('bytes='.length).trim();
  if (spec.includes(',')) return null; // multi-range: not supported
  const [startStr, endStr] = spec.split('-');
  let start = startStr === '' ? null : Number.parseInt(startStr, 10);
  let end = endStr === '' ? null : Number.parseInt(endStr, 10);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  if (start === null) {
    // Suffix range: last `end` bytes.
    if (end === null || end <= 0) return null;
    start = Math.max(size - end, 0);
    end = size - 1;
  } else {
    if (start >= size) return null; // unsatisfiable
    end = end === null ? size - 1 : Math.min(end, size - 1);
    if (end < start) return null;
  }
  return { start, end };
}

/** Weak ETag built from size + mtime — cheap and changes on every write. */
export function makeEtag(stat) {
  return `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
}
