# fileserve — a zero-dependency HTTP file server

A small but complete static file server for Node.js, written with only the
standard library. It serves files, renders sortable directory listings,
streams byte ranges (so video/audio seeking works), accepts uploads, and can
require HTTP Basic auth — all in a few hundred lines of dependency-free code.

I built it to practice the HTTP semantics that every backend engineer should
know cold: conditional requests, range responses, safe path handling, and
streaming I/O.

## Features

- **Static file serving** with correct MIME types, `ETag` / `Last-Modified`
  conditional requests (`304 Not Modified`), and `HEAD` support
- **Single-range requests** (`206 Partial Content`) — stream media or resume
  downloads; unsatisfiable ranges get a proper `416`
- **Directory listing** — clean HTML page with breadcrumbs, sortable by name,
  size, or date; `index.html` is served automatically when present
- **PUT uploads** — streamed straight to disk (never buffered), capped at
  1 GiB, optional via `--upload`
- **HTTP Basic auth** — optional `--auth user:pass`, compared in constant time
- **Traversal-safe** — encoded `..` segments can never escape the root

## Requirements

Node.js 18 or newer. No dependencies — nothing to install.

## Usage

```bash
# Serve the current directory on port 8080
npx js-http-file-server
# or, from a checkout:
node bin/fileserve.js --dir ./public --port 3000

# Enable uploads and require a login
node bin/fileserve.js --upload --auth admin:s3cret

# Upload a file
curl -u admin:s3cret -T report.pdf http://localhost:8080/report.pdf

# Download only the first kilobyte
curl -r 0-1023 http://localhost:8080/movie.mp4 -o preview.mp4
```

```
fileserve [options]
  -p, --port <n>     Port to listen on (default: 8080)
  -d, --dir <path>   Directory to serve (default: current directory)
  -u, --upload       Allow file uploads via PUT
  -a, --auth <u:p>   Require HTTP Basic auth
  -h, --help         Show help
```

## As a library

```js
import { createServer } from 'js-http-file-server';

const server = createServer({
  root: './public',
  upload: true,
  auth: { username: 'admin', password: 's3cret' }, // optional
});
server.listen(8080);
```

## Design decisions

1. **Zero dependencies.** Everything is `node:http`, `node:fs`, and streams.
   Fewer dependencies means a smaller audit surface and no supply-chain
   surprises for something that serves files from disk.
2. **Stream, never buffer.** Files are piped from disk to socket with
   `fs.createReadStream`; uploads are piped from socket to disk. Memory use
   stays flat regardless of file size.
3. **Weak ETags from size + mtime.** Cheap to compute (no hashing on every
   request) and changes on every write — the right trade-off for a static
   server.
4. **Only single ranges.** Multi-range responses are rare in practice and
   fiddly to get right; the server returns `416` for them instead of a subtly
   broken multipart body.
5. **Constant-time credential comparison.** A wrong password must not fail
   measurably faster than a right one.

## Running the tests

```bash
npm test   # node:test, no test framework to install
```

26 tests: MIME lookup, path-traversal guards, range parsing, auth parsing,
and full HTTP integration (serving, listing, ranges, conditionals, uploads,
auth) against a real server on an ephemeral port.

## Project layout

```
bin/fileserve.js   CLI entry point
src/server.js      request routing, file serving, uploads
src/listing.js     directory-listing HTML renderer
src/auth.js        Basic-auth parsing and verification
src/http-utils.js  path resolution, range parsing, ETags
src/mime.js        extension → MIME type map
tests/             node:test suites
```

## License

MIT — see [LICENSE](LICENSE).
