import {
  STAGE_HELP,
  STAGE_LABELS,
  STAGES,
  USER_VISIBLE_STAGES,
  STAGE_TO_GATE,
  artifactViewerScrollKey,
  buildAcceptanceChecklist,
  buildRunProjection,
  buildWorkbenchOverview,
  changedFilesFromDiff,
  isReadableFileArtifact,
  latestArtifactOfKind,
  parseCompletionReportArtifact,
  parseDesignArtifact,
  parseKnowledgeArtifact,
  parseRequirementArtifact,
  type KnowledgeSuggestion,
  type ArtifactDto,
  type DesignDoc,
  type GateRunDto,
  type RequirementDoc,
  type RunDetail,
  type Stage,
  type WorkflowRunDto,
} from './projection';
import { buildSettingsViewModel } from './settings-projection';
import {
  buildStreamDisplayLines,
  lastStreamSequenceForRun,
  rememberStreamEventInCache,
  streamEventsForRun,
  type StreamDisplayLine,
  type StreamEventCache,
} from './stream-rendering';

const API_BASE = '/api';

type Page = 'workbench' | 'task' | 'projects' | 'new-task' | 'reports' | 'knowledge' | 'settings';
type StatusKind = 'good' | 'warn' | 'bad' | 'info' | 'muted';
type ProjectAgentBackendKind = 'claude_code' | 'codex';
type AgentBackendKind = ProjectAgentBackendKind | 'native';

interface ProjectDto {
  id: string;
  name: string;
  localPath: string;
  sourceKind?: ProjectSourceKind;
  sourceUrl?: string | null;
  sourceAuthKind?: ProjectSourceAuthKind;
  sourceUsername?: string | null;
  hasSourceCredential?: boolean;
  agentBackend?: ProjectAgentBackendKind | null;
  status?: 'active' | 'archived';
  archivedAt?: string | null;
  language: string;
  buildTool: string;
  defaultBranch: string;
  sourceBranches?: string[];
  registeredAt: string;
}


type ProjectSourceKind = 'local' | 'github' | 'gitee' | 'git' | 'gitlab';
type ProjectSourceAuthKind = 'none' | 'ssh' | 'token' | 'basic';

interface SourceDetectSuccess {
  ok: true;
  sourceKind: ProjectSourceKind;
  sourceUrl: string | null;
  localPath: string | null;
  projectName: string;
  defaultBranch: string;
  branches: string[];
  metadata: Record<string, string>;
}

interface SourceDetectFailure {
  ok: false;
  error: string;
}

type SourceDetectResult = SourceDetectSuccess | SourceDetectFailure;

type ProjectBranchListResult =
  | {
      ok: true;
      defaultBranch: string;
      detectedDefaultBranch: string;
      branches: string[];
      metadata: Record<string, string>;
    }
  | { ok: false; error: string };

interface LocalDirectoryItem {
  name: string;
  path: string;
}

interface LocalDirectoryList {
  path: string;
  parent: string;
  directories: LocalDirectoryItem[];
}

interface LocalDirectoryPickerState {
  open: boolean;
  loading: boolean;
  error: string | null;
  listing: LocalDirectoryList | null;
}

interface ProjectSourceFormState {
  editingProjectId: string | null;
  sourceKind: ProjectSourceKind;
  agentBackend: ProjectAgentBackendKind | '';
  name: string;
  sourceValue: string;
  sourceAuthKind: ProjectSourceAuthKind;
  sourceUsername: string;
  sourceCredential: string;
  defaultBranch: string;
  detectResult: SourceDetectResult | null;
  detecting: boolean;
}

interface AgentBackendPreflightDto {
  backend: ProjectAgentBackendKind | null;
  label: string;
  bin: string | null;
  installed: boolean;
  runnable: boolean;
  authenticated: boolean | null;
  version: string | null;
  status: 'not_configured' | 'connected' | 'missing_cli' | 'needs_login' | 'not_runnable';
  error: string | null;
  remediationHint: string;
  checkedAt: string;
}


interface ProjectDeletePreviewDto {
  canHardDelete: boolean;
  canArchive: boolean;
  activeRequests: number;
  activeRuns: number;
  totalRequests: number;
  totalRuns: number;
  recommendation: 'hard_delete' | 'archive' | 'blocked_active_work' | 'already_archived';
}

interface RunnerDto {
  id: string;
  host: string;
  version: string;
  jdkVersion: string | null;
  mavenVersion: string | null;
  gitVersion: string | null;
  lastSeenAt: string;
  status: 'online' | 'stale' | 'offline';
}

interface WorkflowRequestDto {
  id: string;
  projectId: string;
  type: 'feature' | 'bugfix' | 'smoke' | 'refactor';
  title: string;
  branch: string;
  status: 'pending' | 'awaiting_clarification' | 'claimed' | 'completed' | 'failed' | 'cancelled';
  claimedBy: string | null;
  workflowRunId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HealthDto {
  ok: boolean;
  counts: Record<string, number>;
}

interface ArtifactContentDto {
  artifact: ArtifactDto;
  text: string;
  contentType: string;
  filename: string;
}

interface CommandLogsDto {
  commandRun: RunDetail['commands'][number];
  stdout: { text: string; contentType: string; filename: string };
  stderr: { text: string; contentType: string; filename: string };
}

interface RunnerControlStatusDto {
  mode: 'api-managed-local-runner';
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  command: string[];
  lastExit: { code: number | null; signal: string | null; at: string } | null;
  recentLogs: string[];
  latestHeartbeat: RunnerDto | null;
}

interface AppData {
  health: HealthDto | null;
  projects: ProjectDto[];
  runners: RunnerDto[];
  requests: WorkflowRequestDto[];
  runs: WorkflowRunDto[];
  activeDetail: RunDetail | null;
  runnerControl: RunnerControlStatusDto | null;
}

const data: AppData = {
  health: null,
  projects: [],
  runners: [],
  requests: [],
  runs: [],
  activeDetail: null,
  runnerControl: null,
};

let activePage: Page = 'workbench';
let activeRunId: string | null = null;
let activeTaskRequestId: string | null = null;
let loadingDetailFor: string | null = null;
let runnerStartInFlight = false;
let lastError: string | null = null;
const artifactContent = new Map<string, ArtifactContentDto | null>();
const openArtifactViewers = new Set<string>();
const scrollPositionState = new Map<string, { top: number; left: number }>();
const SCROLLABLE_STATE_SELECTOR = '[data-scroll-key], .doc-preview';
let viewportScrollPosition = { top: 0, left: 0 };
const commandLogs = new Map<string, CommandLogsDto | null>();
const detailsOpenState = new Map<string, boolean>();
const knowledgeDecisions = new Map<string, 'accepted' | 'ignored' | 'edited'>();
const knowledgeEdits = new Map<string, string>();
const approvalInFlight = new Set<string>();
const approvalLastSubmittedAt = new Map<string, number>();
const projectActionInFlight = new Set<string>();
const projectBranchRefreshInFlight = new Set<string>();
const agentBackendPreflight = new Map<string, AgentBackendPreflightDto>();
const agentBackendPreflightInFlight = new Set<string>();
const runnerAutoStartAttemptedForRequest = new Set<string>();


const localDirectoryPicker: LocalDirectoryPickerState = {
  open: false,
  loading: false,
  error: null,
  listing: null,
};

const projectSourceForm: ProjectSourceFormState = {
  editingProjectId: null,
  sourceKind: 'github',
  agentBackend: '',
  name: '',
  sourceValue: '',
  sourceAuthKind: 'none',
  sourceUsername: '',
  sourceCredential: '',
  defaultBranch: 'main',
  detectResult: null,
  detecting: false,
};


async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`api ${path}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: {
    class?: string;
    id?: string;
    text?: string;
    children?: Array<Node | null | undefined | false>;
    attrs?: Record<string, string>;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.id) node.id = opts.id;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.children) {
    for (const child of opts.children) if (child) node.appendChild(child);
  }
  return node;
}

function icon(path: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}

function clear(node: HTMLElement): void {
  node.replaceChildren();
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 14)}…` : id;
}

function statusKind(status: string): StatusKind {
  if (['passed', 'pass', 'success', 'approved', 'online', 'completed'].includes(status)) return 'good';
  if (['failed', 'fail', 'rejected', 'offline', 'cancelled'].includes(status)) return 'bad';
  if (['warn', 'stale', 'awaiting_human', 'awaiting_clarification'].includes(status)) return 'warn';
  if (['running', 'pending', 'claimed'].includes(status)) return 'info';
  return 'muted';
}

function pill(label: string, kind: StatusKind = statusKind(label)): HTMLElement {
  return el('span', { class: `pill ${kind}`, text: label });
}

function metric(label: string, value: string, hint?: string, kind: StatusKind = 'muted'): HTMLElement {
  return el('div', {
    class: 'metric-card',
    children: [
      el('span', { class: 'metric-label', text: label }),
      el('strong', { class: `metric-value ${kind}`, text: value }),
      hint ? el('span', { class: 'metric-hint', text: hint }) : null,
    ],
  });
}

function field(label: string, value: Node | string): HTMLElement {
  const valueNode = typeof value === 'string' ? el('span', { text: value }) : value;
  return el('div', {
    class: 'field-row',
    children: [el('span', { class: 'field-label', text: label }), valueNode],
  });
}

function button(label: string, className = 'button secondary'): HTMLButtonElement {
  const btn = el('button', { class: className, text: label, attrs: { type: 'button' } });
  return btn;
}

function projectName(projectId: string): string {
  return data.projects.find((p) => p.id === projectId)?.name ?? projectId;
}

function selectedProject(): ProjectDto | null {
  const active = data.activeDetail?.run.projectId ?? data.runs[0]?.projectId ?? data.projects[0]?.id;
  return data.projects.find((p) => p.id === active) ?? data.projects[0] ?? null;
}

function activeProjects(): ProjectDto[] {
  return data.projects.filter((p) => (p.status ?? 'active') === 'active');
}

function sourceBranchesForProject(project: ProjectDto | null | undefined): string[] {
  if (!project) return ['main'];
  return normalizeBranchList(project.defaultBranch, project.sourceBranches);
}

function normalizeBranchList(defaultBranch: string | null | undefined, branches: string[] | null | undefined): string[] {
  const normalized = [defaultBranch ?? 'main', ...(branches ?? [])]
    .map((branch) => branch.trim())
    .filter(Boolean);
  const unique = [...new Set(normalized)];
  return unique.length ? unique : ['main'];
}

function latestRunner(): RunnerDto | null {
  return [...data.runners].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0] ?? null;
}

function activeTaskRequest(): WorkflowRequestDto | null {
  if (!activeTaskRequestId) return null;
  return data.requests.find((request) => request.id === activeTaskRequestId) ?? null;
}

function agentBackendDisplayName(kind: AgentBackendKind | null | undefined): string {
  if (kind === 'claude_code') return 'Claude Code';
  if (kind === 'codex') return 'Codex';
  return 'Legacy test backend';
}

function selectedProjectBackend(): ProjectAgentBackendKind | null {
  return selectedProject()?.agentBackend ?? null;
}

function activeRunAgentBackend(): AgentBackendKind | null {
  const tasks = data.activeDetail?.agentTasks ?? [];
  const backend = tasks.at(-1)?.backend;
  if (backend === 'claude_code' || backend === 'codex' || backend === 'native') return backend;
  return null;
}

function agentBackendLabel(): string {
  const runBackend = activeRunAgentBackend();
  if (runBackend) return agentBackendDisplayName(runBackend);
  const projectBackend = selectedProjectBackend();
  return projectBackend ? agentBackendDisplayName(projectBackend) : '未配置';
}

function agentBackendStatusForProject(project: ProjectDto | null): { label: string; kind: StatusKind } {
  if (!project?.agentBackend) return { label: 'Needs setup', kind: 'warn' };
  const check = preflightForProjectBackend(project);
  if (!check) return { label: 'Not checked', kind: 'muted' };
  if (check.runnable) return { label: 'Connected', kind: 'good' };
  if (check.status === 'needs_login') return { label: 'Needs login', kind: 'warn' };
  if (check.status === 'missing_cli') return { label: 'CLI missing', kind: 'bad' };
  return { label: 'Check failed', kind: 'bad' };
}

function agentBackendContextLabel(project: ProjectDto | null): { value: string; kind: StatusKind } {
  const backend = agentBackendLabel();
  const status = agentBackendStatusForProject(project);
  return {
    value: backend === '未配置' ? 'Needs setup' : `${backend} · ${status.label}`,
    kind: status.kind,
  };
}

function agentBackendLabelForProject(project: ProjectDto | null): string {
  if (!project) return '未选择项目';
  return project.agentBackend ? agentBackendDisplayName(project.agentBackend) : '未配置';
}

function preflightForProjectBackend(project: ProjectDto | null): AgentBackendPreflightDto | null {
  if (!project?.agentBackend) return null;
  const check = agentBackendPreflight.get(project.id);
  return check?.backend === project.agentBackend ? check : null;
}

function buildEnvLabel(): string {
  const runner = latestRunner();
  if (!runner) return '等待 runner heartbeat';
  const jdk = runner.jdkVersion ? `JDK ${runner.jdkVersion}` : 'JDK ?';
  const mvn = runner.mavenVersion ? `Maven ${runner.mavenVersion.split('\n')[0]}` : 'Maven ?';
  return `${jdk} · ${mvn}`;
}

function setHash(page: Page, id?: string): void {
  if (page === 'task' && id) window.location.hash = `task/${encodeURIComponent(id)}`;
  else if (id) window.location.hash = `run/${encodeURIComponent(id)}`;
  else window.location.hash = page;
}

function parseHash(): void {
  const raw = window.location.hash.replace(/^#/, '');
  if (raw.startsWith('run/')) {
    activePage = 'workbench';
    activeRunId = decodeURIComponent(raw.slice('run/'.length));
    activeTaskRequestId = null;
    return;
  }
  if (raw.startsWith('task/')) {
    activePage = 'task';
    activeTaskRequestId = decodeURIComponent(raw.slice('task/'.length));
    activeRunId = null;
    data.activeDetail = null;
    return;
  }
  activeTaskRequestId = null;
  if (['workbench', 'projects', 'new-task', 'reports', 'knowledge', 'settings'].includes(raw)) {
    activePage = raw as Page;
  }
}

async function loadData(opts: { render?: boolean; keepDetail?: boolean } = {}): Promise<void> {
  try {
    const [health, projects, runners, requests, runs, runnerControl] = await Promise.all([
      api<HealthDto>('/health').catch(() => null),
      api<{ items: ProjectDto[] }>('/projects').then((r) => r.items).catch(() => []),
      api<{ items: RunnerDto[] }>('/runners').then((r) => r.items).catch(() => []),
      api<{ items: WorkflowRequestDto[] }>('/workflow-requests').then((r) => r.items).catch(() => []),
      api<{ items: WorkflowRunDto[] }>('/workflow-runs').then((r) => r.items).catch(() => []),
      api<RunnerControlStatusDto>('/runner/control/status').catch(() => null),
    ]);
    data.health = health;
    data.projects = projects;
    data.runners = runners;
    data.requests = requests;
    data.runs = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    data.runnerControl = runnerControl;

    const taskRequest = activeTaskRequest();
    if (taskRequest?.workflowRunId) activeRunId = taskRequest.workflowRunId;
    if (!activeRunId && activePage !== 'task' && data.runs.length > 0) activeRunId = data.runs[0]!.id;
    if (activeRunId && (!opts.keepDetail || data.activeDetail?.run.id !== activeRunId)) {
      await loadRunDetail(activeRunId, false);
    } else if (!activeRunId && activePage === 'task') {
      data.activeDetail = null;
    }
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
  if (opts.render !== false) render();
}

async function loadRunDetail(runId: string, shouldRender = true): Promise<void> {
  if (loadingDetailFor === runId) return;
  loadingDetailFor = runId;
  try {
    data.activeDetail = await api<RunDetail>(`/workflow-runs/${encodeURIComponent(runId)}`);
    activeRunId = runId;
    primeArtifactPreviews(data.activeDetail.artifacts);
    attachStream(runId);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  } finally {
    loadingDetailFor = null;
  }
  if (shouldRender) render();
}

function primeArtifactPreviews(artifacts: ArtifactDto[]): void {
  const previewKinds = new Set([
    'requirement_draft',
    'design_doc',
    'traceability',
    'diff',
    'context_pack',
    'project_profile',
    'other',
    'completion_report',
    'knowledge_candidate',
    'surefire_report',
    'failsafe_report',
  ]);
  for (const artifact of artifacts) {
    if (previewKinds.has(artifact.kind)) void ensureArtifactContent(artifact.id);
  }
}

async function ensureCommandLogs(commandRunId: string): Promise<void> {
  if (commandLogs.has(commandRunId)) return;
  commandLogs.set(commandRunId, null);
  try {
    commandLogs.set(
      commandRunId,
      await api<CommandLogsDto>(`/command-runs/${encodeURIComponent(commandRunId)}/logs`),
    );
  } catch {
    commandLogs.set(commandRunId, null);
  }
  render();
}

async function ensureArtifactContent(artifactId: string): Promise<void> {
  if (artifactContent.has(artifactId)) return;
  artifactContent.set(artifactId, null);
  try {
    artifactContent.set(
      artifactId,
      await api<ArtifactContentDto>(`/artifacts/${encodeURIComponent(artifactId)}/content`),
    );
  } catch {
    artifactContent.set(artifactId, null);
  }
  if (data.activeDetail?.artifacts.some((a) => a.id === artifactId)) render();
}

function render(): void {
  const root = document.getElementById('app');
  if (!root) return;
  captureDetailsOpenState(root);
  captureViewportScrollPosition();
  captureScrollPositionState(root);
  captureCoordinatorReplyComposerState(root);
  captureNewTaskFormState(root);
  isReplacingAppRootForRender = true;
  try {
    clear(root);
    root.appendChild(renderShell());
    restoreDetailsOpenState(root);
    restoreScrollPositionState(root);
    restoreViewportScrollPosition();
    restoreCoordinatorReplyComposerFocus(root);
    restoreNewTaskFormFocus(root);
  } finally {
    isReplacingAppRootForRender = false;
  }
}

function captureDetailsOpenState(root: HTMLElement): void {
  root.querySelectorAll('details').forEach((details) => {
    detailsOpenState.set(detailsStateKey(details), details.open);
  });
}

function captureViewportScrollPosition(): void {
  viewportScrollPosition = { top: window.scrollY, left: window.scrollX };
}

function restoreViewportScrollPosition(): void {
  window.scrollTo(viewportScrollPosition.left, viewportScrollPosition.top);
  const restored = { top: window.scrollY, left: window.scrollX };
  requestAnimationFrame(() => {
    if (window.scrollY === restored.top && window.scrollX === restored.left) {
      window.scrollTo(viewportScrollPosition.left, viewportScrollPosition.top);
    }
  });
}

function captureScrollPositionState(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(SCROLLABLE_STATE_SELECTOR).forEach((node) => {
    scrollPositionState.set(scrollStateKey(node), { top: node.scrollTop, left: node.scrollLeft });
  });
}

function restoreScrollPositionState(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(SCROLLABLE_STATE_SELECTOR).forEach((node) => {
    const key = scrollStateKey(node);
    const saved = scrollPositionState.get(key);
    if (saved) restoreScrollableNode(node, saved);
    node.onscroll = () => {
      scrollPositionState.set(key, { top: node.scrollTop, left: node.scrollLeft });
    };
  });
}

function restoreScrollableNode(node: HTMLElement, saved: { top: number; left: number }): void {
  node.scrollTop = saved.top;
  node.scrollLeft = saved.left;
  const restored = { top: node.scrollTop, left: node.scrollLeft };
  requestAnimationFrame(() => {
    if (node.scrollTop === restored.top && node.scrollLeft === restored.left) {
      node.scrollTop = saved.top;
      node.scrollLeft = saved.left;
    }
  });
}

function scrollStateKey(node: HTMLElement): string {
  return [window.location.hash || activePage, node.dataset.scrollKey ?? fallbackScrollStateKey(node)]
    .filter(Boolean)
    .join(' > ');
}

function fallbackScrollStateKey(node: HTMLElement): string {
  const context: string[] = [];
  let current: HTMLElement | null = node.parentElement;
  while (current) {
    if (current instanceof HTMLDetailsElement) context.push(detailsSummaryKey(current));
    current = current.parentElement;
  }
  const text = node.textContent ?? '';
  return ['preview', ...context.reverse(), shortTextHash(text)].join(':');
}

function shortTextHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(31, hash) + text.charCodeAt(i) | 0;
  }
  return Math.abs(hash).toString(36);
}

function restoreDetailsOpenState(root: HTMLElement): void {
  root.querySelectorAll('details').forEach((details) => {
    const key = detailsStateKey(details);
    if (detailsOpenState.has(key)) details.open = detailsOpenState.get(key) ?? false;
    details.ontoggle = () => {
      detailsOpenState.set(key, details.open);
    };
  });
}

function detailsStateKey(details: HTMLDetailsElement): string {
  const path: string[] = [];
  let current: HTMLElement | null = details;
  while (current) {
    if (current instanceof HTMLDetailsElement) path.push(detailsSummaryKey(current));
    current = current.parentElement;
  }
  return [window.location.hash || activePage, ...path.reverse()].join(' > ');
}

function detailsSummaryKey(details: HTMLDetailsElement): string {
  const summary = details.querySelector(':scope > summary');
  const primary = summary?.querySelector('strong')?.textContent ?? summary?.textContent ?? details.className;
  return primary.replace(/\s*\(\d+\)/g, '').replace(/\s+/g, ' ').trim();
}

