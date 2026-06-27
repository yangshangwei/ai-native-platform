import type { Project, SkillSpec, WorkflowRun, WorkflowStage } from '@ainp/shared';
import type { AgentBackend } from '../../src/agents/types';
import type { RunCtx } from '../../src/orchestrator/types';

export function projectFixture(): Project {
  return {
    id: 'proj_orch',
    name: 'Orchestrator Project',
    localPath: '/repo',
    language: 'unknown',
    buildTool: 'unknown',
    defaultBranch: 'main',
    registeredAt: '2026-06-12T00:00:00.000Z',
    agentBackend: 'codex',
  };
}

export function runFixture(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run_orch',
    projectId: 'proj_orch',
    type: 'feature',
    status: 'running',
    currentStage: 'implementation',
    flowId: 'feature.standard',
    startStage: null,
    configSnapshotId: null,
    sourceBranch: 'main',
    branch: 'ai/run-1',
    workspacePath: '/tmp/workspace',
    title: 'Orchestrator de-closure test run',
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    ...overrides,
  };
}

export function skillFixture(stage: WorkflowStage, overrides: Partial<SkillSpec> = {}): SkillSpec {
  return {
    id: `skill.${stage}`,
    version: '1.0.0',
    stage,
    instructions: `Run the ${stage} stage.`,
    inputs: [],
    outputs: [],
    toolPolicy: { allowedCommands: [], writableGlobs: [], networkAllowed: false },
    requiredGates: [],
    compatibleBackends: ['native'],
    ...overrides,
  };
}

export function backendFixture(
  run: AgentBackend['run'] = async () => ({ outputs: [] }),
): AgentBackend {
  return { kind: 'native', run };
}

/**
 * A fully-populated RunCtx whose contextFoundation is already loaded, so
 * `ensureContextFoundation` never reaches for the filesystem or the API.
 */
export function runCtxFixture(overrides: Partial<RunCtx> = {}): RunCtx {
  return {
    project: projectFixture(),
    run: runFixture(),
    workspace: {
      workflowRunId: 'run_orch',
      path: '/tmp/workspace',
      branch: 'ai/run-1',
      environmentKind: 'trusted_local_worktree',
    },
    backend: backendFixture(),
    tools: { jdk: null, maven: null },
    opts: { project: 'Orchestrator Project', title: 'Orchestrator de-closure test run' },
    runArtifactsDir: '/tmp/run-artifacts',
    inputs: { user_request: 'Orchestrator de-closure test run' },
    inputArtifactIds: {},
    contextFoundation: {
      projectProfileResult: {
        profile: {
          projectId: 'proj_orch',
          name: 'Orchestrator Project',
          localPath: '/repo',
          generatedAt: '2026-06-12T00:00:00.000Z',
          buildTool: 'unknown',
          language: 'unknown',
          pom: null,
          topLevelPackages: [],
          testFiles: [],
          readmePreview: null,
          treeOutline: [],
        },
        markdown: '# Project Profile\n\n- Build tool: unknown',
        profileDir: '/tmp/profile',
        profileMdPath: '/tmp/profile/profile.md',
        profileJsonPath: '/tmp/profile/profile.json',
      },
      acceptedKnowledge: '',
      knowledgeArtifacts: [],
      runHistory: [],
    },
    contextPolicy: {
      budget: { maxTokens: 100_000, reservedForReasoning: 20_000, reservedForOutput: 8_000 },
      sensitivePathPatterns: [],
    },
    contextRequestChain: [],
    draftsToPromote: [],
    handoffContext: {
      implementationSessionId: null,
      implementationArtifactIds: [],
    },
    ok: { value: true },
    ...overrides,
  };
}
