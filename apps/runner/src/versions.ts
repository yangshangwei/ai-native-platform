import { sh } from './sh';

export interface ToolVersions {
  jdk: string | null;
  maven: string | null;
  git: string | null;
}

/** Detect installed tool versions. Returns null per tool if unavailable. */
export async function detectToolVersions(): Promise<ToolVersions> {
  const [jdk, maven, git] = await Promise.all([
    detectJdk(),
    detectMaven(),
    detectGit(),
  ]);
  return { jdk, maven, git };
}

async function detectJdk(): Promise<string | null> {
  // `java -version` writes to stderr on Java 8 and stdout on 9+. Try both.
  const r = await sh('java', ['-version']).catch(() => null);
  if (!r) return null;
  const out = `${r.stderr}\n${r.stdout}`;
  const m = out.match(/version\s+"([^"]+)"/i);
  return m ? (m[1] ?? null) : null;
}

async function detectMaven(): Promise<string | null> {
  const r = await sh('mvn', ['--version']).catch(() => null);
  if (!r) return null;
  const m = r.stdout.match(/Apache Maven\s+([\d.]+)/i);
  return m ? (m[1] ?? null) : null;
}

async function detectGit(): Promise<string | null> {
  const r = await sh('git', ['--version']).catch(() => null);
  if (!r) return null;
  const m = r.stdout.match(/git version\s+([\d.]+)/i);
  return m ? (m[1] ?? null) : null;
}
