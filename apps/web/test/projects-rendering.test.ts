import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { knowledgeArtifactsState } from '../src/page-knowledge';
import { renderProjectsPage } from '../src/page-projects';
import { artifactContent, data, openArtifactViewers, ui } from '../src/state';
import type { RunDetail } from '../src/projection';
import type { KnowledgeArtifactDto, ProjectDto, WorkflowRequestDto } from '../src/types';

const testWindow = new Window();
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.HTMLDetailsElement = testWindow.HTMLDetailsElement;
globalThis.localStorage = testWindow.localStorage as unknown as Storage;
globalThis.requestAnimationFrame = (_callback: FrameRequestCallback): number => 1;
globalThis.cancelAnimationFrame = () => {};

const project: ProjectDto = {
  id: 'proj_profile',
  name: 'Legacy Platform',
  localPath: '/tmp/legacy-platform',
  sourceKind: 'local',
  status: 'active',
  agentBackend: 'codex',
  language: 'typescript',
  buildTool: 'bun',
  defaultBranch: 'main',
  sourceBranches: ['main'],
  registeredAt: '2026-06-30T00:00:00.000Z',
};

function resetState(): void {
  document.body.replaceChildren();
  window.location.hash = '';
  data.projects = [project];
  data.runners = [];
  data.requests = [];
  data.runs = [];
  data.activeDetail = null;
  data.runnerControl = null;
  artifactContent.clear();
  openArtifactViewers.clear();
  knowledgeArtifactsState.projectId = null;
  knowledgeArtifactsState.loading = false;
  knowledgeArtifactsState.loadedOnce = false;
  knowledgeArtifactsState.error = null;
  knowledgeArtifactsState.artifacts = [];
  ui.activeTaskRequestId = null;
  ui.activeRunId = null;
  ui.lastError = null;
  vi.restoreAllMocks();
}

function profileRequest(overrides: Partial<WorkflowRequestDto> = {}): WorkflowRequestDto {
  return {
    id: 'wreq_profile',
    projectId: project.id,
    type: 'profile',
    title: 'Generate legacy project profile',
    branch: 'main',
    status: 'pending',
    claimedBy: null,
    workflowRunId: null,
    error: null,
    agentBackend: null,
    flowId: 'profile.bootstrap',
    startStage: null,
    kind: null,
    createdAt: '2026-06-30T00:01:00.000Z',
    updatedAt: '2026-06-30T00:01:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function profileRunDetail(): RunDetail {
  const run: RunDetail['run'] = {
    id: 'run_profile',
    projectId: project.id,
    type: 'profile',
    status: 'passed',
    currentStage: 'knowledge',
    flowId: 'profile.bootstrap',
    startStage: null,
    configSnapshotId: null,
    sourceBranch: 'main',
    branch: 'ai/run-profile',
    workspacePath: '/tmp/profile-worktree',
    title: 'Generate legacy project profile',
    createdAt: '2026-06-30T00:02:00.000Z',
    updatedAt: '2026-06-30T00:03:00.000Z',
  };
  const profileArtifact: RunDetail['artifacts'][number] = {
    id: 'art_profile_json',
    kind: 'project_profile',
    stepRunId: 'step_profile',
    uri: 'file:///tmp/project-profile.json',
    contentType: 'application/json',
    sha256: null,
    createdAt: '2026-06-30T00:03:00.000Z',
    metadata: { profileFormat: 'json', schemaVersion: 'ainp.project_profile.v1' },
  };
  const inventoryArtifact: RunDetail['artifacts'][number] = {
    id: 'art_inventory_json',
    kind: 'other',
    stepRunId: 'step_inventory',
    uri: 'file:///tmp/project-inventory.json',
    contentType: 'application/json',
    sha256: null,
    createdAt: '2026-06-30T00:02:30.000Z',
    metadata: { role: 'project_inventory', schemaVersion: 'ainp.project_inventory.v1' },
  };
  return {
    run,
    steps: [],
    commands: [],
    toolInvocations: [],
    gates: [],
    artifacts: [inventoryArtifact, profileArtifact],
    builds: [],
    tests: [],
    approvals: [],
    actions: [],
    agentTasks: [],
    agentResults: [],
    handoffs: [],
    stepCheckpoints: [],
    audit: [],
  };
}

function inventoryContent(): string {
  return JSON.stringify({
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
    ],
    testSurfaces: [
      {
        id: 'test_orders',
        path: 'apps/api/test/orders-route.test.ts',
        frameworkHint: 'vitest',
        targetHints: ['orders'],
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
        symbolRefs: ['sym_delete_order'],
        testRefs: ['test_orders'],
        hotspotRefs: ['hot_orders'],
        sourceRefs: ['file:apps/api/src/orders-route.ts#L12'],
        confidence: 0.95,
        openQuestions: [],
      },
    ],
  });
}

