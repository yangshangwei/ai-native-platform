import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import {
  STAGE_HANDOFF_SCHEMA_VERSION,
  type Project,
  type StageHandoffMetadata,
} from '@ainp/shared';

process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-context-governance-test-')),
  'ainp.sqlite',
);
process.env.AINP_HOME = join(
  mkdtempSync(join(tmpdir(), 'ainp-context-governance-home-')),
  '.ai-native',
);

let app: Awaited<typeof import('../src/app')>['app'];
let engine: typeof import('../src/workflow-engine');
let storeModule: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  engine = await import('../src/workflow-engine');
  storeModule = await import('../src/store/store');
});

test('GET /workflow-runs/:id/context exposes manifest, refs, budget, context requests, and deterministic metrics', async () => {
  const project = projectFixture();
  storeModule.store.projects.set(project.id, project);
  const run = engine.createWorkflowRun({
    projectId: project.id,
    type: 'feature',
    title: 'Expose context governance',
    sourceBranch: 'main',
    flowId: 'feature.standard',
  });

  const taskWithContext = engine.recordAgentTask({
    workflowRunId: run.id,
    stepRunId: null,
    kind: 'implementation',
    backend: 'codex',
    prompt: [
      'ContextPack: ctxpack_agent',
      'ContextMode: task_execution',
      'ContextManifest:',
      '- task_brief: Primary request (priority=1; mode=full; sourceType=task_brief; knowledgeClass=confirmed; trustLevel=source; freshness=current; confidence=1; score=190; sourceRefs=workflow_run:run, input:user_request)',
    ].join('\n'),
    inputArtifactIds: [],
  });
  const taskWithoutContext = engine.recordAgentTask({
    workflowRunId: run.id,
    stepRunId: null,
    kind: 'review',
    backend: 'codex',
    prompt: 'legacy prompt without a context pack',
    inputArtifactIds: [],
  });
  engine.recordAgentResult({
    taskId: taskWithContext.id,
    status: 'success',
    summary: 'ok',
    outputArtifactIds: [],
  });
  engine.recordAgentResult({
    taskId: taskWithoutContext.id,
    status: 'failed',
    summary: 'review failed',
    outputArtifactIds: [],
  });

  const contextArtifact = engine.createArtifact({
    workflowRunId: run.id,
    stepRunId: null,
    kind: 'context_pack',
    uri: 'mem://context-pack.md',
    size: 100,
    contentType: 'text/markdown',
    metadata: {
      contextPackRole: 'base',
      invocationId: 'ctxinv_artifact',
      retryIndex: 0,
      contextSelection: {
        contextPackId: 'ctxpack_artifact',
        mode: 'task_execution',
        stage: 'implementation',
        selected: [
          {
            ref: 'knowledge_backend',
            reason: 'Accepted project knowledge applies. Scoring: keywordOverlap=2; total=120.',
            priority: 1,
            mode: 'full',
            knowledgeClass: 'confirmed',
            trustLevel: 'accepted_knowledge',
            freshness: 'possibly_stale',
            sourceType: 'knowledge_artifact',
            sourceRefs: ['knowledge_artifact:kart_backend', 'knowledge:accepted'],
            score: 120,
            selectionReasons: ['keywordOverlap=2'],
          },
          {
            ref: 'input_misc',
            reason: 'Low signal artifact. Scoring: keywordOverlap=0; total=24.',
            priority: 3,
            mode: 'summary',
            knowledgeClass: 'recovered',
            trustLevel: 'summary',
            freshness: 'current',
            sourceType: 'run_artifact',
            sourceRefs: ['artifact:art_misc'],
            score: 24,
            selectionReasons: ['keywordOverlap=0'],
            degradedFrom: 'full',
            degradationReason: 'full estimate exceeded remaining context budget',
          },
        ],
        retrievalHints: [],
      },
    },
  });

  engine.recordContextRequestAction({
    workflowRunId: run.id,
    taskId: taskWithContext.id,
    baseContextPackId: 'ctxpack_artifact',
    baseContextPackArtifactId: contextArtifact.id,
    supplementContextPackId: 'ctxpack_supplement',
    requestArtifactId: contextArtifact.id,
    supplementArtifactId: contextArtifact.id,
    sourceName: 'last_message',
    request: {
      id: 'ctxreq_api',
      workflowRunId: run.id,
      stepRunId: null,
      stage: 'implementation',
      reason: 'Need manifest endpoint shape.',
      requestedRefs: ['code:apps/api/src/routes/workflow-runs.ts'],
      questions: ['Which route should expose context?'],
      priority: 2,
      status: 'open',
      createdAt: '2026-05-09T00:00:00.000Z',
    },
  });
  engine.recordApproval({
    workflowRunId: run.id,
    gateId: 'acceptance_gate',
    approved: false,
    actor: 'test',
    comment: 'needs rework',
  });
  const requirementArtifact = engine.createArtifact({
    workflowRunId: run.id,
    stepRunId: null,
    kind: 'requirement_draft',
    uri: 'mem://requirement.md',
    size: 20,
    contentType: 'text/markdown',
    metadata: { output: 'requirement.md' },
  });
  const handoffArtifact = engine.createArtifact({
    workflowRunId: run.id,
    stepRunId: null,
    kind: 'other',
    uri: 'mem://stage_handoff.requirement.design.md',
    size: 20,
    contentType: 'text/markdown',
    metadata: { schemaVersion: STAGE_HANDOFF_SCHEMA_VERSION, reportKind: 'stage_handoff' },
  });
  const stageHandoff: StageHandoffMetadata = {
    schemaVersion: STAGE_HANDOFF_SCHEMA_VERSION,
    workflowRunId: run.id,
    fromStage: 'requirement',
    toStage: 'design',
    summary: 'Use confirmed requirement constraints before design.',
    decisions: ['Reuse HandoffRecord metadata.'],
    risks: ['Do not let handoff drive gate status.'],
    openQuestions: [],
    producedArtifacts: [{
      key: 'requirement.md',
      artifactId: requirementArtifact.id,
      kind: 'requirement_draft',
      injectionPreference: 'summary',
    }],
    createdAt: '2026-06-27T00:00:00.000Z',
  };
  const handoffRecord = engine.recordHandoff({
    workflowRunId: run.id,
    stepRunId: null,
    fromRole: 'main',
    toRole: 'planner',
    reason: 'Stage semantic handoff from requirement to design.',
    inputArtifactIds: [requirementArtifact.id],
    expectedOutput: {
      schemaVersion: STAGE_HANDOFF_SCHEMA_VERSION,
      artifactKind: 'other',
      description: 'Stage handoff summary for design.',
    },
    stopCondition: 'Evidence/navigation only; do not drive workflow status.',
    status: 'completed',
    adoptionDecision: 'adopted',
    outputArtifactIds: [handoffArtifact.id],
    metadata: { stageHandoff },
  });

  const res = await app.request(`/workflow-runs/${encodeURIComponent(run.id)}/context`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    schemaVersion: string;
    contextPacks: Array<{ contextPackId: string; role: string | null; invocationId: string | null }>;
    manifest: Array<{ ref: string; priority: number | null; trustLevel: string | null; sourceRefs: string[] }>;
    sourceRefs: Array<{ sourceRef: string; trustLevels: string[] }>;
    budgetDecisions: Array<{ ref: string; degradedFrom: string | null }>;
    contextRequests: Array<{
      id: string;
      baseContextPackArtifactId: string | null;
      supplementContextPackId: string | null;
    }>;
    stageHandoffs: Array<{
      id: string;
      artifactId: string | null;
      fromStage: string;
      toStage: string;
      summary: string;
      producedArtifacts: Array<{ key: string; artifactId: string; injectionPreference: string }>;
    }>;
    metrics: {
      impactCoverage: { numerator: number; denominator: number; value: number };
      evidenceTraceability: { numerator: number; denominator: number };
      contextRequestCount: { value: number };
      downstreamReworkSignal: { value: number; rejectedApprovals: number; failedGates: number; failedAgentResults: number };
    };
  };

  expect(body.schemaVersion).toBe('ainp.context_governance.v1');
  expect(body.contextPacks.map((pack) => pack.contextPackId)).toEqual(
    expect.arrayContaining(['ctxpack_artifact', 'ctxpack_agent']),
  );
  expect(body.contextPacks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        contextPackId: 'ctxpack_artifact',
        role: 'base',
        invocationId: 'ctxinv_artifact',
      }),
    ]),
  );
  expect(body.manifest).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ref: 'task_brief',
        priority: 1,
        trustLevel: 'source',
      }),
      expect.objectContaining({
        ref: 'knowledge_backend',
        trustLevel: 'accepted_knowledge',
        sourceRefs: expect.arrayContaining(['knowledge_artifact:kart_backend']),
      }),
    ]),
  );
  expect(body.sourceRefs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceRef: 'knowledge_artifact:kart_backend',
        trustLevels: ['accepted_knowledge'],
      }),
    ]),
  );
  expect(body.budgetDecisions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ref: 'input_misc', degradedFrom: 'full' }),
    ]),
  );
  expect(body.contextRequests).toEqual([
    expect.objectContaining({
      id: 'ctxreq_api',
      baseContextPackArtifactId: contextArtifact.id,
      supplementContextPackId: 'ctxpack_supplement',
    }),
  ]);
  expect(body.stageHandoffs).toEqual([
    expect.objectContaining({
      id: handoffRecord.id,
      artifactId: handoffArtifact.id,
      fromStage: 'requirement',
      toStage: 'design',
      summary: 'Use confirmed requirement constraints before design.',
      producedArtifacts: [expect.objectContaining({
        key: 'requirement.md',
        artifactId: requirementArtifact.id,
        injectionPreference: 'summary',
      })],
    }),
  ]);
  expect(body.metrics.impactCoverage).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
  expect(body.metrics.evidenceTraceability.numerator).toBe(body.metrics.evidenceTraceability.denominator);
  expect(body.metrics.contextRequestCount.value).toBe(1);
  expect(body.metrics.downstreamReworkSignal).toMatchObject({
    value: 3,
    rejectedApprovals: 1,
    failedGates: 1,
    failedAgentResults: 1,
  });
});

function projectFixture(): Project {
  return {
    id: 'proj_ctx_gov',
    name: 'Context Governance Project',
    localPath: '/tmp/context-governance-project',
    language: 'unknown',
    buildTool: 'unknown',
    defaultBranch: 'main',
    registeredAt: '2026-05-09T00:00:00.000Z',
    agentBackend: 'codex',
  };
}
