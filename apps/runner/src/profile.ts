/**
 * Thin Project Profile — fast, evidence-grounded snapshot of a registered
 * project. Persisted to `~/.ai-native/projects/{projectId}/profile.{md,json}`
 * so subsequent Context Pack runs can read it without re-scanning the repo.
 *
 * Heuristic only — POM parsed with regex, no xml lib. Java focus matches the
 * MVP scope; non-Java repos still produce a minimal profile (treeOutline +
 * readmePreview).
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isSensitiveContextPath } from '@ainp/shared';
import { PROJECTS_DIR } from './config';

export interface PomSummary {
  groupId: string | null;
  artifactId: string | null;
  version: string | null;
  javaSource: string | null;
  javaTarget: string | null;
}

export interface ProjectProfile {
  projectId: string;
  name: string;
  localPath: string;
  generatedAt: string;
  buildTool: 'maven' | 'unknown';
  language: 'java' | 'unknown';
  pom: PomSummary | null;
  /** Java packages discovered under src/main/java (max two levels). */
  topLevelPackages: string[];
  /** Test source files (relative to localPath) under src/test/java. */
  testFiles: string[];
  /** First ~3 KB of README.md (or `null` if no README). */
  readmePreview: string | null;
  /** A short directory outline (top-level dirs/files, depth ≤ 2). */
  treeOutline: string[];
}

export interface ProjectProfileResult {
  profile: ProjectProfile;
  markdown: string;
  profileDir: string;
  profileMdPath: string;
  profileJsonPath: string;
}

export function profileDirFor(projectId: string): string {
  return join(PROJECTS_DIR, projectId);
}

export function profileMdPathFor(projectId: string): string {
  return join(profileDirFor(projectId), 'profile.md');
}

export function profileJsonPathFor(projectId: string): string {
  return join(profileDirFor(projectId), 'profile.json');
}

export async function loadProjectProfile(projectId: string): Promise<ProjectProfile | null> {
  const path = profileJsonPathFor(projectId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ProjectProfile;
  } catch {
    return null;
  }
}

export interface GenerateProfileOpts {
  projectId: string;
  name: string;
  localPath: string;
  /** Skip the FS scan and reuse the existing profile if present. Default false. */
  reuseIfPresent?: boolean;
}

export async function generateProjectProfile(
  opts: GenerateProfileOpts,
): Promise<ProjectProfileResult> {
  if (opts.reuseIfPresent) {
    const cached = await loadProjectProfile(opts.projectId);
    if (cached) {
      const profileDir = profileDirFor(opts.projectId);
      const profileMdPath = profileMdPathFor(opts.projectId);
      const profileJsonPath = profileJsonPathFor(opts.projectId);
      const markdown = existsSync(profileMdPath)
        ? await readFile(profileMdPath, 'utf8')
        : renderProfileMarkdown(cached);
      return { profile: cached, markdown, profileDir, profileMdPath, profileJsonPath };
    }
  }

  const profile = await scanProject(opts);
  const markdown = renderProfileMarkdown(profile);
  const profileDir = profileDirFor(opts.projectId);
  const profileMdPath = profileMdPathFor(opts.projectId);
  const profileJsonPath = profileJsonPathFor(opts.projectId);
  await mkdir(profileDir, { recursive: true });
  await writeFile(profileMdPath, markdown, 'utf8');
  await writeFile(profileJsonPath, JSON.stringify(profile, null, 2), 'utf8');
  return { profile, markdown, profileDir, profileMdPath, profileJsonPath };
}

async function scanProject(opts: GenerateProfileOpts): Promise<ProjectProfile> {
  const pomPath = join(opts.localPath, 'pom.xml');
  const hasPom = existsSync(pomPath);
  const pom = hasPom ? parsePomSummary(await readFile(pomPath, 'utf8')) : null;
  const language: ProjectProfile['language'] = hasPom ? 'java' : 'unknown';
  const buildTool: ProjectProfile['buildTool'] = hasPom ? 'maven' : 'unknown';

  const readmePath = ['README.md', 'README.MD', 'readme.md', 'README']
    .map((n) => join(opts.localPath, n))
    .find((p) => existsSync(p));
  const readmePreview = readmePath ? truncateReadme(await readFile(readmePath, 'utf8')) : null;

  const javaRoot = join(opts.localPath, 'src/main/java');
  const topLevelPackages = existsSync(javaRoot) ? await scanJavaPackages(javaRoot) : [];

  const testRoot = join(opts.localPath, 'src/test/java');
  const testFiles = existsSync(testRoot)
    ? (await listFilesRecursive(testRoot, '.java')).map((p) => relative(opts.localPath, p))
    : [];

  const treeOutline = await scanTreeOutline(opts.localPath);

  return {
    projectId: opts.projectId,
    name: opts.name,
    localPath: opts.localPath,
    generatedAt: new Date().toISOString(),
    buildTool,
    language,
    pom,
    topLevelPackages,
    testFiles,
    readmePreview,
    treeOutline,
  };
}

