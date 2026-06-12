/**
 * Reports page — delivery report center rendering + page-private state.
 *
 * Owns `reportsActiveView`: which report tab (all/attention/acceptable/
 * running) is selected. Everything else is read-only projection over the
 * shared server state (`data.runs` / `data.requests` / `data.activeDetail`).
 * Renders the overview KPI cards, the tab bar, per-run report rows, and the
 * active completion-report detail. Moved verbatim out of `main.ts` (T2.2
 * page split; the only rewrite was mechanical: `ui.reportsActiveView`
 * became the module-scope `reportsActiveView` because the state is private
 * to this page). Depends only on the base layer (dom/state/router/
 * render-core/data-loading) plus the pure `projection` helpers.
 */

import {
  buildRunProjection,
  latestArtifactOfKind,
  parseCompletionReportArtifact,
  reportIsAcceptable,
  reportIsRunning,
  reportNeedsAttention,
  reportStats,
  reportStatusLabel,
  STAGE_LABELS,
  type WorkflowRunDto,
} from './projection';
import type { ReportViewId } from './types';
import {
  button,
  configSummaryItem,
  el,
  field,
  fmtTime,
  metric,
  panelHeader,
  pill,
  previewText,
  statusKind,
} from './dom';
import {
  data,
  markdownArtifactText,
  projectName,
  structuredArtifactText,
  ui,
} from './state';
import { actionLink, setHash } from './router';
import { render } from './render-core';
import { loadRunDetail } from './data-loading';

let reportsActiveView: ReportViewId = 'all';

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
  if (reportsActiveView === 'attention') return data.runs.filter(reportNeedsAttention);
  if (reportsActiveView === 'acceptable') return data.runs.filter(reportIsAcceptable);
  if (reportsActiveView === 'running') return data.runs.filter(reportIsRunning);
  return data.runs;
}

function setReportsView(view: ReportViewId): void {
  reportsActiveView = view;
  render();
}

export function renderReportsPage(): HTMLElement {
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
      const btn = button(tab.label, reportsActiveView === tab.id ? 'tab-button active' : 'tab-button');
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
