import { hostname } from 'node:os';
import { api } from './api-client';
import { detectToolVersions } from './versions';

const RUNNER_VERSION = '0.0.1';

/**
 * Each runner invocation pings the API with detected tool versions. This
 * doubles as the doctor check: if any tool is missing the API will see it
 * and the CLI surfaces a warning.
 */
export async function sendHeartbeat(): Promise<{ tools: Awaited<ReturnType<typeof detectToolVersions>>; runnerId: string }> {
  const tools = await detectToolVersions();
  const id = `runner@${hostname()}`;
  await api.heartbeat({
    id,
    host: hostname(),
    version: RUNNER_VERSION,
    jdkVersion: tools.jdk,
    mavenVersion: tools.maven,
    gitVersion: tools.git,
  });
  return { tools, runnerId: id };
}
