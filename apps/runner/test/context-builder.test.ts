import { describe, expect, test } from 'vitest';
import type { KnowledgeArtifact, Project, WorkflowRun } from '@ainp/shared';
import {
  buildContextPack,
  buildIncrementalContextPack,
  buildProjectMaturityProfile,
  contextSelectionAudit,
} from '../src/context/builder';

describe('ContextPack builder MVP', () => {
  test('builds a minimal pack without historical knowledge', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      stepRunId: 'step_impl',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement the context injection foundation.',
      projectProfileMarkdown: '# Project Profile\n\n- Build tool: bun',
      acceptedKnowledgeMarkdown: '',
      inputNames: ['user_request'],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.taskBrief).toContain('context injection');
    expect(pack.stage).toBe('implementation');
    expect(pack.sections.map((s) => s.id)).toEqual([
      'task_brief',
      'workflow_run',
      'project_profile',
    ]);
    expect(pack.manifest.find((m) => m.ref === 'project_profile')).toMatchObject({
      reason: expect.stringContaining('project map'),
      knowledgeClass: 'recovered',
      trustLevel: 'summary',
      freshness: 'possibly_stale',
    });
    expect(pack.retrievalHints.map((h) => h.id)).toContain('hint_no_accepted_knowledge');
  });

  test('includes accepted knowledge as confirmed selected context with audit reasons', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'review',
      stepRunId: 'step_review',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Review the implementation.',
      projectProfileMarkdown: '# Project Profile\n\n- Build tool: bun',
      acceptedKnowledgeMarkdown: 'Use only configured Claude Code or Codex backends.',
      inputNames: ['user_request', 'context_pack.md'],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const knowledge = pack.sections.find((s) => s.id === 'accepted_knowledge');
    expect(knowledge).toMatchObject({
      knowledgeClass: 'confirmed',
      trustLevel: 'accepted_knowledge',
      freshness: 'possibly_stale',
      reason: expect.stringContaining('Previously accepted project knowledge'),
    });

    const audit = contextSelectionAudit(pack);
    expect(audit).toMatchObject({
      contextPackId: pack.id,
      mode: 'calibration',
      stage: 'review',
    });
    expect(JSON.stringify(audit)).toContain('accepted_knowledge');
    expect(JSON.stringify(audit)).toContain('Previously accepted project knowledge');
  });

  test('maps accepted knowledge artifact metadata override into seed selected context', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement using seeded platform constraints.',
      projectProfileMarkdown: '# Project Profile\n\n- Build tool: bun',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_seed',
          status: 'accepted',
          kind: 'dev_guide',
          metadata: {
            title: 'Seed architecture constraints',
            text: 'Keep Claude Code and Codex prompt policy provider-neutral.',
            knowledgeClass: 'seed',
            trustLevel: 'summary',
            freshness: 'current',
            sourceRefs: ['seed:api'],
            confidence: 0.6,
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const seed = pack.sections.find((s) => s.id === 'knowledge_kart_seed');
    expect(seed).toMatchObject({
      title: 'Seed architecture constraints',
      content: 'Keep Claude Code and Codex prompt policy provider-neutral.',
      knowledgeClass: 'seed',
      trustLevel: 'summary',
      freshness: 'current',
      sourceRefs: ['seed:api'],
      confidence: 0.6,
    });
    expect(pack.manifest.find((m) => m.ref === 'knowledge_kart_seed')).toMatchObject({
      type: 'seed',
      knowledgeClass: 'seed',
      confidence: 0.6,
    });
  });

  test('emits calibration review signals for stale confirmed knowledge and conflicting run evidence', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Update backend execution based on current code facts.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_backend_confirmed',
          status: 'accepted',
          entityId: 'ADR-BACKEND',
          metadata: {
            title: 'Backend policy',
            text: [
              'Backend policy',
              '- Fact: agent backend = native',
            ].join('\n'),
            knowledgeClass: 'confirmed',
            trustLevel: 'accepted_knowledge',
            freshness: 'possibly_stale',
            sourceRefs: ['knowledge:accepted', 'entity:ADR-BACKEND'],
          },
        }),
        knowledgeArtifactFixture({
          id: 'kart_backend_seed',
          status: 'accepted',
          entityId: 'ADR-BACKEND',
          metadata: {
            title: 'Backend policy',
            text: [
              'Backend policy',
              '- Fact: agent backend = claude_code_or_codex',
            ].join('\n'),
            knowledgeClass: 'seed',
            trustLevel: 'summary',
            freshness: 'current',
            sourceRefs: ['seed:prd'],
          },
        }),
      ],
      inputArtifacts: [
        {
          name: 'diff',
          content: [
            'Current implementation evidence:',
            '- Code fact: agent backend = claude_code_or_codex',
          ].join('\n'),
          artifactId: 'art_diff',
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.mode).toBe('calibration');
    expect(pack.calibrationSignals?.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining(['stale', 'conflict']),
    );
    expect(pack.calibrationSignals?.some((signal) => (
      signal.message.includes('Current run evidence')
      && signal.evidenceRefs.includes('artifact:art_diff')
    ))).toBe(true);
    const audit = contextSelectionAudit(pack) as { calibrationSignals?: Array<{ kind: string }> };
    expect(audit.calibrationSignals?.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining(['stale', 'conflict']),
    );
  });

  test('bounds calibration review signals deterministically', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Calibrate stale accepted knowledge.',
      knowledgeArtifacts: Array.from({ length: 20 }, (_, i) => (
        knowledgeArtifactFixture({
          id: `kart_stale_${i}`,
          entityId: `ADR-STALE-${i}`,
          metadata: {
            title: `Stale policy ${i}`,
            text: `Fact: policy ${i} = old`,
            knowledgeClass: 'confirmed',
            trustLevel: 'accepted_knowledge',
            freshness: 'possibly_stale',
            sourceRefs: [`knowledge:accepted:${i}`],
          },
        })
      )),
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.calibrationSignals).toHaveLength(12);
    expect(pack.calibrationSignals?.map((signal) => signal.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `sig_stale_knowledge_artifact_kart_stale_${i}`),
    );
    expect(pack.calibrationSignals?.every((signal) => (
      signal.createdAt === '2026-05-09T00:00:00.000Z'
    ))).toBe(true);
  });

  test('selects previous run artifacts with manifest scoring reasons', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement according to the approved design for context budgeting.',
      projectProfileMarkdown: '# Project Profile\n\n- Build tool: bun',
      inputArtifacts: [
        {
          name: 'design.md',
          content: 'Design: implement context budgeting inside the shared ContextPack retriever.',
          artifactId: 'art_design',
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const design = pack.sections.find((s) => s.id === 'input_design_md');
    expect(design).toMatchObject({
      sourceType: 'run_artifact',
      sourceRefs: ['artifact:art_design', 'input:design.md'],
      mode: 'full',
      trustLevel: 'source',
    });
    expect(design?.reason).toContain('Scoring:');
    expect(design?.selectionReasons).toContain('sourceType=run_artifact:24');
    expect(pack.manifest.find((m) => m.ref === 'input_design_md')).toMatchObject({
      sourceType: 'run_artifact',
      score: expect.any(Number),
      selectionReasons: expect.arrayContaining(['sourceType=run_artifact:24']),
    });
  });

  test('records budget degradation in manifest and retrieval hints', () => {
    const longContext = Array.from({ length: 60 }, (_, i) => (
      `Context budgeting evidence line ${i}: use deterministic degradation for selected artifacts.`
    )).join('\n');
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'review',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Review context budgeting evidence.',
      inputArtifacts: [
        {
          name: 'diff',
          content: longContext,
          artifactId: 'art_diff',
        },
      ],
      budget: { maxTokens: 70, reservedForReasoning: 20, reservedForOutput: 20 },
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const diff = pack.sections.find((s) => s.id === 'input_diff');
    expect(diff).toMatchObject({
      mode: 'retrieval_hint',
      degradedFrom: 'full',
      sourceType: 'run_artifact',
    });
    expect(diff?.degradationReason).toContain('summary estimate');
    expect(pack.manifest.find((m) => m.ref === 'input_diff')).toMatchObject({
      mode: 'retrieval_hint',
      degradedFrom: 'full',
      degradationReason: expect.stringContaining('summary estimate'),
    });
    expect(pack.retrievalHints.map((h) => h.id)).toContain('hint_input_diff');
  });

  test.each([
    ['feature.fastforward', 'feature'],
    ['issue.standard', 'bugfix'],
    ['refactor.standard', 'refactor'],
  ] as const)('builds a minimal invocation pack for %s without an explicit context_pack stage', (flowId, type) => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture({ flowId, type }),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: `Run ${flowId} implementation.`,
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.run.flowId).toBe(flowId);
    expect(pack.run.runType).toBe(type);
    expect(pack.sections.map((s) => s.id)).toEqual(['task_brief', 'workflow_run']);
    expect(pack.retrievalHints.map((h) => h.id)).toEqual([
      'hint_project_profile_missing',
      'hint_no_accepted_knowledge',
    ]);
  });

  test('derives a conservative maturity profile from profile, knowledge, and run history', () => {
    const profile = buildProjectMaturityProfile({
      projectProfile: {
        projectId: 'proj_ctx',
        name: 'Context Project',
        localPath: '/repo',
        generatedAt: '2026-05-09T00:00:00.000Z',
        buildTool: 'unknown',
        language: 'unknown',
        pom: null,
        topLevelPackages: [],
        testFiles: [],
        readmePreview: null,
        treeOutline: ['package.json', 'apps/', '  apps/runner/', 'packages/'],
      },
      acceptedKnowledgeMarkdown: '',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_seed_profile',
          metadata: { knowledgeClass: 'seed', text: 'Initial architecture direction.' },
        }),
      ],
      runHistory: [runFixture({ id: 'run_1' }), runFixture({ id: 'run_2' })],
    });

    expect(profile).toMatchObject({
      stage: 'growing',
      codebaseAge: 'early',
      knowledgeCoverage: 'seeded',
      evidenceDensity: 'medium',
      volatility: 'medium',
      primaryNeed: 'bootstrap',
    });
  });

  test('builds an incremental supplement pack for a structured context request', () => {
    const base = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement context request loop.',
      projectProfileMarkdown: '# Project Profile\n\n- Build tool: bun',
      createdAt: '2026-05-09T00:00:00.000Z',
    });
    const supplement = buildIncrementalContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement context request loop.',
      projectProfileMarkdown: '# Project Profile\n\n- Build tool: bun',
      contextRequest: {
        id: 'ctxreq_test',
        workflowRunId: 'run_ctx',
        stepRunId: 'step_impl',
        stage: 'implementation',
        reason: 'Need the API route contract before editing runner replay.',
        requestedRefs: ['code:apps/api/src/routes/runner-events.ts'],
        questions: ['Which route records runner-side workflow actions?'],
        priority: 1,
        status: 'open',
        createdAt: '2026-05-09T00:00:00.000Z',
      },
      baseContextPack: base,
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(supplement.supplement).toEqual({
      contextRequestId: 'ctxreq_test',
      baseContextPackId: base.id,
      createdAt: '2026-05-09T00:00:00.000Z',
    });
    expect(supplement.sections.map((section) => section.id)).toContain('input_context_request_ctxreq_test_json');
    expect(supplement.retrievalHints.map((hint) => hint.query)).toContain(
      'Retrieve code:apps/api/src/routes/runner-events.ts for context request ctxreq_test.',
    );
    expect(contextSelectionAudit(supplement)).toMatchObject({
      supplement: {
        contextRequestId: 'ctxreq_test',
        baseContextPackId: base.id,
      },
    });
  });

  test('filters sensitive path artifacts and cross-project knowledge from selected context', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement without leaking sensitive repository files.',
      projectProfileMarkdown: [
        '# Project Profile',
        '## Tree outline',
        '```',
        'src/',
        '.env.local',
        '  secrets/prod.key',
        '```',
      ].join('\n'),
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_foreign',
          projectId: 'proj_other',
          metadata: {
            title: 'Foreign knowledge',
            text: 'Do not retrieve this cross-project fact.',
            knowledgeClass: 'confirmed',
          },
        }),
        knowledgeArtifactFixture({
          id: 'kart_local',
          metadata: {
            title: 'Local knowledge',
            text: 'Use local project context only.\nSecret material is documented in .env.local.',
            knowledgeClass: 'confirmed',
          },
        }),
      ],
      inputArtifacts: [
        {
          name: '.env.local',
          content: 'SECRET_TOKEN=should-not-be-injected',
          artifactId: 'art_env',
        },
        {
          name: 'design.md',
          content: 'Design evidence for safe context.',
          artifactId: 'art_design',
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const serialized = JSON.stringify(pack);
    expect(serialized).not.toContain('SECRET_TOKEN');
    expect(serialized).not.toContain('.env.local');
    expect(serialized).not.toContain('prod.key');
    expect(serialized).not.toContain('Secret material');
    expect(serialized).not.toContain('kart_foreign');
    expect(pack.sections.map((section) => section.id)).toContain('knowledge_kart_local');
    expect(pack.sections.map((section) => section.id)).toContain('input_design_md');
  });

  test('redacts sensitive context_request refs from supplement packs', () => {
    const supplement = buildIncrementalContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Provide only safe context_request supplements.',
      projectProfileMarkdown: '# Project Profile\n\n- Build tool: bun',
      contextRequest: {
        id: 'ctxreq_sensitive',
        workflowRunId: 'run_ctx',
        stepRunId: 'step_impl',
        stage: 'implementation',
        reason: 'Need route evidence; do not leak .env.local.',
        requestedRefs: ['code:.env.local', 'code:src/main.ts'],
        questions: ['Read .ssh/id_rsa?', 'Which route owns context requests?'],
        priority: 1,
        status: 'open',
        createdAt: '2026-05-09T00:00:00.000Z',
      },
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const serialized = JSON.stringify(supplement);
    expect(serialized).not.toContain('.env.local');
    expect(serialized).not.toContain('id_rsa');
    expect(supplement.retrievalHints.map((hint) => hint.query)).toContain(
      'Retrieve code:src/main.ts for context request ctxreq_sensitive.',
    );
    expect(supplement.retrievalHints.map((hint) => hint.query)).toContain(
      'Which route owns context requests?',
    );
  });
});

function projectFixture(): Project {
  return {
    id: 'proj_ctx',
    name: 'Context Project',
    localPath: '/repo',
    language: 'unknown',
    buildTool: 'unknown',
    defaultBranch: 'main',
    registeredAt: '2026-05-09T00:00:00.000Z',
    agentBackend: 'codex',
  };
}

function runFixture(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run_ctx',
    projectId: 'proj_ctx',
    type: 'feature',
    status: 'running',
    currentStage: 'implementation',
    flowId: 'feature.standard',
    startStage: null,
    configSnapshotId: null,
    sourceBranch: 'main',
    branch: 'ai/run-1',
    workspacePath: '/tmp/workspace',
    title: 'Context injection MVP',
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
    ...overrides,
  };
}

function knowledgeArtifactFixture(
  overrides: Partial<KnowledgeArtifact> = {},
): KnowledgeArtifact {
  return {
    id: 'kart_ctx',
    kind: 'decision',
    uri: 'mem://knowledge.md',
    projectId: 'proj_ctx',
    size: 100,
    contentType: 'text/markdown',
    status: 'accepted',
    version: 1,
    entityId: 'ADR-001',
    derivedFromArtifactId: null,
    subtype: null,
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}
