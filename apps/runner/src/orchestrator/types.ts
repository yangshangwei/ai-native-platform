import type {
  ContextPack,
  ContextRequest,
  FlowId,
  KnowledgeArtifact,
  Project,
  WorkflowRun,
  WorkflowRunType,
  WorkflowStage,
  WorkspaceRef,
} from '@ainp/shared';
import type { AgentBackend } from '../agents/types';
import type { ProjectProfileResult } from '../profile';

export interface OrchestrateOpts {
  project: string;
  title: string;
  /** Agent-facing clarified request brief. The WorkflowRun title remains `title`. */
  userRequest?: string;
  sourceBranch?: string;
  workflowRequestId?: string;
  /** Coordinator-decided run type. Defaults to 'feature' if omitted. */
  runType?: WorkflowRunType;
  /**
   * V2 W2-3: optional flow id (e.g. 'feature.fastforward'). Forwarded to
   * `api.createWorkflowRun`; omitting it lets the API use the conservative
   * default for the Coordinator-decided runType. PRD W2-3 ADR Q4.
   */
  flowId?: FlowId;
  /**
   * 05-08 new-task-form-flow-startstage-override: optional UI override of
   * the run's first stage. Only meaningful when `flowId === 'feature.standard'`
   * (other flows are short, head-to-tail). The orchestrator slices
   * `FLOW_REGISTRY[flowId].stages` at this stage on the API side.
   */
  startStage?: WorkflowStage | null;
  /**
   * When set, resume an existing workflow run instead of creating a new one.
   * Used by the retry-step flow to re-enter orchestration at a specific stage.
   */
  workflowRunId?: string;
  /** Default true — auto-clean worktree at the end. */
  cleanup?: boolean;
  /** Default true for CLI mode; watch mode keeps the daemon alive on failed jobs. */
  setExitCode?: boolean;
}

export interface OrchestrateResult {
  workflowRunId: string;
  ok: boolean;
}

// ---------------------------------------------------------------------------
// V2 W2-1 / PR3 — runWorkflow context shared across the extracted
// `executeXxx(ctx)` step implementations. Exported since the T3.1 de-closure
// refactor (06-12) so injected unit tests can construct it; ADR Q1=α (thin)
// means `kind` / `skillId` on each StageStep are populated but not read at
// runtime.
// ---------------------------------------------------------------------------

export interface OkRef {
  /** Mutate to `false` to mark the run failed without throwing. Used by
   * `executeKnowledgePromotion` to honor V1 knowledge-gate rejection
   * behavior (reject sets ok but does NOT throw). */
  value: boolean;
}

export interface RunCtx {
  project: Project;
  run: WorkflowRun;
  workspace: WorkspaceRef;
  backend: AgentBackend;
  /** Heartbeat tool versions; both fields are nullable when the runner
   * couldn't detect the tool on the host. */
  tools: { jdk: string | null; maven: string | null };
  opts: OrchestrateOpts;
  runArtifactsDir: string;
  inputs: Record<string, string>;
  inputArtifactIds: Record<string, string>;
  contextFoundation: {
    projectProfileResult: ProjectProfileResult | null;
    acceptedKnowledge: string | null;
    knowledgeArtifacts: KnowledgeArtifact[] | null;
    runHistory: WorkflowRun[] | null;
  };
  contextPolicy: ContextPolicy;
  contextRequestChain: ContextRequestCapture[];
  draftsToPromote: PromoteDraftInput[];
  handoffContext: HandoffRuntimeContext;
  ok: OkRef;
}

export interface ContextPolicy {
  budget: {
    maxTokens: number;
    reservedForReasoning: number;
    reservedForOutput: number;
  };
  sensitivePathPatterns: readonly string[];
}

export interface ContextRequestCapture {
  request: ContextRequest;
  sourceName: string;
  requestArtifactId: string;
  supplementArtifactId: string;
  supplementContextPackId: string;
  supplementContextPack: ContextPack;
  baseContextPackId: string;
  baseContextPackArtifactId: string;
  baseInvocationId: string;
  supplementInvocationId: string;
}

export interface HandoffRuntimeContext {
  implementationSessionId: string | null;
  implementationArtifactIds: string[];
}

export interface InvokedAgent {
  taskId: string;
  sessionId: string;
  invocationId: string;
  contextPackArtifactId: string;
  outputs: Awaited<ReturnType<AgentBackend['run']>>['outputs'];
  contextPack: ContextPack;
  contextRequest: ContextRequestCapture | null;
}

export interface PromoteDraftInput {
  artifactId: string;
  kind: 'requirement_draft' | 'design_doc';
  uri: string;
  size: number;
  contentType: string;
  /** Full markdown body of the draft (forwarded as-is to the API). */
  text: string;
}
