/**
 * Task-detail page — the full per-request workflow view + page-private state.
 *
 * Renders everything under `#task/<requestId>`: hero + focus summary,
 * queued/real lifecycle stage boards, the current-stage panel (requirement /
 * design / implementation / build-test / acceptance / knowledge / agent
 * stages), context-governance disclosure, stage backend details, evidence
 * panel with inline artifact viewers, approval / acceptance / requirement
 * mutation actions, the runner-control panel, the agent-stream side panel,
 * and the `promptRejectReason` modal (mounted under document.body so a
 * polling render cannot wipe it mid-flow).
 *
 * Page-private state:
 *   - `retryInFlight`: stage-retry / gate-re-evaluate re-entry guard
 *     (moved here from mid-file main.ts in T2.3).
 * Shared caches (artifactContent / openArtifactViewers / commandLogs /
 * approvalInFlight / contextGovernanceByRun) stay in `state.ts` — they are
 * filled by the base data-loading layer. The coordinator clarification
 * panel comes from `coordinator-chat.ts`; the live agent stream comes from
 * `stream.ts`. Moved verbatim out of `main.ts` (T2.3 page split).
 */

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
  parseRequirementArtifact,
  type ArtifactDto,
  type DesignDoc,
  type GateRunDto,
  type ReportableStatus,
  type RequirementDoc,
  type RunDetail,
  type Stage,
} from './projection';
import { errorMessage } from '@ainp/shared/browser';
import type {
  AgentBackendKind,
  ContextGovernanceDto,
  ContextManifestDto,
  DigestVerificationDto,
  ProjectDto,
  StatusKind,
  WorkflowRequestDto,
} from './types';
import { api } from './api';
import {
  button,
  el,
  field,
  fmtTime,
  metric,
  panelHeader,
  pill,
  previewText,
  shortId,
  statusKind,
} from './dom';
import {
  activeTaskRequest,
  agentBackendDisplayName,
  approvalInFlight,
  artifactContent,
  artifactText,
  commandLogs,
  contextGovernanceByRun,
  data,
  latestRunner,
  markdownArtifactText,
  openArtifactViewers,
  parsedKnowledge,
  projectName,
  requestStatusLabel,
  structuredArtifactText,
  ui,
} from './state';
import { actionLink } from './router';
import { render } from './render-core';
import {
  ensureArtifactContent,
  ensureCommandLogs,
  ensureRunnerStarted,
  loadData,
  loadRunDetail,
  submitApproval,
} from './data-loading';
import { knowledgeSuggestionItems, renderKnowledgeSuggestion } from './page-knowledge';
import {
  buildAgentStreamView,
  buildAgentStreamViewForRun,
  expandedStreamRunId,
  openExpandedStream,
  renderAgentStreamBody,
  renderStreamStatus,
  renderStreamSummary,
  renderStreamTitle,
  renderStreamVerbosityToggle,
} from './stream';
import {
  clearCoordinatorReplyComposerState,
  coordinatorChats,
  loadCoordinatorChat,
  renderCoordinatorChatPanel,
} from './coordinator-chat';

function requestTypeLabel(type: WorkflowRequestDto['type'] | string): string {
  if (type === 'feature') return '功能需求';
  if (type === 'bugfix') return '问题修复';
  if (type === 'smoke') return '冒烟检查';
  if (type === 'refactor') return '重构任务';
  if (type === 'ask') return '问答';
  return type;
}

function isAskRouted(request: WorkflowRequestDto): boolean {
  if (request.kind === 'ask') return true;
  const state = coordinatorChats.get(request.id);
  const decision = state?.decision?.decision;
  return decision?.action === 'proceed' && decision.routeCase === 'ask';
}

function renderAskActivityIndicator(request: WorkflowRequestDto): HTMLElement | null {
  const status = request.status;
  if (status === 'completed' || status === 'cancelled') {
    return null;
  }
  const streamView = buildAgentStreamView({ kind: 'request', id: request.id });
  const latestLine = streamView.lines.at(-1);
  const isActive = streamView.status.cls === 'live' || streamView.events.length > 0;
  if (!isActive && status !== 'awaiting_clarification') return null;
  const label = streamView.status.cls === 'live' ? 'AI 正在回答' : '问答模式';
  const hint = latestLine?.text.trim() || '不开分支、不改文件，只回答问题。';
  return el('section', {
    class: 'panel ask-activity-panel',
    children: [
      panelHeader('问答模式', '轻量流程 · 无阶段'),
      el('div', {
        class: 'ask-activity-indicator',
        children: [
          el('strong', { text: label }),
          el('p', { class: 'muted', text: hint }),
        ],
      }),
    ],
  });
}

