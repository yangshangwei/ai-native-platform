export {};

const API_BASE = '/api';

const STAGES = [
  'init',
  'context_pack',
  'requirement',
  'design',
  'implementation',
  'build_test',
  'review',
  'completion',
  'knowledge',
] as const;

type Stage = (typeof STAGES)[number];

const STAGE_TO_GATE: Partial<Record<Stage, string>> = {
  requirement: 'requirement_gate',
  design: 'design_gate',
  review: 'acceptance_gate',
  knowledge: 'knowledge_gate',
};

interface WorkflowRun {
  id: string;
  projectId: string;
  title: string;
  status: string;
  currentStage: Stage;
  branch: string;
  workspacePath: string | null;
  createdAt: string;
}

interface CommandRunDto {
  id: string;
  command: string;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
  stdoutRef: string;
  stderrRef: string;
  startedAt: string;
}

interface GateRunDto {
  id: string;
  gateId: string;
  status: 'pass' | 'warn' | 'fail';
  decidedAt: string;
  ruleResults: Array<{ ruleId: string; status: string; message: string }>;
}

interface ArtifactDto {
  id: string;
  kind: string;
  uri: string;
  createdAt: string;
}

interface ApprovalDto {
  id: string;
  gateId: string;
  decision: 'approved' | 'rejected';
  actor: string;
  decidedAt: string;
}

interface BuildRunDto {
  id: string;
  status: string;
  jdkVersion: string;
  mavenCommand: string;
}

interface TestRunDto {
  framework: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
}

interface RunDetail {
  run: WorkflowRun;
  steps: Array<{ id: string; stage: Stage; name: string; status: string }>;
  commands: CommandRunDto[];
  gates: GateRunDto[];
  artifacts: ArtifactDto[];
  builds: BuildRunDto[];
  tests: TestRunDto[];
  approvals: ApprovalDto[];
  audit: Array<{ id: string; kind: string; at: string }>;
}

let activeRunId: string | null = null;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`api ${path}: ${res.status}`);
  return (await res.json()) as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string; children?: Node[] } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.children) for (const c of opts.children) node.appendChild(c);
  return node;
}

function row(key: string, valueNode: Node): HTMLElement {
  const k = el('span', { class: 'k', text: key });
  const wrap = el('div', { class: 'row' });
  wrap.appendChild(k);
  wrap.appendChild(valueNode);
  return wrap;
}

