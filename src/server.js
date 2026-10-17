import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { lookupMime } from './mime.js';
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

function handleRequest(options) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

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
      // Stage 2: directory listing. For now serve index.html if present.
      const index = path.join(filePath, 'index.html');
      try {
        const indexStat = await fs.promises.stat(index);
        if (indexStat.isFile()) return serveFile(req, res, index, indexStat);
      } catch {
        /* fall through */
      }
      return sendError(res, 404, 'No index.html (directory listing coming in stage 2)');
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
