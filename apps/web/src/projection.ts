import {
  FLOW_REGISTRY,
  type AgentResult,
  type AgentTask,
  type Artifact,
  type BuildRun,
  type CommandRun,
  type FlowId,
  type GateRun,
  type HandoffRecord,
  type RuleResult,
  stageHandoffFromMetadata,
  type StepCheckpoint,
  type StageHandoffMetadata,
  type StepRun,
  type TestRun,
  type ToolInvocation,
  type WorkflowRequestStatus,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowStage,
} from '@ainp/shared/browser';
import type { ContextGovernanceDto, WorkflowRequestDto } from './types';

export type { FlowId };

// ---- DTO derivation helpers (T2.4) ----------------------------------------
//
// Every web DTO that mirrors a `@ainp/shared` entity is *derived* from it
// below (Pick/Omit), so a shared field rename/retype becomes a web compile
// error instead of silent drift. Deliberate deviations from the shared shape
// must go through {@link Weaken} / {@link Optionalize} with a per-use-site
// comment explaining why. Hand-copied parallel interfaces are forbidden
// (see .trellis/spec/web/frontend/type-safety.md).

/**
 * Explicitly weaken the K fields of T to plain `string`. Use only with a
 * comment explaining why the union cannot be kept (currently unused — kept
 * as the sanctioned escape hatch so future weakenings stay declared).
 */
export type Weaken<T, K extends keyof T> = Omit<T, K> & { [P in K]: string };

/**
 * Demote the K fields of T from required to optional. Each use site must
 * comment why (typically: legacy fixtures/historical rows omit the field
 * and src already reads it defensively).
 */
export type Optionalize<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * A lifecycle stage. Aliased to the shared {@link WorkflowStage} so the web
 * projection covers every stage any flow in {@link FLOW_REGISTRY} can emit —
 * including the non-feature stages `report` / `analyze` (issue.standard) and
 * `scan` / `plan` (refactor.standard). Previously this was a web-local subset
 * hard-coded to the feature pipeline, which mis-rendered other flows.
 */
export type Stage = WorkflowStage;

/**
 * Feature-pipeline stage ordering. Retained as a stable reference for the
 * V1-equivalent `feature.standard` flow and for label/iteration fallbacks;
 * the source of truth for any given run is now `FLOW_REGISTRY[run.flowId]`
 * via {@link stagesForRun}.
 */
