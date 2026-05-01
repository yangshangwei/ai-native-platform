import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
`;
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
`;
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
`;
}
