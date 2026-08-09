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

  test('degrades possibly stale memory to summary evidence instead of full authoritative context', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement using backend policy evidence.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_possibly_stale',
          metadata: {
            title: 'Backend policy',
            text: Array.from({ length: 20 }, (_, i) => `Line ${i}: backend policy detail`).join('\n'),
            summary: 'Backend policy summary for review.',
            knowledgeClass: 'confirmed',
            trustLevel: 'accepted_knowledge',
            freshness: 'possibly_stale',
            sourceRefs: ['knowledge:accepted', 'entity:ADR-BACKEND'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const memory = pack.sections.find((s) => s.id === 'knowledge_kart_possibly_stale');
    expect(memory).toMatchObject({
      mode: 'summary',
      content: 'Backend policy summary for review.',
      knowledgeClass: 'confirmed',
      trustLevel: 'accepted_knowledge',
      freshness: 'possibly_stale',
    });
    expect(pack.manifest.find((m) => m.ref === 'knowledge_kart_possibly_stale')).toMatchObject({
      mode: 'summary',
      freshness: 'possibly_stale',
    });
  });

  test('keeps confirmed current memory eligible for full context', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement using current backend policy.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_current',
          metadata: {
            title: 'Current backend policy',
            text: 'Use Claude Code or Codex as configured project backends.',
            knowledgeClass: 'confirmed',
            trustLevel: 'accepted_knowledge',
            freshness: 'current',
            sourceRefs: ['knowledge:accepted', 'entity:ADR-BACKEND'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.find((s) => s.id === 'knowledge_kart_current')).toMatchObject({
      mode: 'full',
      freshness: 'current',
      trustLevel: 'accepted_knowledge',
      reason: expect.not.stringContaining('evidence only'),
    });
  });

  test('selects accepted profile-derived architecture knowledge for later context packs', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'design',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Design a workflow engine extension for project profile bootstrap.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_profile_arch',
          kind: 'architecture',
          status: 'accepted',
          derivedFromArtifactId: 'art_project_profile_json',
          metadata: {
            title: 'Workflow engine profile architecture',
            text: 'Profile bootstrap uses the API workflow engine and preserves inventory/profile provenance.',
            knowledgeClass: 'confirmed',
            trustLevel: 'accepted_knowledge',
            freshness: 'current',
            sourceRefs: [
              'knowledge:accepted',
              'artifact:art_project_profile_json',
              'artifact:art_inventory',
              'profile.bootstrap',
            ],
            confidence: 0.91,
            origin: 'profile.bootstrap',
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const profileKnowledge = pack.sections.find((s) => s.id === 'knowledge_kart_profile_arch');
    expect(profileKnowledge).toMatchObject({
      knowledgeClass: 'confirmed',
      trustLevel: 'accepted_knowledge',
      freshness: 'current',
      mode: 'full',
      sourceRefs: expect.arrayContaining([
        'knowledge:accepted',
        'artifact:art_project_profile_json',
        'profile.bootstrap',
      ]),
    });
    expect(pack.manifest.find((m) => m.ref === 'knowledge_kart_profile_arch')).toMatchObject({
      trustLevel: 'accepted_knowledge',
      sourceRefs: expect.arrayContaining(['artifact:art_project_profile_json']),
    });
  });

  test('keeps draft profile-derived candidates out of authoritative context', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement profile bootstrap using reviewed architecture only.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_profile_draft',
          kind: 'architecture',
          status: 'draft',
          derivedFromArtifactId: 'art_project_profile_json',
          metadata: {
            title: 'Draft profile candidate',
            text: 'Draft profile suggestion before Knowledge Gate review.',
            knowledgeClass: 'confirmed',
            trustLevel: 'accepted_knowledge',
            freshness: 'current',
            sourceRefs: [
              'knowledge:draft',
              'artifact:art_project_profile_json',
              'profile.bootstrap',
            ],
            confidence: 0.99,
            origin: 'profile.bootstrap',
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const draft = pack.sections.find((s) => s.id === 'knowledge_kart_profile_draft');
    expect(draft).toMatchObject({
      knowledgeClass: 'recovered',
      trustLevel: 'summary',
      freshness: 'possibly_stale',
      mode: 'summary',
      confidence: 0.5,
      sourceRefs: expect.arrayContaining([
        'knowledge:draft',
        'artifact:art_project_profile_json',
      ]),
    });
    expect(pack.sections.some((s) => (
      s.id === 'knowledge_kart_profile_draft'
      && s.trustLevel === 'accepted_knowledge'
      && s.mode === 'full'
    ))).toBe(false);
  });

  test('keeps conflict-marked accepted memory as evidence only', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement after backend policy changed.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_conflict',
          metadata: {
            title: 'Conflicted backend policy',
            text: 'Fact: agent backend = native',
            summary: 'Old backend policy conflicts with current code.',
            knowledgeClass: 'confirmed',
            trustLevel: 'accepted_knowledge',
            freshness: 'current',
            reviewStatus: 'conflict',
            sourceRefs: ['knowledge:accepted', 'entity:ADR-BACKEND'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const memory = pack.sections.find((s) => s.id === 'knowledge_kart_conflict');
    expect(memory).toMatchObject({
      mode: 'summary',
      content: 'Old backend policy conflicts with current code.',
      trustLevel: 'summary',
      freshness: 'historical',
      confidence: 0.45,
      reason: expect.stringContaining('reviewStatus=conflict'),
    });
    expect(pack.calibrationSignals?.map((signal) => signal.kind)).toContain('conflict');
  });

  test('keeps review-required memory as evidence only', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement after backend policy needs review.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_needs_review',
          metadata: {
            title: 'Review-required backend policy',
            text: 'Fact: agent backend = native',
            summary: 'Backend policy needs human review before use.',
            knowledgeClass: 'confirmed',
            trustLevel: 'accepted_knowledge',
            freshness: 'current',
            reviewStatus: 'needs_review',
            sourceRefs: ['knowledge:accepted', 'entity:ADR-BACKEND'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.find((s) => s.id === 'knowledge_kart_needs_review')).toMatchObject({
      mode: 'summary',
      content: 'Backend policy needs human review before use.',
      trustLevel: 'summary',
      freshness: 'historical',
      reason: expect.stringContaining('reviewStatus=needs_review'),
    });
    expect(pack.calibrationSignals?.map((signal) => signal.kind)).toContain('conflict');
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

  test('selects task-relevant project inventory capability evidence as code probes', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement deleting orders in the Orders API and update order tests.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
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
              {
                id: 'entry_payments_get',
                kind: 'http_route',
                label: 'GET /api/payments',
                path: 'apps/api/src/payments-route.ts',
                method: 'GET',
                route: '/api/payments',
                handler: 'listPayments',
                sourceRefs: ['file:apps/api/src/payments-route.ts#L8'],
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
              {
                id: 'sym_list_payments',
                kind: 'function',
                name: 'listPayments',
                path: 'apps/api/src/payments-route.ts',
                exported: true,
                line: 6,
                signature: 'export function listPayments()',
                sourceRefs: ['file:apps/api/src/payments-route.ts#L6'],
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
            hotspots: [
              {
                id: 'hot_orders',
                path: 'apps/api/src/orders-route.ts',
                reason: 'entrypoint_dense',
                score: 0.8,
                sourceRefs: ['file:apps/api/src/orders-route.ts'],
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
                hotspotRefs: ['hot_orders'],
                sourceRefs: ['file:apps/api/src/orders-route.ts#L12'],
                confidence: 0.95,
                openQuestions: [],
              },
              {
                id: 'cap_api_payments',
                label: 'Payments API',
                kind: 'api',
                entrypointRefs: ['entry_payments_get'],
                moduleRefs: [],
                symbolRefs: ['sym_list_payments'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/payments-route.ts#L8'],
                confidence: 0.9,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_orders');
    expect(capability).toMatchObject({
      title: 'Capability Map: Orders API',
      sourceType: 'code_probe',
      trustLevel: 'source',
      mode: 'summary',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'file:apps/api/src/orders-route.ts#L12',
        'file:apps/api/test/orders-route.test.ts',
      ]),
    });
    expect(capability?.content).toContain('DELETE /api/orders/:id');
    expect(capability?.content).toContain('deleteOrder');
    expect(pack.sections.find((section) => section.id === 'inventory_symbols_orders_api')?.content)
      .toContain('OrderService');
    expect(pack.sections.find((section) => section.id === 'inventory_tests_orders_api')?.content)
      .toContain('orders-route.test.ts');
    expect(pack.sections.find((section) => section.id === 'inventory_hotspots_orders_api')?.content)
      .toContain('entrypoint_dense');
    expect(pack.sections.map((section) => section.id)).not.toContain('input_project_inventory_json');
    expect(JSON.stringify(pack.sections)).not.toContain('Payments API');
    expect(pack.manifest.find((item) => item.ref === 'inventory_capability_cap_api_orders')).toMatchObject({
      type: 'code_probe',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining(['artifact:art_inventory']),
    });
  });

  test('selects capability domain entities and pointed SQL source chunks without sibling leakage', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement refund ledger retention using the schema-qualified audit data table.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_status',
                kind: 'http_route',
                label: 'POST /billing/status',
                path: 'apps/api/src/billing-route.ts',
                method: 'POST',
                route: '/billing/status',
                handler: 'updateBillingStatus',
                sourceRefs: ['file:apps/api/src/billing-route.ts#L8'],
                confidence: 0.9,
              },
              {
                id: 'entry_customer_status',
                kind: 'http_route',
                label: 'POST /customers/status',
                path: 'apps/api/src/customer-route.ts',
                method: 'POST',
                route: '/customers/status',
                handler: 'updateCustomerStatus',
                sourceRefs: ['file:apps/api/src/customer-route.ts#L8'],
                confidence: 0.9,
              },
            ],
            symbols: [],
            domainEntities: [
              {
                id: 'domain_refund_ledger_entries',
                name: 'refund_ledger_entries',
                kind: 'table',
                path: 'db/billing/schema.sql',
                sourceRefs: ['file:db/billing/schema.sql#L1'],
                referenceSourceRefs: ['file:apps/api/src/billing-repository.ts#L12'],
                sourceChunkRefs: ['src_chunk_db_billing_schema', 'src_chunk_billing_repository_table_ref'],
                confidence: 0.88,
              },
              {
                id: 'domain_customer_profiles',
                name: 'customer_profiles',
                kind: 'table',
                path: 'db/customer/schema.sql',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                sourceChunkRefs: ['src_chunk_db_customer_schema'],
                confidence: 0.88,
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing',
                label: 'Billing API',
                kind: 'api',
                entrypointRefs: ['entry_billing_status'],
                moduleRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_ledger_entries'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/billing-route.ts#L8', 'file:db/billing/schema.sql#L1'],
                confidence: 0.9,
                openQuestions: [],
              },
              {
                id: 'cap_api_customers',
                label: 'Customers API',
                kind: 'api',
                entrypointRefs: ['entry_customer_status'],
                moduleRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_customer_profiles'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/customer-route.ts#L8', 'file:db/customer/schema.sql#L1'],
                confidence: 0.9,
                openQuestions: [],
              },
            ],
            sourceChunks: [
              {
                id: 'src_chunk_db_billing_schema',
                path: 'db/billing/schema.sql',
                language: 'sql',
                startLine: 1,
                endLine: 4,
                snippet: 'L1: CREATE TABLE refund_ledger_entries (\\nL2:   id uuid PRIMARY KEY,\\nL3:   refund_id uuid NOT NULL\\nL4: );',
                contentSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                sourceRefs: ['file:db/billing/schema.sql#L1'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_ledger_entries'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: ['cap_api_billing'],
                sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                confidence: 0.78,
              },
              {
                id: 'src_chunk_db_customer_schema',
                path: 'db/customer/schema.sql',
                language: 'sql',
                startLine: 1,
                endLine: 4,
                snippet: 'L1: CREATE TABLE customer_profiles (\\nL2:   id uuid PRIMARY KEY,\\nL3:   customer_id uuid NOT NULL\\nL4: );',
                contentSha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_customer_profiles'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: ['cap_api_customers'],
                sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                confidence: 0.78,
              },
              {
                id: 'src_chunk_billing_repository_table_ref',
                path: 'apps/api/src/billing-repository.ts',
                language: 'typescript/javascript',
                startLine: 10,
                endLine: 14,
                snippet: 'L10: export class BillingRepository {\\nL11:   async retainRefundLedger() {\\nL12:     return sql`select * from billing.refund_ledger_entries where retained_at is null`;\\nL13:   }\\nL14: }',
                contentSha256: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                sourceRefs: ['file:apps/api/src/billing-repository.ts#L12'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_ledger_entries'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: ['cap_api_billing'],
                sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
                confidence: 0.78,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_billing');
    expect(capability).toMatchObject({
      title: 'Capability Map: Billing API',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'file:db/billing/schema.sql#L1',
      ]),
    });
    expect(capability?.content).toContain('Domain Entities:');
    expect(capability?.content).toContain('refund_ledger_entries');
    expect(pack.sections.find((section) => section.id === 'inventory_domain_entities_billing_api')?.content)
      .toContain('table | refund_ledger_entries | db/billing/schema.sql');

    const sourceChunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_src_chunk_db_billing_schema');
    expect(sourceChunk).toMatchObject({
      title: 'Source Chunk: db/billing/schema.sql:1-4',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining(['artifact:art_inventory', 'file:db/billing/schema.sql#L1']),
    });
    expect(sourceChunk?.reason).toContain('hybrid inventory evidence points to this chunk');
    expect(sourceChunk?.content).toContain('Pointed by inventory evidence: domain_refund_ledger_entries');
    expect(sourceChunk?.content).toContain('CREATE TABLE refund_ledger_entries');
    const repositoryChunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_src_chunk_billing_repository_table_ref');
    expect(repositoryChunk).toMatchObject({
      title: 'Source Chunk: apps/api/src/billing-repository.ts:10-14',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining(['artifact:art_inventory', 'file:apps/api/src/billing-repository.ts#L12']),
    });
    expect(repositoryChunk?.content).toContain('Pointed by inventory evidence: domain_refund_ledger_entries');
    expect(repositoryChunk?.content).toContain('select * from billing.refund_ledger_entries');
    expect(JSON.stringify(pack.sections)).not.toContain('customer_profiles');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('uses static SQL foreign-key relationships for table-focused ContextPack retrieval', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Update refund_ledger_entries retention and check refund_audit_notes foreign-key behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_retention',
                kind: 'http_route',
                label: 'POST /billing/retention',
                path: 'apps/api/src/billing-route.ts',
                method: 'POST',
                route: '/billing/retention',
                handler: 'retainBillingLedger',
                sourceRefs: ['file:apps/api/src/billing-route.ts#L8'],
                confidence: 0.9,
              },
            ],
            symbols: [],
            domainEntities: [
              {
                id: 'domain_refund_ledger_entries',
                name: 'refund_ledger_entries',
                kind: 'table',
                path: 'db/billing/schema.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/schema.sql#L1'],
                relationships: [
                  {
                    kind: 'foreign_key',
                    direction: 'referenced_by',
                    domainEntityRef: 'domain_refund_audit_notes',
                    name: 'refund_audit_notes',
                    sourceRefs: ['file:db/billing/schema.sql#L8'],
                    confidence: 0.9,
                  },
                ],
                sourceChunkRefs: ['src_chunk_ledger_table'],
                confidence: 0.88,
              },
              {
                id: 'domain_refund_audit_notes',
                name: 'refund_audit_notes',
                kind: 'table',
                path: 'db/billing/schema.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/schema.sql#L5'],
                relationships: [
                  {
                    kind: 'foreign_key',
                    direction: 'references',
                    domainEntityRef: 'domain_refund_ledger_entries',
                    name: 'refund_ledger_entries',
                    sourceRefs: ['file:db/billing/schema.sql#L8'],
                    confidence: 0.9,
                  },
                ],
                sourceChunkRefs: ['src_chunk_audit_fk'],
                confidence: 0.88,
              },
              {
                id: 'domain_customer_profiles',
                name: 'customer_profiles',
                kind: 'table',
                path: 'db/customer/schema.sql',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                sourceChunkRefs: ['src_chunk_customer_table'],
                confidence: 0.88,
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_data_billing',
                label: 'Billing Data',
                kind: 'module',
                entrypointRefs: ['entry_billing_retention'],
                moduleRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_ledger_entries'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/billing-route.ts#L8', 'file:db/billing/schema.sql#L1'],
                confidence: 0.9,
                openQuestions: [],
              },
            ],
            sourceChunks: [
              {
                id: 'src_chunk_ledger_table',
                path: 'db/billing/schema.sql',
                language: 'sql',
                startLine: 1,
                endLine: 3,
                snippet: 'L1: CREATE TABLE billing.refund_ledger_entries (\\nL2:   id uuid PRIMARY KEY\\nL3: );',
                contentSha256: '1111111111111111111111111111111111111111111111111111111111111111',
                sourceRefs: ['file:db/billing/schema.sql#L1'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_ledger_entries'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: ['cap_data_billing'],
                sha256: '2222222222222222222222222222222222222222222222222222222222222222',
                confidence: 0.78,
              },
              {
                id: 'src_chunk_audit_fk',
                path: 'db/billing/schema.sql',
                language: 'sql',
                startLine: 5,
                endLine: 9,
                snippet: 'L5: CREATE TABLE billing.refund_audit_notes (\\nL6:   id uuid PRIMARY KEY,\\nL7:   ledger_entry_id uuid NOT NULL,\\nL8:   FOREIGN KEY (ledger_entry_id) REFERENCES billing.refund_ledger_entries(id)\\nL9: );',
                contentSha256: '3333333333333333333333333333333333333333333333333333333333333333',
                sourceRefs: ['file:db/billing/schema.sql#L5', 'file:db/billing/schema.sql#L8'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_audit_notes'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: ['cap_data_billing'],
                sha256: '4444444444444444444444444444444444444444444444444444444444444444',
                confidence: 0.78,
              },
              {
                id: 'src_chunk_customer_table',
                path: 'db/customer/schema.sql',
                language: 'sql',
                startLine: 1,
                endLine: 3,
                snippet: 'L1: CREATE TABLE customer_profiles (\\nL2:   id uuid PRIMARY KEY\\nL3: );',
                contentSha256: '5555555555555555555555555555555555555555555555555555555555555555',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_customer_profiles'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: [],
                sha256: '6666666666666666666666666666666666666666666666666666666666666666',
                confidence: 0.78,
              },
            ],
            sourceChunkIndex: {
              schemaVersion: 'ainp.source_chunk_index.v1',
              generatedAt: '2026-07-03T00:00:00.000Z',
              source: 'project_inventory.sourceChunks',
              chunkCount: 3,
              maxEntries: 120,
              entries: [
                {
                  id: 'idx_audit_fk',
                  sourceChunkRef: 'src_chunk_audit_fk',
                  contentSha256: '3333333333333333333333333333333333333333333333333333333333333333',
                  path: 'db/billing/schema.sql',
                  startLine: 5,
                  endLine: 9,
                  sourceRefs: ['file:db/billing/schema.sql#L8'],
                  entrypointRefs: [],
                  symbolRefs: [],
                  domainEntityRefs: ['domain_refund_audit_notes', 'domain_refund_ledger_entries'],
                  graphEdgeRefs: [],
                  testRefs: [],
                  hotspotRefs: [],
                  capabilityRefs: ['cap_data_billing'],
                },
              ],
            },
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const domainSection = pack.sections.find((section) => section.id === 'inventory_domain_entities_billing_data');
    expect(domainSection?.content).toContain('refund_ledger_entries');
    expect(domainSection?.content).toContain('relationships=referenced_by:refund_audit_notes@file:db/billing/schema.sql#L8');
    expect(domainSection?.content).toContain('refund_audit_notes');
    expect(domainSection?.sourceRefs).toEqual(expect.arrayContaining([
      'artifact:art_inventory',
      'file:db/billing/schema.sql#L8',
    ]));

    const fkChunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_src_chunk_audit_fk');
    expect(fkChunk).toMatchObject({
      title: 'Source Chunk: db/billing/schema.sql:5-9',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining(['artifact:art_inventory', 'file:db/billing/schema.sql#L8']),
    });
    expect(fkChunk?.content).toContain('Pointed by inventory evidence: domain_refund_ledger_entries');
    expect(fkChunk?.content).toContain('table | domain_refund_audit_notes');
    expect(fkChunk?.content).toContain('FOREIGN KEY (ledger_entry_id) REFERENCES billing.refund_ledger_entries(id)');
    expect(JSON.stringify(pack.sections)).not.toContain('customer_profiles');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('uses static SQL join relationships for table-focused ContextPack retrieval', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Update refund_ledger_entries retention query behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_retention',
                kind: 'http_route',
                label: 'POST /billing/retention',
                path: 'apps/api/src/billing-route.ts',
                method: 'POST',
                route: '/billing/retention',
                handler: 'retainBillingLedger',
                sourceRefs: ['file:apps/api/src/billing-route.ts#L8'],
                confidence: 0.9,
              },
            ],
            symbols: [],
            domainEntities: [
              {
                id: 'domain_refund_ledger_entries',
                name: 'refund_ledger_entries',
                kind: 'table',
                path: 'db/billing/schema.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/schema.sql#L1'],
                relationships: [
                  {
                    kind: 'join',
                    direction: 'joins',
                    domainEntityRef: 'domain_refund_audit_notes',
                    name: 'refund_audit_notes',
                    sourceRefs: ['file:apps/api/src/billing-repository.ts#L5'],
                    confidence: 0.82,
                  },
                ],
                sourceChunkRefs: ['src_chunk_ledger_table', 'src_chunk_join_query'],
                confidence: 0.88,
              },
              {
                id: 'domain_refund_audit_notes',
                name: 'refund_audit_notes',
                kind: 'table',
                path: 'db/billing/schema.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/schema.sql#L5'],
                relationships: [
                  {
                    kind: 'join',
                    direction: 'joins',
                    domainEntityRef: 'domain_refund_ledger_entries',
                    name: 'refund_ledger_entries',
                    sourceRefs: ['file:apps/api/src/billing-repository.ts#L5'],
                    confidence: 0.82,
                  },
                ],
                sourceChunkRefs: ['src_chunk_join_query'],
                confidence: 0.88,
              },
              {
                id: 'domain_customer_profiles',
                name: 'customer_profiles',
                kind: 'table',
                path: 'db/customer/schema.sql',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                sourceChunkRefs: ['src_chunk_customer_table'],
                confidence: 0.88,
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_data_billing',
                label: 'Billing Data',
                kind: 'module',
                entrypointRefs: ['entry_billing_retention'],
                moduleRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_ledger_entries'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/billing-route.ts#L8', 'file:db/billing/schema.sql#L1'],
                confidence: 0.9,
                openQuestions: [],
              },
            ],
            sourceChunks: [
              {
                id: 'src_chunk_ledger_table',
                path: 'db/billing/schema.sql',
                language: 'sql',
                startLine: 1,
                endLine: 3,
                snippet: 'L1: CREATE TABLE billing.refund_ledger_entries (\\nL2:   id uuid PRIMARY KEY\\nL3: );',
                contentSha256: '1111111111111111111111111111111111111111111111111111111111111111',
                sourceRefs: ['file:db/billing/schema.sql#L1'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_ledger_entries'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: ['cap_data_billing'],
                sha256: '2222222222222222222222222222222222222222222222222222222222222222',
                confidence: 0.78,
              },
              {
                id: 'src_chunk_join_query',
                path: 'apps/api/src/billing-repository.ts',
                language: 'typescript',
                startLine: 1,
                endLine: 7,
                snippet: 'L1: export function loadRefundLedgerJoin() {\\nL2:   return `\\nL3:     SELECT r.id, n.note\\nL4:     FROM billing.refund_ledger_entries r\\nL5:     JOIN billing.refund_audit_notes n ON n.ledger_entry_id = r.id\\nL6:   `;\\nL7: }',
                contentSha256: '3333333333333333333333333333333333333333333333333333333333333333',
                sourceRefs: ['file:apps/api/src/billing-repository.ts#L4', 'file:apps/api/src/billing-repository.ts#L5'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_ledger_entries', 'domain_refund_audit_notes'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: ['cap_data_billing'],
                sha256: '4444444444444444444444444444444444444444444444444444444444444444',
                confidence: 0.78,
              },
              {
                id: 'src_chunk_customer_table',
                path: 'db/customer/schema.sql',
                language: 'sql',
                startLine: 1,
                endLine: 3,
                snippet: 'L1: CREATE TABLE customer_profiles (\\nL2:   id uuid PRIMARY KEY\\nL3: );',
                contentSha256: '5555555555555555555555555555555555555555555555555555555555555555',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_customer_profiles'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: [],
                sha256: '6666666666666666666666666666666666666666666666666666666666666666',
                confidence: 0.78,
              },
            ],
            sourceChunkIndex: {
              schemaVersion: 'ainp.source_chunk_index.v1',
              generatedAt: '2026-07-03T00:00:00.000Z',
              source: 'project_inventory.sourceChunks',
              chunkCount: 3,
              maxEntries: 120,
              entries: [
                {
                  id: 'idx_join_query',
                  sourceChunkRef: 'src_chunk_join_query',
                  contentSha256: '3333333333333333333333333333333333333333333333333333333333333333',
                  path: 'apps/api/src/billing-repository.ts',
                  startLine: 1,
                  endLine: 7,
                  sourceRefs: ['file:apps/api/src/billing-repository.ts#L5'],
                  entrypointRefs: [],
                  symbolRefs: [],
                  domainEntityRefs: ['domain_refund_ledger_entries', 'domain_refund_audit_notes'],
                  graphEdgeRefs: [],
                  testRefs: [],
                  hotspotRefs: [],
                  capabilityRefs: ['cap_data_billing'],
                },
              ],
            },
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const domainSection = pack.sections.find((section) => section.id === 'inventory_domain_entities_billing_data');
    expect(domainSection?.content).toContain('refund_ledger_entries');
    expect(domainSection?.content).toContain('relationships=joins:refund_audit_notes@file:apps/api/src/billing-repository.ts#L5');
    expect(domainSection?.content).toContain('table | refund_audit_notes | db/billing/schema.sql');
    expect(domainSection?.sourceRefs).toEqual(expect.arrayContaining([
      'artifact:art_inventory',
      'file:apps/api/src/billing-repository.ts#L5',
    ]));

    const joinChunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_src_chunk_join_query');
    expect(joinChunk).toMatchObject({
      title: 'Source Chunk: apps/api/src/billing-repository.ts:1-7',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining(['artifact:art_inventory', 'file:apps/api/src/billing-repository.ts#L5']),
    });
    expect(joinChunk?.content).toContain('Pointed by inventory evidence: domain_refund_ledger_entries, domain_refund_audit_notes');
    expect(joinChunk?.content).toContain('JOIN billing.refund_audit_notes');
    expect(JSON.stringify(pack.sections)).not.toContain('customer_profiles');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('uses static SQL view dependency relationships for view-focused ContextPack retrieval', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Update refund_retention_view calculation behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            domainEntities: [
              {
                id: 'domain_refund_retention_view',
                name: 'refund_retention_view',
                kind: 'view',
                path: 'db/billing/views.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/views.sql#L1'],
                relationships: [
                  {
                    kind: 'view_dependency',
                    direction: 'depends_on',
                    domainEntityRef: 'domain_refund_ledger_entries',
                    name: 'refund_ledger_entries',
                    sourceRefs: ['file:db/billing/views.sql#L3'],
                    confidence: 0.86,
                  },
                  {
                    kind: 'view_dependency',
                    direction: 'depends_on',
                    domainEntityRef: 'domain_refund_audit_notes',
                    name: 'refund_audit_notes',
                    sourceRefs: ['file:db/billing/views.sql#L4'],
                    confidence: 0.86,
                  },
                ],
                sourceChunkRefs: ['src_chunk_retention_view'],
                confidence: 0.84,
              },
              {
                id: 'domain_refund_ledger_entries',
                name: 'refund_ledger_entries',
                kind: 'table',
                path: 'db/billing/schema.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/schema.sql#L1'],
                relationships: [
                  {
                    kind: 'view_dependency',
                    direction: 'depended_on_by',
                    domainEntityRef: 'domain_refund_retention_view',
                    name: 'refund_retention_view',
                    sourceRefs: ['file:db/billing/views.sql#L3'],
                    confidence: 0.86,
                  },
                ],
                sourceChunkRefs: ['src_chunk_retention_view'],
                confidence: 0.88,
              },
              {
                id: 'domain_refund_audit_notes',
                name: 'refund_audit_notes',
                kind: 'table',
                path: 'db/billing/schema.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/schema.sql#L5'],
                relationships: [
                  {
                    kind: 'view_dependency',
                    direction: 'depended_on_by',
                    domainEntityRef: 'domain_refund_retention_view',
                    name: 'refund_retention_view',
                    sourceRefs: ['file:db/billing/views.sql#L4'],
                    confidence: 0.86,
                  },
                ],
                sourceChunkRefs: ['src_chunk_retention_view'],
                confidence: 0.88,
              },
              {
                id: 'domain_customer_profiles',
                name: 'customer_profiles',
                kind: 'table',
                path: 'db/customer/schema.sql',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                sourceChunkRefs: ['src_chunk_customer_table'],
                confidence: 0.88,
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_data_billing',
                label: 'Billing Data',
                kind: 'module',
                entrypointRefs: [],
                moduleRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_retention_view'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:db/billing/views.sql#L1'],
                confidence: 0.9,
                openQuestions: [],
              },
            ],
            sourceChunks: [
              {
                id: 'src_chunk_retention_view',
                path: 'db/billing/views.sql',
                language: 'sql',
                startLine: 1,
                endLine: 6,
                snippet: 'L1: CREATE VIEW billing.refund_retention_view AS\\nL2: SELECT r.id, n.note\\nL3: FROM billing.refund_ledger_entries r\\nL4: JOIN billing.refund_audit_notes n ON n.ledger_entry_id = r.id\\nL5: WHERE r.retained_at IS NULL\\nL6: ;',
                contentSha256: '7777777777777777777777777777777777777777777777777777777777777777',
                sourceRefs: ['file:db/billing/views.sql#L1', 'file:db/billing/views.sql#L3', 'file:db/billing/views.sql#L4'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_refund_retention_view', 'domain_refund_ledger_entries', 'domain_refund_audit_notes'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: ['cap_data_billing'],
                sha256: '8888888888888888888888888888888888888888888888888888888888888888',
                confidence: 0.78,
              },
              {
                id: 'src_chunk_customer_table',
                path: 'db/customer/schema.sql',
                language: 'sql',
                startLine: 1,
                endLine: 3,
                snippet: 'L1: CREATE TABLE customer_profiles (\\nL2:   id uuid PRIMARY KEY\\nL3: );',
                contentSha256: '9999999999999999999999999999999999999999999999999999999999999999',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_customer_profiles'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: [],
                sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                confidence: 0.78,
              },
            ],
            sourceChunkIndex: {
              schemaVersion: 'ainp.source_chunk_index.v1',
              generatedAt: '2026-07-03T00:00:00.000Z',
              source: 'project_inventory.sourceChunks',
              chunkCount: 2,
              maxEntries: 120,
              entries: [
                {
                  id: 'idx_retention_view',
                  sourceChunkRef: 'src_chunk_retention_view',
                  contentSha256: '7777777777777777777777777777777777777777777777777777777777777777',
                  path: 'db/billing/views.sql',
                  startLine: 1,
                  endLine: 6,
                  sourceRefs: ['file:db/billing/views.sql#L1', 'file:db/billing/views.sql#L3', 'file:db/billing/views.sql#L4'],
                  entrypointRefs: [],
                  symbolRefs: [],
                  domainEntityRefs: ['domain_refund_retention_view', 'domain_refund_ledger_entries', 'domain_refund_audit_notes'],
                  graphEdgeRefs: [],
                  testRefs: [],
                  hotspotRefs: [],
                  capabilityRefs: ['cap_data_billing'],
                },
              ],
            },
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const domainSection = pack.sections.find((section) => section.id === 'inventory_domain_entities_billing_data');
    expect(domainSection?.content).toContain('view | refund_retention_view | db/billing/views.sql');
    expect(domainSection?.content).toContain('relationships=depends_on:refund_ledger_entries@file:db/billing/views.sql#L3');
    expect(domainSection?.content).toContain('table | refund_ledger_entries | db/billing/schema.sql');
    expect(domainSection?.content).toContain('table | refund_audit_notes | db/billing/schema.sql');
    expect(domainSection?.sourceRefs).toEqual(expect.arrayContaining([
      'artifact:art_inventory',
      'file:db/billing/views.sql#L3',
      'file:db/billing/views.sql#L4',
    ]));

    const viewChunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_src_chunk_retention_view');
    expect(viewChunk).toMatchObject({
      title: 'Source Chunk: db/billing/views.sql:1-6',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining(['artifact:art_inventory', 'file:db/billing/views.sql#L4']),
    });
    expect(viewChunk?.content).toContain('Pointed by inventory evidence');
    expect(viewChunk?.content).toContain('domain_refund_retention_view');
    expect(viewChunk?.content).toContain('domain_refund_ledger_entries');
    expect(viewChunk?.content).toContain('JOIN billing.refund_audit_notes');
    expect(JSON.stringify(pack.sections)).not.toContain('customer_profiles');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('uses static SQL routine dependency relationships for routine-focused ContextPack retrieval', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Update apply_refund_retention routine behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            domainEntities: [
              {
                id: 'domain_apply_refund_retention',
                name: 'apply_refund_retention',
                kind: 'routine',
                path: 'db/billing/routines.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/routines.sql#L1'],
                relationships: [
                  {
                    kind: 'routine_dependency',
                    direction: 'depends_on',
                    domainEntityRef: 'domain_refund_ledger_entries',
                    name: 'refund_ledger_entries',
                    sourceRefs: ['file:db/billing/routines.sql#L5'],
                    confidence: 0.84,
                  },
                  {
                    kind: 'routine_dependency',
                    direction: 'depends_on',
                    domainEntityRef: 'domain_refund_audit_notes',
                    name: 'refund_audit_notes',
                    sourceRefs: ['file:db/billing/routines.sql#L10'],
                    confidence: 0.84,
                  },
                ],
                sourceChunkRefs: ['src_chunk_apply_refund_retention'],
                confidence: 0.82,
              },
              {
                id: 'domain_refund_ledger_entries',
                name: 'refund_ledger_entries',
                kind: 'table',
                path: 'db/billing/schema.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/schema.sql#L1'],
                relationships: [
                  {
                    kind: 'routine_dependency',
                    direction: 'depended_on_by',
                    domainEntityRef: 'domain_apply_refund_retention',
                    name: 'apply_refund_retention',
                    sourceRefs: ['file:db/billing/routines.sql#L5'],
                    confidence: 0.84,
                  },
                ],
                sourceChunkRefs: ['src_chunk_apply_refund_retention'],
                confidence: 0.88,
              },
              {
                id: 'domain_refund_audit_notes',
                name: 'refund_audit_notes',
                kind: 'table',
                path: 'db/billing/schema.sql',
                schemaName: 'billing',
                sourceRefs: ['file:db/billing/schema.sql#L5'],
                relationships: [
                  {
                    kind: 'routine_dependency',
                    direction: 'depended_on_by',
                    domainEntityRef: 'domain_apply_refund_retention',
                    name: 'apply_refund_retention',
                    sourceRefs: ['file:db/billing/routines.sql#L10'],
                    confidence: 0.84,
                  },
                ],
                sourceChunkRefs: ['src_chunk_apply_refund_retention'],
                confidence: 0.88,
              },
              {
                id: 'domain_customer_profiles',
                name: 'customer_profiles',
                kind: 'table',
                path: 'db/customer/schema.sql',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                sourceChunkRefs: ['src_chunk_customer_table'],
                confidence: 0.88,
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_billing_routines',
                label: 'Billing Routines',
                kind: 'module',
                entrypointRefs: [],
                moduleRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_apply_refund_retention'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:db/billing/routines.sql#L1'],
                confidence: 0.9,
                openQuestions: [],
              },
            ],
            sourceChunks: [
              {
                id: 'src_chunk_apply_refund_retention',
                path: 'db/billing/routines.sql',
                language: 'sql',
                startLine: 1,
                endLine: 12,
                snippet: 'L1: CREATE OR REPLACE PROCEDURE billing.apply_refund_retention()\\nL2: LANGUAGE plpgsql\\nL3: AS $$\\nL4: BEGIN\\nL5:   UPDATE billing.refund_ledger_entries\\nL6:   SET retained_at = now();\\nL7:   INSERT INTO billing.refund_audit_notes (ledger_entry_id, note)\\nL8:   SELECT r.id, note\\nL9:   FROM billing.refund_ledger_entries r\\nL10:   JOIN billing.refund_audit_notes n ON n.ledger_entry_id = r.id;\\nL11: END;\\nL12: $$;',
                contentSha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                sourceRefs: ['file:db/billing/routines.sql#L1', 'file:db/billing/routines.sql#L5', 'file:db/billing/routines.sql#L9', 'file:db/billing/routines.sql#L10'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_apply_refund_retention', 'domain_refund_ledger_entries', 'domain_refund_audit_notes'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: ['cap_billing_routines'],
                sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                confidence: 0.78,
              },
              {
                id: 'src_chunk_customer_table',
                path: 'db/customer/schema.sql',
                language: 'sql',
                startLine: 1,
                endLine: 3,
                snippet: 'L1: CREATE TABLE customer_profiles (\\nL2:   id uuid PRIMARY KEY\\nL3: );',
                contentSha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                sourceRefs: ['file:db/customer/schema.sql#L1'],
                entrypointRefs: [],
                symbolRefs: [],
                domainEntityRefs: ['domain_customer_profiles'],
                graphEdgeRefs: [],
                testRefs: [],
                hotspotRefs: [],
                capabilityRefs: [],
                sha256: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                confidence: 0.78,
              },
            ],
            sourceChunkIndex: {
              schemaVersion: 'ainp.source_chunk_index.v1',
              generatedAt: '2026-07-03T00:00:00.000Z',
              source: 'project_inventory.sourceChunks',
              chunkCount: 2,
              maxEntries: 120,
              entries: [
                {
                  id: 'idx_apply_refund_retention',
                  sourceChunkRef: 'src_chunk_apply_refund_retention',
                  contentSha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  path: 'db/billing/routines.sql',
                  startLine: 1,
                  endLine: 12,
                  sourceRefs: ['file:db/billing/routines.sql#L1', 'file:db/billing/routines.sql#L5', 'file:db/billing/routines.sql#L9', 'file:db/billing/routines.sql#L10'],
                  entrypointRefs: [],
                  symbolRefs: [],
                  domainEntityRefs: ['domain_apply_refund_retention', 'domain_refund_ledger_entries', 'domain_refund_audit_notes'],
                  graphEdgeRefs: [],
                  testRefs: [],
                  hotspotRefs: [],
                  capabilityRefs: ['cap_billing_routines'],
                },
              ],
            },
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const domainSection = pack.sections.find((section) => section.id === 'inventory_domain_entities_billing_routines');
    expect(domainSection?.content).toContain('routine | apply_refund_retention | db/billing/routines.sql');
    expect(domainSection?.content).toContain('relationships=depends_on:refund_ledger_entries@file:db/billing/routines.sql#L5');
    expect(domainSection?.content).toContain('table | refund_ledger_entries | db/billing/schema.sql');
    expect(domainSection?.content).toContain('table | refund_audit_notes | db/billing/schema.sql');
    expect(domainSection?.sourceRefs).toEqual(expect.arrayContaining([
      'artifact:art_inventory',
      'file:db/billing/routines.sql#L5',
      'file:db/billing/routines.sql#L10',
    ]));

    const routineChunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_src_chunk_apply_refund_retention');
    expect(routineChunk).toMatchObject({
      title: 'Source Chunk: db/billing/routines.sql:1-12',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining(['artifact:art_inventory', 'file:db/billing/routines.sql#L5']),
    });
    expect(routineChunk?.content).toContain('Pointed by inventory evidence');
    expect(routineChunk?.content).toContain('domain_apply_refund_retention');
    expect(routineChunk?.content).toContain('domain_refund_ledger_entries');
    expect(routineChunk?.content).toContain('UPDATE billing.refund_ledger_entries');
    expect(routineChunk?.content).toContain('INSERT INTO billing.refund_audit_notes');
    expect(JSON.stringify(pack.sections)).not.toContain('customer_profiles');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('narrows multi-entrypoint capability evidence using graph-reachable symbol text', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix customer profile endpoint behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_customers_show',
                kind: 'http_route',
                label: 'GET /api/v1/customers/{customer}',
                path: 'routes/web.php',
                method: 'GET',
                route: '/api/v1/customers/{customer}',
                handler: 'CustomerController@show',
                sourceRefs: ['file:routes/web.php#L3'],
                confidence: 0.9,
              },
              {
                id: 'entry_customers_index',
                kind: 'http_route',
                label: 'GET /api/v1/customers',
                path: 'routes/web.php',
                method: 'GET',
                route: '/api/v1/customers',
                handler: 'CustomerController@index',
                sourceRefs: ['file:routes/web.php#L4'],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_customer_show',
                kind: 'method',
                name: 'show',
                path: 'app/Http/Controllers/CustomerController.php',
                exported: false,
                line: 4,
                signature: 'CustomerController.show',
                sourceRefs: ['file:app/Http/Controllers/CustomerController.php#L4'],
              },
              {
                id: 'sym_customer_index',
                kind: 'method',
                name: 'index',
                path: 'app/Http/Controllers/CustomerController.php',
                exported: false,
                line: 9,
                signature: 'CustomerController.index',
                sourceRefs: ['file:app/Http/Controllers/CustomerController.php#L9'],
              },
              {
                id: 'sym_customer_load_profile',
                kind: 'method',
                name: 'loadProfile',
                path: 'app/Services/CustomerService.php',
                exported: false,
                line: 4,
                signature: 'CustomerService.loadProfile',
                sourceRefs: ['file:app/Services/CustomerService.php#L4'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_customers',
                label: 'Customers API',
                kind: 'api',
                entrypointRefs: ['entry_customers_show', 'entry_customers_index'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_show', 'sym_customer_index', 'sym_customer_load_profile'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:routes/web.php#L3', 'file:routes/web.php#L4'],
                confidence: 0.95,
                openQuestions: [],
              },
            ],
            symbolGraph: {
              parser: 'heuristic',
              nodes: [],
              edges: [
                {
                  id: 'edge_route_show',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_customers_show',
                  to: 'node_symbol_sym_customer_show',
                  label: 'route handler CustomerController@show',
                  sourceRefs: ['file:routes/web.php#L3', 'file:app/Http/Controllers/CustomerController.php#L4'],
                  confidence: 0.9,
                },
                {
                  id: 'edge_route_index',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_customers_index',
                  to: 'node_symbol_sym_customer_index',
                  label: 'route handler CustomerController@index',
                  sourceRefs: ['file:routes/web.php#L4', 'file:app/Http/Controllers/CustomerController.php#L9'],
                  confidence: 0.9,
                },
                {
                  id: 'edge_show_load_profile',
                  kind: 'symbol_reference',
                  from: 'node_symbol_sym_customer_show',
                  to: 'node_symbol_sym_customer_load_profile',
                  label: 'calls CustomerService.loadProfile',
                  sourceRefs: ['file:app/Http/Controllers/CustomerController.php#L5', 'file:app/Services/CustomerService.php#L4'],
                  confidence: 0.75,
                },
              ],
            },
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_customers');
    const capabilitySourceRefs = [...(capability?.sourceRefs ?? [])];
    expect(capability).toMatchObject({
      title: 'Capability Map: Customers API',
      sourceType: 'code_probe',
    });
    expect(capabilitySourceRefs).toEqual(expect.arrayContaining([
      'artifact:art_inventory',
      'file:routes/web.php#L3',
      'file:app/Services/CustomerService.php#L4',
    ]));
    expect(capabilitySourceRefs).not.toContain('file:routes/web.php#L4');
    expect(capabilitySourceRefs).not.toContain('file:app/Http/Controllers/CustomerController.php#L9');
    expect(capability?.content).toContain('GET /api/v1/customers/{customer}');
    expect(capability?.content).not.toContain('GET /api/v1/customers | handler=CustomerController@index');
    const symbols = pack.sections.find((section) => section.id === 'inventory_symbols_customers_api');
    expect(symbols?.content).toContain('loadProfile');
    expect(symbols?.content).not.toContain('CustomerController.index');
  });

  test('does not reintroduce sibling symbols after graph-focused multi-entrypoint narrowing', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing statement generation behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_invoice',
                kind: 'http_route',
                label: 'ANY /billing/invoices/reconcile.htm',
                path: 'WEB-INF/spring/billing-servlet.xml',
                method: 'ANY',
                route: '/billing/invoices/reconcile.htm',
                handler: 'BillingController#handleRequest',
                sourceRefs: ['file:WEB-INF/spring/billing-servlet.xml#L6'],
                confidence: 0.8,
              },
              {
                id: 'entry_billing_statement',
                kind: 'http_route',
                label: 'ANY /billing/statements.htm',
                path: 'WEB-INF/spring/billing-servlet.xml',
                method: 'ANY',
                route: '/billing/statements.htm',
                handler: 'StatementController#handleRequest',
                sourceRefs: ['file:WEB-INF/spring/billing-servlet.xml#L13'],
                confidence: 0.8,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_controller',
                kind: 'class',
                name: 'BillingController',
                path: 'src/main/java/BillingController.java',
                exported: false,
                line: 3,
                signature: 'public class BillingController',
                sourceRefs: ['file:src/main/java/BillingController.java#L3'],
              },
              {
                id: 'sym_billing_handle',
                kind: 'method',
                name: 'handleRequest',
                path: 'src/main/java/BillingController.java',
                exported: false,
                line: 6,
                signature: 'BillingController.handleRequest',
                sourceRefs: ['file:src/main/java/BillingController.java#L6'],
              },
              {
                id: 'sym_statement_controller',
                kind: 'class',
                name: 'StatementController',
                path: 'src/main/java/StatementController.java',
                exported: false,
                line: 3,
                signature: 'public class StatementController',
                sourceRefs: ['file:src/main/java/StatementController.java#L3'],
              },
              {
                id: 'sym_statement_handle',
                kind: 'method',
                name: 'handleRequest',
                path: 'src/main/java/StatementController.java',
                exported: false,
                line: 6,
                signature: 'StatementController.handleRequest',
                sourceRefs: ['file:src/main/java/StatementController.java#L6'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing',
                label: 'Billing API',
                kind: 'api',
                entrypointRefs: ['entry_billing_invoice', 'entry_billing_statement'],
                moduleRefs: [],
                symbolRefs: [
                  'sym_billing_controller',
                  'sym_billing_handle',
                  'sym_statement_controller',
                  'sym_statement_handle',
                ],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: [
                  'file:WEB-INF/spring/billing-servlet.xml#L6',
                  'file:WEB-INF/spring/billing-servlet.xml#L13',
                ],
                confidence: 0.8,
                openQuestions: [],
              },
            ],
            symbolGraph: {
              parser: 'heuristic',
              nodes: [],
              edges: [
                {
                  id: 'edge_invoice',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_billing_invoice',
                  to: 'node_symbol_sym_billing_handle',
                  label: 'route handler BillingController#handleRequest',
                  sourceRefs: [
                    'file:WEB-INF/spring/billing-servlet.xml#L6',
                    'file:src/main/java/BillingController.java#L6',
                  ],
                  confidence: 0.8,
                },
                {
                  id: 'edge_statement',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_billing_statement',
                  to: 'node_symbol_sym_statement_handle',
                  label: 'route handler StatementController#handleRequest',
                  sourceRefs: [
                    'file:WEB-INF/spring/billing-servlet.xml#L13',
                    'file:src/main/java/StatementController.java#L6',
                  ],
                  confidence: 0.8,
                },
              ],
            },
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_billing');
    const symbols = pack.sections.find((section) => section.id === 'inventory_symbols_billing_api');
    expect(capability?.content).toContain('ANY /billing/statements.htm');
    expect(capability?.content).not.toContain('ANY /billing/invoices/reconcile.htm');
    expect(symbols?.content).toContain('StatementController.handleRequest');
    expect(symbols?.content).not.toContain('BillingController');
    expect(symbols?.sourceRefs).not.toContain('file:src/main/java/BillingController.java#L3');
  });

  test('uses action words to focus same-capability Rails controller/action routes', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing refund update behavior in the legacy Rails controller action route.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_show_refund',
                kind: 'http_route',
                label: 'GET /api/v1/billing/refunds/:id',
                path: 'config/routes.rb',
                method: 'GET',
                route: '/api/v1/billing/refunds/:id',
                handler: 'BillingController#show_refund',
                sourceRefs: ['file:config/routes.rb#L3'],
                confidence: 0.9,
              },
              {
                id: 'entry_billing_update_refund',
                kind: 'http_route',
                label: 'PATCH /api/v1/billing/refunds/:id',
                path: 'config/routes.rb',
                method: 'PATCH',
                route: '/api/v1/billing/refunds/:id',
                handler: 'BillingController#update_refund',
                sourceRefs: ['file:config/routes.rb#L4'],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_controller',
                kind: 'class',
                name: 'BillingController',
                path: 'app/controllers/billing_controller.rb',
                exported: false,
                line: 1,
                signature: 'class BillingController < ApplicationController',
                sourceRefs: ['file:app/controllers/billing_controller.rb#L1'],
              },
              {
                id: 'sym_show_refund',
                kind: 'function',
                name: 'show_refund',
                path: 'app/controllers/billing_controller.rb',
                exported: false,
                line: 2,
                signature: 'def show_refund',
                sourceRefs: ['file:app/controllers/billing_controller.rb#L2'],
              },
              {
                id: 'sym_update_refund',
                kind: 'function',
                name: 'update_refund',
                path: 'app/controllers/billing_controller.rb',
                exported: false,
                line: 6,
                signature: 'def update_refund',
                sourceRefs: ['file:app/controllers/billing_controller.rb#L6'],
              },
              {
                id: 'sym_billing_refund_service',
                kind: 'class',
                name: 'BillingRefundService',
                path: 'app/services/billing_refund_service.rb',
                exported: false,
                line: 1,
                signature: 'class BillingRefundService',
                sourceRefs: ['file:app/services/billing_refund_service.rb#L1'],
              },
              {
                id: 'sym_billing_refund_service_update',
                kind: 'function',
                name: 'update_refund',
                path: 'app/services/billing_refund_service.rb',
                exported: false,
                line: 2,
                signature: 'def update_refund(refund_id, refund_params)',
                sourceRefs: ['file:app/services/billing_refund_service.rb#L2'],
              },
            ],
            testSurfaces: [
              {
                id: 'test_billing_refund',
                path: 'test/billing_refund_controller_action_test.rb',
                frameworkHint: 'ruby-test',
                targetHints: ['billing', 'refund', 'controller', 'action'],
                sourceRefs: ['file:test/billing_refund_controller_action_test.rb'],
              },
            ],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing',
                label: 'Billing API',
                kind: 'api',
                entrypointRefs: ['entry_billing_show_refund', 'entry_billing_update_refund'],
                moduleRefs: [],
                symbolRefs: [
                  'sym_billing_controller',
                  'sym_show_refund',
                  'sym_update_refund',
                  'sym_billing_refund_service',
                  'sym_billing_refund_service_update',
                ],
                testRefs: ['test_billing_refund'],
                hotspotRefs: [],
                sourceRefs: ['file:config/routes.rb#L3', 'file:config/routes.rb#L4'],
                confidence: 0.95,
                openQuestions: [],
              },
            ],
            symbolGraph: {
              parser: 'heuristic',
              nodes: [],
              edges: [
                {
                  id: 'edge_route_show',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_billing_show_refund',
                  to: 'node_symbol_sym_show_refund',
                  label: 'route handler BillingController#show_refund',
                  sourceRefs: ['file:config/routes.rb#L3', 'file:app/controllers/billing_controller.rb#L2'],
                  confidence: 0.9,
                },
                {
                  id: 'edge_route_update',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_billing_update_refund',
                  to: 'node_symbol_sym_update_refund',
                  label: 'route handler BillingController#update_refund',
                  sourceRefs: ['file:config/routes.rb#L4', 'file:app/controllers/billing_controller.rb#L6'],
                  confidence: 0.9,
                },
                {
                  id: 'edge_update_service',
                  kind: 'symbol_reference',
                  from: 'node_symbol_sym_update_refund',
                  to: 'node_symbol_sym_billing_refund_service_update',
                  label: 'calls BillingRefundService.update_refund',
                  sourceRefs: ['file:app/controllers/billing_controller.rb#L7', 'file:app/services/billing_refund_service.rb#L2'],
                  confidence: 0.75,
                },
              ],
            },
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_billing');
    const symbols = pack.sections.find((section) => section.id === 'inventory_symbols_billing_api');
    expect(capability?.content).toContain('PATCH /api/v1/billing/refunds/:id');
    expect(capability?.content).toContain('BillingController#update_refund');
    expect(capability?.content).not.toContain('GET /api/v1/billing/refunds/:id');
    expect(capability?.content).not.toContain('BillingController#show_refund');
    expect(capability?.sourceRefs).toEqual(expect.arrayContaining([
      'file:config/routes.rb#L4',
      'file:app/controllers/billing_controller.rb#L6',
      'file:app/services/billing_refund_service.rb#L2',
      'file:test/billing_refund_controller_action_test.rb',
    ]));
    expect(capability?.sourceRefs).not.toContain('file:config/routes.rb#L3');
    expect(capability?.sourceRefs).not.toContain('file:app/controllers/billing_controller.rb#L2');
    expect(symbols?.content).toContain('update_refund');
    expect(symbols?.content).not.toContain('show_refund');
    expect(symbols?.sourceRefs).not.toContain('file:config/routes.rb#L3');
  });

  test('uses delete action words to focus same-capability Rails controller/action routes', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing refund delete behavior in the legacy Rails controller action route.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify(legacyBillingRefundActionInventoryFixture()),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_billing');
    const symbols = pack.sections.find((section) => section.id === 'inventory_symbols_billing_refund_api');

    expect(sectionIds).toContain('inventory_capability_cap_api_billing');
    expect(sectionIds).not.toContain('inventory_capability_cap_api_customers');
    expect(capability?.content).toContain('DELETE /api/v1/billing/refunds/:id');
    expect(capability?.content).toContain('BillingController#destroy_refund');
    expect(capability?.content).not.toContain('GET /api/v1/billing/refunds/:id');
    expect(capability?.content).not.toContain('BillingController#show_refund');
    expect(capability?.sourceRefs).toEqual(expect.arrayContaining([
      'file:config/routes.rb#L5',
      'file:app/controllers/billing_controller.rb#L12',
      'file:app/services/billing_refund_service.rb#L2',
      'file:test/billing_refund_controller_action_test.rb',
    ]));
    expect(capability?.sourceRefs).not.toContain('file:config/routes.rb#L3');
    expect(capability?.sourceRefs).not.toContain('file:app/controllers/billing_controller.rb#L2');
    expect(symbols?.content).toContain('destroy_refund');
    expect(symbols?.content).not.toContain('show_refund');
    expect(symbols?.sourceRefs).not.toContain('file:config/routes.rb#L3');
  });

  test('does not select capabilities globally from action focus tokens alone', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Delete the legacy route action.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify(legacyBillingRefundActionInventoryFixture()),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    expect(sectionIds).not.toContain('inventory_capability_cap_api_billing');
    expect(sectionIds).not.toContain('inventory_capability_cap_api_customers');
    expect(JSON.stringify(pack.sections)).not.toContain('Billing Refund API');
    expect(JSON.stringify(pack.sections)).not.toContain('Customer Account API');
  });

  test('does not select capabilities globally from inflected action focus tokens alone', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Deleting the legacy route action.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify(legacyBillingRefundActionInventoryFixture()),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    expect(sectionIds).not.toContain('inventory_capability_cap_api_billing');
    expect(sectionIds).not.toContain('inventory_capability_cap_api_customers');
    expect(JSON.stringify(pack.sections)).not.toContain('BillingController#destroy_refund');
    expect(JSON.stringify(pack.sections)).not.toContain('CustomersController#destroy');
  });

  test('does not select capabilities solely from encoded inventory ids', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_secret_billing',
                label: 'Finance API',
                kind: 'api',
                entrypointRefs: [],
                moduleRefs: [],
                symbolRefs: [],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/finance.ts#L1'],
                confidence: 0.95,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_secret_billing');
    expect(JSON.stringify(pack.sections)).not.toContain('Finance API');
  });

  test('does not select unrelated controller capabilities from framework-layer task terms', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation in the legacy Spring controller.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'POST /api/v1/billing/invoices/{invoiceId}/reconcile',
                path: 'src/main/java/BillingController.java',
                method: 'POST',
                route: '/api/v1/billing/invoices/{invoiceId}/reconcile',
                handler: 'reconcileInvoice',
                sourceRefs: ['file:src/main/java/BillingController.java#L8'],
                confidence: 0.9,
              },
              {
                id: 'entry_customer_show',
                kind: 'http_route',
                label: 'GET /api/v1/customers/{customerId}',
                path: 'src/main/java/CustomerController.java',
                method: 'GET',
                route: '/api/v1/customers/{customerId}',
                handler: 'showCustomer',
                sourceRefs: ['file:src/main/java/CustomerController.java#L6'],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_controller',
                kind: 'class',
                name: 'BillingController',
                path: 'src/main/java/BillingController.java',
                exported: false,
                line: 5,
                signature: 'public class BillingController',
                sourceRefs: ['file:src/main/java/BillingController.java#L5'],
              },
              {
                id: 'sym_reconcile_invoice',
                kind: 'method',
                name: 'reconcileInvoice',
                path: 'src/main/java/BillingController.java',
                exported: false,
                line: 9,
                signature: 'public ResponseEntity<?> reconcileInvoice(String invoiceId)',
                sourceRefs: ['file:src/main/java/BillingController.java#L9'],
              },
              {
                id: 'sym_customer_controller',
                kind: 'class',
                name: 'CustomerController',
                path: 'src/main/java/CustomerController.java',
                exported: false,
                line: 5,
                signature: 'public class CustomerController',
                sourceRefs: ['file:src/main/java/CustomerController.java#L5'],
              },
              {
                id: 'sym_show_customer',
                kind: 'method',
                name: 'showCustomer',
                path: 'src/main/java/CustomerController.java',
                exported: false,
                line: 7,
                signature: 'public ResponseEntity<?> showCustomer(String customerId)',
                sourceRefs: ['file:src/main/java/CustomerController.java#L7'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing',
                label: 'Billing API',
                kind: 'api',
                entrypointRefs: ['entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_controller', 'sym_reconcile_invoice'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/java/BillingController.java#L8'],
                confidence: 0.95,
                openQuestions: [],
              },
              {
                id: 'cap_api_customers',
                label: 'Customers API',
                kind: 'api',
                entrypointRefs: ['entry_customer_show'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_controller', 'sym_show_customer'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/java/CustomerController.java#L6'],
                confidence: 0.95,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).toContain('inventory_capability_cap_api_billing');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_customers');
    expect(JSON.stringify(pack.sections)).not.toContain('Customers API');
  });

  test('does not select unrelated polyglot capabilities from framework-language task terms', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation in the legacy Rails controller.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'POST /billing/reconciliation',
                path: 'app/controllers/billing_controller.rb',
                method: 'POST',
                route: '/billing/reconciliation',
                handler: 'BillingController#reconcile',
                sourceRefs: ['file:app/controllers/billing_controller.rb#L8'],
                confidence: 0.9,
              },
              {
                id: 'entry_customer_profile',
                kind: 'http_route',
                label: 'GET /customers/profile',
                path: 'app/controllers/customer_controller.rb',
                method: 'GET',
                route: '/customers/profile',
                handler: 'CustomerController#show',
                sourceRefs: ['file:app/controllers/customer_controller.rb#L6'],
                confidence: 0.9,
              },
            ],
            symbols: [],
            testSurfaces: [
              {
                id: 'test_billing_rails',
                path: 'spec/controllers/billing_controller_spec.rb',
                frameworkHint: 'rails',
                targetHints: ['billing', 'reconciliation'],
                sourceRefs: ['file:spec/controllers/billing_controller_spec.rb'],
              },
              {
                id: 'test_customer_rails',
                path: 'spec/controllers/customer_controller_spec.rb',
                frameworkHint: 'rails',
                targetHints: ['customers', 'profile'],
                sourceRefs: ['file:spec/controllers/customer_controller_spec.rb'],
              },
            ],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing',
                label: 'Billing API',
                kind: 'api',
                entrypointRefs: ['entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: [],
                testRefs: ['test_billing_rails'],
                hotspotRefs: [],
                sourceRefs: ['file:app/controllers/billing_controller.rb#L8'],
                confidence: 0.9,
                openQuestions: [],
              },
              {
                id: 'cap_api_customers',
                label: 'Customers API',
                kind: 'api',
                entrypointRefs: ['entry_customer_profile'],
                moduleRefs: [],
                symbolRefs: [],
                testRefs: ['test_customer_rails'],
                hotspotRefs: [],
                sourceRefs: ['file:app/controllers/customer_controller.rb#L6'],
                confidence: 0.9,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).toContain('inventory_capability_cap_api_billing');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_customers');
    expect(JSON.stringify(pack.sections)).not.toContain('Customers API');
  });

  test('does not select unrelated Spring XML MVC capabilities from framework-layer task terms', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation in the legacy Spring XML MVC mapping.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'ANY /billing/invoices/reconcile.htm',
                path: 'src/main/webapp/WEB-INF/spring/billing-servlet.xml',
                method: 'ANY',
                route: '/billing/invoices/reconcile.htm',
                handler: 'BillingController#handleRequest',
                sourceRefs: ['file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L6'],
                confidence: 0.8,
              },
              {
                id: 'entry_customer_profile',
                kind: 'http_route',
                label: 'ANY /customers/profile.htm',
                path: 'src/main/webapp/WEB-INF/spring/billing-servlet.xml',
                method: 'ANY',
                route: '/customers/profile.htm',
                handler: 'CustomerController#handleRequest',
                sourceRefs: ['file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L7'],
                confidence: 0.8,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_controller',
                kind: 'class',
                name: 'BillingController',
                path: 'src/main/java/BillingController.java',
                exported: false,
                line: 3,
                signature: 'public class BillingController',
                sourceRefs: ['file:src/main/java/BillingController.java#L3'],
              },
              {
                id: 'sym_billing_handle',
                kind: 'method',
                name: 'handleRequest',
                path: 'src/main/java/BillingController.java',
                exported: false,
                line: 6,
                signature: 'public ModelAndView handleRequest(...)',
                sourceRefs: ['file:src/main/java/BillingController.java#L6'],
              },
              {
                id: 'sym_customer_controller',
                kind: 'class',
                name: 'CustomerController',
                path: 'src/main/java/CustomerController.java',
                exported: false,
                line: 3,
                signature: 'public class CustomerController',
                sourceRefs: ['file:src/main/java/CustomerController.java#L3'],
              },
              {
                id: 'sym_customer_handle',
                kind: 'method',
                name: 'handleRequest',
                path: 'src/main/java/CustomerController.java',
                exported: false,
                line: 4,
                signature: 'public ModelAndView handleRequest(...)',
                sourceRefs: ['file:src/main/java/CustomerController.java#L4'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing',
                label: 'Billing API',
                kind: 'api',
                entrypointRefs: ['entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_controller', 'sym_billing_handle'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L6'],
                confidence: 0.8,
                openQuestions: [],
              },
              {
                id: 'cap_api_customers',
                label: 'Customers API',
                kind: 'api',
                entrypointRefs: ['entry_customer_profile'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_controller', 'sym_customer_handle'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L7'],
                confidence: 0.8,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).toContain('inventory_capability_cap_api_billing');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_customers');
    expect(JSON.stringify(pack.sections)).not.toContain('Customers API');
  });

  test('does not select unrelated JAX-RS resource capabilities from framework-layer task terms', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation in the legacy JAX-RS resource.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'POST /api/v1/billing/invoices/{invoiceId}/reconcile',
                path: 'src/main/java/BillingResource.java',
                method: 'POST',
                route: '/api/v1/billing/invoices/{invoiceId}/reconcile',
                handler: 'reconcileInvoice',
                sourceRefs: ['file:src/main/java/BillingResource.java#L8'],
                confidence: 0.9,
              },
              {
                id: 'entry_customer_show',
                kind: 'http_route',
                label: 'GET /api/v1/customers/{customerId}',
                path: 'src/main/java/CustomerResource.java',
                method: 'GET',
                route: '/api/v1/customers/{customerId}',
                handler: 'showCustomer',
                sourceRefs: ['file:src/main/java/CustomerResource.java#L6'],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_resource',
                kind: 'class',
                name: 'BillingResource',
                path: 'src/main/java/BillingResource.java',
                exported: false,
                line: 5,
                signature: 'public class BillingResource',
                sourceRefs: ['file:src/main/java/BillingResource.java#L5'],
              },
              {
                id: 'sym_reconcile_invoice',
                kind: 'method',
                name: 'reconcileInvoice',
                path: 'src/main/java/BillingResource.java',
                exported: false,
                line: 9,
                signature: 'public Response reconcileInvoice(String invoiceId)',
                sourceRefs: ['file:src/main/java/BillingResource.java#L9'],
              },
              {
                id: 'sym_customer_resource',
                kind: 'class',
                name: 'CustomerResource',
                path: 'src/main/java/CustomerResource.java',
                exported: false,
                line: 5,
                signature: 'public class CustomerResource',
                sourceRefs: ['file:src/main/java/CustomerResource.java#L5'],
              },
              {
                id: 'sym_show_customer',
                kind: 'method',
                name: 'showCustomer',
                path: 'src/main/java/CustomerResource.java',
                exported: false,
                line: 7,
                signature: 'public Response showCustomer(String customerId)',
                sourceRefs: ['file:src/main/java/CustomerResource.java#L7'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing',
                label: 'Billing API',
                kind: 'api',
                entrypointRefs: ['entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_resource', 'sym_reconcile_invoice'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/java/BillingResource.java#L8'],
                confidence: 0.95,
                openQuestions: [],
              },
              {
                id: 'cap_api_customers',
                label: 'Customers API',
                kind: 'api',
                entrypointRefs: ['entry_customer_show'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_resource', 'sym_show_customer'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/java/CustomerResource.java#L6'],
                confidence: 0.95,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).toContain('inventory_capability_cap_api_billing');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_customers');
    expect(JSON.stringify(pack.sections)).not.toContain('Customers API');
  });

  test('does not select unrelated JAX-WS SOAP service capabilities from framework-layer task terms', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation in the legacy SOAP web service.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'ANY /soap/billing_statement_service/reconcile_invoice',
                path: 'src/main/java/BillingStatementService.java',
                method: 'ANY',
                route: '/soap/billing_statement_service/reconcile_invoice',
                handler: 'BillingStatementService#reconcileInvoice',
                sourceRefs: ['file:src/main/java/BillingStatementService.java#L9'],
                confidence: 0.84,
              },
              {
                id: 'entry_customer_profile',
                kind: 'http_route',
                label: 'ANY /soap/customer_profile_service/load_profile',
                path: 'src/main/java/CustomerProfileService.java',
                method: 'ANY',
                route: '/soap/customer_profile_service/load_profile',
                handler: 'CustomerProfileService#loadProfile',
                sourceRefs: ['file:src/main/java/CustomerProfileService.java#L7'],
                confidence: 0.84,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_service',
                kind: 'class',
                name: 'BillingStatementService',
                path: 'src/main/java/BillingStatementService.java',
                exported: false,
                line: 6,
                signature: 'public class BillingStatementService',
                sourceRefs: ['file:src/main/java/BillingStatementService.java#L6'],
              },
              {
                id: 'sym_reconcile_invoice',
                kind: 'method',
                name: 'reconcileInvoice',
                path: 'src/main/java/BillingStatementService.java',
                exported: false,
                line: 10,
                signature: 'public String reconcileInvoice(String invoiceId)',
                sourceRefs: ['file:src/main/java/BillingStatementService.java#L10'],
              },
              {
                id: 'sym_customer_service',
                kind: 'class',
                name: 'CustomerProfileService',
                path: 'src/main/java/CustomerProfileService.java',
                exported: false,
                line: 6,
                signature: 'public class CustomerProfileService',
                sourceRefs: ['file:src/main/java/CustomerProfileService.java#L6'],
              },
              {
                id: 'sym_load_profile',
                kind: 'method',
                name: 'loadProfile',
                path: 'src/main/java/CustomerProfileService.java',
                exported: false,
                line: 8,
                signature: 'public String loadProfile(String customerId)',
                sourceRefs: ['file:src/main/java/CustomerProfileService.java#L8'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing_statement_service',
                label: 'Billing Statement Service API',
                kind: 'api',
                entrypointRefs: ['entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_service', 'sym_reconcile_invoice'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/java/BillingStatementService.java#L9'],
                confidence: 0.84,
                openQuestions: [],
              },
              {
                id: 'cap_api_customer_profile_service',
                label: 'Customer Profile Service API',
                kind: 'api',
                entrypointRefs: ['entry_customer_profile'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_service', 'sym_load_profile'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/java/CustomerProfileService.java#L7'],
                confidence: 0.84,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).toContain('inventory_capability_cap_api_billing_statement_service');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_customer_profile_service');
    expect(JSON.stringify(pack.sections)).not.toContain('Customer Profile Service API');
  });

  test('does not select unrelated WCF service contract capabilities from framework-layer task terms', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation in the legacy WCF service contract.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'ANY /wcf/billing_statement_contract/reconcile_invoice',
                path: 'src/Legacy/Billing/IBillingStatementContract.cs',
                method: 'ANY',
                route: '/wcf/billing_statement_contract/reconcile_invoice',
                handler: 'BillingStatementService#ReconcileInvoice',
                sourceRefs: ['file:src/Legacy/Billing/IBillingStatementContract.cs#L8'],
                confidence: 0.82,
              },
              {
                id: 'entry_customer_profile',
                kind: 'http_route',
                label: 'ANY /wcf/customer_profile_contract/load_profile',
                path: 'src/Legacy/Customers/ICustomerProfileContract.cs',
                method: 'ANY',
                route: '/wcf/customer_profile_contract/load_profile',
                handler: 'CustomerProfileService#LoadProfile',
                sourceRefs: ['file:src/Legacy/Customers/ICustomerProfileContract.cs#L8'],
                confidence: 0.82,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_service',
                kind: 'class',
                name: 'BillingStatementService',
                path: 'src/Legacy/Billing/BillingStatementService.cs',
                exported: false,
                line: 3,
                signature: 'public class BillingStatementService : IBillingStatementContract',
                sourceRefs: ['file:src/Legacy/Billing/BillingStatementService.cs#L3'],
              },
              {
                id: 'sym_reconcile_invoice',
                kind: 'method',
                name: 'ReconcileInvoice',
                path: 'src/Legacy/Billing/BillingStatementService.cs',
                exported: false,
                line: 7,
                signature: 'public string ReconcileInvoice(string invoiceId)',
                sourceRefs: ['file:src/Legacy/Billing/BillingStatementService.cs#L7'],
              },
              {
                id: 'sym_customer_service',
                kind: 'class',
                name: 'CustomerProfileService',
                path: 'src/Legacy/Customers/CustomerProfileService.cs',
                exported: false,
                line: 3,
                signature: 'public class CustomerProfileService : ICustomerProfileContract',
                sourceRefs: ['file:src/Legacy/Customers/CustomerProfileService.cs#L3'],
              },
              {
                id: 'sym_load_profile',
                kind: 'method',
                name: 'LoadProfile',
                path: 'src/Legacy/Customers/CustomerProfileService.cs',
                exported: false,
                line: 5,
                signature: 'public string LoadProfile(string customerId)',
                sourceRefs: ['file:src/Legacy/Customers/CustomerProfileService.cs#L5'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing_statement_contract',
                label: 'Billing Statement Contract API',
                kind: 'api',
                entrypointRefs: ['entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_service', 'sym_reconcile_invoice'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/Legacy/Billing/IBillingStatementContract.cs#L8'],
                confidence: 0.82,
                openQuestions: [],
              },
              {
                id: 'cap_api_customer_profile_contract',
                label: 'Customer Profile Contract API',
                kind: 'api',
                entrypointRefs: ['entry_customer_profile'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_service', 'sym_load_profile'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/Legacy/Customers/ICustomerProfileContract.cs#L8'],
                confidence: 0.82,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).toContain('inventory_capability_cap_api_billing_statement_contract');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_customer_profile_contract');
    expect(JSON.stringify(pack.sections)).not.toContain('Customer Profile Contract API');
  });

  test('keeps requested WCF .svc host entrypoint inside focused capability evidence', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing invoice reconciliation in the legacy WCF .svc service host.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_host',
                kind: 'http_route',
                label: 'ANY /Services/BillingStatementService.svc',
                path: 'Services/BillingStatementService.svc',
                method: 'ANY',
                route: '/Services/BillingStatementService.svc',
                handler: 'WCF:BillingStatementService',
                sourceRefs: ['file:Services/BillingStatementService.svc#L1'],
                confidence: 0.78,
              },
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'ANY /wcf/billing_statement_service/reconcile_invoice',
                path: 'src/Legacy/Billing/IBillingStatementContract.cs',
                method: 'ANY',
                route: '/wcf/billing_statement_service/reconcile_invoice',
                handler: 'BillingStatementService#ReconcileInvoice',
                sourceRefs: ['file:src/Legacy/Billing/IBillingStatementContract.cs#L8'],
                confidence: 0.82,
              },
              {
                id: 'entry_customer_host',
                kind: 'http_route',
                label: 'ANY /Services/CustomerProfileService.svc',
                path: 'Services/CustomerProfileService.svc',
                method: 'ANY',
                route: '/Services/CustomerProfileService.svc',
                handler: 'WCF:CustomerProfileService',
                sourceRefs: ['file:Services/CustomerProfileService.svc#L1'],
                confidence: 0.78,
              },
              {
                id: 'entry_customer_profile',
                kind: 'http_route',
                label: 'ANY /wcf/customer_profile_service/load_profile',
                path: 'src/Legacy/Customers/ICustomerProfileContract.cs',
                method: 'ANY',
                route: '/wcf/customer_profile_service/load_profile',
                handler: 'CustomerProfileService#LoadProfile',
                sourceRefs: ['file:src/Legacy/Customers/ICustomerProfileContract.cs#L8'],
                confidence: 0.82,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_service',
                kind: 'class',
                name: 'BillingStatementService',
                path: 'src/Legacy/Billing/BillingStatementService.cs',
                exported: false,
                line: 3,
                signature: 'public class BillingStatementService : IBillingStatementContract',
                sourceRefs: ['file:src/Legacy/Billing/BillingStatementService.cs#L3'],
              },
              {
                id: 'sym_reconcile_invoice',
                kind: 'method',
                name: 'ReconcileInvoice',
                path: 'src/Legacy/Billing/BillingStatementService.cs',
                exported: false,
                line: 7,
                signature: 'public string ReconcileInvoice(string invoiceId)',
                sourceRefs: ['file:src/Legacy/Billing/BillingStatementService.cs#L7'],
              },
              {
                id: 'sym_customer_service',
                kind: 'class',
                name: 'CustomerProfileService',
                path: 'src/Legacy/Customers/CustomerProfileService.cs',
                exported: false,
                line: 3,
                signature: 'public class CustomerProfileService : ICustomerProfileContract',
                sourceRefs: ['file:src/Legacy/Customers/CustomerProfileService.cs#L3'],
              },
              {
                id: 'sym_load_profile',
                kind: 'method',
                name: 'LoadProfile',
                path: 'src/Legacy/Customers/CustomerProfileService.cs',
                exported: false,
                line: 5,
                signature: 'public string LoadProfile(string customerId)',
                sourceRefs: ['file:src/Legacy/Customers/CustomerProfileService.cs#L5'],
              },
            ],
            symbolGraph: {
              parser: 'heuristic',
              nodes: [],
              edges: [
                {
                  id: 'edge_billing_host',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_billing_host',
                  to: 'node_symbol_sym_billing_service',
                  label: 'route handler WCF:BillingStatementService',
                  sourceRefs: [
                    'file:Services/BillingStatementService.svc#L1',
                    'file:src/Legacy/Billing/BillingStatementService.cs#L3',
                  ],
                  confidence: 0.78,
                },
                {
                  id: 'edge_billing_reconcile',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_billing_reconcile',
                  to: 'node_symbol_sym_reconcile_invoice',
                  label: 'route handler BillingStatementService#ReconcileInvoice',
                  sourceRefs: [
                    'file:src/Legacy/Billing/IBillingStatementContract.cs#L8',
                    'file:src/Legacy/Billing/BillingStatementService.cs#L7',
                  ],
                  confidence: 0.82,
                },
                {
                  id: 'edge_customer_host',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_customer_host',
                  to: 'node_symbol_sym_customer_service',
                  label: 'route handler WCF:CustomerProfileService',
                  sourceRefs: [
                    'file:Services/CustomerProfileService.svc#L1',
                    'file:src/Legacy/Customers/CustomerProfileService.cs#L3',
                  ],
                  confidence: 0.78,
                },
              ],
            },
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing_statement_service',
                label: 'Billing Statement Service API',
                kind: 'api',
                entrypointRefs: ['entry_billing_host', 'entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_service', 'sym_reconcile_invoice'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: [
                  'file:Services/BillingStatementService.svc#L1',
                  'file:src/Legacy/Billing/IBillingStatementContract.cs#L8',
                ],
                confidence: 0.95,
                openQuestions: [],
              },
              {
                id: 'cap_api_customer_profile_service',
                label: 'Customer Profile Service API',
                kind: 'api',
                entrypointRefs: ['entry_customer_host', 'entry_customer_profile'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_service', 'sym_load_profile'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: [
                  'file:Services/CustomerProfileService.svc#L1',
                  'file:src/Legacy/Customers/ICustomerProfileContract.cs#L8',
                ],
                confidence: 0.95,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_billing_statement_service');
    expect(capability?.content).toContain('ANY /Services/BillingStatementService.svc');
    expect(capability?.content).toContain('ANY /wcf/billing_statement_service/reconcile_invoice');
    expect(capability?.content).not.toContain('ANY /Services/CustomerProfileService.svc');
    expect(capability?.sourceRefs).toEqual(expect.arrayContaining([
      'file:Services/BillingStatementService.svc#L1',
      'file:src/Legacy/Billing/IBillingStatementContract.cs#L8',
    ]));
    expect(capability?.sourceRefs).not.toContain('file:Services/CustomerProfileService.svc#L1');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_customer_profile_service');
  });

  test('does not select unrelated ASMX WebService capabilities from framework-layer task terms', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation in the legacy ASMX web service.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'ANY /asmx/billing_statement_service/reconcile_invoice',
                path: 'src/Legacy/Billing/BillingStatementService.cs',
                method: 'ANY',
                route: '/asmx/billing_statement_service/reconcile_invoice',
                handler: 'BillingStatementService#ReconcileInvoice',
                sourceRefs: ['file:src/Legacy/Billing/BillingStatementService.cs#L10'],
                confidence: 0.82,
              },
              {
                id: 'entry_customer_profile',
                kind: 'http_route',
                label: 'ANY /asmx/customer_profile_service/load_profile',
                path: 'src/Legacy/Customers/CustomerProfileService.cs',
                method: 'ANY',
                route: '/asmx/customer_profile_service/load_profile',
                handler: 'CustomerProfileService#LoadProfile',
                sourceRefs: ['file:src/Legacy/Customers/CustomerProfileService.cs#L8'],
                confidence: 0.82,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_service',
                kind: 'class',
                name: 'BillingStatementService',
                path: 'src/Legacy/Billing/BillingStatementService.cs',
                exported: false,
                line: 6,
                signature: 'public class BillingStatementService : WebService',
                sourceRefs: ['file:src/Legacy/Billing/BillingStatementService.cs#L6'],
              },
              {
                id: 'sym_reconcile_invoice',
                kind: 'method',
                name: 'ReconcileInvoice',
                path: 'src/Legacy/Billing/BillingStatementService.cs',
                exported: false,
                line: 11,
                signature: 'public string ReconcileInvoice(string invoiceId)',
                sourceRefs: ['file:src/Legacy/Billing/BillingStatementService.cs#L11'],
              },
              {
                id: 'sym_customer_service',
                kind: 'class',
                name: 'CustomerProfileService',
                path: 'src/Legacy/Customers/CustomerProfileService.cs',
                exported: false,
                line: 6,
                signature: 'public class CustomerProfileService : WebService',
                sourceRefs: ['file:src/Legacy/Customers/CustomerProfileService.cs#L6'],
              },
              {
                id: 'sym_load_profile',
                kind: 'method',
                name: 'LoadProfile',
                path: 'src/Legacy/Customers/CustomerProfileService.cs',
                exported: false,
                line: 9,
                signature: 'public string LoadProfile(string customerId)',
                sourceRefs: ['file:src/Legacy/Customers/CustomerProfileService.cs#L9'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing_statement_service',
                label: 'Billing Statement Service API',
                kind: 'api',
                entrypointRefs: ['entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_service', 'sym_reconcile_invoice'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/Legacy/Billing/BillingStatementService.cs#L10'],
                confidence: 0.82,
                openQuestions: [],
              },
              {
                id: 'cap_api_customer_profile_service',
                label: 'Customer Profile Service API',
                kind: 'api',
                entrypointRefs: ['entry_customer_profile'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_service', 'sym_load_profile'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/Legacy/Customers/CustomerProfileService.cs#L8'],
                confidence: 0.82,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).toContain('inventory_capability_cap_api_billing_statement_service');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_customer_profile_service');
    expect(JSON.stringify(pack.sections)).not.toContain('Customer Profile Service API');
  });

  test('does not select unrelated Struts action capabilities from framework-layer task terms', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation in the legacy Struts action.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'ANY /api/v1/billing/invoices/reconcile',
                path: 'src/main/resources/struts.xml',
                method: 'ANY',
                route: '/api/v1/billing/invoices/reconcile',
                handler: 'ReconcileInvoiceAction#execute',
                sourceRefs: ['file:src/main/resources/struts.xml#L4'],
                confidence: 0.82,
              },
              {
                id: 'entry_customer_show',
                kind: 'http_route',
                label: 'ANY /api/v1/customers/profile',
                path: 'src/main/webapp/WEB-INF/struts-config.xml',
                method: 'ANY',
                route: '/api/v1/customers/profile',
                handler: 'CustomerProfileAction#execute',
                sourceRefs: ['file:src/main/webapp/WEB-INF/struts-config.xml#L3'],
                confidence: 0.82,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_action',
                kind: 'class',
                name: 'ReconcileInvoiceAction',
                path: 'src/main/java/ReconcileInvoiceAction.java',
                exported: false,
                line: 3,
                signature: 'public class ReconcileInvoiceAction extends ActionSupport',
                sourceRefs: ['file:src/main/java/ReconcileInvoiceAction.java#L3'],
              },
              {
                id: 'sym_reconcile_execute',
                kind: 'method',
                name: 'execute',
                path: 'src/main/java/ReconcileInvoiceAction.java',
                exported: false,
                line: 6,
                signature: 'public String execute()',
                sourceRefs: ['file:src/main/java/ReconcileInvoiceAction.java#L6'],
              },
              {
                id: 'sym_customer_action',
                kind: 'class',
                name: 'CustomerProfileAction',
                path: 'src/main/java/CustomerProfileAction.java',
                exported: false,
                line: 3,
                signature: 'public class CustomerProfileAction extends Action',
                sourceRefs: ['file:src/main/java/CustomerProfileAction.java#L3'],
              },
              {
                id: 'sym_customer_execute',
                kind: 'method',
                name: 'execute',
                path: 'src/main/java/CustomerProfileAction.java',
                exported: false,
                line: 4,
                signature: 'public ActionForward execute()',
                sourceRefs: ['file:src/main/java/CustomerProfileAction.java#L4'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing',
                label: 'Billing API',
                kind: 'api',
                entrypointRefs: ['entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_action', 'sym_reconcile_execute'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/resources/struts.xml#L4'],
                confidence: 0.82,
                openQuestions: [],
              },
              {
                id: 'cap_api_customers',
                label: 'Customers API',
                kind: 'api',
                entrypointRefs: ['entry_customer_show'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_action', 'sym_customer_execute'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/webapp/WEB-INF/struts-config.xml#L3'],
                confidence: 0.82,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).toContain('inventory_capability_cap_api_billing');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_customers');
    expect(JSON.stringify(pack.sections)).not.toContain('Customers API');
  });

  test('selects historical project inventory knowledge as code probes without injecting raw JSON', () => {
    const inventoryJson = JSON.stringify(legacyOrdersInventoryFixture());
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement deleting orders in the Orders API and update order tests.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_inventory',
          kind: 'explore',
          status: 'accepted',
          derivedFromArtifactId: 'art_inventory_previous',
          entityId: 'project_inventory:latest',
          metadata: {
            title: 'Latest legacy project inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: inventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_inventory_previous'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_orders');
    expect(capability).toMatchObject({
      title: 'Capability Map: Orders API',
      sourceType: 'code_probe',
      trustLevel: 'source',
      mode: 'summary',
      freshness: 'current',
      sourceRefs: expect.arrayContaining([
        'knowledge_artifact:kart_legacy_inventory',
        'artifact:art_inventory_previous',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });
    expect(pack.sections.find((section) => section.id === 'inventory_tests_orders_api')?.content)
      .toContain('orders-route.test.ts');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_legacy_inventory');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
    expect(JSON.stringify(pack.sections)).not.toContain('Payments API');
  });

  test('selects historical inventory source chunks through sourceChunkRefs', () => {
    const inventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [
        {
          id: 'sym_refund_reconciliation',
          kind: 'class',
          name: 'RefundReconciliationService',
          path: 'apps/api/src/refunds.ts',
          exported: true,
          line: 12,
          signature: 'export class RefundReconciliationService',
          sourceRefs: ['file:apps/api/src/refunds.ts#L12'],
          sourceChunkRefs: ['chunk_refund_service_body'],
        },
      ],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_refund_service_body',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13:   settle(amountInCents: number) {\nL14:     const cents = amountInCents.toString();\nL15:     return cents;\nL16:   }',
          contentSha256: 'b'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
          confidence: 0.7,
        },
      ],
    });
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix refund reconciliation rounding.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_refund_inventory',
          kind: 'explore',
          status: 'accepted',
          derivedFromArtifactId: 'art_inventory_previous',
          entityId: 'project_inventory:latest',
          metadata: {
            title: 'Latest legacy project inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: inventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_inventory_previous'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.find((section) => section.id === 'inventory_hybrid_sym_refund_reconciliation'))
      .toMatchObject({
        sourceType: 'code_probe',
        sourceRefs: expect.arrayContaining([
          'knowledge_artifact:kart_legacy_refund_inventory',
          'artifact:art_inventory_previous',
          'file:apps/api/src/refunds.ts#L12',
        ]),
      });
    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_refund_service_body');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'knowledge_artifact:kart_legacy_refund_inventory',
        'artifact:art_inventory_previous',
        'file:apps/api/src/refunds.ts#L13',
        'file:apps/api/src/refunds.ts#L12',
      ]),
    });
    expect(chunk?.reason).toContain('hybrid inventory evidence points to this chunk');
    expect(chunk?.content).toContain('Pointed by inventory evidence: sym_refund_reconciliation');
    expect(chunk?.content).toContain(`Content SHA-256: ${'b'.repeat(64)}`);
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('uses accepted capability-map rename corrections when matching inventory capabilities', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix fulfillment cancellation behavior and update fulfillment tests.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify(legacyOrdersInventoryFixture()),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_cap_rename',
          kind: 'explore',
          status: 'accepted',
          entityId: 'CAP-ORDERS',
          metadata: {
            title: 'Capability correction: Fulfillment API',
            text: '# Capability Correction: Fulfillment API',
            correctionKind: 'project_capability_map',
            correctionAction: 'renamed',
            capabilityId: 'cap_api_orders',
            originalLabel: 'Orders API',
            correctedLabel: 'Fulfillment API',
            inventoryArtifactId: 'art_inventory',
            sourceRefs: [
              'artifact:art_inventory',
              'capability:cap_api_orders',
              'file:apps/api/src/orders-route.ts#L12',
            ],
            evidenceRefs: [
              'entrypoint:entry_orders_delete',
              'symbol:sym_delete_order',
              'test_surface:test_orders',
            ],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_orders');
    expect(capability).toMatchObject({
      title: 'Capability Map: Fulfillment API',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'knowledge_artifact:kart_cap_rename',
        'capability:cap_api_orders',
        'entrypoint:entry_orders_delete',
        'symbol:sym_delete_order',
        'test_surface:test_orders',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });
    expect(capability?.reason).toContain('accepted capability-map correction');
    expect(capability?.content).toContain('Inventory label: Orders API');
    expect(capability?.content).toContain('Correction Review:');
    expect(capability?.content).toContain('renamed');
    expect(capability?.content).toContain('Corrected label: Fulfillment API');
    expect(capability?.content).toContain('DELETE /api/orders/:id');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_cap_rename');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('uses accepted capability-map merge corrections when matching inventory capabilities', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Update commerce operations cancellation behavior and tests.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify(legacyOrdersInventoryFixture()),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_cap_merge',
          kind: 'explore',
          status: 'accepted',
          entityId: 'CAP-ORDERS',
          metadata: {
            title: 'Capability correction: Commerce Operations',
            text: '# Capability Correction: Commerce Operations',
            correctionKind: 'project_capability_map',
            correctionAction: 'merged',
            capabilityId: 'cap_api_orders',
            originalLabel: 'Orders API',
            mergeTarget: 'Commerce Operations',
            inventoryArtifactId: 'art_inventory',
            sourceRefs: [
              'artifact:art_inventory',
              'capability:cap_api_orders',
              'file:apps/api/src/orders-route.ts#L12',
            ],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_orders');
    expect(capability).toMatchObject({
      title: 'Capability Map: Commerce Operations',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'knowledge_artifact:kart_cap_merge',
        'capability:cap_api_orders',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });
    expect(capability?.reason).toContain('accepted capability-map correction');
    expect(capability?.content).toContain('Inventory label: Orders API');
    expect(capability?.content).toContain('Action: merged');
    expect(capability?.content).toContain('Merge target: Commerce Operations');
    expect(capability?.content).toContain('DELETE /api/orders/:id');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_cap_merge');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('suppresses heuristic capabilities marked wrong by accepted capability-map corrections', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement deleting orders in the Orders API and update order tests.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify(legacyOrdersInventoryFixture()),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_cap_wrong',
          kind: 'explore',
          status: 'accepted',
          entityId: 'CAP-ORDERS',
          metadata: {
            title: 'Capability correction: Orders API wrong',
            text: '# Capability Correction: Orders API',
            correctionKind: 'project_capability_map',
            correctionAction: 'wrong',
            capabilityId: 'cap_api_orders',
            originalLabel: 'Orders API',
            inventoryArtifactId: 'art_inventory',
            sourceRefs: [
              'artifact:art_inventory',
              'capability:cap_api_orders',
              'file:apps/api/src/orders-route.ts#L12',
            ],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_orders');
    const correction = pack.sections.find((section) => section.id === 'inventory_correction_cap_api_orders');
    expect(correction).toMatchObject({
      title: 'Capability Correction: Orders API',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'knowledge_artifact:kart_cap_wrong',
        'capability:cap_api_orders',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });
    expect(correction?.content).toContain('Action: wrong');
    expect(correction?.content).toContain('Heuristic capability suppressed');
    const hybrid = pack.sections.find((section) => section.id === 'inventory_hybrid_entry_orders_delete');
    expect(hybrid).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'knowledge_artifact:kart_cap_wrong',
        'capability:cap_api_orders',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });
    expect(hybrid?.reason).toContain('Accepted wrong capability correction suppressed an attached capability');
    expect(hybrid?.content).toContain('Source-level fallback');
    expect(hybrid?.content).toContain('Accepted correction kart_cap_wrong');
    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_orders_delete_handler');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'knowledge_artifact:kart_cap_wrong',
        'capability:cap_api_orders',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });
    expect(chunk?.reason).toContain('accepted wrong capability correction suppressed an attached capability');
    expect(chunk?.content).toContain('Accepted correction kart_cap_wrong');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_cap_wrong');
  });

  test('ignores draft or review-required capability-map corrections during inventory matching', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement deleting orders in the Orders API and update order tests.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify(legacyOrdersInventoryFixture()),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_cap_wrong_draft',
          kind: 'explore',
          status: 'draft',
          entityId: 'CAP-ORDERS',
          metadata: {
            title: 'Capability correction: Orders API wrong draft',
            text: '# Capability Correction: Orders API',
            correctionKind: 'project_capability_map',
            correctionAction: 'wrong',
            capabilityId: 'cap_api_orders',
            originalLabel: 'Orders API',
            inventoryArtifactId: 'art_inventory',
          },
        }),
        knowledgeArtifactFixture({
          id: 'kart_cap_wrong_needs_review',
          kind: 'explore',
          status: 'accepted',
          entityId: 'CAP-ORDERS',
          metadata: {
            title: 'Capability correction: Orders API wrong needs review',
            text: '# Capability Correction: Orders API',
            correctionKind: 'project_capability_map',
            correctionAction: 'wrong',
            capabilityId: 'cap_api_orders',
            originalLabel: 'Orders API',
            inventoryArtifactId: 'art_inventory',
            reviewStatus: 'needs_review',
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.find((section) => section.id === 'inventory_capability_cap_api_orders')).toMatchObject({
      title: 'Capability Map: Orders API',
      sourceType: 'code_probe',
    });
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_correction_cap_api_orders');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_cap_wrong_draft');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_cap_wrong_needs_review');
  });

  test('emits a stale review signal when an accepted capability correction no longer matches current inventory', () => {
    const inventory = legacyOrdersInventoryFixture();
    inventory.capabilities = (inventory.capabilities as Array<{ id: string }>).filter((capability) => (
      capability.id !== 'cap_api_orders'
    ));

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Update capability map drift after a fresh project scan.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory',
          content: JSON.stringify(inventory),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_cap_orders_rename',
          kind: 'explore',
          status: 'accepted',
          entityId: 'CAP-ORDERS',
          metadata: {
            title: 'Capability correction: Fulfillment API',
            text: '# Capability Correction: Fulfillment API',
            correctionKind: 'project_capability_map',
            correctionAction: 'renamed',
            capabilityId: 'cap_api_orders',
            originalLabel: 'Orders API',
            correctedLabel: 'Fulfillment API',
            inventoryArtifactId: 'art_previous_inventory',
            sourceRefs: [
              'artifact:art_previous_inventory',
              'capability:cap_api_orders',
              'file:apps/api/src/orders-route.ts#L12',
            ],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.mode).toBe('calibration');
    const signal = pack.calibrationSignals?.find((item) => item.id.includes('stale_capability_correction'));
    expect(signal).toMatchObject({
      kind: 'stale',
      severity: 'review_required',
      recommendedAction: 'mark_stale_or_supersede',
      message: expect.stringContaining('current project inventory no longer contains that capability'),
      subjectRefs: expect.arrayContaining([
        'knowledge_artifact:kart_cap_orders_rename',
        'capability:cap_api_orders',
      ]),
      evidenceRefs: expect.arrayContaining([
        'artifact:art_current_inventory',
        'artifact:art_previous_inventory',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });
  });

  test('emits a stale review signal when current inventory has no capabilities', () => {
    const inventory = legacyOrdersInventoryFixture();
    inventory.capabilities = [];

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Review stale capability corrections after an empty capability scan.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_empty_inventory',
          content: JSON.stringify(inventory),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_cap_orders_empty_scan',
          kind: 'explore',
          status: 'accepted',
          entityId: 'CAP-ORDERS',
          metadata: {
            title: 'Capability correction: Fulfillment API',
            text: '# Capability Correction: Fulfillment API',
            correctionKind: 'project_capability_map',
            correctionAction: 'renamed',
            capabilityId: 'cap_api_orders',
            originalLabel: 'Orders API',
            correctedLabel: 'Fulfillment API',
            inventoryArtifactId: 'art_previous_inventory',
            sourceRefs: [
              'artifact:art_previous_inventory',
              'capability:cap_api_orders',
              'file:apps/api/src/orders-route.ts#L12',
            ],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.mode).toBe('calibration');
    const signal = pack.calibrationSignals?.find((item) => item.id.includes('stale_capability_correction'));
    expect(signal).toMatchObject({
      kind: 'stale',
      severity: 'review_required',
      recommendedAction: 'mark_stale_or_supersede',
      message: expect.stringContaining('current project inventory no longer contains that capability'),
      subjectRefs: expect.arrayContaining([
        'knowledge_artifact:kart_cap_orders_empty_scan',
        'capability:cap_api_orders',
      ]),
      evidenceRefs: expect.arrayContaining([
        'artifact:art_current_empty_inventory',
        'artifact:art_previous_inventory',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });
  });

  test('emits superseded review signals when accepted correction labels converge with current inventory', () => {
    const inventory = {
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [
        {
          id: 'entry_fulfillment_cancel',
          kind: 'http_route',
          label: 'POST /api/fulfillment/cancel',
          path: 'apps/api/src/fulfillment-route.ts',
          method: 'POST',
          route: '/api/fulfillment/cancel',
          handler: 'cancelFulfillment',
          sourceRefs: ['file:apps/api/src/fulfillment-route.ts#L22'],
          confidence: 0.9,
        },
        {
          id: 'entry_commerce_ship',
          kind: 'http_route',
          label: 'POST /api/commerce/ship',
          path: 'apps/api/src/commerce-route.ts',
          method: 'POST',
          route: '/api/commerce/ship',
          handler: 'shipCommerceOrder',
          sourceRefs: ['file:apps/api/src/commerce-route.ts#L31'],
          confidence: 0.88,
        },
      ],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [
        {
          id: 'cap_api_fulfillment',
          label: 'Fulfillment API',
          kind: 'api',
          entrypointRefs: ['entry_fulfillment_cancel'],
          moduleRefs: [],
          symbolRefs: [],
          testRefs: [],
          hotspotRefs: [],
          sourceRefs: ['file:apps/api/src/fulfillment-route.ts#L22'],
          confidence: 0.91,
          openQuestions: [],
        },
        {
          id: 'cap_commerce_operations',
          label: 'Commerce Operations',
          kind: 'api',
          entrypointRefs: ['entry_commerce_ship'],
          moduleRefs: [],
          symbolRefs: [],
          testRefs: [],
          hotspotRefs: [],
          sourceRefs: ['file:apps/api/src/commerce-route.ts#L31'],
          confidence: 0.87,
          openQuestions: [],
        },
      ],
      symbolGraph: { parser: 'typescript_ast', nodes: [], edges: [] },
      sourceChunks: [],
    };

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Review Fulfillment API and Commerce Operations capability map drift after a fresh scan.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory',
          content: JSON.stringify(inventory),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_cap_orders_rename',
          kind: 'explore',
          status: 'accepted',
          entityId: 'CAP-ORDERS',
          metadata: {
            title: 'Capability correction: Fulfillment API',
            text: '# Capability Correction: Fulfillment API',
            correctionKind: 'project_capability_map',
            correctionAction: 'renamed',
            capabilityId: 'cap_api_orders',
            originalLabel: 'Orders API',
            correctedLabel: 'Fulfillment API',
            inventoryArtifactId: 'art_previous_inventory',
            sourceRefs: [
              'artifact:art_previous_inventory',
              'capability:cap_api_orders',
              'file:apps/api/src/orders-route.ts#L12',
            ],
          },
        }),
        knowledgeArtifactFixture({
          id: 'kart_cap_payments_merge',
          kind: 'explore',
          status: 'accepted',
          entityId: 'CAP-PAYMENTS',
          metadata: {
            title: 'Capability correction: Commerce Operations',
            text: '# Capability Correction: Commerce Operations',
            correctionKind: 'project_capability_map',
            correctionAction: 'merged',
            capabilityId: 'cap_api_payments',
            originalLabel: 'Payments API',
            mergeTarget: 'Commerce Operations',
            inventoryArtifactId: 'art_previous_inventory',
            sourceRefs: [
              'artifact:art_previous_inventory',
              'capability:cap_api_payments',
              'file:apps/api/src/payments-route.ts#L8',
            ],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.mode).toBe('calibration');
    expect(pack.calibrationSignals?.filter((signal) => (
      signal.id.includes('superseded_capability_correction')
    ))).toHaveLength(2);
    expect(pack.calibrationSignals?.some((signal) => (
      signal.id.includes('stale_capability_correction')
    ))).toBe(false);

    const renameSignal = pack.calibrationSignals?.find((signal) => (
      signal.id.includes('superseded_capability_correction')
      && signal.id.includes('kart_cap_orders_rename')
    ));
    expect(renameSignal).toMatchObject({
      kind: 'superseded',
      severity: 'review_required',
      recommendedAction: 'mark_stale_or_supersede',
      message: expect.stringContaining('heuristic scan appears to have converged on the governed label'),
      subjectRefs: expect.arrayContaining([
        'knowledge_artifact:kart_cap_orders_rename',
        'capability:cap_api_orders',
        'capability:cap_api_fulfillment',
      ]),
      evidenceRefs: expect.arrayContaining([
        'artifact:art_current_inventory',
        'artifact:art_previous_inventory',
        'file:apps/api/src/fulfillment-route.ts#L22',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });

    const mergeSignal = pack.calibrationSignals?.find((signal) => (
      signal.id.includes('superseded_capability_correction')
      && signal.id.includes('kart_cap_payments_merge')
    ));
    expect(mergeSignal).toMatchObject({
      kind: 'superseded',
      severity: 'review_required',
      recommendedAction: 'mark_stale_or_supersede',
      message: expect.stringContaining('heuristic scan appears to have converged on the governed label'),
      subjectRefs: expect.arrayContaining([
        'knowledge_artifact:kart_cap_payments_merge',
        'capability:cap_api_payments',
        'capability:cap_commerce_operations',
      ]),
      evidenceRefs: expect.arrayContaining([
        'artifact:art_current_inventory',
        'artifact:art_previous_inventory',
        'file:apps/api/src/commerce-route.ts#L31',
        'file:apps/api/src/payments-route.ts#L8',
      ]),
    });

    const selectedSectionText = JSON.stringify(pack.sections);
    expect(selectedSectionText).not.toContain('knowledge_artifact:kart_cap_orders_rename');
    expect(selectedSectionText).not.toContain('knowledge_artifact:kart_cap_payments_merge');
    expect(selectedSectionText).not.toContain('Correction Review:');
    expect(pack.sections.find((section) => section.id === 'inventory_capability_cap_api_fulfillment')).toMatchObject({
      title: 'Capability Map: Fulfillment API',
      sourceRefs: expect.not.arrayContaining(['knowledge_artifact:kart_cap_orders_rename']),
    });
    expect(pack.sections.find((section) => section.id === 'inventory_capability_cap_commerce_operations')).toMatchObject({
      title: 'Capability Map: Commerce Operations',
      sourceRefs: expect.not.arrayContaining(['knowledge_artifact:kart_cap_payments_merge']),
    });
  });

  test('emits a conflict signal when an accepted correction label matches multiple current capabilities', () => {
    const inventory = {
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [
        {
          id: 'entry_fulfillment_cancel',
          kind: 'http_route',
          label: 'POST /api/fulfillment/cancel',
          path: 'apps/api/src/fulfillment-route.ts',
          method: 'POST',
          route: '/api/fulfillment/cancel',
          handler: 'cancelFulfillment',
          sourceRefs: ['file:apps/api/src/fulfillment-route.ts#L22'],
          confidence: 0.9,
        },
        {
          id: 'entry_fulfillment_returns',
          kind: 'http_route',
          label: 'POST /api/fulfillment/returns',
          path: 'apps/api/src/returns-route.ts',
          method: 'POST',
          route: '/api/fulfillment/returns',
          handler: 'returnFulfillmentOrder',
          sourceRefs: ['file:apps/api/src/returns-route.ts#L44'],
          confidence: 0.88,
        },
      ],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [
        {
          id: 'cap_api_fulfillment_cancel',
          label: 'Fulfillment API',
          kind: 'api',
          entrypointRefs: ['entry_fulfillment_cancel'],
          moduleRefs: [],
          symbolRefs: [],
          testRefs: [],
          hotspotRefs: [],
          sourceRefs: ['file:apps/api/src/fulfillment-route.ts#L22'],
          confidence: 0.91,
          openQuestions: [],
        },
        {
          id: 'cap_api_fulfillment_returns',
          label: 'Fulfillment API',
          kind: 'api',
          entrypointRefs: ['entry_fulfillment_returns'],
          moduleRefs: [],
          symbolRefs: [],
          testRefs: [],
          hotspotRefs: [],
          sourceRefs: ['file:apps/api/src/returns-route.ts#L44'],
          confidence: 0.89,
          openQuestions: [],
        },
      ],
      symbolGraph: { parser: 'typescript_ast', nodes: [], edges: [] },
      sourceChunks: [],
    };

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Review Fulfillment API capability map drift after a fresh scan.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_ambiguous',
          content: JSON.stringify(inventory),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_cap_orders_rename_ambiguous',
          kind: 'explore',
          status: 'accepted',
          entityId: 'CAP-ORDERS',
          metadata: {
            title: 'Capability correction: Fulfillment API',
            text: '# Capability Correction: Fulfillment API',
            correctionKind: 'project_capability_map',
            correctionAction: 'renamed',
            capabilityId: 'cap_api_orders',
            originalLabel: 'Orders API',
            correctedLabel: 'Fulfillment API',
            inventoryArtifactId: 'art_previous_inventory',
            sourceRefs: [
              'artifact:art_previous_inventory',
              'capability:cap_api_orders',
              'file:apps/api/src/orders-route.ts#L12',
            ],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.mode).toBe('calibration');
    expect(pack.calibrationSignals?.some((signal) => (
      signal.id.includes('superseded_capability_correction')
    ))).toBe(false);
    expect(pack.calibrationSignals?.some((signal) => (
      signal.id.includes('stale_capability_correction')
    ))).toBe(false);
    const signal = pack.calibrationSignals?.find((item) => item.id.includes('conflict_capability_correction'));
    expect(signal).toMatchObject({
      kind: 'conflict',
      severity: 'review_required',
      recommendedAction: 'open_knowledge_review',
      message: expect.stringContaining('matches multiple current project inventory capabilities'),
      subjectRefs: expect.arrayContaining([
        'knowledge_artifact:kart_cap_orders_rename_ambiguous',
        'capability:cap_api_orders',
        'capability:cap_api_fulfillment_cancel',
        'capability:cap_api_fulfillment_returns',
      ]),
      evidenceRefs: expect.arrayContaining([
        'artifact:art_current_inventory_ambiguous',
        'artifact:art_previous_inventory',
        'file:apps/api/src/fulfillment-route.ts#L22',
        'file:apps/api/src/returns-route.ts#L44',
        'file:apps/api/src/orders-route.ts#L12',
      ]),
    });

    const selectedSectionText = JSON.stringify(pack.sections);
    expect(selectedSectionText).not.toContain('knowledge_artifact:kart_cap_orders_rename_ambiguous');
    expect(selectedSectionText).not.toContain('capability:cap_api_orders');
    expect(selectedSectionText).not.toContain('file:apps/api/src/orders-route.ts#L12');
    expect(selectedSectionText).not.toContain('Correction Review:');
    expect(pack.sections.find((section) => (
      section.id === 'inventory_capability_cap_api_fulfillment_cancel'
    ))).toMatchObject({
      title: 'Capability Map: Fulfillment API',
      sourceRefs: expect.not.arrayContaining(['knowledge_artifact:kart_cap_orders_rename_ambiguous']),
    });
    expect(pack.sections.find((section) => (
      section.id === 'inventory_capability_cap_api_fulfillment_returns'
    ))).toMatchObject({
      title: 'Capability Map: Fulfillment API',
      sourceRefs: expect.not.arrayContaining(['knowledge_artifact:kart_cap_orders_rename_ambiguous']),
    });
  });

  test('emits a stale review signal when historical inventory source chunk content drifts', () => {
    const currentInventory = {
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_refund_service_body',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13:   settle(amountInCents: number) {\nL14:     return round(amountInCents);\nL15:   }',
          contentSha256: 'a'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
        },
      ],
    };
    const historicalInventory = {
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_refund_service_body',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13:   settle(amountInCents: number) {\nL14:     return amountInCents.toString();\nL15:   }',
          contentSha256: 'b'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
        },
      ],
    };

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix refund reconciliation rounding after a fresh project scan.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory',
          content: JSON.stringify(currentInventory),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_refund_inventory',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory',
          metadata: {
            title: 'Latest legacy refund project inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: JSON.stringify(historicalInventory),
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.mode).toBe('calibration');
    const signal = pack.calibrationSignals?.find((item) => item.id.includes('source_chunk_hash_drift'));
    expect(signal).toMatchObject({
      kind: 'stale',
      severity: 'review_required',
      recommendedAction: 'mark_stale_or_supersede',
      message: expect.stringContaining('contentSha256 that differs from the current project inventory'),
      subjectRefs: expect.arrayContaining([
        'knowledge_artifact:kart_legacy_refund_inventory',
        'source_chunk:chunk_refund_service_body',
      ]),
      evidenceRefs: expect.arrayContaining([
        'artifact:art_current_inventory',
        'knowledge_artifact:kart_legacy_refund_inventory',
        'artifact:art_previous_inventory',
        'file:apps/api/src/refunds.ts#L13',
      ]),
    });
  });

  test('matches source chunk hash drift through linked inventory refs when line windows shift', () => {
    const currentInventory = {
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_refund_service_body_shifted',
          path: 'apps/api/src/refunds.ts',
          startLine: 15,
          endLine: 20,
          snippet: 'L15:   settle(amountInCents: number) {\nL16:     return round(amountInCents);\nL17:   }',
          contentSha256: 'c'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L15'],
          symbolRefs: ['sym_refund_reconciliation'],
        },
      ],
    };
    const historicalInventory = {
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_refund_service_body',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13:   settle(amountInCents: number) {\nL14:     return amountInCents.toString();\nL15:   }',
          contentSha256: 'd'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
          symbolRefs: ['sym_refund_reconciliation'],
        },
      ],
    };

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Review refund reconciliation after source lines shifted.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory',
          content: JSON.stringify(currentInventory),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_refund_inventory_shifted',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory',
          metadata: {
            title: 'Latest legacy refund project inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: JSON.stringify(historicalInventory),
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const signal = pack.calibrationSignals?.find((item) => item.id.includes('source_chunk_hash_drift'));
    expect(signal).toMatchObject({
      kind: 'stale',
      severity: 'review_required',
      subjectRefs: expect.arrayContaining([
        'knowledge_artifact:kart_legacy_refund_inventory_shifted',
        'source_chunk:chunk_refund_service_body',
      ]),
      evidenceRefs: expect.arrayContaining([
        'artifact:art_current_inventory',
        'artifact:art_previous_inventory',
        'file:apps/api/src/refunds.ts#L15',
        'file:apps/api/src/refunds.ts#L13',
      ]),
    });
  });

  test('emits source chunk hash drift for accepted standalone source chunk indexes', () => {
    const currentInventory = {
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_current_refund_policy',
          path: 'apps/api/src/refunds.ts',
          startLine: 40,
          endLine: 44,
          snippet: 'L40: export function applyLegacyAdjustment() {\nL41:   return policy.apply();\nL42: }',
          contentSha256: '3'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
          symbolRefs: ['sym_refund_policy'],
          confidence: 0.72,
        },
      ],
    };
    const standaloneIndexJson = JSON.stringify({
      schemaVersion: 'ainp.source_chunk_index.v1',
      generatedAt: '2026-07-03T00:00:00.000Z',
      source: 'project_inventory.sourceChunks',
      chunkCount: 1,
      maxEntries: 120,
      entries: [
        {
          id: 'src_chunk_idx_old_refund_policy',
          sourceChunkRef: 'chunk_previous_refund_policy',
          contentSha256: '4'.repeat(64),
          path: 'apps/api/src/refunds.ts',
          startLine: 40,
          endLine: 44,
          language: 'typescript/javascript',
          lexicalTokens: ['refund', 'policy'],
          searchText: 'refund policy',
          linkedRecordRefs: ['sym_refund_policy'],
          sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
          entrypointRefs: [],
          symbolRefs: ['sym_refund_policy'],
          graphEdgeRefs: [],
          testRefs: [],
          hotspotRefs: [],
          capabilityRefs: [],
        },
      ],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Review refund policy after the latest source scan.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_source_index_drift',
          content: JSON.stringify(currentInventory),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_refund_source_index',
          kind: 'explore',
          status: 'accepted',
          entityId: 'source_chunk_index:latest',
          derivedFromArtifactId: 'art_previous_source_index',
          metadata: {
            title: 'Previous source chunk index',
            output: 'source-chunk-index.json',
            schemaVersion: 'ainp.source_chunk_index.v1',
            content: standaloneIndexJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_source_index'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.mode).toBe('calibration');
    const signal = pack.calibrationSignals?.find((item) => item.id.includes('source_chunk_hash_drift'));
    expect(signal).toMatchObject({
      kind: 'stale',
      severity: 'review_required',
      recommendedAction: 'mark_stale_or_supersede',
      message: expect.stringContaining('source chunk index'),
      subjectRefs: expect.arrayContaining([
        'knowledge_artifact:kart_legacy_refund_source_index',
        'source_chunk:chunk_previous_refund_policy',
      ]),
      evidenceRefs: expect.arrayContaining([
        'artifact:art_current_inventory_source_index_drift',
        'knowledge_artifact:kart_legacy_refund_source_index',
        'artifact:art_previous_source_index',
        'file:apps/api/src/refunds.ts#L40',
      ]),
    });
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_legacy_refund_source_index');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('uses hybrid inventory retrieval when no capability directly matches', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix refund reconciliation rounding and cover refund tests.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_refund_reconciliation',
                kind: 'class',
                name: 'RefundReconciliationService',
                path: 'apps/api/src/refund-reconciliation.ts',
                exported: true,
                line: 4,
                signature: 'export class RefundReconciliationService',
                sourceRefs: ['file:apps/api/src/refund-reconciliation.ts#L4'],
              },
              {
                id: 'sym_unrelated',
                kind: 'function',
                name: 'listCustomers',
                path: 'apps/api/src/customers.ts',
                exported: true,
                line: 2,
                signature: 'export function listCustomers()',
                sourceRefs: ['file:apps/api/src/customers.ts#L2'],
              },
            ],
            testSurfaces: [
              {
                id: 'test_refunds',
                path: 'apps/api/test/refund-reconciliation.test.ts',
                frameworkHint: 'vitest',
                targetHints: ['refund', 'reconciliation'],
                sourceRefs: ['file:apps/api/test/refund-reconciliation.test.ts'],
              },
            ],
            hotspots: [],
            capabilities: [],
            symbolGraph: {
              parser: 'typescript_ast',
              nodes: [],
              edges: [
                {
                  id: 'edge_refund_repo',
                  kind: 'symbol_reference',
                  from: 'node_symbol_sym_refund_reconciliation',
                  to: 'node_symbol_sym_refund_repository',
                  label: 'uses RefundRepository',
                  sourceRefs: ['file:apps/api/src/refund-reconciliation.ts#L8'],
                  confidence: 0.7,
                },
              ],
            },
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const hybrid = pack.sections.find((section) => section.id === 'inventory_hybrid_sym_refund_reconciliation');
    expect(hybrid).toMatchObject({
      title: 'Hybrid Retrieval: symbol RefundReconciliationService',
      sourceType: 'code_probe',
      trustLevel: 'source',
      mode: 'summary',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'file:apps/api/src/refund-reconciliation.ts#L4',
        'file:apps/api/src/refund-reconciliation.ts#L8',
      ]),
    });
    expect(hybrid?.reason).toContain('bm25=');
    expect(hybrid?.content).toContain('RefundReconciliationService');
    expect(hybrid?.content).toContain('uses RefundRepository');
    expect(pack.sections.map((section) => section.id)).not.toContain('input_project_inventory_json');
    expect(JSON.stringify(pack.sections)).not.toContain('listCustomers');
  });

  test('selects source chunks as code probes without rendering raw inventory or sensitive chunks', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix refund rounding reconciliation behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_refund_rounding',
                path: 'apps/api/src/refunds.ts',
                startLine: 20,
                endLine: 28,
                snippet: 'L20: export function reconcileRefundRounding() {\nL21:   return applyRefundRoundingPolicy();\nL22: }',
                contentSha256: 'a'.repeat(64),
                sourceRefs: ['file:apps/api/src/refunds.ts#L20'],
                confidence: 0.72,
              },
              {
                id: 'chunk_customer_listing',
                path: 'apps/api/src/customers.ts',
                startLine: 1,
                endLine: 5,
                snippet: 'L1: export function listCustomers() { return []; }',
                sourceRefs: ['file:apps/api/src/customers.ts#L1'],
                confidence: 0.7,
              },
              {
                id: 'chunk_sensitive_env',
                path: '.env.local',
                startLine: 1,
                endLine: 1,
                snippet: 'L1: SECRET_TOKEN=should-not-appear',
                sourceRefs: ['file:.env.local#L1'],
                confidence: 0.9,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_refund_rounding');
    expect(chunk).toMatchObject({
      title: 'Source Chunk: apps/api/src/refunds.ts:20-28',
      sourceType: 'code_probe',
      trustLevel: 'source',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'file:apps/api/src/refunds.ts#L20',
      ]),
    });
    expect(chunk?.reason).toContain('source snippet matched the task brief');
    expect(chunk?.content).toContain('reconcileRefundRounding');
    expect(chunk?.content).toContain(`Content SHA-256: ${'a'.repeat(64)}`);
    expect(chunk?.content).toMatch(/BM25 score: \d+\.\d{2}/);
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_customer_listing');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_sensitive_env');
    expect(pack.sections.map((section) => section.id)).not.toContain('input_project_inventory_json');
    expect(JSON.stringify(pack.sections)).not.toContain('listCustomers');
    expect(JSON.stringify(pack.sections)).not.toContain('SECRET_TOKEN');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('selects source chunks by explicit contentSha256 task hint', () => {
    const contentSha256 = 'e'.repeat(64);
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: `Inspect Content SHA-256: ${contentSha256} before editing.`,
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_content_hash',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_hash_target',
                path: 'apps/api/src/refunds.ts',
                startLine: 30,
                endLine: 34,
                snippet: 'L30: export function settleRefund() {\nL31:   return ledger.settle();\nL32: }',
                contentSha256,
                sourceRefs: ['file:apps/api/src/refunds.ts#L30'],
                confidence: 0.7,
              },
              {
                id: 'chunk_hash_neighbor',
                path: 'apps/api/src/orders.ts',
                startLine: 1,
                endLine: 3,
                snippet: 'L1: export function deleteOrder() { return true; }',
                contentSha256: 'f'.repeat(64),
                sourceRefs: ['file:apps/api/src/orders.ts#L1'],
                confidence: 0.7,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_hash_target');
    const chunkSourceRefs = Array.isArray(chunk?.sourceRefs) ? chunk.sourceRefs : [];
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
    });
    expect(chunkSourceRefs).toEqual(expect.arrayContaining([
      'artifact:art_inventory_content_hash',
      'file:apps/api/src/refunds.ts#L30',
    ]));
    expect(chunk?.content).toContain(`Matched Content SHA-256: ${contentSha256}`);
    expect(chunk?.reason).toContain(`task contentSha256 matched this chunk (${contentSha256})`);
    expect(chunkSourceRefs).not.toContain(contentSha256);
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_hash_neighbor');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('selects historical inventory source chunks by explicit contentSha256 task hint', () => {
    const contentSha256 = 'e'.repeat(64);
    const inventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_hash_historical_target',
          path: 'apps/api/src/refunds.ts',
          startLine: 30,
          endLine: 34,
          snippet: 'L30: export function settleRefund() {\nL31:   return ledger.settle();\nL32: }',
          contentSha256,
          sourceRefs: ['file:apps/api/src/refunds.ts#L30'],
          confidence: 0.7,
        },
        {
          id: 'chunk_hash_historical_neighbor',
          path: 'apps/api/src/orders.ts',
          startLine: 1,
          endLine: 3,
          snippet: 'L1: export function deleteOrder() { return true; }',
          contentSha256: 'f'.repeat(64),
          sourceRefs: ['file:apps/api/src/orders.ts#L1'],
          confidence: 0.7,
        },
      ],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: `Inspect Content SHA-256: ${contentSha256} from the previous inventory.`,
      inputArtifacts: [],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_hash_inventory',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory',
          metadata: {
            title: 'Latest legacy source inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: inventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_hash_historical_target');
    const chunkSourceRefs = Array.isArray(chunk?.sourceRefs) ? chunk.sourceRefs : [];
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
    });
    expect(chunkSourceRefs).toEqual(expect.arrayContaining([
      'knowledge_artifact:kart_legacy_hash_inventory',
      'artifact:art_previous_inventory',
      'file:apps/api/src/refunds.ts#L30',
    ]));
    expect(chunk?.content).toContain(`Matched Content SHA-256: ${contentSha256}`);
    expect(chunkSourceRefs).not.toContain(contentSha256);
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_legacy_hash_inventory');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_hash_historical_neighbor');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('uses source chunk index entries from historical inventory to recover chunk link refs', () => {
    const contentSha256 = 'b'.repeat(64);
    const inventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [
        {
          id: 'sym_refund_reconciliation',
          kind: 'class',
          name: 'RefundReconciliationService',
          path: 'apps/api/src/refunds.ts',
          exported: true,
          line: 12,
          signature: 'export class RefundReconciliationService',
          sourceRefs: ['file:apps/api/src/refunds.ts#L12'],
        },
      ],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_refund_service_body',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13:   settle(amountInCents: number) {\nL14:     return amountInCents.toString();\nL15:   }',
          contentSha256,
          sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
          confidence: 0.7,
        },
      ],
      sourceChunkIndex: {
        schemaVersion: 'ainp.source_chunk_index.v1',
        generatedAt: '2026-07-03T00:00:00.000Z',
        source: 'project_inventory.sourceChunks',
        chunkCount: 1,
        maxEntries: 120,
        entries: [
          {
            id: 'src_chunk_idx_refund_service',
            sourceChunkRef: 'chunk_refund_service_body',
            contentSha256,
            path: 'apps/api/src/refunds.ts',
            startLine: 13,
            endLine: 18,
            sourceRefs: [
              'file:apps/api/src/refunds.ts#L12',
              'file:apps/api/src/refunds.ts#L13',
            ],
            entrypointRefs: [],
            symbolRefs: ['sym_refund_reconciliation'],
            graphEdgeRefs: [],
            testRefs: [],
            hotspotRefs: [],
            capabilityRefs: [],
          },
        ],
      },
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix refund reconciliation rounding.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_source_index_inventory',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory',
          metadata: {
            title: 'Latest legacy source index inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: inventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.find((section) => section.id === 'inventory_hybrid_sym_refund_reconciliation'))
      .toMatchObject({ sourceType: 'code_probe' });
    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_refund_service_body');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'knowledge_artifact:kart_legacy_source_index_inventory',
        'artifact:art_previous_inventory',
        'file:apps/api/src/refunds.ts#L12',
        'file:apps/api/src/refunds.ts#L13',
      ]),
    });
    expect(chunk?.content).toContain(`Content SHA-256: ${contentSha256}`);
    expect(chunk?.content).toContain('Pointed by inventory evidence: sym_refund_reconciliation');
    expect(chunk?.reason).toContain('hybrid inventory evidence points to this chunk');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_legacy_source_index_inventory');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('selects historical source chunk index evidence from explicit source refs', () => {
    const contentSha256 = 'c'.repeat(64);
    const inventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_refund_source_ref_target',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13:   settle(amountInCents: number) {\nL14:     return amountInCents.toString();\nL15:   }',
          contentSha256,
          sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
          confidence: 0.7,
        },
        {
          id: 'chunk_unrelated_orders',
          path: 'apps/api/src/orders.ts',
          startLine: 10,
          endLine: 12,
          snippet: 'L10: export function deleteOrder() {\nL11:   return audit();\nL12: }',
          sourceRefs: ['file:apps/api/src/orders.ts#L10'],
          confidence: 0.7,
        },
      ],
      sourceChunkIndex: {
        schemaVersion: 'ainp.source_chunk_index.v1',
        generatedAt: '2026-07-03T00:00:00.000Z',
        source: 'project_inventory.sourceChunks',
        chunkCount: 2,
        maxEntries: 120,
        entries: [
          {
            id: 'src_chunk_idx_refund_source_ref',
            sourceChunkRef: 'chunk_refund_source_ref_target',
            contentSha256,
            path: 'apps/api/src/refunds.ts',
            startLine: 13,
            endLine: 18,
            sourceRefs: ['file:apps/api/src/refunds.ts#L12'],
            entrypointRefs: [],
            symbolRefs: [],
            graphEdgeRefs: [],
            testRefs: [],
            hotspotRefs: [],
            capabilityRefs: [],
          },
        ],
      },
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Inspect file:apps/api/src/refunds.ts#L12 before editing.',
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_source_ref_index_inventory',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory',
          metadata: {
            title: 'Latest legacy source-ref index inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: inventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_refund_source_ref_target');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'knowledge_artifact:kart_legacy_source_ref_index_inventory',
        'artifact:art_previous_inventory',
        'file:apps/api/src/refunds.ts#L12',
      ]),
    });
    expect(chunk?.content).toContain('Matched source refs: file:apps/api/src/refunds.ts#L12');
    expect(chunk?.content).toContain('Source chunk: apps/api/src/refunds.ts:13-18');
    expect(chunk?.content).toContain('L13:   settle(amountInCents: number) {');
    expect(chunk?.reason).toContain('task source ref matched this chunk');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_legacy_source_ref_index_inventory');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_unrelated_orders');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('prefers current inventory source chunks over historical duplicates for contentSha256 hints', () => {
    const contentSha256 = 'e'.repeat(64);
    const currentInventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_hash_current_target',
          path: 'apps/api/src/refunds-current.ts',
          startLine: 30,
          endLine: 34,
          snippet: 'L30: export function settleCurrentRefund() {\nL31:   return ledger.settle();\nL32: }',
          contentSha256,
          sourceRefs: ['file:apps/api/src/refunds-current.ts#L30'],
          confidence: 0.8,
        },
      ],
    });
    const historicalInventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_hash_historical_duplicate',
          path: 'apps/api/src/refunds-old.ts',
          startLine: 30,
          endLine: 34,
          snippet: 'L30: export function settleOldRefund() {\nL31:   return ledger.settle();\nL32: }',
          contentSha256,
          sourceRefs: ['file:apps/api/src/refunds-old.ts#L30'],
          confidence: 0.7,
        },
      ],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: `Inspect Content SHA-256: ${contentSha256} before editing.`,
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory',
          content: currentInventoryJson,
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_hash_inventory_duplicate',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory',
          metadata: {
            title: 'Previous source inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: historicalInventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const currentChunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_hash_current_target');
    expect(currentChunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_current_inventory',
        'file:apps/api/src/refunds-current.ts#L30',
      ]),
    });
    expect(currentChunk?.content).toContain(`Matched Content SHA-256: ${contentSha256}`);
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_hash_historical_duplicate');
    expect(JSON.stringify(pack.sections)).not.toContain('settleOldRefund');
    expect(JSON.stringify(pack.sections)).not.toContain('knowledge_kart_legacy_hash_inventory_duplicate');
  });

  test('prefers current inventory source chunks over historical duplicates for source-ref hints', () => {
    const currentInventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_source_ref_current_target',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13: export function settleCurrentRefund() {\nL14:   return ledger.settle();\nL15: }',
          contentSha256: 'd'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
          confidence: 0.8,
        },
      ],
    });
    const historicalInventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_source_ref_historical_duplicate',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13: export function settleHistoricalRefund() {\nL14:   return staleLedger.settle();\nL15: }',
          contentSha256: 'f'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
          confidence: 0.7,
        },
      ],
      sourceChunkIndex: {
        schemaVersion: 'ainp.source_chunk_index.v1',
        generatedAt: '2026-07-03T00:00:00.000Z',
        source: 'project_inventory.sourceChunks',
        chunkCount: 1,
        maxEntries: 120,
        entries: [
          {
            id: 'src_chunk_idx_historical_duplicate',
            sourceChunkRef: 'chunk_source_ref_historical_duplicate',
            contentSha256: 'f'.repeat(64),
            path: 'apps/api/src/refunds.ts',
            startLine: 13,
            endLine: 18,
            sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
            entrypointRefs: [],
            symbolRefs: [],
            graphEdgeRefs: [],
            testRefs: [],
            hotspotRefs: [],
            capabilityRefs: [],
          },
        ],
      },
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Inspect file:apps/api/src/refunds.ts#L13 before editing.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_source_ref',
          content: currentInventoryJson,
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_legacy_source_ref_inventory_duplicate',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory',
          metadata: {
            title: 'Previous source-ref inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: historicalInventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const currentChunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_source_ref_current_target');
    expect(currentChunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_current_inventory_source_ref',
        'file:apps/api/src/refunds.ts#L13',
      ]),
    });
    expect(currentChunk?.content).toContain('settleCurrentRefund');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_source_ref_historical_duplicate');
    expect(JSON.stringify(pack.sections)).not.toContain('settleHistoricalRefund');
    expect(JSON.stringify(pack.sections)).not.toContain('knowledge_kart_legacy_source_ref_inventory_duplicate');
  });

  test('uses historical source chunk index refs as metadata for matching current source chunks', () => {
    const currentContentSha256 = 'a'.repeat(64);
    const historicalContentSha256 = 'b'.repeat(64);
    const currentInventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [
        {
          id: 'sym_refund_settlement',
          kind: 'function',
          name: 'settleCurrent',
          path: 'apps/api/src/refunds.ts',
          line: 12,
          signature: 'export function settleCurrent',
          sourceRefs: ['file:apps/api/src/refunds.ts#L12'],
        },
      ],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_source_ref_current_from_historical_index',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13: export function settleCurrent() {\nL14:   return ledger.settle();\nL15: }',
          contentSha256: currentContentSha256,
          sourceRefs: ['file:apps/api/src/refunds.ts#L14'],
          confidence: 0.8,
        },
      ],
    });
    const historicalInventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_source_ref_historical_index_duplicate',
          path: 'apps/api/src/refunds.ts',
          startLine: 13,
          endLine: 18,
          snippet: 'L13: export function settleHistorical() {\nL14:   return staleLedger.settle();\nL15: }',
          contentSha256: historicalContentSha256,
          sourceRefs: ['file:apps/api/src/refunds.ts#L14'],
          confidence: 0.7,
        },
      ],
      sourceChunkIndex: {
        schemaVersion: 'ainp.source_chunk_index.v1',
        generatedAt: '2026-07-03T00:00:00.000Z',
        source: 'project_inventory.sourceChunks',
        chunkCount: 1,
        maxEntries: 120,
        entries: [
          {
            id: 'src_chunk_idx_historical_line_ref',
            sourceChunkRef: 'chunk_source_ref_historical_index_duplicate',
            contentSha256: historicalContentSha256,
            path: 'apps/api/src/refunds.ts',
            startLine: 13,
            endLine: 18,
            sourceRefs: [
              'file:apps/api/src/refunds.ts#L12',
              'knowledge_artifact:kart_historical_source_chunk_index_ref',
              'artifact:art_previous_inventory',
            ],
            entrypointRefs: [],
            symbolRefs: ['sym_refund_settlement'],
            graphEdgeRefs: [],
            testRefs: [],
            hotspotRefs: [],
            capabilityRefs: [],
          },
        ],
      },
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Inspect file:apps/api/src/refunds.ts#L12 before editing.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_historical_index_ref',
          content: currentInventoryJson,
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_historical_source_chunk_index_ref',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory',
          metadata: {
            title: 'Previous source-ref inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: historicalInventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const currentChunk = pack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_source_ref_current_from_historical_index'
    ));
    const currentChunkSourceRefs = Array.isArray(currentChunk?.sourceRefs) ? currentChunk.sourceRefs : [];
    expect(currentChunk).toMatchObject({
      sourceType: 'code_probe',
    });
    expect(currentChunkSourceRefs).toEqual(expect.arrayContaining([
      'artifact:art_current_inventory_historical_index_ref',
      'file:apps/api/src/refunds.ts#L12',
    ]));
    expect(currentChunkSourceRefs.slice(0, 2)).toEqual([
      'artifact:art_current_inventory_historical_index_ref',
      'file:apps/api/src/refunds.ts#L12',
    ]);
    expect(currentChunkSourceRefs).not.toContain('knowledge_artifact:kart_historical_source_chunk_index_ref');
    expect(currentChunkSourceRefs).not.toContain('artifact:art_previous_inventory');
    expect(currentChunk?.content).toContain('Matched source refs: file:apps/api/src/refunds.ts#L12');
    expect(currentChunk?.content).toContain('Pointed by inventory evidence: sym_refund_settlement');
    expect(currentChunk?.content).toContain('settleCurrent');
    expect(pack.sections.map((section) => section.id)).not.toContain(
      'inventory_source_chunk_chunk_source_ref_historical_index_duplicate',
    );
    expect(JSON.stringify(pack.sections)).not.toContain('settleHistorical');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_historical_source_chunk_index_ref');
    expect(pack.sections.map((section) => section.id)).not.toContain('input_project_inventory_json');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('source chunk index lexical metadata can select a bounded source chunk', () => {
    const contentSha256 = '1'.repeat(64);
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix settlement workflow behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_source_index_lexical',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_refund_policy_body',
                path: 'apps/api/src/refunds.ts',
                startLine: 40,
                endLine: 44,
                snippet: [
                  'L40: export function applyLegacyAdjustment() {',
                  'L41:   return policy.apply();',
                  'L42: }',
                ].join('\n'),
                contentSha256,
                sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
                confidence: 0.72,
              },
            ],
            sourceChunkIndex: {
              schemaVersion: 'ainp.source_chunk_index.v1',
              generatedAt: '2026-07-03T00:00:00.000Z',
              source: 'project_inventory.sourceChunks',
              chunkCount: 2,
              maxEntries: 120,
              entries: [
                {
                  id: 'src_chunk_idx_refund_policy_body',
                  sourceChunkRef: 'chunk_refund_policy_body',
                  contentSha256,
                  path: 'apps/api/src/refunds.ts',
                  language: 'typescript/javascript',
                  startLine: 40,
                  endLine: 44,
                  lexicalTokens: ['settlement', 'workflow', 'refund'],
                  searchText: 'settlement workflow refund',
                  linkedRecordRefs: ['symbol:settlement-workflow'],
                  sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
                  entrypointRefs: [],
                  symbolRefs: [],
                  graphEdgeRefs: [],
                  testRefs: [],
                  hotspotRefs: [],
                  capabilityRefs: [],
                },
                {
                  id: 'src_chunk_idx_index_only',
                  sourceChunkRef: 'chunk_index_only',
                  contentSha256: '2'.repeat(64),
                  path: 'apps/api/src/index-only.ts',
                  startLine: 1,
                  endLine: 3,
                  lexicalTokens: ['settlement', 'workflow'],
                  searchText: 'settlement workflow index only',
                  linkedRecordRefs: ['symbol:index-only'],
                  sourceRefs: ['file:apps/api/src/index-only.ts#L1'],
                  entrypointRefs: [],
                  symbolRefs: [],
                  graphEdgeRefs: [],
                  testRefs: [],
                  hotspotRefs: [],
                  capabilityRefs: [],
                },
              ],
            },
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_refund_policy_body');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      trustLevel: 'source',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_source_index_lexical',
        'file:apps/api/src/refunds.ts#L40',
      ]),
    });
    expect(chunk?.reason).toContain('source chunk index lexical metadata matched the task brief');
    expect(chunk?.content).toContain('Source chunk: apps/api/src/refunds.ts:40-44');
    expect(chunk?.content).toContain('Language: typescript/javascript');
    expect(chunk?.content).toContain('applyLegacyAdjustment');
    expect(chunk?.content).toContain(`Content SHA-256: ${contentSha256}`);
    expect(chunk?.content).toMatch(/BM25 score: \d+\.\d{2}/);
    expect(chunk?.content.split('Snippet:\n')[1]).not.toContain('settlement');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_index_only');
    expect(pack.sections.map((section) => section.id)).not.toContain('input_project_inventory_json');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
    expect(JSON.stringify(pack.sections)).not.toContain('index only');
  });

  test('standalone source chunk index lexical metadata can select a matching current source chunk', () => {
    const currentContentSha256 = '3'.repeat(64);
    const historicalContentSha256 = '4'.repeat(64);
    const standaloneIndexJson = JSON.stringify({
      schemaVersion: 'ainp.source_chunk_index.v1',
      generatedAt: '2026-07-03T00:00:00.000Z',
      source: 'project_inventory.sourceChunks',
      chunkCount: 2,
      maxEntries: 120,
      entries: [
        {
          id: 'src_chunk_idx_standalone_refund_policy',
          sourceChunkRef: 'chunk_old_refund_policy_body',
          contentSha256: historicalContentSha256,
          path: 'apps/api/src/refunds.ts',
          language: 'typescript/javascript',
          startLine: 40,
          endLine: 44,
          lexicalTokens: ['settlement', 'workflow', 'refund'],
          searchText: 'settlement workflow refund',
          linkedRecordRefs: ['symbol:settlement-workflow'],
          sourceRefs: ['file:apps/api/src/refunds.ts#L39'],
          entrypointRefs: [],
          symbolRefs: ['sym_refund_policy'],
          graphEdgeRefs: [],
          testRefs: [],
          hotspotRefs: [],
          capabilityRefs: [],
        },
        {
          id: 'src_chunk_idx_standalone_index_only',
          sourceChunkRef: 'chunk_missing_index_only',
          contentSha256: '5'.repeat(64),
          path: 'apps/api/src/index-only.ts',
          startLine: 1,
          endLine: 3,
          lexicalTokens: ['settlement', 'workflow'],
          searchText: 'settlement workflow index only',
          linkedRecordRefs: ['symbol:index-only'],
          sourceRefs: ['file:apps/api/src/index-only.ts#L1'],
          entrypointRefs: [],
          symbolRefs: [],
          graphEdgeRefs: [],
          testRefs: [],
          hotspotRefs: [],
          capabilityRefs: [],
        },
      ],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix settlement workflow behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_standalone_index',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_refund_policy',
                kind: 'function',
                name: 'applyLegacyAdjustment',
                path: 'apps/api/src/refunds.ts',
                line: 40,
                signature: 'export function applyLegacyAdjustment()',
                sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_current_refund_policy_body',
                path: 'apps/api/src/refunds.ts',
                startLine: 40,
                endLine: 44,
                snippet: [
                  'L40: export function applyLegacyAdjustment() {',
                  'L41:   return policy.apply();',
                  'L42: }',
                ].join('\n'),
                contentSha256: currentContentSha256,
                sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
                confidence: 0.72,
              },
            ],
          }),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_standalone_source_chunk_index',
          kind: 'explore',
          status: 'accepted',
          entityId: 'source_chunk_index:latest',
          derivedFromArtifactId: 'art_previous_source_chunk_index',
          metadata: {
            title: 'Latest source chunk lexical index',
            output: 'source-chunk-index.json',
            schemaVersion: 'ainp.source_chunk_index.v1',
            content: standaloneIndexJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_source_chunk_index'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_current_refund_policy_body');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      trustLevel: 'source',
      sourceRefs: expect.arrayContaining([
        'artifact:art_current_inventory_standalone_index',
        'file:apps/api/src/refunds.ts#L39',
      ]),
    });
    expect(chunk?.reason).toContain('source chunk index lexical metadata matched the task brief');
    expect(chunk?.content).toContain('Source chunk: apps/api/src/refunds.ts:40-44');
    expect(chunk?.content).toContain('Language: typescript/javascript');
    expect(chunk?.content).toContain('applyLegacyAdjustment');
    expect(chunk?.content).toContain(`Content SHA-256: ${currentContentSha256}`);
    expect(chunk?.content.split('Snippet:\n')[1]).not.toContain('settlement');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_standalone_source_chunk_index');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_missing_index_only');
    expect(pack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
    expect(JSON.stringify(pack.sections)).not.toContain('index only');
  });

  test('standalone source chunk index linkedRecordRefs overlay current typed source chunk refs', () => {
    const currentContentSha256 = 'a'.repeat(64);
    const standaloneIndexJson = JSON.stringify({
      schemaVersion: 'ainp.source_chunk_index.v1',
      generatedAt: '2026-07-03T00:00:00.000Z',
      source: 'project_inventory.sourceChunks',
      chunkCount: 2,
      maxEntries: 120,
      entries: [
        {
          id: 'src_chunk_idx_linked_record_only_refund_policy',
          sourceChunkRef: 'chunk_previous_refund_policy_body',
          contentSha256: 'b'.repeat(64),
          path: 'apps/api/src/refunds.ts',
          language: 'typescript/javascript',
          startLine: 35,
          endLine: 39,
          lexicalTokens: ['settlement', 'workflow', 'refund'],
          searchText: 'settlement workflow refund',
          linkedRecordRefs: ['symbol:sym_refund_policy'],
          sourceRefs: ['file:apps/api/src/refunds.ts#L35'],
          entrypointRefs: [],
          symbolRefs: [],
          graphEdgeRefs: [],
          testRefs: [],
          hotspotRefs: [],
          capabilityRefs: [],
        },
        {
          id: 'src_chunk_idx_unmatched_linked_record',
          sourceChunkRef: 'chunk_unmatched_customer_policy',
          contentSha256: 'c'.repeat(64),
          path: 'apps/api/src/refunds.ts',
          startLine: 35,
          endLine: 39,
          lexicalTokens: ['settlement', 'workflow', 'customer'],
          searchText: 'settlement workflow customer',
          linkedRecordRefs: ['symbol:sym_customer_policy'],
          sourceRefs: ['file:apps/api/src/refunds.ts#L35'],
          entrypointRefs: [],
          symbolRefs: [],
          graphEdgeRefs: [],
          testRefs: [],
          hotspotRefs: [],
          capabilityRefs: [],
        },
        {
          id: 'src_chunk_idx_same_linked_record_different_path',
          sourceChunkRef: 'chunk_other_path_refund_policy',
          contentSha256: 'd'.repeat(64),
          path: 'apps/api/src/other-refunds.ts',
          startLine: 40,
          endLine: 44,
          lexicalTokens: ['settlement', 'workflow', 'crosspath'],
          searchText: 'settlement workflow crosspath',
          linkedRecordRefs: ['symbol:sym_refund_policy'],
          sourceRefs: ['file:apps/api/src/other-refunds.ts#L40'],
          entrypointRefs: [],
          symbolRefs: [],
          graphEdgeRefs: [],
          testRefs: [],
          hotspotRefs: [],
          capabilityRefs: [],
        },
      ],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix settlement workflow behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_linked_record_overlay',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_refund_policy',
                kind: 'function',
                name: 'applyLegacyAdjustment',
                path: 'apps/api/src/refunds.ts',
                line: 40,
                signature: 'export function applyLegacyAdjustment()',
                sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_current_refund_policy_linked_record_overlay',
                path: 'apps/api/src/refunds.ts',
                startLine: 40,
                endLine: 44,
                snippet: [
                  'L40: export function applyLegacyAdjustment() {',
                  'L41:   return policy.apply();',
                  'L42: }',
                ].join('\n'),
                contentSha256: currentContentSha256,
                sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
                symbolRefs: ['sym_refund_policy'],
                confidence: 0.72,
              },
            ],
          }),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_linked_record_source_chunk_index',
          kind: 'explore',
          status: 'accepted',
          entityId: 'source_chunk_index:latest',
          derivedFromArtifactId: 'art_previous_linked_record_source_chunk_index',
          metadata: {
            title: 'Latest linked-record source chunk index',
            output: 'source-chunk-index.json',
            schemaVersion: 'ainp.source_chunk_index.v1',
            content: standaloneIndexJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_linked_record_source_chunk_index'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_current_refund_policy_linked_record_overlay'
    ));
    const chunkSourceRefs = Array.isArray(chunk?.sourceRefs) ? [...chunk.sourceRefs] : [];
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      trustLevel: 'source',
    });
    expect(chunkSourceRefs).toContain('artifact:art_current_inventory_linked_record_overlay');
    expect(chunkSourceRefs).toContain('file:apps/api/src/refunds.ts#L35');
    expect(chunk?.reason).toContain('source chunk index lexical metadata matched the task brief');
    expect(chunk?.content).toContain('Source chunk: apps/api/src/refunds.ts:40-44');
    expect(chunk?.content).toContain('Language: typescript/javascript');
    expect(chunk?.content).toContain('applyLegacyAdjustment');
    expect(chunk?.content).toContain(`Content SHA-256: ${currentContentSha256}`);
    expect(chunk?.content.split('Snippet:\n')[1]).not.toContain('settlement');
    expect(chunkSourceRefs).not.toContain('file:apps/api/src/other-refunds.ts#L40');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_unmatched_customer_policy');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_other_path_refund_policy');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_linked_record_source_chunk_index');
    expect(pack.sections.map((section) => section.id)).not.toContain('input_source_chunk_index_json');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
    expect(JSON.stringify(pack.sections)).not.toContain('sym_customer_policy');
    expect(JSON.stringify(pack.sections)).not.toContain('crosspath');
  });

  test('uses current inventory anchors to select historical bounded source chunks when current chunks are absent', () => {
    const historicalContentSha256 = '9'.repeat(64);
    const historicalInventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_historical_settlement_anchor',
          path: 'apps/api/src/refunds.ts',
          startLine: 40,
          endLine: 44,
          snippet: [
            'L40: export function applyLegacyAdjustment() {',
            'L41:   return policy.apply();',
            'L42: }',
          ].join('\n'),
          contentSha256: historicalContentSha256,
          sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
          confidence: 0.69,
        },
      ],
      sourceChunkIndex: {
        schemaVersion: 'ainp.source_chunk_index.v1',
        generatedAt: '2026-07-03T00:00:00.000Z',
        source: 'project_inventory.sourceChunks',
        chunkCount: 1,
        maxEntries: 120,
        entries: [
          {
            id: 'src_chunk_idx_historical_settlement_anchor',
            sourceChunkRef: 'chunk_historical_settlement_anchor',
            contentSha256: historicalContentSha256,
            path: 'apps/api/src/refunds.ts',
            startLine: 40,
            endLine: 44,
            sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
            entrypointRefs: [],
            symbolRefs: ['sym_current_settlement_workflow'],
            graphEdgeRefs: [],
            testRefs: [],
            hotspotRefs: [],
            capabilityRefs: [],
          },
        ],
      },
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix refund settlement workflow behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_without_chunks',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_current_settlement_workflow',
                kind: 'function',
                name: 'applySettlementWorkflow',
                path: 'apps/api/src/refunds.ts',
                line: 40,
                signature: 'export function applySettlementWorkflow()',
                sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [],
          }),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_historical_anchor_inventory',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory_with_chunks',
          metadata: {
            title: 'Previous source-chunk inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: historicalInventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory_with_chunks'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.find((section) => section.id === 'inventory_hybrid_sym_current_settlement_workflow'))
      .toMatchObject({
        sourceType: 'code_probe',
        sourceRefs: expect.arrayContaining([
          'artifact:art_current_inventory_without_chunks',
          'file:apps/api/src/refunds.ts#L40',
        ]),
      });
    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_historical_settlement_anchor');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      trustLevel: 'source',
      sourceRefs: expect.arrayContaining([
        'artifact:art_current_inventory_without_chunks',
        'knowledge_artifact:kart_historical_anchor_inventory',
        'artifact:art_previous_inventory_with_chunks',
        'file:apps/api/src/refunds.ts#L40',
      ]),
    });
    expect(chunk?.reason).toContain('hybrid inventory evidence points to this chunk');
    expect(chunk?.content).toContain('Pointed by inventory evidence: sym_current_settlement_workflow');
    expect(chunk?.content).toContain(`Content SHA-256: ${historicalContentSha256}`);
    expect(chunk?.content).toContain('applyLegacyAdjustment');
    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_historical_anchor_inventory');
    expect(pack.sections.map((section) => section.id)).not.toContain('input_project_inventory_json');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('ignores draft historical project inventories for cross-run source chunk fallback', () => {
    const historicalInventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_draft_historical_settlement_anchor',
          path: 'apps/api/src/refunds.ts',
          startLine: 40,
          endLine: 44,
          snippet: [
            'L40: export function applyDraftHistoricalAdjustment() {',
            'L41:   return policy.apply();',
            'L42: }',
          ].join('\n'),
          contentSha256: '8'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
          symbolRefs: ['sym_current_draft_settlement_workflow'],
          confidence: 0.69,
        },
      ],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix refund settlement workflow behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_without_chunks_for_draft',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_current_draft_settlement_workflow',
                kind: 'function',
                name: 'applySettlementWorkflow',
                path: 'apps/api/src/refunds.ts',
                line: 40,
                signature: 'export function applySettlementWorkflow()',
                sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [],
          }),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_draft_historical_anchor_inventory',
          kind: 'explore',
          status: 'draft',
          entityId: 'project_inventory:draft',
          derivedFromArtifactId: 'art_draft_inventory_with_chunks',
          metadata: {
            title: 'Draft source-chunk inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: historicalInventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_draft_inventory_with_chunks'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    expect(sectionIds).not.toContain('inventory_source_chunk_chunk_draft_historical_settlement_anchor');
    expect(sectionIds).not.toContain('knowledge_kart_draft_historical_anchor_inventory');
    expect(JSON.stringify(pack.sections)).not.toContain('applyDraftHistoricalAdjustment');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('does not use source-less current inventory records as historical source chunk fallback pointers', () => {
    const historicalInventoryJson = JSON.stringify({
      schemaVersion: 'ainp.project_inventory.v1',
      entrypoints: [],
      symbols: [],
      testSurfaces: [],
      hotspots: [],
      capabilities: [],
      sourceChunks: [
        {
          id: 'chunk_sourceless_pointer_historical_anchor',
          path: 'apps/api/src/refunds.ts',
          startLine: 40,
          endLine: 44,
          snippet: [
            'L40: export function applyLegacyAdjustment() {',
            'L41:   return policy.apply();',
            'L42: }',
          ].join('\n'),
          contentSha256: '7'.repeat(64),
          sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
          symbolRefs: ['sym_current_sourceless_settlement_workflow'],
          confidence: 0.69,
        },
      ],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix settlement workflow behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_without_source_refs',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_current_sourceless_settlement_workflow',
                kind: 'function',
                name: 'applySettlementWorkflow',
                path: 'apps/api/src/refunds.ts',
                line: 40,
                signature: 'export function applySettlementWorkflow()',
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [],
          }),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_historical_sourceless_pointer_inventory',
          kind: 'explore',
          status: 'accepted',
          entityId: 'project_inventory:latest',
          derivedFromArtifactId: 'art_previous_inventory_with_sourceless_anchor',
          metadata: {
            title: 'Previous source-chunk inventory',
            role: 'project_inventory',
            output: 'project-inventory.json',
            schemaVersion: 'ainp.project_inventory.v1',
            content: historicalInventoryJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_previous_inventory_with_sourceless_anchor'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id))
      .not.toContain('inventory_source_chunk_chunk_sourceless_pointer_historical_anchor');
    expect(JSON.stringify(pack.sections)).not.toContain('applyLegacyAdjustment');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.project_inventory.v1"');
  });

  test('draft standalone source chunk index knowledge does not feed current source chunks', () => {
    const standaloneIndexJson = JSON.stringify({
      schemaVersion: 'ainp.source_chunk_index.v1',
      generatedAt: '2026-07-03T00:00:00.000Z',
      source: 'project_inventory.sourceChunks',
      chunkCount: 1,
      maxEntries: 120,
      entries: [
        {
          id: 'src_chunk_idx_draft_refund_policy',
          sourceChunkRef: 'chunk_current_refund_policy_body',
          contentSha256: '7'.repeat(64),
          path: 'apps/api/src/refunds.ts',
          startLine: 40,
          endLine: 44,
          lexicalTokens: ['settlement', 'workflow', 'refund'],
          searchText: 'settlement workflow refund',
          linkedRecordRefs: ['symbol:settlement-workflow'],
          sourceRefs: ['file:apps/api/src/refunds.ts#L39'],
          entrypointRefs: [],
          symbolRefs: ['sym_refund_policy'],
          graphEdgeRefs: [],
          testRefs: [],
          hotspotRefs: [],
          capabilityRefs: [],
        },
      ],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix settlement workflow behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_draft_standalone_index',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_current_refund_policy_body',
                path: 'apps/api/src/refunds.ts',
                startLine: 40,
                endLine: 44,
                snippet: [
                  'L40: export function applyLegacyAdjustment() {',
                  'L41:   return policy.apply();',
                  'L42: }',
                ].join('\n'),
                contentSha256: '8'.repeat(64),
                sourceRefs: ['file:apps/api/src/refunds.ts#L40'],
                confidence: 0.72,
              },
            ],
          }),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_draft_standalone_source_chunk_index',
          kind: 'explore',
          status: 'draft',
          entityId: 'source_chunk_index:draft',
          derivedFromArtifactId: 'art_draft_source_chunk_index',
          metadata: {
            title: 'Draft source chunk lexical index',
            output: 'source-chunk-index.json',
            schemaVersion: 'ainp.source_chunk_index.v1',
            content: standaloneIndexJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_draft_source_chunk_index'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    expect(sectionIds).not.toContain('inventory_source_chunk_chunk_current_refund_policy_body');
    expect(sectionIds).not.toContain('knowledge_kart_draft_standalone_source_chunk_index');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
    expect(JSON.stringify(pack.sections)).not.toContain('src_chunk_idx_draft_refund_policy');
    expect(JSON.stringify(pack.sections)).not.toContain('file:apps/api/src/refunds.ts#L39');
  });

  test('standalone source chunk index without a matching source chunk does not render', () => {
    const standaloneIndexJson = JSON.stringify({
      schemaVersion: 'ainp.source_chunk_index.v1',
      generatedAt: '2026-07-03T00:00:00.000Z',
      source: 'project_inventory.sourceChunks',
      chunkCount: 1,
      maxEntries: 120,
      entries: [
        {
          id: 'src_chunk_idx_orphan_settlement',
          sourceChunkRef: 'chunk_orphan_settlement',
          contentSha256: '6'.repeat(64),
          path: 'apps/api/src/orphan.ts',
          startLine: 1,
          endLine: 3,
          lexicalTokens: ['settlement', 'workflow'],
          searchText: 'settlement workflow orphan index only',
          linkedRecordRefs: ['symbol:orphan-settlement'],
          sourceRefs: ['file:apps/api/src/orphan.ts#L1'],
          entrypointRefs: [],
          symbolRefs: [],
          graphEdgeRefs: [],
          testRefs: [],
          hotspotRefs: [],
          capabilityRefs: [],
        },
      ],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix settlement workflow behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_current_inventory_no_matching_source_chunk',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [],
          }),
        },
      ],
      knowledgeArtifacts: [
        knowledgeArtifactFixture({
          id: 'kart_orphan_source_chunk_index',
          kind: 'explore',
          status: 'accepted',
          entityId: 'source_chunk_index:orphan',
          derivedFromArtifactId: 'art_orphan_source_chunk_index',
          metadata: {
            title: 'Orphan source chunk lexical index',
            output: 'source-chunk-index.json',
            schemaVersion: 'ainp.source_chunk_index.v1',
            content: standaloneIndexJson,
            knowledgeClass: 'recovered',
            trustLevel: 'source',
            freshness: 'possibly_stale',
            sourceRefs: ['artifact:art_orphan_source_chunk_index'],
          },
        }),
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).not.toContain('knowledge_kart_orphan_source_chunk_index');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_orphan_settlement');
    expect(JSON.stringify(pack.sections)).not.toContain('orphan index only');
    expect(JSON.stringify(pack.sections)).not.toContain('"schemaVersion":"ainp.source_chunk_index.v1"');
  });

  test('matches reconciliation task wording to reconcile source evidence', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Repair reconciliation behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_reconcile_wording',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_reconcile_wording',
                path: 'apps/api/src/reconcile.ts',
                startLine: 10,
                endLine: 12,
                snippet: 'L10: export function reconcileInvoice() {\nL11:   return true;\nL12: }',
                sourceRefs: ['file:apps/api/src/reconcile.ts#L10'],
                confidence: 0.72,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_reconcile_wording');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_reconcile_wording',
        'file:apps/api/src/reconcile.ts#L10',
      ]),
    });
    expect(chunk?.content).toContain('reconcileInvoice');
  });

  test('selects source chunks from explicit task source refs and narrows to the referenced line', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Inspect file:apps/api/src/payments.ts#L20 before changing behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_source_ref',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_payment_line_window',
                path: 'apps/api/src/payments.ts',
                startLine: 18,
                endLine: 22,
                snippet: [
                  'L18: export function unrelatedOrdersAudit() { return []; }',
                  'L20:   return ledger.apply();',
                  'L22: export function listCustomers() { return []; }',
                ].join('\n'),
                sourceRefs: [
                  'file:apps/api/src/payments.ts#L18',
                  'file:apps/api/src/payments.ts#L20',
                  'file:apps/api/src/payments.ts#L22',
                ],
                confidence: 0.7,
              },
              {
                id: 'chunk_other_file',
                path: 'apps/api/src/customers.ts',
                startLine: 20,
                endLine: 22,
                snippet: 'L20: export function listCustomers() { return []; }',
                sourceRefs: ['file:apps/api/src/customers.ts#L20'],
                confidence: 0.7,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_payment_line_window');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_source_ref',
        'file:apps/api/src/payments.ts#L20',
      ]),
    });
    expect(chunk?.reason).toContain('task source ref matched this chunk');
    expect(chunk?.content).toContain('Matched source refs: file:apps/api/src/payments.ts#L20');
    expect(chunk?.content).toContain('L20:   return ledger.apply();');
    expect(chunk?.content).not.toContain('unrelatedOrdersAudit');
    expect(chunk?.content).not.toContain('listCustomers');
    expect(chunk).not.toMatchObject({
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/payments.ts#L18',
        'file:apps/api/src/payments.ts#L22',
      ]),
    });
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_other_file');
  });

  test.each([
    ['/tmp/workspace/apps/api/src/payments.ts#L20'],
    ['/repo/apps/api/src/payments.ts#L20'],
  ])('normalizes absolute source ref %s before matching source chunks', (sourceRef) => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: `Inspect ${sourceRef} before changing behavior.`,
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_absolute_source_ref',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_payment_line_window',
                path: 'apps/api/src/payments.ts',
                startLine: 18,
                endLine: 22,
                snippet: [
                  'L18: export function unrelatedOrdersAudit() { return []; }',
                  'L20:   return ledger.apply();',
                  'L22: export function listCustomers() { return []; }',
                ].join('\n'),
                sourceRefs: [
                  'file:apps/api/src/payments.ts#L18',
                  'file:apps/api/src/payments.ts#L20',
                  'file:apps/api/src/payments.ts#L22',
                ],
                confidence: 0.7,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_payment_line_window');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_absolute_source_ref',
        'file:apps/api/src/payments.ts#L20',
      ]),
    });
    expect(chunk?.reason).toContain('task source ref matched this chunk');
    expect(chunk?.content).toContain('Matched source refs: file:apps/api/src/payments.ts#L20');
    expect(chunk?.content).toContain('L20:   return ledger.apply();');
    expect(chunk?.content).not.toContain('unrelatedOrdersAudit');
    expect(chunk?.content).not.toContain('listCustomers');
  });

  test('does not let explicit source refs select unrelated hybrid records by path text', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Inspect file:apps/api/src/payments.ts#L20 before changing behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_source_ref_hybrid_noise',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_unrelated_customer_audit',
                kind: 'class',
                name: 'CustomerAuditReporter',
                path: 'apps/api/src/payments.ts',
                exported: true,
                line: 4,
                signature: 'export class CustomerAuditReporter',
                sourceRefs: ['file:apps/api/src/payments.ts#L4'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_payment_line_window',
                path: 'apps/api/src/payments.ts',
                startLine: 18,
                endLine: 22,
                snippet: [
                  'L18: export class CustomerAuditReporter {}',
                  'L20:   return ledger.apply();',
                  'L22: export function listCustomers() { return []; }',
                ].join('\n'),
                sourceRefs: [
                  'file:apps/api/src/payments.ts#L18',
                  'file:apps/api/src/payments.ts#L20',
                  'file:apps/api/src/payments.ts#L22',
                ],
                confidence: 0.7,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.map((section) => section.id)).not.toContain(
      'inventory_hybrid_sym_unrelated_customer_audit',
    );
    expect(JSON.stringify(pack.sections)).not.toContain('CustomerAuditReporter');
    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_payment_line_window');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_source_ref_hybrid_noise',
        'file:apps/api/src/payments.ts#L20',
      ]),
    });
    expect(chunk?.content).toContain('L20:   return ledger.apply();');
    expect(chunk?.content).not.toContain('CustomerAuditReporter');
    expect(chunk?.content).not.toContain('listCustomers');
  });

  test('uses explicit source refs to select inventory capabilities when source chunks are absent', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Inspect file:apps/api/src/routes.ts#L11 before changing behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_source_ref_capability',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_orders_delete',
                kind: 'http_route',
                label: 'DELETE /api/orders/:id',
                path: 'apps/api/src/routes.ts',
                method: 'DELETE',
                route: '/api/orders/:id',
                handler: 'deleteOrder',
                sourceRefs: ['file:apps/api/src/routes.ts#L10'],
                confidence: 0.9,
              },
              {
                id: 'entry_payments_get',
                kind: 'http_route',
                label: 'GET /api/payments',
                path: 'apps/api/src/routes.ts',
                method: 'GET',
                route: '/api/payments',
                handler: 'listPayments',
                sourceRefs: ['file:apps/api/src/routes.ts#L20'],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_delete_order',
                kind: 'function',
                name: 'deleteOrder',
                path: 'apps/api/src/routes.ts',
                exported: true,
                line: 11,
                signature: 'export function deleteOrder()',
                sourceRefs: ['file:apps/api/src/routes.ts#L11'],
              },
              {
                id: 'sym_list_payments',
                kind: 'function',
                name: 'listPayments',
                path: 'apps/api/src/routes.ts',
                exported: true,
                line: 21,
                signature: 'export function listPayments()',
                sourceRefs: ['file:apps/api/src/routes.ts#L21'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_orders',
                label: 'Orders API',
                kind: 'api',
                entrypointRefs: ['entry_orders_delete'],
                moduleRefs: [],
                symbolRefs: ['sym_delete_order'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/routes.ts#L10'],
                confidence: 0.92,
                openQuestions: [],
              },
              {
                id: 'cap_api_payments',
                label: 'Payments API',
                kind: 'api',
                entrypointRefs: ['entry_payments_get'],
                moduleRefs: [],
                symbolRefs: ['sym_list_payments'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/routes.ts#L20'],
                confidence: 0.91,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_orders');
    expect(capability).toMatchObject({
      sourceType: 'code_probe',
      reason: expect.stringContaining('matched explicit task source refs'),
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_source_ref_capability',
        'file:apps/api/src/routes.ts#L11',
      ]),
    });
    expect(capability?.content).toContain('DELETE /api/orders/:id');
    expect(capability?.content).toContain('deleteOrder');
    expect(capability?.content).not.toContain('/api/payments');
    expect(capability?.content).not.toContain('listPayments');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_capability_cap_api_payments');
    expect(pack.sections.map((section) => section.id)).not.toContain('input_project_inventory_json');
  });

  test('prefers exact capability source refs over sibling token matches', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Inspect file:apps/api/src/routes.ts#L11 while fixing payments behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_source_ref_capability_precedence',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_orders_delete',
                kind: 'http_route',
                label: 'DELETE /api/orders/:id',
                path: 'apps/api/src/routes.ts',
                method: 'DELETE',
                route: '/api/orders/:id',
                handler: 'deleteOrder',
                sourceRefs: ['file:apps/api/src/routes.ts#L10'],
                confidence: 0.9,
              },
              {
                id: 'entry_payments_get',
                kind: 'http_route',
                label: 'GET /api/payments',
                path: 'apps/api/src/routes.ts',
                method: 'GET',
                route: '/api/payments',
                handler: 'listPayments',
                sourceRefs: ['file:apps/api/src/routes.ts#L20'],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_delete_order',
                kind: 'function',
                name: 'deleteOrder',
                path: 'apps/api/src/routes.ts',
                exported: true,
                line: 11,
                signature: 'export function deleteOrder()',
                sourceRefs: ['file:apps/api/src/routes.ts#L11'],
              },
              {
                id: 'sym_list_payments',
                kind: 'function',
                name: 'listPayments',
                path: 'apps/api/src/routes.ts',
                exported: true,
                line: 21,
                signature: 'export function listPayments()',
                sourceRefs: ['file:apps/api/src/routes.ts#L21'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_orders',
                label: 'Orders API',
                kind: 'api',
                entrypointRefs: ['entry_orders_delete'],
                moduleRefs: [],
                symbolRefs: ['sym_delete_order'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/routes.ts#L10'],
                confidence: 0.92,
                openQuestions: [],
              },
              {
                id: 'cap_api_payments',
                label: 'Payments API',
                kind: 'api',
                entrypointRefs: ['entry_payments_get'],
                moduleRefs: [],
                symbolRefs: ['sym_list_payments'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/routes.ts#L20'],
                confidence: 0.91,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_orders');
    expect(capability).toMatchObject({
      sourceType: 'code_probe',
      reason: expect.stringContaining('matched explicit task source refs'),
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_source_ref_capability_precedence',
        'file:apps/api/src/routes.ts#L11',
      ]),
    });
    expect(capability?.content).toContain('DELETE /api/orders/:id');
    expect(capability?.content).not.toContain('/api/payments');
    expect(capability?.content).not.toContain('listPayments');
    expect(sectionIds).not.toContain('inventory_capability_cap_api_payments');
    expect(sectionIds).not.toContain('inventory_symbols_payments-api');
  });

  test('selects source chunks pointed to by hybrid inventory evidence', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix refund reconciliation rounding.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_refund_reconciliation',
                kind: 'class',
                name: 'RefundReconciliationService',
                path: 'apps/api/src/refunds.ts',
                exported: true,
                line: 12,
                signature: 'export class RefundReconciliationService',
                sourceRefs: ['file:apps/api/src/refunds.ts#L12'],
                sourceChunkRefs: ['chunk_refund_service_body'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            symbolGraph: {
              parser: 'typescript_ast',
              nodes: [],
              edges: [
                {
                  id: 'edge_refund_repository',
                  kind: 'symbol_reference',
                  from: 'node_symbol_sym_refund_reconciliation',
                  to: 'node_symbol_sym_refund_repository',
                  label: 'uses RefundRepository',
                  sourceRefs: ['file:apps/api/src/refunds.ts#L20'],
                  confidence: 0.72,
                },
              ],
            },
            sourceChunks: [
              {
                id: 'chunk_refund_service_body',
                path: 'apps/api/src/refunds.ts',
                startLine: 13,
                endLine: 18,
                snippet: 'L13:   settle(amountInCents: number) {\nL14:     const cents = amountInCents.toString();\nL15:     return cents;\nL16:   }',
                sourceRefs: ['file:apps/api/src/refunds.ts#L13'],
                confidence: 0.7,
              },
              {
                id: 'chunk_repository_call_site',
                path: 'apps/api/src/refunds.ts',
                startLine: 20,
                endLine: 22,
                snippet: 'L20:     return repository.loadLedger();\nL21:   }',
                graphEdgeRefs: ['edge_refund_repository'],
                sourceRefs: ['file:apps/api/src/refunds.ts#L20'],
                confidence: 0.7,
              },
              {
                id: 'chunk_unpointed',
                path: 'apps/api/src/audit.ts',
                startLine: 1,
                endLine: 3,
                snippet: 'L1: export function auditTrail() {}',
                sourceRefs: ['file:apps/api/src/audit.ts#L1'],
                confidence: 0.7,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(pack.sections.find((section) => section.id === 'inventory_hybrid_sym_refund_reconciliation'))
      .toMatchObject({ sourceType: 'code_probe' });
    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_refund_service_body');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'file:apps/api/src/refunds.ts#L13',
        'file:apps/api/src/refunds.ts#L12',
      ]),
    });
    expect(chunk?.reason).toContain('hybrid inventory evidence points to this chunk');
    expect(chunk?.content).toContain('Pointed by inventory evidence: sym_refund_reconciliation');
    const edgeChunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_repository_call_site');
    expect(edgeChunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'file:apps/api/src/refunds.ts#L20',
      ]),
    });
    expect(edgeChunk?.reason).toContain('hybrid inventory evidence points to this chunk');
    expect(edgeChunk?.content).toContain('Pointed by inventory evidence: edge_refund_repository');
    expect(edgeChunk?.content).toContain('symbol_reference | edge_refund_repository | uses RefundRepository');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_source_chunk_chunk_unpointed');
  });

  test('keeps graph-pointed source chunks ahead of broad lexical chunks', () => {
    const lexicalChunks = Array.from({ length: 4 }, (_, index) => ({
      id: `chunk_refund_lexical_noise_${index + 1}`,
      path: `apps/api/src/refund-noise-${index + 1}.ts`,
      startLine: 1,
      endLine: 3,
      snippet: [
        `L1: export function refundReconciliationRoundingNoise${index + 1}() {`,
        'L2:   return "refund reconciliation rounding";',
        'L3: }',
      ].join('\n'),
      sourceRefs: [`file:apps/api/src/refund-noise-${index + 1}.ts#L1`],
      confidence: 0.75,
    }));
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix refund reconciliation rounding.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_refund_reconciliation',
                kind: 'class',
                name: 'RefundReconciliationService',
                path: 'apps/api/src/refunds.ts',
                exported: true,
                line: 12,
                signature: 'export class RefundReconciliationService',
                sourceRefs: ['file:apps/api/src/refunds.ts#L12'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            symbolGraph: {
              parser: 'typescript_ast',
              nodes: [],
              edges: [
                {
                  id: 'edge_refund_repository',
                  kind: 'symbol_reference',
                  from: 'node_symbol_sym_refund_reconciliation',
                  to: 'node_symbol_sym_refund_repository',
                  label: 'uses RefundRepository',
                  sourceRefs: ['file:apps/api/src/refunds.ts#L20'],
                  confidence: 0.72,
                },
              ],
            },
            sourceChunks: [
              ...lexicalChunks,
              {
                id: 'chunk_repository_call_site',
                path: 'apps/api/src/refunds.ts',
                startLine: 20,
                endLine: 22,
                snippet: 'L20:     return repository.loadLedger();\nL21:   }',
                graphEdgeRefs: ['edge_refund_repository'],
                sourceRefs: ['file:apps/api/src/refunds.ts#L20'],
                confidence: 0.7,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sourceChunkIds = pack.sections
      .filter((section) => section.id.startsWith('inventory_source_chunk_'))
      .map((section) => section.id);
    expect(sourceChunkIds).toContain('inventory_source_chunk_chunk_repository_call_site');
    expect(sourceChunkIds).toHaveLength(4);
    expect(sourceChunkIds).not.toContain('inventory_source_chunk_chunk_refund_lexical_noise_4');
    const pointedChunk = pack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_repository_call_site'
    ));
    expect(pointedChunk?.reason).toContain('hybrid inventory evidence points to this chunk');
    expect(pointedChunk?.content).toContain('Pointed by inventory evidence: edge_refund_repository');
  });

  test('keeps capability matches primary while source refs add hybrid graph evidence', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing statements behavior. Inspect file:apps/api/src/domain.ts#L77 before changing it.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_source_ref_hybrid_supplement',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_statements',
                kind: 'http_route',
                label: 'GET /billing/statements',
                path: 'apps/api/src/billing-routes.ts',
                method: 'GET',
                route: '/billing/statements',
                handler: 'listBillingStatements',
                sourceRefs: ['file:apps/api/src/billing-routes.ts#L8'],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_statements',
                kind: 'function',
                name: 'listBillingStatements',
                path: 'apps/api/src/billing-routes.ts',
                exported: true,
                line: 9,
                signature: 'export function listBillingStatements()',
                sourceRefs: ['file:apps/api/src/billing-routes.ts#L9'],
              },
              {
                id: 'sym_unrelated_same_file',
                kind: 'class',
                name: 'CustomerAuditReporter',
                path: 'apps/api/src/domain.ts',
                exported: true,
                line: 4,
                signature: 'export class CustomerAuditReporter',
                sourceRefs: ['file:apps/api/src/domain.ts#L4'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_billing_statements',
                label: 'Billing Statements API',
                kind: 'api',
                entrypointRefs: ['entry_billing_statements'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_statements'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/billing-routes.ts#L8'],
                confidence: 0.93,
                openQuestions: [],
              },
            ],
            symbolGraph: {
              parser: 'typescript_ast',
              nodes: [],
              edges: [
                {
                  id: 'edge_ledger_handoff',
                  kind: 'symbol_reference',
                  from: 'node_symbol_sym_billing_statements',
                  to: 'node_symbol_sym_ledger_writer',
                  label: 'ledger writer handoff',
                  sourceRefs: ['file:apps/api/src/domain.ts#L77'],
                  confidence: 0.72,
                },
              ],
            },
            sourceChunks: [
              {
                id: 'chunk_ledger_handoff_call',
                path: 'apps/api/src/domain.ts',
                startLine: 75,
                endLine: 79,
                snippet: [
                  'L75: export class CustomerAuditReporter {}',
                  'L77:   return ledgerWriter.persist(statement);',
                  'L79: export function listCustomers() { return []; }',
                ].join('\n'),
                graphEdgeRefs: ['edge_ledger_handoff'],
                sourceRefs: [
                  'file:apps/api/src/domain.ts#L75',
                  'file:apps/api/src/domain.ts#L77',
                  'file:apps/api/src/domain.ts#L79',
                ],
                confidence: 0.7,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    expect(sectionIds).toContain('inventory_capability_cap_billing_statements');
    const hybridEdge = pack.sections.find((section) => section.id === 'inventory_hybrid_edge_ledger_handoff');
    expect(hybridEdge).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_source_ref_hybrid_supplement',
        'file:apps/api/src/domain.ts#L77',
      ]),
    });
    expect(hybridEdge?.reason).toContain('matched explicit task source refs');
    expect(hybridEdge?.content).toContain('Matched source refs: file:apps/api/src/domain.ts#L77');
    expect(hybridEdge?.content).toContain('ledger writer handoff');
    expect(sectionIds).not.toContain('inventory_hybrid_sym_unrelated_same_file');

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_ledger_handoff_call');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_source_ref_hybrid_supplement',
        'file:apps/api/src/domain.ts#L77',
      ]),
    });
    expect(chunk?.content).toContain('Pointed by inventory evidence: edge_ledger_handoff');
    expect(chunk?.content).toContain('L77:   return ledgerWriter.persist(statement);');
    expect(chunk?.content).not.toContain('CustomerAuditReporter');
    expect(chunk?.content).not.toContain('listCustomers');
  });

  test('does not let path-only source hints supplement capability matches with unrelated hybrid records', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing statements behavior. Inspect file:apps/api/src/domain.ts before changing it.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_path_only_hybrid_supplement',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_statements',
                kind: 'http_route',
                label: 'GET /billing/statements',
                path: 'apps/api/src/billing-routes.ts',
                method: 'GET',
                route: '/billing/statements',
                handler: 'listBillingStatements',
                sourceRefs: ['file:apps/api/src/billing-routes.ts#L8'],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_statements',
                kind: 'function',
                name: 'listBillingStatements',
                path: 'apps/api/src/billing-routes.ts',
                exported: true,
                line: 9,
                signature: 'export function listBillingStatements()',
                sourceRefs: ['file:apps/api/src/billing-routes.ts#L9'],
              },
              {
                id: 'sym_unrelated_same_file',
                kind: 'class',
                name: 'CustomerAuditReporter',
                path: 'apps/api/src/domain.ts',
                exported: true,
                line: 4,
                signature: 'export class CustomerAuditReporter',
                sourceRefs: ['file:apps/api/src/domain.ts#L4'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_billing_statements',
                label: 'Billing Statements API',
                kind: 'api',
                entrypointRefs: ['entry_billing_statements'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_statements'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/billing-routes.ts#L8'],
                confidence: 0.93,
                openQuestions: [],
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    expect(sectionIds).toContain('inventory_capability_cap_billing_statements');
    expect(sectionIds).not.toContain('inventory_hybrid_sym_unrelated_same_file');
    expect(JSON.stringify(pack.sections)).not.toContain('CustomerAuditReporter');
  });

  test('does not let path-only source hints supplement capability matches with unrelated source chunks', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing statements behavior. Inspect file:apps/api/src/domain.ts before changing it.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_path_only_source_chunk_supplement',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_statements',
                kind: 'http_route',
                label: 'GET /billing/statements',
                path: 'apps/api/src/billing-routes.ts',
                method: 'GET',
                route: '/billing/statements',
                handler: 'listBillingStatements',
                sourceRefs: ['file:apps/api/src/billing-routes.ts#L8'],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_statements',
                kind: 'function',
                name: 'listBillingStatements',
                path: 'apps/api/src/billing-routes.ts',
                exported: true,
                line: 9,
                signature: 'export function listBillingStatements()',
                sourceRefs: ['file:apps/api/src/billing-routes.ts#L9'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_billing_statements',
                label: 'Billing Statements API',
                kind: 'api',
                entrypointRefs: ['entry_billing_statements'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_statements'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/billing-routes.ts#L8'],
                confidence: 0.93,
                openQuestions: [],
              },
            ],
            sourceChunks: [
              {
                id: 'chunk_unrelated_same_file_customer_audit',
                path: 'apps/api/src/domain.ts',
                startLine: 3,
                endLine: 6,
                snippet: [
                  'L3: export class CustomerAuditReporter {',
                  'L4:   buildCustomerAuditTrail() { return []; }',
                  'L5: }',
                ].join('\n'),
                sourceRefs: ['file:apps/api/src/domain.ts#L3', 'file:apps/api/src/domain.ts#L4'],
                confidence: 0.7,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    expect(sectionIds).toContain('inventory_capability_cap_billing_statements');
    expect(sectionIds).not.toContain('inventory_source_chunk_chunk_unrelated_same_file_customer_audit');
    expect(JSON.stringify(pack.sections)).not.toContain('CustomerAuditReporter');
    expect(JSON.stringify(pack.sections)).not.toContain('buildCustomerAuditTrail');
  });

  test('uses symbol graph edges as first-class hybrid fallback evidence', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix settlement drift handoff behavior.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [
              {
                id: 'sym_payment_coordinator',
                kind: 'class',
                name: 'PaymentCoordinator',
                path: 'apps/api/src/payments.ts',
                line: 4,
                signature: 'export class PaymentCoordinator',
                sourceRefs: ['file:apps/api/src/payments.ts#L4'],
              },
              {
                id: 'sym_ledger_store',
                kind: 'class',
                name: 'LedgerStore',
                path: 'apps/api/src/ledger.ts',
                line: 1,
                signature: 'export class LedgerStore',
                sourceRefs: ['file:apps/api/src/ledger.ts#L1'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            symbolGraph: {
              parser: 'typescript_ast',
              nodes: [],
              edges: [
                {
                  id: 'edge_payment_to_ledger',
                  kind: 'symbol_reference',
                  from: 'node_symbol_sym_payment_coordinator',
                  to: 'node_symbol_sym_ledger_store',
                  label: 'settlement drift handoff',
                  sourceRefs: ['file:apps/api/src/payments.ts#L20'],
                  confidence: 0.71,
                },
              ],
            },
            sourceChunks: [
              {
                id: 'chunk_payment_handoff_call',
                path: 'apps/api/src/payments.ts',
                startLine: 18,
                endLine: 22,
                snippet: [
                  'L18: export function unrelatedOrdersAudit() { return []; }',
                  'L20:   return ledger.apply();',
                  'L22: export function listCustomers() { return []; }',
                ].join('\n'),
                graphEdgeRefs: ['edge_payment_to_ledger'],
                sourceRefs: [
                  'file:apps/api/src/payments.ts#L18',
                  'file:apps/api/src/payments.ts#L20',
                  'file:apps/api/src/payments.ts#L22',
                ],
                confidence: 0.7,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const hybridEdge = pack.sections.find((section) => section.id === 'inventory_hybrid_edge_payment_to_ledger');
    expect(hybridEdge).toMatchObject({
      title: 'Hybrid Retrieval: symbol_graph_edge settlement drift handoff',
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'file:apps/api/src/payments.ts#L20',
      ]),
    });
    expect(hybridEdge?.reason).toContain('bm25=');
    expect(hybridEdge?.content).toContain('Graph Edge:');
    expect(hybridEdge?.content).toContain('settlement drift handoff');
    expect(pack.sections.map((section) => section.id)).not.toContain('inventory_hybrid_sym_payment_coordinator');

    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_payment_handoff_call');
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory',
        'file:apps/api/src/payments.ts#L20',
      ]),
    });
    expect(chunk?.reason).toContain('hybrid inventory evidence points to this chunk');
    expect(chunk?.content).toContain('Pointed by inventory evidence: edge_payment_to_ledger');
    expect(chunk?.content).toContain('L20:   return ledger.apply();');
    expect(chunk?.content).not.toContain('unrelatedOrdersAudit');
    expect(chunk?.content).not.toContain('listCustomers');
    expect(chunk).not.toMatchObject({
      sourceRefs: expect.arrayContaining(['file:apps/api/src/payments.ts#L18']),
    });
    expect(chunk).not.toMatchObject({
      sourceRefs: expect.arrayContaining(['file:apps/api/src/payments.ts#L22']),
    });
  });

  test('keeps capability-map evidence primary when matching source chunks also exist', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement deleting orders in the Orders API.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify(legacyOrdersInventoryFixture()),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const capability = pack.sections.find((section) => section.id === 'inventory_capability_cap_api_orders');
    const chunk = pack.sections.find((section) => section.id === 'inventory_source_chunk_chunk_orders_delete_handler');
    expect(capability).toMatchObject({
      sourceType: 'code_probe',
      priority: 1,
      reason: expect.stringContaining('Project inventory capability matched the task brief'),
    });
    expect(chunk).toMatchObject({
      sourceType: 'code_probe',
      priority: 2,
      reason: expect.stringContaining('source snippet matched the task brief'),
    });
    expect(chunk?.content).toContain('deleteOrder');
  });

  test('drops weak one-token capability matches when stronger capability matches exist', () => {
    const inventory = legacyOrdersInventoryFixture();
    const entrypoints = inventory.entrypoints as Array<Record<string, unknown>>;
    const hotspots = inventory.hotspots as Array<Record<string, unknown>>;
    const capabilities = inventory.capabilities as Array<Record<string, unknown>>;
    entrypoints.push({
      id: 'entry_cli_start',
      kind: 'cli_script',
      label: 'Script: start',
      path: 'package.json',
      handler: 'node apps/api/src/orders-route.ts',
      sourceRefs: ['file:package.json#L1'],
      confidence: 0.85,
    });
    hotspots.push({
      id: 'hot_cli_start',
      path: 'package.json',
      reason: 'script_start',
      score: 0.85,
      sourceRefs: ['file:package.json#L1'],
    });
    capabilities.push({
      id: 'cap_cli_start',
      label: 'CLI Start',
      kind: 'cli',
      entrypointRefs: ['entry_cli_start'],
      moduleRefs: [],
      symbolRefs: [],
      testRefs: [],
      hotspotRefs: ['hot_cli_start'],
      sourceRefs: ['file:package.json#L1'],
      confidence: 0.85,
      openQuestions: [],
    });

    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement deleting orders in the Orders API.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_weak_cli_match',
          content: JSON.stringify(inventory),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    expect(sectionIds).toContain('inventory_capability_cap_api_orders');
    expect(sectionIds).not.toContain('inventory_capability_cap_cli_start');
    expect(sectionIds).not.toContain('inventory_hotspots_cli_start');
    expect(JSON.stringify(pack.sections)).not.toContain('CLI Start');
  });

  test('keeps capability-matched source chunks scoped to linked inventory evidence', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement deleting orders in the Orders API.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_linked_chunk_scope',
          content: JSON.stringify({
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
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_orders',
                label: 'Orders API',
                kind: 'api',
                entrypointRefs: ['entry_orders_delete'],
                moduleRefs: [],
                symbolRefs: [],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:apps/api/src/orders-route.ts#L10'],
                confidence: 0.92,
                openQuestions: [],
              },
            ],
            sourceChunks: [
              {
                id: 'chunk_orders_delete_handler',
                path: 'apps/api/src/orders-route.ts',
                startLine: 10,
                endLine: 13,
                snippet: [
                  'L10: export function deleteOrder() {',
                  'L11:   return orderService.deleteOrder();',
                  'L12: }',
                ].join('\n'),
                sourceRefs: ['file:apps/api/src/orders-route.ts#L11'],
                capabilityRefs: ['cap_api_orders'],
                confidence: 0.78,
              },
              {
                id: 'chunk_unlinked_orders_delete_noise',
                path: 'apps/api/src/admin-notes.ts',
                startLine: 1,
                endLine: 3,
                snippet: [
                  'L1: export function deleteOrdersMaintenanceNote() {',
                  'L2:   return "delete orders cleanup notes";',
                  'L3: }',
                ].join('\n'),
                sourceRefs: ['file:apps/api/src/admin-notes.ts#L1'],
                confidence: 0.8,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    const linkedChunk = pack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_orders_delete_handler'
    ));

    expect(sectionIds).toContain('inventory_capability_cap_api_orders');
    expect(linkedChunk).toMatchObject({
      sourceType: 'code_probe',
      sourceRefs: expect.arrayContaining([
        'artifact:art_inventory_linked_chunk_scope',
        'file:apps/api/src/orders-route.ts#L10',
      ]),
    });
    expect(linkedChunk?.reason).toContain('source snippet matched the task brief');
    expect(linkedChunk?.content).toContain('deleteOrder');
    expect(sectionIds).not.toContain('inventory_source_chunk_chunk_unlinked_orders_delete_noise');
    expect(JSON.stringify(pack.sections)).not.toContain('deleteOrdersMaintenanceNote');
  });

  test('does not point source chunks through shared application-level source refs', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Fix billing reconciliation in the legacy JAX-RS resource.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory_shared_app_ref',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [
              {
                id: 'entry_billing_reconcile',
                kind: 'http_route',
                label: 'POST /api/v1/billing/reconcile',
                path: 'src/main/java/com/acme/legacy/billing/BillingResource.java',
                method: 'POST',
                route: '/api/v1/billing/reconcile',
                handler: 'reconcileInvoice',
                sourceRefs: [
                  'file:src/main/java/com/acme/legacy/LegacyApplication.java#L3',
                  'file:src/main/java/com/acme/legacy/billing/BillingResource.java#L7',
                ],
                confidence: 0.9,
              },
            ],
            symbols: [
              {
                id: 'sym_billing_reconcile',
                kind: 'method',
                name: 'reconcileInvoice',
                path: 'src/main/java/com/acme/legacy/billing/BillingResource.java',
                exported: false,
                line: 8,
                signature: 'Response reconcileInvoice()',
                sourceRefs: ['file:src/main/java/com/acme/legacy/billing/BillingResource.java#L8'],
              },
            ],
            testSurfaces: [],
            hotspots: [],
            capabilities: [
              {
                id: 'cap_api_billing',
                label: 'Billing API',
                kind: 'api',
                entrypointRefs: ['entry_billing_reconcile'],
                moduleRefs: [],
                symbolRefs: ['sym_billing_reconcile'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/java/com/acme/legacy/billing/BillingResource.java#L7'],
                confidence: 0.9,
                openQuestions: [],
              },
              {
                id: 'cap_api_customers',
                label: 'Customers API',
                kind: 'api',
                entrypointRefs: ['entry_customer_profile'],
                moduleRefs: [],
                symbolRefs: ['sym_customer_profile'],
                testRefs: [],
                hotspotRefs: [],
                sourceRefs: ['file:src/main/java/com/acme/legacy/customers/CustomerResource.java#L7'],
                confidence: 0.9,
                openQuestions: [],
              },
            ],
            symbolGraph: {
              parser: 'heuristic',
              nodes: [],
              edges: [
                {
                  id: 'edge_billing_route_handler',
                  kind: 'route_handler',
                  from: 'node_entrypoint_entry_billing_reconcile',
                  to: 'node_symbol_sym_billing_reconcile',
                  label: 'route handler reconcileInvoice',
                  sourceRefs: [
                    'file:src/main/java/com/acme/legacy/LegacyApplication.java#L3',
                    'file:src/main/java/com/acme/legacy/billing/BillingResource.java#L8',
                  ],
                  confidence: 0.86,
                },
              ],
            },
            sourceChunks: [
              {
                id: 'chunk_billing_resource',
                path: 'src/main/java/com/acme/legacy/billing/BillingResource.java',
                startLine: 7,
                endLine: 9,
                snippet: 'L7: @POST\nL8: Response reconcileInvoice() { return service.reconcile(); }\nL9: }',
                entrypointRefs: ['entry_billing_reconcile'],
                symbolRefs: ['sym_billing_reconcile'],
                graphEdgeRefs: ['edge_billing_route_handler'],
                capabilityRefs: ['cap_api_billing'],
                sourceRefs: [
                  'file:src/main/java/com/acme/legacy/LegacyApplication.java#L3',
                  'file:src/main/java/com/acme/legacy/billing/BillingResource.java#L8',
                ],
                confidence: 0.75,
              },
              {
                id: 'chunk_customer_resource_shared_app_ref',
                path: 'src/main/java/com/acme/legacy/customers/CustomerResource.java',
                startLine: 7,
                endLine: 9,
                snippet: 'L7: @GET\nL8: Response showCustomer() { return Response.ok().build(); }\nL9: }',
                entrypointRefs: ['entry_customer_profile'],
                symbolRefs: ['sym_customer_profile'],
                capabilityRefs: ['cap_api_customers'],
                sourceRefs: [
                  'file:src/main/java/com/acme/legacy/LegacyApplication.java#L3',
                  'file:src/main/java/com/acme/legacy/customers/CustomerResource.java#L8',
                ],
                confidence: 0.75,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const sectionIds = pack.sections.map((section) => section.id);
    expect(sectionIds).toContain('inventory_source_chunk_chunk_billing_resource');
    expect(sectionIds).not.toContain('inventory_source_chunk_chunk_customer_resource_shared_app_ref');
    expect(JSON.stringify(pack.sections)).not.toContain('showCustomer');
  });

  test('source chunk source refs cite matched lines without adjacent same-file routes', () => {
    const pack = buildContextPack({
      project: projectFixture(),
      run: runFixture(),
      stage: 'implementation',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      taskBrief: 'Implement deleting orders in the Orders API.',
      inputArtifacts: [
        {
          name: 'project-inventory.json',
          artifactId: 'art_inventory',
          content: JSON.stringify({
            schemaVersion: 'ainp.project_inventory.v1',
            entrypoints: [],
            symbols: [],
            testSurfaces: [],
            hotspots: [],
            capabilities: [],
            sourceChunks: [
              {
                id: 'chunk_orders_and_payments_routes',
                path: 'apps/api/src/orders-route.ts',
                startLine: 10,
                endLine: 12,
                snippet: [
                  'L10: export function deleteOrder() {}',
                  'L11: router.delete("/api/orders/:id", deleteOrder);',
                  'L12: router.get("/api/payments", listPayments);',
                ].join('\n'),
                sourceRefs: [
                  'file:apps/api/src/orders-route.ts#L10',
                  'file:apps/api/src/orders-route.ts#L11',
                  'file:apps/api/src/orders-route.ts#L12',
                ],
                entrypointRefs: ['entry_orders_delete', 'entry_payments_get'],
                capabilityRefs: ['cap_api_orders', 'cap_api_payments'],
                confidence: 0.75,
              },
            ],
          }),
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    const chunk = pack.sections.find((section) => (
      section.id === 'inventory_source_chunk_chunk_orders_and_payments_routes'
    ));
    expect(chunk).toBeDefined();
    expect(chunk).toMatchObject({ sourceType: 'code_probe' });
    const chunkSourceRefs = chunk?.sourceRefs ?? [];
    expect(chunkSourceRefs).toEqual(expect.arrayContaining([
      'artifact:art_inventory',
      'file:apps/api/src/orders-route.ts#L10',
      'file:apps/api/src/orders-route.ts#L11',
    ]));
    expect(chunkSourceRefs).not.toContain('file:apps/api/src/orders-route.ts#L12');
    expect(chunk?.content).not.toContain('/api/payments');
    expect(chunk?.content).not.toContain('entry_payments_get');
    expect(chunk?.content).not.toContain('cap_api_payments');
    expect(chunk?.content).not.toContain('entry_orders_delete');
    expect(chunk?.content).not.toContain('cap_api_orders');
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
      retryIndex: 1,
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    expect(supplement.supplement).toEqual({
      contextRequestId: 'ctxreq_test',
      baseContextPackId: base.id,
      retryIndex: 1,
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
        retryIndex: 1,
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

function legacyOrdersInventoryFixture(): Record<string, unknown> {
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
      {
        id: 'entry_payments_get',
        kind: 'http_route',
        label: 'GET /api/payments',
        path: 'apps/api/src/payments-route.ts',
        method: 'GET',
        route: '/api/payments',
        handler: 'listPayments',
        sourceRefs: ['file:apps/api/src/payments-route.ts#L8'],
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
      {
        id: 'sym_list_payments',
        kind: 'function',
        name: 'listPayments',
        path: 'apps/api/src/payments-route.ts',
        exported: true,
        line: 6,
        signature: 'export function listPayments()',
        sourceRefs: ['file:apps/api/src/payments-route.ts#L6'],
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
    hotspots: [
      {
        id: 'hot_orders',
        path: 'apps/api/src/orders-route.ts',
        reason: 'entrypoint_dense',
        score: 0.8,
        sourceRefs: ['file:apps/api/src/orders-route.ts'],
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
        hotspotRefs: ['hot_orders'],
        sourceRefs: ['file:apps/api/src/orders-route.ts#L12'],
        confidence: 0.95,
        openQuestions: [],
      },
      {
        id: 'cap_api_payments',
        label: 'Payments API',
        kind: 'api',
        entrypointRefs: ['entry_payments_get'],
        moduleRefs: [],
        symbolRefs: ['sym_list_payments'],
        testRefs: [],
        hotspotRefs: [],
        sourceRefs: ['file:apps/api/src/payments-route.ts#L8'],
        confidence: 0.9,
        openQuestions: [],
      },
    ],
    sourceChunks: [
      {
        id: 'chunk_orders_delete_handler',
        path: 'apps/api/src/orders-route.ts',
        startLine: 10,
        endLine: 14,
        snippet: [
          'L10: export function deleteOrder() {',
          'L11:   const service = new OrderService();',
          'L12:   return service.deleteOrder();',
          'L13: }',
        ].join('\n'),
        sourceRefs: ['file:apps/api/src/orders-route.ts#L10', 'file:apps/api/src/orders-route.ts#L12'],
        entrypointRefs: ['entry_orders_delete'],
        symbolRefs: ['sym_delete_order', 'sym_order_service'],
        capabilityRefs: ['cap_api_orders'],
        confidence: 0.78,
      },
      {
        id: 'chunk_payments_list',
        path: 'apps/api/src/payments-route.ts',
        startLine: 6,
        endLine: 9,
        snippet: 'L6: export function listPayments() {\nL7:   return [];\nL8: }',
        sourceRefs: ['file:apps/api/src/payments-route.ts#L6'],
        entrypointRefs: ['entry_payments_get'],
        symbolRefs: ['sym_list_payments'],
        capabilityRefs: ['cap_api_payments'],
        confidence: 0.74,
      },
    ],
  };
}

function legacyBillingRefundActionInventoryFixture(): Record<string, unknown> {
  return {
    schemaVersion: 'ainp.project_inventory.v1',
    entrypoints: [
      {
        id: 'entry_billing_show_refund',
        kind: 'http_route',
        label: 'GET /api/v1/billing/refunds/:id',
        path: 'config/routes.rb',
        method: 'GET',
        route: '/api/v1/billing/refunds/:id',
        handler: 'BillingController#show_refund',
        sourceRefs: ['file:config/routes.rb#L3'],
        confidence: 0.9,
      },
      {
        id: 'entry_billing_destroy_refund',
        kind: 'http_route',
        label: 'DELETE /api/v1/billing/refunds/:id',
        path: 'config/routes.rb',
        method: 'DELETE',
        route: '/api/v1/billing/refunds/:id',
        handler: 'BillingController#destroy_refund',
        sourceRefs: ['file:config/routes.rb#L5'],
        confidence: 0.9,
      },
      {
        id: 'entry_customer_destroy_account',
        kind: 'http_route',
        label: 'DELETE /api/v1/customers/:id',
        path: 'config/routes.rb',
        method: 'DELETE',
        route: '/api/v1/customers/:id',
        handler: 'CustomersController#destroy',
        sourceRefs: ['file:config/routes.rb#L9'],
        confidence: 0.9,
      },
    ],
    symbols: [
      {
        id: 'sym_billing_controller',
        kind: 'class',
        name: 'BillingController',
        path: 'app/controllers/billing_controller.rb',
        exported: false,
        line: 1,
        signature: 'class BillingController < ApplicationController',
        sourceRefs: ['file:app/controllers/billing_controller.rb#L1'],
      },
      {
        id: 'sym_show_refund',
        kind: 'function',
        name: 'show_refund',
        path: 'app/controllers/billing_controller.rb',
        exported: false,
        line: 2,
        signature: 'def show_refund',
        sourceRefs: ['file:app/controllers/billing_controller.rb#L2'],
      },
      {
        id: 'sym_destroy_refund',
        kind: 'function',
        name: 'destroy_refund',
        path: 'app/controllers/billing_controller.rb',
        exported: false,
        line: 12,
        signature: 'def destroy_refund',
        sourceRefs: ['file:app/controllers/billing_controller.rb#L12'],
      },
      {
        id: 'sym_billing_refund_service',
        kind: 'class',
        name: 'BillingRefundService',
        path: 'app/services/billing_refund_service.rb',
        exported: false,
        line: 1,
        signature: 'class BillingRefundService',
        sourceRefs: ['file:app/services/billing_refund_service.rb#L1'],
      },
      {
        id: 'sym_billing_refund_service_destroy',
        kind: 'function',
        name: 'destroy_refund',
        path: 'app/services/billing_refund_service.rb',
        exported: false,
        line: 2,
        signature: 'def destroy_refund(refund_id)',
        sourceRefs: ['file:app/services/billing_refund_service.rb#L2'],
      },
      {
        id: 'sym_customers_controller',
        kind: 'class',
        name: 'CustomersController',
        path: 'app/controllers/customers_controller.rb',
        exported: false,
        line: 1,
        signature: 'class CustomersController < ApplicationController',
        sourceRefs: ['file:app/controllers/customers_controller.rb#L1'],
      },
      {
        id: 'sym_customer_destroy',
        kind: 'function',
        name: 'destroy',
        path: 'app/controllers/customers_controller.rb',
        exported: false,
        line: 5,
        signature: 'def destroy',
        sourceRefs: ['file:app/controllers/customers_controller.rb#L5'],
      },
    ],
    testSurfaces: [
      {
        id: 'test_billing_refund',
        path: 'test/billing_refund_controller_action_test.rb',
        frameworkHint: 'ruby-test',
        targetHints: ['billing', 'refund', 'controller', 'action'],
        sourceRefs: ['file:test/billing_refund_controller_action_test.rb'],
      },
      {
        id: 'test_customer_account',
        path: 'test/customer_account_controller_action_test.rb',
        frameworkHint: 'ruby-test',
        targetHints: ['customer', 'account', 'controller', 'action'],
        sourceRefs: ['file:test/customer_account_controller_action_test.rb'],
      },
    ],
    hotspots: [],
    capabilities: [
      {
        id: 'cap_api_billing',
        label: 'Billing Refund API',
        kind: 'api',
        entrypointRefs: ['entry_billing_show_refund', 'entry_billing_destroy_refund'],
        moduleRefs: [],
        symbolRefs: [
          'sym_billing_controller',
          'sym_show_refund',
          'sym_destroy_refund',
          'sym_billing_refund_service',
          'sym_billing_refund_service_destroy',
        ],
        testRefs: ['test_billing_refund'],
        hotspotRefs: [],
        sourceRefs: ['file:config/routes.rb#L3', 'file:config/routes.rb#L5'],
        confidence: 0.95,
        openQuestions: [],
      },
      {
        id: 'cap_api_customers',
        label: 'Customer Account API',
        kind: 'api',
        entrypointRefs: ['entry_customer_destroy_account'],
        moduleRefs: [],
        symbolRefs: ['sym_customers_controller', 'sym_customer_destroy'],
        testRefs: ['test_customer_account'],
        hotspotRefs: [],
        sourceRefs: ['file:config/routes.rb#L9'],
        confidence: 0.9,
        openQuestions: [],
      },
    ],
    symbolGraph: {
      parser: 'heuristic',
      nodes: [],
      edges: [
        {
          id: 'edge_route_show',
          kind: 'route_handler',
          from: 'node_entrypoint_entry_billing_show_refund',
          to: 'node_symbol_sym_show_refund',
          label: 'route handler BillingController#show_refund',
          sourceRefs: ['file:config/routes.rb#L3', 'file:app/controllers/billing_controller.rb#L2'],
          confidence: 0.9,
        },
        {
          id: 'edge_route_destroy',
          kind: 'route_handler',
          from: 'node_entrypoint_entry_billing_destroy_refund',
          to: 'node_symbol_sym_destroy_refund',
          label: 'route handler BillingController#destroy_refund',
          sourceRefs: ['file:config/routes.rb#L5', 'file:app/controllers/billing_controller.rb#L12'],
          confidence: 0.9,
        },
        {
          id: 'edge_destroy_service',
          kind: 'symbol_reference',
          from: 'node_symbol_sym_destroy_refund',
          to: 'node_symbol_sym_billing_refund_service_destroy',
          label: 'calls BillingRefundService.destroy_refund',
          sourceRefs: ['file:app/controllers/billing_controller.rb#L13', 'file:app/services/billing_refund_service.rb#L2'],
          confidence: 0.75,
        },
        {
          id: 'edge_route_customer_destroy',
          kind: 'route_handler',
          from: 'node_entrypoint_entry_customer_destroy_account',
          to: 'node_symbol_sym_customer_destroy',
          label: 'route handler CustomersController#destroy',
          sourceRefs: ['file:config/routes.rb#L9', 'file:app/controllers/customers_controller.rb#L5'],
          confidence: 0.9,
        },
      ],
    },
  };
}

// 08-09 P1-2: feedback from a rejected attempt has to reach the next prompt.
// Before this, a human's rejection comment and a reviewer's remediation were
// both recorded and then dropped on retry.
describe('prior-attempt feedback', () => {
  const priorFeedbackPackInput = {
    project: projectFixture(),
    run: runFixture(),
    stage: 'implementation' as const,
    stepRunId: 'step_impl',
    workspacePath: '/tmp/workspace',
    branch: 'ai/run-1',
    taskBrief: 'Add bounded retry to the order service.',
    inputNames: ['user_request'],
    createdAt: '2026-08-09T00:00:00.000Z',
  };

  test('a first attempt injects no feedback section at all', () => {
    const pack = buildContextPack(priorFeedbackPackInput);

    expect(pack.manifest.some((item) => item.type === 'prior_feedback')).toBe(false);
    expect(pack.sections.some((section) => section.id.startsWith('prior_feedback_'))).toBe(false);
  });

  test('a rejected attempt carries both the human comment and the reviewer remediation forward', () => {
    const pack = buildContextPack({
      ...priorFeedbackPackInput,
      priorFeedback: [
        {
          source: 'human_rejection',
          stage: 'acceptance_gate',
          text: 'AC-003 has no boundary case; the retry cap is untested.',
          sourceRef: 'gate:acceptance_gate',
          createdAt: null,
        },
        {
          source: 'reviewer_remediation',
          stage: 'review',
          text: 'Problem: retry loop has no upper bound\nSuggested fix: cap attempts at 2',
          sourceRef: 'artifact:art_verdict_1',
          createdAt: '2026-08-09T00:00:00.000Z',
        },
      ],
    });

    const items = pack.manifest.filter((item) => item.type === 'prior_feedback');
    expect(items).toHaveLength(2);

    const text = pack.sections
      .filter((section) => section.id.startsWith('prior_feedback_'))
      .map((section) => section.content)
      .join('\n');
    expect(text).toContain('AC-003 has no boundary case');
    expect(text).toContain('cap attempts at 2');
  });

  test('feedback is trusted below evidence, because a judgement can itself be wrong', () => {
    const pack = buildContextPack({
      ...priorFeedbackPackInput,
      priorFeedback: [{
        source: 'human_rejection',
        stage: 'acceptance_gate',
        text: 'An opinion about a failure, not a fact about the code.',
        sourceRef: 'gate:acceptance_gate',
        createdAt: null,
      }],
    });

    const section = pack.sections.find((item) => item.id.startsWith('prior_feedback_'));
    // `inference` is the lowest level: it must never outrank code or artifacts.
    expect(section?.trustLevel).toBe('inference');
    // And it must not be filed as a fact this run produced.
    expect(pack.manifest.find((item) => item.ref === section?.id)?.type).toBe('prior_feedback');
  });
});