export const STAGES = [
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

/** Every stage value, for membership checks against arbitrary run data. */
export const ALL_STAGES = [
  'init',
  'context_pack',
  'requirement',
  'design',
  'implementation',
  'build_test',
  'review',
  'completion',
  'knowledge',
  'inventory',
  'profile',
  'report',
  'analyze',
  'scan',
  'plan',
] as const satisfies readonly Stage[];

/**
 * User-facing feature lifecycle (feature.standard minus the technical
 * `context_pack` prep stage). Kept for the queued-lifecycle fallback and for
 * regression-pinning the feature flow; flow-aware rendering should prefer
 * {@link visibleStagesForRun} / `RunProjection.visibleStages`.
 */
export const USER_VISIBLE_STAGES = [
  'requirement',
  'design',
  'implementation',
  'build_test',
  'review',
  'completion',
  'knowledge',
] as const satisfies readonly Stage[];

export const STAGE_LABELS: Record<Stage, string> = {
  init: '任务受理',
  context_pack: '上下文准备',
  requirement: '需求分析',
  design: '方案设计',
  implementation: '代码实现',
  build_test: '构建测试',
  review: '验收确认',
  completion: '交付报告',
  knowledge: '知识沉淀',
  inventory: '项目盘点',
  profile: '画像生成',
  report: '问题报告',
  analyze: '根因分析',
  scan: '现状扫描',
  plan: '重构方案',
};

export const STAGE_HELP: Record<Stage, string> = {
  init: '系统创建任务请求与 Workflow Run 记录，不调用 Agent，也不会产生业务产物。',
  context_pack: 'Runner 自动扫描项目资料、复用项目画像和历史知识，生成给后续 Agent 使用的上下文包。',
  requirement: '把用户输入整理成目标、范围、验收标准和待确认问题；通过后等待人工确认。',
  design: '把已确认需求转成实现方案、影响范围、风险和测试策略；通过后等待人工确认。',
  implementation: '在 worktree 中按方案改代码并收集 diff；敏感变更可能需要人工确认。',
  build_test: '执行真实本地命令，例如 Maven compile/test，并解析测试报告。',
  review: '汇总验收清单、测试证据和风险，等待用户验收。',
  completion: '生成交付报告，汇总阶段、Gate、命令、产物和审批证据。',
  knowledge: '抽取可复用经验，用户确认后沉淀到项目知识库。',
  inventory: 'Runner 只读扫描项目文件、配置和 Git 线索，生成可审阅的 inventory artifact。',
  profile: 'Agent 基于 inventory 生成项目画像；发现仍需通过 Knowledge Gate 才能成为长期知识。',
  report: 'Agent 整理问题现象、复现步骤和影响范围，作为后续分析的输入。',
  analyze: 'Agent 定位根因、评估影响面，给出修复方向。',
  scan: 'Agent 扫描目标代码，识别坏味道、重复和结构问题。',
  plan: 'Agent 制定重构方案与步骤，明确改动边界和回归风险。',
};

export const STAGE_TO_GATE: Partial<Record<Stage, string>> = {
  requirement: 'requirement_gate',
  design: 'design_gate',
  implementation: 'sensitive_change_gate',
  review: 'acceptance_gate',
  knowledge: 'knowledge_gate',
};

/** Short human-readable labels for each flow, surfaced in lifecycle headers. */
export const FLOW_LABELS: Record<FlowId, string> = {
  'feature.standard': '标准功能流程',
  'feature.fastforward': '快速功能流程',
  'issue.standard': '问题修复流程',
  'refactor.standard': '重构流程',
  'profile.bootstrap': '项目画像初始化',
};

const FALLBACK_FLOW_ID: FlowId = 'feature.standard';

/**
 * Ordered stage list a run actually executes, driven by the shared
 * {@link FLOW_REGISTRY} rather than a hard-coded feature pipeline. Mirrors the
 * runner's `sliceStagesFromStartStage` contract:
 *   - unknown/missing `flowId` falls back to `feature.standard` (never throws);
 *   - `startStage` null/absent → the flow's full stage list;
 *   - `startStage` present and matched → the list sliced from that stage;
 *   - `startStage` not in the flow → ignored (full list) so the UI degrades
 *     gracefully instead of rendering an empty track.
 *
 * Excludes the `init` status placeholder (which is not a flow step).
 */
export function stagesForRun(
  flowId: FlowId | null | undefined,
  startStage: Stage | null | undefined,
): Stage[] {
  const flow = FLOW_REGISTRY[(flowId ?? FALLBACK_FLOW_ID) as FlowId] ?? FLOW_REGISTRY[FALLBACK_FLOW_ID];
  const stages = flow.stages.map((step) => step.stage);
  if (!startStage) return stages;
  const fromIdx = stages.indexOf(startStage);
  return fromIdx <= 0 ? stages : stages.slice(fromIdx);
}

/**
 * The user-facing lifecycle track for a run: its flow stages minus the
 * technical `context_pack` prep stage. `context_pack` stays available for the
 * backend-detail drill-down but never shows in the main lifecycle.
 */
export function visibleStagesForRun(
  flowId: FlowId | null | undefined,
  startStage: Stage | null | undefined,
): Stage[] {
  return stagesForRun(flowId, startStage).filter((stage) => stage !== 'context_pack');
}

/**
 * Run row as serialized (verbatim shared entity) by `GET /workflow-runs` and
 * `GET /workflow-runs/:id`. Derived from the shared {@link WorkflowRun};
 * the web picks only the fields it renders. `status` / `flowId` /
 * `startStage` / `sourceBranch` are the full shared types — the wire always
 * carries them (`flow_id` is NOT NULL in the DB; unknown flowIds still fall
 * back gracefully at runtime in {@link stagesForRun}).
 */
export type WorkflowRunDto = Pick<
  WorkflowRun,
  | 'id'
  | 'projectId'
  | 'type'
  | 'title'
  | 'status'
  | 'currentStage'
  | 'flowId'
  | 'startStage'
  | 'sourceBranch'
  | 'branch'
  | 'workspacePath'
  | 'createdAt'
>;

/**
 * Derived from the shared {@link CommandRun} (the API returns the full
 * entity). Includes `timedOut` / `truncated`, which the old hand-copied
 * shadow silently dropped.
 *
 * `stage` is Weakened to string: page-task-detail historically matches
 * commands to lifecycle stages via `command.stage === stage.id`
 * (a WorkflowStage), which has no overlap with the shared CommandStage
 * union. Keeping the historical string comparison preserves runtime
 * behavior until the stage-tagging wire contract is settled (R2 red line:
 * zero behavior change in this task).
 */
export type CommandRunDto = Weaken<
  Pick<
    CommandRun,
    | 'id'
    | 'stepRunId'
    | 'cwd'
    | 'command'
    | 'stage'
    | 'status'
    | 'exitCode'
    | 'durationMs'
    | 'stdoutRef'
    | 'stderrRef'
    | 'stdoutSha256'
    | 'stderrSha256'
    | 'combinedSha256'
    | 'startedAt'
    | 'timedOut'
    | 'truncated'
  >,
  'stage'
>;

/** Derived from the shared {@link ToolInvocation}; the API returns the full entity. */
export type ToolInvocationDto = ToolInvocation;

/**
 * Derived from the shared {@link GateRun}. `ruleResults` rows are trimmed to
 * the render fields ({@link RuleResult} minus `evidenceRefs`, which the SPA
 * does not consume).
 */
export type GateRunDto = Pick<GateRun, 'id' | 'gateId' | 'stepRunId' | 'status' | 'decidedAt'> & {
  ruleResults: Array<Pick<RuleResult, 'ruleId' | 'status' | 'message'>>;
};

/**
 * Derived from the shared {@link Artifact}. `metadata` is Optionalized: the
 * wire always carries it, but legacy fixtures omit it and src reads it
 * defensively, so demoting keeps those callers honest without weakening.
 */
export type ArtifactDto = Optionalize<
  Pick<Artifact, 'id' | 'kind' | 'stepRunId' | 'uri' | 'contentType' | 'sha256' | 'createdAt' | 'metadata'>,
  'metadata'
>;

/**
 * Shadow of the api-private `Approval` (apps/api/src/store/store.ts) — no
 * shared source exists, so this stays hand-aligned. Registered in task
 * notes.md (R4) as a "wire contract → shared" follow-up candidate.
 */
export interface ApprovalDto {
  id: string;
  gateId: string;
  decision: 'approved' | 'rejected';
  actor: string;
  decidedAt: string;
}

/**
 * Shadow of the api-private `WorkflowAction` (apps/api/src/store/store.ts) —
 * no shared source exists, so this stays hand-aligned. Registered in task
 * notes.md (R4) as a "wire contract → shared" follow-up candidate.
 */
export interface WorkflowActionDto {
  id: string;
  workflowRunId: string;
  kind: string;
  targetId: string | null;
  action: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Derived from the shared {@link BuildRun}; the SPA renders only these four fields. */
export type BuildRunDto = Pick<BuildRun, 'id' | 'status' | 'jdkVersion' | 'mavenCommand'>;

/**
 * Derived from the shared {@link TestRun}. `id` / `buildRunId` /
 * `reportArtifactIds` are Optionalized: the wire always carries them, but
 * the SPA only renders aggregate counts and legacy fixtures omit them.
 */
export type TestRunDto = Optionalize<
  Pick<
    TestRun,
    'id' | 'buildRunId' | 'framework' | 'total' | 'passed' | 'failed' | 'errors' | 'skipped' | 'reportArtifactIds'
  >,
  'id' | 'buildRunId' | 'reportArtifactIds'
>;

/**
 * Derived from the shared {@link StepRun} (web omits `workflowRunId`, which
 * is implied by the detail scope). `startedAt` / `completedAt` are
 * Optionalized: the wire always carries them (nullable), but legacy fixtures
 * omit them and src already treats them as nullable.
 */
export type StepRunDto = Optionalize<
  Pick<StepRun, 'id' | 'stage' | 'name' | 'status' | 'startedAt' | 'completedAt'>,
  'startedAt' | 'completedAt'
>;

/**
 * Derived from the shared {@link AgentTask}. `createdAt` is Optionalized for
 * legacy fixtures; `prompt` is still omitted because the SPA only needs the
 * already-resolved input artifact ids for context-flow projection.
 */
export type AgentTaskDto = Optionalize<
  Pick<AgentTask, 'id' | 'stepRunId' | 'kind' | 'backend' | 'inputArtifactIds' | 'createdAt'>,
  'createdAt'
>;

/**
 * Derived from the shared {@link AgentResult}. `summary` / `completedAt` are
 * Optionalized: legacy fixtures omit them and src renders them defensively.
 */
export type AgentResultDto = Optionalize<
  Pick<AgentResult, 'id' | 'taskId' | 'status' | 'summary' | 'outputArtifactIds' | 'completedAt'>,
  'summary' | 'completedAt'
>;

export type StepCheckpointDto = StepCheckpoint;

/**
 * Derived from the shared {@link HandoffRecord}; the API returns the full
 * entity, but the SPA only needs the audit fields that can reveal stage
 * handoffs and their artifact inputs/outputs.
 */
export type HandoffRecordDto = Pick<
  HandoffRecord,
  | 'id'
  | 'fromRole'
  | 'toRole'
  | 'reason'
  | 'inputArtifactIds'
  | 'status'
  | 'adoptionDecision'
  | 'outputArtifactIds'
  | 'createdAt'
  | 'metadata'
>;

/**
 * Shadow of the api-private `AuditEntry` (apps/api/src/store/store.ts) — no
 * shared source exists, so this stays hand-aligned. Registered in task
 * notes.md (R4) as a "wire contract → shared" follow-up candidate.
 */
export interface AuditEntryDto {
  id: string;
  workflowRunId?: string | null;
  kind: string;
  payload?: Record<string, unknown>;
  at: string;
}

export interface RunDetail {
  run: WorkflowRunDto;
  steps: StepRunDto[];
  commands: CommandRunDto[];
  toolInvocations: ToolInvocationDto[];
  gates: GateRunDto[];
  artifacts: ArtifactDto[];
  builds: BuildRunDto[];
  tests: TestRunDto[];
  approvals: ApprovalDto[];
  actions: WorkflowActionDto[];
  agentTasks: AgentTaskDto[];
  agentResults: AgentResultDto[];
  handoffs: HandoffRecordDto[];
  stepCheckpoints: StepCheckpointDto[];
  audit: AuditEntryDto[];
}

export interface StageProjection {
  id: Stage;
  label: string;
  state: 'waiting' | 'active' | 'blocked' | 'done' | 'failed';
  gateId: string | null;
}

export interface RunProjection {
  currentStage: Stage;
  pendingGate: string | null;
  /**
   * The run's flow, resolved from `run.flowId` (falling back to
   * `feature.standard`). Surfaced so the UI can show `flowId` / `startStage`
   * / `N/M` position without re-deriving them.
   */
  flowId: FlowId;
  startStage: Stage | null;
  /**
   * Every stage the run's flow executes, in order, with computed state.
   * Drives the backend drill-down (which still wants `context_pack`).
   */
  stages: StageProjection[];
  /**
   * User-facing lifecycle track: {@link stages} minus `context_pack`. Drives
   * `renderLifecycle()`; non-feature flows here only carry their own stages.
   */
  visibleStages: StageProjection[];
  summary: {
    commands: number;
    gatesPassed: number;
    gatesWarned: number;
    gatesFailed: number;
    testsTotal: number;
    testsPassed: number;
    buildStatus: string;
  };
}

export interface ContextFlowArtifactRef {
  artifactId: string;
  artifact: ArtifactDto | null;
  kind: string;
  label: string;
  stage: Stage | null;
  missing: boolean;
}

export interface ContextFlowCheckpointRef {
  id: string;
  stage: Stage;
  status: string;
  stepRunId: string;
  retryIndex: number;
  contextPackId: string | null;
}

export interface ContextFlowContextPackRef {
  contextPackId: string;
  source: string;
  artifact: ContextFlowArtifactRef | null;
  taskId: string | null;
  stage: Stage | null;
  mode: string | null;
  role: string | null;
  invocationId: string | null;
  retryIndex: number | null;
  contextRequestId: string | null;
  baseContextPackId: string | null;
  baseContextPackArtifactId: string | null;
}

export interface ContextFlowStage {
  id: Stage;
  label: string;
  state: StageProjection['state'];
  inputs: ContextFlowArtifactRef[];
  outputs: ContextFlowArtifactRef[];
  contextPacks: ContextFlowContextPackRef[];
  checkpoints: ContextFlowCheckpointRef[];
}

export type ContextFlowRelation =
  | {
      kind: 'artifact_reuse';
      artifactId: string;
      artifact: ContextFlowArtifactRef;
      fromStage: Stage | null;
      toStage: Stage | null;
    }
  | {
      kind: 'stage_handoff';
      handoffId: string;
      fromStage: string;
      toStage: string;
      artifact: ContextFlowArtifactRef | null;
      summary: string;
      producedArtifacts: ContextFlowArtifactRef[];
      createdAt: string | null;
    }
  | {
      kind: 'context_request';
      requestId: string;
      status: string;
      reason: string;
      requestedRefs: string[];
      baseContextPackId: string | null;
      supplementContextPackId: string | null;
      artifacts: Array<{
        role: 'base' | 'request' | 'supplement';
        artifact: ContextFlowArtifactRef;
      }>;
      createdAt: string;
    };

export interface ContextFlowProjection {
  stages: ContextFlowStage[];
  relations: ContextFlowRelation[];
  warnings: string[];
}

export function isReadableFileArtifact(artifact: Pick<ArtifactDto, 'uri'>): boolean {
  return artifact.uri.startsWith('file://');
}

export function artifactViewerScrollKey(artifact: Pick<ArtifactDto, 'id'>, scope = 'default'): string {
  return `artifact:${scope}:${artifact.id}`;
}

export function latestArtifactOfKind<T extends Pick<ArtifactDto, 'kind' | 'createdAt'>>(
  artifacts: T[],
  kind: string,
): T | null {
  return (
    artifacts
      .filter((artifact) => artifact.kind === kind)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1) ?? null
  );
}

export function buildContextFlowProjection(
  detail: RunDetail,
  contextGovernance: ContextGovernanceDto | null,
): ContextFlowProjection {
  const runProjection = buildRunProjection(detail);
  const artifactById = new Map(detail.artifacts.map((artifact) => [artifact.id, artifact]));
  const stepById = new Map(detail.steps.map((step) => [step.id, step]));
  const taskById = new Map(detail.agentTasks.map((task) => [task.id, task]));
  const stageById = new Map<Stage, ContextFlowStage>(
    runProjection.visibleStages.map((stage) => [
      stage.id,
      {
        id: stage.id,
        label: stage.label,
        state: stage.state,
        inputs: [],
        outputs: [],
        contextPacks: [],
        checkpoints: [],
      },
    ]),
  );
  const warnings: string[] = [];
  const inputStagesByArtifact = new Map<string, Set<Stage>>();
  const outputStagesByArtifact = new Map<string, Set<Stage>>();

  const artifactRef = (artifactId: string, stage: Stage | null): ContextFlowArtifactRef => {
    const artifact = artifactById.get(artifactId) ?? null;
    if (!artifact) warnings.push(`missing artifact ${artifactId}`);
    return {
      artifactId,
      artifact,
      kind: artifact?.kind ?? 'unknown',
      label: artifact ? artifactDisplayLabel(artifact) : artifactId,
      stage,
      missing: !artifact,
    };
  };

  for (const task of detail.agentTasks) {
    const stage = stageForAgentTask(task, stepById);
    if (!stage || !stageById.has(stage)) continue;
    const target = stageById.get(stage);
    if (!target) continue;
    for (const artifactId of task.inputArtifactIds) {
      appendUniqueArtifact(target.inputs, artifactRef(artifactId, stage));
      addStageRef(inputStagesByArtifact, artifactId, stage);
    }
  }

  for (const result of detail.agentResults) {
    const task = taskById.get(result.taskId);
    if (!task) {
      warnings.push(`agent result ${result.id} references missing task ${result.taskId}`);
      continue;
    }
    const stage = stageForAgentTask(task, stepById);
    if (!stage || !stageById.has(stage)) continue;
    const target = stageById.get(stage);
    if (!target) continue;
    for (const artifactId of result.outputArtifactIds) {
      appendUniqueArtifact(target.outputs, artifactRef(artifactId, stage));
      addStageRef(outputStagesByArtifact, artifactId, stage);
    }
  }

  for (const checkpoint of detail.stepCheckpoints) {
    if (!stageById.has(checkpoint.stage)) continue;
    const target = stageById.get(checkpoint.stage);
    if (!target) continue;
    target.checkpoints.push({
      id: checkpoint.id,
      stage: checkpoint.stage,
      status: checkpoint.status,
      stepRunId: checkpoint.stepRunId,
      retryIndex: checkpoint.retryIndex,
      contextPackId: checkpoint.contextPackId,
    });
  }

  if (contextGovernance) {
    for (const pack of contextGovernance.contextPacks) {
      const stage = stageFromContextPack(pack, taskById, stepById);
      if (!stage || !stageById.has(stage)) continue;
      const target = stageById.get(stage);
      if (!target) continue;
      target.contextPacks.push({
        contextPackId: pack.contextPackId,
        source: pack.source,
        artifact: pack.artifactId ? artifactRef(pack.artifactId, stage) : null,
        taskId: pack.taskId,
        stage,
        mode: pack.mode,
        role: pack.role,
        invocationId: pack.invocationId,
        retryIndex: pack.retryIndex,
        contextRequestId: pack.contextRequestId,
        baseContextPackId: pack.baseContextPackId,
        baseContextPackArtifactId: pack.baseContextPackArtifactId,
      });
    }
  }

  const relations: ContextFlowRelation[] = [
    ...artifactReuseRelations(inputStagesByArtifact, outputStagesByArtifact, artifactRef),
    ...stageHandoffRelations(detail, contextGovernance, artifactRef),
    ...contextRequestRelations(contextGovernance, artifactRef),
  ];

  return {
    stages: [...stageById.values()],
    relations,
    warnings: unique(warnings),
  };
}

export function buildRunProjection(detail: RunDetail): RunProjection {
  const flowId = (detail.run.flowId ?? FALLBACK_FLOW_ID) as FlowId;
  const startStage = detail.run.startStage ?? null;
  if (detail.run.type === 'ask') {
    return {
      currentStage: detail.run.currentStage,
      flowId,
      startStage,
      pendingGate: null,
      stages: [],
      visibleStages: [],
      summary: {
        commands: detail.commands.length,
        gatesPassed: detail.gates.filter((g) => g.status === 'pass').length,
        gatesWarned: detail.gates.filter((g) => g.status === 'warn').length,
        gatesFailed: detail.gates.filter((g) => g.status === 'fail').length,
        testsTotal: detail.tests.reduce((sum, test) => sum + test.total, 0),
        testsPassed: detail.tests.reduce((sum, test) => sum + test.passed, 0),
        buildStatus: detail.builds.at(-1)?.status ?? 'not_started',
      },
    };
  }
  const flowStages = stagesForRun(flowId, startStage);
  const effectiveCurrentStage = effectiveStageForProjection(detail);
  const currentIndex = flowStages.indexOf(effectiveCurrentStage);
  const pendingGate =
    detail.run.status === 'awaiting_human'
      ? (STAGE_TO_GATE[effectiveCurrentStage] ?? null)
      : null;

  const stages = flowStages.map<StageProjection>((stage) => {
    const step = detail.steps.find((s) => s.stage === stage);
    const gateId = STAGE_TO_GATE[stage] ?? null;
    const gate = gateId ? ([...detail.gates].reverse().find((g) => g.gateId === gateId) ?? null) : null;
    const isCurrent = stage === effectiveCurrentStage;
    let state: StageProjection['state'] = 'waiting';

    if (step?.status === 'failed' || gate?.status === 'fail') {
      state = 'failed';
    } else if (isCurrent && detail.run.status === 'failed') {
      state = 'failed';
    } else if (pendingGate && isCurrent) {
      state = 'blocked';
    } else if (isCurrent && detail.run.status === 'running') {
      state = 'active';
    } else if (stageHasDoneEvidence(detail, stage, step, gate, currentIndex)) {
      state = 'done';
    }

    return {
      id: stage,
      label: STAGE_LABELS[stage],
      state,
      gateId,
    };
  });

  return {
    currentStage: effectiveCurrentStage,
    flowId,
    startStage,
    pendingGate,
    stages,
    visibleStages: stages.filter((stage) => stage.id !== 'context_pack'),
    summary: {
      commands: detail.commands.length,
      gatesPassed: detail.gates.filter((g) => g.status === 'pass').length,
      gatesWarned: detail.gates.filter((g) => g.status === 'warn').length,
      gatesFailed: detail.gates.filter((g) => g.status === 'fail').length,
      testsTotal: detail.tests.reduce((sum, test) => sum + test.total, 0),
      testsPassed: detail.tests.reduce((sum, test) => sum + test.passed, 0),
      buildStatus: detail.builds.at(-1)?.status ?? 'not_started',
    },
  };
}

function appendUniqueArtifact(target: ContextFlowArtifactRef[], artifact: ContextFlowArtifactRef): void {
  if (target.some((current) => current.artifactId === artifact.artifactId)) return;
  target.push(artifact);
}

function addStageRef(map: Map<string, Set<Stage>>, artifactId: string, stage: Stage): void {
  const stages = map.get(artifactId) ?? new Set<Stage>();
  stages.add(stage);
  map.set(artifactId, stages);
}

function artifactReuseRelations(
  inputStagesByArtifact: Map<string, Set<Stage>>,
  outputStagesByArtifact: Map<string, Set<Stage>>,
  artifactRef: (artifactId: string, stage: Stage | null) => ContextFlowArtifactRef,
): ContextFlowRelation[] {
  const out: ContextFlowRelation[] = [];
  for (const [artifactId, outputStages] of outputStagesByArtifact) {
    const inputStages = inputStagesByArtifact.get(artifactId);
    if (!inputStages) continue;
    for (const fromStage of outputStages) {
      for (const toStage of inputStages) {
        if (fromStage === toStage) continue;
        out.push({
          kind: 'artifact_reuse',
          artifactId,
          artifact: artifactRef(artifactId, fromStage),
          fromStage,
          toStage,
        });
      }
    }
  }
  return out;
}

function stageHandoffRelations(
  detail: RunDetail,
  contextGovernance: ContextGovernanceDto | null,
  artifactRef: (artifactId: string, stage: Stage | null) => ContextFlowArtifactRef,
): ContextFlowRelation[] {
  const byId = new Map<string, ContextFlowRelation>();
  for (const handoff of contextGovernance?.stageHandoffs ?? []) {
    byId.set(handoff.id, {
      kind: 'stage_handoff',
      handoffId: handoff.id,
      fromStage: handoff.fromStage,
      toStage: handoff.toStage,
      artifact: handoff.artifactId ? artifactRef(handoff.artifactId, stageOrNull(handoff.toStage)) : null,
      summary: handoff.summary,
      producedArtifacts: handoff.producedArtifacts.map((item) => artifactRef(item.artifactId, stageOrNull(handoff.toStage))),
      createdAt: handoff.createdAt,
    });
  }

  for (const handoff of detail.handoffs) {
    const stageHandoff = stageHandoffFromMetadata(handoff.metadata);
    if (!stageHandoff || byId.has(handoff.id)) continue;
    byId.set(handoff.id, relationFromRunHandoff(handoff.id, stageHandoff, handoff.outputArtifactIds, artifactRef));
  }
  return [...byId.values()];
}

function relationFromRunHandoff(
  handoffId: string,
  stageHandoff: StageHandoffMetadata,
  outputArtifactIds: string[],
  artifactRef: (artifactId: string, stage: Stage | null) => ContextFlowArtifactRef,
): ContextFlowRelation {
  const toStage = stageHandoff.toStage;
  const primaryArtifactId = outputArtifactIds[0] ?? stageHandoff.producedArtifacts[0]?.artifactId ?? null;
  return {
    kind: 'stage_handoff',
    handoffId,
    fromStage: stageHandoff.fromStage,
    toStage,
    artifact: primaryArtifactId ? artifactRef(primaryArtifactId, toStage) : null,
    summary: stageHandoff.summary,
    producedArtifacts: stageHandoff.producedArtifacts.map((item) => artifactRef(item.artifactId, toStage)),
    createdAt: stageHandoff.createdAt,
  };
}

function contextRequestRelations(
  contextGovernance: ContextGovernanceDto | null,
  artifactRef: (artifactId: string, stage: Stage | null) => ContextFlowArtifactRef,
): ContextFlowRelation[] {
  return (contextGovernance?.contextRequests ?? []).map((request) => {
    const artifacts: Array<{ role: 'base' | 'request' | 'supplement'; artifact: ContextFlowArtifactRef }> = [];
    if (request.baseContextPackArtifactId) {
      artifacts.push({ role: 'base', artifact: artifactRef(request.baseContextPackArtifactId, null) });
    }
    if (request.requestArtifactId) {
      artifacts.push({ role: 'request', artifact: artifactRef(request.requestArtifactId, null) });
    }
    if (request.supplementArtifactId) {
      artifacts.push({ role: 'supplement', artifact: artifactRef(request.supplementArtifactId, null) });
    }
    return {
      kind: 'context_request',
      requestId: request.id,
      status: request.status,
      reason: request.reason,
      requestedRefs: request.requestedRefs,
      baseContextPackId: request.baseContextPackId,
      supplementContextPackId: request.supplementContextPackId,
      artifacts,
      createdAt: request.createdAt,
    };
  });
}

function stageFromContextPack(
  pack: ContextGovernanceDto['contextPacks'][number],
  taskById: Map<string, AgentTaskDto>,
  stepById: Map<string, StepRunDto>,
): Stage | null {
  const explicitStage = stageOrNull(pack.stage);
  if (explicitStage) return explicitStage;
  const task = pack.taskId ? taskById.get(pack.taskId) : null;
  return task ? stageForAgentTask(task, stepById) : null;
}

function stageForAgentTask(task: AgentTaskDto, stepById: Map<string, StepRunDto>): Stage | null {
  if (task.stepRunId) {
    const step = stepById.get(task.stepRunId);
    if (step) return step.stage;
  }
  const map: Partial<Record<AgentTask['kind'], Stage>> = {
    context_pack: 'context_pack',
    requirement_draft: 'requirement',
    design_draft: 'design',
    implementation: 'implementation',
    review: 'review',
    report: 'report',
    analyze: 'analyze',
    scan: 'scan',
    plan: 'plan',
  };
  return map[task.kind] ?? null;
}

function stageOrNull(value: string | null | undefined): Stage | null {
  return isStage(value) ? value : null;
}

function artifactDisplayLabel(artifact: ArtifactDto): string {
  const metadata = artifact.metadata ?? {};
  const metadataLabel =
    stringField(metadata, 'label') ??
    stringField(metadata, 'title') ??
    stringField(metadata, 'output') ??
    stringField(metadata, 'path');
  const label = metadataLabel ? basename(metadataLabel) : basename(artifact.uri);
  return label || artifact.id;
}

function basename(value: string): string {
  const normalized = value.split('?')[0]?.split('#')[0] ?? value;
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function effectiveStageForProjection(detail: RunDetail): Stage {
  const completionHasEvidence = stageHasAnyEvidence(detail, 'completion');
  if (detail.run.status === 'failed' && detail.run.currentStage === 'completion' && !completionHasEvidence) {
    return lastTransitionStage(detail) ?? lastStepStage(detail) ?? detail.run.currentStage;
  }
  return detail.run.currentStage;
}

function lastTransitionStage(detail: RunDetail): Stage | null {
  for (const item of [...detail.audit].reverse()) {
    if (item.kind !== 'workflow_run.stage_transition') continue;
    const stage = item.payload?.stage;
    if (isStage(stage)) return stage;
  }
  return null;
}

function lastStepStage(detail: RunDetail): Stage | null {
  const step = [...detail.steps]
    .filter((candidate) => Boolean(candidate.startedAt || candidate.completedAt))
    .sort((a, b) => (a.completedAt ?? a.startedAt ?? '').localeCompare(b.completedAt ?? b.startedAt ?? ''))
    .at(-1);
  return step?.stage ?? null;
}

function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (ALL_STAGES as readonly string[]).includes(value);
}

function stageHasDoneEvidence(
  detail: RunDetail,
  stage: Stage,
  step: RunDetail['steps'][number] | undefined,
  gate: GateRunDto | null,
  currentIndex: number,
): boolean {
  if (step?.status === 'passed' || gate?.status === 'pass') return true;
  if (stage === 'init') return currentIndex > STAGES.indexOf('init') || detail.run.status === 'passed';
  if (stage === 'completion') return latestArtifactOfKind(detail.artifacts, 'completion_report') !== null;
  if (stage === 'knowledge') {
    return latestArtifactOfKind(detail.artifacts, 'knowledge_candidate') !== null &&
      detail.approvals.some((approval) => approval.gateId === 'knowledge_gate' && approval.decision === 'approved');
  }
  return false;
}

function stageHasAnyEvidence(detail: RunDetail, stage: Stage): boolean {
  if (detail.steps.some((step) => step.stage === stage)) return true;
  if (detail.gates.some((gate) => gate.gateId === STAGE_TO_GATE[stage])) return true;
  if (detail.artifacts.some((artifact) => artifactForStageProjection(artifact.kind, stage))) return true;
  return detail.audit.some(
    (item) => item.kind === 'workflow_run.stage_transition' && item.payload?.stage === stage,
  );
}

function artifactForStageProjection(kind: string, stage: Stage): boolean {
  const map: Partial<Record<Stage, string[]>> = {
    context_pack: ['context_pack', 'project_profile'],
    requirement: ['requirement_draft'],
    design: ['design_doc', 'traceability'],
    implementation: ['diff'],
    build_test: ['test_surface_report', 'surefire_report', 'failsafe_report', 'command_log'],
    completion: ['completion_report'],
    knowledge: ['knowledge_candidate'],
  };
  return (map[stage] ?? []).includes(kind);
}

// ---- Structured document parsing -----------------------------------------

export interface RequirementDoc {
  title: string;
  goals: string[];
  userScenarios: string[];
  acceptanceCriteria: Array<{ id: string; text: string }>;
  nonGoals: string[];
  openQuestions: string[];
}

export interface DesignCoverageRow {
  requirement: string;
  design: string;
  acceptanceCriteria: string[];
  verification: string;
  status: 'covered' | 'pending' | 'risk';
}

export interface DesignDoc {
  title: string;
  summary: string[];
  affectedModules: string[];
  filesTouched: string[];
  testStrategy: string[];
  risks: string[];
  coverage: DesignCoverageRow[];
}

export interface AcceptanceChecklistItem {
  id: string;
  text: string;
  status: 'passed' | 'at_risk' | 'missing' | 'failed';
  scenarioType?: string;
  verificationMethod?: string;
  evidence: string[];
  risk: string | null;
}

export interface KnowledgeSuggestion {
  kind: 'Decision' | 'Pitfall' | 'Pattern' | 'Lesson';
  text: string;
  evidence: string;
}

export interface CompletionReportSection {
  title: string;
  body: string;
}

export interface CompletionReportDoc {
  title: string;
  summary: string[];
  sections: CompletionReportSection[];
}

export interface WorkbenchOverview {
  toConfirm: WorkflowRunDto[];
  failedGates: Array<{ runId: string; gateId: string }>;
  running: WorkflowRunDto[];
  pendingRequests: WorkflowRequestDto[];
  recentReports: WorkflowRunDto[];
}

export interface ReportStats {
  total: number;
  attention: number;
  acceptable: number;
  running: number;
  completed: number;
  failed: number;
}

export function reportStats(runs: WorkflowRunDto[]): ReportStats {
  const acceptable = runs.filter((run) => reportIsAcceptable(run)).length;
  return {
    total: runs.length,
    attention: runs.filter((run) => reportNeedsAttention(run)).length,
    acceptable,
    running: runs.filter((run) => reportIsRunning(run)).length,
    completed: acceptable,
    failed: runs.filter((run) => run.status === 'failed').length,
  };
}

/**
 * R2 (T2.4): these report predicates historically also compared against
 * `WorkflowRequestStatus` values ('awaiting_clarification' / 'completed' /
 * 'claimed'). The API never produces those statuses on a WorkflowRun (see
 * task notes.md R2 evidence chain: every `run.status` write in
 * apps/api/src/workflow-engine.ts is a `WorkflowRunStatus`), but to keep the
 * task's "zero runtime behavior change" red line the comparisons are kept
 * verbatim and the *parameter* status union is widened explicitly instead.
 */
export type ReportableStatus = WorkflowRunStatus | WorkflowRequestStatus;

export function reportNeedsAttention(run: { status: ReportableStatus }): boolean {
  // 07-26 operational pause: paused runs/requests wait on a manual resume.
  return run.status === 'failed' || run.status === 'awaiting_human' || run.status === 'awaiting_clarification' || run.status === 'paused';
}

export function reportIsAcceptable(run: { status: ReportableStatus }): boolean {
  return run.status === 'passed' || run.status === 'completed';
}

export function reportIsRunning(run: { status: ReportableStatus }): boolean {
  return run.status === 'running' || run.status === 'pending' || run.status === 'claimed';
}

export function reportStatusLabel(status: string): string {
  if (status === 'passed' || status === 'completed') return '可验收';
  if (status === 'failed') return '失败';
  if (status === 'awaiting_human') return '待确认';
  if (status === 'awaiting_clarification') return '待澄清';
  if (status === 'paused') return '已暂停（运维）';
  if (status === 'running' || status === 'claimed') return '执行中';
  if (status === 'pending') return '等待执行';
  return status;
}

export function parseRequirementDocument(markdown: string): RequirementDoc {
  const title = firstHeading(markdown) ?? 'Requirement Draft';
  const sections = splitSections(markdown);
  const acceptanceSource =
    sectionText(sections, ['acceptance criteria', '验收标准']) || markdown;
  const acceptanceCriteria = extractAcceptanceCriteria(acceptanceSource);
  return {
    title,
    goals: listItems(sectionText(sections, ['goals', '目标'])),
    userScenarios: listItems(sectionText(sections, ['user scenarios', '用户场景', 'user request'])),
    acceptanceCriteria,
    nonGoals: listItems(sectionText(sections, ['non-goals', 'non goals', '非目标'])),
    openQuestions: listItems(sectionText(sections, ['open questions', '待确认', 'questions'])),
  };
}

export function parseRequirementArtifact(markdown: string, jsonText?: string | null): RequirementDoc {
  const parsed = parseJsonObject(jsonText);
  if (parsed?.schemaVersion === 'ainp.requirement.v1') {
    const acceptanceCriteria = Array.isArray(parsed.acceptanceCriteria)
      ? parsed.acceptanceCriteria
          .map((item) => {
            if (!isObject(item) || typeof item.id !== 'string' || typeof item.text !== 'string') {
              return null;
            }
            return { id: item.id, text: item.text };
          })
          .filter((item): item is { id: string; text: string } => Boolean(item))
      : [];
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'Requirement Draft',
      goals: stringArray(parsed.goals),
      userScenarios: stringArray(parsed.userScenarios),
      acceptanceCriteria,
      nonGoals: stringArray(parsed.nonGoals),
      openQuestions: stringArray(parsed.openQuestions),
    };
  }
  return parseRequirementDocument(markdown);
}

