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