function renderShell(): HTMLElement {
  return el('div', {
    class: 'app-shell',
    children: [
      renderSidebar(),
      el('main', { class: 'main-shell', children: [renderTopbar(), renderPage()] }),
      expandedStreamRunId ? renderExpandedAgentStreamOverlay(expandedStreamRunId) : null,
    ],
  });
}

function renderSidebar(): HTMLElement {
  const navItems: Array<{ page: Page; label: string; help: string; path: string }> = [
    { page: 'workbench', label: '工作台', help: '生命周期与人工确认', path: 'M4 6h16M4 12h10M4 18h16' },
    { page: 'projects', label: '项目接入', help: '注册本地/远端 Git', path: 'M3 7h18M6 7v12h12V7M9 7V5h6v2' },
    { page: 'new-task', label: '新建任务', help: '进入 runner 队列', path: 'M12 5v14M5 12h14' },
    { page: 'reports', label: '报告', help: '交付证据汇总', path: 'M7 3h7l5 5v13H7zM14 3v6h6' },
    { page: 'knowledge', label: '知识库', help: '候选与沉淀', path: 'M4 19V5a2 2 0 012-2h12v16H6a2 2 0 01-2-2zM8 7h8M8 11h8M8 15h5' },
    { page: 'settings', label: '配置', help: '本地 worktree 模式', path: 'M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2m12 0h2M12 4v2m0 12v2' },
  ];

  const nav = el('nav', { class: 'nav-list' });
  for (const item of navItems) {
    const a = el('button', {
      class: `nav-item ${activePage === item.page ? 'active' : ''}`,
      attrs: { type: 'button' },
      children: [
        icon(item.path),
        el('span', {
          children: [el('strong', { text: item.label }), el('small', { text: item.help })],
        }),
      ],
    });
    a.onclick = () => setHash(item.page);
    nav.appendChild(a);
  }

  return el('aside', {
    class: 'sidebar',
    children: [
      el('div', {
        class: 'brand',
        children: [
          el('div', { class: 'brand-mark', text: 'AI' }),
          el('div', {
            children: [
              el('strong', { text: 'AI Native Platform' }),
              el('span', { text: 'Delivery Workbench' }),
            ],
          }),
        ],
      }),
      nav,
      renderQueueSummary(),
    ],
  });
}

function renderQueueSummary(): HTMLElement {
  const pending = data.requests.filter((r) => r.status === 'pending').length;
  const claimed = data.requests.filter((r) => r.status === 'claimed').length;
  const last = data.requests[0];
  const control = data.runnerControl;
  return el('section', {
    class: 'sidebar-card',
    children: [
      el('h2', { text: '自动执行' }),
      el('div', {
        class: 'queue-stats',
        children: [
          metric('Pending', String(pending), control?.running ? '自动认领中' : '等待 Runner', 'info'),
          metric('Claimed', String(claimed), '执行中', 'warn'),
        ],
      }),
      last
        ? el('p', { class: 'muted compact', text: `${shortId(last.id)} · ${last.status} · ${last.title}` })
        : el('p', { class: 'muted compact', text: '暂无任务请求。' }),
      el('p', { class: 'muted compact', text: control?.running ? `Runner pid=${control.pid ?? '—'}` : 'UI 会尝试自动启动 Runner；命令行仅作兜底。' }),
    ],
  });
}

function renderTopbar(): HTMLElement {
  const project = selectedProject();
  const run = data.activeDetail?.run ?? data.runs[0] ?? null;
  const runner = latestRunner();
  const backend = agentBackendContextLabel(project);
  return el('header', {
    class: 'topbar',
    children: [
      el('div', {
        class: 'topbar-title',
        children: [
          el('span', { class: 'eyebrow', text: 'AI 软件交付工作台' }),
          el('h1', { text: titleForPage() }),
        ],
      }),
      el('div', {
        class: 'context-strip',
        children: [
          contextItem('Project', project?.name ?? '未接入', 'info'),
          contextItem('Branch', run?.branch ?? project?.defaultBranch ?? '—', 'muted'),
          contextItem('Runner', runner ? runner.status : 'offline', runner ? statusKind(runner.status) : 'bad'),
          contextItem('Agent Backend', backend.value, backend.kind),
          contextItem('Build Env', buildEnvLabel(), runner ? 'good' : 'warn'),
        ],
      }),
    ],
  });
}

function titleForPage(): string {
  switch (activePage) {
    case 'task':
      return activeTaskRequest()?.title ?? data.activeDetail?.run.title ?? '任务工作流';
    case 'projects':
      return '项目接入';
    case 'new-task':
      return '新建任务';
    case 'reports':
      return '交付报告';
    case 'knowledge':
      return '知识库';
    case 'settings':
      return '运行配置';
    default:
      return data.activeDetail?.run.title ?? '工作台首页';
  }
}

function contextItem(label: string, value: string, kind: StatusKind): HTMLElement {
  return el('div', {
    class: 'context-item',
    children: [el('span', { text: label }), el('strong', { class: kind, text: value })],
  });
}

function renderPage(): HTMLElement {
  if (lastError) {
    return el('section', { class: 'page-stack', children: [renderError(lastError), renderCurrentPage()] });
  }
  return renderCurrentPage();
}

function renderCurrentPage(): HTMLElement {
  switch (activePage) {
    case 'task':
      return renderTaskDetailPage();
    case 'projects':
      return renderProjectsPage();
    case 'new-task':
      return renderNewTaskPage();
    case 'reports':
      return renderReportsPage();
    case 'knowledge':
      return renderKnowledgePage();
    case 'settings':
      return renderSettingsPage();
    default:
      return renderWorkbenchPage();
  }
}

function renderError(message: string): HTMLElement {
  return el('div', {
    class: 'notice bad',
    children: [el('strong', { text: '数据刷新失败' }), el('span', { text: message })],
  });
}

function renderWorkbenchPage(): HTMLElement {
  return el('section', {
    class: 'page-grid',
    children: [
      renderWorkbenchOverviewPanel(),
      renderTaskListPanel(),
      renderRunnerControlPanel(),
    ],
  });
}

function renderTaskDetailPage(): HTMLElement {
  const request = activeTaskRequest();
  if (!request) {
    return el('section', {
      class: 'empty-state',
      children: [
        el('h2', { text: '找不到这个任务请求' }),
        el('p', { text: '它可能已经被删除，或者当前页面链接不是有效的 Workflow Request。' }),
        actionLink('返回工作台总览', 'workbench'),
      ],
    });
  }

  const detail = request.workflowRunId && data.activeDetail?.run.id === request.workflowRunId ? data.activeDetail : null;
  const projection = detail ? buildRunProjection(detail) : null;
  if (detail) clearCoordinatorReplyComposerState(request.id);
  const coordinatorPanel = !detail ? renderCoordinatorChatPanel(request) : null;
  return el('section', {
    class: 'task-detail-grid',
    children: [
      el('div', {
        class: 'workspace-main',
        children: [
          renderTaskHero(request, detail, projection),
          coordinatorPanel,
          detail ? renderLifecycle(detail, projection!) : renderQueuedLifecycle(request),
          renderCurrentStagePanel(request, detail, projection),
          detail ? renderStageBackendDetails(detail, projection!) : renderQueuedBackendDetails(request),
        ],
      }),
      el('aside', {
        class: 'workspace-side',
        children: [
          renderTaskNextActionPanel(request, detail, projection),
          renderRunnerControlPanel(),
          detail ? renderEvidencePanel(detail) : renderRequestDebugPanel(request),
          detail ? renderAgentStreamPanel() : null,
        ],
      }),
    ],
  });
}

function renderWorkbenchOverviewPanel(): HTMLElement {
  const overview = buildWorkbenchOverview({
    runs: data.runs,
    requests: data.requests,
    detailsByRunId: data.activeDetail ? { [data.activeDetail.run.id]: data.activeDetail } : {},
  });
  return el('section', {
    class: 'panel overview-panel',
    children: [
      panelHeader('工作台首页', '待我处理、失败 Gate、运行中任务、最近报告'),
      el('div', {
        class: 'overview-grid',
        children: [
          renderOverviewBucket('待我处理', overview.toConfirm, 'warn'),
          renderFailedGateBucket(overview.failedGates),
          renderOverviewBucket('运行中 Agent', overview.running, 'info'),
          renderRequestBucket(overview.pendingRequests),
          renderOverviewBucket('最近完成 Report', overview.recentReports, 'good'),
        ],
      }),
    ],
  });
}

function renderTaskListPanel(): HTMLElement {
  const latestRequests = [...data.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestRuns = data.runs.slice(0, 8);
  return el('section', {
    class: 'panel',
    children: [
      panelHeader('任务总览', '工作台只做全局导航；点击某个任务进入完整工作流详情页。'),
      latestRequests.length
        ? el('div', {
            class: 'task-list',
            children: latestRequests.slice(0, 12).map(renderTaskListItem),
          })
        : el('p', { class: 'muted', text: '暂无任务请求。' }),
      latestRuns.length
        ? el('details', {
            class: 'raw-details',
            children: [
              el('summary', { text: `最近 Workflow Run (${latestRuns.length})` }),
              el('div', { class: 'run-list', children: latestRuns.map(renderRunListItem) }),
            ],
          })
        : null,
    ],
  });
}

function renderTaskListItem(request: WorkflowRequestDto): HTMLElement {
  const open = button('查看工作流', 'button secondary small');
  open.onclick = () => setHash('task', request.id);
  return el('article', {
    class: 'task-list-item',
    children: [
      el('div', {
        children: [
          el('strong', { text: request.title }),
          el('small', { text: `${projectName(request.projectId)} · ${request.type} · Source ${request.branch}` }),
        ],
      }),
      pill(request.status),
      open,
    ],
  });
}

function renderRunListItem(run: WorkflowRunDto): HTMLElement {
  const request = data.requests.find((candidate) => candidate.workflowRunId === run.id);
  const item = el('button', {
    class: `run-item ${run.id === activeRunId ? 'active' : ''}`,
    attrs: { type: 'button' },
    children: [
      el('strong', { text: run.title }),
      el('span', { text: `${projectName(run.projectId)} · ${STAGE_LABELS[run.currentStage]}` }),
      pill(run.status),
    ],
  });
  item.onclick = () => (request ? setHash('task', request.id) : setHash('workbench', run.id));
  return item;
}

function renderOverviewBucket(title: string, runs: WorkflowRunDto[], kind: StatusKind): HTMLElement {
  return el('article', {
    class: 'overview-card',
    children: [
      el('div', { class: 'overview-card-head', children: [el('strong', { text: title }), pill(String(runs.length), kind)] }),
      runs.length
        ? el('div', {
            class: 'stack',
            children: runs.slice(0, 3).map((run) => {
              const open = button(shortId(run.id), 'button ghost small');
              const request = data.requests.find((candidate) => candidate.workflowRunId === run.id);
              open.onclick = () => (request ? setHash('task', request.id) : setHash('workbench', run.id));
              return el('div', {
                class: 'mini-row',
                children: [el('span', { text: run.title }), open],
              });
            }),
          })
        : el('p', { class: 'muted compact', text: '暂无。' }),
    ],
  });
}

function renderFailedGateBucket(items: Array<{ runId: string; gateId: string }>): HTMLElement {
  return el('article', {
    class: 'overview-card',
    children: [
      el('div', { class: 'overview-card-head', children: [el('strong', { text: '失败 Gate' }), pill(String(items.length), items.length ? 'bad' : 'good')] }),
      items.length
        ? el('div', {
            class: 'stack',
            children: items.map((item) => el('div', { class: 'mini-row', children: [el('span', { text: item.gateId }), el('code', { text: shortId(item.runId) })] })),
          })
        : el('p', { class: 'muted compact', text: '没有失败 Gate。' }),
    ],
  });
}

function renderRequestBucket(requests: Array<{ title: string; status: string }>): HTMLElement {
  return el('article', {
    class: 'overview-card',
    children: [
      el('div', { class: 'overview-card-head', children: [el('strong', { text: '待认领任务' }), pill(String(requests.length), requests.length ? 'info' : 'muted')] }),
      requests.length
        ? el('div', {
            class: 'stack',
            children: requests.slice(0, 3).map((request) => el('div', { class: 'mini-row', children: [el('span', { text: request.title }), pill(request.status)] })),
          })
        : el('p', { class: 'muted compact', text: '队列为空。' }),
    ],
  });
}

function renderTaskHero(
  request: WorkflowRequestDto,
  detail: RunDetail | null,
  projection: ReturnType<typeof buildRunProjection> | null,
): HTMLElement {
  const status = detail?.run.status ?? request.status;
  const current = detail && projection ? STAGE_LABELS[projection.currentStage] : request.status === 'pending' ? '等待本地 Runner 自动认领' : 'Runner 已认领，正在准备运行';
  return el('section', {
    class: 'hero-card task-hero',
    children: [
      el('div', {
        class: 'hero-copy',
        children: [
          el('div', {
            class: 'run-meta-line',
            children: [
              pill(status),
              el('span', { text: shortId(request.id) }),
              detail ? el('span', { text: `Run ${shortId(detail.run.id)}` }) : null,
              el('span', { text: fmtTime(request.createdAt) }),
            ],
          }),
          el('h2', { text: request.title }),
          el('p', {
            text: detail
              ? `当前阶段：${current} · Source Branch：${detail.run.sourceBranch ?? request.branch} · 工作分支：${detail.run.branch}`
              : `当前阶段：${current} · Source Branch：${request.branch}`,
          }),
        ],
      }),
      el('div', {
        class: 'metric-grid',
        children: [
          metric('Project', projectName(request.projectId), `用户标记: ${request.type}`, 'info'),
          renderCoordinatorVerdictMetric(request),
          metric('Source Branch', request.branch, '本次任务基础分支', 'muted'),
          metric('Current', current, detail?.run.workspacePath ?? '尚未准备 worktree', detail ? statusKind(detail.run.status) : statusKind(request.status)),
          metric('Evidence', projection ? `${projection.summary.gatesPassed}/${detail?.gates.length ?? 0} gates` : '尚未开始', projection ? `${projection.summary.commands} commands` : '等待 Runner', projection?.summary.gatesFailed ? 'bad' : 'muted'),
        ],
      }),
    ],
  });
}

function renderQueuedLifecycle(request: WorkflowRequestDto): HTMLElement {
  const queuedDone = request.status !== 'pending';
  const runnerActive = request.status === 'claimed';
  const states: Array<{ label: string; state: 'done' | 'active' | 'waiting' | 'failed'; help: string }> = [
    { label: '任务入队', state: queuedDone ? 'done' : request.status === 'pending' ? 'active' : 'waiting', help: '任务已创建，等待自动执行' },
    { label: 'Runner 自动开始', state: runnerActive ? 'active' : 'waiting', help: '等待本地 Runner 认领并创建运行' },
    ...USER_VISIBLE_STAGES.map((stage) => ({ label: STAGE_LABELS[stage], state: 'waiting' as const, help: '等待进入该阶段' })),
  ];
  return el('section', {
    class: 'panel',
    children: [
      panelHeader('完整流程', '用户主流程从需求分析开始；系统准备阶段只放在后端细节里。'),
      el('div', {
        class: 'stage-board',
        children: states.map((stage, index) =>
          el('article', {
            class: `stage-card ${stage.state}`,
            children: [
              el('span', { class: 'stage-index', text: String(index + 1).padStart(2, '0') }),
              el('strong', { text: stage.label }),
              el('small', { text: stage.help }),
              el('span', { class: `stage-state ${stage.state}`, text: stage.state }),
            ],
          }),
        ),
      }),
    ],
  });
}

function renderCurrentStagePanel(
  request: WorkflowRequestDto,
  detail: RunDetail | null,
  projection: ReturnType<typeof buildRunProjection> | null,
): HTMLElement {
  if (!detail || !projection) {
    return el('section', {
      class: 'panel current-stage-panel',
      children: [
        panelHeader('当前阶段', request.status === 'pending' ? '等待 Runner 自动开始' : 'Runner 已认领，正在创建 Workflow Run'),
        el('p', {
          text:
            request.status === 'pending'
              ? '页面已经尝试启动本地 Runner；Runner 启动后会自动认领这个任务。'
              : 'Runner 正在准备执行环境，稍后这里会切换到 Requirement / Design / Implementation 等阶段。',
        }),
        renderRequestDebugPanel(request),
      ],
    });
  }

  const stage = projection.currentStage;
  const pendingGate = projection.pendingGate;
  if (pendingGate) {
    return el('section', {
      class: 'current-stage-panel',
      children: [
        el('div', {
          class: 'panel checkpoint',
          children: [
            panelHeader('当前需要你确认', `${STAGE_LABELS[stage]} 暂停在 ${pendingGate}`),
            el('p', { text: '请先查看下面当前阶段产物和右侧确认入口，再决定批准或打回。' }),
          ],
        }),
        currentStageContent(detail, stage),
      ],
    });
  }

  const panel = currentStageContent(detail, stage);
  return el('section', {
    class: 'current-stage-panel',
    children: [panel],
  });
}

function currentStageContent(detail: RunDetail, stage: Stage): HTMLElement {
  if (stage === 'requirement') return renderRequirementPanel(detail);
  if (stage === 'design') return renderDesignPanel(detail);
  if (stage === 'implementation') return renderImplementationPanel(detail);
  if (stage === 'build_test') return renderBuildTestPanel(detail);
  if (stage === 'review') return renderAcceptancePanel(detail);
  if (stage === 'knowledge') return renderKnowledgeSuggestionsPanel(detail);
  if (stage === 'completion') return renderCompletionSnapshotPanel(detail);
  return renderContextSnapshotPanel(detail);
}

function renderContextSnapshotPanel(detail: RunDetail): HTMLElement {
  return el('article', {
    class: 'panel doc-panel',
    children: [
      panelHeader('当前阶段', `${STAGE_LABELS[detail.run.currentStage]} 正在准备上下文和执行环境`),
      field('Workspace', detail.run.workspacePath ?? '尚未准备'),
      field('Source Branch', detail.run.sourceBranch ?? '—'),
      renderRawFallback(detail, detail.run.currentStage === 'context_pack' ? 'context_pack' : 'project_profile'),
    ],
  });
}

function renderCompletionSnapshotPanel(detail: RunDetail): HTMLElement {
  const report = parsedCompletionReport(detail);
  return el('article', {
    class: 'panel doc-panel structured-panel',
    children: [
      panelHeader('交付报告', '交付报告正在生成或已经可查看'),
      report.summary.length ? renderTextList('摘要', report.summary) : el('p', { class: 'muted', text: '等待报告摘要。' }),
      renderRawFallback(detail, 'completion_report'),
    ],
  });
}

function renderTaskNextActionPanel(
  request: WorkflowRequestDto,
  detail: RunDetail | null,
  projection: ReturnType<typeof buildRunProjection> | null,
): HTMLElement {
  if (!detail || !projection) {
    const project = data.projects.find((p) => p.id === request.projectId) ?? null;
    if (!project?.agentBackend) return renderAgentBackendSetupPrompt(project, '选择 Claude Code 或 Codex 后，Runner 才会认领真实执行任务。');
    const start = button(runnerStartInFlight ? '正在启动…' : '启动本地 Runner', 'button primary');
    start.disabled = runnerStartInFlight || Boolean(data.runnerControl?.running);
    start.onclick = () => void ensureRunnerStarted();
    return el('section', {
      class: 'panel side-panel checkpoint',
      children: [
        panelHeader('下一步', request.status === 'pending' ? '等待本地 Runner 自动认领' : 'Runner 正在准备运行'),
        el('p', {
          text: data.runnerControl?.running
            ? 'API 已经托管本地 Runner，任务会自动从队列进入执行。'
            : '如果自动启动失败，可以点击按钮重试，或临时使用命令行兜底。',
        }),
        el('div', { class: 'button-row', children: [start] }),
        data.runnerControl?.running ? null : el('code', { class: 'command-chip', text: 'bun run runner -- watch' }),
      ],
    });
  }
  if (projection.pendingGate) return renderApprovalPanel(detail, projection.pendingGate, projection.currentStage);
  return el('section', {
    class: 'panel side-panel',
    children: [
      panelHeader('下一步', '系统会自动推进到下一个阶段'),
      el('p', { text: `当前正在 ${STAGE_LABELS[projection.currentStage]}。如果遇到 Requirement / Design / Sensitive Change / Acceptance / Knowledge 确认点，页面会在这里显示操作按钮。` }),
      detail.approvals.length
        ? el('div', { class: 'stack', children: detail.approvals.map(renderApprovalRow) })
        : el('p', { class: 'muted compact', text: '当前无需人工确认。' }),
    ],
  });
}

function renderRunnerControlPanel(): HTMLElement {
  const control = data.runnerControl;
  const latest = control?.latestHeartbeat ?? latestRunner();
  const start = button(runnerStartInFlight ? '正在启动…' : control?.running ? 'Runner 已自动运行' : '启动 Runner', control?.running ? 'button secondary small' : 'button primary small');
  start.disabled = runnerStartInFlight || Boolean(control?.running);
  start.onclick = () => void ensureRunnerStarted();
  return el('section', {
    class: 'panel side-panel runner-control-panel',
    children: [
      panelHeader('本地 Runner', 'UI 会自动托管 runner watch；命令行只作为兜底。'),
      field('Control', control?.running ? el('span', { children: [pill('running', 'good'), document.createTextNode(` pid=${control.pid ?? '—'}`)] }) : pill('stopped', 'warn')),
      field('Heartbeat', latest ? `${latest.status} · ${fmtTime(latest.lastSeenAt)}` : '尚未收到'),
      control?.lastExit ? field('Last Exit', `code=${control.lastExit.code ?? 'null'} signal=${control.lastExit.signal ?? 'null'} · ${fmtTime(control.lastExit.at)}`) : null,
      el('div', { class: 'button-row', children: [start] }),
      control?.recentLogs?.length
        ? el('details', {
            class: 'raw-details',
            children: [
              el('summary', { text: `Runner 控制日志 (${control.recentLogs.length})` }),
              el('pre', { class: 'doc-preview code', text: control.recentLogs.slice(-30).join('\n') }),
            ],
          })
        : el('p', { class: 'muted compact', text: '暂无 Runner 控制日志。' }),
    ],
  });
}

function renderAgentBackendSetupPrompt(project: ProjectDto | null, message: string): HTMLElement {
  const configure = actionLink('去配置 Agent Backend', 'projects');
  return el('section', {
    class: 'panel side-panel checkpoint',
    children: [
      panelHeader('需要配置 Agent Backend', '项目级真实后端未就绪'),
      el('p', { text: message }),
      project ? field('Project', project.name) : null,
      field('可选 Backend', 'Claude Code / Codex'),
      el('div', { class: 'button-row', children: [configure] }),
    ],
  });
}

function renderRequestDebugPanel(request: WorkflowRequestDto): HTMLElement {
  return el('details', {
    class: 'raw-details',
    children: [
      el('summary', { text: '查看 Workflow Request 后端细节' }),
      field('Request ID', el('code', { text: request.id })),
      field('Project', projectName(request.projectId)),
      field('Status', pill(request.status)),
      field('Claimed By', request.claimedBy ?? '—'),
      field('Workflow Run', request.workflowRunId ? el('code', { text: request.workflowRunId }) : '尚未创建'),
      field('Error', request.error ?? '—'),
    ],
  });
}

function renderQueuedBackendDetails(request: WorkflowRequestDto): HTMLElement {
  return el('section', {
    class: 'panel',
    children: [
      panelHeader('后端细节', '队列阶段可见的信息'),
      renderRequestDebugPanel(request),
      data.runnerControl
        ? el('details', {
            class: 'raw-details',
            children: [
              el('summary', { text: '查看 Runner Control 状态' }),
              el('pre', { class: 'doc-preview code', text: previewText(JSON.stringify(data.runnerControl, null, 2)) }),
            ],
          })
        : null,
    ],
  });
}

function renderStageBackendDetails(
  detail: RunDetail,
  projection: ReturnType<typeof buildRunProjection>,
): HTMLElement {
  return el('section', {
    class: 'panel',
    children: [
      panelHeader('系统准备 + 阶段后端细节', '任务受理/上下文准备是自动技术准备；需求分析之后才是用户主流程。展开后查看 Step、Agent、Gate、Command、Artifact、Audit。'),
      el('div', {
        class: 'stage-detail-list',
        children: projection.stages.map((stage) => renderStageBackendDetail(detail, stage)),
      }),
    ],
  });
}

function renderStageBackendDetail(detail: RunDetail, stage: ReturnType<typeof buildRunProjection>['stages'][number]): HTMLElement {
  const step = detail.steps.find((candidate) => candidate.stage === stage.id);
  const gates = detail.gates.filter((gate) => gate.gateId === stage.gateId || gate.stepRunId === step?.id);
  const commands = detail.commands.filter((command) => command.stepRunId === step?.id || command.stage === stage.id);
  const artifacts = detail.artifacts.filter((artifact) => artifact.stepRunId === step?.id || artifactForStage(artifact, stage.id));
  const tasks = detail.agentTasks.filter((task) => task.stepRunId === step?.id || agentTaskForStage(task.kind, stage.id));
  const audit = detail.audit.filter((item) => auditForStage(item, stage.id));
  return el('details', {
    class: `stage-detail ${stage.state}`,
    children: [
      el('summary', {
        children: [
          el('strong', { text: stage.label }),
          pill(stage.state, stage.state === 'done' ? 'good' : stage.state === 'failed' ? 'bad' : stage.state === 'blocked' ? 'warn' : stage.state === 'active' ? 'info' : 'muted'),
          el('span', { class: 'muted', text: `${gates.length} gates · ${commands.length} commands · ${artifacts.length} artifacts` }),
        ],
      }),
      field('说明', STAGE_HELP[stage.id]),
      step ? field('Step', `${step.name} · ${step.status}`) : field('Step', stage.id === 'init' ? 'Workflow Run 已创建；该阶段没有独立 StepRun' : '尚未进入'),
      gates.length ? renderDetails('Gate Runs', gates.map(renderGateRow)) : null,
      tasks.length ? renderDetails('Agent Tasks', tasks.map((task) => renderAgentTaskRow(task, detail))) : null,
      commands.length ? renderDetails('Command Runs', commands.map(renderCommandRow)) : null,
      artifacts.length ? renderDetails('Artifacts', artifacts.map((artifact) => renderArtifactRow(artifact, `stage:${stage.id}`))) : null,
      audit.length ? renderDetails('Audit', audit.map(renderAuditRow)) : null,
    ],
  });
}

function artifactForStage(artifact: ArtifactDto, stage: Stage): boolean {
  const map: Partial<Record<Stage, string[]>> = {
    context_pack: ['context_pack', 'project_profile'],
    requirement: ['requirement_draft'],
    design: ['design_doc', 'traceability'],
    implementation: ['diff'],
    build_test: ['surefire_report', 'failsafe_report', 'command_log'],
    review: ['other'],
    completion: ['completion_report'],
    knowledge: ['knowledge_candidate'],
  };
  return (map[stage] ?? []).includes(artifact.kind);
}

function agentTaskForStage(kind: string, stage: Stage): boolean {
  const map: Partial<Record<Stage, string[]>> = {
    context_pack: ['context_pack'],
    requirement: ['requirement_draft'],
    design: ['design_draft'],
    implementation: ['implementation'],
    review: ['review'],
  };
  return (map[stage] ?? []).includes(kind);
}

function auditForStage(item: RunDetail['audit'][number], stage: Stage): boolean {
  const text = `${item.kind} ${JSON.stringify(item.payload ?? {})}`;
  return text.includes(stage) ||
    (stage === 'init' && item.kind === 'workflow_run.created') ||
    (stage === 'context_pack' && text.includes('project_profile'));
}

function renderRunHero(detail: RunDetail, projection: ReturnType<typeof buildRunProjection>): HTMLElement {
  return el('section', {
    class: 'hero-card',
    children: [
      el('div', {
        class: 'hero-copy',
        children: [
          el('div', {
            class: 'run-meta-line',
            children: [pill(detail.run.status), el('span', { text: shortId(detail.run.id) }), el('span', { text: fmtTime(detail.run.createdAt) })],
          }),
          el('h2', { text: detail.run.title }),
          el('p', { text: `本地 worktree：${detail.run.workspacePath ?? '尚未准备'} · 分支：${detail.run.branch}` }),
        ],
      }),
      el('div', {
        class: 'metric-grid',
        children: [
          metric('Commands', String(projection.summary.commands), '真实命令', 'info'),
          metric('Gates', `${projection.summary.gatesPassed}/${detail.gates.length}`, `${projection.summary.gatesWarned} warn · ${projection.summary.gatesFailed} fail`, projection.summary.gatesFailed ? 'bad' : 'good'),
          metric('Tests', `${projection.summary.testsPassed}/${projection.summary.testsTotal}`, 'Surefire/Failsafe', projection.summary.testsTotal ? 'good' : 'muted'),
          metric('Build', projection.summary.buildStatus, '本地 JDK/Maven', statusKind(projection.summary.buildStatus)),
        ],
      }),
    ],
  });
}

function renderLifecycle(detail: RunDetail, projection: ReturnType<typeof buildRunProjection>): HTMLElement {
  return el('section', {
    class: 'panel',
    children: [
      panelHeader('完整生命周期', '从需求分析到知识沉淀的端到端闭环'),
      el('div', {
        class: 'stage-board',
        children: USER_VISIBLE_STAGES.map((stageId, index) => {
          const stage = projection.stages.find((candidate) => candidate.id === stageId)!;
          const step = detail.steps.find((s) => s.stage === stage.id);
          return el('article', {
            class: `stage-card ${stage.state}`,
            children: [
              el('span', { class: 'stage-index', text: String(index + 1).padStart(2, '0') }),
              el('strong', { text: stage.label }),
              el('small', { text: step?.name ?? stage.gateId ?? '等待进入' }),
              el('span', { class: `stage-state ${stage.state}`, text: stage.state }),
            ],
          });
        }),
      }),
    ],
  });
}

function renderStagePanels(detail: RunDetail): HTMLElement {
  return el('section', {
    class: 'stage-panel-grid',
    children: [
      renderRequirementPanel(detail),
      renderDesignPanel(detail),
      renderImplementationPanel(detail),
      renderBuildTestPanel(detail),
      renderAcceptancePanel(detail),
      renderKnowledgeSuggestionsPanel(detail),
    ],
  });
}

function panelHeader(title: string, subtitle?: string): HTMLElement {
  return el('div', {
    class: 'panel-header',
    children: [el('h2', { text: title }), subtitle ? el('p', { text: subtitle }) : null],
  });
}

function renderDocumentPanel(detail: RunDetail, kind: string, title: string, subtitle: string): HTMLElement {
  const artifact = latestArtifactOfKind(detail.artifacts, kind);
  const content = artifact ? artifactContent.get(artifact.id) : null;
  return el('article', {
    class: 'panel doc-panel',
    children: [
      panelHeader(title, subtitle),
      artifact
        ? el('div', {
            class: 'doc-meta',
            children: [pill(artifact.kind, 'muted'), el('code', { text: shortId(artifact.id) })],
          })
        : el('p', { class: 'muted', text: '尚未产生该阶段产物。' }),
      artifact
        ? el('pre', {
            class: 'doc-preview',
            text: content?.text ? previewText(content.text) : 'Loading artifact preview…',
          })
        : null,
    ],
  });
}

function artifactText(detail: RunDetail, kind: string): string {
  const artifact = latestArtifactOfKind(detail.artifacts, kind);
  return artifact ? (artifactContent.get(artifact.id)?.text ?? '') : '';
}

function artifactTextBy(
  detail: RunDetail,
  kind: string,
  predicate: (artifact: ArtifactDto) => boolean,
): string {
  const artifact =
    detail.artifacts
      .filter((candidate) => candidate.kind === kind && predicate(candidate))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1) ?? null;
  return artifact ? (artifactContent.get(artifact.id)?.text ?? '') : '';
}

