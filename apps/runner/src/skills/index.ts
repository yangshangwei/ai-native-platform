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
    version: '0.1.0',
    stage: 'requirement',
    instructions:
      'Turn the user request into a structured requirement: goals, scope, non-goals, acceptance criteria. Use the Context Pack to ground claims in real code paths.',
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
