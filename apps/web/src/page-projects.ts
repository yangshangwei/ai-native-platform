/**
 * Projects page — project onboarding/editing rendering + page-private state.
 *
 * Owns the project-form state family (moved out of `state.ts`, T2.3 page
 * split, because only this page reads/writes it):
 *   - `projectSourceForm`: the onboarding/edit form draft (source kind,
 *     auth fields, detect result, default branch) — user-owned draft state
 *     that must survive polling renders (state-management spec);
 *   - `localDirectoryPicker`: open/loading/error/listing state of the
 *     local-directory browser;
 *   - `projectActionInFlight`: per-project delete/archive re-entry guard.
 * Renders the three-step onboarding form, source detection panel, project
 * cards (edit prefill / delete / archive / backend preflight) and the
 * toolchain diagnostics. Moved verbatim out of `main.ts` (T2.3 page split);
 * depends only on the base layer (api/dom/state/render-core/data-loading)
 * plus pure `projection` helpers.
 */

import { errorMessage } from '@ainp/shared/browser';
import { latestArtifactOfKind, type ArtifactDto } from './projection';
import type {
  AgentBackendPreflightDto,
  LocalDirectoryList,
  LocalDirectoryPickerState,
  ProjectAgentBackendKind,
  ProjectDeletePreviewDto,
  ProjectDto,
  ProjectSourceAuthKind,
  ProjectSourceFormState,
  ProjectSourceKind,
  SourceDetectResult,
  StatusKind,
  WorkflowRequestDto,
  KnowledgeArtifactDto,
} from './types';
import { api } from './api';
import {
  controlledInput,
  el,
  field,
  fmtTime,
  panelHeader,
  pill,
  previewText,
  shortId,
  statusKind,
} from './dom';
import {
  agentBackendDisplayName,
  agentBackendPreflight,
  agentBackendPreflightInFlight,
  agentBackendStatusForProject,
  artifactContent,
  backendStatusText,
  data,
  latestRunner,
  normalizeBranchList,
  openArtifactViewers,
  projectAvailability,
  requestStatusLabel,
  sourceBranchesForProject,
  ui,
} from './state';
import { render } from './render-core';
import { checkAgentBackend, ensureArtifactContent, formAgentBackendKey, loadData } from './data-loading';
import { knowledgeArtifactsState, loadKnowledgeArtifacts } from './page-knowledge';
import { setHash } from './router';
import { showSuccessToast } from './toast';

// Page-private mutable state (moved verbatim from state.ts, T2.3 page split).
const projectActionInFlight = new Set<string>();
const projectProfileActionInFlight = new Set<string>();
const projectCapabilityActionInFlight = new Set<string>();
const projectCapabilityCorrections = new Map<string, 'accepted' | 'renamed' | 'merged' | 'wrong'>();

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
  buildCompileCommand: '',
  buildTestCommand: '',
  detectResult: null,
  detecting: false,
  submitting: false,
};

