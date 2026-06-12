import { app } from './app';
import { initDb } from './store/db';

const port = Number(process.env.AINP_API_PORT ?? 8787);
const hostname = process.env.AINP_API_HOST ?? '127.0.0.1';

// Fail fast: open the SQLite file and apply pending migrations BEFORE
// accepting traffic. The lazy `db` proxy would otherwise defer this to the
// first request, turning a broken DB path / failed migration into a runtime
// 500 instead of a visible startup crash (task 06-12 acceptance: explicit
// init preserves the legacy import-side-effect fail-fast behavior).
initDb();

// Bun's HTTP server closes idle connections at 10s by default. SSE
// subscribers can sit quiet for minutes (CC api_retry, model thinking) and
// must NOT be cut off. 255 is the protocol max; a 5s SSE ping keeps writes
// flowing well under that threshold.
const server = Bun.serve({ port, hostname, idleTimeout: 255, fetch: app.fetch });
console.log(`[api] listening on http://${server.hostname}:${server.port}`);
