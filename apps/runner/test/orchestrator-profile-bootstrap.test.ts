import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { FLOW_REGISTRY, type Artifact, type StepRun } from '@ainp/shared';
import { dispatchStep, type DispatchDeps } from '../src/orchestrator';
import {
  PROJECT_PROFILE_PROVENANCE_FIELDS,
  PROJECT_PROFILE_SCHEMA_VERSION,
  PROJECT_PROFILE_REQUIRED_TOP_LEVEL_FIELDS,
  validateProjectProfileJson,
} from '../src/project-profile-contract';
import { SKILLS } from '../src/skills';
import {
  executeCompletion,
  executeInventory,
  executeKnowledgePromotion,
  executeProfileBootstrap,
  type StepDeps,
} from '../src/orchestrator/steps';
import { buildProjectInventory } from '../src/project-inventory';
import type { InvokedAgent } from '../src/orchestrator/types';
import { backendFixture, projectFixture, runCtxFixture, runFixture, skillFixture } from './helpers/orchestrator-fixtures';

function profileDepsFixture(agent?: InvokedAgent) {
  const postedArtifacts: Array<Record<string, unknown>> = [];
  const deps = {
    api: {
      stepStarted: vi.fn(async (params: { stage: string }) => ({
        step: { id: `step_${params.stage}` } as unknown as StepRun,
      })),
      stepFinished: vi.fn(async () => ({})),
      stepCheckpoint: vi.fn(async () => ({ checkpoint: { id: 'scp_profile' } })),
      postArtifact: vi.fn(async (params: Record<string, unknown>) => {
        postedArtifacts.push(params);
        const metadata = params.metadata as Record<string, unknown> | undefined;
        const output = typeof metadata?.output === 'string' ? metadata.output : metadata?.role;
        return { id: `art_${String(output).replace(/[^a-z0-9]+/gi, '_')}` } as unknown as Artifact;
      }),
      stageTransition: vi.fn(async () => ({})),
      runGate: vi.fn(async () => ({ gate: { status: 'pass' } })),
      generateCompletionReport: vi.fn(async () => ({
        artifact: { id: 'art_completion_report', uri: 'file:///tmp/completion-report.md' },
      })),
      generateKnowledgeCandidate: vi.fn(async () => ({
        artifact: { id: 'art_knowledge_candidate', uri: 'file:///tmp/knowledge-candidate.md' },
      })),
      awaitHuman: vi.fn(async () => ({})),
      getWorkflowRun: vi.fn(async () => ({ actions: [] })),
    },
    mustSkill: vi.fn(async () => skillFixture('profile', { id: 'project-profile-bootstrap' })),
    buildProjectInventory: vi.fn(async (_input: Parameters<typeof buildProjectInventory>[0]) => ({
      schemaVersion: 'ainp.project_inventory.v1',
      projectId: 'proj_orch',
      workflowRunId: 'run_orch',
      generatedAt: '2026-06-30T00:00:00.000Z',
      repo: { root: '/tmp/workspace', branch: 'main', commit: null, dirty: false },
      files: [],
      configs: [],
      commands: [],
      git: { available: false, branch: null, commit: null, remotes: [] },
      warnings: [],
      sourceChunkIndex: {
        schemaVersion: 'ainp.source_chunk_index.v1',
        generatedAt: '2026-06-30T00:00:00.000Z',
        source: 'project_inventory.sourceChunks',
        chunkCount: 1,
        maxEntries: 120,
        entries: [
          {
            id: 'src_chunk_idx_orch',
            sourceChunkRef: 'src_chunk_orch',
            contentSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            path: 'apps/api/src/index.ts',
            startLine: 1,
            endLine: 1,
            language: 'typescript/javascript',
            lexicalTokens: ['index'],
            searchText: 'index',
            linkedRecordRefs: ['sym_index_ok'],
            sourceRefs: ['file:apps/api/src/index.ts#L1'],
            entrypointRefs: [],
            symbolRefs: ['sym_index_ok'],
            graphEdgeRefs: [],
            testRefs: [],
            hotspotRefs: [],
            capabilityRefs: [],
          },
        ],
      },
    })),
    selectAgentBackend: vi.fn(async () => backendFixture()),
    invokeSkill: vi.fn(async () => {
      if (!agent) throw new Error('unexpected invokeSkill');
      return agent;
    }),
    finishAgentSuccess: vi.fn(async () => {}),
    awaitApproval: vi.fn(async () => ({ approved: true })),
    persistKnowledgeCandidate: vi.fn(async () => null),
  };
  return { deps: deps as unknown as StepDeps, raw: deps, postedArtifacts };
}

function validProjectProfileJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
    projectId: 'proj_orch',
    workflowRunId: 'run_orch',
    generatedAt: '2026-06-30T00:00:00.000Z',
    inventoryArtifactId: 'art_inventory',
    repo: {},
    summary: 'profile',
    architecture: {},
    commands: [],
    modules: [],
    businessFlows: [],
    riskAreas: [],
    conventions: [],
    domainVocabulary: [],
    openQuestions: [],
    knowledgeCandidates: [],
    ...overrides,
  };
}

async function profileAgentFixture(profileJson: Record<string, unknown>): Promise<InvokedAgent> {
  const profileDir = await mkdtemp(join(tmpdir(), 'profile-agent-'));
  const markdown = '# Project Profile\n';
  const markdownPath = join(profileDir, 'project-profile.md');
  await writeFile(markdownPath, markdown, 'utf8');
  const jsonText = `${JSON.stringify(profileJson, null, 2)}\n`;
  const jsonPath = join(profileDir, 'project-profile.json');
  await writeFile(jsonPath, jsonText, 'utf8');
  return {
    taskId: 'task_profile',
    sessionId: 'ags_profile',
    invocationId: 'ctxinv_profile',
    contextPackArtifactId: 'art_context_profile',
    outputs: [
      { name: 'project-profile.md', path: markdownPath, contentType: 'text/markdown', size: Buffer.byteLength(markdown) },
      { name: 'project-profile.json', path: jsonPath, contentType: 'application/json', size: Buffer.byteLength(jsonText) },
    ],
    contextPack: { id: 'ctxpack_profile' } as InvokedAgent['contextPack'],
    contextRequest: null,
  };
}

async function expectProfileJsonRejected(
  profileJson: Record<string, unknown>,
  expectedMessage: string,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'profile-invalid-json-'));
  const agent = await profileAgentFixture(profileJson);
  const { deps, raw } = profileDepsFixture(agent);
  const c = runCtxFixture({
    runArtifactsDir: dir,
    inputArtifactIds: { 'project-inventory.json': 'art_inventory' },
    inputs: { 'project-inventory.json': '{"schemaVersion":"ainp.project_inventory.v1"}' },
  });

  await expect(executeProfileBootstrap(c, deps)).rejects.toThrow(expectedMessage);

  expect(raw.api.postArtifact).not.toHaveBeenCalled();
  expect(raw.finishAgentSuccess).not.toHaveBeenCalled();
}