export function parseDesignDocument(markdown: string): DesignDoc {
  const title = firstHeading(markdown) ?? 'Design';
  const sections = splitSections(markdown);
  const coverageSection = sectionText(sections, [
    'requirement coverage matrix',
    'coverage matrix',
    '需求覆盖',
  ]) || markdown;
  return {
    title,
    summary: listItems(sectionText(sections, ['approach', 'design summary', '设计摘要'])),
    affectedModules: listItems(sectionText(sections, ['affected modules', '影响模块'])),
    filesTouched: listItems(sectionText(sections, ['files touched', '修改文件'])),
    testStrategy: listItems(sectionText(sections, ['test strategy', '测试策略'])),
    risks: listItems(sectionText(sections, ['risks', '风险'])),
    coverage: parseCoverageTable(coverageSection),
  };
}

export function parseDesignArtifact(markdown: string, jsonText?: string | null): DesignDoc {
  const parsed = parseJsonObject(jsonText);
  if (parsed?.schemaVersion === 'ainp.design.v1') {
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'Design',
      summary: stringArray(parsed.summary),
      affectedModules: stringArray(parsed.affectedModules),
      filesTouched: stringArray(parsed.filesTouched),
      testStrategy: stringArray(parsed.testStrategy),
      risks: stringArray(parsed.risks),
      coverage: parseCoverageRows(parsed.coverage),
    };
  }
  return parseDesignDocument(markdown);
}

