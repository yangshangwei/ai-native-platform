import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sh } from '../sh';
import type { SkillSpec } from '@ainp/shared';

/**
 * AgentBackend interface — runtime contract.
 *
 * MVP ships only `NativeBackend` which produces deterministic, run-metadata-
 * derived markdown so the lifecycle can be exercised end-to-end without an
 * LLM. The same interface accepts a Codex or Claude Code backend later.
 */
export interface AgentTaskContext {
  workflowRunId: string;
  workspacePath: string;
  branch: string;
  /** The user's original task title — what they typed in `runner orchestrate`. */
  title: string;
  /** Filesystem dir where the agent should drop produced artifacts. */
  artifactsDir: string;
  /** Previously-produced artifact text by skill input name. */
  inputs: Record<string, string>;
}

export interface AgentArtifactOutput {
  /** Logical name (matches a SkillSpec output name). */
  name: string;
  /** Final filesystem path of the artifact (file:// URI computed downstream). */
  path: string;
  contentType: string;
  size: number;
}

export interface AgentBackend {
  kind: 'native' | 'codex' | 'claude_code';
  run(skill: SkillSpec, ctx: AgentTaskContext): Promise<{ outputs: AgentArtifactOutput[] }>;
}

// ---- NativeBackend ---------------------------------------------------------

export class NativeBackend implements AgentBackend {
  kind = 'native' as const;

  async run(
    skill: SkillSpec,
    ctx: AgentTaskContext,
  ): Promise<{ outputs: AgentArtifactOutput[] }> {
    await mkdir(ctx.artifactsDir, { recursive: true });

    switch (skill.stage) {
      case 'context_pack':
        return single(
          await this.writeMarkdown(ctx, 'context_pack.md', await renderContextPack(ctx)),
        );
      case 'requirement':
        return single(await this.writeMarkdown(ctx, 'requirement.md', renderRequirement(ctx)));
      case 'design':
        return single(await this.writeMarkdown(ctx, 'design.md', renderDesign(ctx)));
      case 'implementation':
        return await this.runImplementation(ctx);
      case 'review':
        return single(await this.writeMarkdown(ctx, 'review.md', renderReview(ctx)));
      default:
        throw new Error(`NativeBackend has no recipe for stage ${skill.stage}`);
    }
  }

  private async writeMarkdown(
    ctx: AgentTaskContext,
    name: string,
    body: string,
  ): Promise<AgentArtifactOutput> {
    const path = join(ctx.artifactsDir, name);
    await writeFile(path, body, 'utf8');
    return {
      name,
      path,
      contentType: 'text/markdown',
      size: Buffer.byteLength(body, 'utf8'),
    };
  }

  /**
   * Implementation skill — make a tiny, deterministic, low-risk edit to a Java
   * source file in the worktree so we have a real diff for the gates and the
   * Maven build to chew on. This is the placeholder until a real LLM swaps in.
   */
  private async runImplementation(
    ctx: AgentTaskContext,
  ): Promise<{ outputs: AgentArtifactOutput[] }> {
    const target = join(ctx.workspacePath, 'src/main/java/sample/Calculator.java');
    if (!existsSync(target)) {
      throw new Error(`NativeBackend implementation: expected target file missing: ${target}`);
    }
    const original = await readFile(target, 'utf8');
    const note = `  // ainp-run: ${ctx.workflowRunId} - ${new Date().toISOString()}\n`;
    if (!original.includes('ainp-run:')) {
      const lines = original.split('\n');
      // Insert note after the package declaration to keep imports tidy.
      const insertAt = lines.findIndex((l) => l.startsWith('package ')) + 1;
      lines.splice(insertAt, 0, note);
      await writeFile(target, lines.join('\n'), 'utf8');
    }

    const diff = await sh('git', ['diff'], { cwd: ctx.workspacePath });
    const diffPath = join(ctx.artifactsDir, 'changes.diff');
    await writeFile(diffPath, diff.stdout, 'utf8');

    const namesOnly = await sh('git', ['diff', '--name-only'], { cwd: ctx.workspacePath });
    const namesPath = join(ctx.artifactsDir, 'changed-files.txt');
    await writeFile(namesPath, namesOnly.stdout, 'utf8');

    return {
      outputs: [
        {
          name: 'diff',
          path: diffPath,
          contentType: 'text/x-diff',
          size: Buffer.byteLength(diff.stdout, 'utf8'),
        },
        {
          name: 'changed-files',
          path: namesPath,
          contentType: 'text/plain',
          size: Buffer.byteLength(namesOnly.stdout, 'utf8'),
        },
      ],
    };
  }
}

