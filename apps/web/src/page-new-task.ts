/**
 * New-task page — task creation form rendering + page-private state.
 *
 * Owns the new-task draft state family (state-management spec: user-owned
 * drafts must survive the 3s polling render):
 *   - `newTaskFormDraft`: title/details/project/branch/type/flow/startStage
 *     draft, captured before every root rebuild and rehydrated after;
 *   - `newTaskTitleFocus`: one-shot focus/caret restore marker for the
 *     title/details controls (registered as render hooks by main.ts via
 *     `captureNewTaskFormState` / `restoreNewTaskFormFocus`);
 *   - `projectBranchRefreshInFlight`: per-project branch-refresh re-entry
 *     guard (moved here from state.ts in T2.3 — the new-task branch picker
 *     is its only consumer).
 * Renders the create-task form (smart-recommendation debounce card,
 * advanced flow/start-stage overrides, branch picker) and submits
 * workflow requests (`submitWorkflowRequest` + backend preflight via
 * `ensureProjectAgentBackendReady`). Moved verbatim out of `main.ts`
 * (T2.3 page split); depends on the base layer plus `coordinator-chat`
 * (kicks off `loadCoordinatorChat` right after creating a request).
 */

import { errorMessage } from '@ainp/shared/browser';
import type {
  ProjectBranchListResult,
  ProjectDto,
  ProjectAgentBackendKind,
  StatusKind,
  WorkflowRequestDto,
} from './types';
import { api } from './api';
import { button, el, normalizeSelectionDirection, panelHeader, pill, statusKind } from './dom';
import {
  activeProjects,
  agentBackendDisplayName,
  agentBackendPreflight,
  agentBackendPreflightInFlight,
  backendStatusText,
  data,
  latestRunner,
  normalizeBranchList,
  runnerAutoStartAttemptedForRequest,
  sourceBranchesForProject,
  ui,
} from './state';
import { actionLink } from './router';
import { render } from './render-core';
import { checkAgentBackend, ensureRunnerStarted, loadData } from './data-loading';
import { loadCoordinatorChat } from './coordinator-chat';
import { showSuccessToast } from './toast';

// Per-project branch-refresh re-entry guard (moved verbatim from state.ts,
// T2.3 page split — only this page reads/writes it).
const projectBranchRefreshInFlight = new Set<string>();

// 2026-05-06 fix(web): preserve new-task-form drafts across render().
// `checkAgentBackend()` and other server-state events trigger full root
// rebuilds; without this draft store the title textarea + dropdown
// selections silently reset, which the user perceives as a page refresh.
// Spec: .trellis/spec/web/frontend/state-management.md "Preserve user-owned
// drafts across polling renders".
export const newTaskFormDraft: {
  projectId: string;
  type: '' | 'feature' | 'bugfix' | 'smoke' | 'refactor' | 'ask';
  title: string;
  details: string;
  branch: string;
  agentBackend: '' | ProjectAgentBackendKind;
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
} = { projectId: '', type: '', title: '', details: '', branch: '', agentBackend: '', flowId: '', startStage: '' };

const NEW_TASK_TITLE_SELECTOR = '[data-new-task-title]';
const NEW_TASK_DETAILS_SELECTOR = '[data-new-task-details]';

let newTaskTitleFocus: {
  selector: typeof NEW_TASK_TITLE_SELECTOR | typeof NEW_TASK_DETAILS_SELECTOR;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: 'forward' | 'backward' | 'none';
} | null = null;

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

  // Check for the structured JSON error from the proxy
  if (error.includes('api proxy unavailable') || error.includes('ECONNREFUSED') || error.includes('connect ECONNREFUSED')) {
    return 'API 服务未启动或无法连接。请先启动 API 服务（bun run api），然后重试。';
  }

  if (isHtmlError) {
    return status
      ? `项目接口返回 ${status}，前端收到的是服务错误页。请确认 API 服务和代理正常后重试。`
      : '项目接口返回了服务错误页。请确认 API 服务和代理正常后重试。';
  }

  if (/failed to fetch|networkerror|load failed/i.test(error)) {
    return '无法连接项目接口。请确认 API 服务正在运行，然后重试。';
  }

  if (status === '502') {
    return 'API 服务网关错误。请确认 API 服务正在运行，然后重试。';
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
  const refresh = button('刷新', 'btn btn-secondary');
  refresh.onclick = () => void loadData({ keepDetail: true });
  return el('section', {
    class: 'page-grid two-col',
    children: [
      el('div', {
        class: 'empty-state new-task-empty',
        children: [
          el('h2', { text: '还没有项目' }),
          el('p', { text: '先接入一个代码仓库，就可以开始了。' }),
          el('div', { class: 'button-row', children: [actionLink('连接项目', 'projects'), refresh] }),
        ],
      }),
      renderNewTaskProcessPanel(),
    ],
  });
}

