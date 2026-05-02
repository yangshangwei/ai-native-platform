import type { SkillSpec, AgentBackendKind } from '@ainp/shared';

/**
 * Canonical SkillSpecs shipped with the runner. The platform owns these;
 * AgentBackends only consume them.
 *
 * MVP keeps prompts terse — `NativeBackend` will template the prompt with
 * run-time inputs and produce deterministic markdown. When a real LLM is
 * plugged in, the same SkillSpec drives the prompt and gate selection.
 */

const ALL: AgentBackendKind[] = ['native', 'codex', 'claude_code'];

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
    version: '0.1.0',
    stage: 'design',
    instructions:
      'Given the approved requirement and the Context Pack, draft a brief design: components touched, data shape, risks. Reference paths from the Context Pack when claiming impact.',
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
      'Implement the approved design. Allowed to edit files inside the worktree only. Stay within paths surfaced in the Context Pack unless the design explicitly broadens scope.',
    inputs: [
      { name: 'design.md', kind: 'artifact', required: true, description: 'approved design' },
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
];

export function findSkillForStage(
  stage: SkillSpec['stage'],
): SkillSpec | undefined {
  return SKILLS.find((s) => s.stage === stage);
}