export function parseCompletionReport(markdown: string): CompletionReportDoc {
  const sectionsMap = splitSections(markdown);
  const sections = [...sectionsMap.entries()].map(([title, body]) => ({
    title,
    body: body.trim(),
  }));
  const summary = markdown
    .split('\n')
    .filter((line) => /^-\s+\*\*/.test(line))
    .map((line) => line.replace(/^-\s+/, '').replace(/\*\*/g, '').trim());
  return {
    title: firstHeading(markdown) ?? 'Completion Report',
    summary,
    sections,
  };
}

export function parseCompletionReportArtifact(
  markdown: string,
  jsonText?: string | null,
): CompletionReportDoc {
  const parsed = parseJsonObject(jsonText);
  if (parsed?.schemaVersion === 'ainp.completion_report.v1') {
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .map((item) => {
            if (!isObject(item) || typeof item.title !== 'string' || typeof item.body !== 'string') {
              return null;
            }
            return { title: item.title, body: item.body };
          })
          .filter((item): item is CompletionReportSection => Boolean(item))
      : [];
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'Completion Report',
      summary: stringArray(parsed.summary),
      sections,
    };
  }
  return parseCompletionReport(markdown);
}

export function parseKnowledgeCandidate(markdown: string): KnowledgeSuggestion[] {
  const lessons = sectionText(splitSections(markdown), ['reusable lessons', 'knowledge suggestions']);
  return listItems(lessons).map((item) => {
    const match = /^(Decision|Pitfall|Pattern|Lesson)\s*:\s*(.*?)(?:\s+Evidence\s*:\s*(.*))?$/i.exec(
      item,
    );
    if (match) {
      return {
        kind: normalizeKnowledgeKind(match[1]!),
        text: (match[2] ?? '').trim(),
        evidence: match[3]?.trim() ?? '',
      };
    }
    return {
      kind: 'Lesson' as const,
      text: item,
      evidence: '',
    };
  });
}

