/**
 * Minimal static + proxy server. Serves apps/web/* and proxies /api/* to the
 * Hono backend. Saves us from a full Vite setup at this MVP stage.
 */
import { dirname, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { errorMessage } from '@ainp/shared';

const ROOT = dirname(fileURLToPath(import.meta.url));
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

async function browserModuleResponse(file: string): Promise<Response> {
  const result = await Bun.build({
    entrypoints: [file],
    format: 'esm',
    target: 'browser',
  });

  if (!result.success || !result.outputs[0]) {
    const detail = result.logs.map((log) => String(log)).join('\n') || 'browser bundle failed';
    return new Response(detail, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  return new Response(await result.outputs[0].text(), {
    headers: { 'content-type': MIME['.js']!, 'cache-control': 'no-cache' },
  });
}

export function createWebServer(options: { port?: number; apiBase?: string } = {}) {
  const port = options.port ?? PORT;
  const apiBase = options.apiBase ?? API_BASE;

  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // Proxy /api/* -> backend, stripping the prefix.
      if (url.pathname.startsWith('/api/')) {
        const target = `${apiBase}${url.pathname.slice(4)}${url.search}`;
        const init: RequestInit = {
          method: req.method,
          headers: req.headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
          // Propagate client disconnects so long-lived upstream connections
          // (e.g. SSE) are released instead of leaking until FD exhaustion.
          signal: req.signal,
        };
        try {
          return await fetch(target, init);
        } catch (err) {
          const message = errorMessage(err);
          return Response.json(
            {
              error: 'api proxy unavailable',
              detail: message,
              apiBase,
            },
            { status: 502 },
          );
        }
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
        // Bundle on the fly so workspace package imports such as @ainp/shared
        // are resolved before the browser sees the module.
        return browserModuleResponse(file);
      }

      return new Response(Bun.file(file), { headers: { 'content-type': type, 'cache-control': ext === '.html' ? 'no-cache' : 'max-age=60' } });
    },
  });
}

let activeServer: ReturnType<typeof Bun.serve> | null = null;

if (import.meta.main) {
  activeServer = createWebServer();
  const server = activeServer;
  console.log(`[web] http://${server.hostname}:${server.port} (proxy /api -> ${API_BASE})`);
}
