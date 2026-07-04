import { describe, expect, test, vi } from 'vitest';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Artifact } from '@ainp/shared';
import type { SourceChunkIndexCatalogEntry } from '../src/api-client';
import { finishAgentSuccess, invokeSkill, type InvokeSkillDeps } from '../src/orchestrator/invoke-skill';
import {
  SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL,
  sourceChunkIndexLocalEmbeddingVectorForText,
} from '../src/source-chunk-embedding';
import { backendFixture, runCtxFixture, runFixture, skillFixture } from './helpers/orchestrator-fixtures';

// ---------------------------------------------------------------------------
// T3.1 de-closure: `invokeSkill` used to be an inner closure of
// `cmdOrchestrate` capturing ctx/project/run/backend/inputArtifactIds. These
// injected tests pin the two outcome paths: a normal agent run (no
// context_request) and a structured context_request that gets captured,
// persisted and recorded.
// ---------------------------------------------------------------------------

function depsFixture() {
  let artifactSeq = 0;
  let taskSeq = 0;
  let resultSeq = 0;
  let sessionSeq = 0;
  const deps = {
    agentTaskStarted: vi.fn(async () => {
      taskSeq += 1;
      return { task: { id: taskSeq === 1 ? 'task_invoke' : `task_invoke_${taskSeq}` } };
    }),
    agentTaskFinished: vi.fn(async () => {
      resultSeq += 1;
      return { result: { id: resultSeq === 1 ? 'agr_invoke' : `agr_invoke_${resultSeq}` } };
    }),
    agentSessionStarted: vi.fn(async () => {
      sessionSeq += 1;
      return { session: { id: sessionSeq === 1 ? 'ags_invoke' : `ags_invoke_${sessionSeq}` } };
    }),
    agentSessionFinished: vi.fn(async () => ({})),
    postArtifact: vi.fn(async (params: { kind: string }) => {
      artifactSeq += 1;
      return { id: `art_${artifactSeq}_${params.kind}` } as unknown as Artifact;
    }),
    getWorkflowRun: vi.fn(async () => workflowRunDetailFixture()),
    getArtifactContent: vi.fn(async () => {
      throw new Error('unexpected artifact content lookup');
    }),
    listSourceChunkIndexEntries: vi.fn(async () => []),
    recordContextRequest: vi.fn(async () => ({})),
    recordKnowledgeUsage: vi.fn(async () => ({})),
    recordKnowledgeAction: vi.fn(async () => ({})),
  };
  return { deps: deps as unknown as InvokeSkillDeps, raw: deps };
}

function workflowRunDetailFixture(run = runFixture(), artifacts: Artifact[] = []) {
  return {
    run,
    steps: [],
    commands: [],
    artifacts,
    stepCheckpoints: [],
    graph: {
      graphDefinition: null,
      graphRun: null,
      nodeRuns: [],
      events: [],
    },
    actions: [],
  };
}

function artifactFixture(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art_inventory',
    workflowRunId: 'run_prior',
    stepRunId: 'step_inventory',
    kind: 'other',
    uri: 'file:///tmp/project-inventory.json',
    size: 100,
    contentType: 'application/json',
    createdAt: '2026-06-30T00:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function legacyOrdersInventoryFixture(): Record<string, unknown> {
  const deleteOrderContentSha256 = '6'.repeat(64);
  return {
    schemaVersion: 'ainp.project_inventory.v1',
    entrypoints: [
      {
        id: 'entry_orders_delete',
        kind: 'http_route',
        label: 'DELETE /api/orders/:id',
        path: 'apps/api/src/orders-route.ts',
        method: 'DELETE',
        route: '/api/orders/:id',
        handler: 'deleteOrder',
        sourceRefs: ['file:apps/api/src/orders-route.ts#L12'],
        confidence: 0.9,
      },
    ],
    symbols: [
      {
        id: 'sym_delete_order',
        kind: 'function',
        name: 'deleteOrder',
        path: 'apps/api/src/orders-route.ts',
        exported: true,
        line: 10,
        signature: 'export function deleteOrder()',
        sourceRefs: ['file:apps/api/src/orders-route.ts#L10'],
      },
      {
        id: 'sym_order_service',
        kind: 'class',
        name: 'OrderService',
        path: 'apps/api/src/order-service.ts',
        exported: true,
        line: 1,
        signature: 'export class OrderService',
        sourceRefs: ['file:apps/api/src/order-service.ts#L1'],
      },
    ],
    testSurfaces: [
      {
        id: 'test_orders',
        path: 'apps/api/test/orders-route.test.ts',
        frameworkHint: 'vitest',
        targetHints: ['orders-route', 'orders'],
        sourceRefs: ['file:apps/api/test/orders-route.test.ts'],
      },
    ],
    hotspots: [],
    sourceChunks: [
      {
        id: 'chunk_orders_delete_handler',
        path: 'apps/api/src/orders-route.ts',
        startLine: 10,
        endLine: 13,
        snippet: [
          'L10: export function deleteOrder() {',
          'L11:   const service = new OrderService();',
          'L12:   return service.deleteOrder();',
          'L13: }',
        ].join('\n'),
        contentSha256: deleteOrderContentSha256,
        sourceRefs: ['file:apps/api/src/orders-route.ts#L10'],
        confidence: 0.72,
      },
    ],
    capabilities: [
      {
        id: 'cap_api_orders',
        label: 'Orders API',
        kind: 'api',
        entrypointRefs: ['entry_orders_delete'],
        moduleRefs: [],
        symbolRefs: ['sym_delete_order', 'sym_order_service'],
        testRefs: ['test_orders'],
        hotspotRefs: [],
        sourceRefs: ['file:apps/api/src/orders-route.ts#L12'],
        confidence: 0.95,
        openQuestions: [],
      },
    ],
  };
}

function legacyOrdersSourceChunkIndexFixture(): Record<string, unknown> {
  return {
    schemaVersion: 'ainp.source_chunk_index.v1',
    generatedAt: '2026-06-30T00:06:00.000Z',
    source: 'project_inventory.sourceChunks',
    chunkCount: 1,
    maxEntries: 120,
    entries: [
      {
        id: 'src_chunk_idx_orders_delete_handler',
        sourceChunkRef: 'chunk_orders_delete_handler',
        contentSha256: '7'.repeat(64),
        path: 'apps/api/src/orders-route.ts',
        language: 'typescript/javascript',
        startLine: 10,
        endLine: 13,
        lexicalTokens: ['fulfillment', 'cancel', 'order'],
        searchText: 'fulfillment cancel order',
        linkedRecordRefs: ['sym_delete_order'],
        sourceRefs: ['file:apps/api/src/orders-route.ts#L10'],
        entrypointRefs: ['entry_orders_delete'],
        symbolRefs: ['sym_delete_order'],
        graphEdgeRefs: [],
        testRefs: ['test_orders'],
        hotspotRefs: [],
        capabilityRefs: ['cap_api_orders'],
      },
    ],
  };
}

