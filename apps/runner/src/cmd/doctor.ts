import { detectToolVersions } from '../versions';

export async function cmdDoctor(): Promise<void> {
  const tools = await detectToolVersions();
  const status = (label: string, value: string | null): string =>
    `${label.padEnd(8)} ${value ?? '<missing>'} ${value ? '✓' : '✗'}`;
  console.log(status('jdk', tools.jdk));
  console.log(status('maven', tools.maven));
  console.log(status('git', tools.git));
  if (!tools.jdk || !tools.maven || !tools.git) {
    console.error('\n[runner] one or more tools missing — Maven build will fail');
    process.exit(1);
  }
}