describe('profile bootstrap runner stages', () => {
  test('profile bootstrap skill prompt uses the shared JSON contract fields', () => {
    const skill = SKILLS.find((candidate) => candidate.id === 'project-profile-bootstrap');

    expect(skill?.instructions).toContain(PROJECT_PROFILE_SCHEMA_VERSION);
    expect(skill?.instructions).toContain(PROJECT_PROFILE_REQUIRED_TOP_LEVEL_FIELDS.join(', '));
    for (const field of PROJECT_PROFILE_PROVENANCE_FIELDS) {
      expect(PROJECT_PROFILE_REQUIRED_TOP_LEVEL_FIELDS).toContain(field);
    }
  });

  test('shared profile JSON validator keeps nested sourceRefs out of scope', () => {
    const schemaVersion = validateProjectProfileJson(
      JSON.stringify(validProjectProfileJson({
        architecture: {
          body: 'API worker split.',
          sourceRefs: [42],
          confidence: 0.9,
          freshness: 'current',
          scope: 'repo',
        },
      })),
      {
        projectId: 'proj_orch',
        workflowRunId: 'run_orch',
        inventoryArtifactId: 'art_inventory',
      },
    );

    expect(schemaVersion).toBe(PROJECT_PROFILE_SCHEMA_VERSION);
  });

  test('inventory persists project-inventory and source-index artifacts without selecting an agent backend', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-inventory-'));
    const { deps, raw, postedArtifacts } = profileDepsFixture();
    const c = runCtxFixture({ runArtifactsDir: dir });

    await executeInventory(c, deps);

    expect(raw.buildProjectInventory).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      workflowRunId: 'run_orch',
      repoRoot: '/tmp/workspace',
    });
    expect(raw.selectAgentBackend).not.toHaveBeenCalled();
    expect(postedArtifacts[0]).toMatchObject({
      workflowRunId: 'run_orch',
      stepRunId: 'step_inventory',
      kind: 'other',
      contentType: 'application/json',
      metadata: {
        role: 'project_inventory',
        schemaVersion: 'ainp.project_inventory.v1',
        output: 'project-inventory.json',
        stage: 'inventory',
      },
    });
    expect(postedArtifacts[1]).toMatchObject({
      workflowRunId: 'run_orch',
      stepRunId: 'step_inventory',
      kind: 'other',
      contentType: 'application/json',
      metadata: {
        role: 'source_chunk_index',
        schemaVersion: 'ainp.source_chunk_index.v1',
        output: 'source-chunk-index.json',
        stage: 'inventory',
        sourceInventoryArtifactId: 'art_project_inventory_json',
      },
    });
    expect(c.inputs['project-inventory.json']).toContain('"schemaVersion": "ainp.project_inventory.v1"');
    expect(c.inputs['source-chunk-index.json']).toBeUndefined();
    expect(c.inputArtifactIds['project-inventory.json']).toBe('art_project_inventory_json');
    expect(c.inputArtifactIds['source-chunk-index.json']).toBeUndefined();
    expect(raw.api.stepFinished).toHaveBeenCalledWith({ stepRunId: 'step_inventory', status: 'passed' });
  });

  test('inventory passes the configured source chunk embedding provider to the scanner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-inventory-provider-'));
    const { deps, raw } = profileDepsFixture();
    const sourceChunkEmbeddingProvider = {
      embed: vi.fn(async () => null),
    };
    deps.sourceChunkEmbeddingProvider = sourceChunkEmbeddingProvider;
    const c = runCtxFixture({ runArtifactsDir: dir });

    await executeInventory(c, deps);

    expect(raw.buildProjectInventory).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      workflowRunId: 'run_orch',
      repoRoot: '/tmp/workspace',
      sourceChunkEmbeddingProvider,
    });
    expect(raw.selectAgentBackend).not.toHaveBeenCalled();
  });

  test('profile fails closed on backend preflight before invoking the profile agent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-preflight-'));
    const { deps, raw } = profileDepsFixture();
    raw.selectAgentBackend.mockRejectedValueOnce(new Error('no Agent Backend configured for project'));
    const c = runCtxFixture({
      runArtifactsDir: dir,
      inputArtifactIds: { 'project-inventory.json': 'art_inventory' },
      inputs: { 'project-inventory.json': '{"schemaVersion":"ainp.project_inventory.v1"}' },
    });

    await expect(executeProfileBootstrap(c, deps)).rejects.toThrow('no Agent Backend configured');

    expect(raw.invokeSkill).not.toHaveBeenCalled();
    expect(raw.api.postArtifact).not.toHaveBeenCalled();
    expect(raw.api.stepFinished).toHaveBeenCalledWith({
      stepRunId: 'step_profile',
      status: 'failed',
      failureReason: 'no Agent Backend configured for project',
    });
    expect(c.ok.value).toBe(false);
  });

  test('profile writes markdown and JSON artifacts with inventory provenance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-success-'));
    const profileDir = await mkdtemp(join(tmpdir(), 'profile-agent-'));
    const markdownPath = join(profileDir, 'project-profile.md');
    const jsonPath = join(profileDir, 'project-profile.json');
    await writeFile(markdownPath, '# Project Profile\n', 'utf8');
    const jsonText = `${JSON.stringify({
      schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
      projectId: 'proj_orch',
      workflowRunId: 'run_orch',
      generatedAt: '2026-06-30T00:00:00.000Z',
      inventoryArtifactId: 'art_inventory',
      repo: {},
      summary: 'profile',
      architecture: {},
      commands: [],
      modules: [],
      businessFlows: [],
      riskAreas: [],
      conventions: [],
      domainVocabulary: [],
      openQuestions: [],
      knowledgeCandidates: [],
    })}\n`;
    await writeFile(jsonPath, jsonText, 'utf8');
    const agent: InvokedAgent = {
      taskId: 'task_profile',
      sessionId: 'ags_profile',
      invocationId: 'ctxinv_profile',
      contextPackArtifactId: 'art_context_profile',
      outputs: [
        { name: 'project-profile.md', path: markdownPath, contentType: 'text/markdown', size: Buffer.byteLength('# Project Profile\n') },
        { name: 'project-profile.json', path: jsonPath, contentType: 'application/json', size: Buffer.byteLength(jsonText) },
      ],
      contextPack: { id: 'ctxpack_profile' } as InvokedAgent['contextPack'],
      contextRequest: null,
    };
    const { deps, raw, postedArtifacts } = profileDepsFixture(agent);
    const c = runCtxFixture({
      runArtifactsDir: dir,
      inputArtifactIds: { 'project-inventory.json': 'art_inventory' },
      inputs: { 'project-inventory.json': '{"schemaVersion":"ainp.project_inventory.v1"}' },
    });

    await executeProfileBootstrap(c, deps);

    expect(raw.selectAgentBackend).toHaveBeenCalled();
    expect(raw.invokeSkill).toHaveBeenCalledWith(c, expect.objectContaining({ id: 'project-profile-bootstrap' }), {
      workflowRunId: 'run_orch',
      stepRunId: 'step_profile',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      title: 'Orchestrator de-closure test run',
      artifactsDir: join(dir, 'profile'),
      inputs: c.inputs,
    });
    expect(postedArtifacts).toHaveLength(2);
    expect(postedArtifacts[0]).toMatchObject({
      kind: 'project_profile',
      contentType: 'text/markdown',
      metadata: {
        profileFormat: 'markdown',
        inventoryArtifactId: 'art_inventory',
      },
    });
    expect(postedArtifacts[1]).toMatchObject({
      kind: 'project_profile',
      contentType: 'application/json',
      metadata: {
        profileFormat: 'json',
        schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
        inventoryArtifactId: 'art_inventory',
      },
    });
    expect(c.inputArtifactIds['project-profile.md']).toBe('art_project_profile_md');
    expect(c.inputArtifactIds['project-profile.json']).toBe('art_project_profile_json');
    expect(raw.finishAgentSuccess).toHaveBeenCalledWith(
      agent,
      ['art_project_profile_md', 'art_project_profile_json'],
      'profile produced 2 artifact(s)',
    );
  });

  test('profile rejects wrong JSON schema before posting artifacts', async () => {
    await expectProfileJsonRejected(
      validProjectProfileJson({ schemaVersion: 'ainp.project_profile.v0' }),
      `profile: project-profile.json must use schemaVersion ${PROJECT_PROFILE_SCHEMA_VERSION}`,
    );
  });

  test('profile rejects mismatched project ids before posting artifacts', async () => {
    await expectProfileJsonRejected(
      validProjectProfileJson({ projectId: 'proj_other' }),
      'profile: project-profile.json projectId must match current project',
    );
  });

  test('profile rejects mismatched workflow run ids before posting artifacts', async () => {
    await expectProfileJsonRejected(
      validProjectProfileJson({ workflowRunId: 'run_other' }),
      'profile: project-profile.json workflowRunId must match current run',
    );
  });

  test('profile rejects missing required top-level JSON fields before posting artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-missing-field-'));
    const profileJson = validProjectProfileJson();
    delete profileJson.businessFlows;
    const agent = await profileAgentFixture(profileJson);
    const { deps, raw } = profileDepsFixture(agent);
    const c = runCtxFixture({
      runArtifactsDir: dir,
      inputArtifactIds: { 'project-inventory.json': 'art_inventory' },
      inputs: { 'project-inventory.json': '{"schemaVersion":"ainp.project_inventory.v1"}' },
    });

    await expect(executeProfileBootstrap(c, deps)).rejects.toThrow(
      'profile: project-profile.json missing required top-level field(s): businessFlows',
    );

    expect(raw.api.postArtifact).not.toHaveBeenCalled();
    expect(raw.finishAgentSuccess).not.toHaveBeenCalled();
  });

  test('profile rejects mismatched inventory artifact ids before posting artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-inventory-mismatch-'));
    const agent = await profileAgentFixture(
      validProjectProfileJson({ inventoryArtifactId: 'art_other_inventory' }),
    );
    const { deps, raw } = profileDepsFixture(agent);
    const c = runCtxFixture({
      runArtifactsDir: dir,
      inputArtifactIds: { 'project-inventory.json': 'art_inventory' },
      inputs: { 'project-inventory.json': '{"schemaVersion":"ainp.project_inventory.v1"}' },
    });

    await expect(executeProfileBootstrap(c, deps)).rejects.toThrow(
      'profile: project-profile.json inventoryArtifactId must match project-inventory.json artifact id',
    );

    expect(raw.api.postArtifact).not.toHaveBeenCalled();
    expect(raw.finishAgentSuccess).not.toHaveBeenCalled();
  });

  test('profile.bootstrap fixture flow runs read-only stages through the dispatcher', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'profile-flow-workspace-'));
    await mkdir(join(workspace, 'apps/api/src'), { recursive: true });
    await writeFile(join(workspace, 'README.md'), '# Legacy App\n\n## Architecture\nAPI worker split.\n', 'utf8');
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2),
      'utf8',
    );
    await writeFile(join(workspace, '.env'), 'SECRET_TOKEN=do-not-capture\n', 'utf8');
    await writeFile(join(workspace, 'apps/api/src/index.ts'), 'export const ok = true;\n', 'utf8');

    const runArtifactsDir = await mkdtemp(join(tmpdir(), 'profile-flow-artifacts-'));
    const { deps, raw, postedArtifacts } = profileDepsFixture();
    raw.buildProjectInventory.mockImplementation(buildProjectInventory);

    const c = runCtxFixture({
      project: { ...projectFixture(), localPath: workspace },
      run: runFixture({
        type: 'profile',
        flowId: 'profile.bootstrap',
        currentStage: 'inventory',
        title: 'Generate legacy project profile',
      }),
      workspace: {
        workflowRunId: 'run_orch',
        path: workspace,
        branch: 'ai/run-profile',
        environmentKind: 'trusted_local_worktree',
      },
      opts: {
        project: 'Orchestrator Project',
        title: 'Generate legacy project profile',
      },
      runArtifactsDir,
    });

    raw.invokeSkill.mockImplementation(async (_ctx, _skill, skillCtx) => {
      await mkdir(skillCtx.artifactsDir, { recursive: true });
      const markdown = '# Project Profile\n\nFacts cite `file:README.md`.\n';
      const markdownPath = join(skillCtx.artifactsDir, 'project-profile.md');
      await writeFile(markdownPath, markdown, 'utf8');
      const jsonText = `${JSON.stringify({
        schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
        projectId: c.project.id,
        workflowRunId: c.run.id,
        generatedAt: '2026-06-30T00:00:00.000Z',
        inventoryArtifactId: c.inputArtifactIds['project-inventory.json'],
        repo: { root: workspace },
        summary: 'Legacy App profile.',
        architecture: {
          body: 'API worker split.',
          sourceRefs: ['file:README.md'],
          confidence: 0.9,
          freshness: 'current',
          scope: 'repo',
        },
        commands: [],
        modules: [],
        businessFlows: [],
        riskAreas: [],
        conventions: [],
        domainVocabulary: [],
        openQuestions: [],
        knowledgeCandidates: [],
      }, null, 2)}\n`;
      const jsonPath = join(skillCtx.artifactsDir, 'project-profile.json');
      await writeFile(jsonPath, jsonText, 'utf8');
      return {
        taskId: 'task_profile_flow',
        sessionId: 'ags_profile_flow',
        invocationId: 'ctxinv_profile_flow',
        contextPackArtifactId: 'art_context_profile_flow',
        outputs: [
          {
            name: 'project-profile.md',
            path: markdownPath,
            contentType: 'text/markdown',
            size: Buffer.byteLength(markdown, 'utf8'),
          },
          {
            name: 'project-profile.json',
            path: jsonPath,
            contentType: 'application/json',
            size: Buffer.byteLength(jsonText, 'utf8'),
          },
        ],
        contextPack: { id: 'ctxpack_profile_flow' } as InvokedAgent['contextPack'],
        contextRequest: null,
      };
    });

    const blocked = vi.fn(async () => {
      throw new Error('profile.bootstrap must not dispatch mutable feature stages');
    });
    const dispatchDeps: DispatchDeps = {
      runContextPack: blocked,
      runStage: blocked,
      executeImplementation: blocked,
      executeBuildTest: blocked,
      executeVerifier: blocked,
      executeAcceptance: blocked,
      executeCompletion: (ctx) => executeCompletion(ctx, deps),
      executeKnowledgePromotion: (ctx) => executeKnowledgePromotion(ctx, deps),
      executeInventory: (ctx) => executeInventory(ctx, deps),
      executeProfileBootstrap: (ctx) => executeProfileBootstrap(ctx, deps),
      executeAgentMarkdownStage: blocked,
    };

    for (const step of FLOW_REGISTRY['profile.bootstrap'].stages) {
      await dispatchStep(step, c, dispatchDeps);
    }

    expect(FLOW_REGISTRY['profile.bootstrap'].stages.map((step) => step.stage)).toEqual([
      'inventory',
      'profile',
      'completion',
      'knowledge',
    ]);
    expect(blocked).not.toHaveBeenCalled();
    expect(raw.selectAgentBackend).toHaveBeenCalledTimes(1);
    expect(raw.api.generateCompletionReport).toHaveBeenCalledWith('run_orch');
    expect(raw.api.generateKnowledgeCandidate).toHaveBeenCalledWith('run_orch');
    expect(raw.awaitApproval).toHaveBeenCalledWith('run_orch', 'knowledge_gate');
    expect(c.inputs['project-inventory.json']).toContain('"schemaVersion": "ainp.project_inventory.v1"');
    expect(c.inputs['project-inventory.json']).not.toContain('SECRET_TOKEN');
    expect(c.inputArtifactIds['project-inventory.json']).toBe('art_project_inventory_json');
    expect(c.inputArtifactIds['project-profile.json']).toBe('art_project_profile_json');
    expect(postedArtifacts.map((artifact) => artifact.kind)).toEqual([
      'other',
      'other',
      'project_profile',
      'project_profile',
    ]);
  });
});