function legacyOrdersSourceChunkCatalogRow(
  overrides: Partial<SourceChunkIndexCatalogEntry> = {},
): SourceChunkIndexCatalogEntry {
  const indexEntry = (legacyOrdersSourceChunkIndexFixture().entries as Array<Record<string, unknown>>)[0]!;
  return {
    id: 'art_source_chunk_index_catalog:src_chunk_idx_orders_delete_handler',
    projectId: 'proj_orch',
    workflowRunId: 'run_catalog',
    sourceChunkIndexArtifactId: 'art_source_chunk_index_catalog',
    sourceInventoryArtifactId: 'art_inventory_catalog',
    sourceChunkRef: String(indexEntry.sourceChunkRef),
    contentSha256: String(indexEntry.contentSha256),
    path: String(indexEntry.path),
    language: String(indexEntry.language),
    startLine: Number(indexEntry.startLine),
    endLine: Number(indexEntry.endLine),
    lexicalTokens: indexEntry.lexicalTokens as string[],
    searchText: String(indexEntry.searchText),
    linkedRecordRefs: indexEntry.linkedRecordRefs as string[],
    sourceRefs: indexEntry.sourceRefs as string[],
    entrypointRefs: indexEntry.entrypointRefs as string[],
    symbolRefs: indexEntry.symbolRefs as string[],
    domainEntityRefs: [],
    graphEdgeRefs: indexEntry.graphEdgeRefs as string[],
    testRefs: indexEntry.testRefs as string[],
    hotspotRefs: indexEntry.hotspotRefs as string[],
    capabilityRefs: indexEntry.capabilityRefs as string[],
    createdAt: '2026-07-01T00:05:00.000Z',
    ...overrides,
  };
}

function queryEmbeddingFor(q: string): number[] {
  return sourceChunkIndexLocalEmbeddingVectorForText(q);
}

function queryEmbeddingModelFor(): string {
  return SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL;
}

