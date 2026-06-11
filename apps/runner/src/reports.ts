import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  aggregateSurefire,
  parseSurefireSummary,
  type SurefireAggregate,
  type TestSuiteSummary,
} from '@ainp/shared';

/**
 * Walk `target/surefire-reports/*.xml` (and failsafe-reports for IT runs) in
 * a workspace, parse each one, aggregate into a SurefireAggregate plus the
 * raw XML report file refs (caller wraps these into Artifacts).
 */
export interface CollectedReports {
  surefire: SurefireAggregate | null;
  failsafe: SurefireAggregate | null;
}

export async function collectMavenReports(workspacePath: string): Promise<CollectedReports> {
  return {
    surefire: await collectOne(workspacePath, 'surefire-reports', 'maven-surefire'),
    failsafe: await collectOne(workspacePath, 'failsafe-reports', 'maven-failsafe'),
  };
}

export async function persistMavenReports(
  reports: CollectedReports,
  outputDir: string,
): Promise<CollectedReports> {
  return {
    surefire: await persistOne(reports.surefire, outputDir, 'surefire-reports'),
    failsafe: await persistOne(reports.failsafe, outputDir, 'failsafe-reports'),
  };
}

async function collectOne(
  workspacePath: string,
  dir: string,
  framework: 'maven-surefire' | 'maven-failsafe',
): Promise<SurefireAggregate | null> {
  const reportsDir = join(workspacePath, 'target', dir);
  if (!existsSync(reportsDir)) return null;

  const xmlFiles = (await readdir(reportsDir))
    .filter((f) => f.startsWith('TEST-') && f.endsWith('.xml'))
    .map((f) => join(reportsDir, f));

  const parsed: Array<{ path: string; summary: TestSuiteSummary }> = [];
  for (const path of xmlFiles) {
    const xml = await readFile(path, 'utf8');
    const summary = parseSurefireSummary(xml);
    if (summary) parsed.push({ path, summary });
  }
  if (parsed.length === 0) return null;
  return aggregateSurefire(framework, parsed);
}

async function persistOne(
  aggregate: SurefireAggregate | null,
  outputDir: string,
  reportsDirName: string,
): Promise<SurefireAggregate | null> {
  if (!aggregate) return null;
  const targetDir = join(outputDir, reportsDirName);
  await mkdir(targetDir, { recursive: true });
  const reportPaths: string[] = [];
  for (const sourcePath of aggregate.reportPaths) {
    const targetPath = join(targetDir, basename(sourcePath));
    await copyFile(sourcePath, targetPath);
    reportPaths.push(targetPath);
  }
  return { ...aggregate, reportPaths };
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}
