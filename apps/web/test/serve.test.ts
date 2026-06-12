import { describe, expect, it } from 'vitest';
import { createWebServer } from '../serve';

describe('web dev server', () => {
  it('bundles TypeScript modules so workspace imports are browser-ready', async () => {
    const server = createWebServer({ port: 0, apiBase: 'http://127.0.0.1:1' });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/src/main.ts`);
      expect(res.ok).toBe(true);
      expect(res.headers.get('content-type')).toContain('application/javascript');

      const js = await res.text();
      expect(js).not.toContain("from '@ainp/shared'");
      expect(js).not.toContain('from "@ainp/shared"');
      expect(js).toContain('FLOW_REGISTRY');
    } finally {
      server.stop(true);
    }
  });

  it('aborts the upstream request when the proxy client disconnects', async () => {
    let upstreamCancelled = false;
    const upstream = Bun.serve({
      port: 0,
      fetch(req) {
        req.signal.addEventListener('abort', () => {
          upstreamCancelled = true;
        });
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: hello\n\n'));
            // Keep the stream open like an SSE endpoint would.
          },
          cancel() {
            upstreamCancelled = true;
          },
        });
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const server = createWebServer({ port: 0, apiBase: `http://127.0.0.1:${upstream.port}` });

    try {
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${server.port}/api/agent-stream`, {
        signal: controller.signal,
      });
      expect(res.ok).toBe(true);

      const reader = res.body!.getReader();
      await reader.read(); // first SSE chunk arrived; upstream connection is live
      controller.abort();

      const deadline = Date.now() + 2000;
      while (!upstreamCancelled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(upstreamCancelled).toBe(true);
    } finally {
      server.stop(true);
      upstream.stop(true);
    }
  });

  it('proxies JSON requests intact and never aborts the upstream after normal completion', async () => {
    let upstreamAborted = false;
    const upstream = Bun.serve({
      port: 0,
      async fetch(req) {
        req.signal.addEventListener('abort', () => {
          upstreamAborted = true;
        });
        const body = (await req.json()) as { name: string };
        return Response.json({ echoed: body }, { status: 201, headers: { 'x-upstream': 'yes' } });
      },
    });
    const server = createWebServer({ port: 0, apiBase: `http://127.0.0.1:${upstream.port}` });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'demo' }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('x-upstream')).toBe('yes');
      expect(await res.json()).toEqual({ echoed: { name: 'demo' } });

      // Give a spurious post-completion abort a chance to fire before asserting.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(upstreamAborted).toBe(false);
    } finally {
      server.stop(true);
      upstream.stop(true);
    }
  });

  it('returns JSON when the API proxy target is unavailable', async () => {
    const server = createWebServer({ port: 0, apiBase: 'http://127.0.0.1:1' });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/projects`);
      expect(res.status).toBe(502);
      expect(res.headers.get('content-type')).toContain('application/json');

      const body = await res.json();
      expect(body).toMatchObject({
        error: 'api proxy unavailable',
        apiBase: 'http://127.0.0.1:1',
      });
    } finally {
      server.stop(true);
    }
  });
});