export function parseKnowledgeArtifact(
  markdown: string,
  jsonText?: string | null,
): KnowledgeSuggestion[] {
  const parsed = parseJsonObject(jsonText);
  if (parsed?.schemaVersion === 'ainp.knowledge_candidate.v1' && Array.isArray(parsed.suggestions)) {
    return parsed.suggestions
      .map((item) => {
        if (
          !isObject(item) ||
          typeof item.text !== 'string' ||
          !['Decision', 'Pitfall', 'Pattern', 'Lesson'].includes(String(item.kind))
        ) {
          return null;
        }
        return {
          kind: item.kind as KnowledgeSuggestion['kind'],
          text: item.text,
          evidence: typeof item.evidence === 'string' ? item.evidence : '',
        };
      })
      .filter((item): item is KnowledgeSuggestion => Boolean(item));
  }
  return parseKnowledgeCandidate(markdown);
}

export function buildAcceptanceChecklist(
  requirement: RequirementDoc,
  design: DesignDoc,
  detail: RunDetail,
): AcceptanceChecklistItem[] {
  const compileGate = latestGate(detail, 'compile_gate');
  const testGate = latestGate(detail, 'test_gate');
  const acceptanceGate = latestGate(detail, 'acceptance_gate');
  const hasPassingTests = detail.tests.some((t) => t.total > 0 && t.failed === 0 && t.errors === 0);
  const approvedAcceptance = detail.approvals.some(
    (a) => a.gateId === 'acceptance_gate' && a.decision === 'approved',
  );

  return requirement.acceptanceCriteria.map((ac) => {
    const covered = design.coverage.some((row) => row.acceptanceCriteria.includes(ac.id));
    const evidence: string[] = [];
    if (covered) evidence.push('Design coverage matrix');
    if (compileGate?.status === 'pass') evidence.push('compile_gate=pass');
    if (testGate?.status === 'pass' && hasPassingTests) evidence.push('test_gate=pass');
    if (acceptanceGate?.status === 'pass' || approvedAcceptance) evidence.push('acceptance approved');

    let status: AcceptanceChecklistItem['status'] = 'missing';
    let risk: string | null = null;
    if (covered && compileGate?.status === 'pass' && testGate?.status === 'pass' && hasPassingTests) {
      status = 'passed';
    } else if (covered || compileGate?.status === 'pass' || testGate?.status === 'pass') {
      status = 'at_risk';
      risk = 'Evidence is partial; confirm risk before completion.';
    } else {
      risk = 'No implementation/test evidence found yet.';
    }
    return { id: ac.id, text: ac.text, status, evidence, risk };
  });
}

