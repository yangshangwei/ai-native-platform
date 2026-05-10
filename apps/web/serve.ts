/**
 * Minimal static + proxy server. Serves apps/web/* and proxies /api/* to the
 * Hono backend. Saves us from a full Vite setup at this MVP stage.
 */
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';

const ROOT = import.meta.dir;
const PORT = Number(process.env.AINP_WEB_PORT ?? 5173);
const API_BASE = process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function safeJoin(base: string, p: string): string | null {
  const target = join(base, p);
  if (!target.startsWith(base)) return null;
  return target;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Proxy /api/* -> backend, stripping the prefix.
    if (url.pathname.startsWith('/api/')) {
      const target = `${API_BASE}${url.pathname.slice(4)}${url.search}`;
      const init: RequestInit = {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
      };
      return fetch(target, init);
    }

    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    let file = safeJoin(ROOT, path);
    if (!file) return new Response('forbidden', { status: 403 });
    if (!existsSync(file) && !path.includes('.') && existsSync(`${file}.ts`)) {
      file = `${file}.ts`;
      path = `${path}.ts`;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      // SPA fallback: serve index.html for unknown routes
      file = join(ROOT, 'index.html');
      path = '/index.html';
    }

    const ext = path.slice(path.lastIndexOf('.'));
    const type = MIME[ext] ?? 'application/octet-stream';

    if (ext === '.ts') {
      // Transpile on the fly so the browser gets plain JS.
      const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' });
      const source = await Bun.file(file).text();
      const out = transpiler.transformSync(source);
      return new Response(out, { headers: { 'content-type': MIME['.js']!, 'cache-control': 'no-cache' } });
    }

    return new Response(Bun.file(file), { headers: { 'content-type': type, 'cache-control': ext === '.html' ? 'no-cache' : 'max-age=60' } });
  },
});

console.log(`[web] http://${server.hostname}:${server.port} (proxy /api -> ${API_BASE})`);