function renderAskNextActionPanel(request: WorkflowRequestDto): HTMLElement {
  const done = request.status === 'completed' || request.status === 'cancelled';
  return el('section', {
    class: 'panel side-panel',
    children: [
      panelHeader('下一步', done ? '问答已结束' : '等待回答'),
      el('p', {
        text: done
          ? '问答请求已经结束；可在对话记录中查看已保存内容。'
          : '问答模式不会启动 Runner、创建分支或进入阶段流程；回答会出现在对话区。',
      }),
    ],
  });
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
  if (isAskRouted(request)) {
    if (request.status === 'completed') return { label: '问答已完成', hint: '回答已生成，可查看对话记录', kind: 'good' };
    if (request.status === 'cancelled') return { label: '问答已取消', hint: '请求已结束', kind: 'muted' };
    return { label: '问答模式', hint: '不开分支、不改文件，只回答问题', kind: 'info' };
  }
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
  // R2 (T2.4): 'completed' is a WorkflowRequestStatus value the API never
  // writes onto a run (see task notes.md evidence chain). The historical
  // defensive comparison is kept verbatim; the run is read through an alias
  // whose declared status type is the wider ReportableStatus — a checked
  // assignment (WorkflowRunStatus ⊂ ReportableStatus), no `as` cast. Zero
  // runtime behavior change.
  const widenedRun: { status: ReportableStatus } = detail.run;
  if (widenedRun.status === 'passed' || widenedRun.status === 'completed') {
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

export function renderTaskDetailPage(): HTMLElement {
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
  const askRouted = isAskRouted(request);
  if (detail) clearCoordinatorReplyComposerState(request.id);
  const coordinatorPanel = renderCoordinatorChatPanel(request);
  const nextActionPanel = () => askRouted ? renderAskNextActionPanel(request) : renderTaskNextActionPanel(request, detail, projection);
  return el('section', {
    class: 'task-detail-grid',
    children: [
      el('div', {
        class: 'workspace-main',
        children: [
          renderTaskHero(request, detail, projection),
          el('div', { class: 'mobile-next-action', children: [nextActionPanel()] }),
          coordinatorPanel,
          askRouted
            ? renderAskActivityIndicator(request)
            : detail ? renderLifecycle(detail, projection!) : renderQueuedLifecycle(request),
          askRouted ? null : renderCurrentStagePanel(request, detail, projection),
          askRouted ? null : detail ? renderContextGovernancePanel(detail) : null,
          askRouted ? null : (detail ? renderStageBackendDetails(detail, projection!) : renderQueuedBackendDetails(request)),
        ],
      }),
      el('aside', {
        class: 'workspace-side',
        children: [
          el('div', { class: 'desktop-next-action', children: [nextActionPanel()] }),
          askRouted ? renderRequestDebugPanel(request, 'ask-side-panel') : (detail ? renderEvidencePanel(detail) : renderRequestDebugPanel(request, 'side-panel')),
          askRouted ? null : renderRunnerControlPanel(),
          askRouted ? null : detail ? renderAgentStreamPanel() : null,
        ],
      }),
    ],
  });
}

function renderTaskHero(
  request: WorkflowRequestDto,
  detail: RunDetail | null,
  projection: ReturnType<typeof buildRunProjection> | null,
): HTMLElement {
  const status = detail?.run.status ?? request.status;
  const askRouted = isAskRouted(request);
  const current = askRouted
    ? request.status === 'completed'
      ? '回答已完成'
      : request.status === 'cancelled'
        ? '问答已取消'
        : '等待回答'
    : detail && projection ? STAGE_LABELS[projection.currentStage] : request.status === 'pending' ? '等待本地 Runner 自动认领' : 'Runner 已认领，正在准备运行';
  const focus = taskFocusSummary(request, detail, projection);
  const progress = taskProgressMetric(projection);
  const metrics = askRouted
    ? [
        metric('当前关注', focus.label, focus.hint, focus.kind),
        metric('问答状态', current, requestStatusLabel(request.status), statusKind(request.status)),
        metric('执行方式', '只读回答', '不开分支、不创建 Workflow Run', 'info' as const),
        metric('所属项目', projectName(request.projectId), requestTypeLabel(request.type), 'info' as const),
      ]
    : [
        metric('当前关注', focus.label, focus.hint, focus.kind),
        metric('当前阶段', current, projection ? STAGE_HELP[projection.currentStage] : '系统会自动进入主流程', detail ? statusKind(detail.run.status) : statusKind(request.status)),
        metric('任务进度', progress.value, progress.hint, progress.kind),
        metric('所属项目', projectName(request.projectId), requestTypeLabel(request.type), 'info'),
      ];
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
            text: askRouted
              ? `${focus.hint}。当前状态是 ${current}。`
              : detail
              ? `${focus.hint}。当前阶段是 ${current}。`
              : `${focus.hint}。当前阶段是 ${current}。`,
          }),
          renderTaskTechnicalSummary(request, detail, status),
        ],
      }),
      el('div', {
        class: 'metric-grid',
        children: metrics,
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

  // When current stage is failed, show actionable guidance
  if (detail.run.status === 'failed') {
    return renderFailedStageActionPanel(detail, projection);
  }

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
          const card = el('article', {
            class: `stage-card ${stage.state}`,
            children: [
              el('span', { class: 'stage-index', text: String(index + 1).padStart(2, '0') }),
              el('strong', { text: stage.label }),
              el('small', { text: stage.state === 'failed' ? '⚠️ 点击查看详情' : stageCardHint(stage.state) }),
              el('span', { class: `stage-state ${stage.state}`, text: stageStateLabel(stage.state) }),
            ],
          });
          if (stage.state === 'failed') {
            card.style.cursor = 'pointer';
            card.onclick = () => {
              const panel = document.querySelector('.current-stage-panel');
              if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            };
          }
          return card;
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

  // Render document preview for the pending gate
  const docPreview = renderGateDocumentPreview(detail, pendingGate);

  return el('section', {
    class: 'panel side-panel checkpoint',
    children: [
      panelHeader('等待你确认', copy.subtitle),
      el('p', { text: copy.description }),
      docPreview,
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

function renderGateDocumentPreview(detail: RunDetail, gateId: string): HTMLElement | null {
  if (gateId === 'requirement_gate') {
    const req = parsedRequirement(detail);
    const hasContent = req.goals.length || req.acceptanceCriteria.length || req.nonGoals.length || req.openQuestions.length;

    if (!hasContent) {
      return el('p', { class: 'muted compact', text: '需求文档正在生成中...' });
    }

    return el('details', {
      class: 'checkpoint-doc-preview',
      attrs: { open: 'true' },
      children: [
        el('summary', { text: '📄 查看需求文档' }),
        el('div', {
          class: 'checkpoint-doc-content',
          children: [
            req.goals.length ? renderCompactTextList('🎯 目标', req.goals) : null,
            req.acceptanceCriteria.length ? renderCompactAcList('✓ 验收标准', req.acceptanceCriteria) : null,
            req.nonGoals.length ? renderCompactTextList('⊘ 非目标', req.nonGoals) : null,
            req.openQuestions.length ? renderCompactTextList('❓ 待确认', req.openQuestions) : null,
          ],
        }),
      ],
    });
  }

  if (gateId === 'design_gate') {
    const design = parsedDesign(detail);
    const hasContent = design.coverage.length || design.testStrategy.length || design.risks.length || design.filesTouched.length;

    if (!hasContent) {
      return el('p', { class: 'muted compact', text: '方案文档正在生成中...' });
    }

    return el('details', {
      class: 'checkpoint-doc-preview',
      attrs: { open: 'true' },
      children: [
        el('summary', { text: '📄 查看方案文档' }),
        el('div', {
          class: 'checkpoint-doc-content',
          children: [
            design.coverage.length ? el('div', { class: 'checkpoint-section', children: [el('strong', { text: '📊 需求覆盖' }), el('p', { class: 'compact', text: `${design.coverage.length} 项需求已覆盖` })] }) : null,
            design.testStrategy.length ? renderCompactTextList('🧪 测试策略', design.testStrategy) : null,
            design.risks.length ? renderCompactTextList('⚠️ 风险', design.risks) : null,
            design.filesTouched.length ? el('div', { class: 'checkpoint-section', children: [el('strong', { text: '📝 影响文件' }), el('p', { class: 'compact', text: `${design.filesTouched.length} 个文件` })] }) : null,
          ],
        }),
      ],
    });
  }

  if (gateId === 'acceptance_gate') {
    const req = parsedRequirement(detail);
    const design = parsedDesign(detail);
    const checklist = buildAcceptanceChecklist(req, design, detail);
    const passedCount = checklist.filter(ac => ac.status === 'passed').length;
    const totalCount = checklist.length;

    if (totalCount === 0) {
      return el('p', { class: 'muted compact', text: '验收报告正在生成中...' });
    }

    return el('details', {
      class: 'checkpoint-doc-preview',
      attrs: { open: 'true' },
      children: [
        el('summary', { text: `📄 查看验收报告 (${passedCount}/${totalCount} 通过)` }),
        el('div', {
          class: 'checkpoint-doc-content',
          children: [
            el('div', {
              class: 'acceptance-list',
              children: checklist.slice(0, 8).map(ac =>
                el('div', {
                  class: `acceptance-card ${ac.status}`,
                  children: [
                    el('div', { children: [pill(ac.id, ac.status === 'passed' ? 'good' : ac.status === 'at_risk' ? 'warn' : 'bad'), el('strong', { text: ` ${ac.text}` })] }),
                    ac.evidence.length ? el('small', { class: 'muted', text: `证据: ${ac.evidence.join(' · ')}` }) : el('small', { class: 'warn', text: '缺少证据' }),
                    ac.risk ? el('small', { class: 'warn', text: ac.risk }) : null,
                  ],
                }),
              ),
            }),
            totalCount > 8 ? el('p', { class: 'muted compact', text: `还有 ${totalCount - 8} 项验收标准，查看主面板了解详情。` }) : null,
          ],
        }),
      ],
    });
  }

  return null;
}

function renderCompactTextList(title: string, items: string[]): HTMLElement {
  return el('div', {
    class: 'checkpoint-section',
    children: [
      el('strong', { text: title }),
      el('ul', {
        class: 'checkpoint-list',
        children: items.slice(0, 5).map(item => el('li', { text: item })),
      }),
      items.length > 5 ? el('p', { class: 'muted compact', text: `还有 ${items.length - 5} 项，查看主面板了解详情。` }) : null,
    ],
  });
}

function renderCompactAcList(title: string, items: Array<{ id: string; text: string }>): HTMLElement {
  return el('div', {
    class: 'checkpoint-section',
    children: [
      el('strong', { text: title }),
      el('ul', {
        class: 'checkpoint-list',
        children: items.slice(0, 5).map(item => el('li', { children: [el('code', { text: item.id }), document.createTextNode(` ${item.text}`)] })),
      }),
      items.length > 5 ? el('p', { class: 'muted compact', text: `还有 ${items.length - 5} 项，查看主面板了解详情。` }) : null,
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
            children: [renderStreamVerbosityToggle(), renderStreamStatus(view), expandButton],
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

function renderFailedStageActionPanel(
  detail: RunDetail,
  projection: ReturnType<typeof buildRunProjection>,
): HTMLElement {
  const stage = projection.currentStage;
  const failedGate = [...detail.gates]
    .reverse()
    .find((g) => g.status === 'fail' && (g.gateId === STAGE_TO_GATE[stage] || g.stepRunId === detail.steps.find(s => s.stage === stage)?.id));
  const failedBuild = detail.builds.find((b) => b.status === 'failed');
  const failedCommand = detail.commands.find((c) => c.exitCode !== 0 && c.exitCode !== null);

  const failureReasons: string[] = [];
  if (failedGate) {
    const failedRules = failedGate.ruleResults.filter((r) => r.status === 'fail');
    failureReasons.push(`质量门禁失败：${failedRules.map((r) => ruleLabel(r.ruleId)).join('、')}`);
  }
  if (failedBuild) {
    failureReasons.push(`构建失败：${failedBuild.mavenCommand}`);
  }
  if (failedCommand) {
    failureReasons.push(`命令执行失败 (exit ${failedCommand.exitCode})：${failedCommand.command}`);
  }

  const scrollToStage = button('查看失败详情', 'button secondary');
  scrollToStage.onclick = () => {
    const panel = document.querySelector('.current-stage-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const retryBtn = button('重试该阶段', 'button primary');
  retryBtn.onclick = async () => {
    const retryKey = `${detail.run.id}:${stage}`;
    retryInFlight.add(retryKey);
    render();
    try {
      await api(`/workflow-runs/${encodeURIComponent(detail.run.id)}/retry-step`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage, actor: 'web' }),
      });
      await api('/runner/control/retry-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflowRunId: detail.run.id, stage }),
      }).catch(() => {});
      await loadRunDetail(detail.run.id, false);
      await loadData({ render: false, keepDetail: true });
    } catch (err) {
      ui.lastError = errorMessage(err);
    } finally {
      retryInFlight.delete(retryKey);
      render();
    }
  };

  return el('section', {
    class: 'panel side-panel checkpoint',
    children: [
      panelHeader('需要处理', `${STAGE_LABELS[stage]}出现失败`),
      el('p', { text: '该阶段执行失败，请查看详情后决定是否重试。' }),
      failureReasons.length
        ? el('ul', {
            class: 'clean-list',
            children: failureReasons.map((reason) => el('li', { text: reason })),
          })
        : el('p', { class: 'muted compact', text: '正在分析失败原因...' }),
      el('div', { class: 'button-row', children: [scrollToStage, retryBtn] }),
    ],
  });
}
