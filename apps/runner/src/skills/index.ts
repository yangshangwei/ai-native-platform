import type { SkillSpec, ProjectAgentBackendKind, ConfigKey } from '@ainp/shared';
import { getConfig } from '../config-client';

/**
 * Canonical SkillSpecs shipped with the runner. The platform owns these;
 * AgentBackends only consume them.
 *
 * Prompts stay backend-agnostic: Claude Code and Codex adapters consume the
 * same SkillSpec, while tests may still exercise legacy fixtures directly.
 */

const ALL: ProjectAgentBackendKind[] = ['claude_code', 'codex'];

export const SKILLS: SkillSpec[] = [
  {
    id: 'skill.context_pack',
    version: '0.1.0',
    stage: 'context_pack',
    instructions:
      'Assemble a Context Pack tying the user request to repo evidence: project_profile excerpt, relevant code refs (paths + line hits), and accepted knowledge from prior runs. Output must cite each evidence as a list item.',
    inputs: [
      { name: 'user_request', kind: 'text', required: true, description: 'one-liner' },
      {
        name: 'project_profile.md',
        kind: 'artifact',
        required: true,
        description: 'thin project profile from registration',
      },
    ],
    outputs: [
      {
        name: 'context_pack.md',
        kind: 'artifact',
        required: true,
        description: 'context pack with evidence refs',
      },
    ],
    toolPolicy: { allowedCommands: [], writableGlobs: [], networkAllowed: false },
    requiredGates: [],
    compatibleBackends: ALL,
  },
  {
    id: 'skill.requirement_draft',
    version: '0.2.0',
    stage: 'requirement',
    instructions: [
      'Turn the user request into a structured requirement document following CodeStable cs-req methodology.',
      '',
      'Output a markdown file with EXACTLY four sections in this order:',
      '',
      '1. **用户故事 (User Stories)** — 2 to 4 bullets. Each bullet must describe a SPECIFIC scenario:',
      '   `作为 {具体角色}，我希望 {能做什么}，而不是 {现在怎么难受}`. No generic "希望系统好用" wording.',
      '',
      '2. **为什么需要 (Why)** — one short paragraph (3-5 sentences). Describe the pain when this capability does not exist. Plain language, non-technical readers must understand.',
      '',
      '3. **怎么解决 (How)** — one short paragraph. Describe what the user EXPERIENCES, NOT how it is implemented. No module names, interfaces, or algorithms.',
      '',
      '4. **边界 (Boundaries)** — bullet list. What it does NOT cover; when not to use it; prerequisites.',
      '',
      'Frontmatter MUST contain:',
      '  doc_type: requirement',
      '  pitch: <one-sentence non-technical summary that could double as marketing copy>',
      '  status: draft',
      '  REQ-### identifier (e.g. REQ-001)',
      '',
      'Body MUST also include:',
      '  - At least one AC-### acceptance criterion section',
      '  - Goals / non-goals / scope subsection (can be inside 边界)',
      '  - Context evidence references (file paths from Context Pack, format: `src/...`)',
      '',
      'HARD RULES:',
      '  - Do NOT write implementation details (no module names, no interface signatures).',
      '  - Do NOT invent user stories — every story must trace to user_request, prior features, or knowledge.',
      '  - Tone: human conversation, not PRD field-stuffing.',
      '  - The `pitch` must be usable as marketing copy without further edits.',
    ].join('\n'),
    inputs: [
      { name: 'user_request', kind: 'text', required: true, description: 'one-liner' },
      {
        name: 'context_pack.md',
        kind: 'artifact',
        required: false,
        description: 'context pack from the prior stage',
      },
    ],
    outputs: [
      {
        name: 'requirement.md',
        kind: 'artifact',
        required: true,
        description: 'requirement_draft markdown',
      },
      {
        name: 'requirement.json',
        kind: 'artifact',
        required: false,
        description: 'structured requirement JSON sidecar',
      },
    ],
    toolPolicy: { allowedCommands: [], writableGlobs: [], networkAllowed: false },
    requiredGates: ['requirement_gate'],
    compatibleBackends: ALL,
  },
  {
    id: 'skill.design',
    version: '0.2.0',
    stage: 'design',
    instructions: [
      'Given the approved requirement and the Context Pack, draft a design document following CodeStable cs-feat-design methodology.',
      '',
      'Frontmatter MUST contain:',
      '  doc_type: design',
      '  design_id: DSN-### (e.g. DSN-001)',
      '  related_req: REQ-### (the requirement this design implements)',
      '  status: draft',
      '',
      'Body MUST contain these five sections in this order:',
      '',
      '1. **现状 (Current State)** — describe the relevant existing code, types, control flow that this change touches. Cite file paths from the Context Pack with line numbers when possible (`src/...:NN`). One short paragraph or bullet list.',
      '',
      '2. **变化 (Changes)** — describe what the new state looks like, contrasted with 现状. Two halves:',
      '   - Noun layer (types / data shapes / interfaces) — show signatures with brief examples',
      '   - Orchestration layer (control flow / call graph delta) — short prose or a tiny diagram',
      '',
      '3. **挂载点 (Mount Points)** — 3 to 5 bullets. Each bullet is a place this feature plugs into. Test: "if I removed this bullet, the feature would disappear or break in user-visible ways." Things that just enable internal correctness do NOT count.',
      '',
      '4. **推进策略 (Roll-out)** — ordered numbered steps for HOW to implement, sliced by paradigm (data → orchestration → tests), not by file. Each step has a single exit signal (e.g. "tests for X pass").',
      '',
      '5. **验收契约 (Acceptance)** — must reference REQ-### / AC-### identifiers from the requirement. Must include a test strategy keyed to AC-###. Must list risks with an explicit mitigation owner.',
      '',
      'HARD RULES:',
      '  - Do NOT repeat the requirement document; reference REQ-### / AC-### instead.',
      '  - Do NOT prescribe code line-by-line — that is implementation stage.',
      '  - Every claim about existing code MUST cite a `src/...` path; uncited assertions are forbidden.',
      '  - 挂载点 must be ≥ 3 and ≤ 5 (CodeStable says 3-5 is the sweet spot — fewer means scope is too thin, more means the design is sprawling).',
    ].join('\n'),
    inputs: [
      {
        name: 'requirement.md',
        kind: 'artifact',
        required: true,
        description: 'approved requirement',
      },
      {
        name: 'context_pack.md',
        kind: 'artifact',
        required: false,
        description: 'context pack',
      },
    ],
    outputs: [
      { name: 'design.md', kind: 'artifact', required: true, description: 'design markdown' },
      {
        name: 'design.json',
        kind: 'artifact',
        required: false,
        description: 'structured design JSON sidecar',
      },
      {
        name: 'traceability.json',
        kind: 'artifact',
        required: false,
        description: 'AC-to-design/files/tests/gates traceability map',
      },
    ],
    toolPolicy: { allowedCommands: [], writableGlobs: [], networkAllowed: false },
    requiredGates: ['design_gate'],
    compatibleBackends: ALL,
  },
  {
    id: 'skill.implementation',
    version: '0.1.0',
    stage: 'implementation',
    instructions:
      'Implement the approved design. Allowed to edit files inside the worktree only. Stay within paths surfaced in the Context Pack unless the design explicitly broadens scope. If `design.md` is absent (e.g. issue.standard flow), use `analysis_doc.md` (or `report.md` as last resort) as primary reference; stay within paths surfaced in those docs.',
    inputs: [
      { name: 'design.md', kind: 'artifact', required: false, description: 'approved design (optional — issue.standard flow has no design step; implementation reads analysis_doc.md / report.md in that case)' },
      {
        name: 'context_pack.md',
        kind: 'artifact',
        required: false,
        description: 'context pack',
      },
    ],
    outputs: [
      { name: 'diff', kind: 'artifact', required: true, description: 'git diff of changes' },
    ],
    toolPolicy: {
      allowedCommands: ['git diff', 'git diff --name-only'],
      writableGlobs: ['src/**', 'examples/**'],
      networkAllowed: false,
    },
    requiredGates: ['diff_scope_gate', 'sensitive_change_gate'],
    compatibleBackends: ALL,
  },
  {
    id: 'skill.review',
    version: '0.1.0',
    stage: 'review',
    instructions:
      'Read the diff and the test report and write a short review (verdict, risks, follow-ups).',
    inputs: [
      { name: 'diff', kind: 'artifact', required: true, description: 'implementation diff' },
    ],
    outputs: [
      { name: 'review.md', kind: 'artifact', required: true, description: 'review markdown' },
    ],
    toolPolicy: { allowedCommands: [], writableGlobs: [], networkAllowed: false },
    requiredGates: ['acceptance_gate'],
    compatibleBackends: ALL,
  },
  // ---- V2 W2-2a: issue.standard flow placeholder skills -------------------
  // Per PRD ADR Q4 (B): instructions are simplified placeholders sufficient
  // for LLMs to emit schema-correct artifacts; prompt-tuning follow-up.
  {
    id: 'skill.issue_report',
    version: '0.1.0',
    stage: 'report',
    instructions: [
      'Take the user-supplied bug description and produce a structured report following CodeStable cs-issue-report methodology.',
      '',
      'Frontmatter MUST contain:',
      '  doc_type: report',
      '  REPT-### identifier (e.g. REPT-001)',
      '  status: draft',
      '',
      'Body MUST contain four sections in this order:',
      '',
      '1. **现象 (Symptom)** — what observable behavior is wrong; one short paragraph',
      '2. **复现步骤 (Reproduction)** — numbered steps to reproduce',
      '3. **期望 vs 实际 (Expected vs Actual)** — explicit before/after contrast',
      '4. **影响范围 (Impact)** — which user/feature surface is affected; severity guess',
      '',
      'HARD RULES:',
      '  - Do NOT propose root cause yet (that is the analyze stage).',
      '  - Do NOT propose fixes yet (that is the analyze stage).',
      '  - Cite the user-supplied request and any context as evidence.',
    ].join('\n'),
    inputs: [
      { name: 'user_request', kind: 'text', required: true, description: 'one-liner bug description' },
    ],
    outputs: [
      { name: 'report.md', kind: 'artifact', required: true, description: 'structured bug report markdown' },
    ],
    toolPolicy: { allowedCommands: [], writableGlobs: [], networkAllowed: false },
    requiredGates: [],
    compatibleBackends: ALL,
  },
  {
    id: 'skill.issue_analyze',
    version: '0.1.0',
    stage: 'analyze',
    instructions: [
      'Read the bug report and the codebase. Identify root cause and propose 2-3 fix options following CodeStable cs-issue-analyze methodology.',
      '',
      'Frontmatter MUST contain:',
      '  doc_type: analysis',
      '  ANL-### identifier (e.g. ANL-001)',
      '  status: draft',
      '',
      'Body MUST contain four sections in this order:',
      '',
      '1. **根因 (Root Cause)** — explain WHY the symptom occurs; cite source paths (`src/...:NN`)',
      '2. **修复方案 (Fix Options)** — 2-3 candidate approaches with trade-offs',
      '3. **推荐方案 (Recommendation)** — pick one with rationale',
      '4. **风险 (Risks)** — what could break; what to verify post-fix',
      '',
      'HARD RULES:',
      '  - Every claim about existing code MUST cite a `src/...` path; uncited assertions are forbidden.',
      '  - Do NOT write the fix yet (that is the implementation stage).',
      '  - Recommendation must be one of the listed options (not a fourth invented inline).',
    ].join('\n'),
    inputs: [
      { name: 'report.md', kind: 'artifact', required: true, description: 'bug report from prior stage' },
    ],
    outputs: [
      { name: 'analysis_doc.md', kind: 'artifact', required: true, description: 'root-cause analysis + fix options markdown' },
    ],
    toolPolicy: { allowedCommands: [], writableGlobs: [], networkAllowed: false },
    requiredGates: [],
    compatibleBackends: ALL,
  },
];

/**
 * Look up the SkillSpec for a stage, with the live `instructions` field
 * overridden from the runtime config layer when an override is present.
 *
 * (PR2) Previously a synchronous lookup against the SKILLS const. Now
 * async because instructions can be live-edited from the UI; structural
 * fields (id / inputs / outputs / requiredGates / toolPolicy /
 * compatibleBackends) remain hard-coded contracts and are NOT exposed
 * for editing.
 */
export async function findSkillForStage(
  stage: SkillSpec['stage'],
): Promise<SkillSpec | undefined> {
  const base = SKILLS.find((s) => s.stage === stage);
  if (!base) return undefined;
  const overrideKey = `${base.id}.instructions` as ConfigKey;
  // All `*.instructions` keys are typed as `string` in the registry, but
  // RegistryDefault<K> widens to the union; cast to string for the SkillSpec.
  const instructions = (await getConfig(overrideKey)) as string;
  return { ...base, instructions };
}
