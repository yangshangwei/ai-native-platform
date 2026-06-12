import {
  FLOW_LABELS,
  STAGE_HELP,
  STAGE_LABELS,
  STAGE_TO_GATE,
  visibleStagesForRun,
  artifactViewerScrollKey,
  buildAcceptanceChecklist,
  buildRunProjection,
  changedFilesFromDiff,
  isReadableFileArtifact,
  latestArtifactOfKind,
  parseCompletionReportArtifact,
  parseDesignArtifact,
  parseKnowledgeArtifact,
  parseRequirementArtifact,
  reportIsAcceptable,
  reportIsRunning,
  reportNeedsAttention,
  reportStats,
  reportStatusLabel,
  type KnowledgeSuggestion,
  type ArtifactDto,
  type DesignDoc,
  type FlowId,
  type GateRunDto,
  type RequirementDoc,
  type RunDetail,
  type Stage,
  type WorkflowRunDto,
} from './projection';
import { buildSettingsViewModel, type SettingsRowVM, type SettingsViewModel } from './settings-projection';
import {
  buildCoordinatorChoiceReply,
  coordinatorQuestionKey,
  mergeCoordinatorAutoReply,
  parseCoordinatorQuestion,
  type CoordinatorQuestionOption,
  type ParsedCoordinatorQuestion,
} from './coordinator-clarification';
import {
  buildStreamDisplayLines,
  lastStreamSequenceForChannel,
  rememberStreamEventInCache,
  streamChannelForEvent,
  streamChannelKey,
  streamEventsForChannel,
  type StreamDisplayLine,
  type StreamChannel,
  type StreamEventCache,
} from './stream-rendering';
import { errorMessage } from '@ainp/shared';
import type {
  AgentBackendKind,
  AgentBackendPreflightDto,
  ContextGovernanceDto,
  ContextManifestDto,
  DigestVerificationDto,
  KnowledgeActionDecision,
  KnowledgeArtifactDto,
  KnowledgeSuggestionItem,
  KnowledgeViewId,
  LocalDirectoryItem,
  LocalDirectoryList,
  LocalDirectoryPickerState,
  Page,
  ProjectAgentBackendKind,
  ProjectBranchListResult,
  ProjectDeletePreviewDto,
  ProjectDto,
  ProjectSourceAuthKind,
  ProjectSourceFormState,
  ProjectSourceKind,
  RatioMetricDto,
  ReportViewId,
  RunnerControlStatusDto,
  RunnerDto,
  SourceDetectFailure,
  SourceDetectResult,
  SourceDetectSuccess,
  StatusKind,
  WorkflowRequestDto,
} from './types';
import { API_BASE, api } from './api';
import {
  button,
  clear,
  controlledInput,
  el,
  field,
  fmtTime,
  icon,
  labeledInput,
  metric,
  pill,
  shortId,
  statusKind,
} from './dom';
import {
  activeProjects,
  activeRunAgentBackend,
  activeTaskRequest,
  agentBackendContextLabel,
  agentBackendDisplayName,
  agentBackendLabelForProject,
  agentBackendPreflight,
  agentBackendPreflightInFlight,
  agentBackendStatusForProject,
  approvalInFlight,
  approvalLastSubmittedAt,
  artifactContent,
  buildEnvLabel,
  commandLogs,
  contextGovernanceByRun,
  contextGovernanceInFlight,
  data,
  knowledgeArtifactsState,
  knowledgeDecisions,
  knowledgeEditDrafts,
  knowledgeEditing,
  knowledgeEdits,
  latestRunner,
  localDirectoryPicker,
  normalizeBranchList,
  openArtifactViewers,
  preflightForProjectBackend,
  projectActionInFlight,
  projectAvailability,
  projectBranchRefreshInFlight,
  projectName,
  projectSourceForm,
  runnerAutoStartAttemptedForRequest,
  selectedProject,
  selectedProjectBackend,
  sourceBranchesForProject,
  ui,
} from './state';
import { setHash, parseHash } from './router';
import { render, setRenderHooks } from './render-core';
import {
  ensureArtifactContent,
  ensureCommandLogs,
  ensureContextGovernance,
  loadData,
  loadKnowledgeArtifacts,
  loadRunDetail,
  setStreamHooks,
} from './data-loading';

function requestTypeLabel(type: WorkflowRequestDto['type'] | string): string {
  if (type === 'feature') return '功能需求';
  if (type === 'bugfix') return '问题修复';
  if (type === 'smoke') return '冒烟检查';
  if (type === 'refactor') return '重构任务';
  return type;
}

function stageStateLabel(state: 'done' | 'active' | 'blocked' | 'failed' | 'waiting'): string {
  if (state === 'done') return '已完成';
  if (state === 'active') return '进行中';
  if (state === 'blocked') return '待确认';
  if (state === 'failed') return '需处理';
  return '未开始';
}

function stageCardHint(state: 'done' | 'active' | 'blocked' | 'failed' | 'waiting'): string {
  if (state === 'done') return '这一阶段已完成';
  if (state === 'active') return '系统正在处理';
  if (state === 'blocked') return '等待你确认后继续';
  if (state === 'failed') return '需要查看失败原因';
  return '等待进入该阶段';
}

interface ReviewGateCopy {
  title: string;
  subtitle: string;
  description: string;
  approveLabel: string;
  rejectLabel: string;
  rejectTitle: string;
  rejectPlaceholder: string;
}

function reviewGateCopy(gateId: string | null, stage?: Stage): ReviewGateCopy {
  if (gateId === 'requirement_gate') {
    return {
      title: '请确认需求是否准确',
      subtitle: '需求分析等待确认',
      description: '重点看目标、验收标准、非目标和待确认问题。确认无误后批准进入方案设计。',
      approveLabel: '批准需求',
      rejectLabel: '打回修改',
      rejectTitle: '打回需求 - 请说明需要调整的点',
      rejectPlaceholder: '例如目标不准确、验收标准不完整、范围需要收紧，或还有必须补充的问题。',
    };
  }
  if (gateId === 'design_gate') {
    return {
      title: '请确认方案是否可执行',
      subtitle: '方案设计等待确认',
      description: '重点看实现思路、影响范围、测试策略和风险。确认无误后批准进入代码实现。',
      approveLabel: '批准方案',
      rejectLabel: '打回方案',
      rejectTitle: '打回方案 - 请说明需要修改的点',
      rejectPlaceholder: '例如方案不符合预期、遗漏影响范围、测试策略不足，或风险需要重新评估。',
    };
  }
  if (gateId === 'sensitive_change_gate') {
    return {
      title: '请确认敏感变更是否可以继续',
      subtitle: '代码实现遇到敏感变更',
      description: '请确认变更范围和风险可接受。批准后系统会继续执行后续检查。',
      approveLabel: '允许继续',
      rejectLabel: '要求修改',
      rejectTitle: '要求修改 - 请说明敏感变更问题',
      rejectPlaceholder: '请说明哪些变更不可接受、需要避开的文件或必须补充的验证。',
    };
  }
  if (gateId === 'acceptance_gate') {
    return {
      title: '请确认交付是否可以验收',
      subtitle: '验收确认等待决定',
      description: '请逐项检查验收清单。证据不足但可接受时，需要显式接受风险。',
      approveLabel: '接受风险并验收',
      rejectLabel: '拒绝验收',
      rejectTitle: '拒绝验收 - 请说明原因',
      rejectPlaceholder: '请逐条说明 AC 哪些项证据不足或不达标，模型会据此修订重跑。',
    };
  }
  if (gateId === 'knowledge_gate') {
    return {
      title: '请确认哪些经验需要沉淀',
      subtitle: '知识沉淀等待确认',
      description: '请检查候选知识是否值得保存到项目知识库，确认后用于后续任务复用。',
      approveLabel: '确认入库',
      rejectLabel: '暂不入库',
      rejectTitle: '暂不入库 - 请说明原因',
      rejectPlaceholder: '请说明哪些经验不准确、太具体、或暂时不适合作为项目知识沉淀。',
    };
  }
  const stageLabel = stage ? STAGE_LABELS[stage] : '当前阶段';
  return {
    title: `请确认${stageLabel}结果`,
    subtitle: `${stageLabel}等待确认`,
    description: '请检查当前阶段产物和证据，确认无误后批准进入下一阶段。',
    approveLabel: '批准继续',
    rejectLabel: '打回修改',
    rejectTitle: '打回修改 - 请说明原因',
    rejectPlaceholder: '请说明该阶段评审为何不通过、需要补充的证据或修改方向。',
  };
}

function gateDisplayLabel(gateId: string): string {
  if (gateId === 'requirement_gate') return '需求确认';
  if (gateId === 'design_gate') return '方案确认';
  if (gateId === 'sensitive_change_gate') return '敏感变更确认';
  if (gateId === 'acceptance_gate') return '验收确认';
  if (gateId === 'knowledge_gate') return '知识沉淀确认';
  if (gateId === 'compile_gate') return '编译检查';
  if (gateId === 'test_gate') return '测试检查';
  if (gateId === 'diff_scope_gate') return '变更范围检查';
  if (gateId === 'evidence_gate') return '证据检查';
  return gateId;
}

function taskFocusSummary(
  request: WorkflowRequestDto,
  detail: RunDetail | null,
  projection: ReturnType<typeof buildRunProjection> | null,
): { label: string; hint: string; kind: StatusKind } {
  if (!detail || !projection) {
    if (request.status === 'awaiting_clarification') return { label: '等待补充', hint: '请先回答需求澄清问题', kind: 'warn' };
    if (request.status === 'pending') return { label: '等待开始', hint: 'Runner 会自动认领任务', kind: 'info' };
    if (request.status === 'claimed') return { label: '准备运行', hint: 'Runner 正在创建工作流', kind: 'info' };
    if (request.status === 'failed') return { label: '需要处理', hint: '任务创建或认领失败', kind: 'bad' };
    if (request.status === 'completed') return { label: '已完成', hint: '任务已经结束', kind: 'good' };
    return { label: requestStatusLabel(request.status), hint: '查看详情确认当前状态', kind: statusKind(request.status) };
  }
  if (projection.pendingGate) {
    const copy = reviewGateCopy(projection.pendingGate, projection.currentStage);
    return { label: '等待你确认', hint: copy.subtitle, kind: 'warn' };
  }
  if (detail.run.status === 'running') return { label: '自动执行中', hint: `${STAGE_LABELS[projection.currentStage]}正在处理`, kind: 'info' };
  if (detail.run.status === 'passed' || detail.run.status === 'completed') {
    return { label: '已完成', hint: '可以查看交付报告和知识沉淀', kind: 'good' };
  }
  if (detail.run.status === 'failed') return { label: '需要处理', hint: `${STAGE_LABELS[projection.currentStage]}出现失败`, kind: 'bad' };
  return { label: detail.run.status, hint: `${STAGE_LABELS[projection.currentStage]}当前状态`, kind: statusKind(detail.run.status) };
}

function taskProgressMetric(projection: ReturnType<typeof buildRunProjection> | null): { value: string; hint: string; kind: StatusKind } {
  if (!projection) return { value: '尚未开始', hint: '等待 Runner 创建工作流', kind: 'muted' };
  const total = projection.visibleStages.length;
  const done = projection.visibleStages.filter((stage) => stage.state === 'done').length;
  const failed = projection.visibleStages.some((stage) => stage.state === 'failed');
  const blocked = projection.visibleStages.some((stage) => stage.state === 'blocked');
  return {
    value: `${done}/${total} 阶段`,
    hint: failed ? '有阶段需要处理' : blocked ? '暂停等待确认' : '按流程自动推进',
    kind: failed ? 'bad' : blocked ? 'warn' : done === total && total > 0 ? 'good' : 'info',
  };
}

function currentKnowledgeArtifacts(): KnowledgeArtifactDto[] {
  const project = selectedProject();
  if (!project || knowledgeArtifactsState.projectId !== project.id) return [];
  return knowledgeArtifactsState.artifacts;
}

function ensureKnowledgeArtifacts(project: ProjectDto | null): void {
  if (!project) return;
  const staleProject = knowledgeArtifactsState.projectId !== project.id;
  const shouldLoad = staleProject || (!knowledgeArtifactsState.loadedOnce && !knowledgeArtifactsState.loading);
  if (shouldLoad) void loadKnowledgeArtifacts(project.id);
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
    { page: 'new-task', label: '新建任务', help: '说明想做什么', path: 'M12 5v14M5 12h14' },
    { page: 'reports', label: '报告', help: '交付证据汇总', path: 'M7 3h7l5 5v13H7zM14 3v6h6' },
    { page: 'knowledge', label: '知识库', help: '候选与沉淀', path: 'M4 19V5a2 2 0 012-2h12v16H6a2 2 0 01-2-2zM8 7h8M8 11h8M8 15h5' },
    { page: 'settings', label: '配置', help: '本地 worktree 模式', path: 'M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2m12 0h2M12 4v2m0 12v2' },
  ];

  const nav = el('nav', { class: 'nav-list' });
  for (const item of navItems) {
    const a = el('button', {
      class: `nav-item ${ui.activePage === item.page ? 'active' : ''}`,
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
          metric('等待开始', String(pending), control?.running ? '自动排队中' : '等待执行器', 'info'),
          metric('执行中', String(claimed), 'AI 正在处理', 'warn'),
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
  const project = ui.activePage === 'new-task'
    ? activeProjects().find((p) => p.id === newTaskFormDraft.projectId) ?? activeProjects()[0] ?? null
    : selectedProject();
  const run = data.activeDetail?.run ?? data.runs[0] ?? null;
  const runner = latestRunner();
  const backend = agentBackendContextLabel(project);
  const newTaskReadiness = newTaskReadinessSummary(project, runner);
  const workbenchEnvironment = workbenchEnvironmentSummary(project, runner);
  const projectOnboarding = projectOnboardingSummary();
  const reportStatus = reportStatusSummary();
  const knowledgeStatus = knowledgeStatusSummary();
  const settingsRuntime = settingsRuntimeSummary(project, runner);
  const contextItems = ui.activePage === 'new-task'
    ? [contextItem('创建准备', newTaskReadiness.value, newTaskReadiness.kind)]
    : ui.activePage === 'workbench'
      ? [contextItem('执行环境', workbenchEnvironment.value, workbenchEnvironment.kind)]
    : ui.activePage === 'projects'
      ? [contextItem('接入状态', projectOnboarding.value, projectOnboarding.kind)]
    : ui.activePage === 'reports'
      ? [contextItem('交付状态', reportStatus.value, reportStatus.kind)]
    : ui.activePage === 'knowledge'
      ? [contextItem('知识状态', knowledgeStatus.value, knowledgeStatus.kind)]
    : ui.activePage === 'settings'
      ? [contextItem('运行状态', settingsRuntime.value, settingsRuntime.kind)]
    : [
        contextItem('Project', project?.name ?? '未接入', 'info'),
        contextItem('Branch', run?.branch ?? project?.defaultBranch ?? '—', 'muted'),
        contextItem('Runner', runner ? runner.status : 'offline', runner ? statusKind(runner.status) : 'bad'),
        contextItem('Agent Backend', backend.value, backend.kind),
        contextItem('Build Env', buildEnvLabel(), runner ? 'good' : 'warn'),
      ];
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
        children: contextItems,
      }),
    ],
  });
}

function newTaskReadinessSummary(project: ProjectDto | null, runner: RunnerDto | null): { value: string; kind: StatusKind } {
  if (ui.projectsLoadError) return { value: '项目加载失败', kind: 'bad' };
  if (!project) return { value: '需要连接项目', kind: 'warn' };
  if (!project.agentBackend) return { value: '需要配置执行方式', kind: 'warn' };
  const preflight = preflightForProjectBackend(project);
  if (preflight && !preflight.runnable) return { value: '执行方式需处理', kind: 'bad' };
  if (!runner) return { value: '可创建 · 执行器待启动', kind: 'warn' };
  return { value: '可创建', kind: 'good' };
}

function workbenchEnvironmentSummary(project: ProjectDto | null, runner: RunnerDto | null): { value: string; kind: StatusKind } {
  if (!project) return { value: '需要连接项目', kind: 'warn' };
  if (!project.agentBackend) return { value: '需要配置执行方式', kind: 'warn' };
  if (!runner) return { value: '执行器待启动', kind: 'warn' };
  const backend = agentBackendStatusForProject(project);
  if (backend.kind === 'bad') return { value: '执行方式需处理', kind: 'bad' };
  if (backend.kind === 'warn') return { value: '执行方式待处理', kind: 'warn' };
  return { value: '正常', kind: 'good' };
}

function projectOnboardingSummary(): { value: string; kind: StatusKind } {
  if (ui.projectsLoadError) return { value: '项目加载失败', kind: 'bad' };
  if (!data.projects.length) return { value: '还没有项目', kind: 'warn' };

  const active = activeProjects();
  const available = active.filter((project) => projectAvailability(project).label === '可用').length;
  const pending = active.length - available;
  const archived = data.projects.length - active.length;
  const suffix = archived > 0 ? ` · ${archived} 个已归档` : '';
  const kind: StatusKind = available > 0 && pending === 0 ? 'good' : available > 0 ? 'warn' : 'warn';
  return { value: `${available} 个项目可用 · ${pending} 个待配置${suffix}`, kind };
}

function reportStatusSummary(): { value: string; kind: StatusKind } {
  const stats = reportStats(data.runs);
  if (stats.total === 0) return { value: '暂无报告', kind: 'muted' };
  if (stats.attention > 0) return { value: `${stats.attention} 个需处理`, kind: 'warn' };
  if (stats.running > 0) return { value: `${stats.running} 个执行中`, kind: 'info' };
  if (stats.acceptable > 0) return { value: `${stats.acceptable} 个可验收`, kind: 'good' };
  return { value: `${stats.total} 个报告`, kind: 'muted' };
}

function knowledgeStatusSummary(): { value: string; kind: StatusKind } {
  const project = selectedProject();
  if (!project) return { value: '需要连接项目', kind: 'warn' };
  if (knowledgeArtifactsState.error) return { value: '知识加载失败', kind: 'bad' };
  const detail = data.activeDetail;
  const suggestions = detail ? parsedKnowledge(detail) : [];
  const pending = detail ? knowledgeSuggestionItems(detail, suggestions).filter((item) => !item.decision).length : 0;
  if (pending > 0) return { value: `${pending} 条待确认`, kind: 'warn' };
  if (knowledgeArtifactsState.loading && knowledgeArtifactsState.projectId === project.id) {
    return { value: '正在加载知识', kind: 'info' };
  }
  const accepted = currentKnowledgeArtifacts().filter((artifact) => artifact.status === 'accepted').length;
  if (accepted > 0) return { value: `${accepted} 条已收录`, kind: 'good' };
  return { value: '等待沉淀', kind: 'muted' };
}

function settingsRuntimeSummary(project: ProjectDto | null, runner: RunnerDto | null): { value: string; kind: StatusKind } {
  if (settingsConfig.error) return { value: '配置加载失败', kind: 'bad' };
  if (settingsConfig.drafts.size > 0) return { value: `${settingsConfig.drafts.size} 项未保存`, kind: 'warn' };
  if (!project) return { value: '需要连接项目', kind: 'warn' };
  if (!project.agentBackend) return { value: '执行方式待配置', kind: 'warn' };
  const backend = agentBackendStatusForProject(project);
  if (backend.kind === 'bad') return { value: '执行方式需处理', kind: 'bad' };
  if (!runner) return { value: '执行器待启动', kind: 'warn' };
  return { value: '可运行', kind: 'good' };
}

function titleForPage(): string {
  switch (ui.activePage) {
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
      return '工作台';
  }
}

function contextItem(label: string, value: string, kind: StatusKind): HTMLElement {
  return el('div', {
    class: 'context-item',
    children: [el('span', { text: label }), el('strong', { class: kind, text: value })],
  });
}

function renderPage(): HTMLElement {
  if (ui.lastError && ui.activePage !== 'new-task') {
    return el('section', { class: 'page-stack', children: [renderError(ui.lastError), renderCurrentPage()] });
  }
  return renderCurrentPage();
}