function markdownArtifactText(detail: RunDetail, kind: string): string {
  return (
    artifactTextBy(
      detail,
      kind,
      (artifact) =>
        artifact.contentType.includes('markdown') ||
        (typeof artifact.metadata?.output === 'string' && artifact.metadata.output.endsWith('.md')),
    ) || artifactText(detail, kind)
  );
}

function structuredArtifactText(detail: RunDetail, kind: string): string {
  return artifactTextBy(
    detail,
    kind,
    (artifact) =>
      artifact.contentType === 'application/json' ||
      artifact.metadata?.structured === true ||
      (typeof artifact.metadata?.output === 'string' && artifact.metadata.output.endsWith('.json')),
  );
}

function parsedRequirement(detail: RunDetail): RequirementDoc {
  return parseRequirementArtifact(
    markdownArtifactText(detail, 'requirement_draft'),
    structuredArtifactText(detail, 'requirement_draft'),
  );
}

function parsedDesign(detail: RunDetail): DesignDoc {
  return parseDesignArtifact(
    markdownArtifactText(detail, 'design_doc'),
    structuredArtifactText(detail, 'design_doc'),
  );
}

function parsedKnowledge(detail: RunDetail): KnowledgeSuggestion[] {
  return parseKnowledgeArtifact(
    markdownArtifactText(detail, 'knowledge_candidate'),
    structuredArtifactText(detail, 'knowledge_candidate'),
  );
}

function parsedCompletionReport(detail: RunDetail) {
  return parseCompletionReportArtifact(
    markdownArtifactText(detail, 'completion_report'),
    structuredArtifactText(detail, 'completion_report'),
  );
}

function renderRequirementPanel(detail: RunDetail): HTMLElement {
  const req = parsedRequirement(detail);
  const gate = [...detail.gates].reverse().find((g) => g.gateId === 'requirement_gate');
  return el('article', {
    class: 'panel doc-panel structured-panel',
    children: [
      panelHeader('需求分析', '目标、验收标准、非目标、待确认问题'),
      renderTextList('目标', req.goals),
      renderAcList(req.acceptanceCriteria, detail),
      renderTextList('非目标', req.nonGoals),
      renderTextList('待确认', req.openQuestions),
      gate ? renderRuleList('Requirement Gate', gate) : el('p', { class: 'muted compact', text: 'Requirement Gate 尚未运行。' }),
      renderRawFallback(detail, 'requirement_draft'),
    ],
  });
}

function renderDesignPanel(detail: RunDetail): HTMLElement {
  const design = parsedDesign(detail);
  const gate = [...detail.gates].reverse().find((g) => g.gateId === 'design_gate');
  return el('article', {
    class: 'panel doc-panel structured-panel',
    children: [
      panelHeader('方案设计', '需求覆盖矩阵、测试策略、风险'),
      design.coverage.length ? renderCoverageTable(design.coverage) : el('p', { class: 'muted', text: '等待需求覆盖矩阵。' }),
      renderTextList('测试策略', design.testStrategy),
      renderTextList('风险', design.risks),
      renderTextList('影响文件', design.filesTouched),
      gate ? renderRuleList('Design Gate', gate) : el('p', { class: 'muted compact', text: 'Design Gate 尚未运行。' }),
      renderRawFallback(detail, 'design_doc'),
    ],
  });
}

function renderTextList(title: string, items: string[]): HTMLElement {
  return el('section', {
    class: 'structured-section',
    children: [
      el('h3', { text: title }),
      items.length
        ? el('ul', { class: 'clean-list', children: items.map((item) => el('li', { text: item })) })
        : el('p', { class: 'muted compact', text: '暂无结构化内容。' }),
    ],
  });
}

function renderAcList(items: Array<{ id: string; text: string }>, detail?: RunDetail): HTMLElement {
  return el('section', {
    class: 'structured-section',
    children: [
      el('h3', { text: '验收标准' }),
      items.length
        ? el('div', {
            class: 'ac-list',
            children: items.map((item) => {
              const latestAction = detail?.actions
                .filter((action) => action.kind === 'requirement_item_action' && action.targetId === item.id)
                .at(-1);
              const confirm = button(latestAction?.action === 'confirm' ? '已确认' : '确认', 'button secondary small');
              confirm.disabled = latestAction?.action === 'confirm';
              if (detail) {
                confirm.onclick = () => void submitRequirementAction(detail.run.id, item.id, 'confirm');
              }
              return el('div', {
                class: 'ac-card',
                children: [
                  pill(item.id, 'info'),
                  el('span', { text: item.text }),
                  detail ? el('div', { class: 'button-row compact', children: [confirm] }) : null,
                ],
              });
            }),
          })
        : el('p', { class: 'muted compact', text: '暂无 AC。' }),
    ],
  });
}

function renderCoverageTable(rows: DesignDoc['coverage']): HTMLElement {
  return el('div', {
    class: 'coverage-table',
    children: [
      el('div', { class: 'coverage-row header', children: [el('strong', { text: '需求' }), el('strong', { text: '设计覆盖' }), el('strong', { text: '测试策略' }), el('strong', { text: '状态' })] }),
      ...rows.map((row) =>
        el('div', {
          class: 'coverage-row',
          children: [
            el('span', { text: `${row.requirement} ${row.acceptanceCriteria.join(', ')}`.trim() }),
            el('span', { text: row.design }),
            el('span', { text: row.verification }),
            pill(row.status, row.status === 'covered' ? 'good' : 'warn'),
          ],
        }),
      ),
    ],
  });
}

function renderRuleList(title: string, gate: GateRunDto): HTMLElement {
  return el('details', {
    class: 'rule-list',
    children: [
      el('summary', { children: [el('strong', { text: title }), pill(gate.status)] }),
      gate.ruleResults.length
        ? el('div', {
            class: 'stack',
            children: gate.ruleResults.map((rule) =>
              el('div', { class: 'mini-row', children: [el('span', { text: rule.ruleId }), pill(rule.status)] }),
            ),
          })
        : el('p', { class: 'muted compact', text: '无规则详情。' }),
    ],
  });
}

function renderRawFallback(detail: RunDetail, kind: string): HTMLElement {
  const text = markdownArtifactText(detail, kind);
  if (!text) return el('p', { class: 'muted compact', text: '原始产物加载中或尚未生成。' });
  const details = el('details', { class: 'raw-details' });
  details.append(
    el('summary', { text: '查看原始 Markdown' }),
    el('pre', { class: 'doc-preview', text: previewText(text) }),
  );
  return details;
}

function previewText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 1400) return trimmed;
  return `${trimmed.slice(0, 1400)}\n\n… truncated for overview; open artifact path for full content.`;
}

function renderImplementationPanel(detail: RunDetail): HTMLElement {
  const diff = latestArtifactOfKind(detail.artifacts, 'diff');
  const content = diff ? artifactContent.get(diff.id) : null;
  const implStep = detail.steps.find((s) => s.stage === 'implementation');
  const changedFiles = changedFilesFromDiff(content?.text ?? '');
  const design = parsedDesign(detail);
  const relatedAcs = [...new Set(design.coverage.flatMap((row) => row.acceptanceCriteria))];
  const sensitiveGate = [...detail.gates].reverse().find((g) => g.gateId === 'sensitive_change_gate');
  return el('article', {
    class: 'panel doc-panel',
    children: [
      panelHeader('代码实现', '当前动作、修改文件、Diff Gate / Sensitive Gate'),
      implStep ? field('Step', el('span', { children: [pill(implStep.status), document.createTextNode(` ${implStep.name}`)] })) : el('p', { class: 'muted', text: '等待实现阶段。' }),
      renderGateChips(detail.gates.filter((g) => ['diff_scope_gate', 'sensitive_change_gate'].includes(g.gateId))),
      renderTextList('修改文件', changedFiles),
      renderTextList('关联 AC', relatedAcs),
      sensitiveGate?.status === 'warn'
        ? el('div', { class: 'notice-inline warn', text: 'Sensitive Change Gate 为 warn：需要人工检查风险后继续。' })
        : null,
      diff ? el('pre', { class: 'doc-preview code', text: content?.text ? previewText(content.text) : 'Loading diff…' }) : null,
    ],
  });
}

function renderGateChips(gates: GateRunDto[]): HTMLElement {
  if (gates.length === 0) return el('p', { class: 'muted compact', text: 'No gate evidence yet.' });
  return el('div', {
    class: 'chip-row',
    children: gates.map((gate) => el('span', { class: 'gate-chip', children: [pill(gate.status), el('span', { text: gate.gateId })] })),
  });
}

function renderBuildTestPanel(detail: RunDetail): HTMLElement {
  const surefireArtifacts = detail.artifacts.filter((a) => ['surefire_report', 'failsafe_report'].includes(a.kind));
  return el('article', {
    class: 'panel doc-panel',
    children: [
      panelHeader('构建测试', '本机 JDK/Maven 真实命令与报告'),
      detail.builds.length === 0
        ? el('p', { class: 'muted', text: '等待 build_test 阶段。' })
        : el('div', {
            class: 'stack',
            children: detail.builds.map((build) =>
              el('div', {
                class: 'build-card',
                children: [
                  el('div', { children: [pill(build.status), el('strong', { text: ` ${build.mavenCommand}` })] }),
                  el('small', { text: `JDK ${build.jdkVersion}` }),
                ],
              }),
            ),
          }),
      detail.tests.length
        ? el('div', {
            class: 'test-grid',
            children: detail.tests.map((test) =>
              metric(test.framework, `${test.passed}/${test.total}`, `${test.failed} failed · ${test.errors} errors · ${test.skipped} skipped`, test.failed || test.errors ? 'bad' : 'good'),
            ),
          })
        : null,
      detail.commands.length ? renderCommandLogPanel(detail.commands) : null,
      surefireArtifacts.length ? renderTestReportPreviews(surefireArtifacts) : null,
    ],
  });
}

function renderCommandLogPanel(commands: RunDetail['commands']): HTMLElement {
  return el('details', {
    class: 'raw-details',
    children: [
      el('summary', { text: `查看命令日志 (${commands.length})` }),
      el('div', {
        class: 'stack',
        children: commands.map((command) => {
          const logs = commandLogs.get(command.id);
          const load = button(logs ? 'Refresh logs' : 'Load logs', 'button secondary small');
          load.onclick = () => void ensureCommandLogs(command.id);
          return el('article', {
            class: 'log-card',
            children: [
              field('Command', el('code', { text: command.command })),
              field('Status', el('span', { children: [pill(command.status), document.createTextNode(` exit=${command.exitCode ?? '∅'}`)] })),
              load,
              logs
                ? el('pre', {
                    class: 'doc-preview code',
                    text: previewText([`# stdout (${logs.stdout.filename})`, logs.stdout.text, `# stderr (${logs.stderr.filename})`, logs.stderr.text].join('\n')),
                  })
                : null,
            ],
          });
        }),
      }),
    ],
  });
}

