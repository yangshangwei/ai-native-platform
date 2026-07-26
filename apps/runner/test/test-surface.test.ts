import { mkdtempSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { collectTestSurfaceReport } from '../src/test-surface';
import { sh } from '../src/sh';

// ---------------------------------------------------------------------------
// collectTestSurfaceReport integration: real temp git repos, worktree-HEAD
// baseline vs uncommitted working-tree changes (mirrors the implementation
// stage's no-commit contract).
// ---------------------------------------------------------------------------

const TEST_FILE = 'src/test/java/sample/CalculatorTest.java';
const TEST_SOURCE = [
  'package sample;',
  '',
  'import org.junit.jupiter.api.Test;',
  '',
  'class CalculatorTest {',
  '  @Test',
  '  void adds() {',
  '    assertEquals(4, Calculator.add(2, 2));',
  '  }',
  '',
  '  @Test',
  '  void multiplies() {',
  '    assertEquals(6, Calculator.multiply(2, 3));',
  '    assertTrue(Calculator.multiply(1, 1) > 0);',
  '  }',
  '}',
  '',
].join('\n');

const POM_SOURCE = [
  '<project>',
  '  <build>',
  '    <plugins>',
  '      <plugin>',
  '        <artifactId>maven-surefire-plugin</artifactId>',
  '        <configuration>',
  '          <skipTests>false</skipTests>',
  '        </configuration>',
  '      </plugin>',
  '    </plugins>',
  '  </build>',
  '</project>',
  '',
].join('\n');

async function write(repo: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  await writeFile(join(repo, path), content, 'utf8');
}

async function git(repo: string, args: string[]): Promise<void> {
  const result = await sh('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args], {
    cwd: repo,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

async function initRepo(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'ainp-test-surface-repo-'));
  await git(repo, ['init']);
  await write(repo, TEST_FILE, TEST_SOURCE);
  await write(repo, 'src/main/java/sample/Calculator.java', 'package sample;\nclass Calculator {}\n');
  await write(repo, 'pom.xml', POM_SOURCE);
  await write(repo, 'mvnw', '#!/bin/sh\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'baseline']);
  return repo;
}

describe('collectTestSurfaceReport', () => {
  test('clean worktree yields an empty report with an available baseline', async () => {
    const repo = await initRepo();
    const report = await collectTestSurfaceReport(repo);
    expect(report.schemaVersion).toBe('test-surface-report/v1');
    expect(report.baselineAvailable).toBe(true);
    expect(report.baseRef).toMatch(/^[0-9a-f]{40}$/);
    expect(report.files).toEqual([]);
    expect(report.harness).toEqual({ changedPaths: [], pomTestConfigChanged: false });
  });

  test('modified test file carries before/after counts', async () => {
    const repo = await initRepo();
    // Weaken: drop the multiplies() case and its two assertions.
    await write(repo, TEST_FILE, TEST_SOURCE.replace(
      /\n  @Test\n  void multiplies\(\) \{[\s\S]*?\n  \}\n/,
      '\n',
    ));
    const report = await collectTestSurfaceReport(repo);
    expect(report.baselineAvailable).toBe(true);
    expect(report.files).toHaveLength(1);
    const entry = report.files[0]!;
    expect(entry).toMatchObject({ path: TEST_FILE, status: 'modified' });
    expect(entry.before).toMatchObject({ testCases: 2, assertions: 3 });
    expect(entry.after).toMatchObject({ testCases: 1, assertions: 1 });
  });

  test('deleted test file keeps baseline counts with no after side', async () => {
    const repo = await initRepo();
    await rm(join(repo, TEST_FILE));
    const report = await collectTestSurfaceReport(repo);
    expect(report.files).toHaveLength(1);
    const entry = report.files[0]!;
    expect(entry.status).toBe('deleted');
    expect(entry.before).toMatchObject({ testCases: 2 });
    expect(entry.after).toBeUndefined();
  });

  test('staged rename is paired via -M instead of reading as a deletion', async () => {
    const repo = await initRepo();
    const renamedPath = 'src/test/java/sample/RenamedCalculatorTest.java';
    await rename(join(repo, TEST_FILE), join(repo, renamedPath));
    // Stage so `git diff HEAD -M` can see both sides of the rename.
    await git(repo, ['add', '-A']);
    const report = await collectTestSurfaceReport(repo);
    expect(report.files).toHaveLength(1);
    const entry = report.files[0]!;
    expect(entry.status).toBe('renamed');
    expect(entry.oldPath).toBe(TEST_FILE);
    expect(entry.path).toBe(renamedPath);
    expect(entry.before).toMatchObject({ testCases: 2 });
    expect(entry.after).toMatchObject({ testCases: 2 });
  });

  test('unstaged rename (untracked new path) is still paired via -M', async () => {
    const repo = await initRepo();
    const renamedPath = 'src/test/java/sample/RenamedCalculatorTest.java';
    await rename(join(repo, TEST_FILE), join(repo, renamedPath));
    // No git add: mirrors the doer turn, which never stages. The collector's
    // throwaway index must pair the rename instead of reporting a deletion.
    const report = await collectTestSurfaceReport(repo);
    expect(report.files).toHaveLength(1);
    const entry = report.files[0]!;
    expect(entry.status).toBe('renamed');
    expect(entry.oldPath).toBe(TEST_FILE);
    expect(entry.path).toBe(renamedPath);
    expect(entry.before).toMatchObject({ testCases: 2 });
    expect(entry.after).toMatchObject({ testCases: 2 });
  });

  test('untracked new test file reports as added with after counts only', async () => {
    const repo = await initRepo();
    await write(repo, 'src/test/java/sample/NewFeatureTest.java', [
      'package sample;',
      'class NewFeatureTest {',
      '  @Test',
      '  void works() { assertTrue(true); }',
      '}',
      '',
    ].join('\n'));
    const report = await collectTestSurfaceReport(repo);
    expect(report.files).toHaveLength(1);
    const entry = report.files[0]!;
    expect(entry.status).toBe('added');
    expect(entry.before).toBeUndefined();
    expect(entry.after).toMatchObject({ testCases: 1, assertions: 1 });
  });

  test('non-test file changes are not reported', async () => {
    const repo = await initRepo();
    await write(repo, 'src/main/java/sample/Calculator.java', 'package sample;\nclass Calculator { int x; }\n');
    const report = await collectTestSurfaceReport(repo);
    expect(report.files).toEqual([]);
    expect(report.harness.pomTestConfigChanged).toBe(false);
  });

  test('pom skipTests flip sets pomTestConfigChanged; dependency-only edits do not', async () => {
    const repo = await initRepo();
    await write(repo, 'pom.xml', POM_SOURCE.replace('<skipTests>false</skipTests>', '<skipTests>true</skipTests>'));
    const flipped = await collectTestSurfaceReport(repo);
    expect(flipped.harness.pomTestConfigChanged).toBe(true);

    await write(repo, 'pom.xml', POM_SOURCE.replace(
      '<build>',
      '<dependencies><dependency><groupId>x</groupId><artifactId>y</artifactId></dependency></dependencies>\n  <build>',
    ));
    const benign = await collectTestSurfaceReport(repo);
    expect(benign.harness.pomTestConfigChanged).toBe(false);
  });

  test('mvnw changes land in harness.changedPaths', async () => {
    const repo = await initRepo();
    await write(repo, 'mvnw', '#!/bin/sh\nexit 0\n');
    const report = await collectTestSurfaceReport(repo);
    expect(report.harness.changedPaths).toEqual(['mvnw']);
  });

  test('non-git directory fails open with notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ainp-test-surface-nogit-'));
    const report = await collectTestSurfaceReport(dir);
    expect(report.baselineAvailable).toBe(false);
    expect(report.baseRef).toBeNull();
    expect(report.files).toEqual([]);
    expect(report.notes.length).toBeGreaterThan(0);
  });
});
