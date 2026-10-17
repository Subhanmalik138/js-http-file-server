import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { lookupMime } from './mime.js';
import { renderDirectoryListing } from './listing.js';
import { checkAuth } from './auth.js';
import { resolvePath, parseRange, makeEtag } from './http-utils.js';

const sendError = (res, status, message) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`${status} ${message}\n`);
};

/**
 * Serve a regular file with ETag/Last-Modified caching, single-range
 * support (206) and HEAD semantics. Never buffers the file in memory:
 * everything streams from disk.
 */
async function serveFile(req, res, filePath, stat) {
  const etag = makeEtag(stat);
  const lastModified = stat.mtime.toUTCString();

  // Conditional request: client already has this exact version.
  const ifNoneMatch = req.headers['if-none-match'];
  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifNoneMatch === etag || (ifNoneMatch === undefined && ifModifiedSince && new Date(ifModifiedSince) >= stat.mtime)) {
    res.writeHead(304, { ETag: etag, 'Last-Modified': lastModified });
    return res.end();
  }

  const mime = lookupMime(filePath);
  const baseHeaders = {
    'Content-Type': mime,
    ETag: etag,
    'Last-Modified': lastModified,
    'Accept-Ranges': 'bytes',
  };

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, stat.size);
    if (!range) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    const { start, end } = range;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': chunkSize,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

/**
 * Render and serve a directory listing. Hidden files (dotfiles) are skipped,
 * and symlinks are resolved — dangling ones are skipped rather than served.
 */
async function serveDirectory(req, res, pathname, dirPath, url) {
  let names;
  try {
    names = await fs.promises.readdir(dirPath);
  } catch {
    return sendError(res, 403, 'Cannot read directory');
  }
  const entries = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    let stat;
    try {
      stat = await fs.promises.stat(path.join(dirPath, name));
    } catch {
      continue;
    }
    entries.push({
      name,
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
  const html = renderDirectoryListing(pathname, entries, url.searchParams.get('sort') ?? 'name');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  if (req.method === 'HEAD') return res.end();
  res.end(html);
}

/**
 * Upload a file via PUT. Streams the request body straight to disk (no
 * buffering), refuses to overwrite directories, and caps uploads at 1 GiB.
 */
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

async function handleUpload(req, res, options, pathname) {
  if (!options.upload) return sendError(res, 403, 'Uploads are disabled (restart with --upload)');

  let filePath;
  try {
    filePath = resolvePath(options.root, pathname);
  } catch (err) {
    return sendError(res, err.status ?? 400, err.message);
  }
  if (filePath === null) return sendError(res, 403, 'Forbidden');
  if (pathname.endsWith('/')) return sendError(res, 400, 'Upload target must be a file path');

  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES) {
    return sendError(res, 413, 'Upload too large');
  }

  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const existing = await fs.promises.stat(filePath).catch(() => null);
    if (existing?.isDirectory()) return sendError(res, 400, 'Upload target is a directory');

    let received = 0;
    const out = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES) {
          req.destroy();
          out.destroy();
          reject(Object.assign(new Error('Upload too large'), { status: 413 }));
        }
      });
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    });
    res.writeHead(existing ? 200 : 201, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Stored ${received} bytes\n`);
  } catch (err) {
    sendError(res, err.status ?? 500, err.message || 'Upload failed');
  }
}

function handleRequest(options) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // Basic auth applies to every route when configured.
    if (!checkAuth(req, options.auth)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fileserve"' });
      return res.end('Authentication required\n');
    }

    if (req.method === 'PUT') {
      return handleUpload(req, res, options, pathname);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, 405, 'Method Not Allowed');
    }

    let filePath;
    try {
      filePath = resolvePath(options.root, pathname);
    } catch (err) {
      return sendError(res, err.status ?? 400, err.message);
    }
    if (filePath === null) return sendError(res, 403, 'Forbidden');

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return sendError(res, 404, 'Not Found');
    }

    if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: pathname + '/' });
        return res.end();
      }
      const index = path.join(filePath, 'index.html');
      try {
        const indexStat = await fs.promises.stat(index);
        if (indexStat.isFile()) return serveFile(req, res, index, indexStat);
      } catch {
        /* fall through to the listing */
      }
      return serveDirectory(req, res, pathname, filePath, url);
    }

    if (!stat.isFile()) return sendError(res, 404, 'Not Found');
    return serveFile(req, res, filePath, stat);
  };
}

/**
 * Create and return an `http.Server` serving `options.root`.
 * Use `server.listen(port)` yourself, or the bundled CLI in bin/.
 */
export function createServer(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  return http.createServer(handleRequest({ ...options, root }));
}