function renderTestReportPreviews(artifacts: ArtifactDto[]): HTMLElement {
  return el('details', {
    class: 'raw-details',
    children: [
      el('summary', { text: `查看测试报告 (${artifacts.length})` }),
      el('div', {
        class: 'stack',
        children: artifacts.map((artifact) =>
          el('article', {
            class: 'log-card',
            children: [
              field('Report', el('code', { text: artifact.uri })),
              el('pre', { class: 'doc-preview code', text: previewText(artifactContent.get(artifact.id)?.text ?? 'Loading test report…') }),
            ],
          }),
        ),
      }),
    ],
  });
}

function renderAcceptancePanel(detail: RunDetail): HTMLElement {
  const req = parsedRequirement(detail);
  const design = parsedDesign(detail);
  const checklist = buildAcceptanceChecklist(req, design, detail);
  const reviewText = artifactText(detail, 'other');
  return el('article', {
    class: 'panel doc-panel structured-panel',
    children: [
      panelHeader('验收确认', 'AC 覆盖、测试证据与风险确认'),
      checklist.length
        ? el('div', {
            class: 'acceptance-list',
            children: checklist.map((item) =>
              el('div', {
                class: `acceptance-card ${item.status}`,
                children: [
                  el('div', { children: [pill(item.id, item.status === 'passed' ? 'good' : item.status === 'at_risk' ? 'warn' : 'bad'), el('strong', { text: item.text })] }),
                  item.evidence.length ? el('small', { text: `Evidence: ${item.evidence.join(' · ')}` }) : null,
                  item.risk ? el('small', { class: 'warn', text: item.risk }) : null,
                ],
              }),
            ),
          })
        : el('p', { class: 'muted', text: '暂无 AC checklist。' }),
      reviewText ? el('details', { class: 'raw-details', children: [el('summary', { text: '查看 Review 原文' }), el('pre', { class: 'doc-preview', text: previewText(reviewText) })] }) : null,
    ],
  });
}

function renderKnowledgeSuggestionsPanel(detail: RunDetail): HTMLElement {
  const suggestions = parsedKnowledge(detail);
  return el('article', {
    class: 'panel doc-panel structured-panel',
    children: [
      panelHeader('知识沉淀候选', '候选经验，人工接受后才入库'),
      suggestions.length
        ? el('div', { class: 'stack', children: suggestions.map((suggestion, index) => renderKnowledgeSuggestion(suggestion, index, detail)) })
        : el('p', { class: 'muted', text: '暂无 Knowledge 候选。' }),
    ],
  });
}

function renderRunsPanel(): HTMLElement {
  return el('section', {
    class: 'panel side-panel',
    children: [
      panelHeader('Runs', '最新工作流'),
      el('div', {
        class: 'run-list',
        children: data.runs.slice(0, 12).map(renderRunListItem),
      }),
    ],
  });
}

function renderApprovalPanel(detail: RunDetail, pendingGate: string | null, currentStage: Stage = detail.run.currentStage): HTMLElement {
  const sensitiveWarn = [...detail.gates]
    .reverse()
    .find((g) => g.gateId === 'sensitive_change_gate' && g.status === 'warn');
  const sensitiveDecision = detail.approvals.find((a) => a.gateId === 'sensitive_change_gate');
  if ((!pendingGate || pendingGate === 'sensitive_change_gate') && sensitiveWarn && !sensitiveDecision) {
    const approveBtn = button('批准敏感变更继续', 'button primary');
    const rejectBtn = button('要求修改', 'button danger');
    approveBtn.onclick = () => void submitApproval(detail.run.id, 'sensitive_change_gate', true);
    rejectBtn.onclick = () => void submitApproval(detail.run.id, 'sensitive_change_gate', false);
    return el('section', {
      class: 'panel side-panel checkpoint',
      children: [
        panelHeader('Sensitive Change Checkpoint', '发现敏感路径或高风险变更'),
        renderRuleList('Sensitive Change Gate', sensitiveWarn),
        el('p', { text: '请检查 diff、设计范围和风险说明后再决定是否继续。' }),
        el('div', { class: 'button-row', children: [approveBtn, rejectBtn] }),
      ],
    });
  }

  if (!pendingGate) {
    return el('section', {
      class: 'panel side-panel',
      children: [
        panelHeader('人工确认点', '当前确认历史'),
        detail.approvals.length
          ? el('div', { class: 'stack', children: detail.approvals.map(renderApprovalRow) })
          : el('p', { class: 'muted', text: '当前无需人工确认。' }),
      ],
    });
  }

  const isAcceptance = pendingGate === 'acceptance_gate';
  const approveBtn = button(isAcceptance ? '接受风险并验收' : `Approve ${pendingGate}`, 'button primary');
  const rejectBtn = button('Reject', 'button danger');
  const inFlight = approvalInFlight.has(`${detail.run.id}:${pendingGate}`);
  approveBtn.disabled = inFlight;
  rejectBtn.disabled = inFlight;
  approveBtn.onclick = () =>
    void (isAcceptance
      ? submitAcceptanceDecision(detail.run.id, 'accept_risk')
      : submitApproval(detail.run.id, pendingGate, true));
  rejectBtn.onclick = () =>
    void (isAcceptance
      ? submitAcceptanceDecision(detail.run.id, 'reject')
      : submitApproval(detail.run.id, pendingGate, false));

  return el('section', {
    class: 'panel side-panel checkpoint',
    children: [
      panelHeader('等待人工确认', `${STAGE_LABELS[currentStage]} 暂停在 ${pendingGate}`),
      el('p', { text: isAcceptance ? '请逐项检查 AC checklist；若证据不足但可接受，需显式接受风险。' : '请先检查需求/设计/构建证据，再批准进入下一阶段。' }),
      el('div', { class: 'button-row', children: [approveBtn, rejectBtn] }),
    ],
  });
}

function renderApprovalRow(approval: { gateId: string; decision: string; actor: string; decidedAt: string }): HTMLElement {
  return el('div', {
    class: 'approval-row',
    children: [
      el('span', { children: [pill(approval.decision), document.createTextNode(` ${approval.gateId}`)] }),
      el('small', { text: `${approval.actor} · ${fmtTime(approval.decidedAt)}` }),
    ],
  });
}

function renderEvidencePanel(detail: RunDetail): HTMLElement {
  return el('section', {
    class: 'panel side-panel evidence-panel',
    children: [
      panelHeader('Evidence Drill-down', '工程证据默认折叠'),
      renderDetails('Gate Runs', detail.gates.map(renderGateRow)),
      renderDetails('Command Runs', detail.commands.map(renderCommandRow)),
      renderDetails('Artifacts', detail.artifacts.map((artifact) => renderArtifactRow(artifact, 'evidence'))),
      renderDetails('Agent Audit', detail.agentTasks.map((task) => renderAgentTaskRow(task, detail))),
    ],
  });
}

function renderDetails(title: string, children: HTMLElement[]): HTMLElement {
  const details = el('details', { class: 'evidence-group' });
  details.appendChild(el('summary', { text: `${title} (${children.length})` }));
  details.appendChild(children.length ? el('div', { class: 'stack', children }) : el('p', { class: 'muted compact', text: 'No evidence yet.' }));
  return details;
}

function renderGateRow(gate: GateRunDto): HTMLElement {
  return el('div', {
    class: 'evidence-row',
    children: [
      el('span', { children: [pill(gate.status), document.createTextNode(` ${gate.gateId}`)] }),
      gate.ruleResults.length
        ? el('small', { text: gate.ruleResults.map((r) => `${r.ruleId}:${r.status}`).join(' · ') })
        : el('small', { text: fmtTime(gate.decidedAt) }),
    ],
  });
}

function renderCommandRow(command: RunDetail['commands'][number]): HTMLElement {
  return el('div', {
    class: 'evidence-row',
    children: [
      el('span', { children: [pill(command.status), document.createTextNode(` exit=${command.exitCode ?? '∅'}`)] }),
      el('code', { text: command.command }),
    ],
  });
}

function renderArtifactRow(artifact: ArtifactDto, viewerScope: string): HTMLElement {
  const canReadInline = isReadableFileArtifact(artifact);
  const isOpen = openArtifactViewers.has(artifact.id);
  const toggle = button(isOpen ? '收起文件' : '查看文件内容', 'button secondary small');
  toggle.disabled = !canReadInline;
  toggle.onclick = () => toggleArtifactViewer(artifact);

  return el('div', {
    class: 'evidence-row artifact-row',
    children: [
      el('div', {
        class: 'evidence-row-head',
        children: [
          el('span', { children: [pill(artifact.kind, 'muted'), document.createTextNode(` ${shortId(artifact.id)}`)] }),
          toggle,
        ],
      }),
      el('code', { text: artifact.uri }),
      !canReadInline ? el('small', { text: '当前只支持直接查看本地 file:// Artifact。' }) : null,
      isOpen ? renderArtifactInlineViewer(artifact, viewerScope) : null,
    ],
  });
}

function toggleArtifactViewer(artifact: ArtifactDto): void {
  if (openArtifactViewers.has(artifact.id)) {
    openArtifactViewers.delete(artifact.id);
    render();
    return;
  }
  openArtifactViewers.add(artifact.id);
  void ensureArtifactContent(artifact.id);
  render();
}

function renderArtifactInlineViewer(artifact: ArtifactDto, viewerScope: string): HTMLElement {
  const content = artifactContent.get(artifact.id);
  if (!content) {
    return el('p', { class: 'muted compact', text: '正在加载文件内容；如果长时间没有出现，说明该文件暂不可读取。' });
  }

  return el('div', {
    class: 'artifact-inline-viewer',
    children: [
      el('div', {
        class: 'doc-meta',
        children: [
          pill(content.filename, 'info'),
          pill(content.contentType, 'muted'),
        ],
      }),
      el('pre', {
        class: 'doc-preview code',
        text: previewText(content.text),
        attrs: { 'data-scroll-key': artifactViewerScrollKey(artifact, viewerScope) },
      }),
    ],
  });
}

function renderAgentTaskRow(task: RunDetail['agentTasks'][number], detail: RunDetail): HTMLElement {
  const result = detail.agentResults.find((r) => r.taskId === task.id);
  return el('div', {
    class: 'evidence-row',
    children: [
      el('span', { children: [pill(result?.status ?? 'pending'), document.createTextNode(` ${agentBackendDisplayName(task.backend as AgentBackendKind)}:${task.kind}`)] }),
      result?.summary ? el('small', { text: result.summary }) : null,
    ],
  });
}

function renderAuditRow(item: RunDetail['audit'][number]): HTMLElement {
  return el('div', {
    class: 'evidence-row',
    children: [
      el('span', { children: [pill('audit', 'muted'), document.createTextNode(` ${item.kind}`)] }),
      el('small', { text: fmtTime(item.at) }),
    ],
  });
}

function renderAgentStreamPanel(): HTMLElement {
  const runId = data.activeDetail?.run.id ?? null;
  const view = buildAgentStreamView(runId);
  const expandRunId = view.runId;
  const expandButton = expandRunId ? button('放大录屏', 'button secondary small stream-expand-button') : null;
  if (expandRunId && expandButton) {
    expandButton.setAttribute('aria-label', `放大查看 ${view.title}`);
    expandButton.setAttribute('aria-haspopup', 'dialog');
    expandButton.setAttribute('aria-expanded', expandedStreamRunId === expandRunId ? 'true' : 'false');
    expandButton.dataset.streamExpandRunId = expandRunId;
    expandButton.onclick = () => openExpandedStream(expandRunId);
  }
  return el('section', {
    class: 'panel side-panel stream-panel',
    children: [
      el('div', {
        class: 'stream-head',
        children: [
          el('div', {
            children: [
              renderStreamTitle(view),
              renderStreamSummary(view),
            ],
          }),
          el('div', {
            class: 'stream-actions',
            children: [renderStreamStatus(view), expandButton],
          }),
        ],
      }),
      renderAgentStreamBody(view, { id: 'stream-body', scrollKeyPrefix: 'agent-stream' }),
    ],
  });
}

function renderExpandedAgentStreamOverlay(runId: string): HTMLElement {
  const view = buildAgentStreamView(runId);
  const titleId = 'stream-modal-title';
  const summaryId = 'stream-modal-summary';
  const closeButton = button('关闭', 'button secondary small');
  closeButton.dataset.streamClose = 'agent-stream';
  closeButton.setAttribute('aria-label', `关闭 ${view.title} 放大查看`);
  closeButton.onclick = closeExpandedStream;
  const overlay = el('div', {
    class: 'stream-overlay',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': summaryId,
    },
    children: [
      el('section', {
        class: 'stream-modal',
        children: [
          el('div', {
            class: 'stream-head stream-modal-head',
            children: [
              el('div', {
                children: [
                  el('span', { class: 'eyebrow', text: 'Recording View' }),
                  renderStreamTitle(view, titleId),
                  renderStreamSummary(view, summaryId),
                ],
              }),
              el('div', {
                class: 'stream-actions',
                children: [renderStreamStatus(view), closeButton],
              }),
            ],
          }),
          renderAgentStreamBody(view, { expanded: true, scrollKeyPrefix: 'agent-stream-expanded' }),
        ],
      }),
    ],
  });
  overlay.onclick = (event) => {
    if (event.target === overlay) closeExpandedStream();
  };
  return overlay;
}

function renderProjectsPage(): HTMLElement {
  const form = el('form', { class: 'form-card' });
  const sourceSelect = el('select', { attrs: { name: 'sourceKind' } });
  for (const option of projectSourceOptions()) {
    const node = el('option', { text: option.label, attrs: { value: option.value } });
    if (option.value === projectSourceForm.sourceKind) node.setAttribute('selected', 'selected');
    sourceSelect.appendChild(node);
  }
  sourceSelect.onchange = () => {
    setProjectSourceKind(sourceSelect.value as ProjectSourceKind);
    render();
  };

  const isEditing = Boolean(projectSourceForm.editingProjectId);
  form.append(
    panelHeader(isEditing ? '编辑项目' : '接入项目', isEditing ? '右侧已接入项目点击后会回填到这里；修改连接信息后建议重新检测，再保存。' : '先选择接入类型；按类型填写连接信息；点击检测拉取项目名、分支和元数据；确认无误后接入。'),
    el('label', { class: 'input-block', children: [el('span', { text: 'Source Type' }), sourceSelect] }),
    ...renderProjectSourceDynamicFields(),
    renderAgentBackendConfigFields(),
    renderProjectDetectPanel(),
  );

  const detect = el('button', { class: 'button secondary', text: projectSourceForm.detecting ? '检测中…' : '检测', attrs: { type: 'button' } });
  detect.disabled = projectSourceForm.detecting;
  detect.onclick = () => void detectProjectSource();
  const submit = el('button', { class: 'button primary', text: isEditing ? '保存修改' : '接入这个项目', attrs: { type: 'submit' } });
  submit.disabled = !projectSourceForm.detectResult?.ok || projectSourceForm.detecting;
  const cancelEdit = isEditing ? el('button', { class: 'button ghost', text: '取消编辑', attrs: { type: 'button' } }) : null;
  if (cancelEdit) cancelEdit.onclick = () => { resetProjectSourceForm(); render(); };
  form.appendChild(el('div', { class: 'button-row', children: [detect, submit, cancelEdit] }));
  form.onsubmit = (event) => void submitProject(event);

  return el('section', {
    class: 'page-grid two-col',
    children: [
      form,
      el('section', {
        class: 'panel',
        children: [
          panelHeader('已接入项目', '点击卡片编辑；删除会先判断是否应归档以保留历史。'),
          data.projects.length
            ? el('div', { class: 'stack', children: data.projects.map(renderProjectCard) })
            : el('p', { class: 'muted', text: '暂无项目。' }),
          renderProjectProfilePreview(),
          renderToolchainReadiness(),
        ],
      }),
    ],
  });
}

function projectSourceOptions(): Array<{ value: ProjectSourceKind; label: string }> {
  return [
    { value: 'github', label: 'GitHub 项目' },
    { value: 'gitee', label: 'Gitee 项目' },
    { value: 'local', label: '本地项目' },
    { value: 'gitlab', label: '私有 GitLab 项目' },
  ];
}

function setProjectSourceKind(sourceKind: ProjectSourceKind): void {
  projectSourceForm.sourceKind = sourceKind;
  projectSourceForm.sourceAuthKind = defaultAuthKind(sourceKind);
  projectSourceForm.sourceUsername = '';
  projectSourceForm.sourceCredential = '';
  projectSourceForm.detectResult = null;
}

function defaultAuthKind(sourceKind: ProjectSourceKind): ProjectSourceAuthKind {
  if (sourceKind === 'gitlab') return 'ssh';
  return 'none';
}

function renderProjectSourceDynamicFields(): HTMLElement[] {
  const sourceKind = projectSourceForm.sourceKind;
  const fields: HTMLElement[] = [
    controlledInput('Project Name', 'name', '检测通过后自动填充，也可手动修改', projectSourceForm.name, (v) => {
      projectSourceForm.name = v;
    }),
  ];

  if (sourceKind === 'local') {
    fields.push(
      renderLocalPathPickerField(),
      el('p', { class: 'muted compact', text: '本地项目不需要 Token；检测会确认该路径是 Git 仓库并读取本地分支。' }),
    );
    if (localDirectoryPicker.open) fields.push(renderLocalDirectoryPicker());
    fields.push(renderBranchControl());
    return fields;
  }

  fields.push(
    controlledInput(sourceUrlLabel(sourceKind), 'sourceValue', sourceUrlPlaceholder(sourceKind), projectSourceForm.sourceValue, (v) => {
      projectSourceForm.sourceValue = v;
      projectSourceForm.detectResult = null;
    }),
    renderAuthFields(sourceKind),
    renderBranchControl(),
  );
  return fields;
}

function renderAgentBackendConfigFields(): HTMLElement {
  const select = el('select', { attrs: { name: 'agentBackend' } });
  select.appendChild(el('option', { text: '请选择真实 Agent Backend', attrs: { value: '' } }));
  for (const option of agentBackendOptions()) {
    const node = el('option', { text: option.label, attrs: { value: option.value } });
    if (option.value === projectSourceForm.agentBackend) node.setAttribute('selected', 'selected');
    select.appendChild(node);
  }
  select.onchange = () => {
    projectSourceForm.agentBackend = select.value as ProjectSourceFormState['agentBackend'];
    render();
  };

  const key = projectSourceForm.editingProjectId ?? formAgentBackendKey(projectSourceForm.agentBackend || null);
  const selectedBackend = projectSourceForm.agentBackend || null;
  const check = key ? agentBackendPreflight.get(key) : null;
  const matchingCheck = check?.backend === selectedBackend ? check : null;
  const checking = key ? agentBackendPreflightInFlight.has(key) : false;
  const test = el('button', {
    class: 'button secondary small',
    text: checking ? '检测中…' : '检测连接',
    attrs: { type: 'button' },
  });
  test.disabled = !projectSourceForm.agentBackend || checking;
  test.onclick = () => void checkAgentBackend(projectSourceForm.agentBackend || null, projectSourceForm.editingProjectId ?? null);

  return el('article', {
    class: 'runner-card',
    children: [
      panelHeader('Agent Backend', '项目级默认；只能选择 Claude Code 或 Codex。保存后后续任务默认沿用。'),
      el('label', { class: 'input-block', children: [el('span', { text: 'Backend' }), select] }),
      matchingCheck ? renderAgentBackendCheck(matchingCheck) : el('p', { class: 'muted compact', text: '保存或创建任务前会要求完成连接检测；检测会调用真实 CLI。' }),
      el('div', { class: 'button-row', children: [test] }),
    ],
  });
}

function agentBackendOptions(): Array<{ value: ProjectAgentBackendKind; label: string }> {
  return [
    { value: 'claude_code', label: 'Claude Code' },
    { value: 'codex', label: 'Codex' },
  ];
}

function renderLocalPathPickerField(): HTMLElement {
  const input = el('input', {
    attrs: {
      name: 'sourceValue',
      placeholder: './examples/java-maven-sample',
      value: projectSourceForm.sourceValue,
    },
  });
  input.oninput = () => {
    projectSourceForm.sourceValue = input.value;
    projectSourceForm.detectResult = null;
  };
  const browse = el('button', { class: 'button secondary', text: '选择文件夹', attrs: { type: 'button' } });
  browse.onclick = () => void openLocalDirectoryPicker();
  return el('label', {
    class: 'input-block',
    children: [
      el('span', { text: 'Local Path' }),
      el('div', { class: 'button-row', children: [input, browse] }),
    ],
  });
}

function renderLocalDirectoryPicker(): HTMLElement {
  const listing = localDirectoryPicker.listing;
  const rows: HTMLElement[] = [];
  if (localDirectoryPicker.loading) rows.push(el('p', { class: 'muted compact', text: '正在读取本地文件夹…' }));
  if (localDirectoryPicker.error) rows.push(el('p', { class: 'notice-inline warn', text: localDirectoryPicker.error }));
  if (listing) {
    const chooseCurrent = el('button', { class: 'button primary small', text: '选择当前文件夹', attrs: { type: 'button' } });
    chooseCurrent.onclick = () => chooseLocalDirectory(listing.path);
    const parent = el('button', { class: 'button secondary small', text: '上一级', attrs: { type: 'button' } });
    parent.onclick = () => void loadLocalDirectories(listing.parent);
    rows.push(
      field('当前路径', el('code', { text: listing.path })),
      el('div', { class: 'button-row', children: [chooseCurrent, parent] }),
    );
    rows.push(
      el('div', {
        class: 'stack',
        children: listing.directories.length
          ? listing.directories.map((dir) => {
              const btn = el('button', { class: 'run-item', attrs: { type: 'button' }, children: [el('strong', { text: dir.name }), el('span', { text: dir.path })] });
              btn.onclick = () => void loadLocalDirectories(dir.path);
              return btn;
            })
          : [el('p', { class: 'muted compact', text: '当前目录下没有可选子文件夹。' })],
      }),
    );
  }
  const close = el('button', { class: 'button ghost', text: '关闭选择器', attrs: { type: 'button' } });
  close.onclick = () => {
    localDirectoryPicker.open = false;
    render();
  };
  rows.push(close);
  return el('article', {
    class: 'runner-card',
    children: [panelHeader('选择本地文件夹', '浏览 API/runner 所在机器上的目录，选中后会填入 Local Path。'), ...rows],
  });
}

