import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Red lines for the `@ainp/shared/node` subpath (see
// .trellis/spec/shared/backend/directory-structure.md). Typecheck does NOT
// enforce these: workspace symlinks under apps/*/node_modules let TypeScript
// resolve `@ainp/shared/node` via package.json `exports` even without a
// tsconfig paths mapping, so a stray web import would compile fine and only
// blow up the browser bundle. This test is the enforcement.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('@ainp/shared/node red lines', () => {
  it('main barrel does not re-export anything from src/node/', () => {
    const barrel = readFileSync(join(repoRoot, 'packages/shared/src/index.ts'), 'utf8');
    expect(barrel).not.toMatch(/['"]\.{1,2}\/node\b/);
  });

  it('apps/web never imports @ainp/shared/node', () => {
    const files = [join(repoRoot, 'apps/web/serve.ts'), ...walkTs(join(repoRoot, 'apps/web/src'))];
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes('@ainp/shared/node'));

    expect(offenders).toEqual([]);
  });
});

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}