export function buildWorkbenchOverview(params: {
  runs: WorkflowRunDto[];
  requests: WorkflowRequestDto[];
  detailsByRunId?: Record<string, RunDetail | undefined>;
}): WorkbenchOverview {
  const detailsByRunId = params.detailsByRunId ?? {};
  return {
    toConfirm: params.runs.filter((run) => run.status === 'awaiting_human'),
    failedGates: params.runs.flatMap((run) =>
      (detailsByRunId[run.id]?.gates ?? [])
        .filter((gate) => gate.status === 'fail')
        .map((gate) => ({ runId: run.id, gateId: gate.gateId })),
    ),
    running: params.runs.filter((run) => run.status === 'running'),
    pendingRequests: params.requests.filter((request) => request.status === 'pending'),
    recentReports: params.runs.filter((run) => run.status === 'passed').slice(0, 5),
  };
}

export function changedFilesFromDiff(diffText: string): string[] {
  const files = new Set<string>();
  for (const line of diffText.split('\n')) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match) files.add(match[2]!);
  }
  return [...files];
}

function latestGate(detail: RunDetail, gateId: string): GateRunDto | null {
  return [...detail.gates].reverse().find((gate) => gate.gateId === gateId) ?? null;
}

function firstHeading(markdown: string): string | null {
  return markdown
    .split('\n')
    .map((line) => /^#\s+(.+)$/.exec(line.trim())?.[1]?.trim())
    .find((heading): heading is string => Boolean(heading)) ?? null;
}

function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current = '';
  let body: string[] = [];
  for (const line of markdown.split('\n')) {
    const match = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) sections.set(normalizeHeading(current), body.join('\n'));
      current = match[1]!;
      body = [];
    } else if (current) {
      body.push(line);
    }
  }
  if (current) sections.set(normalizeHeading(current), body.join('\n'));
  return sections;
}

