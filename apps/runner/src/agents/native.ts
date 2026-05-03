import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sh } from '../sh';
import type { SkillSpec } from '@ainp/shared';

/**
 * AgentBackend interface — runtime contract.
 *
 * Production orchestration uses Claude Code or Codex. `NativeBackend` remains
 * only as a deterministic fixture for legacy parser/sidecar tests.
 */
export interface AgentTaskContext {
  workflowRunId: string;
  /** Step run that owns this agent invocation. Used for streaming events.
   *  May be null when the orchestrator runs an agent outside of a step. */
  stepRunId?: string | null;
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
        return multiple([
          await this.writeMarkdown(ctx, 'requirement.md', renderRequirement(ctx)),
          await this.writeJson(ctx, 'requirement.json', buildRequirementSidecar(ctx)),
        ]);
      case 'design':
        return multiple([
          await this.writeMarkdown(ctx, 'design.md', renderDesign(ctx)),
          await this.writeJson(ctx, 'design.json', buildDesignSidecar(ctx)),
          await this.writeJson(ctx, 'traceability.json', buildTraceabilitySidecar(ctx)),
        ]);
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

  private async writeJson(
    ctx: AgentTaskContext,
    name: string,
    value: unknown,
  ): Promise<AgentArtifactOutput> {
    const body = `${JSON.stringify(value, null, 2)}\n`;
    const path = join(ctx.artifactsDir, name);
    await writeFile(path, body, 'utf8');
    return {
      name,
      path,
      contentType: 'application/json',
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

function multiple(outputs: AgentArtifactOutput[]): { outputs: AgentArtifactOutput[] } {
  return { outputs };
}

// ---- canned templates ------------------------------------------------------

function buildRequirementSidecar(ctx: AgentTaskContext) {
  return {
    schemaVersion: 'ainp.requirement.v1',
    title: 'Requirement Draft',
    runId: ctx.workflowRunId,
    userRequest: ctx.title,
    goals: [
      `REQ-001 supports the user request: "${ctx.title}".`,
    ],
    userScenarios: [
      `As a maintainer, I can deliver "${ctx.title}" inside the existing Java/Maven sample and verify it with the local toolchain.`,
    ],
    acceptanceCriteria: [
      { id: 'AC-001', text: '`mvn -B -DskipTests compile` passes inside the worktree.' },
      { id: 'AC-002', text: '`mvn -B test` passes inside the worktree and Surefire reports are parsed.' },
      { id: 'AC-003', text: 'Diff stays inside the allowed source paths.' },
      { id: 'AC-004', text: 'Required gates pass and human approvals are recorded.' },
    ],
    nonGoals: ['No public API changes; no dependency upgrades.'],
    openQuestions: [],
  };
}

function buildDesignSidecar(ctx: AgentTaskContext) {
  return {
    schemaVersion: 'ainp.design.v1',
    title: 'Design',
    runId: ctx.workflowRunId,
    summary: [
      'D-001: apply a low-risk source-only implementation in Calculator.java and verify it through compile/test gates.',
    ],
    affectedModules: ['Java sample application'],
    filesTouched: ['src/main/java/sample/Calculator.java'],
    testStrategy: [
      'AC-001: Run `mvn -B -DskipTests compile` and require `compile_gate=pass`.',
      'AC-002: Run `mvn -B test`, parse Surefire XML, and require `test_gate=pass`.',
      'AC-003: Capture `git diff --name-only` and require `diff_scope_gate=pass`.',
      'AC-004: Record approval rows for requirement, design, acceptance, and knowledge gates.',
    ],
    risks: ['None expected; comment-only edit in the native baseline.'],
    coverage: [
      {
        requirement: 'REQ-001',
        design: 'D-001',
        acceptanceCriteria: ['AC-001', 'AC-002', 'AC-003', 'AC-004'],
        verification: 'Compile/Test gates + Diff Scope/Sensitive gates',
        status: 'covered',
      },
    ],
  };
}

function buildTraceabilitySidecar(ctx: AgentTaskContext) {
  return {
    schemaVersion: 'ainp.traceability.v1',
    runId: ctx.workflowRunId,
    items: {
      'AC-001': {
        designItems: ['D-001'],
        files: ['src/main/java/sample/Calculator.java'],
        tests: ['maven-compile'],
        gates: ['compile_gate'],
        artifacts: ['design.json'],
      },
      'AC-002': {
        designItems: ['D-001'],
        files: ['src/main/java/sample/Calculator.java'],
        tests: ['maven-surefire'],
        gates: ['test_gate'],
        artifacts: ['design.json'],
      },
      'AC-003': {
        designItems: ['D-001'],
        files: ['src/main/java/sample/Calculator.java'],
        tests: [],
        gates: ['diff_scope_gate'],
        artifacts: ['changes.diff', 'changed-files.txt'],
      },
      'AC-004': {
        designItems: ['D-001'],
        files: [],
        tests: [],
        gates: ['requirement_gate', 'design_gate', 'acceptance_gate', 'knowledge_gate'],
        artifacts: ['requirement.json', 'design.json', 'traceability.json'],
      },
    },
  };
}

function renderRequirement(ctx: AgentTaskContext): string {
  return `---
doc_type: requirement
pitch: ${ctx.title} —— 把这次需求落成可验收、可追溯的一次交付
status: draft
REQ-001: ${ctx.workflowRunId}
---

# ${ctx.title}

## 用户故事
- 作为提需求的用户，我希望平台按 "${ctx.title}" 落地，而不是把需求扔进黑盒
- 作为下游验收人，我希望看到结构化产物和证据链，而不是只读 LLM 自述完成

## 为什么需要
当前 "${ctx.title}" 在该项目中尚未实现或与现状不一致。把它做成一次完整的 9 阶段流水线交付，可以保留每个阶段的 artifact 给后续验收和审计追溯，比起把任务整段丢给 AI 然后等结果，过程的每一步都是可观察的。

## 怎么解决
平台沿着既有 9 阶段流水线推进这次需求：从 Context Pack 拉取工程背景，经过 design / implementation，最终通过本地真实 mvn compile/test 与 acceptance gate 验收，结果落进 Completion Report 与 Knowledge Candidate。

## 边界
- AC-001 验收标准: \`mvn -B -DskipTests compile\` 在 worktree 内通过
- AC-002 验收标准: \`mvn -B test\` 在 worktree 内通过且 Surefire 报告被解析
- AC-003 验收标准: diff 只动允许的源路径
- AC-004 验收标准: 必需的 gate 全部通过、人工审批均落库
- goals: 让本次需求可验收可追溯
- non-goals: 不改公共 API，不升级依赖
- 前置：runner 在线、JDK/Maven/Git 可用

## Traceability seed
| Requirement | Acceptance Criteria | Context Evidence |
|---|---|---|
| REQ-001 | AC-001, AC-002, AC-003, AC-004 | Context Pack excerpt below |

## Notes
NativeBackend stub output. Replace with a real Agent backend (Codex / Claude
Code / production LLM) by implementing \`AgentBackend\`.

${contextPackExcerpt(ctx)}`;
}

function renderDesign(ctx: AgentTaskContext): string {
  return `---
doc_type: design
design_id: DSN-001
related_req: REQ-001
status: draft
---

# DSN-001: ${ctx.title}

对应需求：REQ-001（AC-001 ~ AC-004）

## 现状
\`src/main/java/sample/Calculator.java\` 现存类是 \`final\`、构造私有。已有方法 \`add(int,int)\` 与 \`multiply(int,int)\` 都是静态、纯函数式。\`src/test/java/sample/CalculatorTest.java\` 用 JUnit 4 覆盖加法和乘法各一条用例。Maven 配置在 \`pom.xml\`，目标 Java 1.8。

## 变化
**名词层（types/data）**：不引入新类；只在 \`Calculator\` 上加入新静态方法。新方法签名样例：

\`\`\`
public static int divide(int a, int b)
\`\`\`

**编排层（control flow）**：从一个用例点（runner orchestrate）经现有 9 阶段流水线推进，本次变化仅落在 implementation + build_test 两阶段，其它阶段产出物保持现状。

## 挂载点
- \`src/main/java/sample/Calculator.java\` 新增源代码（implementation 阶段产出）
- \`mvn -B -DskipTests compile\` + \`mvn -B test\` 跑通（build_test 阶段验证）
- \`acceptance_gate\` 收齐 Requirement → Design → Diff → Test 证据链

## 推进策略
1. implementation 阶段在 \`src/main/java/sample/Calculator.java\` 增加新内容
2. build_test 阶段跑 \`mvn compile\` 和 \`mvn test\`，要求 exit=0
3. review + acceptance 收口

## 验收契约
- AC-001: \`mvn -B -DskipTests compile\` exit=0 → \`compile_gate=pass\`
- AC-002: \`mvn -B test\` exit=0 + Surefire 解析 → \`test_gate=pass\`
- AC-003: \`git diff --name-only\` 仅在允许前缀内 → \`diff_scope_gate=pass\`
- AC-004: requirement / design / acceptance / knowledge 四个人工 gate 都有 approval 行
- 风险：低；mitigation owner: design-stage NativeBackend 自身（模板产物，可复现）
- 测试策略：以上 4 条 AC 全部由真实 mvn 命令 + Surefire XML + DB 审计行验证

## Context Evidence
- 现有实现路径：\`src/main/java/sample/Calculator.java\`
- Context Pack 节选见下方，证明范围限定在当前项目

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
  parts.push('## Evidence refs');
  if (hits.length === 0) {
    parts.push('- type: project_profile');
    parts.push('  ref: `project_profile.md`');
    parts.push('  claim: Project profile is the fallback evidence source for this request.');
  } else {
    for (const h of hits) {
      for (const m of h.matches) {
        parts.push(`- type: file`);
        parts.push(`  ref: \`${h.path}:${m.line}\``);
        parts.push(`  claim: Keyword \`${m.keyword}\` matched current source: \`${m.text}\``);
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
