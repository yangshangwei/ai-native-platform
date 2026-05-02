import { app } from './app';

const port = Number(process.env.AINP_API_PORT ?? 8787);
const hostname = process.env.AINP_API_HOST ?? '127.0.0.1';

// Bun's HTTP server closes idle connections at 10s by default. SSE
// subscribers can sit quiet for minutes (CC api_retry, model thinking) and
// must NOT be cut off. 255 is the protocol max; a 5s SSE ping keeps writes
// flowing well under that threshold.
const server = Bun.serve({ port, hostname, idleTimeout: 255, fetch: app.fetch });
console.log(`[api] listening on http://${server.hostname}:${server.port}`);