function capabilityCorrectionArtifact(overrides: Partial<KnowledgeArtifactDto> = {}): KnowledgeArtifactDto {
  return {
    id: 'kart_cap_orders_rename',
    kind: 'explore',
    uri: 'mem://project-capability/proj_profile/cap_api_orders-renamed.md',
    projectId: project.id,
    size: 120,
    contentType: 'text/markdown',
    status: 'accepted',
    version: 1,
    entityId: 'CAP-API-ORDERS',
    derivedFromArtifactId: null,
    subtype: 'module_overview',
    createdAt: '2026-06-30T00:05:00.000Z',
    updatedAt: '2026-06-30T00:06:00.000Z',
    metadata: {
      title: 'Capability correction: Fulfillment API',
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
    ...overrides,
  };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('projects rendering', () => {
  afterEach(resetState);

  it('renders project profile bootstrap action and disables it while a profile request is active', () => {
    resetState();
    data.requests = [profileRequest({ status: 'claimed' })];

    const page = renderProjectsPage();
    const button = [...page.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.includes('Generate legacy profile'));

    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(page.textContent).toContain('项目画像');
    expect(page.textContent).toContain('执行中');
  });

  it('starts profile bootstrap through workflow requests with the profile flow id', async () => {
    resetState();
    const request = profileRequest({ status: 'pending' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/workflow-requests') && init?.method === 'POST') {
        return jsonResponse(request, 201);
      }
      if (url.endsWith('/api/health')) return jsonResponse({ ok: true, counts: {} });
      if (url.endsWith('/api/projects')) return jsonResponse({ items: [project] });
      if (url.endsWith('/api/runners')) return jsonResponse({ items: [] });
      if (url.endsWith('/api/workflow-requests')) return jsonResponse({ items: [request] });
      if (url.endsWith('/api/workflow-runs')) return jsonResponse({ items: [] });
      if (url.endsWith('/api/runner/control/status')) return jsonResponse(null);
      return jsonResponse({ error: `unexpected ${url}` }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const page = renderProjectsPage();
    const button = [...page.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.includes('Generate legacy profile'));
    button?.click();
    await flushAsync();
    await flushAsync();

    const createCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith('/api/workflow-requests') && init?.method === 'POST',
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      projectId: project.id,
      title: 'Generate legacy project profile',
      type: 'profile',
      flowId: 'profile.bootstrap',
    });
    expect(ui.activeTaskRequestId).toBe(request.id);
    expect(window.location.hash).toBe(`#task/${request.id}`);
  });

  it('shows latest profile artifacts with openable cached content', () => {
    resetState();
    const detail = profileRunDetail();
    data.runs = [detail.run];
    data.activeDetail = detail;
    const profileArtifact = detail.artifacts.find((artifact) => artifact.id === 'art_profile_json')!;
    artifactContent.set(profileArtifact.id, {
      artifact: profileArtifact,
      text: '{"summary":"Legacy profile facts"}',
      contentType: 'application/json',
      filename: 'project-profile.json',
      digest: { algorithm: 'sha256', expected: null, actual: 'abc', verified: null },
    });
    openArtifactViewers.add(profileArtifact.id);

    const page = renderProjectsPage();

    expect(page.textContent).toContain('profile');
    expect(page.textContent).toContain('inventory');
    expect(page.textContent).toContain('Legacy profile facts');
  });

  it('renders inventory capabilities and submits accepted corrections as draft knowledge', async () => {
    resetState();
    const detail = profileRunDetail();
    data.runs = [detail.run];
    data.activeDetail = detail;
    const inventoryArtifact = detail.artifacts.find((artifact) => artifact.id === 'art_inventory_json')!;
    artifactContent.set(inventoryArtifact.id, {
      artifact: inventoryArtifact,
      text: inventoryContent(),
      contentType: 'application/json',
      filename: 'project-inventory.json',
      digest: { algorithm: 'sha256', expected: null, actual: 'def', verified: null },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/knowledge-artifacts/projects/${project.id}`) && (!init?.method || init.method === 'GET')) {
        return jsonResponse({ ok: true, artifacts: [] });
      }
      if (url.endsWith(`/api/knowledge-artifacts/projects/${project.id}`) && init?.method === 'POST') {
        return jsonResponse({ ok: true, artifact: { id: 'kart_cap_orders' } }, 201);
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const page = renderProjectsPage();

    expect(page.textContent).toContain('核心能力地图');
    expect(page.textContent).toContain('Orders API');
    expect(page.textContent).toContain('DELETE');
    expect(page.textContent).toContain('/api/orders/:id');
    expect(page.textContent).toContain('orders-route.test.ts');

    const accept = [...page.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent === '确认');
    accept?.click();
    await flushAsync();

    const createCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith(`/api/knowledge-artifacts/projects/${project.id}`) && init?.method === 'POST',
    );
    expect(createCall).toBeDefined();
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body).toMatchObject({
      kind: 'explore',
      status: 'draft',
      subtype: 'module_overview',
      metadata: {
        correctionKind: 'project_capability_map',
        correctionAction: 'accepted',
        capabilityId: 'cap_api_orders',
        originalLabel: 'Orders API',
        inventoryArtifactId: inventoryArtifact.id,
        reviewStatus: 'needs_review',
      },
    });
    expect(body.metadata.sourceRefs).toEqual(expect.arrayContaining([
      `artifact:${inventoryArtifact.id}`,
      'capability:cap_api_orders',
      'file:apps/api/src/orders-route.ts#L12',
    ]));
    expect(body.metadata.evidenceRefs).toEqual(expect.arrayContaining([
      `artifact:${inventoryArtifact.id}`,
      'capability:cap_api_orders',
      'entrypoint:entry_orders_delete',
      'symbol:sym_delete_order',
      'test_surface:test_orders',
      'hotspot:hot_orders',
      'file:apps/api/src/orders-route.ts#L10',
      'file:apps/api/test/orders-route.test.ts',
    ]));
    expect(body.metadata.inventoryRecordRefs).toEqual({
      capabilityRefs: ['cap_api_orders'],
      entrypointRefs: ['entry_orders_delete'],
      symbolRefs: ['sym_delete_order'],
      testRefs: ['test_orders'],
      hotspotRefs: ['hot_orders'],
    });
  });

  it('compares current scan capabilities against governed correction artifacts', () => {
    resetState();
    const detail = profileRunDetail();
    data.runs = [detail.run];
    data.activeDetail = detail;
    const inventoryArtifact = detail.artifacts.find((artifact) => artifact.id === 'art_inventory_json')!;
    inventoryArtifact.id = 'art_inventory_json_fresh';
    artifactContent.set(inventoryArtifact.id, {
      artifact: inventoryArtifact,
      text: inventoryContent(),
      contentType: 'application/json',
      filename: 'project-inventory.json',
      digest: { algorithm: 'sha256', expected: null, actual: 'def', verified: null },
    });
    knowledgeArtifactsState.projectId = project.id;
    knowledgeArtifactsState.loadedOnce = true;
    knowledgeArtifactsState.artifacts = [
      capabilityCorrectionArtifact({
        metadata: {
          ...capabilityCorrectionArtifact().metadata,
          reviewStatus: 'none',
        },
      }),
      capabilityCorrectionArtifact({
        id: 'kart_cap_orders_draft_rename',
        status: 'draft',
        updatedAt: '2026-06-30T00:07:00.000Z',
        metadata: {
          ...capabilityCorrectionArtifact().metadata,
          correctedLabel: 'Draft Fulfillment',
          reviewStatus: 'needs_review',
        },
      }),
    ];

    const page = renderProjectsPage();

    expect(page.textContent).toContain('已改名');
    expect(page.textContent).toContain('Fulfillment API');
    expect(page.textContent).toContain('已生效');
    expect(page.textContent).not.toContain('Draft Fulfillment');
    expect(page.textContent).not.toContain('改名待复核');
    expect(page.textContent).toContain('当前扫描标签是 Orders API');
    expect(page.textContent).toContain('历史 inventory');
    const rename = [...page.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent === '已改名');
    expect(rename).toBeDefined();
  });
});
