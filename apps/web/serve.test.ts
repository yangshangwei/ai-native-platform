import { describe, test, expect, afterEach } from 'vitest';
import { createWebServer } from './serve';

describe('createWebServer', () => {
  let server: ReturnType<typeof createWebServer> | null = null;

  afterEach(() => {
    if (server) {
      server.stop(true);
      server = null;
    }
  });

  test('defaults to 127.0.0.1 hostname', () => {
    server = createWebServer({ port: 0 });
    expect(server.hostname).toBe('127.0.0.1');
  });

  test('respects AINP_WEB_HOST environment variable', () => {
    const original = process.env.AINP_WEB_HOST;
    try {
      process.env.AINP_WEB_HOST = 'localhost';
      server = createWebServer({ port: 0 });
      expect(server.hostname).toBe('localhost');
    } finally {
      if (original !== undefined) {
        process.env.AINP_WEB_HOST = original;
      } else {
        delete process.env.AINP_WEB_HOST;
      }
    }
  });

  test('allows explicit hostname override', () => {
    server = createWebServer({ port: 0, hostname: '0.0.0.0' });
    expect(server.hostname).toBe('0.0.0.0');
  });
});