function single(out: AgentArtifactOutput): { outputs: AgentArtifactOutput[] } {
  return { outputs: [out] };
}

// ---- canned templates ------------------------------------------------------

function renderRequirement(ctx: AgentTaskContext): string {
  return `# Requirement Draft

Run: \`${ctx.workflowRunId}\`
Title: ${ctx.title}

## User Request
${ctx.title}

## Goals
- Deliver "${ctx.title}" within the existing Java/Maven sample.

## Non-goals
- No public API changes; no dependency upgrades.

## Acceptance criteria
- \`mvn -B test\` passes inside the worktree.
- Diff stays inside the allowed source paths.
- All required gates pass.

## Notes
NativeBackend stub output. Replace with a real Agent backend (Codex / Claude
Code / production LLM) by implementing \`AgentBackend\`.

${contextPackExcerpt(ctx)}`;
}

function renderDesign(ctx: AgentTaskContext): string {
  return `# Design

Run: \`${ctx.workflowRunId}\`
Title: ${ctx.title}

## Approach
Add a non-functional marker comment to \`Calculator.java\` and rebuild. The
existing JUnit tests must continue to pass. Used as a smoke for the gate +
build pipeline.

## Files touched
- \`src/main/java/sample/Calculator.java\`

## Risks
- None expected; comment-only edit.

## Reversibility
- Single-line revert.

${contextPackExcerpt(ctx)}`;
}

function renderReview(ctx: AgentTaskContext): string {
  const diff = ctx.inputs['diff'] ?? '<no diff>';
  return `# Review

Run: \`${ctx.workflowRunId}\`
Title: ${ctx.title}

## Verdict
LGTM. Comment-only change. Tests still pass.

## Risks observed
- None.

## Follow-ups
- Replace NativeBackend with a real LLM-driven Implementation Agent.

## Diff (excerpt)
\`\`\`diff
${diff.split('\n').slice(0, 40).join('\n')}
\`\`\`

${contextPackExcerpt(ctx)}`;
}

// ---- Context Pack ---------------------------------------------------------

/** Pull the heading + first ~40 lines of the Context Pack so downstream
 *  artifacts visibly carry the grounding evidence forward. */
function contextPackExcerpt(ctx: AgentTaskContext): string {
  const cp = ctx.inputs['context_pack.md'];
  if (!cp) return '';
  const lines = cp.split('\n').slice(0, 40);
  return `## Context Pack (excerpt)\n\`\`\`markdown\n${lines.join('\n')}\n\`\`\`\n`;
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','for','with','at','by','from','as','is','are','be',
  'this','that','it','we','you','i','do','does','add','make','run','use','using','test','tests',
  'feature','feat','fix','bug','update','change','demo','example','sample','one','two','three',
  'please','need','want','should','could','would','can','may','might','will',
]);

function tokenizeRequest(text: string): string[] {
  const raw = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return Array.from(new Set(raw)).slice(0, 12);
}

interface CodeHit {
  path: string;
  matches: Array<{ line: number; text: string; keyword: string }>;
}