export function renderProjectsPage(): HTMLElement {
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
    panelHeader(isEditing ? '编辑项目' : '接入项目', isEditing ? '修改来源、分支或执行方式后，重新检测再保存。' : '连接项目，检测通过后就能创建任务。'),
    renderProjectOnboardingStep(1, '选择来源', '项目代码在哪里。', [
      el('label', { class: 'input-block', children: [el('span', { text: '项目来源' }), sourceSelect] }),
      ...renderProjectSourceDynamicFields(),
    ]),
    renderProjectOnboardingStep(2, '设置默认项', '项目名称和工作分支。', renderProjectDefaultsFields()),
    renderProjectOnboardingStep(3, '配置执行方式', '后续任务用哪个工具执行。', [
      renderAgentBackendConfigFields(),
      ...renderBuildCommandFields(),
    ]),
    renderProjectDetectPanel(),
  );

  const detect = el('button', { class: 'btn btn-secondary', text: projectSourceForm.detecting ? '检测中…' : '检测连接', attrs: { type: 'button' } });
  detect.disabled = projectSourceForm.detecting;
  detect.onclick = () => void detectProjectSource();
  const submit = el('button', { class: `btn btn-primary${projectSourceForm.submitting ? ' loading' : ''}`, text: actionState.submitLabel, attrs: { type: 'submit' } });
  submit.disabled = !actionState.canSubmit || projectSourceForm.submitting;
  const cancelEdit = isEditing ? el('button', { class: 'btn btn-ghost', text: '取消编辑', attrs: { type: 'button' } }) : null;
  if (cancelEdit) cancelEdit.onclick = () => { resetProjectSourceForm(); render(); };
  form.append(
    el('div', { class: 'project-form-actions', children: [detect, submit, cancelEdit] }),
    el('p', { class: `compact project-submit-hint ${actionState.blocker ? 'warn' : 'good'}`, text: actionState.blocker ?? '检测通过，可以保存了。' }),
  );
  form.onsubmit = (event) => void submitProject(event);

  return el('section', {
    class: 'page-grid two-col',
    children: [
      form,
      el('section', {
        class: 'panel',
        children: [
          panelHeader('已接入项目', '点击编辑；删除时会提示是否归档以保留历史。'),
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
    class: 'btn btn-secondary btn-sm',
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

function renderBuildCommandFields(): HTMLElement[] {
  return [
    controlledInput('编译命令（可选）', 'buildCompileCommand', '留空使用 Maven 默认（mvn -B -DskipTests compile）', projectSourceForm.buildCompileCommand, (v) => {
      projectSourceForm.buildCompileCommand = v;
    }),
    controlledInput('测试命令（可选）', 'buildTestCommand', '留空使用 Maven 默认（mvn -B test）', projectSourceForm.buildTestCommand, (v) => {
      projectSourceForm.buildTestCommand = v;
    }),
    el('p', { class: 'muted compact', text: '命令按空格切分直接执行，不经过 shell；不支持 &&、|、; 和引号等写法。' }),
  ];
}

function renderLocalPathPickerField(): HTMLElement {
  const input = el('input', {
    attrs: {
      name: 'sourceValue',
      placeholder: '/Users/dev/projects/user-service',
      value: projectSourceForm.sourceValue,
    },
  });
  input.oninput = () => {
    projectSourceForm.sourceValue = input.value;
    projectSourceForm.detectResult = null;
  };
  const browse = el('button', { class: 'btn btn-secondary', text: '选择文件夹', attrs: { type: 'button' } });
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
    const chooseCurrent = el('button', { class: 'btn btn-primary btn-sm', text: '选择当前文件夹', attrs: { type: 'button' } });
    chooseCurrent.onclick = () => chooseLocalDirectory(listing.path);
    const parent = el('button', { class: 'btn btn-secondary btn-sm', text: '上一级', attrs: { type: 'button' } });
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
  const close = el('button', { class: 'btn btn-ghost', text: '关闭选择器', attrs: { type: 'button' } });
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
  return 'https://gitea.company.com/team/java-service.git';
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

function renderProjectCard(project: ProjectDto): HTMLElement {
  const sourceKind = project.sourceKind ?? 'local';
  const status = project.status ?? 'active';
  const backendStatus = agentBackendStatusForProject(project);
  const availability = projectAvailability(project);
  const backendLabel = project.agentBackend
    ? `${agentBackendDisplayName(project.agentBackend)} · ${backendStatusText(backendStatus.label)}`
    : `未配置 · ${backendStatusText(backendStatus.label)}`;
  const action = el('button', {
    class: status === 'archived' ? 'button ghost small' : 'btn btn-danger btn-sm',
    text: projectActionInFlight.has(project.id) ? '处理中…' : status === 'archived' ? '已归档' : '删除 / 归档',
    attrs: { type: 'button' },
  });
  action.disabled = projectActionInFlight.has(project.id) || status === 'archived';
  action.onclick = (event) => {
    event.stopPropagation();
    void deleteOrArchiveProject(project);
  };
  const backendCheck = el('button', {
    class: 'btn btn-secondary btn-sm',
    text: agentBackendPreflightInFlight.has(project.id) ? '检测中…' : '检测连接',
    attrs: { type: 'button' },
  });
  backendCheck.disabled = !project.agentBackend || agentBackendPreflightInFlight.has(project.id);
  backendCheck.onclick = (event) => {
    event.stopPropagation();
    void checkAgentBackend(project.agentBackend ?? null, project.id);
  };
  const profileRequest = latestProfileRequestForProject(project);
  const profileRun = latestProfileRunForProject(project);
  const profileBusy = projectProfileActionInFlight.has(project.id)
    || Boolean(profileRequest && !isTerminalRequestStatus(profileRequest.status))
    || Boolean(profileRun && !isTerminalRunStatus(profileRun.status));
  const profileAction = el('button', {
    class: 'btn btn-secondary btn-sm',
    text: projectProfileActionInFlight.has(project.id) ? '生成中…' : 'Generate legacy profile',
    attrs: { type: 'button' },
  });
  profileAction.disabled = status === 'archived' || profileBusy;
  profileAction.onclick = (event) => {
    event.stopPropagation();
    void startProjectProfileBootstrap(project);
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
          renderProjectProfileStatus(project, profileRequest, profileRun),
        ],
      }),
      details,
      el('div', {
        class: 'project-card-footer',
        children: [
          el('small', { class: 'muted', text: '点击编辑此项目' }),
          el('div', { class: 'project-card-actions', children: [profileAction, backendCheck, action] }),
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

function latestProfileRequestForProject(project: ProjectDto): WorkflowRequestDto | null {
  return data.requests
    .filter((request) => request.projectId === project.id && isProfileRequest(request))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1) ?? null;
}

function latestProfileRunForProject(project: ProjectDto) {
  return data.runs
    .filter((run) => run.projectId === project.id && isProfileRun(run))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1) ?? null;
}

function isProfileRequest(request: WorkflowRequestDto): boolean {
  return request.type === 'profile' || request.flowId === 'profile.bootstrap';
}

function isProfileRun(run: (typeof data.runs)[number]): boolean {
  return run.type === 'profile' || run.flowId === 'profile.bootstrap';
}

function isTerminalRequestStatus(status: WorkflowRequestDto['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isTerminalRunStatus(status: (typeof data.runs)[number]['status']): boolean {
  return status === 'passed' || status === 'failed' || status === 'cancelled';
}

function renderProjectProfileStatus(
  project: ProjectDto,
  request: WorkflowRequestDto | null,
  run: (typeof data.runs)[number] | null,
): HTMLElement {
  const requestForRun = run ? data.requests.find((candidate) => candidate.workflowRunId === run.id) ?? null : null;
  const open = el('button', {
    class: 'btn btn-ghost btn-sm',
    text: '查看',
    attrs: { type: 'button' },
  });
  open.disabled = !request && !run;
  open.onclick = (event) => {
    event.stopPropagation();
    if (requestForRun ?? request) {
      setHash('task', (requestForRun ?? request)!.id);
      return;
    }
    if (run) setHash('workbench', run.id);
  };

  const statusNode = run
    ? pill(run.status, statusKind(run.status))
    : request
      ? pill(requestStatusLabel(request.status), statusKind(request.status))
      : pill('未生成', 'muted');
  const meta = run
    ? `${shortId(run.id)} · ${fmtTime(run.createdAt)}`
    : request
      ? `${shortId(request.id)} · ${fmtTime(request.updatedAt)}`
      : '生成后会产生 inventory、project profile 和待审核知识候选。';
  const activeDetail = data.activeDetail?.run.projectId === project.id && data.activeDetail?.run.flowId === 'profile.bootstrap'
    ? data.activeDetail
    : null;
  const profileMarkdown = activeDetail
    ? latestArtifactOfKind(activeDetail.artifacts, 'project_profile')
    : null;
  const inventory = activeDetail
    ? activeDetail.artifacts.find((artifact) => artifact.metadata?.role === 'project_inventory') ?? null
    : null;
  const artifactLinks = [
    renderProjectProfileArtifactLink(profileMarkdown, 'profile'),
    renderProjectProfileArtifactLink(inventory, 'inventory'),
  ];

  return el('div', {
    class: 'project-profile-status',
    children: [
      el('div', {
        class: 'project-profile-summary-line',
        children: [
          el('span', { class: 'muted', text: '项目画像' }),
          statusNode,
          el('span', { class: 'muted', text: meta }),
          ...artifactLinks,
          open,
        ],
      }),
      inventory ? renderProjectCapabilityMap(project, inventory) : null,
    ],
  });
}

function renderProjectProfileArtifactLink(
  artifact: ArtifactDto | null,
  label: 'profile' | 'inventory',
): HTMLElement | null {
  if (!artifact) return null;
  const isOpen = openArtifactViewers.has(artifact.id);
  const toggle = el('button', {
    class: 'btn btn-ghost btn-sm',
    text: `${label} ${shortId(artifact.id)}`,
    attrs: { type: 'button' },
  });
  toggle.onclick = (event) => {
    event.stopPropagation();
    toggleProjectProfileArtifact(artifact);
  };
  const content = artifactContent.get(artifact.id);
  return el('div', {
    class: 'project-profile-artifact-link',
    children: [
      toggle,
      isOpen
        ? el('pre', {
            class: 'doc-preview code',
            text: content?.text ? previewText(content.text) : '正在加载文件内容...',
          })
        : null,
    ],
  });
}

function toggleProjectProfileArtifact(artifact: ArtifactDto): void {
  if (openArtifactViewers.has(artifact.id)) {
    openArtifactViewers.delete(artifact.id);
    render();
    return;
  }
  openArtifactViewers.add(artifact.id);
  void ensureArtifactContent(artifact.id);
  render();
}

interface ProjectInventoryView {
  capabilities: InventoryViewRecord[];
  entrypoints: InventoryViewRecord[];
  symbols: InventoryViewRecord[];
  testSurfaces: InventoryViewRecord[];
  hotspots: InventoryViewRecord[];
}

interface InventoryViewRecord {
  id: string;
  [key: string]: unknown;
}

function renderProjectCapabilityMap(project: ProjectDto, inventoryArtifact: ArtifactDto): HTMLElement | null {
  const content = artifactContent.get(inventoryArtifact.id);
  const parsed = content?.text ? parseProjectInventoryView(content.text) : null;
  if (!content) {
    void ensureArtifactContent(inventoryArtifact.id);
  }
  if (!content) {
    return el('section', {
      class: 'project-capability-map',
      children: [el('p', { class: 'muted compact', text: '能力地图加载中…' })],
    });
  }
  if (!parsed) {
    return el('section', {
      class: 'project-capability-map',
      children: [el('p', { class: 'muted compact', text: 'inventory 暂不可解析。' })],
    });
  }
  ensureProjectCapabilityCorrectionArtifacts(project);
  const capabilities = [...parsed.capabilities]
    .sort((a, b) => inventoryNumberField(b, 'confidence') - inventoryNumberField(a, 'confidence') || a.id.localeCompare(b.id))
    .slice(0, 8);
  return el('section', {
    class: 'project-capability-map',
    children: [
      el('div', {
        class: 'project-capability-map-head',
        children: [
          el('strong', { text: '核心能力地图' }),
          el('span', { class: 'muted compact', text: `${parsed.capabilities.length} 项` }),
        ],
      }),
      capabilities.length
        ? el('div', {
            class: 'project-capability-list',
            children: capabilities.map((capability) => renderProjectCapabilityRow(project, inventoryArtifact, parsed, capability)),
          })
        : el('p', { class: 'muted compact', text: '本次 inventory 没有识别出能力。' }),
    ],
  });
}

function renderProjectCapabilityRow(
  project: ProjectDto,
  inventoryArtifact: ArtifactDto,
  inventory: ProjectInventoryView,
  capability: InventoryViewRecord,
): HTMLElement {
  const entrypoints = inventoryRecordsByRefs(inventory.entrypoints, inventoryStringArrayField(capability, 'entrypointRefs'));
  const symbols = inventoryRecordsByRefs(inventory.symbols, inventoryStringArrayField(capability, 'symbolRefs'));
  const tests = inventoryRecordsByRefs(inventory.testSurfaces, inventoryStringArrayField(capability, 'testRefs'));
  const hotspots = inventoryRecordsByRefs(inventory.hotspots, inventoryStringArrayField(capability, 'hotspotRefs'));
  const label = inventoryStringField(capability, 'label') ?? capability.id;
  const correctionKey = capabilityCorrectionKey(project.id, inventoryArtifact.id, capability.id);
  const correctionSummaries = projectCapabilityCorrectionSummaries(project.id, capability.id);
  const persistedCorrection = preferredCapabilityCorrection(correctionSummaries);
  const savedCorrection = projectCapabilityCorrections.get(correctionKey) ?? persistedCorrection?.action;
  const busy = projectCapabilityActionInFlight.has(correctionKey);

  const accept = capabilityActionButton(savedCorrection === 'accepted' ? '已提交' : '确认', busy);
  accept.onclick = (event) => {
    event.stopPropagation();
    void submitCapabilityCorrection({
      project,
      inventoryArtifact,
      capability,
      entrypoints,
      symbols,
      tests,
      hotspots,
      action: 'accepted',
    });
  };

  const rename = capabilityActionButton(savedCorrection === 'renamed' ? '已改名' : '重命名', busy);
  rename.onclick = (event) => {
    event.stopPropagation();
    const nextLabel = window.prompt('新的能力名称', label)?.trim();
    if (!nextLabel || nextLabel === label) return;
    void submitCapabilityCorrection({
      project,
      inventoryArtifact,
      capability,
      entrypoints,
      symbols,
      tests,
      hotspots,
      action: 'renamed',
      correctedLabel: nextLabel,
    });
  };

  const merge = capabilityActionButton(savedCorrection === 'merged' ? '已合并' : '合并', busy);
  merge.onclick = (event) => {
    event.stopPropagation();
    const mergeTarget = window.prompt('合并到哪个能力', label)?.trim();
    if (!mergeTarget || mergeTarget === label) return;
    void submitCapabilityCorrection({
      project,
      inventoryArtifact,
      capability,
      entrypoints,
      symbols,
      tests,
      hotspots,
      action: 'merged',
      mergeTarget,
    });
  };

  const wrong = capabilityActionButton(savedCorrection === 'wrong' ? '已标错' : '标错', busy);
  wrong.onclick = (event) => {
    event.stopPropagation();
    void submitCapabilityCorrection({
      project,
      inventoryArtifact,
      capability,
      entrypoints,
      symbols,
      tests,
      hotspots,
      action: 'wrong',
    });
  };

  return el('article', {
    class: `project-capability-row ${savedCorrection ?? ''}`,
    children: [
      el('div', {
        class: 'project-capability-row-main',
        children: [
          el('div', {
            class: 'project-capability-title-line',
            children: [
              el('strong', { text: label }),
              pill(inventoryStringField(capability, 'kind') ?? 'unknown', 'info'),
              pill(`conf ${formatConfidence(inventoryNumberField(capability, 'confidence'))}`, confidenceKind(inventoryNumberField(capability, 'confidence'))),
            ],
          }),
          el('div', {
            class: 'project-capability-evidence',
            children: [
              capabilityMetric('入口', entrypoints.length),
              capabilityMetric('符号', symbols.length),
              capabilityMetric('测试', tests.length),
              capabilityMetric('热点', hotspots.length),
            ],
          }),
          renderCapabilityEvidencePreview(entrypoints, symbols, tests, hotspots),
          renderCapabilityCorrectionComparison(label, inventoryArtifact, correctionSummaries),
        ],
      }),
      el('div', { class: 'project-capability-actions', children: [accept, rename, merge, wrong] }),
    ],
  });
}

type CapabilityCorrectionAction = 'accepted' | 'renamed' | 'merged' | 'wrong';

interface ProjectCapabilityCorrectionSummary {
  artifactId: string;
  status: KnowledgeArtifactDto['status'];
  action: CapabilityCorrectionAction;
  originalLabel: string | null;
  correctedLabel: string | null;
  mergeTarget: string | null;
  inventoryArtifactId: string | null;
  reviewStatus: string | null;
  updatedAt: string;
}

function ensureProjectCapabilityCorrectionArtifacts(project: ProjectDto): void {
  const staleProject = knowledgeArtifactsState.projectId !== project.id;
  const shouldLoad = staleProject || (!knowledgeArtifactsState.loadedOnce && !knowledgeArtifactsState.loading);
  if (!shouldLoad) return;
  void loadKnowledgeArtifacts(project.id, false).then(() => {
    if (ui.activePage === 'projects') render();
  });
}

function projectCapabilityCorrectionSummaries(
  projectId: string,
  capabilityId: string,
): ProjectCapabilityCorrectionSummary[] {
  if (knowledgeArtifactsState.projectId !== projectId) return [];
  return knowledgeArtifactsState.artifacts
    .map((artifact) => projectCapabilityCorrectionSummary(artifact, capabilityId))
    .filter((summary): summary is ProjectCapabilityCorrectionSummary => Boolean(summary))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.artifactId.localeCompare(b.artifactId));
}

function projectCapabilityCorrectionSummary(
  artifact: KnowledgeArtifactDto,
  capabilityId: string,
): ProjectCapabilityCorrectionSummary | null {
  if (metadataString(artifact.metadata, 'correctionKind') !== 'project_capability_map') return null;
  if (metadataString(artifact.metadata, 'capabilityId') !== capabilityId) return null;
  const action = capabilityCorrectionAction(metadataString(artifact.metadata, 'correctionAction'));
  if (!action) return null;
  return {
    artifactId: artifact.id,
    status: artifact.status,
    action,
    originalLabel: metadataString(artifact.metadata, 'originalLabel'),
    correctedLabel: metadataString(artifact.metadata, 'correctedLabel'),
    mergeTarget: metadataString(artifact.metadata, 'mergeTarget'),
    inventoryArtifactId: metadataString(artifact.metadata, 'inventoryArtifactId'),
    reviewStatus: metadataString(artifact.metadata, 'reviewStatus'),
    updatedAt: artifact.updatedAt,
  };
}

function capabilityCorrectionAction(value: string | null): CapabilityCorrectionAction | null {
  if (value === 'accepted' || value === 'renamed' || value === 'merged' || value === 'wrong') return value;
  return null;
}

function preferredCapabilityCorrection(
  corrections: readonly ProjectCapabilityCorrectionSummary[],
): ProjectCapabilityCorrectionSummary | null {
  return corrections.find((correction) => capabilityCorrectionIsGoverned(correction))
    ?? corrections[0]
    ?? null;
}

function capabilityCorrectionIsGoverned(correction: ProjectCapabilityCorrectionSummary): boolean {
  return correction.status === 'accepted' && normalizedCapabilityReviewStatus(correction.reviewStatus) === null;
}

function normalizedCapabilityReviewStatus(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, '_') || null;
  return normalized === 'none' ? null : normalized;
}

function renderCapabilityCorrectionComparison(
  label: string,
  inventoryArtifact: ArtifactDto,
  corrections: readonly ProjectCapabilityCorrectionSummary[],
): HTMLElement | null {
  const correction = preferredCapabilityCorrection(corrections);
  if (!correction) return null;
  return el('div', {
    class: 'project-capability-correction-note compact',
    children: [
      pill(capabilityCorrectionPillLabel(correction), capabilityCorrectionPillKind(correction)),
      el('span', { class: 'muted', text: capabilityCorrectionComparisonText(label, inventoryArtifact, correction) }),
    ],
  });
}

function capabilityCorrectionPillLabel(correction: ProjectCapabilityCorrectionSummary): string {
  const governed = capabilityCorrectionIsGoverned(correction);
  if (correction.action === 'accepted') return governed ? '已确认' : '确认待复核';
  if (correction.action === 'renamed') return governed ? '已改名' : '改名待复核';
  if (correction.action === 'merged') return governed ? '已合并' : '合并待复核';
  return governed ? '已标错' : '标错待复核';
}

function capabilityCorrectionPillKind(correction: ProjectCapabilityCorrectionSummary): StatusKind {
  if (!capabilityCorrectionIsGoverned(correction)) return 'warn';
  if (correction.action === 'wrong') return 'bad';
  if (correction.action === 'accepted') return 'good';
  return 'info';
}

function capabilityCorrectionComparisonText(
  label: string,
  inventoryArtifact: ArtifactDto,
  correction: ProjectCapabilityCorrectionSummary,
): string {
  const scope = correction.inventoryArtifactId && correction.inventoryArtifactId !== inventoryArtifact.id
    ? `历史 inventory ${shortId(correction.inventoryArtifactId)}`
    : '本次 inventory';
  const state = capabilityCorrectionIsGoverned(correction) ? '已生效' : '仍待知识库复核';
  if (correction.action === 'renamed') {
    return `${scope} 曾把 ${correction.originalLabel ?? label} 改名为 ${correction.correctedLabel ?? label}，${state}；当前扫描标签是 ${label}。`;
  }
  if (correction.action === 'merged') {
    return `${scope} 曾把 ${correction.originalLabel ?? label} 合并到 ${correction.mergeTarget ?? '目标能力'}，${state}；当前扫描仍单独识别出 ${label}。`;
  }
  if (correction.action === 'wrong') {
    return `${scope} 曾把 ${correction.originalLabel ?? label} 标为错误能力，${state}；当前扫描仍识别出 ${label}，后续上下文应只保留源码级证据。`;
  }
  return `${scope} 已确认 ${correction.originalLabel ?? label}，${state}；当前扫描仍匹配同一 capability。`;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function capabilityActionButton(text: string, busy: boolean): HTMLButtonElement {
  const button = el('button', { class: 'btn btn-secondary btn-sm', text: busy ? '提交中…' : text, attrs: { type: 'button' } });
  button.disabled = busy;
  return button;
}

function capabilityMetric(label: string, value: number): HTMLElement {
  return el('span', { text: `${label} ${value}` });
}

function renderCapabilityEvidencePreview(
  entrypoints: readonly InventoryViewRecord[],
  symbols: readonly InventoryViewRecord[],
  tests: readonly InventoryViewRecord[],
  hotspots: readonly InventoryViewRecord[],
): HTMLElement {
  const evidence = [
    ...entrypoints.slice(0, 2).map((entrypoint) => [
      inventoryStringField(entrypoint, 'method'),
      inventoryStringField(entrypoint, 'route') ?? inventoryStringField(entrypoint, 'label'),
      inventoryStringField(entrypoint, 'path'),
    ].filter(Boolean).join(' · ')),
    ...symbols.slice(0, 2).map((symbol) => [
      inventoryStringField(symbol, 'kind'),
      inventoryStringField(symbol, 'name'),
      inventoryStringField(symbol, 'path'),
    ].filter(Boolean).join(' · ')),
    ...tests.slice(0, 1).map((test) => inventoryStringField(test, 'path') ?? test.id),
    ...hotspots.slice(0, 1).map((hotspot) => inventoryStringField(hotspot, 'path') ?? hotspot.id),
  ].filter(Boolean);
  return el('ul', {
    class: 'project-capability-evidence-preview',
    children: evidence.slice(0, 5).map((item) => el('li', { text: item })),
  });
}

async function submitCapabilityCorrection(input: {
  project: ProjectDto;
  inventoryArtifact: ArtifactDto;
  capability: InventoryViewRecord;
  entrypoints: readonly InventoryViewRecord[];
  symbols: readonly InventoryViewRecord[];
  tests: readonly InventoryViewRecord[];
  hotspots: readonly InventoryViewRecord[];
  action: 'accepted' | 'renamed' | 'merged' | 'wrong';
  correctedLabel?: string;
  mergeTarget?: string;
}): Promise<void> {
  const key = capabilityCorrectionKey(input.project.id, input.inventoryArtifact.id, input.capability.id);
  if (projectCapabilityActionInFlight.has(key)) return;
  projectCapabilityActionInFlight.add(key);
  render();
  const body = capabilityCorrectionKnowledgeBody(input);
  try {
    await api(`/knowledge-artifacts/projects/${encodeURIComponent(input.project.id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    projectCapabilityCorrections.set(key, input.action);
    ui.lastError = null;
    void loadKnowledgeArtifacts(input.project.id, false).then(() => {
      if (ui.activePage === 'projects') render();
    });
    showSuccessToast('能力纠偏已写入知识候选。');
  } catch (err) {
    ui.lastError = errorMessage(err);
  } finally {
    projectCapabilityActionInFlight.delete(key);
    render();
  }
}

function capabilityCorrectionKnowledgeBody(input: {
  project: ProjectDto;
  inventoryArtifact: ArtifactDto;
  capability: InventoryViewRecord;
  entrypoints: readonly InventoryViewRecord[];
  symbols: readonly InventoryViewRecord[];
  tests: readonly InventoryViewRecord[];
  hotspots: readonly InventoryViewRecord[];
  action: 'accepted' | 'renamed' | 'merged' | 'wrong';
  correctedLabel?: string;
  mergeTarget?: string;
}): Record<string, unknown> {
  const label = inventoryStringField(input.capability, 'label') ?? input.capability.id;
  const title = input.correctedLabel ?? label;
  const text = renderCapabilityCorrectionMarkdown(input);
  return {
    kind: 'explore',
    uri: `mem://project-capability/${encodeURIComponent(input.project.id)}/${encodeURIComponent(input.capability.id)}-${input.action}.md`,
    size: new TextEncoder().encode(text).byteLength,
    contentType: 'text/markdown',
    status: 'draft',
    subtype: input.action === 'wrong' ? 'question' : 'module_overview',
    entityId: `CAP-${slugForCapability(input.capability.id).toUpperCase()}`,
    metadata: {
      title: `Capability correction: ${title}`,
      text,
      knowledgeClass: 'recovered',
      trustLevel: 'summary',
      freshness: 'current',
      confidence: input.action === 'accepted' ? 0.75 : 0.65,
      memoryKind: 'semantic',
      memoryScope: 'project',
      memoryStatus: 'candidate',
      reviewStatus: 'needs_review',
      sourceRefs: capabilityCorrectionSourceRefs(input),
      evidenceRefs: capabilityCorrectionEvidenceRefs(input),
      inventoryRecordRefs: capabilityCorrectionInventoryRecordRefs(input),
      correctionKind: 'project_capability_map',
      correctionAction: input.action,
      capabilityId: input.capability.id,
      originalLabel: label,
      correctedLabel: input.correctedLabel ?? null,
      mergeTarget: input.mergeTarget ?? null,
      inventoryArtifactId: input.inventoryArtifact.id,
    },
  };
}

function renderCapabilityCorrectionMarkdown(input: {
  project: ProjectDto;
  inventoryArtifact: ArtifactDto;
  capability: InventoryViewRecord;
  entrypoints: readonly InventoryViewRecord[];
  symbols: readonly InventoryViewRecord[];
  tests: readonly InventoryViewRecord[];
  hotspots: readonly InventoryViewRecord[];
  action: 'accepted' | 'renamed' | 'merged' | 'wrong';
  correctedLabel?: string;
  mergeTarget?: string;
}): string {
  const label = inventoryStringField(input.capability, 'label') ?? input.capability.id;
  return [
    `# Capability Correction: ${input.correctedLabel ?? label}`,
    '',
    `- Project: ${input.project.name}`,
    `- Action: ${input.action}`,
    `- Capability ID: ${input.capability.id}`,
    `- Original label: ${label}`,
    input.correctedLabel ? `- Corrected label: ${input.correctedLabel}` : '',
    input.mergeTarget ? `- Merge target: ${input.mergeTarget}` : '',
    `- Inventory artifact: ${input.inventoryArtifact.id}`,
    '',
    '## Evidence',
    renderInventoryMarkdownList('Entrypoints', input.entrypoints, (item) => [
      inventoryStringField(item, 'method'),
      inventoryStringField(item, 'route') ?? inventoryStringField(item, 'label'),
      inventoryStringField(item, 'path'),
      inventoryStringField(item, 'handler') ? `handler=${inventoryStringField(item, 'handler')}` : '',
    ].filter(Boolean).join(' | ')),
    renderInventoryMarkdownList('Symbols', input.symbols, (item) => [
      inventoryStringField(item, 'kind'),
      inventoryStringField(item, 'name'),
      inventoryStringField(item, 'path'),
    ].filter(Boolean).join(' | ')),
    renderInventoryMarkdownList('Tests', input.tests, (item) => inventoryStringField(item, 'path') ?? item.id),
    renderInventoryMarkdownList('Hotspots', input.hotspots, (item) => [
      inventoryStringField(item, 'reason'),
      inventoryStringField(item, 'path'),
    ].filter(Boolean).join(' | ')),
  ].filter(Boolean).join('\n');
}

function renderInventoryMarkdownList(
  title: string,
  records: readonly InventoryViewRecord[],
  lineFor: (record: InventoryViewRecord) => string,
): string {
  if (records.length === 0) return `### ${title}\n\n- none\n`;
  return [`### ${title}`, '', ...records.slice(0, 12).map((record) => `- ${lineFor(record)}`), ''].join('\n');
}

function capabilityCorrectionSourceRefs(input: {
  inventoryArtifact: ArtifactDto;
  capability: InventoryViewRecord;
  entrypoints: readonly InventoryViewRecord[];
  symbols: readonly InventoryViewRecord[];
  tests: readonly InventoryViewRecord[];
  hotspots: readonly InventoryViewRecord[];
}): string[] {
  return [
    `artifact:${input.inventoryArtifact.id}`,
    `capability:${input.capability.id}`,
    ...inventoryStringArrayField(input.capability, 'sourceRefs'),
    ...input.entrypoints.flatMap((record) => inventoryStringArrayField(record, 'sourceRefs')),
    ...input.symbols.flatMap((record) => inventoryStringArrayField(record, 'sourceRefs')),
    ...input.tests.flatMap((record) => inventoryStringArrayField(record, 'sourceRefs')),
    ...input.hotspots.flatMap((record) => inventoryStringArrayField(record, 'sourceRefs')),
  ].filter((value, index, array) => value && array.indexOf(value) === index);
}

function capabilityCorrectionEvidenceRefs(input: {
  inventoryArtifact: ArtifactDto;
  capability: InventoryViewRecord;
  entrypoints: readonly InventoryViewRecord[];
  symbols: readonly InventoryViewRecord[];
  tests: readonly InventoryViewRecord[];
  hotspots: readonly InventoryViewRecord[];
}): string[] {
  return uniqueStrings([
    `artifact:${input.inventoryArtifact.id}`,
    `capability:${input.capability.id}`,
    ...input.entrypoints.map((record) => `entrypoint:${record.id}`),
    ...input.symbols.map((record) => `symbol:${record.id}`),
    ...input.tests.map((record) => `test_surface:${record.id}`),
    ...input.hotspots.map((record) => `hotspot:${record.id}`),
    ...capabilityCorrectionSourceRefs(input),
  ]);
}

function capabilityCorrectionInventoryRecordRefs(input: {
  capability: InventoryViewRecord;
  entrypoints: readonly InventoryViewRecord[];
  symbols: readonly InventoryViewRecord[];
  tests: readonly InventoryViewRecord[];
  hotspots: readonly InventoryViewRecord[];
}): Record<string, string[]> {
  return {
    capabilityRefs: [input.capability.id],
    entrypointRefs: input.entrypoints.map((record) => record.id),
    symbolRefs: input.symbols.map((record) => record.id),
    testRefs: input.tests.map((record) => record.id),
    hotspotRefs: input.hotspots.map((record) => record.id),
  };
}

function parseProjectInventoryView(content: string): ProjectInventoryView | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.schemaVersion !== 'ainp.project_inventory.v1') return null;
    return {
      capabilities: inventoryRecords(parsed.capabilities),
      entrypoints: inventoryRecords(parsed.entrypoints),
      symbols: inventoryRecords(parsed.symbols),
      testSurfaces: inventoryRecords(parsed.testSurfaces),
      hotspots: inventoryRecords(parsed.hotspots),
    };
  } catch {
    return null;
  }
}

function inventoryRecords(value: unknown): InventoryViewRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({ ...item, id: inventoryStringField(item, 'id') ?? '' }))
    .filter((item) => item.id);
}

function inventoryRecordsByRefs(records: readonly InventoryViewRecord[], refs: readonly string[]): InventoryViewRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return refs.map((ref) => byId.get(ref)).filter((record): record is InventoryViewRecord => Boolean(record));
}

function inventoryStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function inventoryNumberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function inventoryStringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function formatConfidence(value: number): string {
  if (value <= 0) return '?';
  return value.toFixed(2);
}

function confidenceKind(value: number): StatusKind {
  if (value >= 0.75) return 'good';
  if (value >= 0.45) return 'warn';
  return 'muted';
}

function capabilityCorrectionKey(projectId: string, artifactId: string, capabilityId: string): string {
  return `${projectId}:${artifactId}:${capabilityId}`;
}

function slugForCapability(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'capability';
}

async function startProjectProfileBootstrap(project: ProjectDto): Promise<void> {
  projectProfileActionInFlight.add(project.id);
  render();
  try {
    const request = await api<WorkflowRequestDto>('/workflow-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        title: 'Generate legacy project profile',
        type: 'profile',
        flowId: 'profile.bootstrap',
      }),
    });
    ui.activeTaskRequestId = request.id;
    ui.activeRunId = request.workflowRunId;
    ui.lastError = null;
    showSuccessToast(`项目"${project.name}"画像生成任务已创建。`);
    await loadData({ render: false });
    setHash('task', request.id);
  } catch (err) {
    ui.lastError = errorMessage(err);
  } finally {
    projectProfileActionInFlight.delete(project.id);
    render();
  }
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
  projectSourceForm.buildCompileCommand = project.buildCompileCommand ?? '';
  projectSourceForm.buildTestCommand = project.buildTestCommand ?? '';
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
    // 空串 → null：注册时即默认 Maven；编辑时显式清除已保存的自定义命令。
    buildCompileCommand: projectSourceForm.buildCompileCommand.trim() || null,
    buildTestCommand: projectSourceForm.buildTestCommand.trim() || null,
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
  projectSourceForm.submitting = true;
  render();
  try {
    const editingProjectId = projectSourceForm.editingProjectId;
    const projectName = (projectSourceForm.name || projectSourceForm.detectResult.projectName).trim();
    await api<ProjectDto>(editingProjectId ? `/projects/${encodeURIComponent(editingProjectId)}` : '/projects', {
      method: editingProjectId ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: projectName,
        ...projectSourcePayload(),
      }),
    });
    // 只在新接入项目时清空表单，编辑现有项目时保持表单内容
    if (!editingProjectId) {
      resetProjectSourceForm();
    }
    ui.lastError = null;
    // Success is surfaced via an auto-dismissing toast.
    const successMessage = editingProjectId ? `项目"${projectName}"修改已保存。` : `项目"${projectName}"接入成功。`;
    showSuccessToast(successMessage);
    await loadData({ render: true });
  } catch (err) {
    ui.lastError = errorMessage(err);
    render();
  } finally {
    projectSourceForm.submitting = false;
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
  projectSourceForm.buildCompileCommand = '';
  projectSourceForm.buildTestCommand = '';
  projectSourceForm.detectResult = null;
  projectSourceForm.detecting = false;
  projectSourceForm.submitting = false;
}