function parsePomSummary(xml: string): PomSummary {
  // Only match top-level <project>’s direct children, not <parent>’s nested ones.
  // Lazy heuristic: strip <parent>...</parent> first.
  const stripped = xml.replace(/<parent>[\s\S]*?<\/parent>/g, '');
  const pick = (tag: string): string | null => {
    const re = new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`);
    const m = stripped.match(re);
    return m ? m[1]!.trim() : null;
  };
  return {
    groupId: pick('groupId'),
    artifactId: pick('artifactId'),
    version: pick('version'),
    javaSource: pick('maven.compiler.source') ?? pick('source'),
    javaTarget: pick('maven.compiler.target') ?? pick('target'),
  };
}

function truncateReadme(s: string): string {
  const MAX = 3 * 1024;
  if (s.length <= MAX) return s;
  return `${s.slice(0, MAX)}\n…(truncated)`;
}

/** Discover Java packages by walking down singleton directory chains, max 4 levels. */
async function scanJavaPackages(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string, prefix: string[], depth: number): Promise<void> {
    if (depth > 4) {
      results.push(prefix.join('.'));
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs = entries.filter((e) => e.isDirectory());
    const javaFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.java'));
    if (javaFiles.length > 0 || subdirs.length === 0) {
      if (prefix.length > 0) results.push(prefix.join('.'));
      return;
    }
    for (const sd of subdirs) {
      await walk(join(dir, sd.name), [...prefix, sd.name], depth + 1);
    }
  }
  await walk(root, [], 0);
  return Array.from(new Set(results)).sort();
}

async function listFilesRecursive(root: string, ext: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (isSensitiveProfilePath(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith(ext)) out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

async function scanTreeOutline(root: string): Promise<string[]> {
  const out: string[] = [];
  const SKIP = new Set(['.git', 'node_modules', 'target', 'build', '.idea', '.vscode', 'dist']);
  let top;
  try {
    top = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of top.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(e.name) || isSensitiveProfilePath(e.name)) continue;
    out.push(e.isDirectory() ? `${e.name}/` : e.name);
    if (e.isDirectory()) {
      try {
        const inner = await readdir(join(root, e.name), { withFileTypes: true });
        for (const ie of inner.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8)) {
          if (SKIP.has(ie.name) || isSensitiveProfilePath(`${e.name}/${ie.name}`)) continue;
          out.push(`  ${e.name}/${ie.isDirectory() ? `${ie.name}/` : ie.name}`);
        }
      } catch {
        // ignore unreadable subdirs
      }
    }
  }
  return out;
}

function isSensitiveProfilePath(value: string): boolean {
  return isSensitiveContextPath(value);
}

function renderProfileMarkdown(p: ProjectProfile): string {
  const lines: string[] = [];
  lines.push(`# Project Profile: ${p.name}`);
  lines.push('');
  lines.push(`- **Project ID**: \`${p.projectId}\``);
  lines.push(`- **Local path**: \`${p.localPath}\``);
  lines.push(`- **Build tool**: ${p.buildTool}`);
  lines.push(`- **Language**: ${p.language}`);
  lines.push(`- **Generated at**: ${p.generatedAt}`);
  if (p.pom) {
    lines.push('');
    lines.push('## Maven coordinates');
    lines.push(`- groupId: \`${p.pom.groupId ?? '?'}\``);
    lines.push(`- artifactId: \`${p.pom.artifactId ?? '?'}\``);
    lines.push(`- version: \`${p.pom.version ?? '?'}\``);
    if (p.pom.javaSource || p.pom.javaTarget) {
      lines.push(`- java source/target: \`${p.pom.javaSource ?? '?'}\` / \`${p.pom.javaTarget ?? '?'}\``);
    }
  }
  if (p.topLevelPackages.length > 0) {
    lines.push('');
    lines.push('## Top-level Java packages');
    for (const pkg of p.topLevelPackages) lines.push(`- \`${pkg}\``);
  }
  if (p.testFiles.length > 0) {
    lines.push('');
    lines.push(`## Test sources (${p.testFiles.length})`);
    for (const t of p.testFiles.slice(0, 50)) lines.push(`- \`${t}\``);
    if (p.testFiles.length > 50) lines.push(`- …(+${p.testFiles.length - 50} more)`);
  }
  if (p.treeOutline.length > 0) {
    lines.push('');
    lines.push('## Tree outline');
    lines.push('```');
    for (const t of p.treeOutline) lines.push(t);
    lines.push('```');
  }
  if (p.readmePreview) {
    lines.push('');
    lines.push('## README preview');
    lines.push('```markdown');
    lines.push(p.readmePreview);
    lines.push('```');
  }
  lines.push('');
  return lines.join('\n');
}
