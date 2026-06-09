import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
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

createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const filePath = pathname === '/'
    ? join(publicRoot, 'index.html')
    : pathname.startsWith('/document.hvy') || pathname.startsWith('/attachments.json') || pathname.startsWith('/image/') || pathname.startsWith('/attachment/')
      ? safeJoin(siteRoot, pathname)
      : safeJoin(publicRoot, pathname);
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
      'cache-control': pathname === '/' ? 'no-cache' : 'public, max-age=3600',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    respond(response, 404, 'Not found');
  }
}).listen(port, () => {
  console.log(`HVY hosted viewer listening on :${port}`);
});

function safeJoin(root, pathname) {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const target = resolve(root, relative);
  return target === root || target.startsWith(`${root}/`) ? target : null;
}

function respond(response, status, message) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(message);
}