async function openLocalDirectoryPicker(): Promise<void> {
  localDirectoryPicker.open = true;
  await loadLocalDirectories(projectSourceForm.sourceValue.trim());
}

async function loadLocalDirectories(path: string): Promise<void> {
  localDirectoryPicker.loading = true;
  localDirectoryPicker.error = null;
  render();
  try {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    localDirectoryPicker.listing = await api<LocalDirectoryList>(`/projects/local-directories${query}`);
  } catch (err) {
    localDirectoryPicker.error = err instanceof Error ? err.message : String(err);
  } finally {
    localDirectoryPicker.loading = false;
    render();
  }
}

function chooseLocalDirectory(path: string): void {
  projectSourceForm.sourceValue = path;
  projectSourceForm.detectResult = null;
  localDirectoryPicker.open = false;
  render();
}

function sourceUrlLabel(sourceKind: ProjectSourceKind): string {
  if (sourceKind === 'github') return 'GitHub Repository';
  if (sourceKind === 'gitee') return 'Gitee Repository';
  if (sourceKind === 'gitlab') return 'GitLab Repository URL';
  return 'Repository URL';
}

function sourceUrlPlaceholder(sourceKind: ProjectSourceKind): string {
  if (sourceKind === 'github') return 'owner/repo 或 https://github.com/owner/repo.git';
  if (sourceKind === 'gitee') return 'owner/repo 或 https://gitee.com/owner/repo.git';
  if (sourceKind === 'gitlab') return 'git@gitlab.company.com:group/repo.git 或 HTTPS URL';
  return 'https://git.example.com/group/repo.git';
}

function renderAuthFields(sourceKind: ProjectSourceKind): HTMLElement {
  const authSelect = el('select', { attrs: { name: 'sourceAuthKind' } });
  for (const option of authOptions(sourceKind)) {
    const node = el('option', { text: option.label, attrs: { value: option.value } });
    if (option.value === projectSourceForm.sourceAuthKind) node.setAttribute('selected', 'selected');
    authSelect.appendChild(node);
  }
  authSelect.onchange = () => {
    projectSourceForm.sourceAuthKind = authSelect.value as ProjectSourceAuthKind;
    projectSourceForm.sourceCredential = '';
    projectSourceForm.detectResult = null;
    render();
  };

  const children: Array<Node | null> = [
    el('label', { class: 'input-block', children: [el('span', { text: 'Authentication' }), authSelect] }),
  ];

  if (projectSourceForm.sourceAuthKind === 'token') {
    children.push(
      controlledInput('Token', 'sourceCredential', 'Personal Access Token / Access Token', projectSourceForm.sourceCredential, (v) => {
        projectSourceForm.sourceCredential = v;
        projectSourceForm.detectResult = null;
      }, 'password'),
    );
  }
  if (projectSourceForm.sourceAuthKind === 'basic') {
    children.push(
      controlledInput('Username', 'sourceUsername', '用于 HTTPS Basic Auth 的用户名', projectSourceForm.sourceUsername, (v) => {
        projectSourceForm.sourceUsername = v;
        projectSourceForm.detectResult = null;
      }),
      controlledInput('Password', 'sourceCredential', '密码或应用专用密码', projectSourceForm.sourceCredential, (v) => {
        projectSourceForm.sourceCredential = v;
        projectSourceForm.detectResult = null;
      }, 'password'),
    );
  }

  children.push(el('p', { class: 'muted compact', text: authHint(sourceKind, projectSourceForm.sourceAuthKind) }));
  return el('div', { class: 'stack', children });
}

function authOptions(sourceKind: ProjectSourceKind): Array<{ value: ProjectSourceAuthKind; label: string }> {
  if (sourceKind === 'github') {
    return [
      { value: 'none', label: '公开仓库 / 已配置 Git 凭据' },
      { value: 'token', label: 'Personal Access Token' },
    ];
  }
  if (sourceKind === 'gitee') {
    return [
      { value: 'none', label: '公开仓库 / 已配置 Git 凭据' },
      { value: 'token', label: 'Access Token' },
      { value: 'basic', label: '用户名 + 密码' },
    ];
  }
  return [
    { value: 'ssh', label: 'SSH Key（runner 已配置）' },
    { value: 'token', label: 'Access Token' },
    { value: 'basic', label: '用户名 + 密码' },
    { value: 'none', label: '公开仓库 / 已配置 Git 凭据' },
  ];
}

function authHint(sourceKind: ProjectSourceKind, authKind: ProjectSourceAuthKind): string {
  if (authKind === 'ssh') return 'SSH 方式不会保存密码；runner 需要能通过本机 SSH key 访问该仓库。';
  if (authKind === 'token') return projectSourceForm.editingProjectId ? `${sourceKindLabel(sourceKind)} Token 不会回显；留空保存会保留原 Token，若要重新检测私有仓库请重新输入。` : `${sourceKindLabel(sourceKind)} Token 会用于检测，并以 runner-only 方式保存供后续 clone/fetch 使用；列表页不会回显明文。`;
  if (authKind === 'basic') return projectSourceForm.editingProjectId ? '密码不会回显；留空保存会保留原密码，若要重新检测私有仓库请重新输入。' : '用户名和密码会用于 HTTPS 检测，并以 runner-only 方式保存；列表页不会回显密码。';
  return '不填写凭据时，检测和后续拉取依赖公开仓库或 runner 机器已有 Git credential helper。';
}

function sourceKindLabel(sourceKind: ProjectSourceKind): string {
  return projectSourceOptions().find((o) => o.value === sourceKind)?.label ?? sourceKind;
}

function renderBranchControl(): HTMLElement {
  const result = projectSourceForm.detectResult;
  if (result?.ok && result.branches.length) {
    const select = el('select', { attrs: { name: 'defaultBranch' } });
    for (const branch of result.branches) {
      const node = el('option', { text: branch, attrs: { value: branch } });
      if (branch === projectSourceForm.defaultBranch) node.setAttribute('selected', 'selected');
      select.appendChild(node);
    }
    select.onchange = () => {
      projectSourceForm.defaultBranch = select.value;
    };
    return el('label', { class: 'input-block', children: [el('span', { text: 'Default Branch' }), select] });
  }
  return controlledInput('Default Branch', 'defaultBranch', 'main', projectSourceForm.defaultBranch, (v) => {
    projectSourceForm.defaultBranch = v || 'main';
  });
}

function renderProjectDetectPanel(): HTMLElement {
  const result = projectSourceForm.detectResult;
  if (projectSourceForm.detecting) {
    return el('article', { class: 'runner-card', children: [field('检测状态', '正在连接远端并读取分支…')] });
  }
  if (!result) {
    return el('article', { class: 'runner-card', children: [field('检测状态', '尚未检测'), field('下一步', '点击“检测”拉取项目名称、分支列表和元数据。')] });
  }
  if (!result.ok) {
    return el('article', { class: 'runner-card', children: [field('检测状态', pill('failed', 'bad')), field('错误', result.error)] });
  }
  return el('article', {
    class: 'runner-card',
    children: [
      field('检测状态', pill('passed', 'good')),
      field('项目名', result.projectName),
      field('默认分支', result.defaultBranch),
      field('分支列表', result.branches.join(', ') || '—'),
      field('元数据', Object.entries(result.metadata).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'),
    ],
  });
}

function renderProjectProfilePreview(): HTMLElement {
  const detail = data.activeDetail;
  const profile = detail ? latestArtifactOfKind(detail.artifacts, 'project_profile') : null;
  const text = profile ? artifactContent.get(profile.id)?.text : null;
  return el('details', {
    class: 'raw-details',
    children: [
      el('summary', { text: '最近运行的 Project Profile 预览' }),
      el('p', { class: 'muted compact', text: '说明：这里展示的是当前工作台选中 workflow run 的 project_profile 产物，不是右侧点击选中的项目配置；只有跑过 workflow 才会生成。' }),
      text
        ? el('pre', { class: 'doc-preview', text: previewText(text) })
        : el('p', { class: 'muted compact', text: '当前没有可预览的 project_profile。' }),
    ],
  });
}

function renderToolchainReadiness(): HTMLElement {
  const runner = latestRunner();
  return el('article', {
    class: 'runner-card',
    children: [
      panelHeader('Local Runner / Toolchain', runner ? `${runner.status} · ${fmtTime(runner.lastSeenAt)}` : '尚未连接'),
      field('JDK', runner?.jdkVersion ?? '—'),
      field('Maven', runner?.mavenVersion?.split('\n')[0] ?? '—'),
      field('Git', runner?.gitVersion ?? '—'),
      el('code', { class: 'command-chip', text: 'bun run runner -- doctor && bun run runner -- watch' }),
    ],
  });
}

function renderAgentBackendCheck(check: AgentBackendPreflightDto): HTMLElement {
  return el('div', {
    class: 'agent-backend-check',
    children: [
      field('状态', pill(preflightStatusLabel(check), preflightStatusKind(check))),
      field('CLI', check.bin ?? '—'),
      field('Version', check.version ?? '—'),
      check.error ? field('错误', check.error) : null,
      field('修复提示', check.remediationHint),
    ],
  });
}

function preflightStatusLabel(check: AgentBackendPreflightDto): string {
  if (check.runnable) return 'Connected';
  if (check.status === 'not_configured') return 'Needs setup';
  if (check.status === 'missing_cli') return 'CLI missing';
  if (check.status === 'needs_login') return 'Needs login';
  return 'Check failed';
}

function preflightStatusKind(check: AgentBackendPreflightDto): StatusKind {
  if (check.runnable) return 'good';
  if (check.status === 'not_configured' || check.status === 'needs_login') return 'warn';
  return 'bad';
}

function formAgentBackendKey(backend: ProjectAgentBackendKind | null): string | null {
  return backend ? `backend:${backend}` : null;
}

async function checkAgentBackend(
  backend: ProjectAgentBackendKind | null,
  projectId: string | null,
): Promise<AgentBackendPreflightDto | null> {
  const key = projectId ?? formAgentBackendKey(backend);
  if (!backend || !key || agentBackendPreflightInFlight.has(key)) return null;
  agentBackendPreflightInFlight.add(key);
  render();
  try {
    const path = projectId
      ? `/projects/${encodeURIComponent(projectId)}/agent-backend/preflight`
      : '/projects/agent-backend/preflight';
    const result = await api<AgentBackendPreflightDto>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentBackend: backend }),
    });
    agentBackendPreflight.set(key, result);
    if (projectId) agentBackendPreflight.set(formAgentBackendKey(backend)!, result);
    lastError = result.runnable ? null : `${result.label}: ${result.remediationHint}${result.error ? ` (${result.error})` : ''}`;
    return result;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    agentBackendPreflightInFlight.delete(key);
    render();
  }
}

function renderProjectCard(project: ProjectDto): HTMLElement {
  const sourceKind = project.sourceKind ?? 'local';
  const status = project.status ?? 'active';
  const backendStatus = agentBackendStatusForProject(project);
  const action = el('button', {
    class: status === 'archived' ? 'button ghost small' : 'button danger small',
    text: projectActionInFlight.has(project.id) ? '处理中…' : status === 'archived' ? '已归档' : '删除 / 归档',
    attrs: { type: 'button' },
  });
  action.disabled = projectActionInFlight.has(project.id) || status === 'archived';
  action.onclick = (event) => {
    event.stopPropagation();
    void deleteOrArchiveProject(project);
  };
  const backendCheck = el('button', {
    class: 'button secondary small',
    text: agentBackendPreflightInFlight.has(project.id) ? '检测中…' : '检测 Backend',
    attrs: { type: 'button' },
  });
  backendCheck.disabled = !project.agentBackend || agentBackendPreflightInFlight.has(project.id);
  backendCheck.onclick = (event) => {
    event.stopPropagation();
    void checkAgentBackend(project.agentBackend ?? null, project.id);
  };

  const card = el('article', {
    class: `project-card ${projectSourceForm.editingProjectId === project.id ? 'active' : ''}`,
    attrs: { role: 'button', tabindex: '0', title: '点击回填到左侧编辑' },
    children: [
      el('div', { children: [el('strong', { text: project.name }), pill(status === 'archived' ? '已归档' : sourceKindLabel(sourceKind), status === 'archived' ? 'warn' : 'muted')] }),
      field('Branch', project.defaultBranch),
      field('Auth', authSummary(project)),
      field('Agent Backend', el('span', { children: [
        document.createTextNode(project.agentBackend ? agentBackendDisplayName(project.agentBackend) : '未配置'),
        document.createTextNode(' · '),
        pill(backendStatus.label, backendStatus.kind),
      ] })),
      status === 'archived' ? field('Archived', fmtTime(project.archivedAt)) : null,
      field(sourceKind === 'local' ? 'Path' : 'Repo URL', el('code', { text: project.sourceUrl ?? project.localPath })),
      sourceKind !== 'local' ? field('Managed', el('code', { text: project.localPath })) : null,
      el('div', {
        class: 'project-card-footer',
        children: [
          el('small', { class: 'muted', text: '点击编辑此项目' }),
          el('div', { class: 'project-card-actions', children: [backendCheck, action] }),
        ],
      }),
    ],
  });
  card.onclick = () => editProject(project);
  card.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      editProject(project);
    }
  };
  return card;
}