function pill(status: string): HTMLElement {
  return el('span', { class: `pill ${status}`, text: status });
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function refreshStatus(): Promise<void> {
  const target = document.getElementById('api-status');
  if (!target) return;
  try {
    const h = await api<{ ok: boolean; counts: Record<string, number> }>('/health');
    target.textContent = `· API ok · runs=${h.counts.workflowRuns} · cmds=${h.counts.commandRuns} · gates=${h.counts.gateRuns}`;
  } catch {
    target.textContent = '· API unreachable';
  }
}

async function refreshRuns(): Promise<void> {
  const list = document.getElementById('runs-list');
  if (!list) return;
  try {
    const { items } = await api<{ items: WorkflowRun[] }>('/workflow-runs');
    clear(list);
    if (items.length === 0) {
      const empty = el('li', {
        text: 'No runs yet. Run: bun run runner -- orchestrate --project java-sample --title "..."',
      });
      empty.style.color = 'var(--muted)';
      empty.style.fontSize = '11px';
      list.appendChild(empty);
      return;
    }
    // Newest first
    const sorted = [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    for (const run of sorted) {
      const title = el('div', { text: run.title });
      title.style.fontSize = '12px';
      title.style.fontWeight = '600';
      const meta = el('div');
      meta.style.fontSize = '11px';
      meta.style.color = 'var(--muted)';
      meta.appendChild(document.createTextNode(`${run.id.slice(0, 14)}… `));
      meta.appendChild(pill(run.status));
      const li = el('li', { children: [title, meta] });
      if (run.id === activeRunId) li.classList.add('active');
      li.onclick = () => {
        activeRunId = run.id;
        void showRun(run.id);
        document
          .querySelectorAll('#runs-list li')
          .forEach((node) => node.classList.remove('active'));
        li.classList.add('active');
      };
      list.appendChild(li);
    }
    // auto-select the first run if none selected yet
    if (!activeRunId && sorted.length > 0) {
      activeRunId = sorted[0]!.id;
      void showRun(activeRunId);
      list.querySelector('li')?.classList.add('active');
    }
  } catch (err) {
    clear(list);
    const errLi = el('li', { text: (err as Error).message });
    errLi.style.color = 'var(--fail)';
    list.appendChild(errLi);
  }
}

async function showRun(id: string): Promise<void> {
  const stagesNode = document.getElementById('stages')!;
  const detail = document.getElementById('detail')!;
  const evidence = document.getElementById('evidence')!;
  const approval = document.getElementById('approval')!;

  const data = await api<RunDetail>(`/workflow-runs/${encodeURIComponent(id)}`);

  // ---- left: stages ----
  clear(stagesNode);
  for (const stage of STAGES) {
    const div = el('div', {
      class: 'stage' + (stage === data.run.currentStage ? ' current' : ''),
      text: stage,
    });
    stagesNode.appendChild(div);
  }

  // ---- center: detail + steps ----
  clear(detail);
  detail.classList.remove('placeholder');
  detail.appendChild(row('Run', el('span', { text: data.run.id })));
  detail.appendChild(row('Title', el('span', { text: data.run.title })));
  detail.appendChild(row('Status', pill(data.run.status)));
  detail.appendChild(row('Stage', el('span', { text: data.run.currentStage })));
  detail.appendChild(row('Branch', el('span', { text: data.run.branch })));
  detail.appendChild(
    row('Workspace', el('code', { text: data.run.workspacePath ?? '<not prepared>' })),
  );
  detail.appendChild(row('Created', el('span', { text: data.run.createdAt })));

  if (data.steps.length > 0) {
    detail.appendChild(el('h2', { text: 'Steps' }));
    for (const s of data.steps) {
      const wrap = el('div', { class: 'row' });
      wrap.appendChild(el('span', { class: 'k', text: s.stage }));
      const right = el('span');
      right.appendChild(pill(s.status));
      right.appendChild(document.createTextNode(' ' + s.name));
      wrap.appendChild(right);
      detail.appendChild(wrap);
    }
  }

  if (data.builds.length > 0) {
    detail.appendChild(el('h2', { text: 'Builds & Tests' }));
    for (const b of data.builds) {
      const right = el('span');
      right.appendChild(pill(b.status));
      right.appendChild(document.createTextNode(` ${b.mavenCommand} (jdk=${b.jdkVersion})`));
      detail.appendChild(row('build', right));
    }
    for (const t of data.tests) {
      detail.appendChild(
        row(
          t.framework,
          el('span', {
            text: `total=${t.total} passed=${t.passed} failed=${t.failed} errors=${t.errors} skipped=${t.skipped}`,
          }),
        ),
      );
    }
  }

  // ---- right: evidence (gates + commands + artifacts) ----
  clear(evidence);
  evidence.classList.remove('placeholder');

  if (data.gates.length > 0) {
    evidence.appendChild(el('h2', { text: 'Gates' }));
    for (const g of data.gates) {
      const right = el('span');
      right.appendChild(pill(g.status));
      right.appendChild(document.createTextNode(' ' + g.gateId));
      evidence.appendChild(row(g.gateId, right));
    }
  }

  if (data.commands.length > 0) {
    evidence.appendChild(el('h2', { text: 'Commands' }));
    for (const c of data.commands) {
      const right = el('span');
      right.appendChild(pill(c.status));
      right.appendChild(document.createTextNode(` exit=${c.exitCode ?? '∅'} (${c.durationMs ?? '∅'}ms)`));
      evidence.appendChild(row('cmd', el('code', { text: c.command })));
      evidence.appendChild(row('status', right));
    }
  }

  if (data.artifacts.length > 0) {
    evidence.appendChild(el('h2', { text: 'Artifacts' }));
    for (const a of data.artifacts) {
      evidence.appendChild(row(a.kind, el('code', { text: a.uri })));
    }
  }

  // ---- right: approval ----
  clear(approval);
  if (data.run.status === 'awaiting_human') {
    const gateId = STAGE_TO_GATE[data.run.currentStage];
    if (gateId) {
      const heading = el('h2', { text: 'Awaiting decision' });
      const desc = el('div', {
        text: `Stage ${data.run.currentStage} is paused at ${gateId}.`,
        class: 'placeholder',
      });
      desc.style.padding = '0';
      desc.style.textAlign = 'left';
      desc.style.color = 'var(--fg)';
      const approveBtn = el('button', { text: `Approve ${gateId}` });
      approveBtn.style.cssText =
        'padding:6px 12px;background:var(--pass);color:#0d1117;border:0;border-radius:4px;cursor:pointer;font-weight:600;margin-right:8px;';
      const rejectBtn = el('button', { text: 'Reject' });
      rejectBtn.style.cssText =
        'padding:6px 12px;background:var(--fail);color:#0d1117;border:0;border-radius:4px;cursor:pointer;font-weight:600;';
      approveBtn.onclick = () => void approve(id, gateId, true);
      rejectBtn.onclick = () => void approve(id, gateId, false);
      approval.appendChild(heading);
      approval.appendChild(desc);
      const btnRow = el('div');
      btnRow.style.marginTop = '10px';
      btnRow.appendChild(approveBtn);
      btnRow.appendChild(rejectBtn);
      approval.appendChild(btnRow);
    }
  } else {
    const heading = el('h2', { text: 'Approval' });
    const text = el('div', {
      text:
        data.approvals.length === 0
          ? 'No approvals recorded.'
          : `${data.approvals.length} decision(s) recorded.`,
      class: 'placeholder',
    });
    text.style.padding = '0';
    text.style.textAlign = 'left';
    approval.appendChild(heading);
    approval.appendChild(text);
    if (data.approvals.length > 0) {
      for (const a of data.approvals) {
        const right = el('span');
        right.appendChild(pill(a.decision));
        right.appendChild(document.createTextNode(` by ${a.actor}`));
        approval.appendChild(row(a.gateId, right));
      }
    }
  }
}

async function approve(workflowRunId: string, gateId: string, approved: boolean): Promise<void> {
  const comment = approved ? 'approved via web UI' : 'rejected via web UI';
  await api('/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflowRunId, gateId, approved, actor: 'web', comment }),
  });
  await showRun(workflowRunId);
}

await refreshStatus();
await refreshRuns();
setInterval(() => {
  void refreshStatus();
  void refreshRuns();
  if (activeRunId) void showRun(activeRunId);
}, 2000);