function buildNewTaskFirstMessage(title: string, details: string): string {
  return details ? `目标：${title}\n\n补充说明：\n${details}` : title;
}

export function renderNewTaskPage(): HTMLElement {
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
  // when they want to override the AI judgment (e.g. for refactor / smoke / ask
  // which the coordinator's rules may not pick up reliably).
  typeSelect.appendChild(el('option', { text: '(自动识别)', attrs: { value: '' } }));
  for (const type of ['feature', 'bugfix', 'smoke', 'refactor', 'ask']) typeSelect.appendChild(el('option', { text: type, attrs: { value: type } }));

  // 05-08 new-task-form-flow-startstage-override: explicit Flow override.
  // Mirrors the FLOW_REGISTRY entries in `packages/shared/src/flows/registry.ts`
  // (FlowId union). Empty value = "(让 router 推荐)" — runner Coordinator
  // + Router still drive flow selection. Non-empty value bypasses Coordinator
  // entirely (PRD Q1 = A): runner watch derives runType from FlowDef.kind.
  const flowSelect = el('select', { attrs: { name: 'flowId' } });
  flowSelect.appendChild(el('option', { text: '(自动推荐)', attrs: { value: '' } }));
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
  startStageSelect.appendChild(el('option', { text: '(从头开始)', attrs: { value: '' } }));
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
      placeholder: '例如：在用户服务中增加邮箱验证逻辑',
    },
  });
  const details = el('textarea', {
    class: 'new-task-details',
    attrs: {
      name: 'details',
      rows: '5',
      'data-new-task-details': 'true',
      placeholder: '可补充验收标准、约束、参考实现或不希望改变的模块。',
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
  const branchRefresh = el('button', { class: 'btn btn-secondary btn-sm', text: '刷新分支', attrs: { type: 'button' } });
  const branchHint = el('p', { class: 'muted compact' });
  const backendSelect = el('select', { attrs: { name: 'agentBackend' } });
  backendSelect.appendChild(el('option', { text: '请选择执行方式', attrs: { value: '' } }));
  for (const option of [
    { value: 'claude_code' as const, label: 'Claude Code' },
    { value: 'codex' as const, label: 'Codex' },
  ]) {
    backendSelect.appendChild(el('option', { text: option.label, attrs: { value: option.value } }));
  }
  const backendHint = el('p', { class: 'muted compact' });
  const backendCheck = el('button', { class: 'btn btn-secondary btn-sm', text: '检测连接', attrs: { type: 'button' } });
  const clickedBranchProjects = new Set<string>();
  const submit = el('button', { class: 'btn btn-primary', text: '创建任务', attrs: { type: 'submit' } });
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
  const recoCard = el('div', { class: 'inline-panel compact new-task-recommendation' });
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
    predictedRunType: 'feature' | 'bugfix' | 'smoke' | 'refactor' | 'ask' | null;
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
      | 'refactor'
      | 'ask';
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
      panelHeader('执行建议', '分析中…'),
      el('p', {
        class: 'muted compact',
        text: userOverrideType ? '将按你指定的类型执行。' : '供参考，提交后会按默认流程走。',
      }),
    );
    try {
      let runTypeForRouter: 'feature' | 'bugfix' | 'smoke' | 'refactor' | 'ask';
      let coordPreview: CoordinatorPreviewResponse | null = null;
      if (userOverrideType) {
        runTypeForRouter = userOverrideType || 'feature';
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
            ? '将按你指定的类型执行'
            : '供参考，提交后按默认流程',
        ),
      ];
      if (coordPreview) {
        const confPct = Math.round(coordPreview.confidence * 100);
        const aiVerdictText = coordPreview.predictedRunType
          ? coordPreview.predictedRunType === 'ask'
            ? `AI 判定: ask（只读问答）· 置信 ${confPct}%`
            : `AI 判定: ${coordPreview.predictedRunType} · 置信 ${confPct}%`
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
        // 06-25 ask-flow: hint when ask type detected
        if (coordPreview.predictedRunType === 'ask') {
          children.push(
            el('p', {
              class: 'muted compact',
              text: '📖 问答模式：不开分支、不改文件，只回答问题。',
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
    const selectedBackend = selectedTaskAgentBackend();
    const preflight = preflightForTaskBackend(project, selectedBackend);
    const runner = latestRunner();
    let blocker: string | null = null;
    if (ui.projectsLoadError) blocker = '项目列表加载失败，重试成功后才能创建任务。';
    else if (!project) blocker = '请先连接项目。';
    else if (!title.value.trim()) blocker = '请填写任务目标。';
    else if (!selectedBackend) blocker = '请选择本次任务的执行方式。';
    else if (preflight && !preflight.runnable) blocker = '执行方式连接检测未通过，请处理后重试。';

    submit.disabled = Boolean(blocker);
    submitHint.textContent = blocker
      ?? (runner ? '准备就绪，创建后会进入任务工作流。' : '本地执行器当前未连接，创建后会尝试自动启动；需要时可到运行配置检查。');
    submitHint.className = `compact ${blocker ? 'warn' : runner ? 'good' : 'muted'}`;
    readiness.replaceChildren(
      pill(project ? '项目已选择' : ui.projectsLoadError ? '项目加载失败' : '等待项目', project ? 'good' : ui.projectsLoadError ? 'bad' : 'warn'),
      pill(selectedBackend ? '执行方式已选择' : '执行方式待选择', selectedBackend ? 'good' : 'warn'),
      pill(runner ? '执行器在线' : '执行器待启动', runner ? statusKind(runner.status) : 'warn'),
    );
  };
  const selectedTaskAgentBackend = (): ProjectAgentBackendKind | null => {
    return backendSelect.value === 'claude_code' || backendSelect.value === 'codex'
      ? backendSelect.value
      : null;
  };
  const preflightForTaskBackend = (
    project: ProjectDto | null,
    backend: ProjectAgentBackendKind | null,
  ) => {
    if (!backend) return null;
    const projectScoped = project ? agentBackendPreflight.get(project.id) : null;
    if (projectScoped?.backend === backend) return projectScoped;
    const backendScoped = agentBackendPreflight.get(`backend:${backend}`);
    return backendScoped?.backend === backend ? backendScoped : null;
  };
  const backendStatusForTaskSelection = (
    project: ProjectDto | null,
    backend: ProjectAgentBackendKind | null,
  ): { label: string; kind: StatusKind } => {
    if (!backend) return { label: '待选择', kind: 'warn' };
    const check = preflightForTaskBackend(project, backend);
    if (!check) return { label: '未检测', kind: 'muted' };
    if (check.runnable) return { label: '已连接', kind: 'good' };
    if (check.status === 'needs_login') return { label: '需要登录', kind: 'warn' };
    if (check.status === 'missing_cli') return { label: '缺少 CLI', kind: 'bad' };
    return { label: '检测失败', kind: 'bad' };
  };
  const updateBackendHint = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
    const selectedBackend = selectedTaskAgentBackend();
    const status = backendStatusForTaskSelection(project, selectedBackend);
    backendHint.textContent = selectedBackend
      ? `${agentBackendDisplayName(selectedBackend)} · ${backendStatusText(status.label)}。本次任务会使用该执行方式，不会修改项目默认。`
      : project?.agentBackend
        ? `默认使用 ${agentBackendDisplayName(project.agentBackend)}；也可以为本次任务切换到另一种执行方式。`
        : '请选择本次任务执行方式。项目默认仍可稍后到“项目接入”里配置。';
    backendHint.className = `muted compact ${status.kind}`;
    backendCheck.disabled = !project || !selectedBackend || agentBackendPreflightInFlight.has(project.id);
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
  const updateBackendSelectForProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
    const nextBackend = project?.agentBackend ?? '';
    backendSelect.value = nextBackend;
    newTaskFormDraft.agentBackend = nextBackend;
    updateBackendHint(projectId);
  };
  const refreshBranches = (projectId: string, force = false) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project || (!force && sourceBranchesForProject(project).length > 1)) return;
    void refreshProjectBranches(project.id, () => updateBranchSelect(projectSelect.value, branchSelect.value));
  };
  projectSelect.onchange = () => {
    updateBranchSelect(projectSelect.value, null);
    updateBackendSelectForProject(projectSelect.value);
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
    const selectedBackend = selectedTaskAgentBackend();
    if (!project || !selectedBackend) return;
    void checkAgentBackend(selectedBackend, project.id).then(() => updateBackendHint(projectSelect.value));
  };
  backendSelect.onchange = () => {
    newTaskFormDraft.agentBackend = selectedTaskAgentBackend() ?? '';
    updateBackendHint(projectSelect.value);
  };
  // Initial mount: honor the saved draft branch when it still exists for the
  // current project (otherwise updateBranchSelect falls back to the project
  // default). This is the path that survives render() rebuilds.
  updateBranchSelect(projectSelect.value, newTaskFormDraft.branch || null);
  if (newTaskFormDraft.agentBackend) {
    backendSelect.value = newTaskFormDraft.agentBackend;
    updateBackendHint(projectSelect.value);
  } else {
    updateBackendSelectForProject(projectSelect.value);
  }
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
        el('div', { class: 'branch-select-row', children: [backendSelect, backendCheck] }),
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
  const retryProjects = button('重试', 'btn btn-secondary btn-sm');
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
  const composer = el('section', {
    class: 'new-task-composer',
    children: [
      el('label', { class: 'input-block new-task-project-row', children: [el('span', { text: '项目' }), projectSelect, projectIssue] }),
      el('label', { class: 'input-block new-task-title-block', children: [el('span', { text: '任务目标' }), title] }),
      el('label', { class: 'input-block new-task-details-block', children: [el('span', { text: '补充说明（可选）' }), details] }),
    ],
  });
  const submitGuard = el('section', {
    class: 'new-task-submit-guard',
    children: [
      el('div', {
        children: [
          el('span', { class: 'eyebrow', text: 'Submit Guard' }),
          el('h3', { text: '创建前检查' }),
          submitHint,
        ],
      }),
      readiness,
    ],
  });
  form.append(
    panelHeader('创建任务', '只需要说明目标；工程设置默认自动处理。'),
    composer,
    recoCard,
    advanced,
  );
  if (submitIssue) form.append(submitIssue);
  form.append(
    submitGuard,
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
    const agentBackendOverride = String(fd.get('agentBackend') ?? '').trim() as ProjectAgentBackendKind | '';
    const ready = await ensureProjectAgentBackendReady(project, agentBackendOverride || null);
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
        ...(agentBackendOverride && { agentBackend: agentBackendOverride }),
        ...(typeOverride && { type: typeOverride }),
        ...(flowOverride && { flowId: flowOverride }),
        ...(startStageOverride && { startStage: startStageOverride }),
        // 06-25 ask-flow: when user selects 'ask' type, set kind='ask'
        ...(typeOverride === 'ask' && { kind: 'ask' as const }),
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
    // Success is surfaced via an auto-dismissing toast.
    showSuccessToast(`任务"${request.title}"创建成功！AI 正在执行中，你可以在任务详情页查看实时进度。`);
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

async function ensureProjectAgentBackendReady(
  project: ProjectDto,
  selectedBackend: ProjectAgentBackendKind | null,
): Promise<boolean> {
  if (!selectedBackend) {
    ui.lastError = '请选择本次任务的执行方式。';
    render();
    return false;
  }
  const cached = agentBackendPreflight.get(project.id);
  if (cached?.backend === selectedBackend && cached.runnable) return true;
  const checked = await checkAgentBackend(selectedBackend, project.id);
  if (checked?.runnable) return true;
  if (!checked) {
    ui.lastError = '执行方式连接检测未完成，任务不会入队。';
  }
  render();
  return false;
}

export function captureNewTaskFormState(root: HTMLElement): void {
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

export function restoreNewTaskFormFocus(root: HTMLElement): void {
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
  newTaskFormDraft.agentBackend = '';
  newTaskFormDraft.flowId = '';
  newTaskFormDraft.startStage = '';
  newTaskTitleFocus = null;
}