async function deleteOrArchiveProject(project: ProjectDto): Promise<void> {
  projectActionInFlight.add(project.id);
  render();
  try {
    const preview = await api<ProjectDeletePreviewDto>(`/projects/${encodeURIComponent(project.id)}/delete-preview`);
    if (preview.recommendation === 'blocked_active_work') {
      lastError = `项目 ${project.name} 还有运行中任务/请求（requests=${preview.activeRequests}, runs=${preview.activeRuns}），不能删除或归档。`;
      return;
    }
    if (preview.canHardDelete) {
      if (!window.confirm(`项目 ${project.name} 没有任何任务历史。确认永久删除项目配置和凭据？`)) return;
      await api<{ ok: boolean }>(`/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      if (projectSourceForm.editingProjectId === project.id) resetProjectSourceForm();
      lastError = null;
      await loadData({ render: false });
      return;
    }
    if (preview.canArchive) {
      if (!window.confirm(`项目 ${project.name} 已有历史任务，将归档而不是物理删除。归档后不能再创建新需求/bug，历史仍保留。确认归档？`)) return;
      await api<ProjectDto>(`/projects/${encodeURIComponent(project.id)}/archive`, { method: 'POST' });
      if (projectSourceForm.editingProjectId === project.id) resetProjectSourceForm();
      lastError = null;
      await loadData({ render: false });
      return;
    }
    lastError = `项目 ${project.name} 当前不能删除：${preview.recommendation}`;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  } finally {
    projectActionInFlight.delete(project.id);
    render();
  }
}

async function refreshProjectBranches(projectId: string, onUpdated?: () => void): Promise<void> {
  if (projectBranchRefreshInFlight.has(projectId)) return;
  projectBranchRefreshInFlight.add(projectId);
  onUpdated?.();
  try {
    const result = await api<ProjectBranchListResult>(`/projects/${encodeURIComponent(projectId)}/branches`);
    if (!result.ok) {
      lastError = `刷新项目分支失败：${result.error}`;
      return;
    }
    const project = data.projects.find((p) => p.id === projectId);
    if (project) {
      project.defaultBranch = result.defaultBranch || project.defaultBranch;
      project.sourceBranches = normalizeBranchList(project.defaultBranch, result.branches);
    }
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  } finally {
    projectBranchRefreshInFlight.delete(projectId);
    onUpdated?.();
  }
}

async function ensureRunnerStarted(): Promise<void> {
  if (runnerStartInFlight) return;
  runnerStartInFlight = true;
  render();
  try {
    data.runnerControl = await api<RunnerControlStatusDto>('/runner/control/start', { method: 'POST' });
    lastError = null;
    await loadData({ render: false, keepDetail: true });
  } catch (err) {
    lastError =
      err instanceof Error
        ? `${err.message}。可以临时在命令行执行 bun run runner -- watch 作为兜底。`
        : String(err);
  } finally {
    runnerStartInFlight = false;
    render();
  }
}

function maybeAutoStartRunnerForActiveTask(): void {
  const request = activeTaskRequest();
  if (!request || !['pending', 'claimed'].includes(request.status)) return;
  const project = data.projects.find((p) => p.id === request.projectId);
  if (!project?.agentBackend) return;
  if (data.runnerControl?.running || runnerStartInFlight) return;
  if (runnerAutoStartAttemptedForRequest.has(request.id)) return;
  runnerAutoStartAttemptedForRequest.add(request.id);
  void ensureRunnerStarted();
}

function editProject(project: ProjectDto): void {
  const sourceKind = project.sourceKind ?? 'local';
  projectSourceForm.editingProjectId = project.id;
  projectSourceForm.sourceKind = sourceKind;
  projectSourceForm.agentBackend = project.agentBackend ?? '';
  projectSourceForm.name = project.name;
  projectSourceForm.sourceValue = sourceKind === 'local' ? project.localPath : project.sourceUrl ?? '';
  projectSourceForm.sourceAuthKind = project.sourceAuthKind ?? 'none';
  projectSourceForm.sourceUsername = project.sourceUsername ?? '';
  projectSourceForm.sourceCredential = '';
  projectSourceForm.defaultBranch = project.defaultBranch || 'main';
  projectSourceForm.detectResult = {
    ok: true,
    sourceKind,
    sourceUrl: sourceKind === 'local' ? null : project.sourceUrl ?? null,
    localPath: sourceKind === 'local' ? project.localPath : null,
    projectName: project.name,
    defaultBranch: project.defaultBranch || 'main',
    branches: sourceBranchesForProject(project),
    metadata: { source: 'registered-project', action: 'edit-prefill' },
  };
  projectSourceForm.detecting = false;
  localDirectoryPicker.open = false;
  lastError = null;
  render();
}

function authSummary(project: ProjectDto): string {
  const authKind = project.sourceAuthKind ?? 'none';
  if (authKind === 'none') return '无 / Git credential helper';
  if (authKind === 'ssh') return 'SSH Key';
  if (authKind === 'token') return project.hasSourceCredential ? 'Token 已保存' : 'Token 未保存';
  return project.hasSourceCredential ? `用户名密码（${project.sourceUsername ?? 'user'}）` : '用户名密码未保存';
}

function labeledInput(label: string, name: string, placeholder: string): HTMLElement {
  return controlledInput(label, name, placeholder, '', () => undefined);
}

function controlledInput(
  label: string,
  name: string,
  placeholder: string,
  value: string,
  onInput: (value: string) => void,
  type = 'text',
): HTMLElement {
  const input = el('input', { attrs: { name, placeholder, value, type } });
  input.oninput = () => onInput(input.value);
  return el('label', { class: 'input-block', children: [el('span', { text: label }), input] });
}

function projectSourcePayload(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    sourceKind: projectSourceForm.sourceKind,
    agentBackend: projectSourceForm.agentBackend || null,
    defaultBranch: projectSourceForm.defaultBranch || 'main',
  };
  const detectedBranches = projectSourceForm.detectResult?.ok ? projectSourceForm.detectResult.branches : [];
  const sourceBranches = normalizeBranchList(projectSourceForm.defaultBranch || 'main', detectedBranches);
  const withBranches = { ...base, sourceBranches };
  if (projectSourceForm.sourceKind === 'local') {
    return { ...withBranches, localPath: projectSourceForm.sourceValue };
  }
  return {
    ...withBranches,
    sourceUrl: projectSourceForm.sourceValue,
    sourceAuthKind: projectSourceForm.sourceAuthKind,
    ...(projectSourceForm.sourceUsername ? { sourceUsername: projectSourceForm.sourceUsername } : {}),
    ...(projectSourceForm.sourceCredential ? { sourceCredential: projectSourceForm.sourceCredential } : {}),
  };
}

async function detectProjectSource(): Promise<void> {
  projectSourceForm.detecting = true;
  projectSourceForm.detectResult = null;
  render();
  try {
    const result = await api<SourceDetectResult>('/projects/detect-source', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(projectSourcePayload()),
    });
    projectSourceForm.detectResult = result;
    if (result.ok) {
      projectSourceForm.name = projectSourceForm.name.trim() || result.projectName;
      projectSourceForm.defaultBranch = result.defaultBranch || projectSourceForm.defaultBranch || 'main';
      lastError = null;
    }
  } catch (err) {
    projectSourceForm.detectResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    projectSourceForm.detecting = false;
    render();
  }
}

async function submitProject(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!projectSourceForm.detectResult?.ok) {
    lastError = '请先检测项目源，确认无误后再接入。';
    render();
    return;
  }
  if (!projectSourceForm.agentBackend) {
    lastError = '请选择 Claude Code 或 Codex 作为项目级 Agent Backend。';
    render();
    return;
  }
  try {
    const editingProjectId = projectSourceForm.editingProjectId;
    await api<ProjectDto>(editingProjectId ? `/projects/${encodeURIComponent(editingProjectId)}` : '/projects', {
      method: editingProjectId ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: (projectSourceForm.name || projectSourceForm.detectResult.projectName).trim(),
        ...projectSourcePayload(),
      }),
    });
    resetProjectSourceForm();
    await loadData({ render: true });
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    render();
  }
}

function resetProjectSourceForm(): void {
  projectSourceForm.editingProjectId = null;
  projectSourceForm.sourceKind = 'github';
  projectSourceForm.agentBackend = '';
  projectSourceForm.name = '';
  projectSourceForm.sourceValue = '';
  projectSourceForm.sourceAuthKind = 'none';
  projectSourceForm.sourceUsername = '';
  projectSourceForm.sourceCredential = '';
  projectSourceForm.defaultBranch = 'main';
  projectSourceForm.detectResult = null;
  projectSourceForm.detecting = false;
}

function renderNewTaskPage(): HTMLElement {
  const form = el('form', { class: 'form-card wide' });
  const projects = activeProjects();
  const projectSelect = el('select', { attrs: { name: 'projectId' } });
  for (const project of projects) {
    projectSelect.appendChild(el('option', { text: project.name, attrs: { value: project.id } }));
  }
  if (!projects.length) {
    projectSelect.appendChild(el('option', { text: '暂无可用项目', attrs: { value: '' } }));
    projectSelect.setAttribute('disabled', 'disabled');
  }
  const typeSelect = el('select', { attrs: { name: 'type' } });
  // Default to "let AI decide" — the server-side coordinator picks runType
  // from title alone; smart-router output is preview/audit unless explicitly
  // plumbed through a future override. Users only touch this dropdown
  // when they want to override the AI judgment (e.g. for refactor / smoke
  // which the coordinator's rules may not pick up reliably).
  typeSelect.appendChild(el('option', { text: '(让 AI 自动判定)', attrs: { value: '' } }));
  for (const type of ['feature', 'bugfix', 'smoke', 'refactor']) typeSelect.appendChild(el('option', { text: type, attrs: { value: type } }));
  const title = el('textarea', { attrs: { name: 'title', rows: '7', 'data-new-task-title': 'true', placeholder: '描述业务目标、验收标准、约束。例如：为报告页增加导出按钮，并确保 mvn test 通过。' } });
  // Hydrate the user-owned draft fields (see state-management.md).
  title.value = newTaskFormDraft.title;
  if (newTaskFormDraft.type) typeSelect.value = newTaskFormDraft.type;
  if (newTaskFormDraft.projectId) {
    const hasOption = Array.from(projectSelect.options).some((o) => o.value === newTaskFormDraft.projectId);
    if (hasOption) projectSelect.value = newTaskFormDraft.projectId;
  }
  const branchSelect = el('select', { attrs: { name: 'branch' } });
  const branchRefresh = el('button', { class: 'button secondary small', text: '刷新分支', attrs: { type: 'button' } });
  const branchHint = el('p', { class: 'muted compact' });
  const backendHint = el('p', { class: 'muted compact' });
  const backendCheck = el('button', { class: 'button secondary small', text: '检测 Backend', attrs: { type: 'button' } });
  const backendLabel = el('strong', { text: '未选择项目' });
  const clickedBranchProjects = new Set<string>();
  const submit = el('button', { class: 'button primary', text: 'Create Workflow Request', attrs: { type: 'submit' } });

  // V2 W2-4 / PR4 + 2026-05-06 router-driven defaults: 智能推荐 card with
  // two-stage preview pipeline.
  //
  // Flow:
  //   1. If user left Type as "(让 AI 自动判定)" — POST /coordinator/preview
  //      to get predicted runType + hint, then POST /router/recommend with
  //      that runType. The card renders both verdicts.
  //   2. If user picked a specific Type in advanced override — skip the
  //      coordinator round-trip and call /router/recommend directly with
  //      the override.
  //
  // Cache key reflects whether override is in play so toggling between
  // "auto" and an explicit Type doesn't return a stale cached card. The
  // Coordinator path doesn't yet plumb flowId/startStage through
  // workflow_requests. The card is informational: ordinary task creation uses
  // conservative server defaults unless a future explicit override is sent.
  const recoCard = el('div', { class: 'panel compact' });
  recoCard.style.display = 'none';
  let recoLastKey = '';
  let recoInFlight = false;
  type RecoResponse = {
    flowId: string;
    startStage: string | null;
    estimates: { timeSec: number; tokens: number };
    reason: string;
    rulesFired: string[];
  };
  type CoordinatorPreviewResponse = {
    predictedRunType: 'feature' | 'bugfix' | 'smoke' | 'refactor' | null;
    confidence: number;
    rulesFired: string[];
    hint: 'too_short' | 'large_scope' | null;
  };
  const fetchRecommendation = async (): Promise<void> => {
    const projectId = projectSelect.value;
    const titleText = title.value.trim();
    const userOverrideType = typeSelect.value as
      | ''
      | 'feature'
      | 'bugfix'
      | 'smoke'
      | 'refactor';
    if (!projectId || !titleText) {
      recoCard.style.display = 'none';
      return;
    }
    // 'auto' segment in the cache key marks unchanged AI-judged paths so
    // toggling between override modes invalidates correctly.
    const key = `${projectId}|${userOverrideType || 'auto'}|${titleText}`;
    if (key === recoLastKey || recoInFlight) return;
    recoInFlight = true;
    recoCard.style.display = 'block';
    recoCard.replaceChildren(
      panelHeader('智能推荐', '正在加载…'),
      el('p', {
        class: 'muted compact',
        text: userOverrideType
          ? 'POST /router/recommend (按 Type override)'
          : 'POST /coordinator/preview → /router/recommend',
      }),
    );
    try {
      let runTypeForRouter: 'feature' | 'bugfix' | 'smoke' | 'refactor';
      let coordPreview: CoordinatorPreviewResponse | null = null;
      if (userOverrideType) {
        runTypeForRouter = userOverrideType;
      } else {
        coordPreview = await api<CoordinatorPreviewResponse>('/coordinator/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: titleText }),
        });
        // pause_for_human / large_scope returns predictedRunType=null;
        // fall back to 'feature' for the router call so the user still sees
        // a recommendation while the hint callout warns them.
        runTypeForRouter = coordPreview.predictedRunType ?? 'feature';
      }
      const reco = await api<RecoResponse>('/router/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, title: titleText, runType: runTypeForRouter }),
      });
      recoLastKey = key;
      const stageLabel = reco.startStage ? `从 ${reco.startStage} 开始` : '从头执行';
      const minsApprox = Math.round(reco.estimates.timeSec / 60);
      const children: HTMLElement[] = [
        panelHeader(
          '智能推荐',
          userOverrideType
            ? '使用你在「高级覆盖」里指定的 Type'
            : '仅作参考；创建任务默认从完整流程开始',
        ),
      ];
      if (coordPreview) {
        const confPct = Math.round(coordPreview.confidence * 100);
        const aiVerdictText = coordPreview.predictedRunType
          ? `AI 判定: ${coordPreview.predictedRunType} · 置信 ${confPct}%`
          : `AI 判定: 暂无（先看下方 hint）· 置信 ${confPct}%`;
        children.push(el('p', { class: 'compact', text: aiVerdictText }));
        if (coordPreview.hint === 'too_short') {
          children.push(
            el('p', {
              class: 'muted compact warn',
              text: '⚠ 描述太短，提交后 Coordinator 会反问 1-2 句；建议把场景写得更具体。',
            }),
          );
        } else if (coordPreview.hint === 'large_scope') {
          children.push(
            el('p', {
              class: 'muted compact warn',
              text: '⚠ 范围较大，提交后 Coordinator 会建议先拆 2-3 个子能力做最小闭环。',
            }),
          );
        }
      }
      children.push(
        el('p', {
          class: 'compact',
          children: [
            el('strong', { text: `${reco.flowId}` }),
            el('span', { text: ` · ${stageLabel}` }),
          ],
        }),
        el('p', {
          class: 'muted compact',
          text: `预估 ~${minsApprox} 分钟 / ~${reco.estimates.tokens} tokens`,
        }),
        el('p', {
          class: 'muted compact',
          text: `规则: ${reco.rulesFired.join(' / ') || '(none)'}`,
        }),
      );
      recoCard.replaceChildren(...children);
    } catch (err) {
      recoCard.replaceChildren(
        panelHeader('智能推荐', '获取失败'),
        el('p', {
          class: 'muted compact',
          text: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      recoInFlight = false;
    }
  };
  let recoDebounce: ReturnType<typeof setTimeout> | null = null;
  const scheduleReco = () => {
    if (recoDebounce) clearTimeout(recoDebounce);
    recoDebounce = setTimeout(() => void fetchRecommendation(), 400);
  };
  title.onblur = scheduleReco;
  typeSelect.addEventListener('change', () => {
    recoLastKey = '';
    newTaskFormDraft.type = typeSelect.value as typeof newTaskFormDraft.type;
    scheduleReco();
  });
  projectSelect.addEventListener('change', () => {
    recoLastKey = '';
    newTaskFormDraft.projectId = projectSelect.value;
  });
  title.addEventListener('input', () => {
    newTaskFormDraft.title = title.value;
  });
  title.addEventListener('blur', () => {
    newTaskFormDraft.title = title.value;
    if (!isReplacingAppRootForRender) newTaskTitleFocus = null;
  });
  const updateBackendHint = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
    const status = agentBackendStatusForProject(project);
    backendHint.textContent = project?.agentBackend
      ? `Agent Backend: ${agentBackendDisplayName(project.agentBackend)} · ${status.label}。创建任务前会自动做一次真实 CLI preflight；失败时不会入队。`
      : '这个项目还没有配置 Agent Backend。请到“项目接入”编辑项目，选择 Claude Code 或 Codex。';
    backendLabel.textContent = agentBackendLabelForProject(project);
    backendHint.className = `muted compact ${status.kind}`;
    backendCheck.disabled = !project?.agentBackend || agentBackendPreflightInFlight.has(project.id);
    backendCheck.textContent = project && agentBackendPreflightInFlight.has(project.id) ? '检测中…' : '检测 Backend';
    submit.disabled = !projects.length || !project?.agentBackend;
  };
  const updateBranchSelect = (projectId: string, preferredBranch: string | null = branchSelect.value || null) => {
    const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
    const previousBranch = preferredBranch?.trim() || '';
    const branches = sourceBranchesForProject(project);
    const nextBranch = branches.includes(previousBranch)
      ? previousBranch
      : branches.includes(project?.defaultBranch ?? '')
        ? project?.defaultBranch ?? branches[0]!
        : branches[0]!;
    branchSelect.replaceChildren();
    for (const branch of branches) {
      const option = el('option', { text: branch === project?.defaultBranch ? `${branch}（默认）` : branch, attrs: { value: branch } });
      if (branch === project?.defaultBranch) option.setAttribute('selected', 'selected');
      branchSelect.appendChild(option);
    }
    branchSelect.value = nextBranch;
    newTaskFormDraft.branch = nextBranch;
    branchSelect.disabled = !project;
    const refreshing = Boolean(project && projectBranchRefreshInFlight.has(project.id));
    branchRefresh.textContent = refreshing ? '加载中…' : '刷新分支';
    branchRefresh.disabled = !project || refreshing;
    branchHint.textContent = project
      ? `默认带入项目接入配置的默认分支 ${project.defaultBranch || 'main'}；点击 Source Branch 会从当前 Project 的源地址加载分支列表，也可以在这里为本次任务临时切换。`
      : '请先接入一个 active 项目。';
    updateBackendHint(projectId);
  };
  const refreshBranches = (projectId: string, force = false) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project || (!force && sourceBranchesForProject(project).length > 1)) return;
    void refreshProjectBranches(project.id, () => updateBranchSelect(projectSelect.value, branchSelect.value));
  };
  projectSelect.onchange = () => {
    updateBranchSelect(projectSelect.value, null);
    refreshBranches(projectSelect.value);
  };
  branchSelect.onchange = () => {
    newTaskFormDraft.branch = branchSelect.value;
    updateBranchSelect(projectSelect.value, branchSelect.value);
  };
  const loadBranchesForCurrentProject = () => {
    const projectId = projectSelect.value;
    const firstClickForProject = !clickedBranchProjects.has(projectId);
    clickedBranchProjects.add(projectId);
    refreshBranches(projectId, firstClickForProject);
  };
  branchSelect.onfocus = loadBranchesForCurrentProject;
  branchSelect.onclick = loadBranchesForCurrentProject;
  branchRefresh.onclick = () => refreshBranches(projectSelect.value, true);
  backendCheck.onclick = () => {
    const project = projects.find((p) => p.id === projectSelect.value);
    if (!project?.agentBackend) return;
    void checkAgentBackend(project.agentBackend, project.id).then(() => updateBackendHint(projectSelect.value));
  };
  // Initial mount: honor the saved draft branch when it still exists for the
  // current project (otherwise updateBranchSelect falls back to the project
  // default). This is the path that survives render() rebuilds.
  updateBranchSelect(projectSelect.value, newTaskFormDraft.branch || null);
  refreshBranches(projectSelect.value);
  if (!projects.length) submit.setAttribute('disabled', 'disabled');
  // 2026-05-06 router advisory defaults: Type is no longer prominent in the
  // main form. The Coordinator still decides runType, while Smart Router output
  // is preview/audit only. Power users / refactor / smoke paths open the
  // disclosure. Flow / startStage override is NOT here yet — that requires
  // extending the /workflow-requests body + WorkflowRequest schema to plumb
  // flowId / startStage through to createWorkflowRun.
  // Tracked as a follow-up task; for now Type is the only override dial.
  const advanced = document.createElement('details');
  advanced.appendChild(el('summary', { text: '高级覆盖（手动指定 Type；Flow/起始阶段 待后续）' }));
  advanced.appendChild(
    el('label', {
      class: 'input-block',
      children: [el('span', { text: 'Type（留空让 AI 判定）' }), typeSelect],
    }),
  );
  form.append(
    panelHeader('创建任务请求', 'UI 只入队；本地 runner watch 负责认领、建 worktree、执行 gate、等待人工确认。'),
    el('label', { class: 'input-block', children: [el('span', { text: 'Project' }), projectSelect] }),
    el('label', { class: 'input-block', children: [el('span', { text: 'Task Title / Intent' }), title] }),
    recoCard,
    advanced,
    el('div', {
      class: 'input-block',
      children: [
        el('span', { text: 'Source Branch' }),
        el('div', { class: 'branch-select-row', children: [branchSelect, branchRefresh] }),
        branchHint,
      ],
    }),
    el('div', {
      class: 'input-block',
      children: [
        el('span', { text: 'Agent Backend' }),
        el('div', { class: 'branch-select-row', children: [backendLabel, backendCheck] }),
        backendHint,
      ],
    }),
    el('div', { class: 'button-row', children: [submit, actionLink('查看工作台', 'workbench')] }),
  );
  form.onsubmit = (event) => void submitWorkflowRequest(event, form);

  return el('section', {
    class: 'page-grid two-col',
    children: [
      form,
      el('aside', {
        class: 'panel',
        children: [
          panelHeader('端到端闭环', '下一步'),
          el('ol', {
            class: 'ordered-list',
            children: [
              el('li', { text: '创建 Workflow Request。' }),
              el('li', { text: '本地运行 `bun run runner -- watch`。' }),
              el('li', { text: 'Runner 使用 Git worktree 执行需求、设计、实现、编译测试。' }),
              el('li', { text: 'UI 在人工确认点展示证据并审批。' }),
            ],
          }),
          el('code', { class: 'command-chip large', text: 'bun run runner -- watch --keep-worktree' }),
        ],
      }),
    ],
  });
}

async function submitWorkflowRequest(event: SubmitEvent, form: HTMLFormElement): Promise<void> {
  event.preventDefault();
  const fd = new FormData(form);
  const projectId = String(fd.get('projectId') ?? '');
  const project = data.projects.find((p) => p.id === projectId);
  const title = String(fd.get('title') ?? '').trim();
  try {
    if (!project) throw new Error('请选择一个已接入项目。');
    const ready = await ensureProjectAgentBackendReady(project);
    if (!ready) return;
    // 2026-05-06: omit `type` when user left it as "(让 AI 自动判定)" so the
    // server-side Coordinator can classify runType. Smart Router output is
    // advisory until a future request override path sends flowId/startStage.
    const typeOverride = String(fd.get('type') ?? '').trim();
    const request = await api<WorkflowRequestDto>('/workflow-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        ...(typeOverride && { type: typeOverride }),
        title,
        branch: String(fd.get('branch') ?? '').trim() || project?.defaultBranch,
        // PR1 atomic intake (PRD §P0-2 / P0-3): API persists the request
        // and the first user message in one transaction so the runner
        // watch loop never races between request creation and the
        // initial chat turn. The previous two-step (POST + follow-up
        // POST /messages) is dropped.
        firstMessage: title.length > 0 ? { role: 'user' as const, content: title } : undefined,
      }),
    });
    form.reset();
    clearNewTaskFormDraft();
    await loadData({ render: false });
    activeTaskRequestId = request.id;
    activeRunId = request.workflowRunId;
    lastError = null;
    activePage = 'task';
    window.location.hash = `task/${encodeURIComponent(request.id)}`;
    runnerAutoStartAttemptedForRequest.add(request.id);
    void ensureRunnerStarted();
    void loadCoordinatorChat(request.id);
    render();
    console.log('[web] workflow request created', request.id);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function ensureProjectAgentBackendReady(project: ProjectDto): Promise<boolean> {
  if (!project.agentBackend) {
    lastError = '这个项目还没有配置 Agent Backend。请先到“项目接入”编辑项目，选择 Claude Code 或 Codex。';
    render();
    return false;
  }
  const cached = preflightForProjectBackend(project);
  if (cached?.runnable) return true;
  const checked = await checkAgentBackend(project.agentBackend, project.id);
  if (checked?.runnable) return true;
  if (!checked) {
    lastError = 'Agent Backend 连接检测未完成，任务不会入队。';
  }
  render();
  return false;
}

// ---- Coordinator conversational intake (Phase B) -------------------------

interface CoordinatorChatMessage {
  id: string;
  role: 'user' | 'coordinator';
  content: string;
  createdAt: string;
}

interface CoordinatorChatState {
  messages: CoordinatorChatMessage[];
  decision: {
    decision:
      | { action: 'proceed'; routeCase: string; runType: string; reason: string }
      | { action: 'pause_for_human'; questions: string[]; reason: string }
      | { action: 'abort'; reason: string };
    confidence: number;
    source: string;
  } | null;
  status: string;
}

const coordinatorChats = new Map<string, CoordinatorChatState>();
const coordinatorPolling = new Set<string>();
const coordinatorReplyDrafts = new Map<string, string>();
const COORDINATOR_REPLY_SELECTOR = 'textarea[data-coordinator-reply-request-id]';

let coordinatorReplyFocus: {
  requestId: string;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: 'forward' | 'backward' | 'none';
} | null = null;

// 2026-05-06 fix(web): preserve new-task-form drafts across render().
// `checkAgentBackend()` and other server-state events trigger full root
// rebuilds; without this draft store the title textarea + dropdown
// selections silently reset, which the user perceives as a page refresh.
// Spec: .trellis/spec/web/frontend/state-management.md "Preserve user-owned
// drafts across polling renders".
const newTaskFormDraft: {
  projectId: string;
  type: '' | 'feature' | 'bugfix' | 'smoke' | 'refactor';
  title: string;
  branch: string;
} = { projectId: '', type: '', title: '', branch: '' };

const NEW_TASK_TITLE_SELECTOR = 'textarea[data-new-task-title]';

let newTaskTitleFocus: {
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: 'forward' | 'backward' | 'none';
} | null = null;
let isReplacingAppRootForRender = false;

function captureCoordinatorReplyComposerState(root: HTMLElement): void {
  const replyArea = root.querySelector<HTMLTextAreaElement>(COORDINATOR_REPLY_SELECTOR);
  if (!replyArea) {
    coordinatorReplyFocus = null;
    return;
  }
  const requestId = replyArea.dataset.coordinatorReplyRequestId;
  if (!requestId) {
    coordinatorReplyFocus = null;
    return;
  }
  setCoordinatorReplyDraft(requestId, replyArea.value);
  if (document.activeElement === replyArea) {
    coordinatorReplyFocus = {
      requestId,
      selectionStart: replyArea.selectionStart,
      selectionEnd: replyArea.selectionEnd,
      selectionDirection: normalizeSelectionDirection(replyArea.selectionDirection),
    };
  } else if (coordinatorReplyFocus?.requestId === requestId) {
    coordinatorReplyFocus = null;
  }
}

function restoreCoordinatorReplyComposerFocus(root: HTMLElement): void {
  if (!coordinatorReplyFocus) return;
  const focus = coordinatorReplyFocus;
  const replyArea = Array.from(root.querySelectorAll<HTMLTextAreaElement>(COORDINATOR_REPLY_SELECTOR))
    .find((candidate) => candidate.dataset.coordinatorReplyRequestId === focus.requestId);
  if (!replyArea) {
    coordinatorReplyFocus = null;
    return;
  }
  replyArea.focus({ preventScroll: true });
  const selectionStart = Math.min(focus.selectionStart, replyArea.value.length);
  const selectionEnd = Math.min(focus.selectionEnd, replyArea.value.length);
  replyArea.setSelectionRange(selectionStart, selectionEnd, focus.selectionDirection);
  coordinatorReplyFocus = null;
}

function setCoordinatorReplyDraft(requestId: string, value: string): void {
  if (value.length > 0) coordinatorReplyDrafts.set(requestId, value);
  else coordinatorReplyDrafts.delete(requestId);
}

function clearCoordinatorReplyComposerState(requestId: string): void {
  coordinatorReplyDrafts.delete(requestId);
  if (coordinatorReplyFocus?.requestId === requestId) coordinatorReplyFocus = null;
}

function normalizeSelectionDirection(direction: string | null): 'forward' | 'backward' | 'none' {
  return direction === 'forward' || direction === 'backward' ? direction : 'none';
}

function captureNewTaskFormState(root: HTMLElement): void {
  const titleArea = root.querySelector<HTMLTextAreaElement>(NEW_TASK_TITLE_SELECTOR);
  if (!titleArea) {
    newTaskTitleFocus = null;
    return;
  }
  // Sync DOM value into the draft so keystrokes that have not yet fired an
  // 'input' event (e.g. mid-IME composition) still survive the rebuild.
  newTaskFormDraft.title = titleArea.value;
  if (document.activeElement === titleArea) {
    newTaskTitleFocus = {
      selectionStart: titleArea.selectionStart,
      selectionEnd: titleArea.selectionEnd,
      selectionDirection: normalizeSelectionDirection(titleArea.selectionDirection),
    };
  }
}

function restoreNewTaskFormFocus(root: HTMLElement): void {
  if (!newTaskTitleFocus) return;
  const focus = newTaskTitleFocus;
  const titleArea = root.querySelector<HTMLTextAreaElement>(NEW_TASK_TITLE_SELECTOR);
  if (!titleArea) {
    newTaskTitleFocus = null;
    return;
  }
  titleArea.focus({ preventScroll: true });
  const len = titleArea.value.length;
  titleArea.setSelectionRange(
    Math.min(focus.selectionStart, len),
    Math.min(focus.selectionEnd, len),
    focus.selectionDirection,
  );
  newTaskTitleFocus = null;
}

function clearNewTaskFormDraft(): void {
  newTaskFormDraft.projectId = '';
  newTaskFormDraft.type = '';
  newTaskFormDraft.title = '';
  newTaskFormDraft.branch = '';
  newTaskTitleFocus = null;
}

async function loadCoordinatorChat(requestId: string): Promise<void> {
  try {
    const state = await api<CoordinatorChatState>(
      `/workflow-requests/${encodeURIComponent(requestId)}/messages`,
    );
    coordinatorChats.set(requestId, state);
    if (state.status !== 'awaiting_clarification') clearCoordinatorReplyComposerState(requestId);
    if (activeTaskRequestId === requestId) render();
    // While the request is still pending or awaiting clarification, keep polling
    // so the UI surfaces the Coordinator's questions as soon as they land.
    if (
      (state.status === 'pending' || state.status === 'awaiting_clarification') &&
      !coordinatorPolling.has(requestId)
    ) {
      coordinatorPolling.add(requestId);
      setTimeout(() => {
        coordinatorPolling.delete(requestId);
        void loadCoordinatorChat(requestId);
      }, 1500);
    }
  } catch {
    /* network or 404; just stop polling */
  }
}

async function sendCoordinatorReply(requestId: string, textArea: HTMLTextAreaElement): Promise<void> {
  const content = textArea.value.trim();
  if (!content) return;
  const wasDisabled = textArea.disabled;
  textArea.disabled = true;
  try {
    await api(`/workflow-requests/${encodeURIComponent(requestId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'user', content }),
    });
    // Bounce status back to pending so the runner re-triages with the new turn.
    await api(`/workflow-requests/${encodeURIComponent(requestId)}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });
    clearCoordinatorReplyComposerState(requestId);
    textArea.value = '';
    await loadCoordinatorChat(requestId);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    render();
    // Only restore disabled state if the textarea is still in the DOM
    if (document.body.contains(textArea)) {
      textArea.disabled = wasDisabled;
    }
  }
}

/**
 * Surface the Coordinator's verdict next to the user-typed task type so the
 * user can see when the Coordinator has overridden their classification
 * (PR2, PRD §P1-5). Renders a placeholder while no decision exists yet.
 *
 * The metric grid sits alongside Project / Source Branch / Current /
 * Evidence at the top of the task detail page. When the user-marked type
 * and the Coordinator's runType disagree the metric is rendered in `warn`
 * kind to highlight the divergence.
 */
function renderCoordinatorVerdictMetric(request: WorkflowRequestDto): HTMLElement {
  const state = coordinatorChats.get(request.id);
  if (!state || !state.decision) {
    if (!state) void loadCoordinatorChat(request.id);
    return metric('Coordinator 判定', '等待分诊', `用户标记 ${request.type}`, 'muted');
  }
  const decision = state.decision.decision;
  const sourceLabel = state.decision.source === 'rules' ? '规则匹配' : state.decision.source === 'llm' ? 'LLM 判定' : '人工';
  const confLabel = state.decision.confidence.toFixed(2);
  if (decision.action === 'proceed') {
    const mismatch = decision.runType !== request.type;
    const value = `${decision.runType} (${decision.routeCase})`;
    const hint = mismatch
      ? `与用户标记 ${request.type} 不一致 · ${sourceLabel} ${confLabel}`
      : `与用户标记一致 · ${sourceLabel} ${confLabel}`;
    return metric('Coordinator 判定', value, hint, mismatch ? 'warn' : 'good');
  }
  if (decision.action === 'pause_for_human') {
    return metric(
      'Coordinator 判定',
      `等待澄清 (${decision.questions.length})`,
      `${sourceLabel} ${confLabel} · ${decision.reason}`,
      'warn',
    );
  }
  return metric(
    'Coordinator 判定',
    '已取消',
    `${sourceLabel} ${confLabel} · ${decision.reason}`,
    'bad',
  );
}

function renderCoordinatorChatPanel(request: WorkflowRequestDto): HTMLElement | null {
  const requestId = request.id;
  const state = coordinatorChats.get(requestId);
  if (!state) {
    void loadCoordinatorChat(requestId);
    return null;
  }
  const canReply = request.status === 'awaiting_clarification' && state.status === 'awaiting_clarification';
  if (!canReply) clearCoordinatorReplyComposerState(requestId);
  if (state.messages.length === 0 && !state.decision) return null;

  const thread = state.messages.map((m) =>
    el('div', {
      class: `chat-message chat-message-${m.role}`,
      children: [
        el('span', { class: 'chat-role', text: m.role === 'user' ? '你' : 'Coordinator' }),
        el('p', { text: m.content }),
      ],
    }),
  );

  const replyArea = canReply ? el('textarea', {
    class: 'chat-input',
    attrs: { rows: '2', placeholder: '回复 Coordinator…', 'data-coordinator-reply-request-id': requestId },
  }) as HTMLTextAreaElement : null;

  if (replyArea) {
    replyArea.value = coordinatorReplyDrafts.get(requestId) ?? '';
    replyArea.oninput = () => setCoordinatorReplyDraft(requestId, replyArea.value);
    replyArea.onblur = () => {
      setCoordinatorReplyDraft(requestId, replyArea.value);
      if (!isReplacingAppRootForRender && coordinatorReplyFocus?.requestId === requestId) {
        coordinatorReplyFocus = null;
      }
    };
  }

  const sendBtn = replyArea ? button('发送', 'button primary small') : null;
  if (sendBtn && replyArea) sendBtn.onclick = () => void sendCoordinatorReply(requestId, replyArea);

  const decisionLine = state.decision
    ? el('div', {
        class: 'chat-decision',
        text:
          state.decision.decision.action === 'proceed'
            ? `已分诊 → ${state.decision.decision.routeCase} (${state.decision.source}, ${state.decision.confidence.toFixed(2)})`
            : state.decision.decision.action === 'pause_for_human'
              ? `等待你回复 (${state.decision.decision.questions.length} 个问题)`
              : `已取消：${state.decision.decision.reason}`,
      })
    : null;

  return el('section', {
    class: 'panel coordinator-chat',
    children: [
      panelHeader('Coordinator 对话', '需求开始执行前的分诊'),
      decisionLine,
      el('div', { class: 'chat-thread', children: thread }),
      replyArea && sendBtn
        ? el('div', { class: 'chat-composer', children: [replyArea, sendBtn] })
        : null,
    ],
  });
}

function renderReportsPage(): HTMLElement {
  return el('section', {
    class: 'page-stack',
    children: [
      renderActiveReportDetail(),
      el('section', {
        class: 'panel',
        children: [
          panelHeader('Completion Reports', '按 run 聚合状态、测试、gate 与报告产物'),
          data.runs.length
            ? el('div', { class: 'report-list', children: data.runs.map(renderReportRow) })
            : el('p', { class: 'muted', text: '暂无报告。' }),
        ],
      }),
    ],
  });
}

function renderReportRow(run: WorkflowRunDto): HTMLElement {
  const open = button('Open', 'button secondary small');
  const request = data.requests.find((candidate) => candidate.workflowRunId === run.id);
  open.onclick = () => (request ? setHash('task', request.id) : setHash('workbench', run.id));
  const viewReport = button('Report', 'button secondary small');
  viewReport.onclick = () => {
    activeRunId = run.id;
    void loadRunDetail(run.id, true);
  };
  return el('article', {
    class: 'report-row',
    children: [
      el('div', { children: [el('strong', { text: run.title }), el('small', { text: `${projectName(run.projectId)} · ${fmtTime(run.createdAt)}` })] }),
      pill(run.status),
      el('div', { class: 'button-row', children: [viewReport, open] }),
    ],
  });
}

function renderActiveReportDetail(): HTMLElement | null {
  const detail = data.activeDetail;
  if (!detail) return null;
  const reportMarkdown = markdownArtifactText(detail, 'completion_report');
  const reportJson = structuredArtifactText(detail, 'completion_report');
  if (!reportMarkdown && !reportJson) return null;
  const report = parseCompletionReportArtifact(reportMarkdown, reportJson);
  return el('section', {
    class: 'panel report-detail',
    children: [
      panelHeader(report.title, `Run ${shortId(detail.run.id)} · 每段可追溯到 evidence`),
      report.summary.length ? el('div', { class: 'summary-list', children: report.summary.map((item) => el('div', { class: 'summary-item', text: item })) }) : null,
      ...report.sections.map((section) =>
        el('details', {
          class: 'report-section',
          children: [
            el('summary', { text: section.title }),
            el('pre', { class: 'doc-preview', text: previewText(section.body) }),
          ],
        }),
      ),
    ],
  });
}

function renderKnowledgeSuggestion(
  suggestion: KnowledgeSuggestion,
  index: number,
  detail: RunDetail,
): HTMLElement {
  const runId = detail.run.id;
  const key = `${runId}:${index}`;
  const targetId = `KS-${String(index + 1).padStart(3, '0')}`;
  const persisted = detail.actions
    .filter((action) => action.kind === 'knowledge_suggestion_action' && action.targetId === targetId)
    .at(-1);
  const decision = persisted?.action ?? knowledgeDecisions.get(key);
  const persistedText = typeof persisted?.payload.text === 'string' ? persisted.payload.text : null;
  const text = persistedText ?? knowledgeEdits.get(key) ?? suggestion.text;
  const accept = button(decision === 'accepted' ? '已接受' : '接受', 'button secondary small');
  const edit = button(decision === 'edited' ? '已编辑' : '编辑', 'button secondary small');
  const ignore = button(decision === 'ignored' ? '已忽略' : '忽略', 'button secondary small');
  accept.onclick = () => void submitKnowledgeAction(detail.run.id, targetId, 'accepted', {
    text,
    kind: suggestion.kind,
    evidence: suggestion.evidence,
  });
  edit.onclick = () => {
    const next = window.prompt('编辑 Knowledge 候选', text);
    if (next !== null && next.trim()) {
      void submitKnowledgeAction(detail.run.id, targetId, 'edited', {
        text: next.trim(),
        originalText: suggestion.text,
        kind: suggestion.kind,
        evidence: suggestion.evidence,
      });
    }
  };
  ignore.onclick = () => void submitKnowledgeAction(detail.run.id, targetId, 'ignored', {
    text,
    kind: suggestion.kind,
    evidence: suggestion.evidence,
  });

  // Optimistic local fallback is kept only for transient render state before
  // the persisted workflow action comes back in the run detail.
  accept.onmousedown = () => {
    knowledgeDecisions.set(key, 'accepted');
  };
  ignore.onmousedown = () => {
    knowledgeDecisions.set(key, 'ignored');
  };
  return el('article', {
    class: `knowledge-card ${decision ?? ''}`,
    children: [
      el('div', { class: 'knowledge-head', children: [pill(suggestion.kind, 'info'), decision ? pill(decision, decision === 'ignored' ? 'muted' : 'good') : null] }),
      el('p', { text }),
      suggestion.evidence ? el('small', { text: `Evidence: ${suggestion.evidence}` }) : null,
      el('div', { class: 'button-row', children: [accept, edit, ignore] }),
    ],
  });
}

function renderKnowledgePage(): HTMLElement {
  const detail = data.activeDetail;
  const suggestions = detail ? parsedKnowledge(detail) : [];
  const pendingKnowledge = detail?.run.status === 'awaiting_human' && detail.run.currentStage === 'knowledge';
  const approve = pendingKnowledge ? button('确认 accepted/edited 候选入库', 'button primary') : null;
  if (approve && detail) approve.onclick = () => void submitApproval(detail.run.id, 'knowledge_gate', true);
  return el('section', {
    class: 'page-grid two-col',
    children: [
      el('section', {
        class: 'panel',
        children: [
          panelHeader('Knowledge Suggestions', '接受 / 编辑 / 忽略，人工确认后才进入长期 Knowledge Store'),
          suggestions.length && detail
            ? el('div', { class: 'stack', children: suggestions.map((s, i) => renderKnowledgeSuggestion(s, i, detail)) })
            : el('p', { class: 'muted', text: '当前选中的 run 尚未生成 Knowledge Candidate。' }),
          approve,
        ],
      }),
      el('aside', {
        class: 'panel',
        children: [
          panelHeader('Knowledge Store', '当前 MVP 存储在本地项目知识目录'),
          detail ? field('Run', shortId(detail.run.id)) : null,
          el('p', { class: 'muted', text: '下一步可增加按项目浏览 accepted knowledge、失效条件、检索排序。' }),
        ],
      }),
    ],
  });
}

// ---- Runtime Config Layer (PR3 settings page) ----------------------------

interface ConfigEntryDto {
  type: 'number' | 'string' | 'string_array';
  default: number | string | readonly string[];
  description: string;
  category: 'coordinator' | 'skill_prompts' | 'runtime';
  min?: number;
  max?: number;
  multiline?: boolean;
  source: string;
}

interface ConfigOverrideDto {
  key: string;
  scope: string;
  valueJson: string;
  updatedAt: string;
  updatedBy: string | null;
}

interface ConfigAuditDto {
  id: string;
  key: string;
  oldValueJson: string | null;
  newValueJson: string | null;
  changedAt: string;
  changedBy: string | null;
}

type ConfigCategory = 'coordinator' | 'skill_prompts' | 'runtime';

interface SettingsConfigState {
  activeTab: ConfigCategory;
  loading: boolean;
  error: string | null;
  registry: { keys: string[]; entries: Record<string, ConfigEntryDto> } | null;
  overrides: Record<string, ConfigOverrideDto>;
  drafts: Map<string, string>;
  saving: Set<string>;
  expandedHistory: Set<string>;
  audits: Map<string, ConfigAuditDto[]>;
  loadedOnce: boolean;
}

const settingsConfig: SettingsConfigState = {
  activeTab: 'coordinator',
  loading: false,
  error: null,
  registry: null,
  overrides: {},
  drafts: new Map(),
  saving: new Set(),
  expandedHistory: new Set(),
  audits: new Map(),
  loadedOnce: false,
};

async function loadSettingsConfig(): Promise<void> {
  if (settingsConfig.loading) return;
  settingsConfig.loading = true;
  settingsConfig.error = null;
  try {
    const [reg, ov] = await Promise.all([
      api<{ keys: string[]; entries: Record<string, ConfigEntryDto> }>('/config/registry'),
      api<{ overrides: Record<string, ConfigOverrideDto> }>('/config/overrides'),
    ]);
    settingsConfig.registry = reg;
    settingsConfig.overrides = ov.overrides ?? {};
    settingsConfig.loadedOnce = true;
  } catch (err) {
    settingsConfig.error = err instanceof Error ? err.message : String(err);
  } finally {
    settingsConfig.loading = false;
    render();
  }
}

function setSettingsConfigTab(tab: ConfigCategory): void {
  settingsConfig.activeTab = tab;
  render();
}

function formatConfigValueForEditor(value: unknown, type: ConfigEntryDto['type']): string {
  if (type === 'string_array') {
    return Array.isArray(value) ? value.join('\n') : '';
  }
  if (type === 'number' || type === 'string') {
    return value === null || value === undefined ? '' : String(value);
  }
  return JSON.stringify(value);
}

function parseConfigEditorValue(raw: string, type: ConfigEntryDto['type']): unknown {
  if (type === 'string_array') {
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }
  if (type === 'number') {
    return Number(raw);
  }
  return raw;
}

function effectiveValueAsEditorString(
  entry: ConfigEntryDto,
  override: ConfigOverrideDto | undefined,
): string {
  if (override) {
    try {
      return formatConfigValueForEditor(JSON.parse(override.valueJson), entry.type);
    } catch {
      return override.valueJson;
    }
  }
  return formatConfigValueForEditor(entry.default, entry.type);
}

function copyConfigDefaultToDraft(key: string): void {
  if (!settingsConfig.registry) return;
  const entry = settingsConfig.registry.entries[key];
  if (!entry) return;
  settingsConfig.drafts.set(key, formatConfigValueForEditor(entry.default, entry.type));
  render();
}

async function saveConfigOverride(key: string): Promise<void> {
  if (!settingsConfig.registry) return;
  const entry = settingsConfig.registry.entries[key];
  if (!entry) return;
  if (settingsConfig.saving.has(key)) return;
  const raw = settingsConfig.drafts.get(key);
  if (raw === undefined) return;
  const value = parseConfigEditorValue(raw, entry.type);
  if (entry.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    settingsConfig.error = `${key}: 不是合法数字`;
    render();
    return;
  }
  settingsConfig.saving.add(key);
  settingsConfig.error = null;
  render();
  try {
    await api(`/config/overrides/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, updatedBy: 'web' }),
    });
    settingsConfig.drafts.delete(key);
    settingsConfig.audits.delete(key);
    await loadSettingsConfig();
  } catch (err) {
    settingsConfig.error = err instanceof Error ? err.message : String(err);
  } finally {
    settingsConfig.saving.delete(key);
    render();
  }
}