function sectionText(sections: Map<string, string>, names: string[]): string {
  const wanted = names.map(normalizeHeading);
  for (const [name, body] of sections.entries()) {
    if (wanted.some((candidate) => name === candidate)) return body;
  }
  for (const [name, body] of sections.entries()) {
    if (wanted.some((candidate) => name.startsWith(candidate) || candidate.startsWith(name))) {
      return body;
    }
  }
  return '';
}

function normalizeHeading(text: string): string {
  return text.trim().toLowerCase().replace(/[:：]/g, '').replace(/\s+/g, ' ');
}

function listItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function extractAcceptanceCriteria(text: string): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  for (const line of text.split('\n')) {
    const match = /\b(AC-\d{3})\b\s*[:：-]?\s*(.+)$/i.exec(line);
    if (match) out.push({ id: match[1]!.toUpperCase(), text: match[2]!.trim() });
  }
  return out;
}

function parseCoverageTable(markdown: string): DesignCoverageRow[] {
  const rows = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 3 && !cells.every((cell) => /^-+$/.test(cell.replace(/\s/g, ''))));

  const body = rows.filter((cells) => !/requirement|需求/i.test(cells[0] ?? ''));
  return body.map((cells) => {
    const acceptanceCell = cells.find((cell) => /\bAC-\d{3}\b/i.test(cell)) ?? '';
    return {
      requirement: cells[0] ?? '',
      design: cells[1] ?? '',
      acceptanceCriteria: (acceptanceCell.match(/\bAC-\d{3}\b/gi) ?? []).map((id) =>
        id.toUpperCase(),
      ),
      verification: cells[3] ?? cells[2] ?? '',
      status: /待确认|pending|risk|风险/i.test(cells.join(' ')) ? 'pending' : 'covered',
    };
  });
}

function parseCoverageRows(value: unknown): DesignCoverageRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isObject(item)) return null;
      const status =
        item.status === 'pending' || item.status === 'risk' ? item.status : 'covered';
      return {
        requirement: typeof item.requirement === 'string' ? item.requirement : '',
        design: typeof item.design === 'string' ? item.design : '',
        acceptanceCriteria: stringArray(item.acceptanceCriteria),
        verification: typeof item.verification === 'string' ? item.verification : '',
        status,
      };
    })
    .filter((item): item is DesignCoverageRow => Boolean(item));
}

function normalizeKnowledgeKind(kind: string): KnowledgeSuggestion['kind'] {
  const lower = kind.toLowerCase();
  if (lower === 'decision') return 'Decision';
  if (lower === 'pitfall') return 'Pitfall';
  if (lower === 'pattern') return 'Pattern';
  return 'Lesson';
}

function parseJsonObject(text?: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
