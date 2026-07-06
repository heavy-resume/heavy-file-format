import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.env.PORT || 8080);
const publicRoot = resolve(process.env.HVY_VIEWER_PUBLIC || '/app/public');
const siteRoot = resolve(process.env.HVY_VIEWER_SITE || '/site');

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.hvy', 'text/plain; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.ico', 'image/x-icon'],
]);

const activeSockets = new Set();

export function createHostedViewerServer(options = {}) {
  const resolvedPublicRoot = resolve(options.publicRoot || publicRoot);
  const resolvedSiteRoot = resolve(options.siteRoot || siteRoot);
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;
    if (pathname === '/') {
      await serveIndexHtml(response, resolvedPublicRoot, resolvedSiteRoot, requestUrl);
      return;
    }
    const filePath =
      pathname.startsWith('/document.hvy') ||
      pathname.startsWith('/attachments.json') ||
      pathname.startsWith('/preview.json') ||
      pathname.startsWith('/image/') ||
      pathname.startsWith('/attachment/')
        ? safeJoin(resolvedSiteRoot, pathname)
        : safeJoin(resolvedPublicRoot, pathname);
    if (!filePath) {
      respond(response, 404, 'Not found');
      return;
    }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        respond(response, 404, 'Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': mimeTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
        'content-length': info.size,
        'cache-control': getCacheControl(requestUrl),
      });
      createReadStream(filePath).pipe(response);
    } catch {
      respond(response, 404, 'Not found');
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createHostedViewerServer();
  server.on('connection', (socket) => {
    activeSockets.add(socket);
    socket.on('close', () => {
      activeSockets.delete(socket);
    });
  });

  server.listen(port, () => {
    console.log(`HVY hosted viewer listening on :${port}`);
  });

  process.once('SIGINT', () => {
    shutdown(server, 'SIGINT');
  });

  process.once('SIGTERM', () => {
    shutdown(server, 'SIGTERM');
  });
}

function shutdown(server, signal) {
  console.log(`HVY hosted viewer shutting down (${signal})`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    for (const socket of activeSockets) {
      socket.destroy();
    }
    process.exit(0);
  }, 1000).unref();
}

function safeJoin(root, pathname) {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const target = resolve(root, relative);
  return target === root || target.startsWith(`${root}/`) ? target : null;
}

async function serveIndexHtml(response, resolvedPublicRoot, resolvedSiteRoot, requestUrl) {
  const indexPath = join(resolvedPublicRoot, 'index.html');
  try {
    const html = await readFile(indexPath, 'utf8');
    const preview = await readHostedPreviewMetadata(resolvedSiteRoot);
    const body = injectPreviewMetadata(html, preview);
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': getCacheControl(requestUrl),
    });
    response.end(body);
  } catch {
    respond(response, 404, 'Not found');
  }
}

async function readHostedPreviewMetadata(resolvedSiteRoot) {
  try {
    const raw = JSON.parse(await readFile(join(resolvedSiteRoot, 'preview.json'), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function injectPreviewMetadata(html, preview) {
  const title = previewString(preview?.title) || 'HVY Viewer';
  const description = previewString(preview?.description);
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const previewHtml = [
    `<title>${escapedTitle}</title>`,
    description ? `<meta name="description" content="${escapedDescription}" />` : '',
    `<meta property="og:title" content="${escapedTitle}" />`,
    description ? `<meta property="og:description" content="${escapedDescription}" />` : '',
    '<meta property="og:type" content="article" />',
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${escapedTitle}" />`,
    description ? `<meta name="twitter:description" content="${escapedDescription}" />` : '',
  ].filter(Boolean).join('\n    ');
  return html.replace(
    /<!--HVY_PREVIEW_META_START-->[\s\S]*?<!--HVY_PREVIEW_META_END-->/,
    `<!--HVY_PREVIEW_META_START-->\n    ${previewHtml}\n    <!--HVY_PREVIEW_META_END-->`
  );
}

function previewString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

function getCacheControl(requestUrl) {
  const pathname = requestUrl.pathname;
  if (pathname === '/hvy-embed.js' && requestUrl.searchParams.has('v')) {
    return 'public, max-age=31536000, immutable';
  }
  if (
    pathname === '/' ||
    pathname === '/document.hvy' ||
    pathname === '/attachments.json' ||
    pathname === '/preview.json' ||
    pathname === '/viewer.css' ||
    pathname === '/viewer.js' ||
    pathname === '/hvy-embed.js' ||
    pathname === '/hvy-embed.css'
  ) {
    return 'no-cache';
  }
  return 'public, max-age=31536000, immutable';
}

function respond(response, status, message) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(message);
}