async function resetConfigOverride(key: string): Promise<void> {
  if (settingsConfig.saving.has(key)) return;
  settingsConfig.saving.add(key);
  settingsConfig.error = null;
  render();
  try {
    await api(`/config/overrides/${encodeURIComponent(key)}?actor=web`, {
      method: 'DELETE',
    });
    settingsConfig.drafts.delete(key);
    settingsConfig.audits.delete(key);
    await loadSettingsConfig();
  } catch (err) {
    settingsConfig.error = err instanceof Error ? err.message : String(err);
  } finally {
    settingsConfig.saving.delete(key);
    render();
  }
}

async function toggleConfigHistory(key: string): Promise<void> {
  if (settingsConfig.expandedHistory.has(key)) {
    settingsConfig.expandedHistory.delete(key);
    render();
    return;
  }
  settingsConfig.expandedHistory.add(key);
  if (!settingsConfig.audits.has(key)) {
    try {
      const r = await api<{ items: ConfigAuditDto[] }>(
        `/config/audit?key=${encodeURIComponent(key)}&limit=20`,
      );
      settingsConfig.audits.set(key, r.items ?? []);
    } catch {
      settingsConfig.audits.set(key, []);
    }
  }
  render();
}

function configTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function renderConfigEditor(
  key: string,
  entry: ConfigEntryDto,
  value: string,
): HTMLElement {
  if (entry.type === 'number') {
    const input = el('input', {
      class: 'config-input',
      attrs: { type: 'number', step: 'any' },
    }) as unknown as HTMLInputElement;
    input.value = value;
    if (entry.min !== undefined) input.min = String(entry.min);
    if (entry.max !== undefined) input.max = String(entry.max);
    input.oninput = () => {
      settingsConfig.drafts.set(key, input.value);
    };
    return input;
  }
  if (entry.type === 'string' && !entry.multiline) {
    const input = el('input', {
      class: 'config-input',
      attrs: { type: 'text' },
    }) as unknown as HTMLInputElement;
    input.value = value;
    input.oninput = () => {
      settingsConfig.drafts.set(key, input.value);
    };
    return input;
  }
  // multiline string OR string_array → autosize textarea
  const ta = el('textarea', {
    class: 'config-textarea',
    attrs: { rows: '4' },
  }) as unknown as HTMLTextAreaElement;
  ta.value = value;
  const autosize = (): void => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 600)}px`;
  };
  ta.oninput = () => {
    settingsConfig.drafts.set(key, ta.value);
    autosize();
  };
  setTimeout(autosize, 0);
  return ta;
}

function renderConfigHistoryPanel(key: string): HTMLElement {
  const audits = settingsConfig.audits.get(key) ?? [];
  if (audits.length === 0) {
    return el('div', {
      class: 'config-history',
      children: [el('p', { class: 'muted', text: '没有历史记录。' })],
    });
  }
  return el('div', {
    class: 'config-history',
    children: audits.map((a) =>
      el('div', {
        class: 'config-history-row',
        children: [
          el('span', { class: 'config-history-time', text: fmtTime(a.changedAt) }),
          el('span', { class: 'config-history-actor', text: a.changedBy ?? '—' }),
          el('span', {
            class: 'config-history-old',
            text: `old: ${configTruncate(a.oldValueJson ?? '(none)', 80)}`,
          }),
          el('span', {
            class: 'config-history-new',
            text: `new: ${a.newValueJson === null ? '(reset)' : configTruncate(a.newValueJson, 80)}`,
          }),
        ],
      }),
    ),
  });
}

function renderConfigRow(key: string): HTMLElement {
  if (!settingsConfig.registry) return el('div', {});
  const entry = settingsConfig.registry.entries[key];
  if (!entry) return el('div', {});
  const override = settingsConfig.overrides[key];
  const isOverridden = !!override;
  const draft = settingsConfig.drafts.get(key);
  const dirty = draft !== undefined;
  const saving = settingsConfig.saving.has(key);
  const editorValue = draft ?? effectiveValueAsEditorString(entry, override);
  const expandedHistory = settingsConfig.expandedHistory.has(key);

  const editor = renderConfigEditor(key, entry, editorValue);

  const saveBtn = button(saving ? '保存中…' : '保存', 'button primary');
  saveBtn.disabled = !dirty || saving;
  saveBtn.onclick = () => void saveConfigOverride(key);

  const resetBtn = button('重置为默认', 'button secondary');
  resetBtn.disabled = !isOverridden || saving;
  resetBtn.onclick = () => void resetConfigOverride(key);

  const copyBtn = button('复制默认值', 'button secondary');
  copyBtn.onclick = () => copyConfigDefaultToDraft(key);

  const historyBtn = button(expandedHistory ? '收起历史' : '历史', 'button secondary');
  historyBtn.onclick = () => void toggleConfigHistory(key);

  const metaParts: string[] = [entry.type];
  if (entry.multiline) metaParts.push('multiline');
  if (entry.min !== undefined) metaParts.push(`min=${entry.min}`);
  if (entry.max !== undefined) metaParts.push(`max=${entry.max}`);

  const children: Array<Node | null | false | undefined> = [
    el('header', {
      class: 'config-row-header',
      children: [
        el('strong', { class: 'config-key', text: key }),
        pill(isOverridden ? 'overridden' : 'default'),
        el('span', { class: 'config-meta', text: metaParts.join(' · ') }),
      ],
    }),
    el('p', { class: 'muted config-description', text: entry.description }),
    el('p', { class: 'muted config-source', text: `default 来源: ${entry.source}` }),
    editor,
    el('div', {
      class: 'config-actions',
      children: [saveBtn, resetBtn, copyBtn, historyBtn],
    }),
  ];

  if (expandedHistory) children.push(renderConfigHistoryPanel(key));

  return el('article', {
    class: `config-row${isOverridden ? ' overridden' : ''}${dirty ? ' dirty' : ''}`,
    children,
  });
}

function renderConfigSection(): HTMLElement {
  if (!settingsConfig.registry) {
    if (settingsConfig.loading) {
      return el('section', {
        class: 'panel',
        children: [
          panelHeader('运行时配置', '加载中…'),
          el('p', { class: 'muted', text: '正在拉取 /config/registry 与 /config/overrides…' }),
        ],
      });
    }
    if (settingsConfig.error) {
      return el('section', {
        class: 'panel',
        children: [
          panelHeader('运行时配置', '加载失败'),
          el('p', { class: 'error', text: settingsConfig.error }),
        ],
      });
    }
    return el('section', {
      class: 'panel',
      children: [panelHeader('运行时配置', '准备加载…')],
    });
  }

  const vm = buildSettingsViewModel({
    registry: settingsConfig.registry,
    overrides: settingsConfig.overrides,
    drafts: settingsConfig.drafts,
    audits: settingsConfig.audits,
  });

  const tabBar = el('div', {
    class: 'config-tabs',
    children: vm.tabs.map((t) => {
      const btn = button(
        t.label,
        settingsConfig.activeTab === t.id ? 'tab-button active' : 'tab-button',
      );
      btn.title = t.help;
      btn.onclick = () => setSettingsConfigTab(t.id);
      return btn;
    }),
  });

  const activeTabVm = vm.tabs.find((t) => t.id === settingsConfig.activeTab);
  const categoryKeys = activeTabVm ? activeTabVm.rows.map((r) => r.key) : [];

  const errorBanner = settingsConfig.error
    ? el('div', { class: 'error-banner', text: settingsConfig.error })
    : null;

  const summarySubtitle = `默认 ⊕ DB override → runner ≤2s 生效 (${vm.summary.totalKeys} keys · ${vm.summary.overrideCount} override · ${vm.summary.dirtyCount} 未保存)`;

  const sectionChildren: Array<Node | null> = [
    panelHeader('运行时配置', summarySubtitle),
    errorBanner,
    tabBar,
    el('div', {
      class: 'config-list',
      children: categoryKeys.length === 0
        ? [el('p', { class: 'muted', text: '该分类下暂无配置项。' })]
        : categoryKeys.map(renderConfigRow),
    }),
  ];

  return el('section', {
    class: 'panel',
    children: sectionChildren.filter((c): c is Node => Boolean(c)),
  });
}

function renderSettingsPage(): HTMLElement {
  if (!settingsConfig.loadedOnce && !settingsConfig.loading && !settingsConfig.error) {
    void loadSettingsConfig();
  }
  const backend = agentBackendLabel();
  const project = selectedProject();
  const backendStatus = agentBackendStatusForProject(project);

  const decisionsAndRunner = el('section', {
    class: 'page-grid two-col',
    children: [
      el('section', {
        class: 'panel',
        children: [
          panelHeader('运行决策', 'Local Runner + Git worktree'),
          el('div', {
            class: 'decision-list',
            children: [
              field('Execution', '本地编译环境（host JDK / Maven / Git）'),
              field('Isolation', 'Git worktree 隔离工作目录与分支；不是安全沙箱'),
              field('Quality Boundary', '真实命令 + Gate + Diff + Approval + Audit'),
              field('Sandbox Policy', '不做 Docker/K8s/microVM/tool-policy 级强制'),
            ],
          }),
          el('div', {
            class: 'config-grid',
            children: [
              metric('Workflow Template', 'Java Maven Standard', '9-stage lifecycle', 'info'),
              metric('Agent Backend', `${backend} · ${backendStatus.label}`, project ? `Project default: ${project.name}` : 'Project default', backendStatus.kind),
              metric('Gate Rule Set', 'MVP deterministic', 'requirement/design/diff/build/test', 'good'),
              metric('Skill Version', 'built-in', 'context/req/design/impl/review', 'muted'),
            ],
          }),
        ],
      }),
      el('section', {
        class: 'panel',
        children: [
          panelHeader('Runner Status', '工具链 heartbeat'),
          latestRunner()
            ? el('div', { class: 'stack', children: data.runners.map(renderRunnerCard) })
            : el('p', { class: 'muted', text: '尚未收到 runner heartbeat。运行 `bun run runner -- doctor` 或 `watch`。' }),
        ],
      }),
    ],
  });

  return el('section', {
    class: 'stack',
    children: [decisionsAndRunner, renderConfigSection()],
  });
}

function renderRunnerCard(runner: RunnerDto): HTMLElement {
  return el('article', {
    class: 'runner-card',
    children: [
      el('div', { children: [el('strong', { text: runner.id }), pill(runner.status)] }),
      field('Host', runner.host),
      field('JDK', runner.jdkVersion ?? '—'),
      field('Maven', runner.mavenVersion?.split('\n')[0] ?? '—'),
      field('Git', runner.gitVersion ?? '—'),
      field('Last Seen', fmtTime(runner.lastSeenAt)),
    ],
  });
}

function actionLink(label: string, page: Page): HTMLButtonElement {
  const btn = button(label, 'button secondary');
  btn.onclick = () => setHash(page);
  return btn;
}

async function submitApproval(workflowRunId: string, gateId: string, approved: boolean): Promise<void> {
  const key = `${workflowRunId}:${gateId}`;
  const now = Date.now();
  const last = approvalLastSubmittedAt.get(key) ?? 0;
  if (approvalInFlight.has(key) || now - last < 2_000) return;
  approvalInFlight.add(key);
  approvalLastSubmittedAt.set(key, now);
  render();
  try {
    await api('/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowRunId,
        gateId,
        approved,
        actor: 'web',
        comment: approved ? 'approved via workbench UI' : 'rejected via workbench UI',
      }),
    });
    await loadRunDetail(workflowRunId, false);
    await loadData({ render: false, keepDetail: true });
  } finally {
    approvalInFlight.delete(key);
    render();
  }
}

async function submitAcceptanceDecision(
  workflowRunId: string,
  decision: 'accept_risk' | 'reject',
): Promise<void> {
  const key = `${workflowRunId}:acceptance_gate`;
  if (approvalInFlight.has(key)) return;
  approvalInFlight.add(key);
  render();
  try {
    await api(`/workflow-runs/${encodeURIComponent(workflowRunId)}/acceptance-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decision,
        actor: 'web',
        comment: decision === 'accept_risk' ? 'risk accepted via workbench UI' : 'acceptance rejected via workbench UI',
        payload: { source: 'acceptance-checklist' },
      }),
    });
    await loadRunDetail(workflowRunId, false);
    await loadData({ render: false, keepDetail: true });
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  } finally {
    approvalInFlight.delete(key);
    render();
  }
}

