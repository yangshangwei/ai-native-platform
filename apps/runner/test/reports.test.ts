import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectMavenReports, persistMavenReports } from '../src/reports';

describe('Maven report persistence', () => {
  it('copies collected Surefire XML into a durable artifact directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ainp-runner-reports-'));
    const workspace = join(root, 'workspace');
    const sourceDir = join(workspace, 'target', 'surefire-reports');
    mkdirSync(sourceDir, { recursive: true });

    const xml = '<testsuite name="sample.CalculatorTest" tests="4" failures="0" errors="0" skipped="0"></testsuite>\n';
    const sourcePath = join(sourceDir, 'TEST-sample.CalculatorTest.xml');
    writeFileSync(sourcePath, xml, 'utf8');

    const collected = await collectMavenReports(workspace);
    const outputDir = join(root, 'artifacts', 'build_test', 'maven-reports');
    const persisted = await persistMavenReports(collected, outputDir);

    const durablePath = join(outputDir, 'surefire-reports', 'TEST-sample.CalculatorTest.xml');
    expect(persisted.surefire?.reportPaths).toEqual([durablePath]);
    expect(persisted.surefire).toMatchObject({ total: 4, passed: 4, failed: 0, errors: 0 });
    expect(durablePath).not.toBe(sourcePath);
    expect(existsSync(durablePath)).toBe(true);
    expect(readFileSync(durablePath, 'utf8')).toBe(xml);
  });
});
