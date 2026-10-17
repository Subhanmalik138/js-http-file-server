import path from 'node:path';

/** Escape text for safe embedding in HTML. */
function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function breadcrumb(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  let crumbs = `<a href="/">/</a>`;
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    crumbs += ` <a href="${escapeHtml(encodeURI(acc) + '/')}">${escapeHtml(part)}</a> /`;
  }
  return crumbs;
}

const ICONS = { dir: '📁', file: '📄' };

/**
 * Render a sortable directory listing. `sort` is one of
 * name|size|modified with an optional leading `-` for descending,
 * taken from the `?sort=` query param.
 */
export function renderDirectoryListing(pathname, entries, sort = 'name') {
  const descending = sort.startsWith('-');
  const key = descending ? sort.slice(1) : sort;
  const validKeys = ['name', 'size', 'modified'];
  const sortKey = validKeys.includes(key) ? key : 'name';

  const sorted = [...entries].sort((a, b) => {
    // Directories always group first.
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let cmp;
    if (sortKey === 'size') cmp = a.size - b.size;
    else if (sortKey === 'modified') cmp = a.mtimeMs - b.mtimeMs;
    else cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
    return descending ? -cmp : cmp;
  });

  const arrow = (k) => (sortKey === k ? (descending ? ' ▼' : ' ▲') : '');
  const link = (k, label) => {
    const next = sortKey === k && !descending ? `-${k}` : k;
    return `<a href="?sort=${next}">${label}${arrow(k)}</a>`;
  };

  const rows = sorted
    .map((e) => {
      const icon = e.isDirectory ? ICONS.dir : ICONS.file;
      const href = encodeURI(pathname + e.name) + (e.isDirectory ? '/' : '');
      const size = e.isDirectory ? '—' : humanSize(e.size);
      const modified = new Date(e.mtimeMs).toLocaleString();
      return `<tr><td>${icon} <a href="${escapeHtml(href)}">${escapeHtml(e.name)}</a></td><td class="num">${size}</td><td>${modified}</td></tr>`;
    })
    .join('\n');

  const parentRow =
    pathname === '/'
      ? ''
      : `<tr><td>⬆️ <a href="${escapeHtml(encodeURI(path.dirname(pathname.slice(0, -1)) + '/'))}">..</a></td><td class="num">—</td><td></td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Index of ${escapeHtml(pathname)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
h1{font-size:1.3rem;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid #e5e5e5}
th{background:#f7f7f7}
td.num{text-align:right;font-variant-numeric:tabular-nums}
a{color:#0b5fff;text-decoration:none}
a:hover{text-decoration:underline}
.crumbs{margin-bottom:1rem;color:#555}
</style>
</head>
<body>
<h1>Index of ${escapeHtml(pathname)}</h1>
<div class="crumbs">${breadcrumb(pathname)}</div>
<table>
<thead><tr><th>${link('name', 'Name')}</th><th style="text-align:right">${link('size', 'Size')}</th><th>${link('modified', 'Modified')}</th></tr></thead>
<tbody>
${parentRow}
${rows}
</tbody>
</table>
</body>
</html>
`;
}