async function searchCodeForKeywords(
  workspacePath: string,
  keywords: string[],
  opts: { maxFiles?: number; maxHitsPerFile?: number; maxBytes?: number } = {},
): Promise<CodeHit[]> {
  if (keywords.length === 0) return [];
  const maxFiles = opts.maxFiles ?? 8;
  const maxHitsPerFile = opts.maxHitsPerFile ?? 3;
  const maxBytes = opts.maxBytes ?? 256 * 1024;
  const javaRoot = join(workspacePath, 'src');
  if (!existsSync(javaRoot)) return [];

  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name));
      else if (e.isFile() && (e.name.endsWith('.java') || e.name.endsWith('.kt'))) {
        files.push(join(dir, e.name));
      }
    }
  }
  await walk(javaRoot);

  const hits: CodeHit[] = [];
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  for (const f of files.sort()) {
    if (hits.length >= maxFiles) break;
    let text: string;
    try {
      const buf = await readFile(f);
      if (buf.byteLength > maxBytes) continue;
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    const lower = text.toLowerCase();
    if (!lowerKeywords.some((k) => lower.includes(k))) continue;
    const matches: CodeHit['matches'] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && matches.length < maxHitsPerFile; i++) {
      const ll = lines[i]!.toLowerCase();
      const hitKw = lowerKeywords.find((k) => ll.includes(k));
      if (hitKw) {
        matches.push({ line: i + 1, text: lines[i]!.trim().slice(0, 160), keyword: hitKw });
      }
    }
    if (matches.length > 0) {
      hits.push({ path: relative(workspacePath, f), matches });
    }
  }
  return hits;
}

async function renderContextPack(ctx: AgentTaskContext): Promise<string> {
  const userRequest = ctx.inputs['user_request'] ?? ctx.title;
  const profile = ctx.inputs['project_profile.md'] ?? '';
  const knowledge = ctx.inputs['accepted_knowledge.md'] ?? '';
  const keywords = tokenizeRequest(userRequest);
  const hits = await searchCodeForKeywords(ctx.workspacePath, keywords);

  const parts: string[] = [];
  parts.push(`# Context Pack`);
  parts.push('');
  parts.push(`Run: \`${ctx.workflowRunId}\``);
  parts.push(`Title: ${ctx.title}`);
  parts.push(`Generated at: ${new Date().toISOString()}`);
  parts.push('');
  parts.push('## User Request');
  parts.push(userRequest);
  parts.push('');
  parts.push('## Search keywords');
  parts.push(keywords.length > 0 ? keywords.map((k) => `\`${k}\``).join(', ') : '_(none — request too short or all stopwords)_');
  parts.push('');
  parts.push('## Project profile snapshot');
  if (profile) {
    const head = profile.split('\n').slice(0, 30).join('\n');
    parts.push('```markdown');
    parts.push(head);
    parts.push('```');
  } else {
    parts.push('_(profile missing — context_pack will rely on raw source scan)_');
  }
  parts.push('');
  parts.push('## Relevant code (evidence)');
  if (hits.length === 0) {
    parts.push('_(no source files matched the request keywords; the implementation should pick a sensible default scope)_');
  } else {
    for (const h of hits) {
      parts.push(`- \`${h.path}\``);
      for (const m of h.matches) {
        parts.push(`  - L${m.line} (\`${m.keyword}\`): \`${m.text}\``);
      }
    }
  }
  parts.push('');
  parts.push('## Accepted knowledge from prior runs');
  if (knowledge.trim()) {
    parts.push(knowledge.trim());
  } else {
    parts.push('_(none yet — knowledge gate has not promoted any candidate for this project)_');
  }
  parts.push('');
  parts.push('## Suggested focus');
  if (hits.length > 0) {
    parts.push(`Consider scoping the implementation to: ${hits.map((h) => `\`${h.path}\``).join(', ')}.`);
  } else {
    parts.push('No code-level evidence — fall back to the project profile’s top-level packages.');
  }
  parts.push('');
  return parts.join('\n');
}