function renderCurrentPage(): HTMLElement {
  switch (ui.activePage) {
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
      renderWorkbenchActionPanel(),
      renderWorkbenchOverviewPanel(),
      renderTaskListPanel(),
      renderWorkbenchEnvironmentPanel(),
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
  const coordinatorPanel = renderCoordinatorChatPanel(request);
  const nextActionPanel = () => renderTaskNextActionPanel(request, detail, projection);
  return el('section', {
    class: 'task-detail-grid',
    children: [
      el('div', {
        class: 'workspace-main',
        children: [
          renderTaskHero(request, detail, projection),
          el('div', { class: 'mobile-next-action', children: [nextActionPanel()] }),
          coordinatorPanel,
          detail ? renderLifecycle(detail, projection!) : renderQueuedLifecycle(request),
          renderCurrentStagePanel(request, detail, projection),
          detail ? renderContextGovernancePanel(detail) : null,
          detail ? renderStageBackendDetails(detail, projection!) : renderQueuedBackendDetails(request),
        ],
      }),
      el('aside', {
        class: 'workspace-side',
        children: [
          el('div', { class: 'desktop-next-action', children: [nextActionPanel()] }),
          detail ? renderEvidencePanel(detail) : renderRequestDebugPanel(request, 'side-panel'),
          renderRunnerControlPanel(),
          detail ? renderAgentStreamPanel() : null,
        ],
      }),
    ],
  });
}

type WorkbenchActionItem =
  | { kind: 'request'; request: WorkflowRequestDto; reason: string; actionLabel: string; statusLabel: string; statusKind: StatusKind }
  | { kind: 'run'; run: WorkflowRunDto; request: WorkflowRequestDto | null; reason: string; actionLabel: string; statusLabel: string; statusKind: StatusKind };

function requestStatusLabel(status: WorkflowRequestDto['status']): string {
  if (status === 'pending') return '等待开始';
  if (status === 'awaiting_clarification') return '等待补充信息';
  if (status === 'claimed') return '执行中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '需要处理';
  if (status === 'cancelled') return '已取消';
  return status;
}

function requestActionLabel(status: WorkflowRequestDto['status']): string {
  if (status === 'awaiting_clarification') return '回答问题';
  if (status === 'completed') return '查看结果';
  if (status === 'failed') return '查看问题';
  if (status === 'cancelled') return '查看记录';
  return '查看进度';
}

function isRequestUserAction(request: WorkflowRequestDto): boolean {
  return request.status === 'awaiting_clarification' || request.status === 'failed';
}

function isRequestInProgress(request: WorkflowRequestDto): boolean {
  return request.status === 'pending' || request.status === 'claimed';
}

function workbenchActionItems(): WorkbenchActionItem[] {
  const requestActions: WorkbenchActionItem[] = data.requests
    .filter(isRequestUserAction)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((request) => ({
      kind: 'request' as const,
      request,
      reason: request.status === 'awaiting_clarification' ? 'AI 需要你补充信息后才能继续。' : '任务处理失败，需要查看原因。',
      actionLabel: requestActionLabel(request.status),
      statusLabel: requestStatusLabel(request.status),
      statusKind: statusKind(request.status),
    }));

  const runActions: WorkbenchActionItem[] = data.runs
    .filter((run) => run.status === 'awaiting_human')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((run) => ({
      kind: 'run' as const,
      run,
      request: data.requests.find((candidate) => candidate.workflowRunId === run.id) ?? null,
      reason: `${STAGE_LABELS[run.currentStage]} 等待你确认。`,
      actionLabel: '查看证据',
      statusLabel: '等待确认',
      statusKind: 'warn' as const,
    }));

  return [...requestActions, ...runActions];
}

function openWorkbenchAction(item: WorkbenchActionItem): void {
  if (item.kind === 'request') {
    setHash('task', item.request.id);
    return;
  }
  if (item.request) setHash('task', item.request.id);
  else setHash('workbench', item.run.id);
}

function renderWorkbenchActionPanel(): HTMLElement {
  const actions = workbenchActionItems();
  if (!actions.length) {
    return el('section', {
      class: 'panel workbench-action-panel empty-action-panel',
      children: [
        panelHeader('需要我处理', '暂无需要你处理的任务。'),
        el('p', { class: 'muted compact', text: 'AI 会继续推进运行中的任务；你也可以创建一个新任务。' }),
        el('div', { class: 'button-row', children: [actionLink('新建任务', 'new-task')] }),
      ],
    });
  }

  const primary = actions[0]!;
  const open = button(primary.actionLabel, 'button primary');
  open.onclick = () => openWorkbenchAction(primary);
  const title = primary.kind === 'request' ? primary.request.title : primary.run.title;
  const meta = primary.kind === 'request'
    ? `${projectName(primary.request.projectId)} · ${fmtTime(primary.request.updatedAt)}`
    : `${projectName(primary.run.projectId)} · ${fmtTime(primary.run.createdAt)}`;
  return el('section', {
    class: 'panel workbench-action-panel',
    children: [
      panelHeader('需要我处理', `${actions.length} 个任务等待你的输入或确认。`),
      el('article', {
        class: 'workbench-primary-action',
        children: [
          el('div', {
            class: 'workbench-primary-copy',
            children: [
              pill(primary.statusLabel, primary.statusKind),
              el('strong', { text: title }),
              el('p', { class: 'muted compact', text: primary.reason }),
              el('small', { text: meta }),
            ],
          }),
          open,
        ],
      }),
      actions.length > 1
        ? el('div', {
            class: 'workbench-secondary-actions',
            children: actions.slice(1, 4).map((item) => {
              const secondaryOpen = button(item.actionLabel, 'button secondary small');
              secondaryOpen.onclick = () => openWorkbenchAction(item);
              return el('div', {
                class: 'mini-row',
                children: [
                  el('span', { text: item.kind === 'request' ? item.request.title : item.run.title }),
                  secondaryOpen,
                ],
              });
            }),
          })
        : null,
    ],
  });
}

function renderWorkbenchOverviewPanel(): HTMLElement {
  const actions = workbenchActionItems();
  const active = [
    ...data.requests.filter(isRequestInProgress).map((request) => request.title),
    ...data.runs.filter((run) => run.status === 'running').map((run) => run.title),
  ];
  const completed = data.runs.filter((run) => statusKind(run.status) === 'good').slice(0, 5);
  return el('section', {
    class: 'panel overview-panel',
    children: [
      panelHeader('工作台概览', '按你的下一步行动组织任务。'),
      el('div', {
        class: 'overview-grid',
        children: [
          renderWorkbenchStatCard(
            '需要我处理',
            actions.length,
            actions.length ? '有任务等待输入或确认。' : '暂无需要你处理的任务。',
            actions.map((item) => (item.kind === 'request' ? item.request.title : item.run.title)),
            actions.length ? 'warn' : 'good',
          ),
          renderWorkbenchStatCard(
            'AI 正在处理',
            active.length,
            active.length ? '这些任务正在排队或执行。' : '当前没有执行中的任务。',
            active,
            active.length ? 'info' : 'muted',
          ),
          renderWorkbenchStatCard(
            '最近完成',
            completed.length,
            completed.length ? '最近交付结果可查看。' : '还没有完成的任务。',
            completed.map((run) => run.title),
            completed.length ? 'good' : 'muted',
          ),
        ],
      }),
    ],
  });
}

function renderWorkbenchStatCard(title: string, count: number, emptyText: string, items: string[], kind: StatusKind): HTMLElement {
  return el('article', {
    class: 'overview-card workbench-stat-card',
    children: [
      el('div', { class: 'overview-card-head', children: [el('strong', { text: title }), pill(String(count), kind)] }),
      items.length
        ? el('div', {
            class: 'stack',
            children: items.slice(0, 3).map((item) => el('div', { class: 'mini-row', children: [el('span', { text: item })] })),
          })
        : el('p', { class: 'muted compact', text: emptyText }),
    ],
  });
}

function renderTaskListPanel(): HTMLElement {
  const latestRequests = [...data.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const needsAction = latestRequests.filter(isRequestUserAction);
  const inProgress = latestRequests.filter(isRequestInProgress);
  const completed = latestRequests.filter((request) => request.status === 'completed');
  return el('section', {
    class: 'panel',
    children: [
      panelHeader('任务列表', '按你最常处理的工作状态分组。'),
      renderTaskListSection('需要处理', needsAction, '暂无需要你处理的任务。'),
      renderTaskListSection('进行中', inProgress, '暂无进行中的任务。'),
      renderTaskListSection('已完成', completed, '暂无已完成的任务。', 5),
      latestRequests.length
        ? el('details', {
            class: 'raw-details workbench-all-tasks',
            attrs: { 'data-details-key': 'workbench-all-tasks' },
            children: [
              el('summary', { text: `全部任务 (${latestRequests.length})` }),
              renderTaskListSection('', latestRequests.slice(0, 12), '暂无任务。'),
            ],
          })
        : null,
    ],
  });
}

function renderTaskListSection(title: string, requests: WorkflowRequestDto[], emptyText: string, limit = 8): HTMLElement {
  return el('section', {
    class: 'workbench-task-section',
    children: [
      title ? el('div', { class: 'workbench-section-head', children: [el('h3', { text: title }), pill(String(requests.length), requests.length ? 'info' : 'muted')] }) : null,
      requests.length
        ? el('div', { class: 'task-list', children: requests.slice(0, limit).map(renderTaskListItem) })
        : el('p', { class: 'muted compact', text: emptyText }),
    ],
  });
}

function renderTaskListItem(request: WorkflowRequestDto): HTMLElement {
  const open = button(requestActionLabel(request.status), 'button secondary small');
  open.onclick = () => setHash('task', request.id);
  return el('article', {
    class: 'task-list-item',
    children: [
      el('div', {
        class: 'task-list-main',
        children: [
          el('strong', { text: request.title }),
          el('small', { text: `${projectName(request.projectId)} · ${fmtTime(request.updatedAt)}` }),
        ],
      }),
      pill(requestStatusLabel(request.status), statusKind(request.status)),
      open,
    ],
  });
}

function renderRunListItem(run: WorkflowRunDto): HTMLElement {
  const request = data.requests.find((candidate) => candidate.workflowRunId === run.id);
  const item = el('button', {
    class: `run-item ${run.id === ui.activeRunId ? 'active' : ''}`,
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

function renderWorkbenchEnvironmentPanel(): HTMLElement {
  const project = selectedProject();
  const runner = latestRunner();
  const summary = workbenchEnvironmentSummary(project, runner);
  const details = document.createElement('details');
  details.className = 'raw-details workbench-environment-details';
  details.setAttribute('data-details-key', 'workbench-environment');
  details.append(
    el('summary', { children: [el('span', { text: '查看执行环境细节' }), pill(summary.value, summary.kind)] }),
    field('项目', project?.name ?? '未连接'),
    field('基础分支', project?.defaultBranch ?? '—'),
    field('执行器', runner ? runner.status : '未连接'),
    field('执行方式', agentBackendContextLabel(project).value),
    field('构建环境', buildEnvLabel()),
  );
  return el('section', {
    class: 'panel workbench-environment-panel',
    children: [
      panelHeader('执行环境', summary.kind === 'good' ? '正常时无需处理。' : '需要处理时再展开查看细节。'),
      details,
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
  const focus = taskFocusSummary(request, detail, projection);
  const progress = taskProgressMetric(projection);
  return el('section', {
    class: 'hero-card task-hero',
    children: [
      el('div', {
        class: 'hero-copy',
        children: [
          el('div', {
            class: 'run-meta-line',
            children: [
              pill(focus.label, focus.kind),
              pill(requestTypeLabel(request.type), 'muted'),
              el('span', { text: `创建于 ${fmtTime(request.createdAt)}` }),
            ],
          }),
          el('h2', { text: request.title }),
          el('p', {
            text: detail
              ? `${focus.hint}。当前阶段是 ${current}。`
              : `${focus.hint}。当前阶段是 ${current}。`,
          }),
          renderTaskTechnicalSummary(request, detail, status),
        ],
      }),
      el('div', {
        class: 'metric-grid',
        children: [
          metric('当前关注', focus.label, focus.hint, focus.kind),
          metric('当前阶段', current, projection ? STAGE_HELP[projection.currentStage] : '系统会自动进入主流程', detail ? statusKind(detail.run.status) : statusKind(request.status)),
          metric('任务进度', progress.value, progress.hint, progress.kind),
          metric('所属项目', projectName(request.projectId), requestTypeLabel(request.type), 'info'),
        ],
      }),
    ],
  });
}

function renderTaskTechnicalSummary(request: WorkflowRequestDto, detail: RunDetail | null, status: string): HTMLElement {
  return el('details', {
    class: 'raw-details task-technical-summary',
    attrs: { 'data-details-key': `task-technical-summary:${request.id}` },
    children: [
      el('summary', { text: '查看技术标识' }),
      field('Request', el('code', { text: request.id })),
      detail ? field('Run', el('code', { text: detail.run.id })) : null,
      field('状态', status),
      field('Source Branch', detail?.run.sourceBranch ?? request.branch),
      detail ? field('工作分支', detail.run.branch) : null,
      detail ? field('Worktree', detail.run.workspacePath ?? '尚未准备') : null,
      field('系统分诊', coordinatorVerdictText(request)),
    ],
  });
}

function coordinatorVerdictText(request: WorkflowRequestDto): string {
  const state = coordinatorChats.get(request.id);
  if (!state) {
    void loadCoordinatorChat(request.id);
    return `等待分诊（用户标记：${requestTypeLabel(request.type)}）`;
  }
  const decision = state.decision?.decision;
  if (!decision) return `等待分诊（用户标记：${requestTypeLabel(request.type)}）`;
  if (decision.action === 'proceed') return `${requestTypeLabel(decision.runType)} · ${decision.routeCase}`;
  if (decision.action === 'pause_for_human') return `需要补充信息 · ${decision.questions.length} 个问题`;
  return `已取消 · ${decision.reason}`;
}

function renderQueuedLifecycle(request: WorkflowRequestDto): HTMLElement {
  const queuedDone = request.status !== 'pending';
  const runnerActive = request.status === 'claimed';
  // Preview the lifecycle the runner will execute. When the request pins a
  // flow we honor it; otherwise the router decides at claim time, so we
  // preview the feature.standard track (the conservative default) and label
  // it as such.
  const previewFlow = request.flowId ?? 'feature.standard';
  const visibleStages = visibleStagesForRun(previewFlow, request.startStage ?? null);
  const states: Array<{ label: string; state: 'done' | 'active' | 'waiting' | 'failed'; help: string }> = [
    { label: '任务入队', state: queuedDone ? 'done' : request.status === 'pending' ? 'active' : 'waiting', help: '任务已创建，等待自动执行' },
    { label: 'Runner 自动开始', state: runnerActive ? 'active' : 'waiting', help: '等待本地 Runner 认领并创建运行' },
    ...visibleStages.map((stage) => ({ label: STAGE_LABELS[stage], state: 'waiting' as const, help: '等待进入该阶段' })),
  ];
  const subtitle = request.flowId
    ? `预定 Flow：${request.flowId}（共 ${visibleStages.length} 个用户阶段）`
    : 'Flow 由 router 在认领时决定；下面按 feature.standard 预览。';
  return el('section', {
    class: 'panel',
    children: [
      panelHeader('完整流程', subtitle),
      el('div', {
        class: 'stage-board',
        children: states.map((stage, index) =>
          el('article', {
            class: `stage-card ${stage.state}`,
            children: [
              el('span', { class: 'stage-index', text: String(index + 1).padStart(2, '0') }),
              el('strong', { text: stage.label }),
              el('small', { text: stage.help }),
              el('span', { class: `stage-state ${stage.state}`, text: stageStateLabel(stage.state) }),
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
        renderRequestDebugPanel(request, 'current-stage'),
      ],
    });
  }

  const stage = projection.currentStage;
  const pendingGate = projection.pendingGate;
  if (pendingGate) {
    const copy = reviewGateCopy(pendingGate, stage);
    return el('section', {
      class: 'current-stage-panel',
      children: [
        el('div', {
          class: 'panel checkpoint',
          children: [
            panelHeader('当前需要你确认', copy.subtitle),
            el('p', { text: copy.description }),
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
  // V2 W2-2a/2b: issue.standard (report → analyze) and refactor.standard
  // (scan → plan) agent stages. These emit kind='other' markdown artifacts
  // tagged with metadata.stage; render the latest one so a non-feature run
  // never falls through to the context-prep snapshot.
  if (stage === 'report' || stage === 'analyze' || stage === 'scan' || stage === 'plan') {
    return renderAgentStagePanel(detail, stage);
  }
  return renderContextSnapshotPanel(detail);
}

// Generic panel for agent stages whose only artifact is a markdown document
// tagged via `metadata.stage` (report / analyze / scan / plan). Unlike the
// feature stages there is no structured schema or gate, so we surface the
// step status plus a preview of the stage's latest markdown artifact.
function renderAgentStagePanel(detail: RunDetail, stage: Stage): HTMLElement {
  const step = detail.steps.find((s) => s.stage === stage);
  const text = stageMarkdownArtifactText(detail, stage);
  return el('article', {
    class: 'panel doc-panel',
    children: [
      panelHeader(STAGE_LABELS[stage], STAGE_HELP[stage]),
      step
        ? field('Step', el('span', { children: [pill(step.status), document.createTextNode(` ${step.name}`)] }))
        : el('p', { class: 'muted', text: '等待进入该阶段。' }),
      text
        ? el('pre', { class: 'doc-preview', text: previewText(text) })
        : el('p', { class: 'muted compact', text: '该阶段产物加载中或尚未生成。' }),
    ],
  });
}

// Latest markdown text of the artifact a given agent stage produced. The
// runner persists these as kind='other' with `metadata.stage` set, so we
// filter on that tag rather than artifact kind (which is shared across stages).
function stageMarkdownArtifactText(detail: RunDetail, stage: Stage): string {
  const artifact = detail.artifacts
    .filter((candidate) => candidate.metadata?.stage === stage)
    .filter(
      (candidate) =>
        candidate.contentType.includes('markdown') ||
        (typeof candidate.metadata?.output === 'string' && candidate.metadata.output.endsWith('.md')),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  if (!artifact) return '';
  return artifactContent.get(artifact.id)?.text ?? '';
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

function renderContextGovernancePanel(detail: RunDetail): HTMLElement {
  const model = contextGovernanceByRun.get(detail.run.id) ?? null;
  if (!model) {
    return el('section', {
      class: 'panel doc-panel diagnostic-panel',
      children: [
        panelHeader('参考资料', '系统正在读取 Agent 使用的项目资料。'),
        el('p', { class: 'muted compact', text: '暂时没有可展示的资料摘要；排查时可查看技术证据。' }),
      ],
    });
  }

  const metrics = model.metrics;
  return el('section', {
    class: 'panel doc-panel structured-panel diagnostic-panel',
    children: [
      panelHeader('参考资料', '排查 Agent 为什么这么判断时再展开。'),
      el('details', {
        class: 'raw-details diagnostic-shell',
        attrs: { 'data-details-key': `context-governance:${detail.run.id}` },
        children: [
          el('summary', { text: '查看 Agent 使用了哪些资料' }),
          el('div', {
            class: 'metric-grid diagnostic-metrics',
            children: [
              metric('覆盖度', formatPercent(metrics.impactCoverage.value), `${metrics.impactCoverage.numerator}/${metrics.impactCoverage.denominator} agent tasks`, metrics.impactCoverage.value >= 0.8 ? 'good' : 'warn'),
              metric('可追溯性', formatPercent(metrics.evidenceTraceability.value), `${metrics.evidenceTraceability.numerator}/${metrics.evidenceTraceability.denominator} manifest refs`, metrics.evidenceTraceability.value >= 0.8 ? 'good' : 'warn'),
              metric('低相关资料', formatPercent(metrics.irrelevantContextRatio.value), 'deterministic low-signal proxy', metrics.irrelevantContextRatio.value <= 0.2 ? 'good' : 'warn'),
              metric('补充请求', String(metrics.contextRequestCount.value), 'structured requests', metrics.contextRequestCount.value ? 'info' : 'muted'),
              metric('返工信号', String(metrics.downstreamReworkSignal.value), 'rejects + failed gates/agents', metrics.downstreamReworkSignal.value ? 'warn' : 'good'),
            ],
          }),
          renderContextManifestSummary(model.manifest),
          renderContextBudgetSummary(model.budgetDecisions),
          renderContextRequestHistory(model.contextRequests),
          renderContextSourceRefs(model.sourceRefs),
        ],
      }),
    ],
  });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function renderContextManifestSummary(items: ContextManifestDto[]): HTMLElement {
  return el('details', {
    class: 'raw-details',
    children: [
      el('summary', { text: `Context Manifest (${items.length})` }),
      items.length
        ? el('div', {
            class: 'stack',
            children: items.slice(0, 20).map((item) =>
              el('article', {
                class: 'evidence-row',
                children: [
                  el('span', {
                    children: [
                      pill(item.trustLevel ?? 'unknown', trustKind(item.trustLevel)),
                      document.createTextNode(` ${item.ref}`),
                    ],
                  }),
                  el('small', { text: `mode=${item.mode ?? 'n/a'} · class=${item.knowledgeClass ?? 'n/a'} · freshness=${item.freshness ?? 'n/a'} · score=${item.score ?? 'n/a'}` }),
                  item.sourceRefs.length
                    ? el('small', { text: `sourceRefs: ${item.sourceRefs.join(' · ')}` })
                    : el('small', { class: 'warn', text: 'sourceRefs: (none)' }),
                  item.degradedFrom
                    ? el('small', { class: 'warn', text: `budget: ${item.degradedFrom} → ${item.mode ?? 'n/a'} (${item.degradationReason ?? 'budget degradation'})` })
                    : null,
                  el('small', { text: item.reason }),
                ],
              }),
            ),
          })
        : el('p', { class: 'muted compact', text: 'No manifest items recorded yet.' }),
    ],
  });
}

function renderContextBudgetSummary(items: ContextGovernanceDto['budgetDecisions']): HTMLElement {
  const degraded = items.filter((item) => item.degradedFrom || item.mode === 'retrieval_hint');
  return el('details', {
    class: 'raw-details',
    children: [
      el('summary', { text: `Budget Decisions (${items.length}; degraded ${degraded.length})` }),
      items.length
        ? el('div', {
            class: 'stack',
            children: items.slice(0, 20).map((item) =>
              el('div', {
                class: 'evidence-row',
                children: [
                  el('span', { children: [pill(item.mode ?? 'unknown', item.degradedFrom ? 'warn' : 'muted'), document.createTextNode(` ${item.ref}`)] }),
                  el('small', { text: `pack=${shortId(item.contextPackId)} · score=${item.score ?? 'n/a'}` }),
                  item.degradedFrom ? el('small', { class: 'warn', text: `${item.degradedFrom} → ${item.mode ?? 'n/a'}: ${item.degradationReason ?? 'budget degradation'}` }) : null,
                ],
              }),
            ),
          })
        : el('p', { class: 'muted compact', text: 'No budget decisions recorded yet.' }),
    ],
  });
}

function renderContextRequestHistory(requests: ContextGovernanceDto['contextRequests']): HTMLElement {
  return el('details', {
    class: 'raw-details',
    children: [
      el('summary', { text: `Context Request History (${requests.length})` }),
      requests.length
        ? el('div', {
            class: 'stack',
            children: requests.map((request) =>
              el('article', {
                class: 'evidence-row',
                children: [
                  el('span', { children: [pill(request.status, statusKind(request.status)), document.createTextNode(` ${request.id}`)] }),
                  el('small', { text: `priority=${request.priority ?? 'n/a'} · source=${request.sourceName ?? 'unknown'} · ${fmtTime(request.createdAt)}` }),
                  el('small', { text: request.reason || '(no reason)' }),
                  request.requestedRefs.length ? el('small', { text: `requestedRefs: ${request.requestedRefs.join(' · ')}` }) : null,
                  request.questions.length ? el('small', { text: `questions: ${request.questions.join(' | ')}` }) : null,
                  el('small', { text: `supplement: ${request.baseContextPackId ?? '(none)'} → ${request.supplementContextPackId ?? '(none)'}` }),
                ],
              }),
            ),
          })
        : el('p', { class: 'muted compact', text: 'No structured context_request actions recorded.' }),
    ],
  });
}

function renderContextSourceRefs(refs: ContextGovernanceDto['sourceRefs']): HTMLElement {
  return el('details', {
    class: 'raw-details',
    children: [
      el('summary', { text: `SourceRefs (${refs.length})` }),
      refs.length
        ? el('div', {
            class: 'stack',
            children: refs.slice(0, 30).map((ref) =>
              el('div', {
                class: 'evidence-row',
                children: [
                  el('code', { text: ref.sourceRef }),
                  el('small', { text: `trust=${ref.trustLevels.join(', ')} · class=${ref.knowledgeClasses.join(', ')}` }),
                  el('small', { text: `manifestRefs=${ref.manifestRefs.join(', ')}` }),
                ],
              }),
            ),
          })
        : el('p', { class: 'muted compact', text: 'No sourceRefs recorded yet.' }),
    ],
  });
}

function trustKind(trustLevel: string | null): StatusKind {
  if (trustLevel === 'source' || trustLevel === 'accepted_knowledge') return 'good';
  if (trustLevel === 'summary') return 'info';
  if (trustLevel === 'inference') return 'warn';
  return 'muted';
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
    const start = button(ui.runnerStartInFlight ? '正在启动…' : '启动本地 Runner', 'button primary');
    start.disabled = ui.runnerStartInFlight || Boolean(data.runnerControl?.running);
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
      el('p', { text: `当前正在 ${STAGE_LABELS[projection.currentStage]}。需要你确认时，操作按钮会出现在这里。` }),
      detail.approvals.length
        ? el('div', { class: 'stack', children: detail.approvals.map(renderApprovalRow) })
        : el('p', { class: 'muted compact', text: '当前无需人工确认。' }),
    ],
  });
}

function renderRunnerControlPanel(): HTMLElement {
  const control = data.runnerControl;
  const latest = control?.latestHeartbeat ?? latestRunner();
  const start = button(ui.runnerStartInFlight ? '正在启动…' : control?.running ? 'Runner 已自动运行' : '启动 Runner', control?.running ? 'button secondary small' : 'button primary small');
  start.disabled = ui.runnerStartInFlight || Boolean(control?.running);
  start.onclick = () => void ensureRunnerStarted();
  return el('section', {
    class: 'panel side-panel runner-control-panel',
    children: [
      panelHeader('运行环境', '正常时无需处理，排查时展开查看。'),
      el('details', {
        class: 'raw-details diagnostic-shell',
        attrs: { 'data-details-key': 'runner-control' },
        children: [
          el('summary', {
            children: [
              el('span', { text: '查看 Runner 状态' }),
              control?.running ? pill('运行中', 'good') : pill('未运行', 'warn'),
            ],
          }),
          field('状态', control?.running ? el('span', { children: [pill('running', 'good'), document.createTextNode(` pid=${control.pid ?? '—'}`)] }) : pill('stopped', 'warn')),
          field('心跳', latest ? `${latest.status} · ${fmtTime(latest.lastSeenAt)}` : '尚未收到'),
          control?.lastExit ? field('上次退出', `code=${control.lastExit.code ?? 'null'} signal=${control.lastExit.signal ?? 'null'} · ${fmtTime(control.lastExit.at)}`) : null,
          el('div', { class: 'button-row', children: [start] }),
          control?.recentLogs?.length
            ? el('details', {
                class: 'raw-details',
                attrs: { 'data-details-key': 'runner-control-logs' },
                children: [
                  el('summary', { text: `Runner 控制日志 (${control.recentLogs.length})` }),
                  el('pre', { class: 'doc-preview code', text: control.recentLogs.slice(-30).join('\n') }),
                ],
              })
            : el('p', { class: 'muted compact', text: '暂无 Runner 控制日志。' }),
        ],
      }),
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

function renderRequestDebugPanel(request: WorkflowRequestDto, detailsScope: string): HTMLElement {
  return el('details', {
    class: 'raw-details',
    attrs: { 'data-details-key': `request-debug-${detailsScope}:${request.id}` },
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
      renderRequestDebugPanel(request, 'backend-panel'),
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
    class: 'panel diagnostic-panel',
    children: [
      panelHeader('技术运行详情', '排查失败、日志或产物问题时再展开。'),
      el('details', {
        class: 'raw-details diagnostic-shell',
        attrs: { 'data-details-key': `stage-backend-details:${detail.run.id}` },
        children: [
          el('summary', { text: '查看阶段后端细节' }),
          el('div', {
            class: 'stage-detail-list',
            children: projection.stages.map((stage) => renderStageBackendDetail(detail, stage)),
          }),
        ],
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
          pill(stageStateLabel(stage.state), stage.state === 'done' ? 'good' : stage.state === 'failed' ? 'bad' : stage.state === 'blocked' ? 'warn' : stage.state === 'active' ? 'info' : 'muted'),
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

// Flow-aware lifecycle subtitle: names the active flow and the user-facing
// stage count so a non-feature run (issue/refactor/fastforward) no longer
// reads as the 7-stage feature pipeline. Driven by `projection.flowId` /
// `visibleStages` (resolved from `run.flowId` in buildRunProjection).
function lifecycleSubtitle(projection: ReturnType<typeof buildRunProjection>): string {
  const total = projection.visibleStages.length;
  const flowLabel = FLOW_LABELS[projection.flowId] ?? projection.flowId;
  return `${flowLabel} · ${total} 个用户阶段`;
}

function renderLifecycle(detail: RunDetail, projection: ReturnType<typeof buildRunProjection>): HTMLElement {
  return el('section', {
    class: 'panel',
    children: [
      panelHeader('任务进度', lifecycleSubtitle(projection)),
      el('div', {
        class: 'stage-board',
        children: projection.visibleStages.map((stage, index) => {
          return el('article', {
            class: `stage-card ${stage.state}`,
            children: [
              el('span', { class: 'stage-index', text: String(index + 1).padStart(2, '0') }),
              el('strong', { text: stage.label }),
              el('small', { text: stageCardHint(stage.state) }),
              el('span', { class: `stage-state ${stage.state}`, text: stageStateLabel(stage.state) }),
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
      gate ? renderRuleList('需求质量检查', gate) : el('p', { class: 'muted compact', text: '需求质量检查尚未运行。' }),
      gate?.status === 'fail' ? renderStageRetryActions(detail.run.id, 'requirement', 'requirement_gate') : null,
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
      gate ? renderRuleList('方案质量检查', gate) : el('p', { class: 'muted compact', text: '方案质量检查尚未运行。' }),
      gate?.status === 'fail' ? renderStageRetryActions(detail.run.id, 'design', 'design_gate') : null,
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
              el('div', {
                class: 'mini-row',
                children: [
                  el('span', { text: `${ruleLabel(rule.ruleId)}`, attrs: { title: rule.ruleId } }),
                  pill(rule.status),
                ],
              }),
            ),
          })
        : el('p', { class: 'muted compact', text: '无规则详情。' }),
    ],
  });
}

const RULE_LABELS: Record<string, string> = {
  'design.doc_present': '设计文档存在',
  'design.requirement_coverage_present': '需求覆盖矩阵',
  'design.test_strategy_present': '测试策略',
  'design.risks_present': '风险记录',
  'design.context_grounding_present': '上下文引用',
  'design.dsn_id_present': 'DSN 编号',
  'design.current_state_section_present': '现状章节',
  'design.changes_section_present': '变化章节',
  'design.mount_points_count_in_range': '挂载点数量 (3-5)',
  'design.rollout_section_present': '推进策略章节',
  'requirement.doc_present': '需求文档存在',
  'requirement.pitch_present': 'Pitch 摘要',
  'requirement.four_sections_present': '四段式结构',
  'requirement.user_stories_min_2': '用户故事 ≥2',
  'requirement.boundary_present': '边界说明',
};

function ruleLabel(ruleId: string): string {
  const cn = RULE_LABELS[ruleId];
  return cn ? `${cn} (${ruleId})` : ruleId;
}

const retryInFlight = new Set<string>();

function renderStageRetryActions(workflowRunId: string, stage: string, gateId: string): HTMLElement {
  const retryKey = `${workflowRunId}:${stage}`;
  const reEvalKey = `${workflowRunId}:${gateId}:re-eval`;
  const isRetrying = retryInFlight.has(retryKey);
  const isReEvaluating = retryInFlight.has(reEvalKey);

  const retryBtn = button(isRetrying ? '正在重试…' : '重试该阶段', 'button primary small');
  retryBtn.disabled = isRetrying || isReEvaluating;
  retryBtn.onclick = async () => {
    retryInFlight.add(retryKey);
    render();
    try {
      await api(`/workflow-runs/${encodeURIComponent(workflowRunId)}/retry-step`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage, actor: 'web' }),
      });
      // Trigger the runner to pick up the retry.
      await api('/runner/control/retry-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflowRunId, stage }),
      }).catch(() => {
        // Runner control may not be available; the step is still reset
        // and a manual runner start will pick it up.
      });
      await loadRunDetail(workflowRunId, false);
      await loadData({ render: false, keepDetail: true });
    } catch (err) {
      ui.lastError = errorMessage(err);
    } finally {
      retryInFlight.delete(retryKey);
      render();
    }
  };

  const reEvalBtn = button(isReEvaluating ? '正在评估…' : '仅重新评估 Gate', 'button secondary small');
  reEvalBtn.disabled = isRetrying || isReEvaluating;
  reEvalBtn.onclick = async () => {
    retryInFlight.add(reEvalKey);
    render();
    try {
      await api(`/workflow-runs/${encodeURIComponent(workflowRunId)}/re-evaluate-gate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gateId, actor: 'web' }),
      });
      await loadRunDetail(workflowRunId, false);
      await loadData({ render: false, keepDetail: true });
    } catch (err) {
      ui.lastError = errorMessage(err);
    } finally {
      retryInFlight.delete(reEvalKey);
      render();
    }
  };

  return el('div', {
    class: 'stage-retry-actions',
    children: [
      el('p', { class: 'muted compact', text: '该阶段未通过质量门禁，可以重试或重新评估。' }),
      el('div', { class: 'button-row', children: [retryBtn, reEvalBtn] }),
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
  const items = knowledgeSuggestionItems(detail, suggestions);
  return el('article', {
    class: 'panel doc-panel structured-panel',
    children: [
      panelHeader('知识沉淀候选', '候选经验，人工接受后才入库'),
      items.length
        ? el('div', { class: 'stack', children: items.map((item) => renderKnowledgeSuggestion(item, detail)) })
        : el('p', { class: 'muted', text: '当前任务还没有可沉淀的知识建议。' }),
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
    const copy = reviewGateCopy('sensitive_change_gate', currentStage);
    const inFlight = approvalInFlight.has(`${detail.run.id}:sensitive_change_gate`);
    const approveBtn = button(inFlight ? '提交中...' : copy.approveLabel, 'button primary');
    const rejectBtn = button(inFlight ? '提交中...' : copy.rejectLabel, 'button danger');
    approveBtn.disabled = inFlight;
    rejectBtn.disabled = inFlight;
    approveBtn.onclick = () => void submitApproval(detail.run.id, 'sensitive_change_gate', true);
    rejectBtn.onclick = () => {
      void (async () => {
        const reason = await promptRejectReason({
          title: copy.rejectTitle,
          placeholder: copy.rejectPlaceholder,
          submitLabel: '提交并打回',
        });
        if (reason === null) return;
        await submitApproval(detail.run.id, 'sensitive_change_gate', false, reason);
      })();
    };
    return el('section', {
      class: 'panel side-panel checkpoint',
      children: [
        panelHeader('等待你确认', copy.subtitle),
        el('p', { text: copy.description }),
        renderRuleList('敏感变更检查', sensitiveWarn),
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

  const submittedApproval = pendingGate ? latestApprovalForGate(detail, pendingGate) : null;
  if (pendingGate && submittedApproval) {
    return renderSubmittedApprovalPanel(detail, pendingGate, currentStage, submittedApproval);
  }

  const isAcceptance = pendingGate === 'acceptance_gate';
  const copy = reviewGateCopy(pendingGate, currentStage);
  const inFlight = approvalInFlight.has(`${detail.run.id}:${pendingGate}`);
  const approveBtn = button(inFlight ? '提交中...' : copy.approveLabel, 'button primary');
  const rejectBtn = button(inFlight ? '提交中...' : copy.rejectLabel, 'button danger');
  approveBtn.disabled = inFlight;
  rejectBtn.disabled = inFlight;
  approveBtn.onclick = () =>
    void (isAcceptance
      ? submitAcceptanceDecision(detail.run.id, 'accept_risk')
      : submitApproval(detail.run.id, pendingGate, true));
  rejectBtn.onclick = () => {
    void (async () => {
      const reason = await promptRejectReason({
        title: copy.rejectTitle,
        placeholder: copy.rejectPlaceholder,
        submitLabel: isAcceptance ? '提交并拒绝验收' : '提交并打回',
      });
      if (reason === null) return;
      if (isAcceptance) {
        await submitAcceptanceDecision(detail.run.id, 'reject', reason);
      } else {
        await submitApproval(detail.run.id, pendingGate, false, reason);
      }
    })();
  };

  return el('section', {
    class: 'panel side-panel checkpoint',
    children: [
      panelHeader('等待你确认', copy.subtitle),
      el('p', { text: copy.description }),
      el('div', { class: 'button-row', children: [approveBtn, rejectBtn] }),
    ],
  });
}

function latestApprovalForGate(detail: RunDetail, gateId: string): RunDetail['approvals'][number] | null {
  const latestAutomatedGate = [...detail.gates]
    .reverse()
    .find((gate) => gate.gateId === gateId && gate.ruleResults.every((rule) => rule.ruleId !== 'manual.human_decision'));
  const approvals = detail.approvals.filter((approval) => approval.gateId === gateId);
  const currentCycleApprovals = latestAutomatedGate
    ? approvals.filter((approval) => approval.decidedAt >= latestAutomatedGate.decidedAt)
    : approvals;
  return currentCycleApprovals.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)).at(-1) ?? null;
}

function renderSubmittedApprovalPanel(
  detail: RunDetail,
  gateId: string,
  currentStage: Stage,
  approval: RunDetail['approvals'][number],
): HTMLElement {
  const approved = approval.decision === 'approved';
  const copy = reviewGateCopy(gateId, currentStage);
  return el('section', {
    class: `panel side-panel checkpoint ${approved ? 'approval-submitted' : 'approval-rejected'}`,
    children: [
      panelHeader(approved ? '已批准，等待继续' : '已打回，等待修订', copy.subtitle),
      el('p', {
        text: approved
          ? '已记录你的批准。Runner 会读取该决定并继续进入下一阶段。'
          : '已记录你的打回意见。Runner 会读取反馈并等待修订。',
      }),
      renderApprovalRow(approval),
      detail.run.status === 'awaiting_human'
        ? el('p', { class: 'muted compact', text: '如果状态没有立即变化，请等待下一次 Runner 心跳刷新。' })
        : null,
    ],
  });
}

function renderApprovalRow(approval: { gateId: string; decision: string; actor: string; decidedAt: string }): HTMLElement {
  return el('div', {
    class: 'approval-row',
    children: [
      el('span', { children: [pill(approval.decision), document.createTextNode(` ${gateDisplayLabel(approval.gateId)}`)] }),
      el('small', { text: `${approval.actor} · ${fmtTime(approval.decidedAt)}` }),
    ],
  });
}

function renderEvidencePanel(detail: RunDetail): HTMLElement {
  return el('section', {
    class: 'panel side-panel evidence-panel',
    children: [
      panelHeader('技术证据', '排查或审计时展开。'),
      el('details', {
        class: 'raw-details diagnostic-shell',
        attrs: { 'data-details-key': `evidence-panel:${detail.run.id}` },
        children: [
          el('summary', { text: '查看 Gate、命令、产物和 Agent 记录' }),
          renderDetails('Gate Runs', detail.gates.map(renderGateRow), `evidence-gates:${detail.run.id}`),
          renderDetails('Command Runs', detail.commands.map(renderCommandRow), `evidence-commands:${detail.run.id}`),
          renderDetails('Artifacts', detail.artifacts.map((artifact) => renderArtifactRow(artifact, 'evidence')), `evidence-artifacts:${detail.run.id}`),
          renderDetails('Agent Audit', detail.agentTasks.map((task) => renderAgentTaskRow(task, detail)), `evidence-agent-audit:${detail.run.id}`),
        ],
      }),
    ],
  });
}

function renderDetails(title: string, children: HTMLElement[], detailsKey?: string): HTMLElement {
  const details = el('details', { class: 'evidence-group', attrs: detailsKey ? { 'data-details-key': detailsKey } : undefined });
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
  const logs = commandLogs.get(command.id);
  return el('div', {
    class: 'evidence-row',
    children: [
      el('span', { children: [pill(command.status), document.createTextNode(` exit=${command.exitCode ?? '∅'}`)] }),
      el('code', { text: command.command }),
      command.combinedSha256 ? el('small', { text: `sha256 ${shortDigest(command.combinedSha256)}` }) : el('small', { text: 'sha256 pending/legacy evidence' }),
      logs
        ? el('small', { text: `stdout ${digestStatusText(logs.stdout.digest)} · stderr ${digestStatusText(logs.stderr.digest)}` })
        : null,
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
      artifact.sha256 ? el('small', { text: `sha256 ${shortDigest(artifact.sha256)}` }) : el('small', { text: 'sha256 pending/legacy evidence' }),
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
          pill(digestStatusText(content.digest), content.digest.verified === false ? 'bad' : content.digest.verified === true ? 'good' : 'muted'),
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

function shortDigest(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}

function digestStatusText(digest: DigestVerificationDto): string {
  if (digest.verified === true) return 'sha256 verified';
  if (digest.verified === false) return 'sha256 mismatch';
  return 'sha256 untracked';
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
  const view = buildAgentStreamViewForRun(runId);
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
      el('details', {
        class: 'raw-details stream-log-details',
        attrs: { 'data-details-key': `agent-stream:${view.runId ?? 'none'}` },
        children: [
          el('summary', { text: '查看执行日志' }),
          renderAgentStreamBody(view, { id: 'stream-body', scrollKeyPrefix: 'agent-stream' }),
        ],
      }),
    ],
  });
}

function renderExpandedAgentStreamOverlay(runId: string): HTMLElement {
  const view = buildAgentStreamViewForRun(runId);
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

/**
 * Prompts the user for a rejection reason via a modal dialog.
 *
 * Resolves with the trimmed non-empty reason on submit, or `null` on cancel
 * (close button, ESC, or backdrop click). The Promise stays pending until
 * the user submits or cancels — there is no timeout.
 *
 * Mounts the overlay directly under `document.body`, outside the main render
 * tree, so a re-render driven by `render()` cannot wipe the modal mid-flow.
 */
function promptRejectReason(opts: {
  title: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const titleId = `reject-modal-title-${Math.random().toString(16).slice(2, 8)}`;

    const settle = (value: string | null): void => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', handleKey);
      overlay.remove();
      resolve(value);
    };

    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(null);
        return;
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        const trimmed = textarea.value.trim();
        if (trimmed.length > 0) {
          event.preventDefault();
          settle(trimmed);
        }
      }
    };

    const textarea = el('textarea', {
      class: 'reject-textarea',
      attrs: {
        placeholder: opts.placeholder ?? '请说明拒绝的具体原因…',
        maxlength: '2000',
        rows: '6',
        'aria-label': opts.title,
      },
    });

    const cancelBtn = button(opts.cancelLabel ?? '取消', 'button secondary');
    cancelBtn.onclick = () => settle(null);

    const submitBtn = button(opts.submitLabel ?? '提交并打回', 'button danger');
    submitBtn.disabled = true;
    submitBtn.onclick = () => {
      const trimmed = textarea.value.trim();
      if (trimmed.length === 0) return;
      settle(trimmed);
    };

    textarea.addEventListener('input', () => {
      submitBtn.disabled = textarea.value.trim().length === 0;
    });

    const closeBtn = button('×', 'button secondary small');
    closeBtn.setAttribute('aria-label', '关闭并取消');
    closeBtn.onclick = () => settle(null);

    const overlay = el('div', {
      class: 'stream-overlay reject-overlay',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      children: [
        el('section', {
          class: 'stream-modal reject-modal',
          children: [
            el('div', {
              class: 'stream-head stream-modal-head',
              children: [
                el('h2', { id: titleId, class: 'stream-title', text: opts.title }),
                closeBtn,
              ],
            }),
            textarea,
            el('div', {
              class: 'button-row',
              children: [cancelBtn, submitBtn],
            }),
          ],
        }),
      ],
    });

    overlay.onclick = (event) => {
      if (event.target === overlay) settle(null);
    };

    document.addEventListener('keydown', handleKey);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => textarea.focus());
  });
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
  const actionState = projectFormActionState();
  form.append(
    panelHeader(isEditing ? '编辑项目' : '接入项目', isEditing ? '修改来源、默认分支或 AI 执行方式后，建议重新检测再保存。' : '按步骤连接项目，检测通过后即可用于新任务。'),
    renderProjectOnboardingStep(1, '选择来源', '告诉系统项目从哪里来。', [
      el('label', { class: 'input-block', children: [el('span', { text: '项目来源' }), sourceSelect] }),
      ...renderProjectSourceDynamicFields(),
    ]),
    renderProjectOnboardingStep(2, '设置默认项', '确认项目名称和默认工作分支。', renderProjectDefaultsFields()),
    renderProjectOnboardingStep(3, '配置 AI 执行方式', '后续任务会默认使用这里选择的工具。', [renderAgentBackendConfigFields()]),
    renderProjectDetectPanel(),
  );

  const detect = el('button', { class: 'button secondary', text: projectSourceForm.detecting ? '检测中…' : '检测项目连接', attrs: { type: 'button' } });
  detect.disabled = projectSourceForm.detecting;
  detect.onclick = () => void detectProjectSource();
  const submit = el('button', { class: 'button primary', text: actionState.submitLabel, attrs: { type: 'submit' } });
  submit.disabled = !actionState.canSubmit;
  const cancelEdit = isEditing ? el('button', { class: 'button ghost', text: '取消编辑', attrs: { type: 'button' } }) : null;
  if (cancelEdit) cancelEdit.onclick = () => { resetProjectSourceForm(); render(); };
  form.append(
    el('div', { class: 'project-form-actions', children: [detect, submit, cancelEdit] }),
    el('p', { class: `compact project-submit-hint ${actionState.blocker ? 'warn' : 'good'}`, text: actionState.blocker ?? '检测已通过，可以接入并用于新任务。' }),
  );
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

function renderProjectOnboardingStep(index: number, title: string, description: string, children: Array<Node | null>): HTMLElement {
  return el('section', {
    class: 'project-onboarding-step',
    children: [
      el('div', {
        class: 'project-step-header',
        children: [
          el('span', { class: 'project-step-index', text: String(index) }),
          el('div', { children: [el('h3', { text: title }), el('p', { text: description })] }),
        ],
      }),
      el('div', { class: 'project-step-body', children }),
    ],
  });
}

function renderProjectDefaultsFields(): HTMLElement[] {
  return [
    controlledInput('项目名称', 'name', '检测通过后自动填充，也可手动修改', projectSourceForm.name, (v) => {
      projectSourceForm.name = v;
    }),
    renderBranchControl(),
  ];
}

function projectFormActionState(): { submitLabel: string; blocker: string | null; canSubmit: boolean } {
  const sourceValue = projectSourceForm.sourceValue.trim();
  if (projectSourceForm.detecting) {
    return { submitLabel: '等待检测完成', blocker: '正在检测项目连接，请稍候。', canSubmit: false };
  }
  if (!sourceValue) {
    return { submitLabel: '填写项目来源', blocker: '先填写仓库地址或本地路径。', canSubmit: false };
  }
  const result = projectSourceForm.detectResult;
  if (!result) {
    return { submitLabel: '先检测项目', blocker: '检测通过后才能接入项目。', canSubmit: false };
  }
  if (!result.ok) {
    return { submitLabel: '重新检测项目', blocker: '检测失败，请修改来源或访问方式后重新检测。', canSubmit: false };
  }
  if (!(projectSourceForm.name.trim() || result.projectName.trim())) {
    return { submitLabel: '填写项目名称', blocker: '请填写一个便于识别的项目名称。', canSubmit: false };
  }
  if (!projectSourceForm.agentBackend) {
    return { submitLabel: '选择执行方式', blocker: '请选择 Claude Code 或 Codex 作为这个项目的 AI 执行方式。', canSubmit: false };
  }
  return {
    submitLabel: projectSourceForm.editingProjectId ? '保存修改' : '接入这个项目',
    blocker: null,
    canSubmit: true,
  };
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
  const fields: HTMLElement[] = [];

  if (sourceKind === 'local') {
    fields.push(
      renderLocalPathPickerField(),
      el('p', { class: 'muted compact', text: '本地项目不需要 Token；检测会确认该路径是 Git 仓库并读取本地分支。' }),
    );
    if (localDirectoryPicker.open) fields.push(renderLocalDirectoryPicker());
    return fields;
  }

  fields.push(
    controlledInput(sourceUrlLabel(sourceKind), 'sourceValue', sourceUrlPlaceholder(sourceKind), projectSourceForm.sourceValue, (v) => {
      projectSourceForm.sourceValue = v;
      projectSourceForm.detectResult = null;
    }),
    renderAuthFields(sourceKind),
  );
  return fields;
}

function renderAgentBackendConfigFields(): HTMLElement {
  const select = el('select', { attrs: { name: 'agentBackend' } });
  select.appendChild(el('option', { text: '请选择 AI 执行方式', attrs: { value: '' } }));
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
    class: 'runner-card project-agent-card',
    children: [
      panelHeader('AI 执行方式', '项目级默认；只能选择 Claude Code 或 Codex。'),
      el('label', { class: 'input-block', children: [el('span', { text: '执行工具' }), select] }),
      matchingCheck ? renderAgentBackendCheck(matchingCheck) : el('p', { class: 'muted compact', text: '检测会确认本机 CLI 可用；创建任务时也会自动检查。' }),
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
      el('span', { text: '本地路径' }),
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
    children: [panelHeader('选择本地文件夹', '浏览 API/runner 所在机器上的目录，选中后会填入本地路径。'), ...rows],
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
    localDirectoryPicker.error = errorMessage(err);
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
  if (sourceKind === 'github') return 'GitHub 仓库';
  if (sourceKind === 'gitee') return 'Gitee 仓库';
  if (sourceKind === 'gitlab') return 'GitLab 仓库地址';
  return '仓库地址';
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
    el('label', { class: 'input-block', children: [el('span', { text: '访问方式' }), authSelect] }),
  ];

  if (projectSourceForm.sourceAuthKind === 'token') {
    children.push(
      controlledInput('访问令牌', 'sourceCredential', 'Personal Access Token / Access Token', projectSourceForm.sourceCredential, (v) => {
        projectSourceForm.sourceCredential = v;
        projectSourceForm.detectResult = null;
      }, 'password'),
    );
  }
  if (projectSourceForm.sourceAuthKind === 'basic') {
    children.push(
      controlledInput('用户名', 'sourceUsername', '用于 HTTPS Basic Auth 的用户名', projectSourceForm.sourceUsername, (v) => {
        projectSourceForm.sourceUsername = v;
        projectSourceForm.detectResult = null;
      }),
      controlledInput('密码', 'sourceCredential', '密码或应用专用密码', projectSourceForm.sourceCredential, (v) => {
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
    return el('label', { class: 'input-block', children: [el('span', { text: '默认分支' }), select] });
  }
  return controlledInput('默认分支', 'defaultBranch', 'main', projectSourceForm.defaultBranch, (v) => {
    projectSourceForm.defaultBranch = v || 'main';
  });
}

function renderProjectDetectPanel(): HTMLElement {
  const result = projectSourceForm.detectResult;
  if (projectSourceForm.detecting) {
    return renderProjectDetectState('正在检测项目连接', '正在确认项目是否可访问，并读取默认分支。', 'info');
  }
  if (!result) {
    return renderProjectDetectState('先检测项目连接', '检测会确认来源、访问方式和默认分支。', 'muted');
  }
  if (!result.ok) {
    return renderProjectDetectState('检测失败', '请修改项目来源或访问方式后重新检测。', 'bad', [
      field('错误', result.error),
    ]);
  }
  return renderProjectDetectState('检测通过，可以接入', '确认这些信息后即可保存为可用项目。', 'good', [
      field('项目名', result.projectName),
      field('默认分支', result.defaultBranch),
      field('可用分支', result.branches.length ? `${result.branches.length} 个` : '未返回分支列表'),
  ]);
}

function renderProjectDetectState(title: string, message: string, kind: StatusKind, details: HTMLElement[] = []): HTMLElement {
  return el('article', {
    class: `project-detect-card ${kind}`,
    children: [
      el('div', {
        class: 'project-detect-head',
        children: [
          pill(title, kind),
          el('p', { class: 'compact', text: message }),
        ],
      }),
      ...details,
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
      el('summary', { text: '最近项目画像预览' }),
      el('p', { class: 'muted compact', text: '用于排查项目画像生成结果；不影响当前项目接入配置。' }),
      text
        ? el('pre', { class: 'doc-preview', text: previewText(text) })
        : el('p', { class: 'muted compact', text: '当前没有可预览的项目画像。' }),
    ],
  });
}

function renderToolchainReadiness(): HTMLElement {
  const runner = latestRunner();
  return el('details', {
    class: 'raw-details project-diagnostics-details',
    children: [
      el('summary', { text: '本地执行环境诊断' }),
      el('article', {
        class: 'runner-card',
        children: [
          panelHeader('执行器状态', runner ? `${runner.status} · ${fmtTime(runner.lastSeenAt)}` : '尚未连接'),
          field('JDK', runner?.jdkVersion ?? '—'),
          field('Maven', runner?.mavenVersion?.split('\n')[0] ?? '—'),
          field('Git', runner?.gitVersion ?? '—'),
          el('code', { class: 'command-chip', text: 'bun run runner -- doctor && bun run runner -- watch' }),
        ],
      }),
    ],
  });
}

function renderAgentBackendCheck(check: AgentBackendPreflightDto): HTMLElement {
  return el('div', {
    class: 'agent-backend-check',
    children: [
      field('状态', pill(preflightStatusLabel(check), preflightStatusKind(check))),
      field('命令行工具', check.bin ?? '—'),
      field('版本', check.version ?? '—'),
      check.error ? field('错误', check.error) : null,
      field('修复提示', check.remediationHint),
    ],
  });
}

function preflightStatusLabel(check: AgentBackendPreflightDto): string {
  if (check.runnable) return '已连接';
  if (check.status === 'not_configured') return '待配置';
  if (check.status === 'missing_cli') return '缺少 CLI';
  if (check.status === 'needs_login') return '需要登录';
  return '检测失败';
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
    ui.lastError = result.runnable ? null : `${result.label}: ${result.remediationHint}${result.error ? ` (${result.error})` : ''}`;
    return result;
  } catch (err) {
    ui.lastError = errorMessage(err);
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
  const availability = projectAvailability(project);
  const backendLabel = project.agentBackend
    ? `${agentBackendDisplayName(project.agentBackend)} · ${backendStatusText(backendStatus.label)}`
    : `未配置 · ${backendStatusText(backendStatus.label)}`;
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
    text: agentBackendPreflightInFlight.has(project.id) ? '检测中…' : '检测连接',
    attrs: { type: 'button' },
  });
  backendCheck.disabled = !project.agentBackend || agentBackendPreflightInFlight.has(project.id);
  backendCheck.onclick = (event) => {
    event.stopPropagation();
    void checkAgentBackend(project.agentBackend ?? null, project.id);
  };

  const sourceValue = project.sourceUrl ?? project.localPath;
  const details = el('details', {
    class: 'project-card-details',
    children: [
      el('summary', { text: '连接详情' }),
      el('div', {
        class: 'project-card-detail-list',
        children: [
          field('访问方式', authSummary(project)),
          field(sourceKind === 'local' ? '本地路径' : '仓库地址', el('code', { class: 'project-detail-code', text: sourceValue })),
          sourceKind !== 'local' ? field('托管路径', el('code', { class: 'project-detail-code', text: project.localPath })) : null,
          field('接入时间', fmtTime(project.registeredAt)),
          status === 'archived' ? field('归档时间', fmtTime(project.archivedAt)) : null,
        ],
      }),
    ],
  });
  details.onclick = (event) => event.stopPropagation();
  details.onkeydown = (event) => event.stopPropagation();

  const card = el('article', {
    class: `project-card ${projectSourceForm.editingProjectId === project.id ? 'active' : ''}`,
    attrs: { role: 'button', tabindex: '0', title: '点击回填到左侧编辑' },
    children: [
      el('div', {
        class: 'project-card-main',
        children: [
          el('div', {
            class: 'project-card-head',
            children: [el('strong', { text: project.name }), pill(availability.label, availability.kind)],
          }),
          el('div', {
            class: 'project-summary-grid',
            children: [
              projectSummaryItem('来源', sourceKindLabel(sourceKind)),
              projectSummaryItem('默认分支', project.defaultBranch),
              projectSummaryItem('AI 执行方式', el('span', { class: backendStatus.kind, text: backendLabel })),
              projectSummaryItem('接入状态', pill(availability.label, availability.kind)),
            ],
          }),
        ],
      }),
      details,
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
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('button, details, summary')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      editProject(project);
    }
  };
  return card;
}

function projectSummaryItem(label: string, value: Node | string): HTMLElement {
  const valueNode = typeof value === 'string' ? el('strong', { text: value }) : value;
  return el('div', {
    class: 'project-summary-item',
    children: [el('span', { text: label }), valueNode],
  });
}

async function deleteOrArchiveProject(project: ProjectDto): Promise<void> {
  projectActionInFlight.add(project.id);
  render();
  try {
    const preview = await api<ProjectDeletePreviewDto>(`/projects/${encodeURIComponent(project.id)}/delete-preview`);
    if (preview.recommendation === 'blocked_active_work') {
      ui.lastError = `项目 ${project.name} 还有运行中任务/请求（requests=${preview.activeRequests}, runs=${preview.activeRuns}），不能删除或归档。`;
      return;
    }
    if (preview.canHardDelete) {
      if (!window.confirm(`项目 ${project.name} 没有任何任务历史。确认永久删除项目配置和凭据？`)) return;
      await api<{ ok: boolean }>(`/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      if (projectSourceForm.editingProjectId === project.id) resetProjectSourceForm();
      ui.lastError = null;
      await loadData({ render: false });
      return;
    }
    if (preview.canArchive) {
      if (!window.confirm(`项目 ${project.name} 已有历史任务，将归档而不是物理删除。归档后不能再创建新需求/bug，历史仍保留。确认归档？`)) return;
      await api<ProjectDto>(`/projects/${encodeURIComponent(project.id)}/archive`, { method: 'POST' });
      if (projectSourceForm.editingProjectId === project.id) resetProjectSourceForm();
      ui.lastError = null;
      await loadData({ render: false });
      return;
    }
    ui.lastError = `项目 ${project.name} 当前不能删除：${preview.recommendation}`;
  } catch (err) {
    ui.lastError = errorMessage(err);
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
      ui.lastError = `刷新项目分支失败：${result.error}`;
      return;
    }
    const project = data.projects.find((p) => p.id === projectId);
    if (project) {
      project.defaultBranch = result.defaultBranch || project.defaultBranch;
      project.sourceBranches = normalizeBranchList(project.defaultBranch, result.branches);
    }
    ui.lastError = null;
  } catch (err) {
    ui.lastError = errorMessage(err);
  } finally {
    projectBranchRefreshInFlight.delete(projectId);
    onUpdated?.();
  }
}

async function ensureRunnerStarted(): Promise<void> {
  if (ui.runnerStartInFlight) return;
  ui.runnerStartInFlight = true;
  render();
  try {
    data.runnerControl = await api<RunnerControlStatusDto>('/runner/control/start', { method: 'POST' });
    ui.lastError = null;
    await loadData({ render: false, keepDetail: true });
  } catch (err) {
    ui.lastError =
      err instanceof Error
        ? `${err.message}。可以临时在命令行执行 bun run runner -- watch 作为兜底。`
        : String(err);
  } finally {
    ui.runnerStartInFlight = false;
    render();
  }
}

function maybeAutoStartRunnerForActiveTask(): void {
  const request = activeTaskRequest();
  if (!request || !['pending', 'claimed'].includes(request.status)) return;
  const project = data.projects.find((p) => p.id === request.projectId);
  if (!project?.agentBackend) return;
  if (data.runnerControl?.running || ui.runnerStartInFlight) return;
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
  ui.lastError = null;
  render();
}

function authSummary(project: ProjectDto): string {
  const authKind = project.sourceAuthKind ?? 'none';
  if (authKind === 'none') return '无 / Git credential helper';
  if (authKind === 'ssh') return 'SSH Key';
  if (authKind === 'token') return project.hasSourceCredential ? 'Token 已保存' : 'Token 未保存';
  return project.hasSourceCredential ? `用户名密码（${project.sourceUsername ?? 'user'}）` : '用户名密码未保存';
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
      ui.lastError = null;
    }
  } catch (err) {
    projectSourceForm.detectResult = { ok: false, error: errorMessage(err) };
  } finally {
    projectSourceForm.detecting = false;
    render();
  }
}

async function submitProject(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!projectSourceForm.detectResult?.ok) {
    ui.lastError = '请先检测项目连接，确认无误后再接入。';
    render();
    return;
  }
  if (!projectSourceForm.agentBackend) {
    ui.lastError = '请选择 Claude Code 或 Codex 作为项目的 AI 执行方式。';
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
    ui.lastError = errorMessage(err);
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

function renderNewTaskProcessPanel(): HTMLElement {
  return el('aside', {
    class: 'panel new-task-guide',
    children: [
      panelHeader('创建后，AI 会', '页面会在需要你确认时停下来。'),
      el('ol', {
        class: 'ordered-list',
        children: [
          el('li', { text: '理解目标，必要时先提出澄清问题。' }),
          el('li', { text: '准备隔离工作区和任务上下文。' }),
          el('li', { text: '按阶段实现、检查并汇总证据。' }),
          el('li', { text: '把需要人工确认的节点展示给你审批。' }),
        ],
      }),
    ],
  });
}

interface InlineNoticeDiagnostics {
  summary: string;
  body: string;
  detailsKey: string;
}

function summarizeProjectLoadError(error: string): string {
  const status = error.match(/^api\s+\/projects:\s+(\d{3})\b/i)?.[1] ?? null;
  const isHtmlError = /<!doctype\s+html|<html[\s>]|<body[\s>]|<script[\s>]/i.test(error);
  if (isHtmlError) {
    return status
      ? `项目接口返回 ${status}，前端收到的是服务错误页。请确认 API 服务和代理正常后重试。`
      : '项目接口返回了服务错误页。请确认 API 服务和代理正常后重试。';
  }
  if (/failed to fetch|networkerror|load failed/i.test(error)) {
    return '无法连接项目接口。请确认 API 服务正在运行，然后重试。';
  }
  if (status) return `项目接口返回 ${status}。请确认 API 服务正常后重试。`;
  return '项目接口暂时不可用。请重试，或展开技术细节查看原始错误。';
}

function renderNewTaskInlineNotice(
  kind: StatusKind,
  title: string,
  message: string,
  actions: HTMLElement[] = [],
  diagnostics?: InlineNoticeDiagnostics,
): HTMLElement {
  return el('div', {
    class: `notice-inline ${kind}`,
    children: [
      el('strong', { text: title }),
      el('p', { class: 'compact notice-inline-message', text: message }),
      diagnostics
        ? el('details', {
            class: 'notice-inline-diagnostics',
            attrs: { 'data-details-key': diagnostics.detailsKey },
            children: [
              el('summary', { text: diagnostics.summary }),
              el('pre', { class: 'notice-inline-raw', text: diagnostics.body }),
            ],
          })
        : null,
      actions.length ? el('div', { class: 'button-row', children: actions }) : null,
    ],
  });
}

function renderNewTaskNoProjectPage(): HTMLElement {
  const refresh = button('刷新', 'button secondary');
  refresh.onclick = () => void loadData({ keepDetail: true });
  return el('section', {
    class: 'page-grid two-col',
    children: [
      el('div', {
        class: 'empty-state new-task-empty',
        children: [
          el('h2', { text: '还没有连接项目' }),
          el('p', { text: '先接入一个项目，才能创建任务并交给 AI 执行。' }),
          el('div', { class: 'button-row', children: [actionLink('连接项目', 'projects'), refresh] }),
        ],
      }),
      renderNewTaskProcessPanel(),
    ],
  });
}

function backendStatusText(label: string): string {
  if (label === 'Connected') return '已连接';
  if (label === 'Not checked') return '待检测';
  if (label === 'Needs setup') return '待配置';
  if (label === 'Needs login') return '需要登录';
  if (label === 'CLI missing') return '缺少 CLI';
  if (label === 'Check failed') return '检测失败';
  if (label === '未检测') return '未检测';
  return label;
}

function buildNewTaskFirstMessage(title: string, details: string): string {
  return details ? `目标：${title}\n\n补充说明：\n${details}` : title;
}

function renderNewTaskPage(): HTMLElement {
  const projects = activeProjects();
  if (!projects.length && !ui.projectsLoadError) return renderNewTaskNoProjectPage();

  const form = el('form', { class: 'form-card wide new-task-form' });
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

  // 05-08 new-task-form-flow-startstage-override: explicit Flow override.
  // Mirrors the FLOW_REGISTRY entries in `packages/shared/src/flows/registry.ts`
  // (FlowId union). Empty value = "(让 router 推荐)" — runner Coordinator
  // + Router still drive flow selection. Non-empty value bypasses Coordinator
  // entirely (PRD Q1 = A): runner watch derives runType from FlowDef.kind.
  const flowSelect = el('select', { attrs: { name: 'flowId' } });
  flowSelect.appendChild(el('option', { text: '(让 router 推荐)', attrs: { value: '' } }));
  for (const fid of [
    'feature.standard',
    'feature.fastforward',
    'issue.standard',
    'refactor.standard',
  ]) {
    flowSelect.appendChild(el('option', { text: fid, attrs: { value: fid } }));
  }

  // Start Stage override is only meaningful for `feature.standard`; the other
  // three flows are short and run head-to-tail per FlowDef.startStage docstring.
  // Stages mirror FLOW_REGISTRY['feature.standard'].stages 1:1.
  const startStageSelect = el('select', { attrs: { name: 'startStage' } });
  startStageSelect.appendChild(el('option', { text: '(从第一阶段开始)', attrs: { value: '' } }));
  for (const st of [
    'context_pack',
    'requirement',
    'design',
    'implementation',
    'build_test',
    'review',
    'completion',
    'knowledge',
  ]) {
    startStageSelect.appendChild(el('option', { text: st, attrs: { value: st } }));
  }
  const startStageRow = el('label', {
    class: 'input-block',
    children: [el('span', { text: '起始阶段（仅 feature.standard 可用）' }), startStageSelect],
  });
  const title = el('input', {
    attrs: {
      name: 'title',
      'data-new-task-title': 'true',
      placeholder: '例如：优化新建任务页面，让普通用户更容易创建任务',
    },
  });
  const details = el('textarea', {
    class: 'new-task-details',
    attrs: {
      name: 'details',
      rows: '5',
      'data-new-task-details': 'true',
      placeholder: '可补充验收标准、约束、参考页面或不希望改变的内容。',
    },
  });
  // Hydrate the user-owned draft fields (see state-management.md).
  title.value = newTaskFormDraft.title;
  details.value = newTaskFormDraft.details;
  if (newTaskFormDraft.type) typeSelect.value = newTaskFormDraft.type;
  if (newTaskFormDraft.flowId) flowSelect.value = newTaskFormDraft.flowId;
  if (newTaskFormDraft.startStage) startStageSelect.value = newTaskFormDraft.startStage;
  // startStageSelect is only relevant for feature.standard; toggle visibility
  // on initial render and on every flowSelect change. When hidden the select
  // also has its value cleared so a stale draft can't sneak through submit.
  const syncStartStageVisibility = (): void => {
    const visible = flowSelect.value === 'feature.standard';
    startStageRow.style.display = visible ? '' : 'none';
    if (!visible) {
      startStageSelect.value = '';
      newTaskFormDraft.startStage = '';
    }
  };
  syncStartStageVisibility();
  flowSelect.addEventListener('change', () => {
    newTaskFormDraft.flowId = flowSelect.value as typeof newTaskFormDraft.flowId;
    syncStartStageVisibility();
  });
  startStageSelect.addEventListener('change', () => {
    newTaskFormDraft.startStage = startStageSelect.value as typeof newTaskFormDraft.startStage;
  });
  if (newTaskFormDraft.projectId) {
    const hasOption = Array.from(projectSelect.options).some((o) => o.value === newTaskFormDraft.projectId);
    if (hasOption) projectSelect.value = newTaskFormDraft.projectId;
  }
  const branchSelect = el('select', { attrs: { name: 'branch' } });
  const branchRefresh = el('button', { class: 'button secondary small', text: '刷新分支', attrs: { type: 'button' } });
  const branchHint = el('p', { class: 'muted compact' });
  const backendHint = el('p', { class: 'muted compact' });
  const backendCheck = el('button', { class: 'button secondary small', text: '检测连接', attrs: { type: 'button' } });
  const backendLabel = el('strong', { text: '未选择项目' });
  const clickedBranchProjects = new Set<string>();
  const submit = el('button', { class: 'button primary', text: '创建任务', attrs: { type: 'submit' } });
  const submitHint = el('p', { class: 'compact muted' });
  const readiness = el('div', { class: 'new-task-readiness' });

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
  const recoCard = el('div', { class: 'inline-panel compact' });
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
      panelHeader('执行建议', '正在判断建议路径…'),
      el('p', {
        class: 'muted compact',
        text: userOverrideType ? '将参考你指定的任务类型。' : '仅作参考，创建时仍会按默认流程判断。',
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
          '执行建议',
          userOverrideType
            ? '使用你在高级设置里指定的任务类型'
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
      );
      if (reco.rulesFired.length) {
        children.push(el('p', { class: 'muted compact', text: `命中规则: ${reco.rulesFired.join(' / ')}` }));
      }
      recoCard.replaceChildren(...children);
    } catch (err) {
      recoCard.replaceChildren(
        panelHeader('执行建议', '暂时不可用'),
        el('p', {
          class: 'muted compact',
          text: errorMessage(err),
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
    updateSubmitState();
  });
  title.addEventListener('input', () => {
    newTaskFormDraft.title = title.value;
    updateSubmitState();
  });
  title.addEventListener('blur', () => {
    newTaskFormDraft.title = title.value;
    if (!ui.isReplacingAppRootForRender) newTaskTitleFocus = null;
  });
  details.addEventListener('input', () => {
    newTaskFormDraft.details = details.value;
  });
  details.addEventListener('blur', () => {
    newTaskFormDraft.details = details.value;
    if (!ui.isReplacingAppRootForRender) newTaskTitleFocus = null;
  });
  const updateSubmitState = () => {
    const project = projects.find((p) => p.id === projectSelect.value) ?? projects[0] ?? null;
    const preflight = preflightForProjectBackend(project);
    const runner = latestRunner();
    let blocker: string | null = null;
    if (ui.projectsLoadError) blocker = '项目列表加载失败，重试成功后才能创建任务。';
    else if (!project) blocker = '请先连接项目。';
    else if (!title.value.trim()) blocker = '请填写任务目标。';
    else if (!project.agentBackend) blocker = '请先为这个项目配置执行方式。';
    else if (preflight && !preflight.runnable) blocker = '执行方式连接检测未通过，请处理后重试。';

    submit.disabled = Boolean(blocker);
    submitHint.textContent = blocker
      ?? (runner ? '准备就绪，创建后会进入任务工作流。' : '本地执行器当前未连接，创建后会尝试自动启动；需要时可到运行配置检查。');
    submitHint.className = `compact ${blocker ? 'warn' : runner ? 'good' : 'muted'}`;
    readiness.replaceChildren(
      pill(project ? '项目已选择' : ui.projectsLoadError ? '项目加载失败' : '等待项目', project ? 'good' : ui.projectsLoadError ? 'bad' : 'warn'),
      pill(project?.agentBackend ? '执行方式已配置' : '执行方式待配置', project?.agentBackend ? 'good' : 'warn'),
      pill(runner ? '执行器在线' : '执行器待启动', runner ? statusKind(runner.status) : 'warn'),
    );
  };
  const updateBackendHint = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
    const status = agentBackendStatusForProject(project);
    backendHint.textContent = project?.agentBackend
      ? `${agentBackendDisplayName(project.agentBackend)} · ${backendStatusText(status.label)}。创建时会自动检测本机 CLI 连接。`
      : '这个项目还没有选择执行方式。请到“项目接入”编辑项目，选择 Claude Code 或 Codex。';
    backendLabel.textContent = project?.agentBackend
      ? `${agentBackendLabelForProject(project)} · ${backendStatusText(status.label)}`
      : agentBackendLabelForProject(project);
    backendHint.className = `muted compact ${status.kind}`;
    backendCheck.disabled = !project?.agentBackend || agentBackendPreflightInFlight.has(project.id);
    backendCheck.textContent = project && agentBackendPreflightInFlight.has(project.id) ? '检测中…' : '检测连接';
    updateSubmitState();
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
      ? `默认使用 ${project.defaultBranch || 'main'}；只有本次任务需要切换基础分支时才调整。`
      : '请先连接项目。';
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
  updateSubmitState();
  // 2026-05-06 router advisory defaults: Type is no longer prominent in the
  // main form. The Coordinator still decides runType, while Smart Router output
  // is preview/audit only. Power users / refactor / smoke paths open the
  // disclosure. 05-08 task added Flow + Start Stage overrides; when Flow is
  // pinned the runner skips Coordinator entirely and derives runType from
  // FlowDef.kind (PRD Q1=A). Start Stage is only meaningful for
  // `feature.standard` and is auto-hidden otherwise.
  const advanced = document.createElement('details');
  advanced.className = 'new-task-advanced';
  advanced.setAttribute('data-details-key', 'new-task-advanced');
  advanced.appendChild(el('summary', { text: '高级设置（分支、执行路径、后端诊断）' }));
  advanced.appendChild(
    el('div', {
      class: 'input-block',
      children: [
        el('span', { text: '基于哪个分支' }),
        el('div', { class: 'branch-select-row', children: [branchSelect, branchRefresh] }),
        branchHint,
      ],
    }),
  );
  advanced.appendChild(
    el('div', {
      class: 'input-block',
      children: [
        el('span', { text: '执行方式' }),
        el('div', { class: 'branch-select-row', children: [backendLabel, backendCheck] }),
        backendHint,
      ],
    }),
  );
  advanced.appendChild(
    el('label', {
      class: 'input-block',
      children: [el('span', { text: '任务类型覆盖（留空让 AI 判定）' }), typeSelect],
    }),
  );
  advanced.appendChild(
    el('label', {
      class: 'input-block',
      children: [
        el('span', { text: '执行路径覆盖（留空自动推荐）' }),
        flowSelect,
      ],
    }),
  );
  advanced.appendChild(startStageRow);
  advanced.appendChild(recoCard);

  const retryProjects = button('重试', 'button secondary small');
  retryProjects.onclick = () => void loadData({ keepDetail: true });
  const projectIssue = ui.projectsLoadError
    ? renderNewTaskInlineNotice(
        'bad',
        '项目列表加载失败',
        summarizeProjectLoadError(ui.projectsLoadError),
        [retryProjects, actionLink('检查项目接入', 'projects')],
        {
          summary: '查看技术细节',
          body: ui.projectsLoadError,
          detailsKey: 'new-task-project-load-error-details',
        },
      )
    : null;
  const submitIssue = ui.lastError && !ui.projectsLoadError
    ? renderNewTaskInlineNotice('warn', '暂时无法创建任务', ui.lastError)
    : null;
  form.append(
    panelHeader('创建任务', '只需要说明目标；工程设置默认自动处理。'),
    el('label', { class: 'input-block', children: [el('span', { text: '项目' }), projectSelect, projectIssue] }),
    el('label', { class: 'input-block', children: [el('span', { text: '任务目标' }), title] }),
    el('label', { class: 'input-block', children: [el('span', { text: '补充说明（可选）' }), details] }),
    advanced,
    readiness,
  );
  if (submitIssue) form.append(submitIssue);
  form.append(
    submitHint,
    el('div', { class: 'button-row', children: [submit, actionLink('查看工作台', 'workbench')] }),
  );
  form.onsubmit = (event) => void submitWorkflowRequest(event, form);

  return el('section', {
    class: 'page-grid two-col',
    children: [
      form,
      renderNewTaskProcessPanel(),
    ],
  });
}

async function submitWorkflowRequest(event: SubmitEvent, form: HTMLFormElement): Promise<void> {
  event.preventDefault();
  const fd = new FormData(form);
  const projectId = String(fd.get('projectId') ?? '');
  const project = data.projects.find((p) => p.id === projectId);
  const title = String(fd.get('title') ?? '').trim();
  const details = String(fd.get('details') ?? '').trim();
  try {
    if (!project) throw new Error('请选择一个已接入项目。');
    if (!title) throw new Error('请先填写任务目标。');
    const ready = await ensureProjectAgentBackendReady(project);
    if (!ready) return;
    const firstMessage = buildNewTaskFirstMessage(title, details);
    // 2026-05-06: omit `type` when user left it as "(让 AI 自动判定)" so the
    // server-side Coordinator can classify runType. Smart Router output is
    // advisory until a future request override path sends flowId/startStage.
    // 2026-05-08 (this task): plumb flowId / startStage from 高级覆盖. Empty
    // string = no override (server treats as null). When flowId is non-empty
    // the runner watch loop bypasses Coordinator + Router (PRD Q1=A).
    const typeOverride = String(fd.get('type') ?? '').trim();
    const flowOverride = String(fd.get('flowId') ?? '').trim();
    const startStageOverride = String(fd.get('startStage') ?? '').trim();
    const request = await api<WorkflowRequestDto>('/workflow-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        ...(typeOverride && { type: typeOverride }),
        ...(flowOverride && { flowId: flowOverride }),
        ...(startStageOverride && { startStage: startStageOverride }),
        title,
        branch: String(fd.get('branch') ?? '').trim() || project?.defaultBranch,
        // PR1 atomic intake (PRD §P0-2 / P0-3): API persists the request
        // and the first user message in one transaction so the runner
        // watch loop never races between request creation and the
        // initial chat turn. The previous two-step (POST + follow-up
        // POST /messages) is dropped.
        firstMessage: { role: 'user' as const, content: firstMessage },
      }),
    });
    form.reset();
    clearNewTaskFormDraft();
    await loadData({ render: false });
    ui.activeTaskRequestId = request.id;
    ui.activeRunId = request.workflowRunId;
    ui.lastError = null;
    ui.activePage = 'task';
    window.location.hash = `task/${encodeURIComponent(request.id)}`;
    runnerAutoStartAttemptedForRequest.add(request.id);
    void ensureRunnerStarted();
    void loadCoordinatorChat(request.id);
    render();
    console.log('[web] workflow request created', request.id);
  } catch (err) {
    ui.lastError = errorMessage(err);
    render();
  }
}

async function ensureProjectAgentBackendReady(project: ProjectDto): Promise<boolean> {
  if (!project.agentBackend) {
    ui.lastError = '这个项目还没有配置执行方式。请先到“项目接入”编辑项目，选择 Claude Code 或 Codex。';
    render();
    return false;
  }
  const cached = preflightForProjectBackend(project);
  if (cached?.runnable) return true;
  const checked = await checkAgentBackend(project.agentBackend, project.id);
  if (checked?.runnable) return true;
  if (!checked) {
    ui.lastError = '执行方式连接检测未完成，任务不会入队。';
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
const coordinatorOptionSelections = new Map<string, Map<string, Set<string>>>();
const coordinatorAutoReplyBlocks = new Map<string, string>();
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
  details: string;
  branch: string;
  flowId: '' | 'feature.standard' | 'feature.fastforward' | 'issue.standard' | 'refactor.standard';
  startStage:
    | ''
    | 'context_pack'
    | 'requirement'
    | 'design'
    | 'implementation'
    | 'build_test'
    | 'review'
    | 'completion'
    | 'knowledge';
} = { projectId: '', type: '', title: '', details: '', branch: '', flowId: '', startStage: '' };

const NEW_TASK_TITLE_SELECTOR = '[data-new-task-title]';
const NEW_TASK_DETAILS_SELECTOR = '[data-new-task-details]';

let newTaskTitleFocus: {
  selector: typeof NEW_TASK_TITLE_SELECTOR | typeof NEW_TASK_DETAILS_SELECTOR;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: 'forward' | 'backward' | 'none';
} | null = null;

// `ui.coordinatorReplyComposing` / `ui.coordinatorReplyRenderDeferred` /
// `ui.isReplacingAppRootForRender` moved to state.ts (see the IME-deferral
// comment there); the composer capture/restore logic below still owns them.

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
  coordinatorOptionSelections.delete(requestId);
  coordinatorAutoReplyBlocks.delete(requestId);
  if (coordinatorReplyFocus?.requestId === requestId) coordinatorReplyFocus = null;
  if (ui.coordinatorReplyComposing?.requestId === requestId) {
    ui.coordinatorReplyComposing = null;
    // No other composing textareas exist in this SPA; reset the pending flag
    // so a stale defer does not survive request-state transitions.
    ui.coordinatorReplyRenderDeferred = false;
  }
}

function normalizeSelectionDirection(direction: string | null): 'forward' | 'backward' | 'none' {
  return direction === 'forward' || direction === 'backward' ? direction : 'none';
}

function captureNewTaskFormState(root: HTMLElement): void {
  const titleControl = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(NEW_TASK_TITLE_SELECTOR);
  const detailsControl = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(NEW_TASK_DETAILS_SELECTOR);
  if (!titleControl && !detailsControl) {
    newTaskTitleFocus = null;
    return;
  }
  // Sync DOM value into the draft so keystrokes that have not yet fired an
  // 'input' event (e.g. mid-IME composition) still survive the rebuild.
  if (titleControl) newTaskFormDraft.title = titleControl.value;
  if (detailsControl) newTaskFormDraft.details = detailsControl.value;
  if (titleControl && document.activeElement === titleControl) {
    newTaskTitleFocus = {
      selector: NEW_TASK_TITLE_SELECTOR,
      selectionStart: titleControl.selectionStart ?? 0,
      selectionEnd: titleControl.selectionEnd ?? 0,
      selectionDirection: normalizeSelectionDirection(titleControl.selectionDirection),
    };
  } else if (detailsControl && document.activeElement === detailsControl) {
    newTaskTitleFocus = {
      selector: NEW_TASK_DETAILS_SELECTOR,
      selectionStart: detailsControl.selectionStart ?? 0,
      selectionEnd: detailsControl.selectionEnd ?? 0,
      selectionDirection: normalizeSelectionDirection(detailsControl.selectionDirection),
    };
  }
}

function restoreNewTaskFormFocus(root: HTMLElement): void {
  if (!newTaskTitleFocus) return;
  const focus = newTaskTitleFocus;
  const control = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(focus.selector);
  if (!control) {
    newTaskTitleFocus = null;
    return;
  }
  control.focus({ preventScroll: true });
  const len = control.value.length;
  control.setSelectionRange(
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
  newTaskFormDraft.details = '';
  newTaskFormDraft.branch = '';
  newTaskFormDraft.flowId = '';
  newTaskFormDraft.startStage = '';
  newTaskTitleFocus = null;
}

async function loadCoordinatorChat(requestId: string): Promise<void> {
  try {
    const state = await api<CoordinatorChatState>(
      `/workflow-requests/${encodeURIComponent(requestId)}/messages`,
    );
    coordinatorChats.set(requestId, state);
    if (state.status !== 'awaiting_clarification') clearCoordinatorReplyComposerState(requestId);
    if (ui.activeTaskRequestId === requestId) render();
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
    ui.lastError = errorMessage(err);
    render();
    // Only restore disabled state if the textarea is still in the DOM
    if (document.body.contains(textArea)) {
      textArea.disabled = wasDisabled;
    }
  }
}

function coordinatorStreamChannelForRequest(request: WorkflowRequestDto): StreamChannel {
  return request.workflowRunId
    ? { kind: 'run', id: request.workflowRunId }
    : { kind: 'request', id: request.id };
}

function ensureCoordinatorStreamSubscription(request: WorkflowRequestDto): void {
  if (ui.activePage !== 'task' || ui.activeTaskRequestId !== request.id) return;
  if (request.workflowRunId) attachRunStream(request.workflowRunId);
  else if (shouldSubscribeRequestStream(request)) attachRequestStream(request.id);
}

function shouldSubscribeRequestStream(request: WorkflowRequestDto): boolean {
  return request.status === 'pending' || request.status === 'claimed' || request.status === 'awaiting_clarification';
}

function coordinatorPendingQuestions(state: CoordinatorChatState | undefined): string[] {
  const decision = state?.decision?.decision;
  return decision?.action === 'pause_for_human' ? decision.questions : [];
}

function coordinatorSelectedOptionLabels(requestId: string, questionKey: string): Set<string> {
  return coordinatorOptionSelections.get(requestId)?.get(questionKey) ?? new Set<string>();
}

function setCoordinatorSelectedOptionLabel(
  requestId: string,
  questionKey: string,
  optionLabel: string,
  multiple: boolean,
): void {
  let requestSelections = coordinatorOptionSelections.get(requestId);
  if (!requestSelections) {
    requestSelections = new Map<string, Set<string>>();
    coordinatorOptionSelections.set(requestId, requestSelections);
  }

  if (!multiple) {
    requestSelections.set(questionKey, new Set([optionLabel]));
    return;
  }

  const selected = new Set(requestSelections.get(questionKey) ?? []);
  if (selected.has(optionLabel)) selected.delete(optionLabel);
  else selected.add(optionLabel);
  if (selected.size > 0) requestSelections.set(questionKey, selected);
  else requestSelections.delete(questionKey);
}

function syncCoordinatorOptionButtonState(requestId: string, questionKey: string): void {
  const selectedLabels = coordinatorSelectedOptionLabels(requestId, questionKey);
  document.querySelectorAll<HTMLButtonElement>('[data-coordinator-option-request-id][data-coordinator-question-key]')
    .forEach((candidate) => {
      if (
        candidate.dataset.coordinatorOptionRequestId !== requestId ||
        candidate.dataset.coordinatorQuestionKey !== questionKey
      ) {
        return;
      }
      const isSelected = selectedLabels.has(candidate.dataset.coordinatorOptionLabel ?? '');
      candidate.classList.toggle('is-selected', isSelected);
      candidate.setAttribute('aria-pressed', String(isSelected));
    });
}

function coordinatorChoiceReplySelections(
  requestId: string,
  questions: string[],
): Array<{ prompt: string; selectedOptions: CoordinatorQuestionOption[] }> {
  const requestSelections = coordinatorOptionSelections.get(requestId);
  if (!requestSelections) return [];
  return questions.flatMap((question, index) => {
    const parsed = parseCoordinatorQuestion(question);
    const selectedLabels = requestSelections.get(coordinatorQuestionKey(parsed, index));
    if (!selectedLabels || selectedLabels.size === 0) return [];
    const selectedOptions = parsed.options.filter((option) => selectedLabels.has(option.label));
    return selectedOptions.length > 0 ? [{ prompt: parsed.prompt, selectedOptions }] : [];
  });
}

function updateCoordinatorReplyFromSelectedOptions(
  requestId: string,
  questions: string[],
  replyArea: HTMLTextAreaElement,
  updateSendState: () => void,
): void {
  const nextAutoReply = buildCoordinatorChoiceReply(coordinatorChoiceReplySelections(requestId, questions));
  const previousAutoReply = coordinatorAutoReplyBlocks.get(requestId) ?? '';
  const nextReply = mergeCoordinatorAutoReply(replyArea.value, previousAutoReply, nextAutoReply);
  if (nextAutoReply) coordinatorAutoReplyBlocks.set(requestId, nextAutoReply);
  else coordinatorAutoReplyBlocks.delete(requestId);
  replyArea.value = nextReply;
  setCoordinatorReplyDraft(requestId, replyArea.value);
  updateSendState();
}

function renderCoordinatorQuestionCard(
  requestId: string,
  question: string,
  index: number,
  questions: string[],
  replyArea: HTMLTextAreaElement,
  updateSendState: () => void,
): HTMLElement {
  const parsed = parseCoordinatorQuestion(question);
  const questionKey = coordinatorQuestionKey(parsed, index);
  const selectedLabels = coordinatorSelectedOptionLabels(requestId, questionKey);
  return el('article', {
    class: 'coordinator-question-card',
    children: [
      el('span', { class: 'coordinator-question-index', text: String(index + 1) }),
      el('div', {
        class: 'coordinator-question-body',
        children: [
          el('div', {
            class: 'coordinator-question-title-row',
            children: [
              el('p', { class: 'coordinator-question-text', text: parsed.prompt }),
              parsed.options.length > 0
                ? el('span', {
                    class: 'coordinator-question-mode',
                    text: parsed.multiple ? '可多选' : '单选',
                  })
                : null,
            ],
          }),
          parsed.options.length > 0
            ? el('ul', {
                class: 'coordinator-option-list',
                children: parsed.options.map((option) =>
                  el('li', {
                    children: [
                      renderCoordinatorOptionButton(
                        requestId,
                        questionKey,
                        option,
                        parsed,
                        selectedLabels.has(option.label),
                        questions,
                        replyArea,
                        updateSendState,
                      ),
                    ],
                  }),
                ),
              })
            : null,
        ],
      }),
    ],
  });
}

function renderCoordinatorOptionButton(
  requestId: string,
  questionKey: string,
  option: CoordinatorQuestionOption,
  parsed: ParsedCoordinatorQuestion,
  selected: boolean,
  questions: string[],
  replyArea: HTMLTextAreaElement,
  updateSendState: () => void,
): HTMLButtonElement {
  const optionButton = el('button', {
    class: `coordinator-option${selected ? ' is-selected' : ''}`,
    attrs: {
      type: 'button',
      'aria-pressed': String(selected),
      'data-coordinator-option-request-id': requestId,
      'data-coordinator-question-key': questionKey,
      'data-coordinator-option-label': option.label,
    },
    children: [
      el('span', { class: 'coordinator-option-key', text: option.label }),
      el('span', { class: 'coordinator-option-text', text: option.text }),
    ],
  }) as HTMLButtonElement;
  optionButton.onclick = () => {
    setCoordinatorSelectedOptionLabel(requestId, questionKey, option.label, parsed.multiple);
    syncCoordinatorOptionButtonState(requestId, questionKey);
    updateCoordinatorReplyFromSelectedOptions(requestId, questions, replyArea, updateSendState);
  };
  return optionButton;
}

function renderCoordinatorActionPanel(
  requestId: string,
  questions: string[],
  reason: string | null,
  replyArea: HTMLTextAreaElement,
  sendBtn: HTMLButtonElement,
  updateSendState: () => void,
): HTMLElement {
  return el('section', {
    class: 'coordinator-action',
    children: [
      el('div', {
        class: 'coordinator-action-head',
        children: [
          el('div', {
            children: [
              el('strong', { text: '等待你回复' }),
              el('p', { text: '回答后系统会继续判断任务类型和执行路径。' }),
            ],
          }),
          pill(`${questions.length || 1} 个问题`, 'warn'),
        ],
      }),
      reason ? el('p', { class: 'coordinator-action-reason', text: reason }) : null,
      el('div', {
        class: 'coordinator-question-list',
        children: questions.length > 0
          ? questions.map((question, index) =>
              renderCoordinatorQuestionCard(requestId, question, index, questions, replyArea, updateSendState),
            )
          : [el('p', { class: 'muted compact', text: 'Coordinator 正在整理需要你确认的问题。' })],
      }),
      el('div', { class: 'chat-composer', children: [replyArea, sendBtn] }),
    ],
  });
}

function renderCoordinatorChatPanel(request: WorkflowRequestDto): HTMLElement | null {
  const requestId = request.id;
  const streamChannel = coordinatorStreamChannelForRequest(request);
  ensureCoordinatorStreamSubscription(request);
  const state = coordinatorChats.get(requestId);
  if (!state) {
    void loadCoordinatorChat(requestId);
  }
  const streamView = buildAgentStreamView(streamChannel);
  const canReply = request.status === 'awaiting_clarification' && state?.status === 'awaiting_clarification';
  if (!canReply) clearCoordinatorReplyComposerState(requestId);
  if (!state && streamView.events.length === 0 && request.status !== 'pending' && request.status !== 'claimed') return null;
  const pendingQuestions = coordinatorPendingQuestions(state);

  const thread = (state?.messages ?? []).map((m) =>
    el('article', {
      class: `chat-message chat-message-${m.role}`,
      children: [
        el('div', {
          class: 'chat-message-meta',
          children: [
            el('span', { class: 'chat-role', text: m.role === 'user' ? '你' : 'Coordinator' }),
            el('span', { text: fmtTime(m.createdAt) }),
          ],
        }),
        el('p', { class: 'chat-content', text: m.content }),
      ],
    }),
  );

  const replyArea = canReply ? el('textarea', {
    class: 'chat-input',
    attrs: {
      rows: '3',
      placeholder: '可一次回答多个问题，也可以补充约束、例子或验收方式…',
      'data-coordinator-reply-request-id': requestId,
    },
  }) as HTMLTextAreaElement : null;
  const sendBtn = replyArea ? button('提交回复', 'button primary small') : null;
  let updateCoordinatorReplySendState = (): void => {};

  if (replyArea && sendBtn) {
    updateCoordinatorReplySendState = () => {
      sendBtn.disabled = replyArea.value.trim().length === 0;
    };
    replyArea.value = coordinatorReplyDrafts.get(requestId) ?? '';
    updateCoordinatorReplySendState();
    replyArea.oninput = () => {
      setCoordinatorReplyDraft(requestId, replyArea.value);
      updateCoordinatorReplySendState();
    };
    replyArea.addEventListener('compositionstart', () => {
      ui.coordinatorReplyComposing = { requestId };
    });
    replyArea.addEventListener('compositionend', () => {
      ui.coordinatorReplyComposing = null;
      // Flush whatever the IME just committed into the draft so a follow-up
      // render (deferred or otherwise) rehydrates the final characters.
      setCoordinatorReplyDraft(requestId, replyArea.value);
      updateCoordinatorReplySendState();
      if (ui.coordinatorReplyRenderDeferred) {
        ui.coordinatorReplyRenderDeferred = false;
        queueMicrotask(() => render());
      }
    });
    replyArea.onblur = () => {
      setCoordinatorReplyDraft(requestId, replyArea.value);
      if (!ui.isReplacingAppRootForRender) {
        // A genuine blur (not render replacement) ends any composition this
        // textarea may have been carrying; `compositionend` would otherwise
        // never fire once the node is detached.
        if (ui.coordinatorReplyComposing?.requestId === requestId) {
          ui.coordinatorReplyComposing = null;
          if (ui.coordinatorReplyRenderDeferred) {
            ui.coordinatorReplyRenderDeferred = false;
            queueMicrotask(() => render());
          }
        }
        if (coordinatorReplyFocus?.requestId === requestId) {
          coordinatorReplyFocus = null;
        }
      }
    };
    sendBtn.onclick = () => void sendCoordinatorReply(requestId, replyArea);
  }

  const decisionLine = state?.decision
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
  const waitingLine = !state || ((state.messages.length === 0 && !state.decision))
    ? el('p', {
        class: 'muted compact',
        text: request.workflowRunId
          ? 'Coordinator 记录加载中；开发者日志会继续显示在下方折叠区。'
          : 'Coordinator 正在接收请求；开发者日志会先显示在下方折叠区。',
      })
    : null;
  const requestHistoryView = request.workflowRunId
    ? buildAgentStreamView({ kind: 'request', id: request.id })
    : null;
  const streamDetails = [
    requestHistoryView && requestHistoryView.events.length > 0
      ? renderCoordinatorStreamDetails(request, requestHistoryView, 'history')
      : null,
    renderCoordinatorStreamDetails(request, streamView, 'live'),
  ];
  const actionPanel = replyArea && sendBtn
    ? renderCoordinatorActionPanel(
        requestId,
        pendingQuestions,
        state?.decision?.decision.action === 'pause_for_human' ? state.decision.decision.reason : null,
        replyArea,
        sendBtn,
        updateCoordinatorReplySendState,
      )
    : null;

  return el('section', {
    class: 'panel coordinator-chat',
    children: [
      panelHeader('需求澄清', '回答后系统会继续判断任务类型和执行路径'),
      actionPanel,
      actionPanel ? null : decisionLine,
      waitingLine,
      thread.length > 0
        ? el('section', {
            class: 'chat-thread-section',
            children: [
              el('h3', { class: 'chat-section-title', text: '沟通记录' }),
              el('div', { class: 'chat-thread', children: thread }),
            ],
          })
        : null,
      ...streamDetails,
    ],
  });
}

function renderCoordinatorStreamDetails(
  request: WorkflowRequestDto,
  view: AgentStreamViewModel,
  mode: 'live' | 'history',
): HTMLElement {
  const channelKey = view.channel ? streamChannelKey(view.channel) : 'none';
  return el('details', {
    class: 'coordinator-stream-details',
    attrs: {
      'data-details-key': `coordinator-stream:${request.id}:${mode}:${channelKey}`,
    },
    children: [
      el('summary', {
        children: [
          el('span', { text: mode === 'history' ? '开发者日志（Coordinator 阶段已缓存）' : '开发者日志' }),
          renderStreamStatus(view),
          renderStreamSummary(view),
        ],
      }),
      renderAgentStreamBody(view, { scrollKeyPrefix: 'coordinator-stream' }),
    ],
  });
}

function reportNextAction(run: WorkflowRunDto): string {
  if (run.status === 'failed') return '查看失败证据并决定是否重试。';
  if (run.status === 'awaiting_human') return '处理人工确认点，确认后继续流转。';
  if (run.status === 'awaiting_clarification') return '补充澄清信息后继续。';
  if (reportIsAcceptable(run)) return '查看交付摘要，决定是否验收。';
  if (reportIsRunning(run)) return '等待 Runner 完成，报告会持续更新。';
  return '查看任务详情确认状态。';
}

function reportEvidenceSummary(run: WorkflowRunDto): string {
  const detail = data.activeDetail?.run.id === run.id ? data.activeDetail : null;
  if (!detail) return `当前阶段：${STAGE_LABELS[run.currentStage] ?? run.currentStage}`;
  const projection = buildRunProjection(detail);
  const reportArtifact = latestArtifactOfKind(detail.artifacts, 'completion_report');
  const tests = projection.summary.testsTotal
    ? `${projection.summary.testsPassed}/${projection.summary.testsTotal} 测试通过`
    : '暂无测试摘要';
  const gates = `${projection.summary.gatesPassed}/${detail.gates.length} Gate 通过`;
  return `${reportArtifact ? '报告已生成' : '报告未生成'} · ${gates} · ${tests}`;
}

function filteredReportRuns(): WorkflowRunDto[] {
  if (ui.reportsActiveView === 'attention') return data.runs.filter(reportNeedsAttention);
  if (ui.reportsActiveView === 'acceptable') return data.runs.filter(reportIsAcceptable);
  if (ui.reportsActiveView === 'running') return data.runs.filter(reportIsRunning);
  return data.runs;
}

function setReportsView(view: ReportViewId): void {
  ui.reportsActiveView = view;
  render();
}

function renderReportsPage(): HTMLElement {
  const stats = reportStats(data.runs);
  const rows = filteredReportRuns();
  return el('section', {
    class: 'reports-page stack',
    children: [
      renderReportsOverview(stats),
      renderActiveReportDetail(),
      el('section', {
        class: 'panel reports-list-panel',
        children: [
          panelHeader('交付报告中心', '按验收状态、失败风险和证据完整度查看交付结果。'),
          renderReportTabs(stats),
          rows.length
            ? el('div', { class: 'report-list', children: rows.map(renderReportRow) })
            : renderReportsEmptyState(),
        ],
      }),
    ],
  });
}

function renderReportsOverview(stats: ReturnType<typeof reportStats>): HTMLElement {
  return el('section', {
    class: 'reports-overview-grid',
    children: [
      el('article', {
        class: 'panel reports-overview-card',
        children: [
          panelHeader('交付概览', '先判断哪些交付可以验收。'),
          el('div', {
            class: 'settings-kpi-row',
            children: [metric('可验收', String(stats.acceptable), '已完成交付', stats.acceptable ? 'good' : 'muted'), metric('需处理', String(stats.attention), '失败或等待人工', stats.attention ? 'warn' : 'good')],
          }),
          configSummaryItem('报告总数', `${stats.total} 个`),
        ],
      }),
      el('article', {
        class: 'panel reports-overview-card',
        children: [
          panelHeader('风险队列', '优先处理失败和等待确认。'),
          metric('失败', String(stats.failed), '需要看证据', stats.failed ? 'bad' : 'good'),
          el('p', { class: 'muted compact', text: stats.attention ? '先打开需处理项，查看失败证据或人工确认点。' : '当前没有阻塞交付的报告。' }),
        ],
      }),
      el('article', {
        class: 'panel reports-overview-card',
        children: [
          panelHeader('执行进度', '还在生成中的交付。'),
          metric('执行中', String(stats.running), '报告会自动更新', stats.running ? 'info' : 'muted'),
          configSummaryItem('已完成', `${stats.completed} 个`),
        ],
      }),
    ],
  });
}

function renderReportTabs(stats: ReturnType<typeof reportStats>): HTMLElement {
  const tabs: Array<{ id: ReportViewId; label: string; hint: string }> = [
    { id: 'all', label: '全部', hint: `${stats.total} 个报告` },
    { id: 'attention', label: '需处理', hint: `${stats.attention} 个需处理` },
    { id: 'acceptable', label: '可验收', hint: `${stats.acceptable} 个可验收` },
    { id: 'running', label: '执行中', hint: `${stats.running} 个执行中` },
  ];
  return el('div', {
    class: 'reports-tabs',
    children: tabs.map((tab) => {
      const btn = button(tab.label, ui.reportsActiveView === tab.id ? 'tab-button active' : 'tab-button');
      btn.title = tab.hint;
      btn.onclick = () => setReportsView(tab.id);
      return btn;
    }),
  });
}

function renderReportsEmptyState(): HTMLElement {
  return el('div', {
    class: 'empty-state reports-empty-state',
    children: [
      el('strong', { text: '当前视角没有报告' }),
      el('p', { class: 'muted compact', text: '切换到“全部”查看所有交付记录，或回到工作台查看正在执行的任务。' }),
      actionLink('去工作台', 'workbench'),
    ],
  });
}

function renderReportRow(run: WorkflowRunDto): HTMLElement {
  const request = data.requests.find((candidate) => candidate.workflowRunId === run.id);
  const open = button('打开任务', 'button secondary small');
  open.onclick = () => (request ? setHash('task', request.id) : setHash('workbench', run.id));
  const viewReport = button('查看报告', 'button secondary small');
  viewReport.onclick = () => {
    ui.activeRunId = run.id;
    void loadRunDetail(run.id, true);
  };
  return el('article', {
    class: `report-row report-card ${run.status}`,
    children: [
      el('div', {
        class: 'report-card-main',
        children: [
          el('div', {
            class: 'report-title-copy',
            children: [
              el('strong', { text: run.title }),
              el('small', { text: `${projectName(run.projectId)} · ${fmtTime(run.createdAt)}` }),
            ],
          }),
          pill(reportStatusLabel(run.status), statusKind(run.status)),
        ],
      }),
      el('div', {
        class: 'report-card-summary',
        children: [
          configSummaryItem('证据摘要', reportEvidenceSummary(run)),
          configSummaryItem('下一步', reportNextAction(run)),
        ],
      }),
      el('details', {
        class: 'report-tech-details',
        attrs: { 'data-details-key': `report-run-tech:${run.id}` },
        children: [
          el('summary', { text: '技术详情' }),
          field('Run', el('code', { text: run.id })),
          field('分支', el('code', { text: run.branch })),
          run.workspacePath ? field('Worktree', el('code', { text: run.workspacePath })) : null,
        ],
      }),
      el('div', { class: 'button-row report-actions', children: [viewReport, open] }),
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
  const reportArtifact = latestArtifactOfKind(detail.artifacts, 'completion_report');
  const projection = buildRunProjection(detail);
  return el('section', {
    class: 'panel report-detail',
    children: [
      panelHeader(report.title, `${reportStatusLabel(detail.run.status)} · ${projectName(detail.run.projectId)} · ${fmtTime(detail.run.createdAt)}`),
      el('div', {
        class: 'report-detail-metrics',
        children: [
          metric('Gate', `${projection.summary.gatesPassed}/${detail.gates.length}`, `${projection.summary.gatesWarned} warn · ${projection.summary.gatesFailed} fail`, projection.summary.gatesFailed ? 'bad' : 'good'),
          metric('测试', `${projection.summary.testsPassed}/${projection.summary.testsTotal}`, '自动化测试摘要', projection.summary.testsTotal ? 'good' : 'muted'),
          metric('命令', String(projection.summary.commands), '执行证据', projection.summary.commands ? 'info' : 'muted'),
          metric('构建', projection.summary.buildStatus, '构建状态', statusKind(projection.summary.buildStatus)),
        ],
      }),
      report.summary.length
        ? el('div', { class: 'summary-list', children: report.summary.map((item) => el('div', { class: 'summary-item', text: item })) })
        : el('p', { class: 'muted compact', text: '报告已生成，但没有结构化摘要。' }),
      ...report.sections.map((section) =>
        el('details', {
          class: 'report-section',
          attrs: { 'data-details-key': `completion-report-section:${detail.run.id}:${section.title}` },
          children: [
            el('summary', { text: section.title }),
            el('pre', { class: 'doc-preview', text: previewText(section.body) }),
          ],
        }),
      ),
      el('details', {
        class: 'report-tech-details',
        attrs: { 'data-details-key': `completion-report-tech:${detail.run.id}` },
        children: [
          el('summary', { text: '报告来源详情' }),
          field('Run', el('code', { text: detail.run.id })),
          reportArtifact ? field('Artifact', el('code', { text: reportArtifact.id })) : null,
          reportArtifact ? field('URI', el('code', { text: reportArtifact.uri })) : null,
          field('Worktree', el('code', { text: detail.run.workspacePath ?? '尚未准备' })),
        ],
      }),
    ],
  });
}

function knowledgeDecision(value: string | undefined): KnowledgeActionDecision | undefined {
  if (value === 'accepted' || value === 'edited' || value === 'ignored') return value;
  return undefined;
}

function knowledgeSuggestionItems(detail: RunDetail, suggestions: KnowledgeSuggestion[]): KnowledgeSuggestionItem[] {
  return suggestions.map((suggestion, index) => {
    const key = `${detail.run.id}:${index}`;
    const targetId = `KS-${String(index + 1).padStart(3, '0')}`;
    const persisted = detail.actions
      .filter((action) => action.kind === 'knowledge_suggestion_action' && action.targetId === targetId)
      .at(-1);
    const decision = knowledgeDecision(persisted?.action) ?? knowledgeDecisions.get(key);
    const persistedText = typeof persisted?.payload.text === 'string' ? persisted.payload.text : null;
    return {
      suggestion,
      index,
      key,
      targetId,
      decision,
      text: persistedText ?? knowledgeEdits.get(key) ?? suggestion.text,
    };
  });
}

function knowledgeSuggestionKindLabel(kind: KnowledgeSuggestion['kind']): string {
  switch (kind) {
    case 'Decision': return '决策';
    case 'Pitfall': return '踩坑';
    case 'Pattern': return '模式';
    case 'Lesson': return '经验';
  }
}

function knowledgeSuggestionImpact(kind: KnowledgeSuggestion['kind']): string {
  switch (kind) {
    case 'Decision': return '后续遇到同类取舍时，可减少重复讨论。';
    case 'Pitfall': return '后续任务可优先避开同类失败路径。';
    case 'Pattern': return '后续实现可复用这套做法，保持项目一致性。';
    case 'Lesson': return '后续任务可把这条经验放入上下文，减少返工。';
  }
}

function knowledgeActionLabel(action: KnowledgeActionDecision | undefined): string {
  if (action === 'accepted') return '已收录';
  if (action === 'edited') return '编辑后收录';
  if (action === 'ignored') return '已忽略';
  return '待确认';
}

function knowledgeActionKind(action: KnowledgeActionDecision | undefined): StatusKind {
  if (action === 'accepted' || action === 'edited') return 'good';
  if (action === 'ignored') return 'muted';
  return 'warn';
}

function knowledgeSuggestionTitle(item: KnowledgeSuggestionItem): string {
  const text = item.text.trim();
  const firstSentence = text.split(/[。.!?？]/).find((part) => part.trim())?.trim() ?? text;
  if (!firstSentence) return `${knowledgeSuggestionKindLabel(item.suggestion.kind)}建议 ${item.index + 1}`;
  return firstSentence.length > 32 ? `${firstSentence.slice(0, 31)}…` : firstSentence;
}

function renderKnowledgeSuggestionEditor(item: KnowledgeSuggestionItem, detail: RunDetail): HTMLElement {
  const draft = knowledgeEditDrafts.get(item.key) ?? item.text;
  const editor = el('textarea', {
    class: 'knowledge-edit-textarea',
    attrs: {
      rows: '5',
      'data-knowledge-edit-key': item.key,
      placeholder: '编辑后收录为项目知识…',
    },
  });
  editor.value = draft;
  editor.addEventListener('input', () => knowledgeEditDrafts.set(item.key, editor.value));
  editor.addEventListener('compositionstart', () => {
    ui.knowledgeEditComposing = { key: item.key };
  });
  editor.addEventListener('compositionend', () => {
    knowledgeEditDrafts.set(item.key, editor.value);
    ui.knowledgeEditComposing = null;
    if (ui.knowledgeEditRenderDeferred) {
      ui.knowledgeEditRenderDeferred = false;
      queueMicrotask(() => render());
    }
  });
  editor.addEventListener('blur', () => {
    if (ui.knowledgeEditComposing?.key === item.key) {
      ui.knowledgeEditComposing = null;
      if (ui.knowledgeEditRenderDeferred) {
        ui.knowledgeEditRenderDeferred = false;
        queueMicrotask(() => render());
      }
    }
  });

  const save = button('保存为知识', 'button primary small');
  save.onclick = () => {
    const next = (knowledgeEditDrafts.get(item.key) ?? editor.value).trim();
    if (!next) return;
    knowledgeEditing.delete(item.key);
    void submitKnowledgeAction(detail.run.id, item.targetId, 'edited', {
      text: next,
      originalText: item.suggestion.text,
      kind: item.suggestion.kind,
      evidence: item.suggestion.evidence,
    });
  };
  const cancel = button('取消', 'button secondary small');
  cancel.onclick = () => {
    knowledgeEditing.delete(item.key);
    knowledgeEditDrafts.delete(item.key);
    render();
  };

  return el('div', {
    class: 'knowledge-edit-box',
    children: [editor, el('div', { class: 'button-row', children: [save, cancel] })],
  });
}

function renderKnowledgeSuggestion(item: KnowledgeSuggestionItem, detail: RunDetail): HTMLElement {
  const accept = button(item.decision === 'accepted' ? '已收录' : '收录', 'button secondary small');
  accept.onclick = () => void submitKnowledgeAction(detail.run.id, item.targetId, 'accepted', {
    text: item.text,
    kind: item.suggestion.kind,
    evidence: item.suggestion.evidence,
  });

  const edit = button(item.decision === 'edited' ? '已编辑' : '编辑后收录', 'button secondary small');
  edit.onclick = () => {
    knowledgeEditing.add(item.key);
    knowledgeEditDrafts.set(item.key, item.text);
    render();
  };

  const ignore = button(item.decision === 'ignored' ? '已忽略' : '忽略', 'button secondary small');
  ignore.onclick = () => void submitKnowledgeAction(detail.run.id, item.targetId, 'ignored', {
    text: item.text,
    kind: item.suggestion.kind,
    evidence: item.suggestion.evidence,
  });

  return el('article', {
    class: `knowledge-card ${item.decision ?? ''}`,
    children: [
      el('div', {
        class: 'knowledge-head',
        children: [
          el('div', {
            class: 'knowledge-title-copy',
            children: [
              el('strong', { text: knowledgeSuggestionTitle(item) }),
              el('small', { text: `${knowledgeSuggestionKindLabel(item.suggestion.kind)} · 来自 ${detail.run.title}` }),
            ],
          }),
          el('div', { class: 'chip-row', children: [pill(knowledgeActionLabel(item.decision), knowledgeActionKind(item.decision))] }),
        ],
      }),
      el('p', { class: 'knowledge-summary', text: item.text }),
      el('div', {
        class: 'knowledge-impact-grid',
        children: [
          configSummaryItem('为什么值得收录', item.suggestion.evidence || '来自本次任务执行证据，可帮助后续任务复用判断。'),
          configSummaryItem('后续价值', knowledgeSuggestionImpact(item.suggestion.kind)),
        ],
      }),
      knowledgeEditing.has(item.key) ? renderKnowledgeSuggestionEditor(item, detail) : null,
      el('div', { class: 'button-row', children: [accept, edit, ignore] }),
      el('details', {
        class: 'knowledge-source-details',
        attrs: { 'data-details-key': `knowledge-suggestion-source:${item.key}` },
        children: [
          el('summary', { text: '来源详情' }),
          field('来源任务', detail.run.title),
          field('建议编号', item.targetId),
          field('Run', el('code', { text: detail.run.id })),
          item.suggestion.evidence ? field('证据', item.suggestion.evidence) : null,
        ],
      }),
    ],
  });
}

function knowledgeArtifactKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    requirement: '需求',
    design: '设计',
    architecture: '架构',
    roadmap: '路线图',
    decision: '决策',
    lesson: '经验',
    pattern: '模式',
    explore: '调研',
    dev_guide: '开发指南',
    api_doc: 'API 文档',
  };
  return labels[kind] ?? kind;
}

function knowledgeStatusLabel(status: KnowledgeArtifactDto['status']): string {
  if (status === 'accepted') return '已收录';
  if (status === 'draft') return '草稿';
  return '已被替代';
}

function knowledgeStatusKind(status: KnowledgeArtifactDto['status']): StatusKind {
  if (status === 'accepted') return 'good';
  if (status === 'draft') return 'warn';
  return 'muted';
}

function metadataString(artifact: KnowledgeArtifactDto, key: string): string | null {
  const value = artifact.metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataNumber(artifact: KnowledgeArtifactDto, key: string): number | null {
  const value = artifact.metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metadataStringArray(artifact: KnowledgeArtifactDto, key: string): string[] {
  const value = artifact.metadata[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function knowledgeArtifactTitle(artifact: KnowledgeArtifactDto): string {
  return metadataString(artifact, 'title')
    ?? artifact.entityId
    ?? `${knowledgeArtifactKindLabel(artifact.kind)} ${shortId(artifact.id)}`;
}

function knowledgeArtifactSummary(artifact: KnowledgeArtifactDto): string {
  const text = metadataString(artifact, 'text') ?? metadataString(artifact, 'summary') ?? '';
  if (text) return text.length > 180 ? `${text.slice(0, 179)}…` : text;
  const sourceRefs = metadataStringArray(artifact, 'sourceRefs');
  if (sourceRefs.length) return `从 ${sourceRefs.slice(0, 2).join('、')} 沉淀。`;
  return '这条知识已进入项目知识库，可被后续任务检索引用。';
}

function knowledgeArtifactTrustLabel(artifact: KnowledgeArtifactDto): string {
  const knowledgeClass = metadataString(artifact, 'knowledgeClass');
  const trustLevel = metadataString(artifact, 'trustLevel');
  if (knowledgeClass === 'confirmed') return '已确认';
  if (knowledgeClass === 'seed') return '种子知识';
  if (knowledgeClass === 'recovered') return '恢复知识';
  if (trustLevel === 'accepted_knowledge') return '已验收';
  if (trustLevel === 'source') return '源码依据';
  return '待校准';
}

function knowledgeArtifactLastUsed(artifact: KnowledgeArtifactDto): string {
  const lastUsedAt = metadataString(artifact, 'lastUsedAt');
  if (lastUsedAt) return fmtTime(lastUsedAt);
  const hitCount = metadataNumber(artifact, 'hitCount');
  if (hitCount && hitCount > 0) return `${hitCount} 次引用`;
  return '尚未引用';
}

function knowledgeArtifactNeedsMaintenance(artifact: KnowledgeArtifactDto): boolean {
  if (artifact.status !== 'accepted') return true;
  if (metadataString(artifact, 'freshness') === 'possibly_stale') return true;
  const confidence = metadataNumber(artifact, 'confidence');
  return confidence !== null && confidence < 0.55;
}

function renderKnowledgeArtifactCard(artifact: KnowledgeArtifactDto): HTMLElement {
  const sourceRefs = metadataStringArray(artifact, 'sourceRefs');
  const lastUsedRun = metadataString(artifact, 'lastUsedInWorkflowRunId');
  return el('article', {
    class: `knowledge-asset-card ${artifact.status}`,
    children: [
      el('div', {
        class: 'knowledge-head',
        children: [
          el('div', {
            class: 'knowledge-title-copy',
            children: [
              el('strong', { text: knowledgeArtifactTitle(artifact) }),
              el('small', { text: `${knowledgeArtifactKindLabel(artifact.kind)} · v${artifact.version}` }),
            ],
          }),
          el('div', { class: 'chip-row', children: [pill(knowledgeStatusLabel(artifact.status), knowledgeStatusKind(artifact.status)), pill(knowledgeArtifactTrustLabel(artifact), 'info')] }),
        ],
      }),
      el('p', { class: 'knowledge-summary', text: knowledgeArtifactSummary(artifact) }),
      el('div', {
        class: 'knowledge-impact-grid',
        children: [
          configSummaryItem('适用范围', metadataString(artifact, 'subtype') ?? artifact.subtype ?? knowledgeArtifactKindLabel(artifact.kind)),
          configSummaryItem('最近引用', knowledgeArtifactLastUsed(artifact)),
        ],
      }),
      el('details', {
        class: 'knowledge-source-details',
        attrs: { 'data-details-key': `knowledge-artifact-tech:${artifact.id}` },
        children: [
          el('summary', { text: '技术详情' }),
          field('Artifact', el('code', { text: artifact.id })),
          artifact.entityId ? field('Entity', el('code', { text: artifact.entityId })) : null,
          field('URI', el('code', { text: artifact.uri })),
          field('更新时间', fmtTime(artifact.updatedAt)),
          lastUsedRun ? field('最近引用 Run', el('code', { text: lastUsedRun })) : null,
          sourceRefs.length ? field('来源', sourceRefs.join('、')) : null,
        ],
      }),
    ],
  });
}

function setKnowledgeView(view: KnowledgeViewId): void {
  ui.knowledgeActiveView = view;
  render();
}

function selectedKnowledgeView(pendingCount: number): KnowledgeViewId {
  if (ui.knowledgeActiveView) return ui.knowledgeActiveView;
  return pendingCount > 0 ? 'pending' : 'accepted';
}

function renderKnowledgeEmptyState(title: string, message: string, actions: HTMLElement[] = []): HTMLElement {
  return el('div', {
    class: 'empty-state knowledge-empty-state',
    children: [
      el('strong', { text: title }),
      el('p', { class: 'muted compact', text: message }),
      actions.length ? el('div', { class: 'button-row', children: actions }) : null,
    ],
  });
}

function renderKnowledgeOverview(
  project: ProjectDto | null,
  detail: RunDetail | null,
  items: KnowledgeSuggestionItem[],
  artifacts: KnowledgeArtifactDto[],
): HTMLElement {
  const pending = items.filter((item) => !item.decision).length;
  const accepted = artifacts.filter((artifact) => artifact.status === 'accepted').length;
  const maintenance = artifacts.filter(knowledgeArtifactNeedsMaintenance).length;
  const lastUsed = artifacts
    .map((artifact) => metadataString(artifact, 'lastUsedAt'))
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
  const refresh = button(knowledgeArtifactsState.loading ? '刷新中…' : '刷新知识', 'button secondary small');
  refresh.disabled = !project || knowledgeArtifactsState.loading;
  refresh.onclick = () => {
    if (project) void loadKnowledgeArtifacts(project.id);
  };
  const openCurrentTask = button(detail ? '查看任务结果' : '去工作台', 'button secondary');
  openCurrentTask.onclick = () => {
    const request = detail ? data.requests.find((candidate) => candidate.workflowRunId === detail.run.id) : null;
    if (request) setHash('task', request.id);
    else setHash('workbench');
  };

  return el('section', {
    class: 'knowledge-overview-grid',
    children: [
      el('article', {
        class: 'panel knowledge-overview-card',
        children: [
          panelHeader('知识库概览', '项目经验如何影响后续任务。'),
          el('div', {
            class: 'settings-kpi-row',
            children: [metric('已收录', String(accepted), project?.name ?? '未选择项目', accepted ? 'good' : 'muted'), metric('待维护', String(maintenance), '过期、草稿或低可信', maintenance ? 'warn' : 'good')],
          }),
          configSummaryItem('最近引用', lastUsed ? fmtTime(lastUsed) : '尚未被后续任务引用'),
          refresh,
        ],
      }),
      el('article', {
        class: 'panel knowledge-overview-card',
        children: [
          panelHeader('待确认建议', '任务结束后先由人判断是否值得沉淀。'),
          metric('待处理', String(pending), items.length ? `${items.length} 条来自当前任务` : '当前任务暂无建议', pending ? 'warn' : 'good'),
          el('p', { class: 'muted compact', text: pending ? '先处理建议，再确认入库，后续任务才会引用。' : '当前没有需要你处理的知识建议。' }),
          openCurrentTask,
        ],
      }),
      el('article', {
        class: 'panel knowledge-overview-card',
        children: [
          panelHeader('已收录知识', '可被 ContextPack 放入后续任务上下文。'),
          metric('项目知识', String(artifacts.length), `${accepted} 条可用`, accepted ? 'good' : 'muted'),
          configSummaryItem('知识类型', `${new Set(artifacts.map((artifact) => artifact.kind)).size} 类`),
          el('p', { class: 'muted compact', text: '点击下方“已收录”查看摘要，技术来源默认折叠。' }),
        ],
      }),
    ],
  });
}

function renderKnowledgePendingView(detail: RunDetail | null, items: KnowledgeSuggestionItem[]): HTMLElement {
  const pendingKnowledge = detail?.run.status === 'awaiting_human' && detail.run.currentStage === 'knowledge';
  const approve = pendingKnowledge ? button('确认已处理建议并入库', 'button primary') : null;
  if (approve && detail) {
    approve.onclick = async () => {
      await submitApproval(detail.run.id, 'knowledge_gate', true);
      const project = selectedProject();
      if (project) await loadKnowledgeArtifacts(project.id, false);
      render();
    };
  }
  const openTask = button(detail ? '查看任务结果' : '去工作台', 'button secondary');
  openTask.onclick = () => {
    const request = detail ? data.requests.find((candidate) => candidate.workflowRunId === detail.run.id) : null;
    if (request) setHash('task', request.id);
    else setHash('workbench');
  };

  return el('div', {
    class: 'stack',
    children: [
      items.length && detail
        ? el('div', { class: 'knowledge-list', children: items.map((item) => renderKnowledgeSuggestion(item, detail)) })
        : renderKnowledgeEmptyState('当前没有待确认的知识建议', '任务完成并生成可复用经验后，会在这里显示建议。你可以先查看已收录知识，或回到工作台选择一个任务。', [openTask]),
      approve,
    ],
  });
}

function renderKnowledgeAcceptedView(artifacts: KnowledgeArtifactDto[]): HTMLElement {
  if (knowledgeArtifactsState.loading) {
    return renderKnowledgeEmptyState('正在读取项目知识', '系统正在加载这个项目已经收录的知识。');
  }
  if (knowledgeArtifactsState.error) {
    return renderKnowledgeEmptyState('知识加载失败', knowledgeArtifactsState.error);
  }
  if (!artifacts.length) {
    return renderKnowledgeEmptyState('还没有已收录知识', '当任务产生有价值的经验并经过确认后，会出现在这里，供后续任务自动引用。');
  }
  return el('div', { class: 'knowledge-list', children: artifacts.map(renderKnowledgeArtifactCard) });
}

function renderKnowledgeUsageView(artifacts: KnowledgeArtifactDto[]): HTMLElement {
  const used = artifacts.filter((artifact) => metadataString(artifact, 'lastUsedAt') || (metadataNumber(artifact, 'hitCount') ?? 0) > 0);
  if (!used.length) {
    return renderKnowledgeEmptyState('暂无引用记录', '当后续任务把某条知识放入上下文后，这里会显示最近引用时间、任务和引用方式。');
  }
  return el('div', {
    class: 'knowledge-list',
    children: used.map((artifact) => el('article', {
      class: 'knowledge-usage-row',
      children: [
        el('strong', { text: knowledgeArtifactTitle(artifact) }),
        field('最近引用', knowledgeArtifactLastUsed(artifact)),
        metadataString(artifact, 'lastUsedMode') ? field('引用方式', metadataString(artifact, 'lastUsedMode')!) : null,
        metadataString(artifact, 'lastUsedInWorkflowRunId') ? field('来源任务', el('code', { text: metadataString(artifact, 'lastUsedInWorkflowRunId')! })) : null,
      ],
    })),
  });
}

function renderKnowledgeMaintenanceView(artifacts: KnowledgeArtifactDto[]): HTMLElement {
  const maintenance = artifacts.filter(knowledgeArtifactNeedsMaintenance);
  if (!maintenance.length) {
    return renderKnowledgeEmptyState('当前没有需要维护的知识', '已收录知识没有明显过期、草稿或低可信信号。');
  }
  return el('div', {
    class: 'knowledge-list',
    children: maintenance.map((artifact) => renderKnowledgeArtifactCard(artifact)),
  });
}

function renderKnowledgeWorkspace(
  detail: RunDetail | null,
  items: KnowledgeSuggestionItem[],
  artifacts: KnowledgeArtifactDto[],
): HTMLElement {
  const pending = items.filter((item) => !item.decision).length;
  const activeView = selectedKnowledgeView(pending);
  const tabs: Array<{ id: KnowledgeViewId; label: string; hint: string }> = [
    { id: 'pending', label: '待确认', hint: `${pending} 条待处理` },
    { id: 'accepted', label: '已收录', hint: `${artifacts.filter((artifact) => artifact.status === 'accepted').length} 条可用` },
    { id: 'usage', label: '引用记录', hint: '后续任务使用情况' },
    { id: 'maintenance', label: '维护', hint: `${artifacts.filter(knowledgeArtifactNeedsMaintenance).length} 条需关注` },
  ];

  const content = activeView === 'pending'
    ? renderKnowledgePendingView(detail, items)
    : activeView === 'accepted'
      ? renderKnowledgeAcceptedView(artifacts)
    : activeView === 'usage'
      ? renderKnowledgeUsageView(artifacts)
    : renderKnowledgeMaintenanceView(artifacts);

  return el('section', {
    class: 'panel knowledge-workspace-panel',
    children: [
      panelHeader('项目知识资产', '确认新知识、浏览已收录内容，并检查后续任务是否真的引用。'),
      el('div', {
        class: 'knowledge-tabs',
        children: tabs.map((tab) => {
          const btn = button(tab.label, activeView === tab.id ? 'tab-button active' : 'tab-button');
          btn.title = tab.hint;
          btn.onclick = () => setKnowledgeView(tab.id);
          return btn;
        }),
      }),
      content,
    ],
  });
}

function renderKnowledgePage(): HTMLElement {
  const project = selectedProject();
  ensureKnowledgeArtifacts(project);
  const detail = data.activeDetail;
  const suggestions = detail ? parsedKnowledge(detail) : [];
  const items = detail ? knowledgeSuggestionItems(detail, suggestions) : [];
  const artifacts = currentKnowledgeArtifacts();

  return el('section', {
    class: 'knowledge-page stack',
    children: [
      renderKnowledgeOverview(project, detail, items, artifacts),
      renderKnowledgeWorkspace(detail, items, artifacts),
    ],
  });
}

// ---- Runtime Config Layer (PR3 settings page) ----------------------------

interface ConfigEntryDto {
  type: 'number' | 'string' | 'string_array';
  default: number | string | readonly string[];
  description: string;
  category: 'coordinator' | 'skill_prompts' | 'runtime' | 'context_policy';
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

type ConfigCategory = 'coordinator' | 'skill_prompts' | 'runtime' | 'context_policy';

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
    settingsConfig.error = errorMessage(err);
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
    settingsConfig.error = errorMessage(err);
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
    settingsConfig.error = errorMessage(err);
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

function configStateLabel(row: SettingsRowVM): string {
  if (row.hasDraft) return '未保存';
  if (row.hasOverride) return '已覆盖';
  return '默认值';
}

function configStateKind(row: SettingsRowVM): StatusKind {
  if (row.hasDraft) return 'warn';
  if (row.hasOverride) return 'info';
  return 'muted';
}

function configRiskLabel(risk: SettingsRowVM['risk']): string {
  if (risk === 'high') return '高风险';
  if (risk === 'medium') return '中风险';
  return '低风险';
}

function configRiskKind(risk: SettingsRowVM['risk']): StatusKind {
  if (risk === 'high') return 'bad';
  if (risk === 'medium') return 'warn';
  return 'good';
}

function configTypeLabel(entry: ConfigEntryDto): string {
  const parts: string[] = [];
  if (entry.type === 'number') parts.push('数字');
  else if (entry.type === 'string_array') parts.push('列表');
  else parts.push('文本');
  if (entry.multiline) parts.push('多行');
  if (entry.min !== undefined) parts.push(`最小 ${entry.min}`);
  if (entry.max !== undefined) parts.push(`最大 ${entry.max}`);
  return parts.join(' · ');
}

function configSummaryItem(label: string, value: Node | string): HTMLElement {
  const valueNode = typeof value === 'string' ? el('strong', { text: value }) : value;
  return el('div', {
    class: 'settings-summary-item',
    children: [el('span', { text: label }), valueNode],
  });
}

function renderConfigRow(row: SettingsRowVM): HTMLElement {
  const key = row.key;
  const entry = row.entry;
  const override = row.override;
  const isOverridden = row.hasOverride;
  const draft = row.draftValue;
  const dirty = row.hasDraft;
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

  const editDetails = el('details', {
    class: 'config-edit-details',
    attrs: { 'data-details-key': `settings-edit:${key}` },
    children: [
      el('summary', { text: '编辑配置' }),
      editor,
      el('div', {
        class: 'config-actions',
        children: [saveBtn, resetBtn, copyBtn, historyBtn],
      }),
    ],
  });
  if (dirty) editDetails.open = true;

  const technicalDetails = el('details', {
    class: 'config-technical-details',
    attrs: { 'data-details-key': `settings-tech:${key}` },
    children: [
      el('summary', { text: '技术详情' }),
      field('配置键', el('code', { text: key })),
      field('类型约束', configTypeLabel(entry)),
      field('默认来源', el('code', { text: entry.source })),
      override ? field('覆盖时间', fmtTime(override.updatedAt)) : null,
    ],
  });

  const children: Array<Node | null | false | undefined> = [
    el('header', {
      class: 'config-row-header',
      children: [
        el('div', {
          class: 'config-title-copy',
          children: [
            el('strong', { class: 'config-title', text: row.displayName }),
            el('p', { class: 'config-description', text: row.displayDescription }),
          ],
        }),
        el('div', {
          class: 'config-row-badges',
          children: [pill(configStateLabel(row), configStateKind(row)), pill(configRiskLabel(row.risk), configRiskKind(row.risk))],
        }),
      ],
    }),
    el('div', {
      class: 'settings-summary-grid config-summary-grid',
      children: [
        configSummaryItem('当前值', row.valuePreview),
        configSummaryItem('状态', configStateLabel(row)),
        configSummaryItem('风险', configRiskLabel(row.risk)),
        configSummaryItem('最近变更', row.latestAuditAt ? fmtTime(row.latestAuditAt) : '暂无记录'),
      ],
    }),
    editDetails,
    technicalDetails,
  ];

  if (expandedHistory) children.push(renderConfigHistoryPanel(key));

  return el('article', {
    class: `config-row${isOverridden ? ' overridden' : ''}${dirty ? ' dirty' : ''}`,
    children,
  });
}

function currentSettingsViewModel(): SettingsViewModel | null {
  if (!settingsConfig.registry) return null;
  return buildSettingsViewModel({
    registry: settingsConfig.registry,
    overrides: settingsConfig.overrides,
    drafts: settingsConfig.drafts,
    audits: settingsConfig.audits,
  });
}

function renderConfigSection(vm: SettingsViewModel | null): HTMLElement {
  if (!settingsConfig.registry) {
    if (settingsConfig.loading) {
      return el('section', {
        class: 'panel',
        children: [
          panelHeader('运行配置', '加载中…'),
          el('p', { class: 'muted', text: '正在读取配置项和当前覆盖值。' }),
        ],
      });
    }
    if (settingsConfig.error) {
      return el('section', {
        class: 'panel',
        children: [
          panelHeader('运行配置', '加载失败'),
          el('p', { class: 'error', text: settingsConfig.error }),
        ],
      });
    }
    return el('section', {
      class: 'panel',
      children: [panelHeader('运行配置', '准备加载…')],
    });
  }
  if (!vm) return el('section', { class: 'panel', children: [panelHeader('运行配置', '准备加载…')] });

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
  const categoryRows = activeTabVm?.rows ?? [];

  const errorBanner = settingsConfig.error
    ? el('div', { class: 'error-banner', text: settingsConfig.error })
    : null;

  const summarySubtitle = activeTabVm
    ? `${activeTabVm.help} · ${categoryRows.length} 项`
    : `${vm.summary.totalKeys} 项配置`;

  const sectionChildren: Array<Node | null> = [
    panelHeader('运行配置', summarySubtitle),
    errorBanner,
    tabBar,
    el('div', {
      class: 'config-list',
      children: categoryRows.length === 0
        ? [el('p', { class: 'muted', text: '该分类下暂无配置项。' })]
        : categoryRows.map(renderConfigRow),
    }),
  ];

  return el('section', {
    class: 'panel',
    children: sectionChildren.filter((c): c is Node => Boolean(c)),
  });
}

function settingsOperationalState(project: ProjectDto | null, runner: RunnerDto | null): { label: string; kind: StatusKind; detail: string } {
  if (settingsConfig.error) return { label: '配置加载失败', kind: 'bad', detail: settingsConfig.error };
  if (!project) return { label: '需要连接项目', kind: 'warn', detail: '先接入项目后，运行配置才有默认执行上下文。' };
  if (!project.agentBackend) return { label: '执行方式待配置', kind: 'warn', detail: '项目还没有选择 Claude Code 或 Codex。' };
  const backend = agentBackendStatusForProject(project);
  if (backend.kind === 'bad') return { label: '执行方式需处理', kind: 'bad', detail: backend.label };
  if (!runner) return { label: '执行器待启动', kind: 'warn', detail: '配置可编辑；创建任务时会尝试启动 Runner。' };
  return { label: '可运行', kind: 'good', detail: `${project.name} · ${agentBackendDisplayName(project.agentBackend)} · Runner ${runner.status}` };
}

function renderSettingsOverview(vm: SettingsViewModel | null): HTMLElement {
  const project = selectedProject();
  const runner = latestRunner();
  const operational = settingsOperationalState(project, runner);
  const overrideCount = vm?.summary.overrideCount ?? Object.keys(settingsConfig.overrides).length;
  const dirtyCount = vm?.summary.dirtyCount ?? settingsConfig.drafts.size;
  const totalKeys = vm?.summary.totalKeys ?? settingsConfig.registry?.keys.length ?? 0;
  const backend = agentBackendStatusForProject(project);

  const refresh = button(settingsConfig.loading ? '刷新中…' : '刷新配置', 'button secondary');
  refresh.disabled = settingsConfig.loading;
  refresh.onclick = () => void loadSettingsConfig();

  const checkBackend = button(agentBackendPreflightInFlight.has(project?.id ?? '') ? '检测中…' : '检测执行方式', 'button secondary');
  checkBackend.disabled = !project?.agentBackend || agentBackendPreflightInFlight.has(project?.id ?? '');
  checkBackend.onclick = () => {
    if (project?.agentBackend) void checkAgentBackend(project.agentBackend, project.id);
  };

  const startRunner = button(ui.runnerStartInFlight ? '启动中…' : '启动执行器', 'button secondary');
  startRunner.disabled = Boolean(runner) || ui.runnerStartInFlight;
  startRunner.onclick = () => void ensureRunnerStarted();

  return el('section', {
    class: 'settings-overview-grid',
    children: [
      el('article', {
        class: 'panel settings-overview-card',
        children: [
          panelHeader('运行状态', '当前是否具备执行任务的基础条件。'),
          pill(operational.label, operational.kind),
          el('p', { class: 'muted compact', text: operational.detail }),
          el('div', {
            class: 'settings-summary-grid',
            children: [
              configSummaryItem('项目', project?.name ?? '未接入'),
              configSummaryItem('执行方式', project?.agentBackend ? `${agentBackendDisplayName(project.agentBackend)} · ${backend.label}` : '未配置'),
              configSummaryItem('Runner', runner ? runner.status : '未连接'),
              configSummaryItem('配置项', totalKeys ? `${totalKeys} 项` : '加载中'),
            ],
          }),
        ],
      }),
      el('article', {
        class: 'panel settings-overview-card',
        children: [
          panelHeader('配置变更', '只显示需要注意的变更状态。'),
          el('div', {
            class: 'settings-kpi-row',
            children: [
              metric('已覆盖', String(overrideCount), '覆盖默认值', overrideCount ? 'info' : 'muted'),
              metric('未保存', String(dirtyCount), dirtyCount ? '需要保存或放弃' : '没有草稿', dirtyCount ? 'warn' : 'good'),
            ],
          }),
          el('p', { class: 'muted compact', text: dirtyCount ? '保存后 Runner 会在短时间内读取新配置。' : '当前没有待保存修改。' }),
        ],
      }),
      el('article', {
        class: 'panel settings-overview-card',
        children: [
          panelHeader('常用操作', '优先处理连接、刷新和执行器状态。'),
          el('div', { class: 'settings-action-list', children: [refresh, checkBackend, startRunner] }),
          el('p', { class: 'muted compact', text: '高级配置在下方卡片中单项保存，历史记录按配置项查看。' }),
        ],
      }),
    ],
  });
}

function renderSettingsDiagnostics(): HTMLElement {
  const runner = latestRunner();
  return el('details', {
    class: 'panel settings-diagnostics',
    attrs: { 'data-details-key': 'settings-runtime-diagnostics' },
    children: [
      el('summary', { text: '运行环境详情' }),
      el('div', {
        class: 'settings-diagnostics-grid',
        children: [
          el('article', {
            class: 'inline-panel',
            children: [
              panelHeader('执行策略', 'Local Runner + Git worktree'),
              field('执行环境', '本机 JDK / Maven / Git'),
              field('隔离方式', 'Git worktree 隔离工作目录与分支'),
              field('质量边界', '真实命令 + Gate + Diff + Approval + Audit'),
              field('安全边界', '不做容器或微虚拟机级强制沙箱'),
            ],
          }),
          el('article', {
            class: 'inline-panel',
            children: [
              panelHeader('执行器诊断', runner ? `${runner.status} · ${fmtTime(runner.lastSeenAt)}` : '尚未连接'),
              runner
                ? el('div', { class: 'stack', children: data.runners.map(renderRunnerCard) })
                : el('p', { class: 'muted compact', text: '尚未收到 Runner heartbeat。需要时可启动执行器或在命令行排查。' }),
            ],
          }),
        ],
      }),
    ],
  });
}

function renderSettingsPage(): HTMLElement {
  if (!settingsConfig.loadedOnce && !settingsConfig.loading && !settingsConfig.error) {
    void loadSettingsConfig();
  }
  const vm = currentSettingsViewModel();

  return el('section', {
    class: 'settings-page stack',
    children: [renderSettingsOverview(vm), renderSettingsDiagnostics(), renderConfigSection(vm)],
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

async function submitApproval(
  workflowRunId: string,
  gateId: string,
  approved: boolean,
  comment?: string,
): Promise<void> {
  const key = `${workflowRunId}:${gateId}`;
  const now = Date.now();
  const last = approvalLastSubmittedAt.get(key) ?? 0;
  if (approvalInFlight.has(key) || now - last < 2_000) return;
  approvalInFlight.add(key);
  approvalLastSubmittedAt.set(key, now);
  render();
  try {
    const userComment = comment?.trim();
    const finalComment = userComment && userComment.length > 0
      ? userComment
      : approved
        ? 'approved via workbench UI'
        : 'rejected via workbench UI';
    await api('/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowRunId,
        gateId,
        approved,
        actor: 'web',
        comment: finalComment,
      }),
    });
    await loadRunDetail(workflowRunId, false);
    await loadData({ render: false, keepDetail: true });
    ui.lastError = null;
  } catch (err) {
    ui.lastError = errorMessage(err);
  } finally {
    approvalInFlight.delete(key);
    render();
  }
}

async function submitAcceptanceDecision(
  workflowRunId: string,
  decision: 'accept_risk' | 'reject',
  comment?: string,
): Promise<void> {
  const key = `${workflowRunId}:acceptance_gate`;
  if (approvalInFlight.has(key)) return;
  approvalInFlight.add(key);
  render();
  try {
    const userComment = comment?.trim();
    const finalComment = userComment && userComment.length > 0
      ? userComment
      : decision === 'accept_risk'
        ? 'risk accepted via workbench UI'
        : 'acceptance rejected via workbench UI';
    await api(`/workflow-runs/${encodeURIComponent(workflowRunId)}/acceptance-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decision,
        actor: 'web',
        comment: finalComment,
        payload: { source: 'acceptance-checklist' },
      }),
    });
    await loadRunDetail(workflowRunId, false);
    await loadData({ render: false, keepDetail: true });
  } catch (err) {
    ui.lastError = errorMessage(err);
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
    ui.lastError = errorMessage(err);
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
    knowledgeEditing.delete(key);
    knowledgeEditDrafts.delete(key);
    await loadRunDetail(workflowRunId, false);
    await loadData({ render: false, keepDetail: true });
  } catch (err) {
    ui.lastError = errorMessage(err);
  } finally {
    render();
  }
}

// ---- Agent Stream (SSE live tail) ----------------------------------------

interface AgentStreamEvent {
  id: string;
  workflowRunId: string | null;
  workflowRequestId?: string | null;
  stepRunId: string | null;
  agentKind: AgentBackendKind;
  sequence: number;
  type: 'system' | 'assistant' | 'user' | 'result' | 'stderr' | 'raw' | 'meta';
  payload: Record<string, unknown>;
  text: string | null;
  ts: string;
}

let streamES: EventSource | null = null;
let streamChannel: StreamChannel | null = null;
let expandedStreamRunId: string | null = null;
const streamEventsByChannel: StreamEventCache<AgentStreamEvent> = new Map();
let streamConnection: { channelKey: string | null; label: string; cls: 'live' | 'idle' | 'error' } = {
  channelKey: null,
  label: 'disconnected',
  cls: 'idle',
};
const STREAM_EVENT_TYPES = ['system', 'assistant', 'user', 'result', 'stderr', 'meta', 'raw'] as const;

function setStreamStatus(label: string, cls: 'live' | 'idle' | 'error', channel: StreamChannel | null = streamChannel): void {
  const channelKey = channel ? streamChannelKey(channel) : null;
  streamConnection = { channelKey, label, cls };
  updateStreamStatusNodes(channel, label, cls);
}

function appendStreamEvent(ev: AgentStreamEvent): void {
  if (!rememberStreamEvent(ev)) return;
  const channel = streamChannelForEvent(ev);
  if (!channel || !streamChannel || streamChannelKey(channel) !== streamChannelKey(streamChannel)) return;
  refreshStreamViewsForChannel(channel);
}

function rememberStreamEvent(ev: AgentStreamEvent): boolean {
  return rememberStreamEventInCache(streamEventsByChannel, ev);
}

function agentStreamEventsForChannel(channel: StreamChannel): AgentStreamEvent[] {
  return streamEventsForChannel(streamEventsByChannel, channel);
}

function lastStreamSeqForChannel(channel: StreamChannel): number {
  return lastStreamSequenceForChannel(streamEventsByChannel, channel);
}

interface AgentStreamViewModel {
  channel: StreamChannel | null;
  runId: string | null;
  title: string;
  summary: string;
  status: { label: string; cls: 'live' | 'idle' | 'error' };
  events: AgentStreamEvent[];
  lines: StreamDisplayLine[];
}

function buildAgentStreamView(channel: StreamChannel | null): AgentStreamViewModel {
  const events = channel ? agentStreamEventsForChannel(channel) : [];
  const runId = channel?.kind === 'run' ? channel.id : null;
  const backend = streamBackendForChannel(channel, events);
  const title = channel?.kind === 'request'
    ? '开发者日志'
    : backend === 'claude_code'
      ? 'Claude Code 执行日志'
      : backend === 'codex'
        ? 'Codex 执行日志'
        : 'Agent 执行日志';
  return {
    channel,
    runId,
    title,
    summary: streamSummaryText(channel, events.length),
    status: streamStatusForChannel(channel),
    events,
    lines: buildStreamDisplayLines(events),
  };
}

function buildAgentStreamViewForRun(runId: string | null): AgentStreamViewModel {
  return buildAgentStreamView(runId ? { kind: 'run', id: runId } : null);
}

function streamBackendForRun(runId: string | null, events: readonly AgentStreamEvent[]): AgentBackendKind | null {
  if (runId && data.activeDetail?.run.id === runId) {
    return activeRunAgentBackend() ?? events.at(-1)?.agentKind ?? selectedProjectBackend();
  }
  if (events.length > 0) return events.at(-1)?.agentKind ?? null;
  const run = runId ? data.runs.find((item) => item.id === runId) : null;
  return data.projects.find((project) => project.id === run?.projectId)?.agentBackend ?? selectedProjectBackend();
}

function streamBackendForChannel(channel: StreamChannel | null, events: readonly AgentStreamEvent[]): AgentBackendKind | null {
  if (events.length > 0) return events.at(-1)?.agentKind ?? null;
  if (channel?.kind === 'run') return streamBackendForRun(channel.id, events);
  const request = channel?.kind === 'request' ? data.requests.find((item) => item.id === channel.id) : null;
  return data.projects.find((project) => project.id === request?.projectId)?.agentBackend ?? selectedProjectBackend();
}

function streamRunTitle(runId: string | null): string | null {
  if (!runId) return null;
  if (data.activeDetail?.run.id === runId) return data.activeDetail.run.title;
  return data.runs.find((run) => run.id === runId)?.title ?? null;
}

function streamRequestTitle(requestId: string): string | null {
  return data.requests.find((request) => request.id === requestId)?.title ?? null;
}

function streamSummaryText(channel: StreamChannel | null, eventCount: number): string {
  if (!channel) return '等待 stream channel';
  if (channel.kind === 'request') {
    const requestTitle = streamRequestTitle(channel.id);
    return `${requestTitle ? `${requestTitle} · ` : ''}Request ${shortId(channel.id)} · ${eventCount} events`;
  }
  const runTitle = streamRunTitle(channel.id);
  return `${runTitle ? `${runTitle} · ` : ''}Run ${shortId(channel.id)} · ${eventCount} events`;
}

function streamViewAttrs(view: AgentStreamViewModel, role: 'title' | 'summary' | 'status' | 'body'): Record<string, string> {
  const attrs: Record<string, string> = { [`data-stream-${role}`]: 'agent-stream' };
  if (view.channel) attrs['data-stream-channel-key'] = streamChannelKey(view.channel);
  if (view.runId) attrs['data-stream-run-id'] = view.runId;
  return attrs;
}

function renderStreamTitle(view: AgentStreamViewModel, id?: string): HTMLElement {
  return el('h2', { id, text: view.title, attrs: streamViewAttrs(view, 'title') });
}

function renderStreamSummary(view: AgentStreamViewModel, id?: string): HTMLElement {
  return el('small', { id, class: 'muted', text: view.summary, attrs: streamViewAttrs(view, 'summary') });
}

function renderStreamStatus(view: AgentStreamViewModel): HTMLElement {
  return el('span', { class: `stream-status ${view.status.cls}`, text: view.status.label, attrs: streamViewAttrs(view, 'status') });
}

function renderAgentStreamBody(
  view: AgentStreamViewModel,
  opts: { id?: string; expanded?: boolean; scrollKeyPrefix: string },
): HTMLElement {
  const attrs = streamViewAttrs(view, 'body');
  if (view.channel) {
    const key = streamChannelKey(view.channel);
    attrs['data-scroll-key'] = `${opts.scrollKeyPrefix}:${key}`;
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
    scrollStreamBodiesToBottom({ kind: 'run', id: runId });
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

function refreshStreamViewsForChannel(channel: StreamChannel): void {
  const view = buildAgentStreamView(channel);
  const key = streamChannelKey(channel);
  document.querySelectorAll<HTMLElement>('[data-stream-title="agent-stream"]').forEach((node) => {
    if (node.dataset.streamChannelKey === key) node.textContent = view.title;
  });
  document.querySelectorAll<HTMLElement>('[data-stream-summary="agent-stream"]').forEach((node) => {
    if (node.dataset.streamChannelKey === key) node.textContent = view.summary;
  });
  document.querySelectorAll<HTMLElement>('[data-stream-body="agent-stream"]').forEach((body) => {
    if (body.dataset.streamChannelKey !== key) return;
    body.setAttribute('aria-label', `${view.title} ${view.summary}`);
    body.replaceChildren(...renderStreamBodyChildren(view));
    body.scrollTop = body.scrollHeight;
  });
}

function updateStreamStatusNodes(channel: StreamChannel | null, label: string, cls: 'live' | 'idle' | 'error'): void {
  const key = channel ? streamChannelKey(channel) : null;
  document.querySelectorAll<HTMLElement>('[data-stream-status="agent-stream"]').forEach((node) => {
    if ((node.dataset.streamChannelKey ?? null) !== key) return;
    node.textContent = label;
    node.className = `stream-status ${cls}`;
  });
}

function scrollStreamBodiesToBottom(channel: StreamChannel): void {
  const key = streamChannelKey(channel);
  document.querySelectorAll<HTMLElement>('[data-stream-body="agent-stream"]').forEach((body) => {
    if (body.dataset.streamChannelKey === key) body.scrollTop = body.scrollHeight;
  });
}

function focusStreamExpandButton(runId: string): void {
  document.querySelectorAll<HTMLButtonElement>('[data-stream-expand-run-id]').forEach((button) => {
    if (button.dataset.streamExpandRunId === runId) button.focus();
  });
}

function detachStream(): void {
  const detachedChannel = streamChannel;
  if (streamES) streamES.close();
  streamES = null;
  streamChannel = null;
  setStreamStatus('disconnected', 'idle', detachedChannel);
}

function attachStream(channel: StreamChannel): void {
  if (
    streamChannel &&
    streamChannelKey(streamChannel) === streamChannelKey(channel) &&
    streamES &&
    streamES.readyState !== EventSource.CLOSED
  ) return;
  const previousChannel = streamChannel;
  if (streamES) {
    streamES.close();
    setStreamStatus('disconnected', 'idle', previousChannel);
  }
  streamChannel = channel;
  setStreamStatus('connecting…', 'idle', channel);

  const sinceSeq = lastStreamSeqForChannel(channel);
  const endpoint = channel.kind === 'run'
    ? `/workflow-runs/${encodeURIComponent(channel.id)}/agent-stream`
    : `/workflow-requests/${encodeURIComponent(channel.id)}/agent-stream`;
  const es = new EventSource(`${API_BASE}${endpoint}?sinceSeq=${sinceSeq}`);
  streamES = es;
  es.addEventListener('ready', () => {
    if (streamES === es) setStreamStatus('live', 'live', channel);
  });
  es.addEventListener('ping', () => {
    if (streamES === es) setStreamStatus('live', 'live', channel);
  });
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
    if (streamES === es) setStreamStatus('reconnecting…', 'error', channel);
  };
}

function attachRunStream(runId: string): void {
  attachStream({ kind: 'run', id: runId });
}

function attachRequestStream(requestId: string): void {
  attachStream({ kind: 'request', id: requestId });
}

function syncActiveStreamSubscription(): void {
  if (ui.activePage === 'task') {
    const task = activeTaskRequest();
    if (!task) {
      detachStream();
      return;
    }
    if (task.workflowRunId) attachRunStream(task.workflowRunId);
    else if (shouldSubscribeRequestStream(task)) attachRequestStream(task.id);
    else detachStream();
    return;
  }
  if (ui.activePage === 'workbench' && ui.activeRunId) {
    attachRunStream(ui.activeRunId);
    return;
  }
  detachStream();
}

function streamStatusForChannel(channel: StreamChannel | null): { label: string; cls: 'live' | 'idle' | 'error' } {
  if (channel && streamConnection.channelKey === streamChannelKey(channel)) return streamConnection;
  return { label: 'disconnected', cls: 'idle' };
}

// Wire the extracted core modules back to the page code that still lives
// here: render-core needs the shell renderer + composer capture/restore,
// data-loading needs the SSE stream controller entry points. Both must be
// registered before the first loadData()/render() below.
setRenderHooks({
  renderShell,
  captureCoordinatorReplyComposerState,
  captureNewTaskFormState,
  restoreCoordinatorReplyComposerFocus,
  restoreNewTaskFormFocus,
});
setStreamHooks({
  syncActiveStreamSubscription,
  attachRunStream,
});

window.addEventListener('hashchange', async () => {
  parseHash();
  await loadData({ render: false, keepDetail: false });
  const task = activeTaskRequest();
  if (task?.workflowRunId) await loadRunDetail(task.workflowRunId, false);
  else if (ui.activeRunId && ui.activePage !== 'task') await loadRunDetail(ui.activeRunId, false);
  syncActiveStreamSubscription();
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
  if (ui.activePage === 'new-task' || ui.activePage === 'projects') {
    void loadData({ render: false, keepDetail: true });
    return;
  }
  void loadData({ render: true, keepDetail: true });
  if (ui.activeRunId) void loadRunDetail(ui.activeRunId, true);
  maybeAutoStartRunnerForActiveTask();
}, 3000);