describe('invokeSkill (de-closured)', () => {
  test('normal run: starts an agent task, returns outputs with no context request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-'));
    const outPath = join(dir, 'requirement.md');
    await writeFile(outPath, '# REQ-001 requirement draft\n', 'utf8');
    const { deps, raw } = depsFixture();
    const backendRun = vi.fn(async () => ({
      outputs: [
        { name: 'requirement.md', path: outPath, contentType: 'text/markdown', size: 28 },
      ],
      lastMessage: 'requirement drafted',
    }));
    const c = runCtxFixture({ backend: backendFixture(backendRun) });
    const skill = skillFixture('requirement');

    const agent = await invokeSkill(c, skill, {
      workflowRunId: c.run.id,
      stepRunId: 'step_req',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(agent.taskId).toBe('task_invoke');
    expect(agent.sessionId).toBe('ags_invoke');
    expect(agent.outputs).toHaveLength(1);
    expect(agent.contextRequest).toBeNull();
    expect(agent.contextPack.stage).toBe('requirement');
    expect(agent.contextPack.taskBrief).toBe('Orchestrator de-closure test run');
    expect(agent.contextPackArtifactId).toBe('art_1_context_pack');
    expect(agent.invocationId).toMatch(/^ctxinv_/);
    expect(raw.agentTaskStarted).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run_orch',
      stepRunId: 'step_req',
      kind: 'requirement_draft',
      backend: 'native',
      prompt: expect.stringContaining('Skill: skill.requirement@1.0.0'),
    }));
    expect(raw.agentSessionStarted).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run_orch',
      agentTaskId: 'task_invoke',
      stage: 'requirement',
      skillId: 'skill.requirement',
      skillVersion: '1.0.0',
      contextPackId: agent.contextPack.id,
      metadata: expect.objectContaining({
        invocationId: agent.invocationId,
        contextPackArtifactId: 'art_1_context_pack',
        contextPackRole: 'base',
      }),
    }));
    expect(raw.postArtifact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'context_pack',
      contentType: 'application/json',
      metadata: expect.objectContaining({
        schemaVersion: 'ainp.context_pack_artifact.v1',
        contextPackId: agent.contextPack.id,
        contextPackRole: 'base',
        invocationId: agent.invocationId,
        retryIndex: 0,
      }),
    }));
    await expect(readdir(join(dir, 'context-packs'))).resolves.toHaveLength(1);
    // The backend received the platform-built context pack.
    expect(backendRun).toHaveBeenCalledWith(skill, expect.objectContaining({
      contextPack: expect.objectContaining({ stage: 'requirement' }),
    }));
    // Success finishing is the caller's job (finishAgentSuccess) — not here.
    expect(raw.agentTaskFinished).not.toHaveBeenCalled();
    expect(raw.recordContextRequest).not.toHaveBeenCalled();
  });

  test('discovers latest prior project inventory artifact for ContextPack code probes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-inventory-history-'));
    const { deps, raw } = depsFixture();
    const currentRun = runFixture({
      id: 'run_current',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const olderRun = runFixture({
      id: 'run_prior_old',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    });
    const latestRun = runFixture({
      id: 'run_prior_latest',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
    });
    const latestInventoryArtifact = artifactFixture({
      id: 'art_inventory_latest',
      workflowRunId: latestRun.id,
      createdAt: '2026-06-30T00:05:00.000Z',
      metadata: {
        role: 'project_inventory',
        output: 'project-inventory.json',
        schemaVersion: 'ainp.project_inventory.v1',
      },
    });
    const latestSourceChunkIndexArtifact = artifactFixture({
      id: 'art_source_chunk_index_latest',
      workflowRunId: latestRun.id,
      uri: 'file:///tmp/source-chunk-index.json',
      createdAt: '2026-06-30T00:06:00.000Z',
      metadata: {
        role: 'source_chunk_index',
        output: 'source-chunk-index.json',
        schemaVersion: 'ainp.source_chunk_index.v1',
        sourceInventoryArtifactId: latestInventoryArtifact.id,
      },
    });
    const unrelatedNewerSourceChunkIndexArtifact = artifactFixture({
      id: 'art_source_chunk_index_unrelated_newer',
      workflowRunId: latestRun.id,
      uri: 'file:///tmp/source-chunk-index.unrelated.json',
      createdAt: '2026-06-30T00:07:00.000Z',
      metadata: {
        role: 'source_chunk_index',
        output: 'source-chunk-index.json',
        schemaVersion: 'ainp.source_chunk_index.v1',
        sourceInventoryArtifactId: 'art_inventory_other',
      },
    });
    raw.getWorkflowRun.mockImplementation(async (id: string) => {
      if (id === latestRun.id) {
        return workflowRunDetailFixture(latestRun, [
          latestInventoryArtifact,
          latestSourceChunkIndexArtifact,
          unrelatedNewerSourceChunkIndexArtifact,
        ]);
      }
      return workflowRunDetailFixture(olderRun, []);
    });
    raw.getArtifactContent.mockImplementation(async (id: string) => {
      if (id === latestInventoryArtifact.id) {
        return {
          artifact: latestInventoryArtifact,
          text: JSON.stringify(legacyOrdersInventoryFixture()),
          contentType: 'application/json',
          filename: 'project-inventory.json',
        };
      }
      if (id === latestSourceChunkIndexArtifact.id) {
        return {
          artifact: latestSourceChunkIndexArtifact,
          text: JSON.stringify(legacyOrdersSourceChunkIndexFixture()),
          contentType: 'application/json',
          filename: 'source-chunk-index.json',
        };
      }
      throw new Error(`unexpected artifact content lookup ${id}`);
    });
    const backendRun = vi.fn(async () => ({ outputs: [], lastMessage: 'done' }));
    const c = runCtxFixture({
      run: currentRun,
      backend: backendFixture(backendRun),
    });
    c.inputs.user_request = 'Implement fulfillment cancel behavior for deleting orders in the Orders API and update order tests.';
    c.contextFoundation.runHistory = [currentRun, olderRun, latestRun];

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.getWorkflowRun).toHaveBeenCalledWith('run_prior_latest');
    expect(raw.getWorkflowRun).not.toHaveBeenCalledWith('run_prior_old');
    expect(raw.getArtifactContent).toHaveBeenCalledWith('art_inventory_latest');
    expect(raw.getArtifactContent).toHaveBeenCalledWith('art_source_chunk_index_latest');
    expect(raw.getArtifactContent).not.toHaveBeenCalledWith('art_source_chunk_index_unrelated_newer');
    const capability = agent.contextPack.sections.find((section) => (
      section.id === 'inventory_capability_cap_api_orders'
    ));
    expect(capability).toMatchObject({
      title: 'Capability Map: Orders API',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_latest',
        'file:apps/api/src/orders-route.ts#L12',
        'file:apps/api/test/orders-route.test.ts',
      ]),
    });
    expect(capability?.content).toContain('DELETE /api/orders/:id');
    expect(agent.contextPack.sections.find((section) => section.id === 'inventory_symbols_orders_api')?.content)
      .toContain('OrderService');
    const sourceChunk = agent.contextPack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_orders_delete_handler'
    ));
    expect(sourceChunk).toMatchObject({
      title: 'Source Chunk: apps/api/src/orders-route.ts:10-13',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_latest',
        'artifact:art_source_chunk_index_latest',
        'file:apps/api/src/orders-route.ts#L10',
      ]),
    });
    expect(sourceChunk?.reason).toContain('source chunk index lexical metadata matched the task brief');
    expect(sourceChunk?.content).toContain('deleteOrder');
    expect(sourceChunk?.content).toContain('Content SHA-256: 6666666666666666666666666666666666666666666666666666666666666666');
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_project_inventory_json');
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(c.inputs['project-inventory.json']).toBeUndefined();
    expect(c.contextFoundation.historicalInventoryArtifactChecked).toBe(true);
    expect(c.contextFoundation.historicalInventoryArtifact?.artifactId).toBe('art_inventory_latest');
    expect(c.contextFoundation.historicalInventoryArtifact?.sourceChunkIndexArtifact?.artifactId)
      .toBe('art_source_chunk_index_latest');
    expect(backendRun).toHaveBeenCalledWith(skillFixture('implementation'), expect.objectContaining({
      contextPack: expect.objectContaining({
        manifest: expect.arrayContaining([
          expect.objectContaining({
            ref: 'inventory_capability_cap_api_orders',
            type: 'code_probe',
            sourceRefs: expect.arrayContaining(['artifact:art_inventory_latest']),
          }),
        ]),
      }),
    }));

    await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl_2',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.getWorkflowRun).toHaveBeenCalledTimes(1);
    expect(raw.getArtifactContent).toHaveBeenCalledTimes(2);
    expect(raw.listSourceChunkIndexEntries).not.toHaveBeenCalled();
  });

  test('falls back to source chunk index catalog rows when historical index artifact content is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-index-catalog-'));
    const { deps, raw } = depsFixture();
    const currentRun = runFixture({
      id: 'run_current_catalog',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const latestRun = runFixture({
      id: 'run_prior_catalog',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
    });
    const latestInventoryArtifact = artifactFixture({
      id: 'art_inventory_catalog',
      workflowRunId: latestRun.id,
      createdAt: '2026-06-30T00:05:00.000Z',
      metadata: {
        role: 'project_inventory',
        output: 'project-inventory.json',
        schemaVersion: 'ainp.project_inventory.v1',
      },
    });
    const latestSourceChunkIndexArtifact = artifactFixture({
      id: 'art_source_chunk_index_catalog',
      workflowRunId: latestRun.id,
      uri: 'file:///tmp/source-chunk-index.json',
      createdAt: '2026-06-30T00:06:00.000Z',
      metadata: {
        role: 'source_chunk_index',
        output: 'source-chunk-index.json',
        schemaVersion: 'ainp.source_chunk_index.v1',
        sourceInventoryArtifactId: latestInventoryArtifact.id,
      },
    });
    raw.getWorkflowRun.mockResolvedValue(workflowRunDetailFixture(latestRun, [
      latestInventoryArtifact,
      latestSourceChunkIndexArtifact,
    ]));
    raw.getArtifactContent.mockImplementation(async (id: string) => {
      if (id === latestInventoryArtifact.id) {
        return {
          artifact: latestInventoryArtifact,
          text: JSON.stringify(legacyOrdersInventoryFixture()),
          contentType: 'application/json',
          filename: 'project-inventory.json',
        };
      }
      throw new Error(`artifact content unavailable ${id}`);
    });
    const indexEntry = (legacyOrdersSourceChunkIndexFixture().entries as Array<Record<string, unknown>>)[0]!;
    raw.listSourceChunkIndexEntries.mockResolvedValue([{
      id: 'art_source_chunk_index_catalog:src_chunk_idx_orders_delete_handler',
      projectId: 'proj_orch',
      workflowRunId: latestRun.id,
      sourceChunkIndexArtifactId: latestSourceChunkIndexArtifact.id,
      sourceInventoryArtifactId: latestInventoryArtifact.id,
      sourceChunkRef: String(indexEntry.sourceChunkRef),
      contentSha256: String(indexEntry.contentSha256),
      path: String(indexEntry.path),
      language: String(indexEntry.language),
      startLine: Number(indexEntry.startLine),
      endLine: Number(indexEntry.endLine),
      lexicalTokens: indexEntry.lexicalTokens as string[],
      searchText: String(indexEntry.searchText),
      linkedRecordRefs: indexEntry.linkedRecordRefs as string[],
      sourceRefs: indexEntry.sourceRefs as string[],
      entrypointRefs: indexEntry.entrypointRefs as string[],
      symbolRefs: indexEntry.symbolRefs as string[],
      domainEntityRefs: [],
      graphEdgeRefs: indexEntry.graphEdgeRefs as string[],
      testRefs: indexEntry.testRefs as string[],
      hotspotRefs: indexEntry.hotspotRefs as string[],
      capabilityRefs: indexEntry.capabilityRefs as string[],
      createdAt: latestSourceChunkIndexArtifact.createdAt,
    }]);
    const backendRun = vi.fn(async () => ({ outputs: [], lastMessage: 'done' }));
    const c = runCtxFixture({
      run: currentRun,
      backend: backendFixture(backendRun),
    });
    c.inputs.user_request = 'Implement fulfillment cancel behavior for deleting orders in the Orders API.';
    c.contextFoundation.runHistory = [currentRun, latestRun];

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: 'Implement fulfillment cancel behavior for deleting orders in the Orders API.',
      queryEmbedding: queryEmbeddingFor('Implement fulfillment cancel behavior for deleting orders in the Orders API.'),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: 'art_source_chunk_index_catalog',
      sourceInventoryArtifactId: 'art_inventory_catalog',
      limit: 500,
    });
    const sourceChunk = agent.contextPack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_orders_delete_handler'
    ));
    expect(sourceChunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_catalog',
        'artifact:art_source_chunk_index_catalog',
        'file:apps/api/src/orders-route.ts#L10',
      ]),
    });
    expect(sourceChunk?.reason).toContain('source chunk index lexical metadata matched the task brief');
    expect(sourceChunk?.content).toContain('deleteOrder');
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('uses current source chunk index catalog rows as lexical metadata for current inventory chunks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-current-index-catalog-'));
    const { deps, raw } = depsFixture();
    const currentInventory = `${JSON.stringify(legacyOrdersInventoryFixture(), null, 2)}\n`;
    const indexEntry = (legacyOrdersSourceChunkIndexFixture().entries as Array<Record<string, unknown>>)[0]!;
    raw.listSourceChunkIndexEntries.mockResolvedValue([{
      id: 'art_source_chunk_index_current_catalog:src_chunk_idx_orders_delete_handler',
      projectId: 'proj_orch',
      workflowRunId: 'run_current_catalog_index',
      sourceChunkIndexArtifactId: 'art_source_chunk_index_current_catalog',
      sourceInventoryArtifactId: 'art_inventory_current_catalog',
      sourceChunkRef: String(indexEntry.sourceChunkRef),
      contentSha256: String(indexEntry.contentSha256),
      path: String(indexEntry.path),
      language: String(indexEntry.language),
      startLine: Number(indexEntry.startLine),
      endLine: Number(indexEntry.endLine),
      lexicalTokens: indexEntry.lexicalTokens as string[],
      searchText: String(indexEntry.searchText),
      linkedRecordRefs: indexEntry.linkedRecordRefs as string[],
      sourceRefs: indexEntry.sourceRefs as string[],
      entrypointRefs: indexEntry.entrypointRefs as string[],
      symbolRefs: indexEntry.symbolRefs as string[],
      domainEntityRefs: [],
      graphEdgeRefs: indexEntry.graphEdgeRefs as string[],
      testRefs: indexEntry.testRefs as string[],
      hotspotRefs: indexEntry.hotspotRefs as string[],
      capabilityRefs: indexEntry.capabilityRefs as string[],
      createdAt: '2026-07-01T00:05:00.000Z',
    }]);
    const backendRun = vi.fn(async () => ({ outputs: [], lastMessage: 'done' }));
    const c = runCtxFixture({
      run: runFixture({
        id: 'run_current_catalog_index',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
      backend: backendFixture(backendRun),
    });
    c.inputs.user_request = 'Implement fulfillment cancel behavior for deleting orders in the Orders API.';
    c.inputs['project-inventory.json'] = currentInventory;
    c.inputArtifactIds['project-inventory.json'] = 'art_inventory_current_catalog';

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.getWorkflowRun).not.toHaveBeenCalled();
    expect(raw.getArtifactContent).not.toHaveBeenCalled();
    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: 'Implement fulfillment cancel behavior for deleting orders in the Orders API.',
      queryEmbedding: queryEmbeddingFor('Implement fulfillment cancel behavior for deleting orders in the Orders API.'),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_current_catalog',
      limit: 500,
    });
    const sourceChunk = agent.contextPack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_orders_delete_handler'
    ));
    expect(sourceChunk).toMatchObject({
      title: 'Source Chunk: apps/api/src/orders-route.ts:10-13',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_current_catalog',
        'artifact:art_source_chunk_index_current_catalog',
        'file:apps/api/src/orders-route.ts#L10',
      ]),
    });
    expect(sourceChunk?.reason).toContain('source chunk index lexical metadata matched the task brief');
    expect(sourceChunk?.content).toContain('deleteOrder');
    expect(sourceChunk?.content).toContain('Language: typescript/javascript');
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('uses exact linked-record catalog rows when lexical source chunk index lookup misses current evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-current-index-linked-record-catalog-'));
    const { deps, raw } = depsFixture();
    const inventory = legacyOrdersInventoryFixture();
    const sourceChunks = inventory.sourceChunks as Array<Record<string, unknown>>;
    sourceChunks[0] = {
      ...sourceChunks[0],
      symbolRefs: ['sym_delete_order'],
      entrypointRefs: ['entry_orders_delete'],
      capabilityRefs: ['cap_api_orders'],
    };
    const exactRow = legacyOrdersSourceChunkCatalogRow({
      id: 'art_source_chunk_index_exact_record:src_chunk_idx_exact_delete_handler',
      sourceChunkIndexArtifactId: 'art_source_chunk_index_exact_record',
      sourceInventoryArtifactId: 'art_inventory_exact_record_catalog',
      sourceChunkRef: 'chunk_previous_orders_delete_handler',
      contentSha256: '8'.repeat(64),
      startLine: 8,
      endLine: 11,
      lexicalTokens: ['legacy', 'ledger'],
      searchText: 'legacy ledger',
      linkedRecordRefs: ['symbol:sym_delete_order'],
      sourceRefs: ['file:apps/api/src/orders-route.ts#L8'],
    });
    const noiseRow = legacyOrdersSourceChunkCatalogRow({
      id: 'art_source_chunk_index_exact_record:src_chunk_idx_same_record_other_path',
      sourceChunkIndexArtifactId: 'art_source_chunk_index_exact_record',
      sourceInventoryArtifactId: 'art_inventory_exact_record_catalog',
      sourceChunkRef: 'chunk_other_path_orders_delete_handler',
      contentSha256: '9'.repeat(64),
      path: 'apps/api/src/customer-orders-route.ts',
      startLine: 8,
      endLine: 11,
      lexicalTokens: ['legacy', 'ledger', 'customer'],
      searchText: 'legacy ledger customer',
      linkedRecordRefs: ['symbol:sym_delete_order'],
      sourceRefs: ['file:apps/api/src/customer-orders-route.ts#L8'],
    });
    raw.listSourceChunkIndexEntries.mockImplementation(async (params: {
      q?: string | null;
      linkedRecordRef?: string | null;
    }) => {
      if (params.q) return [];
      if (params.linkedRecordRef === 'symbol:sym_delete_order') return [exactRow, noiseRow];
      return [];
    });
    const backendRun = vi.fn(async () => ({ outputs: [], lastMessage: 'done' }));
    const c = runCtxFixture({
      run: runFixture({
        id: 'run_current_exact_record_catalog',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
      backend: backendFixture(backendRun),
    });
    c.inputs.user_request = 'Fix delete order handler behavior.';
    c.inputs['project-inventory.json'] = `${JSON.stringify(inventory, null, 2)}\n`;
    c.inputArtifactIds['project-inventory.json'] = 'art_inventory_exact_record_catalog';

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj_orch',
      q: 'Fix delete order handler behavior.',
      queryEmbedding: queryEmbeddingFor('Fix delete order handler behavior.'),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_exact_record_catalog',
      limit: 500,
    }));
    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj_orch',
      linkedRecordRef: 'symbol:sym_delete_order',
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_exact_record_catalog',
      limit: 100,
    }));
    const linkedRecordCalls = raw.listSourceChunkIndexEntries.mock.calls
      .map((call) => call[0])
      .filter((params) => params.linkedRecordRef);
    expect(linkedRecordCalls.length).toBeGreaterThan(0);
    expect(linkedRecordCalls.every((params) => (
      !params.q && !params.queryEmbedding && !params.queryEmbeddingModel
    ))).toBe(true);
    const sourceChunk = agent.contextPack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_orders_delete_handler'
    ));
    expect(sourceChunk).toMatchObject({
      title: 'Source Chunk: apps/api/src/orders-route.ts:10-13',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_exact_record_catalog',
        'artifact:art_source_chunk_index_exact_record',
      ]),
    });
    expect(sourceChunk?.content).toContain('Language: typescript/javascript');
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('customer-orders-route');
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('does not derive exact linked-record catalog fallback from substring-only inventory token matches', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-current-index-linked-record-substring-'));
    const { deps, raw } = depsFixture();
    raw.listSourceChunkIndexEntries.mockResolvedValue([]);
    const inventory = legacyOrdersInventoryFixture();
    (inventory.symbols as Array<Record<string, unknown>>).push({
      id: 'sym_refund_order',
      kind: 'class',
      name: 'RefundOrderService',
      path: 'apps/api/src/refund-order-service.ts',
      exported: true,
      line: 1,
      signature: 'export class RefundOrderService',
      sourceRefs: ['file:apps/api/src/refund-order-service.ts#L1'],
    });
    const c = runCtxFixture({
      backend: backendFixture(async () => ({ outputs: [], lastMessage: 'done' })),
    });
    c.inputs.user_request = 'Fix fund behavior.';
    c.inputs['project-inventory.json'] = `${JSON.stringify(inventory, null, 2)}\n`;
    c.inputArtifactIds['project-inventory.json'] = 'art_inventory_substring_record_catalog';

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: 'Fix fund behavior.',
      queryEmbedding: queryEmbeddingFor('Fix fund behavior.'),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_substring_record_catalog',
      limit: 500,
    });
    expect(raw.listSourceChunkIndexEntries.mock.calls.some(([params]) => (
      Boolean(params.linkedRecordRef)
    ))).toBe(false);
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
  });

  test('bounds long user_request text before querying source chunk index catalog rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-current-index-catalog-long-query-'));
    const { deps, raw } = depsFixture();
    raw.listSourceChunkIndexEntries.mockResolvedValue([]);
    const c = runCtxFixture({
      backend: backendFixture(async () => ({ outputs: [], lastMessage: 'done' })),
    });
    c.inputs.user_request = [
      'Implement fulfillment cancel behavior for deleting orders in the Orders API.',
      'Use the exact legacy source chunk index catalog path before falling back.',
      'Extra detail that should be trimmed from the catalog query because the API q limit is bounded.',
      'TAIL_SHOULD_NOT_BE_SENT_TO_CATALOG',
    ].join(' ');
    c.inputs['project-inventory.json'] = `${JSON.stringify(legacyOrdersInventoryFixture(), null, 2)}\n`;
    c.inputArtifactIds['project-inventory.json'] = 'art_inventory_long_catalog_query';

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    const query = raw.listSourceChunkIndexEntries.mock.calls[0]?.[0]?.q;
    expect(query).toBe(
      'Implement fulfillment cancel behavior for deleting orders in the Orders API. '
      + 'Use the exact legacy source chunk index catalog path before falling back. '
      + 'Extra detail that should be trimmed from the',
    );
    expect(query!.length).toBeLessThanOrEqual(200);
    expect(query).not.toContain('TAIL_SHOULD_NOT_BE_SENT_TO_CATALOG');
    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: query,
      queryEmbedding: queryEmbeddingFor(query!),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_long_catalog_query',
      limit: 500,
    });
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('uses injected source chunk embedding provider for bounded catalog query vectors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-current-index-provider-query-'));
    const { deps, raw } = depsFixture();
    raw.listSourceChunkIndexEntries.mockResolvedValue([]);
    const providerInputs: Array<{ kind: string; text: string }> = [];
    const sourceChunkEmbeddingProvider = {
      embed: vi.fn(async (input: { kind: string; text: string }) => {
        providerInputs.push(input);
        return {
          model: 'fixture-query-embedding-v1',
          dimensions: 2,
          vector: [0.6, 0.8],
        };
      }),
    };
    const c = runCtxFixture({
      backend: backendFixture(async () => ({ outputs: [], lastMessage: 'done' })),
    });
    c.inputs.user_request = 'Implement fulfillment cancel behavior for deleting orders in the Orders API.';
    c.inputs['project-inventory.json'] = `${JSON.stringify(legacyOrdersInventoryFixture(), null, 2)}\n`;
    c.inputArtifactIds['project-inventory.json'] = 'art_inventory_provider_query';

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, {
      ...deps,
      sourceChunkEmbeddingProvider,
    });

    expect(sourceChunkEmbeddingProvider.embed).toHaveBeenCalledTimes(1);
    expect(providerInputs).toEqual([{
      kind: 'catalog_query',
      text: 'implement fulfillment cancel behavior for deleting orders in the orders api',
    }]);
    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: 'Implement fulfillment cancel behavior for deleting orders in the Orders API.',
      queryEmbedding: [0.6, 0.8],
      queryEmbeddingModel: 'fixture-query-embedding-v1',
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_provider_query',
      limit: 500,
    });
    expect(JSON.stringify(providerInputs)).not.toContain('"schemaVersion"');
    expect(JSON.stringify(providerInputs)).not.toContain('deleteOrder');
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
  });

  test('falls back to local catalog query vector when injected embedding provider fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-current-index-provider-fallback-'));
    const { deps, raw } = depsFixture();
    raw.listSourceChunkIndexEntries.mockResolvedValue([]);
    const sourceChunkEmbeddingProvider = {
      embed: vi.fn(async () => {
        throw new Error('provider offline');
      }),
    };
    const c = runCtxFixture({
      backend: backendFixture(async () => ({ outputs: [], lastMessage: 'done' })),
    });
    c.inputs.user_request = 'Implement deleting orders in the Orders API.';
    c.inputs['project-inventory.json'] = `${JSON.stringify(legacyOrdersInventoryFixture(), null, 2)}\n`;
    c.inputArtifactIds['project-inventory.json'] = 'art_inventory_provider_fallback';

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, {
      ...deps,
      sourceChunkEmbeddingProvider,
    });

    expect(sourceChunkEmbeddingProvider.embed).toHaveBeenCalledTimes(1);
    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: 'Implement deleting orders in the Orders API.',
      queryEmbedding: queryEmbeddingFor('Implement deleting orders in the Orders API.'),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_provider_fallback',
      limit: 500,
    });
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
  });

  test('preserves current inventory fallback when source chunk index catalog lookup fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-current-index-catalog-failure-'));
    const { deps, raw } = depsFixture();
    raw.listSourceChunkIndexEntries.mockRejectedValue(new Error('catalog offline'));
    const currentInventory = `${JSON.stringify(legacyOrdersInventoryFixture(), null, 2)}\n`;
    const c = runCtxFixture({
      backend: backendFixture(async () => ({ outputs: [], lastMessage: 'done' })),
    });
    c.inputs.user_request = 'Implement deleting orders in the Orders API.';
    c.inputs['project-inventory.json'] = currentInventory;
    c.inputArtifactIds['project-inventory.json'] = 'art_inventory_catalog_failure';

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: 'Implement deleting orders in the Orders API.',
      queryEmbedding: queryEmbeddingFor('Implement deleting orders in the Orders API.'),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_catalog_failure',
      limit: 500,
    });
    expect(agent.contextPack.sections.find((section) => section.id === 'inventory_capability_cap_api_orders'))
      .toMatchObject({
        sourceType: 'code_probe',
        sourceRefs: expect.arrayContaining(['artifact:art_inventory_catalog_failure']),
      });
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('falls back to catalog index metadata when historical inventory content is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-inventory-catalog-only-'));
    const { deps, raw } = depsFixture();
    const currentRun = runFixture({
      id: 'run_current_catalog_only',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const latestRun = runFixture({
      id: 'run_prior_catalog_only',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
    });
    const latestInventoryArtifact = artifactFixture({
      id: 'art_inventory_catalog_only',
      workflowRunId: latestRun.id,
      createdAt: '2026-06-30T00:05:00.000Z',
      metadata: {
        role: 'project_inventory',
        output: 'project-inventory.json',
        schemaVersion: 'ainp.project_inventory.v1',
      },
    });
    const latestSourceChunkIndexArtifact = artifactFixture({
      id: 'art_source_chunk_index_catalog_only',
      workflowRunId: latestRun.id,
      createdAt: '2026-06-30T00:06:00.000Z',
      metadata: {
        role: 'source_chunk_index',
        output: 'source-chunk-index.json',
        schemaVersion: 'ainp.source_chunk_index.v1',
        sourceInventoryArtifactId: latestInventoryArtifact.id,
      },
    });
    raw.getWorkflowRun.mockResolvedValue(workflowRunDetailFixture(latestRun, [
      latestInventoryArtifact,
      latestSourceChunkIndexArtifact,
    ]));
    raw.getArtifactContent.mockRejectedValue(new Error('artifact body unavailable'));
    const indexEntry = (legacyOrdersSourceChunkIndexFixture().entries as Array<Record<string, unknown>>)[0]!;
    raw.listSourceChunkIndexEntries.mockResolvedValue([{
      id: 'art_source_chunk_index_catalog_only:src_chunk_idx_orders_delete_handler',
      projectId: 'proj_orch',
      workflowRunId: latestRun.id,
      sourceChunkIndexArtifactId: latestSourceChunkIndexArtifact.id,
      sourceInventoryArtifactId: latestInventoryArtifact.id,
      sourceChunkRef: String(indexEntry.sourceChunkRef),
      contentSha256: String(indexEntry.contentSha256),
      path: String(indexEntry.path),
      language: String(indexEntry.language),
      startLine: Number(indexEntry.startLine),
      endLine: Number(indexEntry.endLine),
      lexicalTokens: indexEntry.lexicalTokens as string[],
      searchText: String(indexEntry.searchText),
      linkedRecordRefs: indexEntry.linkedRecordRefs as string[],
      sourceRefs: indexEntry.sourceRefs as string[],
      entrypointRefs: indexEntry.entrypointRefs as string[],
      symbolRefs: indexEntry.symbolRefs as string[],
      domainEntityRefs: [],
      graphEdgeRefs: indexEntry.graphEdgeRefs as string[],
      testRefs: indexEntry.testRefs as string[],
      hotspotRefs: indexEntry.hotspotRefs as string[],
      capabilityRefs: indexEntry.capabilityRefs as string[],
      createdAt: latestSourceChunkIndexArtifact.createdAt,
    }]);
    const backendRun = vi.fn(async () => ({ outputs: [], lastMessage: 'done' }));
    const c = runCtxFixture({
      run: currentRun,
      backend: backendFixture(backendRun),
    });
    c.inputs.user_request = 'Implement fulfillment cancel behavior for deleting orders in the Orders API.';
    c.contextFoundation.runHistory = [currentRun, latestRun];

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.getArtifactContent).toHaveBeenCalledWith('art_inventory_catalog_only');
    expect(raw.getArtifactContent).not.toHaveBeenCalledWith('art_source_chunk_index_catalog_only');
    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: 'Implement fulfillment cancel behavior for deleting orders in the Orders API.',
      queryEmbedding: queryEmbeddingFor('Implement fulfillment cancel behavior for deleting orders in the Orders API.'),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: 'art_source_chunk_index_catalog_only',
      sourceInventoryArtifactId: 'art_inventory_catalog_only',
      limit: 500,
    });
    expect(c.contextFoundation.historicalInventoryArtifactChecked).toBe(true);
    expect(c.contextFoundation.historicalInventoryArtifact?.artifactId).toBe('art_inventory_catalog_only');
    expect(c.contextFoundation.historicalInventoryArtifact?.sourceChunkIndexArtifact?.artifactId)
      .toBe('art_source_chunk_index_catalog_only');
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain(
      'inventory_source_chunk_chunk_orders_delete_handler',
    );
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('fulfillment cancel order');
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('deleteOrder');
  });

  test('does not add historical inventory when current inputs carry project-inventory.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-current-inventory-'));
    const { deps, raw } = depsFixture();
    const currentInventory = `${JSON.stringify(legacyOrdersInventoryFixture(), null, 2)}\n`;
    const c = runCtxFixture({
      backend: backendFixture(async () => ({ outputs: [], lastMessage: 'done' })),
    });
    c.inputs.user_request = 'Implement deleting orders in the Orders API and update order tests.';
    c.inputs['project-inventory.json'] = currentInventory;
    c.inputArtifactIds['project-inventory.json'] = 'art_inventory_current';
    c.contextFoundation.runHistory = [
      runFixture({
        id: 'run_prior_latest',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
      }),
    ];

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.getWorkflowRun).not.toHaveBeenCalled();
    expect(raw.getArtifactContent).not.toHaveBeenCalled();
    const capability = agent.contextPack.sections.find((section) => (
      section.id === 'inventory_capability_cap_api_orders'
    ));
    expect(capability).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining(['artifact:art_inventory_current']),
    });
    expect(JSON.stringify(agent.contextPack.sections)).not.toContain('art_inventory_latest');
    expect(agent.contextPack.sections.map((section) => section.id)).not.toContain('input_project_inventory_json');
  });

  test('context_request in last message: retries same skill with supplement context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-ctxreq-'));
    const outPath = join(dir, 'implementation.md');
    const { deps, raw } = depsFixture();
    const lastMessage = [
      'I need more context before continuing.',
      '```json',
      JSON.stringify({
        type: 'context_request',
        reason: 'need the gate engine source',
        requestedRefs: ['apps/api/src/gates.ts'],
        questions: ['which gate ids are rule-based?'],
        priority: 2,
      }),
      '```',
    ].join('\n');
    const backendRun = vi.fn(async () => {
      if (backendRun.mock.calls.length === 1) {
        return { outputs: [], lastMessage };
      }
      await writeFile(outPath, '# implementation after supplement\n', 'utf8');
      return {
        outputs: [
          { name: 'implementation.md', path: outPath, contentType: 'text/markdown', size: 34 },
        ],
        lastMessage: 'implemented after supplement',
      };
    });
    const c = runCtxFixture({
      backend: backendFixture(backendRun),
    });
    const skill = skillFixture('implementation');

    const agent = await invokeSkill(c, skill, {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(backendRun).toHaveBeenCalledTimes(2);
    expect(agent.taskId).toBe('task_invoke_2');
    expect(agent.sessionId).toBe('ags_invoke_2');
    expect(agent.contextRequest).not.toBeNull();
    const capture = agent.contextRequest!;
    expect(capture.sourceName).toBe('last_message');
    expect(capture.request.requestedRefs).toEqual(['apps/api/src/gates.ts']);
    expect(capture.requestArtifactId).toBe('art_2_other');
    expect(capture.supplementArtifactId).toBe('art_3_context_pack');
    expect(capture.baseContextPackArtifactId).toBe('art_1_context_pack');
    expect(capture.baseInvocationId).toMatch(/^ctxinv_/);
    expect(capture.supplementInvocationId).toMatch(/^ctxinv_/);
    expect(capture.supplementContextPack.supplement).toMatchObject({
      contextRequestId: capture.request.id,
      baseContextPackId: capture.baseContextPackId,
      retryIndex: 1,
    });
    expect(capture.supplementContextPackId).toBe(agent.contextPack.id);
    expect(agent.contextPackArtifactId).toBe('art_3_context_pack');
    expect(agent.invocationId).toBe(capture.supplementInvocationId);

    // RunCtx mutations: chain + inputs + artifact ids.
    expect(c.contextRequestChain).toEqual([capture]);
    expect(c.inputs[`context_request.${capture.request.id}.json`]).toContain('need the gate engine source');
    expect(c.inputArtifactIds[`context_supplement.${capture.request.id}.json`])
      .toBe('art_3_context_pack');

    // Request + supplement were persisted to disk and recorded via the API.
    const persisted = await readdir(join(dir, 'context-requests'));
    expect(persisted).toHaveLength(2);
    await expect(readdir(join(dir, 'context-packs'))).resolves.toHaveLength(1);
    expect(raw.recordContextRequest).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run_orch',
      baseContextPackArtifactId: 'art_1_context_pack',
      supplementContextPackId: capture.supplementContextPackId,
      requestArtifactId: 'art_2_other',
      supplementArtifactId: 'art_3_context_pack',
    }));
    expect(raw.agentTaskFinished).toHaveBeenCalledWith({
      taskId: 'task_invoke',
      status: 'success',
      summary: expect.stringContaining(`context_request ${capture.request.id} captured`),
      outputArtifactIds: ['art_2_other', 'art_3_context_pack'],
    });
    expect(raw.agentSessionFinished).toHaveBeenCalledWith({
      sessionId: 'ags_invoke',
      status: 'success',
      agentResultId: 'agr_invoke',
      metadata: expect.objectContaining({
        contextRequestId: capture.request.id,
        supplementContextPackId: capture.supplementContextPackId,
        supplementContextPackArtifactId: 'art_3_context_pack',
        baseContextPackArtifactId: 'art_1_context_pack',
        retryPlanned: true,
      }),
    });
    expect(raw.agentSessionStarted).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parentSessionId: 'ags_invoke',
      retryIndex: 1,
      contextPackId: capture.supplementContextPackId,
      metadata: expect.objectContaining({
        invocationId: capture.supplementInvocationId,
        contextPackArtifactId: 'art_3_context_pack',
        contextPackRole: 'supplement',
        contextRequestId: capture.request.id,
        baseContextPackId: capture.baseContextPackId,
      }),
    }));
  });

  test('uses context_request-specific terms for supplement source chunk index catalog lookup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-ctxreq-index-catalog-'));
    const { deps, raw } = depsFixture();
    raw.listSourceChunkIndexEntries.mockImplementation(async (params: { q?: string | null }) => (
      params.q?.includes('fulfillment cancel order')
        ? [legacyOrdersSourceChunkCatalogRow({
          sourceChunkIndexArtifactId: 'art_source_chunk_index_ctxreq',
          sourceInventoryArtifactId: 'art_inventory_ctxreq',
        })]
        : []
    ));
    const backendRun = vi.fn(async () => {
      if (backendRun.mock.calls.length === 1) {
        return {
          outputs: [],
          lastMessage: [
            'I need the exact source chunk before editing.',
            '```json',
            JSON.stringify({
              type: 'context_request',
              reason: 'need the source chunk index hit',
              requestedRefs: ['apps/api/src/orders-route.ts#L10'],
              questions: ['Which fulfillment cancel order handler source chunk should I inspect?'],
              priority: 2,
            }),
            '```',
          ].join('\n'),
        };
      }
      return { outputs: [], lastMessage: 'done after supplement' };
    });
    const c = runCtxFixture({
      backend: backendFixture(backendRun),
    });
    c.inputs.user_request = 'Touch the order API.';
    c.inputs['project-inventory.json'] = `${JSON.stringify(legacyOrdersInventoryFixture(), null, 2)}\n`;
    c.inputArtifactIds['project-inventory.json'] = 'art_inventory_ctxreq';

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    const queryCalls = raw.listSourceChunkIndexEntries.mock.calls
      .map((call) => call[0])
      .filter((params) => params.q);
    expect(queryCalls).toHaveLength(2);
    const baseQuery = queryCalls[0]?.q;
    const supplementQuery = queryCalls[1]?.q;
    expect(baseQuery).toBe('Touch the order API.');
    expect(supplementQuery).toContain('apps/api/src/orders-route.ts#L10');
    expect(supplementQuery).toContain('fulfillment cancel order handler source chunk');
    expect(supplementQuery).toContain('Touch the order API.');
    expect(supplementQuery!.length).toBeLessThanOrEqual(200);
    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: supplementQuery,
      queryEmbedding: queryEmbeddingFor(supplementQuery!),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_ctxreq',
      limit: 500,
    });
    expect(agent.contextRequest).not.toBeNull();
    const supplementPack = agent.contextRequest!.supplementContextPack;
    const sourceChunk = supplementPack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_orders_delete_handler'
    ));
    expect(sourceChunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_ctxreq',
        'artifact:art_source_chunk_index_ctxreq',
        'file:apps/api/src/orders-route.ts#L10',
      ]),
    });
    expect(sourceChunk?.reason).toContain('source chunk index lexical metadata matched the task brief');
    expect(sourceChunk?.content).toContain('deleteOrder');
    expect(supplementPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(JSON.stringify(supplementPack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('retries cached historical source chunk index catalog lookup with context_request-specific terms', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-ctxreq-historical-index-catalog-'));
    const { deps, raw } = depsFixture();
    const currentRun = runFixture({
      id: 'run_current_ctxreq_history',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const latestRun = runFixture({
      id: 'run_prior_ctxreq_history',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
    });
    const latestInventoryArtifact = artifactFixture({
      id: 'art_inventory_ctxreq_history',
      workflowRunId: latestRun.id,
      createdAt: '2026-06-30T00:05:00.000Z',
      metadata: {
        role: 'project_inventory',
        output: 'project-inventory.json',
        schemaVersion: 'ainp.project_inventory.v1',
      },
    });
    raw.getWorkflowRun.mockResolvedValue(workflowRunDetailFixture(latestRun, [
      latestInventoryArtifact,
    ]));
    raw.getArtifactContent.mockImplementation(async (id: string) => {
      if (id === latestInventoryArtifact.id) {
        return {
          artifact: latestInventoryArtifact,
          text: JSON.stringify(legacyOrdersInventoryFixture()),
          contentType: 'application/json',
          filename: 'project-inventory.json',
        };
      }
      throw new Error(`unexpected artifact content lookup ${id}`);
    });
    raw.listSourceChunkIndexEntries.mockImplementation(async (params: { q?: string | null }) => (
      params.q?.includes('fulfillment cancel order')
        ? [legacyOrdersSourceChunkCatalogRow({
          workflowRunId: latestRun.id,
          sourceChunkIndexArtifactId: 'art_source_chunk_index_ctxreq_history',
          sourceInventoryArtifactId: latestInventoryArtifact.id,
          createdAt: '2026-06-30T00:06:00.000Z',
        })]
        : []
    ));
    const backendRun = vi.fn(async () => {
      if (backendRun.mock.calls.length === 1) {
        return {
          outputs: [],
          lastMessage: [
            'I need more historical source context.',
            '```json',
            JSON.stringify({
              type: 'context_request',
              reason: 'need the historical catalog row',
              requestedRefs: ['apps/api/src/orders-route.ts#L10'],
              questions: ['Which fulfillment cancel order handler source chunk should I inspect?'],
              priority: 2,
            }),
            '```',
          ].join('\n'),
        };
      }
      return { outputs: [], lastMessage: 'done after supplement' };
    });
    const c = runCtxFixture({
      run: currentRun,
      backend: backendFixture(backendRun),
    });
    c.inputs.user_request = 'Touch the order API.';
    c.contextFoundation.runHistory = [currentRun, latestRun];

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(raw.getWorkflowRun).toHaveBeenCalledTimes(1);
    expect(raw.getArtifactContent).toHaveBeenCalledTimes(1);
    const queryCalls = raw.listSourceChunkIndexEntries.mock.calls
      .map((call) => call[0])
      .filter((params) => params.q);
    expect(queryCalls).toHaveLength(2);
    const baseQuery = queryCalls[0]?.q;
    const supplementQuery = queryCalls[1]?.q;
    expect(baseQuery).toBe('Touch the order API.');
    expect(supplementQuery).toContain('fulfillment cancel order handler source chunk');
    expect(supplementQuery!.length).toBeLessThanOrEqual(200);
    expect(raw.listSourceChunkIndexEntries).toHaveBeenCalledWith({
      projectId: 'proj_orch',
      q: supplementQuery,
      queryEmbedding: queryEmbeddingFor(supplementQuery!),
      queryEmbeddingModel: queryEmbeddingModelFor(),
      sourceChunkIndexArtifactId: null,
      sourceInventoryArtifactId: 'art_inventory_ctxreq_history',
      limit: 500,
    });
    const supplementPack = agent.contextRequest!.supplementContextPack;
    const sourceChunk = supplementPack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_orders_delete_handler'
    ));
    expect(sourceChunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_ctxreq_history',
        'artifact:art_source_chunk_index_ctxreq_history',
        'file:apps/api/src/orders-route.ts#L10',
      ]),
    });
    expect(supplementPack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(JSON.stringify(supplementPack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('repeated context_request after retry limit fails and finishes retry session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-ctxreq-loop-'));
    const { deps, raw } = depsFixture();
    const repeated = [
      'Still need context.',
      '```json',
      JSON.stringify({
        type: 'context_request',
        reason: 'need the same file again',
        requestedRefs: ['apps/api/src/gates.ts'],
        priority: 2,
      }),
      '```',
    ].join('\n');
    const c = runCtxFixture({
      backend: backendFixture(async () => ({ outputs: [], lastMessage: repeated })),
    });

    await expect(invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps)).rejects.toThrow('context_request retry limit reached');

    expect(raw.agentSessionStarted).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parentSessionId: 'ags_invoke',
      retryIndex: 1,
    }));
    expect(raw.agentSessionFinished).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'ags_invoke_2',
      status: 'failed',
      agentResultId: 'agr_invoke_2',
      metadata: expect.objectContaining({
        error: expect.stringContaining('context_request retry limit reached'),
      }),
    }));
  });

  test('sensitive-only context_request is filtered and does not retry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'invokeskill-sensitive-ctxreq-'));
    const { deps, raw } = depsFixture();
    const sensitiveRequest = [
      'Need secrets.',
      '```json',
      JSON.stringify({
        type: 'context_request',
        reason: 'need .env and private key',
        requestedRefs: ['.env', '.ssh/id_rsa'],
        questions: ['Read .ssh/id_rsa?'],
        priority: 1,
      }),
      '```',
    ].join('\n');
    const backendRun = vi.fn(async () => ({ outputs: [], lastMessage: sensitiveRequest }));
    const c = runCtxFixture({
      backend: backendFixture(backendRun),
    });

    const agent = await invokeSkill(c, skillFixture('implementation'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_impl',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: dir,
      inputs: c.inputs,
    }, deps);

    expect(agent.taskId).toBe('task_invoke');
    expect(agent.contextRequest).toBeNull();
    expect(backendRun).toHaveBeenCalledTimes(1);
    expect(raw.agentSessionStarted).toHaveBeenCalledTimes(1);
    expect(raw.agentTaskFinished).not.toHaveBeenCalled();
  });

  test('backend failure: finishes the agent task as failed and rethrows', async () => {
    const { deps, raw } = depsFixture();
    const c = runCtxFixture({
      backend: backendFixture(async () => {
        throw new Error('backend exploded');
      }),
    });

    await expect(invokeSkill(c, skillFixture('review'), {
      workflowRunId: c.run.id,
      stepRunId: 'step_review',
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: '/tmp/unused',
      inputs: c.inputs,
    }, deps)).rejects.toThrow('backend exploded');

    expect(raw.agentTaskFinished).toHaveBeenCalledWith({
      taskId: 'task_invoke',
      status: 'failed',
      summary: 'backend exploded',
      outputArtifactIds: [],
    });
    expect(raw.agentSessionFinished).toHaveBeenCalledWith({
      sessionId: 'ags_invoke',
      status: 'failed',
      agentResultId: 'agr_invoke',
      metadata: expect.objectContaining({
        error: 'backend exploded',
        contextPackArtifactId: 'art_1_context_pack',
        invocationId: expect.stringMatching(/^ctxinv_/),
      }),
    });
  });

  test('finishAgentSuccess links successful AgentResult back to the AgentSession', async () => {
    const agentTaskFinished = vi.fn(async () => ({ result: { id: 'agr_success' } }));
    const agentSessionFinished = vi.fn(async () => ({ session: { id: 'ags_success' } }));

    await finishAgentSuccess(
      {
        taskId: 'task_success',
        sessionId: 'ags_success',
        invocationId: 'ctxinv_success',
        contextPackArtifactId: 'art_context_pack_success',
        outputs: [],
        contextPack: {} as never,
        contextRequest: null,
      },
      ['art_output'],
      'produced output',
      agentTaskFinished as never,
      agentSessionFinished as never,
    );

    expect(agentTaskFinished).toHaveBeenCalledWith({
      taskId: 'task_success',
      status: 'success',
      summary: 'produced output',
      outputArtifactIds: ['art_output'],
    });
    expect(agentSessionFinished).toHaveBeenCalledWith({
      sessionId: 'ags_success',
      status: 'success',
      agentResultId: 'agr_success',
      metadata: {
        outputArtifactIds: ['art_output'],
        invocationId: 'ctxinv_success',
        contextPackArtifactId: 'art_context_pack_success',
        contextRequestId: null,
        supplementContextPackId: null,
        supplementContextPackArtifactId: null,
      },
    });
  });
});