async function submitRequirementAction(
  workflowRunId: string,
  targetId: string,
  action: string,
): Promise<void> {
  try {
    await api(`/workflow-runs/${encodeURIComponent(workflowRunId)}/requirement-actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId,
        action,
        actor: 'web',
        payload: { source: 'requirement-card' },
      }),
    });
    await loadRunDetail(workflowRunId, false);
    await loadData({ render: false, keepDetail: true });
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  } finally {
    render();
  }
}

async function submitKnowledgeAction(
  workflowRunId: string,
  targetId: string,
  action: 'accepted' | 'edited' | 'ignored',
  payload: Record<string, unknown>,
): Promise<void> {
  const index = Number(targetId.replace(/^KS-/, '')) - 1;
  const key = `${workflowRunId}:${Number.isFinite(index) ? index : targetId}`;
  knowledgeDecisions.set(key, action);
  if (typeof payload.text === 'string') knowledgeEdits.set(key, payload.text);
  render();
  try {
    await api(`/workflow-runs/${encodeURIComponent(workflowRunId)}/knowledge-actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId,
        action,
        actor: 'web',
        payload,
      }),
    });
    await loadRunDetail(workflowRunId, false);
    await loadData({ render: false, keepDetail: true });
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  } finally {
    render();
  }
}

// ---- Agent Stream (SSE live tail) ----------------------------------------

interface AgentStreamEvent {
  id: string;
  workflowRunId: string;
  stepRunId: string | null;
  agentKind: AgentBackendKind;
  sequence: number;
  type: 'system' | 'assistant' | 'user' | 'result' | 'stderr' | 'raw' | 'meta';
  payload: Record<string, unknown>;
  text: string | null;
  ts: string;
}

let streamES: EventSource | null = null;
let streamRunId: string | null = null;
let expandedStreamRunId: string | null = null;
const streamEventsByRun: StreamEventCache<AgentStreamEvent> = new Map();
let streamConnection: { runId: string | null; label: string; cls: 'live' | 'idle' | 'error' } = {
  runId: null,
  label: 'disconnected',
  cls: 'idle',
};
const STREAM_EVENT_TYPES = ['system', 'assistant', 'user', 'result', 'stderr', 'meta', 'raw'] as const;

function setStreamStatus(label: string, cls: 'live' | 'idle' | 'error', runId: string | null = streamRunId): void {
  streamConnection = { runId, label, cls };
  updateStreamStatusNodes(runId, label, cls);
}

function appendStreamEvent(ev: AgentStreamEvent): void {
  if (!rememberStreamEvent(ev)) return;
  if (ev.workflowRunId !== streamRunId) return;
  refreshStreamViewsForRun(ev.workflowRunId);
}

function rememberStreamEvent(ev: AgentStreamEvent): boolean {
  return rememberStreamEventInCache(streamEventsByRun, ev);
}

function agentStreamEventsForRun(runId: string): AgentStreamEvent[] {
  return streamEventsForRun(streamEventsByRun, runId);
}

function lastStreamSeqForRun(runId: string): number {
  return lastStreamSequenceForRun(streamEventsByRun, runId);
}

interface AgentStreamViewModel {
  runId: string | null;
  title: string;
  summary: string;
  status: { label: string; cls: 'live' | 'idle' | 'error' };
  events: AgentStreamEvent[];
  lines: StreamDisplayLine[];
}

function buildAgentStreamView(runId: string | null): AgentStreamViewModel {
  const events = runId ? agentStreamEventsForRun(runId) : [];
  const backend = streamBackendForRun(runId, events);
  const title = backend === 'claude_code'
    ? 'Claude Code 执行日志'
    : backend === 'codex'
      ? 'Codex 执行日志'
      : 'Agent 执行日志';
  return {
    runId,
    title,
    summary: streamSummaryText(runId, streamRunTitle(runId), events.length),
    status: streamStatusForRun(runId),
    events,
    lines: buildStreamDisplayLines(events),
  };
}

function streamBackendForRun(runId: string | null, events: readonly AgentStreamEvent[]): AgentBackendKind | null {
  if (runId && data.activeDetail?.run.id === runId) {
    return activeRunAgentBackend() ?? events.at(-1)?.agentKind ?? selectedProjectBackend();
  }
  if (events.length > 0) return events.at(-1)?.agentKind ?? null;
  const run = runId ? data.runs.find((item) => item.id === runId) : null;
  return data.projects.find((project) => project.id === run?.projectId)?.agentBackend ?? selectedProjectBackend();
}

function streamRunTitle(runId: string | null): string | null {
  if (!runId) return null;
  if (data.activeDetail?.run.id === runId) return data.activeDetail.run.title;
  return data.runs.find((run) => run.id === runId)?.title ?? null;
}

function streamSummaryText(runId: string | null, runTitle: string | null, eventCount: number): string {
  if (!runId) return '等待 workflow run';
  return `${runTitle ? `${runTitle} · ` : ''}Run ${shortId(runId)} · ${eventCount} events`;
}

function renderStreamTitle(view: AgentStreamViewModel, id?: string): HTMLElement {
  const attrs: Record<string, string> = { 'data-stream-title': 'agent-stream' };
  if (view.runId) attrs['data-stream-run-id'] = view.runId;
  return el('h2', { id, text: view.title, attrs });
}

function renderStreamSummary(view: AgentStreamViewModel, id?: string): HTMLElement {
  const attrs: Record<string, string> = { 'data-stream-summary': 'agent-stream' };
  if (view.runId) attrs['data-stream-run-id'] = view.runId;
  return el('small', { id, class: 'muted', text: view.summary, attrs });
}

function renderStreamStatus(view: AgentStreamViewModel): HTMLElement {
  const attrs: Record<string, string> = { 'data-stream-status': 'agent-stream' };
  if (view.runId) attrs['data-stream-run-id'] = view.runId;
  return el('span', { class: `stream-status ${view.status.cls}`, text: view.status.label, attrs });
}

function renderAgentStreamBody(
  view: AgentStreamViewModel,
  opts: { id?: string; expanded?: boolean; scrollKeyPrefix: string },
): HTMLElement {
  const attrs: Record<string, string> = { 'data-stream-body': 'agent-stream' };
  if (view.runId) {
    attrs['data-stream-run-id'] = view.runId;
    attrs['data-scroll-key'] = `${opts.scrollKeyPrefix}:${view.runId}`;
    attrs['aria-label'] = `${view.title} ${view.summary}`;
  }
  attrs.role = 'log';
  attrs['aria-live'] = 'polite';
  attrs['aria-relevant'] = 'additions text';
  return el('div', {
    id: opts.id,
    class: `stream-body${opts.expanded ? ' stream-body-expanded' : ''}`,
    attrs,
    children: renderStreamBodyChildren(view),
  });
}

function renderStreamBodyChildren(view: AgentStreamViewModel): HTMLElement[] {
  return view.events.length
    ? view.lines.map(renderStreamDisplayLine)
    : [el('div', { class: 'stream-line meta', text: '等待真实 Agent Backend 输出；连接后会先回放历史事件，再继续 live tail。' })];
}

function renderStreamDisplayLine(line: StreamDisplayLine): HTMLElement {
  return el('div', {
    class: line.className,
    attrs: {
      'data-stream-sequences': line.sequences.join(','),
      ...(line.title ? { title: line.title } : {}),
    },
    children: [
      el('span', { class: 'stream-prefix', text: line.prefix }),
      el('span', { class: 'stream-text', text: ` ${line.text}` }),
    ],
  });
}

function openExpandedStream(runId: string): void {
  expandedStreamRunId = runId;
  render();
  requestAnimationFrame(() => {
    scrollStreamBodiesToBottom(runId);
    document.querySelector<HTMLButtonElement>('[data-stream-close="agent-stream"]')?.focus();
  });
}

function closeExpandedStream(): void {
  const closingRunId = expandedStreamRunId;
  expandedStreamRunId = null;
  render();
  if (closingRunId) {
    requestAnimationFrame(() => focusStreamExpandButton(closingRunId));
  }
}

function refreshStreamViewsForRun(runId: string): void {
  const view = buildAgentStreamView(runId);
  document.querySelectorAll<HTMLElement>('[data-stream-title="agent-stream"]').forEach((node) => {
    if (node.dataset.streamRunId === runId) node.textContent = view.title;
  });
  document.querySelectorAll<HTMLElement>('[data-stream-summary="agent-stream"]').forEach((node) => {
    if (node.dataset.streamRunId === runId) node.textContent = view.summary;
  });
  document.querySelectorAll<HTMLElement>('[data-stream-body="agent-stream"]').forEach((body) => {
    if (body.dataset.streamRunId !== runId) return;
    body.setAttribute('aria-label', `${view.title} ${view.summary}`);
    body.replaceChildren(...renderStreamBodyChildren(view));
    body.scrollTop = body.scrollHeight;
  });
}

function updateStreamStatusNodes(runId: string | null, label: string, cls: 'live' | 'idle' | 'error'): void {
  document.querySelectorAll<HTMLElement>('[data-stream-status="agent-stream"]').forEach((node) => {
    if ((node.dataset.streamRunId ?? null) !== runId) return;
    node.textContent = label;
    node.className = `stream-status ${cls}`;
  });
}

function scrollStreamBodiesToBottom(runId: string): void {
  document.querySelectorAll<HTMLElement>('[data-stream-body="agent-stream"]').forEach((body) => {
    if (body.dataset.streamRunId === runId) body.scrollTop = body.scrollHeight;
  });
}

function focusStreamExpandButton(runId: string): void {
  document.querySelectorAll<HTMLButtonElement>('[data-stream-expand-run-id]').forEach((button) => {
    if (button.dataset.streamExpandRunId === runId) button.focus();
  });
}

function detachStream(): void {
  const detachedRunId = streamRunId;
  if (streamES) streamES.close();
  streamES = null;
  streamRunId = null;
  setStreamStatus('disconnected', 'idle', detachedRunId);
}

function attachStream(runId: string): void {
  if (streamRunId === runId && streamES && streamES.readyState !== EventSource.CLOSED) return;
  const previousRunId = streamRunId;
  if (streamES) {
    streamES.close();
    setStreamStatus('disconnected', 'idle', previousRunId);
  }
  streamRunId = runId;
  setStreamStatus('connecting…', 'idle', runId);

  const sinceSeq = lastStreamSeqForRun(runId);
  const es = new EventSource(`${API_BASE}/workflow-runs/${encodeURIComponent(runId)}/agent-stream?sinceSeq=${sinceSeq}`);
  streamES = es;
  es.addEventListener('ready', () => setStreamStatus('live', 'live', runId));
  es.addEventListener('ping', () => setStreamStatus('live', 'live', runId));
  for (const type of STREAM_EVENT_TYPES) {
    es.addEventListener(type, (raw) => {
      try {
        appendStreamEvent(JSON.parse((raw as MessageEvent<string>).data) as AgentStreamEvent);
      } catch {
        // ignore malformed SSE payloads
      }
    });
  }
  es.onerror = () => {
    if (streamES === es) setStreamStatus('reconnecting…', 'error', runId);
  };
}

function streamStatusForRun(runId: string | null): { label: string; cls: 'live' | 'idle' | 'error' } {
  if (runId && streamConnection.runId === runId) return streamConnection;
  return { label: 'disconnected', cls: 'idle' };
}

window.addEventListener('hashchange', async () => {
  parseHash();
  await loadData({ render: false, keepDetail: false });
  const task = activeTaskRequest();
  if (task?.workflowRunId) await loadRunDetail(task.workflowRunId, false);
  else if (activeRunId && activePage !== 'task') await loadRunDetail(activeRunId, false);
  render();
  maybeAutoStartRunnerForActiveTask();
});
window.addEventListener('beforeunload', detachStream);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && expandedStreamRunId) closeExpandedStream();
});

parseHash();
await loadData({ render: true });
maybeAutoStartRunnerForActiveTask();
setInterval(() => {
  if (activePage === 'new-task' || activePage === 'projects') {
    void loadData({ render: false, keepDetail: true });
    return;
  }
  void loadData({ render: true, keepDetail: true });
  if (activeRunId) void loadRunDetail(activeRunId, true);
  maybeAutoStartRunnerForActiveTask();
}, 3000);
