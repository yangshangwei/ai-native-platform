/**
 * Knowledge page — knowledge-asset workspace rendering + page-private state.
 *
 * Owns the knowledge* state family:
 *   - `knowledgeArtifactsState`: per-project accepted-knowledge cache
 *     (filled by `loadKnowledgeArtifacts`, which lives here because only
 *     this page mutates that state);
 *   - `knowledgeDecisions` / `knowledgeEdits` / `knowledgeEditing` /
 *     `knowledgeEditDrafts`: suggestion decision + editor draft Maps/Sets
 *     keyed by `${runId}:${index}` (state-management spec: drafts survive
 *     polling renders);
 *   - `knowledgeActiveView`: which tab (pending/accepted/usage/maintenance)
 *     is selected.
 * The IME composition guard for the suggestion editor intentionally stays
 * in `state.ts` (`ui.knowledgeEditComposing` / `ui.knowledgeEditRenderDeferred`)
 * because `render()` in render-core must check it before any rebuild; this
 * module only reads/writes those flags through `ui`, so the render-core
 * read path is unchanged and no import cycle is introduced.
 * `renderKnowledgeSuggestion` / `knowledgeSuggestionItems` /
 * `currentKnowledgeArtifacts` / `knowledgeArtifactsState` are also consumed
 * by main.ts (task-detail panel + sidebar summary); that import stays
 * one-way (main.ts → this module). Moved verbatim out of `main.ts` /
 * `state.ts` / `data-loading.ts` (T2.2 page split); the only rewrite was
 * mechanical: `ui.knowledgeActiveView` became the module-scope
 * `knowledgeActiveView`.
 */

import { errorMessage } from '@ainp/shared';
import type { KnowledgeSuggestion, RunDetail } from './projection';
import type {
  KnowledgeActionDecision,
  KnowledgeArtifactDto,
  KnowledgeArtifactsState,
  KnowledgeSuggestionItem,
  KnowledgeViewId,
  ProjectDto,
  StatusKind,
} from './types';
import { api } from './api';
import {
  button,
  configSummaryItem,
  el,
  field,
  fmtTime,
  metric,
  panelHeader,
  pill,
  shortId,
} from './dom';
import { data, parsedKnowledge, selectedProject, ui } from './state';
import { setHash } from './router';
import { render } from './render-core';
import { loadData, loadRunDetail, submitApproval } from './data-loading';

export const knowledgeArtifactsState: KnowledgeArtifactsState = {
  projectId: null,
  loading: false,
  loadedOnce: false,
  error: null,
  artifacts: [],
};
const knowledgeDecisions = new Map<string, KnowledgeActionDecision>();
const knowledgeEdits = new Map<string, string>();
const knowledgeEditing = new Set<string>();
const knowledgeEditDrafts = new Map<string, string>();
let knowledgeActiveView: KnowledgeViewId | null = null;

export async function loadKnowledgeArtifacts(projectId: string, shouldRender = true): Promise<void> {
  if (knowledgeArtifactsState.loading && knowledgeArtifactsState.projectId === projectId) return;
  const staleProject = knowledgeArtifactsState.projectId !== projectId;
  knowledgeArtifactsState.projectId = projectId;
  knowledgeArtifactsState.loading = true;
  knowledgeArtifactsState.error = null;
  if (staleProject) {
    knowledgeArtifactsState.loadedOnce = false;
    knowledgeArtifactsState.artifacts = [];
  }
  try {
    const body = await api<{ ok: boolean; artifacts: KnowledgeArtifactDto[] }>(
      `/knowledge-artifacts/projects/${encodeURIComponent(projectId)}`,
    );
    knowledgeArtifactsState.artifacts = [...(body.artifacts ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    knowledgeArtifactsState.loadedOnce = true;
  } catch (err) {
    knowledgeArtifactsState.error = errorMessage(err);
    knowledgeArtifactsState.artifacts = [];
  } finally {
    knowledgeArtifactsState.loading = false;
  }
  if (shouldRender && ui.activePage === 'knowledge') render();
}

export function currentKnowledgeArtifacts(): KnowledgeArtifactDto[] {
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

function knowledgeDecision(value: string | undefined): KnowledgeActionDecision | undefined {
  if (value === 'accepted' || value === 'edited' || value === 'ignored') return value;
  return undefined;
}

export function knowledgeSuggestionItems(detail: RunDetail, suggestions: KnowledgeSuggestion[]): KnowledgeSuggestionItem[] {
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

export function renderKnowledgeSuggestion(item: KnowledgeSuggestionItem, detail: RunDetail): HTMLElement {
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
  knowledgeActiveView = view;
  render();
}

function selectedKnowledgeView(pendingCount: number): KnowledgeViewId {
  if (knowledgeActiveView) return knowledgeActiveView;
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

export function renderKnowledgePage(): HTMLElement {
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

export async function submitKnowledgeAction(
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
