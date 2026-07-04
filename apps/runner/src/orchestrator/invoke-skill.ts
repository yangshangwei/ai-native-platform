import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  errorMessage,
  newId,
  type AgentTaskKind,
  type Artifact,
  type ContextRequest,
  type ContextPack,
  type ContextPackArtifactEnvelope,
  type ContextPackArtifactRole,
  type SkillSpec,
  type WorkflowRun,
} from '@ainp/shared';
import { api, type SourceChunkIndexCatalogEntry } from '../api-client';
import type { AgentBackend } from '../agents/types';
import { generateProjectProfile } from '../profile';
import { acceptedKnowledgeMarkdownForContext, collectAcceptedKnowledge } from '../knowledge';
import {
  buildContextPack,
  buildIncrementalContextPack,
  contextSelectionAudit,
  sanitizeContextRequestForContextInjection,
  type BuildContextPackInputArtifact,
} from '../context/builder';
import {
  CONTEXT_REQUEST_SCHEMA_VERSION,
  parseContextRequestFromAgentOutput,
  type ParsedContextRequest,
} from '../context/request';
import { inputInjectionAuditForPrompt } from '../context/renderer';
import {
  sourceChunkIndexConfiguredEmbeddingProvider,
  sourceChunkIndexEmbeddingForText,
  type SourceChunkIndexEmbeddingProvider,
} from '../source-chunk-embedding';
import type {
  ContextRequestCapture,
  HistoricalProjectInventoryInput,
  HistoricalSourceChunkIndexInput,
  InvokedAgent,
  RunCtx,
} from './types';

const CONTEXT_PACK_ARTIFACT_SCHEMA_VERSION = 'ainp.context_pack_artifact.v1' as const;
const SOURCE_CHUNK_INDEX_CATALOG_QUERY_MAX_LENGTH = 200;
const SOURCE_CHUNK_INDEX_CATALOG_MAX_LINKED_RECORD_REFS = 16;
const SOURCE_CHUNK_INDEX_CATALOG_LINKED_RECORD_QUERY_LIMIT = 100;

// ---------------------------------------------------------------------------
// T3.1 de-closure (06-12): `invokeSkill` / `captureContextRequest` /
// `ensureContextFoundation` were inner closures of `cmdOrchestrate` capturing
// `ctx` / `project` / `run` / `inputs` / `inputArtifactIds`. They now read
// all run-scoped state through the explicit `RunCtx` parameter; external
// collaborators (the platform API) are injected through `InvokeSkillDeps`
// (same pattern as `enforceSensitiveChangeCheckpoint`). Behavior is
// byte-for-byte equivalent to the closure version.
// ---------------------------------------------------------------------------

export interface InvokeSkillDeps {
  agentTaskStarted: typeof api.agentTaskStarted;
  agentTaskFinished: typeof api.agentTaskFinished;
  agentSessionStarted: typeof api.agentSessionStarted;
  agentSessionFinished: typeof api.agentSessionFinished;
  postArtifact: typeof api.postArtifact;
  getWorkflowRun: typeof api.getWorkflowRun;
  getArtifactContent: typeof api.getArtifactContent;
  listSourceChunkIndexEntries: typeof api.listSourceChunkIndexEntries;
  recordContextRequest: typeof api.recordContextRequest;
  recordKnowledgeUsage: typeof api.recordKnowledgeUsage;
  recordKnowledgeAction: typeof api.recordKnowledgeAction;
  sourceChunkEmbeddingProvider?: SourceChunkIndexEmbeddingProvider | null;
}

export const DEFAULT_INVOKE_SKILL_DEPS: InvokeSkillDeps = {
  agentTaskStarted: api.agentTaskStarted,
  agentTaskFinished: api.agentTaskFinished,
  agentSessionStarted: api.agentSessionStarted,
  agentSessionFinished: api.agentSessionFinished,
  postArtifact: api.postArtifact,
  getWorkflowRun: api.getWorkflowRun,
  getArtifactContent: api.getArtifactContent,
  listSourceChunkIndexEntries: api.listSourceChunkIndexEntries,
  recordContextRequest: api.recordContextRequest,
  recordKnowledgeUsage: api.recordKnowledgeUsage,
  recordKnowledgeAction: api.recordKnowledgeAction,
};

export async function invokeSkill(
  c: RunCtx,
  skill: SkillSpec,
  skillCtx: Parameters<AgentBackend['run']>[1],
  deps: InvokeSkillDeps = DEFAULT_INVOKE_SKILL_DEPS,
): Promise<InvokedAgent> {
  const foundation = await ensureContextFoundation(c);
  const taskBrief = agentTaskBriefForRunContext(skillCtx.title, c, skillCtx.inputs);
  const catalogQuery = sourceChunkIndexCatalogQueryForTaskBrief(taskBrief);
  const inputArtifacts = await contextPackInputArtifactsForSkill(c, skillCtx.inputs, foundation, catalogQuery, deps);
  const baseContextPack = buildContextPack({
    project: c.project,
    run: c.run,
    stage: skill.stage,
    stepRunId: skillCtx.stepRunId ?? null,
    workspacePath: skillCtx.workspacePath,
    branch: skillCtx.branch,
    taskBrief,
    projectProfile: foundation.projectProfileResult?.profile ?? null,
    projectProfileMarkdown: foundation.projectProfileResult?.markdown ?? skillCtx.inputs['project_profile.md'],
    acceptedKnowledgeMarkdown: acceptedKnowledgeMarkdownForContext({
      legacyMarkdown: foundation.acceptedKnowledge ?? skillCtx.inputs['accepted_knowledge.md'],
      knowledgeArtifacts: foundation.knowledgeArtifacts,
    }),
    knowledgeArtifacts: foundation.knowledgeArtifacts ?? [],
    runHistory: foundation.runHistory ?? [],
    inputNames: inputArtifacts.map((artifact) => artifact.name),
    inputArtifacts,
    budget: c.contextPolicy.budget,
    sensitivePathPatterns: c.contextPolicy.sensitivePathPatterns,
  });
  const baseAttempt = await invokeSkillAttempt(c, skill, skillCtx, {
    contextPack: baseContextPack,
    contextPackArtifactRole: 'base',
    invocationId: newId('ctxinv'),
    retryIndex: 0,
    parentSessionId: skillCtx.parentSessionId ?? null,
    foundation,
  }, deps);
  if (!baseAttempt.contextRequest) return baseAttempt;

  await finishContextRequestBaseInvocation(baseAttempt, deps);
  const retryAttempt = await invokeSkillAttempt(c, skill, {
    ...skillCtx,
    inputs: c.inputs,
  }, {
    contextPack: baseAttempt.contextRequest.supplementContextPack,
    contextPackArtifactId: baseAttempt.contextRequest.supplementArtifactId,
    contextPackArtifactRole: 'supplement',
    invocationId: baseAttempt.contextRequest.supplementInvocationId,
    retryIndex: 1,
    parentSessionId: baseAttempt.sessionId,
    foundation,
  }, deps);
  if (!retryAttempt.contextRequest) {
    return {
      ...retryAttempt,
      contextRequest: baseAttempt.contextRequest,
    };
  }

  const message = `context_request retry limit reached after ${retryAttempt.contextRequest.request.id}`;
  await failInvocation(retryAttempt, message, deps, {
    contextRequestId: retryAttempt.contextRequest.request.id,
    supplementContextPackId: retryAttempt.contextRequest.supplementContextPackId,
  });
  throw new Error(message);
}

async function invokeSkillAttempt(
  c: RunCtx,
  skill: SkillSpec,
  skillCtx: Parameters<AgentBackend['run']>[1],
  attempt: {
    contextPack: ContextPack;
    contextPackArtifactId?: string | null;
    contextPackArtifactRole: ContextPackArtifactRole;
    invocationId: string;
    retryIndex: number;
    parentSessionId: string | null;
    foundation: RunCtx['contextFoundation'];
  },
  deps: InvokeSkillDeps,
): Promise<InvokedAgent> {
  const contextPack = attempt.contextPack;
  const enrichedCtx = {
    ...skillCtx,
    inputs: c.inputs,
    inputArtifactIds: c.inputArtifactIds,
    contextPack,
    sensitivePathPatterns: c.contextPolicy.sensitivePathPatterns,
  };
  const task = await deps.agentTaskStarted({
    workflowRunId: skillCtx.workflowRunId,
    stepRunId: skillCtx.stepRunId ?? null,
    kind: taskKindForSkill(skill),
    backend: c.backend.kind,
    prompt: renderAgentPromptAudit(
      skill,
      enrichedCtx.inputs,
      c.inputArtifactIds,
      c.contextPolicy.sensitivePathPatterns,
      contextPack,
    ),
    inputArtifactIds: skill.inputs
      .map((i) => c.inputArtifactIds[i.name])
      .filter((id): id is string => Boolean(id)),
  });
  const contextPackArtifactId = attempt.contextPackArtifactId
    ?? await persistContextPackArtifact(skill, skillCtx, {
      contextPack,
      taskId: task.task.id,
      invocationId: attempt.invocationId,
      role: attempt.contextPackArtifactRole,
      retryIndex: attempt.retryIndex,
      parentInvocationId: null,
      baseContextPackArtifactId: null,
    }, deps);
  const session = await deps.agentSessionStarted({
    workflowRunId: skillCtx.workflowRunId,
    agentTaskId: task.task.id,
    stage: skill.stage,
    skillId: skill.id,
    skillVersion: skill.version,
    contextPackId: contextPack.id,
    parentSessionId: attempt.parentSessionId,
    retryIndex: attempt.retryIndex,
    metadata: {
      invocationId: attempt.invocationId,
      contextPackArtifactId,
      contextPackRole: attempt.contextPackArtifactRole,
      contextMode: contextPack.mode,
      manifestCount: contextPack.manifest.length,
      contextRequestId: contextPack.supplement?.contextRequestId ?? null,
      baseContextPackId: contextPack.supplement?.baseContextPackId ?? null,
    },
  });
  await recordSelectedKnowledgeUsage(contextPack, task.task.id, deps);
  await recordKnowledgeReviewSignals(contextPack, task.task.id, deps);
  try {
    const result = await c.backend.run(skill, enrichedCtx);
    const contextRequest = await captureContextRequest(c, {
      skill,
      skillCtx,
      result,
      foundation: attempt.foundation,
      baseContextPack: contextPack,
      taskId: task.task.id,
      invocationId: attempt.invocationId,
      baseContextPackArtifactId: contextPackArtifactId,
      retryIndex: attempt.retryIndex + 1,
    }, deps);
    return {
      taskId: task.task.id,
      sessionId: session.session.id,
      invocationId: attempt.invocationId,
      contextPackArtifactId,
      outputs: result.outputs,
      contextPack,
      contextRequest,
    };
  } catch (err) {
    const finished = await deps.agentTaskFinished({
      taskId: task.task.id,
      status: 'failed',
      summary: errorMessage(err),
      outputArtifactIds: [],
    });
    await deps.agentSessionFinished({
      sessionId: session.session.id,
      status: 'failed',
      agentResultId: finished.result.id,
      metadata: {
        error: errorMessage(err),
        invocationId: attempt.invocationId,
        contextPackArtifactId,
      },
    });
    throw err;
  }
}

async function persistContextPackArtifact(
  skill: SkillSpec,
  skillCtx: Parameters<AgentBackend['run']>[1],
  input: {
    contextPack: ContextPack;
    taskId: string;
    invocationId: string;
    role: ContextPackArtifactRole;
    retryIndex: number;
    parentInvocationId: string | null;
    baseContextPackArtifactId: string | null;
  },
  deps: InvokeSkillDeps,
): Promise<string> {
  const contextPackDir = join(skillCtx.artifactsDir, 'context-packs');
  await mkdir(contextPackDir, { recursive: true });
  const outputName = `context_pack.${input.role}.${safeFileSegment(input.contextPack.id)}.json`;
  const outputPath = join(contextPackDir, outputName);
  const envelope: ContextPackArtifactEnvelope = {
    schemaVersion: CONTEXT_PACK_ARTIFACT_SCHEMA_VERSION,
    snapshot: {
      invocationId: input.invocationId,
      workflowRunId: skillCtx.workflowRunId,
      stepRunId: skillCtx.stepRunId ?? null,
      stage: skill.stage,
      skillId: skill.id,
      skillVersion: skill.version,
      contextPackId: input.contextPack.id,
      contextPackArtifactId: null,
      contextPackRole: input.role,
      retryIndex: input.retryIndex,
      parentInvocationId: input.parentInvocationId,
      contextRequestId: input.contextPack.supplement?.contextRequestId ?? null,
      baseContextPackId: input.contextPack.supplement?.baseContextPackId ?? null,
      createdAt: input.contextPack.createdAt,
    },
    contextPack: input.contextPack,
  };
  const body = `${JSON.stringify(envelope, null, 2)}\n`;
  await writeFile(outputPath, body, 'utf8');
  const artifact = await deps.postArtifact({
    workflowRunId: skillCtx.workflowRunId,
    stepRunId: skillCtx.stepRunId ?? null,
    kind: 'context_pack',
    uri: `file://${outputPath}`,
    size: Buffer.byteLength(body, 'utf8'),
    contentType: 'application/json',
    metadata: {
      schemaVersion: CONTEXT_PACK_ARTIFACT_SCHEMA_VERSION,
      output: outputName,
      stage: skill.stage,
      skill: skill.id,
      skillVersion: skill.version,
      invocationId: input.invocationId,
      taskId: input.taskId,
      retryIndex: input.retryIndex,
      contextPackId: input.contextPack.id,
      contextPackRole: input.role,
      contextRequestId: input.contextPack.supplement?.contextRequestId ?? null,
      baseContextPackId: input.contextPack.supplement?.baseContextPackId ?? null,
      baseContextPackArtifactId: input.baseContextPackArtifactId,
      contextSelection: contextSelectionAudit(input.contextPack),
    },
  });
  return artifact.id;
}

function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_') || 'context_pack';
}

async function finishContextRequestBaseInvocation(
  agent: InvokedAgent,
  deps: InvokeSkillDeps,
): Promise<void> {
  const contextRequest = agent.contextRequest;
  if (!contextRequest) return;
  const outputArtifactIds = [
    contextRequest.requestArtifactId,
    contextRequest.supplementArtifactId,
  ];
  const finished = await deps.agentTaskFinished({
    taskId: agent.taskId,
    status: 'success',
    summary: `context_request ${contextRequest.request.id} captured; retrying same skill with supplement ${contextRequest.supplementContextPackId}`,
    outputArtifactIds,
  });
  await deps.agentSessionFinished({
    sessionId: agent.sessionId,
    status: 'success',
    agentResultId: finished.result.id,
    metadata: {
      invocationId: agent.invocationId,
      contextPackArtifactId: agent.contextPackArtifactId,
      contextRequestId: contextRequest.request.id,
      baseInvocationId: contextRequest.baseInvocationId,
      supplementInvocationId: contextRequest.supplementInvocationId,
      baseContextPackArtifactId: contextRequest.baseContextPackArtifactId,
      supplementContextPackId: contextRequest.supplementContextPackId,
      supplementContextPackArtifactId: contextRequest.supplementArtifactId,
      retryPlanned: true,
    },
  });
}

async function failInvocation(
  agent: InvokedAgent,
  message: string,
  deps: InvokeSkillDeps,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const contextRequest = agent.contextRequest;
  const outputArtifactIds = contextRequest
    ? [contextRequest.requestArtifactId, contextRequest.supplementArtifactId]
    : [];
  const finished = await deps.agentTaskFinished({
    taskId: agent.taskId,
    status: 'failed',
    summary: message,
    outputArtifactIds,
  });
  await deps.agentSessionFinished({
    sessionId: agent.sessionId,
    status: 'failed',
    agentResultId: finished.result.id,
    metadata: {
      error: message,
      invocationId: agent.invocationId,
      contextPackArtifactId: agent.contextPackArtifactId,
      ...metadata,
    },
  });
}

async function recordKnowledgeReviewSignals(
  contextPack: ContextPack,
  taskId: string,
  deps: InvokeSkillDeps,
): Promise<void> {
  const signals = contextPack.calibrationSignals ?? [];
  if (signals.length === 0) return;
  for (const signal of signals) {
    try {
      await deps.recordKnowledgeAction({
        workflowRunId: contextPack.workflowRunId,
        targetId: signal.id,
        action: knowledgeReviewActionForSignal(signal.recommendedAction),
        actor: 'runner',
        payload: {
          reason: signal.message,
          signalKind: signal.kind,
          severity: signal.severity,
          subjectRefs: signal.subjectRefs,
          evidenceRefs: signal.evidenceRefs,
          recommendedAction: signal.recommendedAction,
          contextPackId: contextPack.id,
          taskId,
        },
      });
    } catch (err) {
      console.warn(
        `[runner] knowledge review signal ${signal.id} was not recorded: ${errorMessage(err)}`,
      );
    }
  }
}

async function contextPackInputArtifactsForSkill(
  c: RunCtx,
  skillInputs: Readonly<Record<string, string>>,
  foundation: RunCtx['contextFoundation'],
  sourceChunkIndexCatalogQuery: string | null,
  deps: InvokeSkillDeps,
): Promise<BuildContextPackInputArtifact[]> {
  const inputArtifacts = Object.entries(skillInputs).map(([name, content]) => ({
    name,
    content,
    artifactId: c.inputArtifactIds[name] ?? null,
  }));
  const currentInventoryInput = c.inputs['project-inventory.json'];
  if (
    !hasProjectInventoryInput(skillInputs)
    && typeof currentInventoryInput === 'string'
  ) {
    inputArtifacts.push({
      name: 'project-inventory.json',
      content: currentInventoryInput,
      artifactId: c.inputArtifactIds['project-inventory.json'] ?? null,
    });
  }
  if (inputArtifacts.some((artifact) => artifact.name === 'project-inventory.json')) {
    const currentSourceChunkIndex = await currentSourceChunkIndexInputFromCatalog(
      c,
      inputArtifacts,
      sourceChunkIndexCatalogQuery,
      taskScopedSourceChunkIndexLinkedRecordRefs(inputArtifacts, sourceChunkIndexCatalogQuery),
      deps,
    );
    return currentSourceChunkIndex
      ? [...inputArtifacts, currentSourceChunkIndex]
      : inputArtifacts;
  }

  const historicalInventory = await discoverHistoricalProjectInventoryInputArtifact(
    c,
    foundation,
    sourceChunkIndexCatalogQuery,
    deps,
  );
  if (!historicalInventory) return inputArtifacts;
  const { sourceChunkIndexArtifact, ...inventoryArtifact } = historicalInventory;
  return sourceChunkIndexArtifact
    ? [...inputArtifacts, inventoryArtifact, sourceChunkIndexArtifact]
    : [...inputArtifacts, inventoryArtifact];
}

async function discoverHistoricalProjectInventoryInputArtifact(
  c: RunCtx,
  foundation: RunCtx['contextFoundation'],
  sourceChunkIndexCatalogQuery: string | null,
  deps: InvokeSkillDeps,
): Promise<HistoricalProjectInventoryInput | null> {
  if (foundation.historicalInventoryArtifactChecked) {
    const historicalInventory = foundation.historicalInventoryArtifact;
    if (
      historicalInventory?.artifactId
      && !historicalInventory.sourceChunkIndexArtifact
      && sourceChunkIndexCatalogQuery
    ) {
      const sourceChunkIndexArtifact = await sourceChunkIndexInputFromCatalog(
        c.project.id,
        {
          sourceInventoryArtifactId: historicalInventory.artifactId,
          createdAt: historicalInventory.createdAt ?? null,
          q: sourceChunkIndexCatalogQuery,
        },
        deps,
      );
      if (sourceChunkIndexArtifact) {
        const refreshed = {
          ...historicalInventory,
          sourceChunkIndexArtifact,
        };
        foundation.historicalInventoryArtifact = refreshed;
        return refreshed;
      }
    }
    return foundation.historicalInventoryArtifact;
  }

  const priorRuns = [...(foundation.runHistory ?? [])]
    .filter((run) => run.projectId === c.project.id && run.id !== c.run.id)
    .sort(compareWorkflowRunsByLatestFirst);
  for (const run of priorRuns) {
    let artifacts: readonly Artifact[] = [];
    try {
      const detail = await deps.getWorkflowRun(run.id);
      artifacts = detail.artifacts ?? [];
    } catch (err) {
      console.warn(
        `[runner] workflow run ${run.id} unavailable for historical project_inventory discovery: ${errorMessage(err)}`,
      );
      continue;
    }

    const artifact = latestProjectInventoryArtifact(artifacts);
    if (!artifact) continue;
    const sourceChunkIndexArtifact = latestSourceChunkIndexArtifact(artifacts, artifact);
    try {
      const content = await deps.getArtifactContent(artifact.id);
      const linkedRecordRefs = sourceChunkIndexCatalogQuery
        ? sourceChunkIndexLinkedRecordRefsForTaskBrief(content.text, sourceChunkIndexCatalogQuery)
        : [];
      let historicalSourceChunkIndex: HistoricalSourceChunkIndexInput | null = null;
      if (sourceChunkIndexArtifact) {
        try {
          const indexContent = await deps.getArtifactContent(sourceChunkIndexArtifact.id);
          historicalSourceChunkIndex = {
            name: 'source-chunk-index.json',
            content: indexContent.text,
            artifactId: sourceChunkIndexArtifact.id,
            createdAt: sourceChunkIndexArtifact.createdAt,
          };
        } catch (err) {
          console.warn(
            `[runner] source_chunk_index artifact ${sourceChunkIndexArtifact.id} unavailable for context pack: ${errorMessage(err)}`,
          );
          historicalSourceChunkIndex = await sourceChunkIndexInputFromCatalog(
            c.project.id,
            {
              sourceChunkIndexArtifactId: sourceChunkIndexArtifact.id,
              sourceInventoryArtifactId: artifact.id,
              createdAt: sourceChunkIndexArtifact.createdAt,
              q: sourceChunkIndexCatalogQuery,
              linkedRecordRefs,
            },
            deps,
          );
        }
      } else {
        historicalSourceChunkIndex = await sourceChunkIndexInputFromCatalog(
          c.project.id,
          {
            sourceInventoryArtifactId: artifact.id,
            createdAt: artifact.createdAt,
            q: sourceChunkIndexCatalogQuery,
            linkedRecordRefs,
          },
          deps,
        );
      }
      const historicalInventory = {
        name: 'project-inventory.json' as const,
        content: content.text,
        artifactId: artifact.id,
        createdAt: artifact.createdAt,
        sourceChunkIndexArtifact: historicalSourceChunkIndex,
      };
      foundation.historicalInventoryArtifact = historicalInventory;
      foundation.historicalInventoryArtifactChecked = true;
      return historicalInventory;
    } catch (err) {
      console.warn(
        `[runner] project_inventory artifact ${artifact.id} unavailable for context pack: ${errorMessage(err)}`,
      );
      const historicalSourceChunkIndex = await sourceChunkIndexInputForArtifactPair(
        c.project.id,
        artifact,
        sourceChunkIndexArtifact,
        sourceChunkIndexCatalogQuery,
        deps,
      );
      if (historicalSourceChunkIndex) {
        const historicalInventory = {
          name: 'project-inventory.json' as const,
          content: '',
          artifactId: artifact.id,
          createdAt: artifact.createdAt,
          sourceChunkIndexArtifact: historicalSourceChunkIndex,
        };
        foundation.historicalInventoryArtifact = historicalInventory;
        foundation.historicalInventoryArtifactChecked = true;
        return historicalInventory;
      }
    }
  }
  foundation.historicalInventoryArtifact = null;
  foundation.historicalInventoryArtifactChecked = true;
  return null;
}

async function currentSourceChunkIndexInputFromCatalog(
  c: RunCtx,
  inputArtifacts: readonly BuildContextPackInputArtifact[],
  sourceChunkIndexCatalogQuery: string | null,
  linkedRecordRefs: readonly string[],
  deps: InvokeSkillDeps,
): Promise<HistoricalSourceChunkIndexInput | null> {
  if (hasSourceChunkIndexInput(inputArtifacts)) return null;
  const sourceInventoryArtifactId = c.inputArtifactIds['project-inventory.json'];
  if (!sourceInventoryArtifactId) return null;
  return sourceChunkIndexInputFromCatalog(
    c.project.id,
    {
      sourceInventoryArtifactId,
      createdAt: null,
      q: sourceChunkIndexCatalogQuery,
      linkedRecordRefs,
    },
    deps,
  );
}

async function sourceChunkIndexInputForArtifactPair(
  projectId: string,
  inventoryArtifact: Artifact,
  sourceChunkIndexArtifact: Artifact | null,
  sourceChunkIndexCatalogQuery: string | null,
  deps: InvokeSkillDeps,
): Promise<HistoricalSourceChunkIndexInput | null> {
  return sourceChunkIndexInputFromCatalog(
    projectId,
    {
      sourceChunkIndexArtifactId: sourceChunkIndexArtifact?.id ?? null,
      sourceInventoryArtifactId: inventoryArtifact.id,
      createdAt: sourceChunkIndexArtifact?.createdAt ?? inventoryArtifact.createdAt,
      q: sourceChunkIndexCatalogQuery,
    },
    deps,
  );
}

async function sourceChunkIndexInputFromCatalog(
  projectId: string,
  input: {
    sourceChunkIndexArtifactId?: string | null;
    sourceInventoryArtifactId: string;
    createdAt?: string | null;
    q?: string | null;
    linkedRecordRefs?: readonly string[];
  },
  deps: InvokeSkillDeps,
): Promise<HistoricalSourceChunkIndexInput | null> {
  try {
    const baseParams: Parameters<InvokeSkillDeps['listSourceChunkIndexEntries']>[0] = {
      projectId,
      sourceChunkIndexArtifactId: input.sourceChunkIndexArtifactId ?? null,
      sourceInventoryArtifactId: input.sourceInventoryArtifactId,
      limit: 500,
    };
    const rows: SourceChunkIndexCatalogEntry[] = [];
    if (input.q) {
      const queryEmbedding = await sourceChunkIndexEmbeddingForText(input.q, {
        kind: 'catalog_query',
        provider: deps.sourceChunkEmbeddingProvider
          ?? sourceChunkIndexConfiguredEmbeddingProvider(),
      });
      rows.push(...await deps.listSourceChunkIndexEntries({
        ...baseParams,
        q: input.q,
        queryEmbedding: queryEmbedding.vector,
        queryEmbeddingModel: queryEmbedding.model,
      }));
    }
    if (rows.length === 0) {
      for (const linkedRecordRef of uniqueStrings(input.linkedRecordRefs ?? [])
        .slice(0, SOURCE_CHUNK_INDEX_CATALOG_MAX_LINKED_RECORD_REFS)) {
        rows.push(...await deps.listSourceChunkIndexEntries({
          ...baseParams,
          linkedRecordRef,
          limit: SOURCE_CHUNK_INDEX_CATALOG_LINKED_RECORD_QUERY_LIMIT,
        }));
      }
    }
    if (!input.q && rows.length === 0) {
      rows.push(...await deps.listSourceChunkIndexEntries(baseParams));
    }
    const uniqueRows = uniqueSourceChunkIndexCatalogRows(rows);
    if (uniqueRows.length === 0) return null;
    const artifactId = input.sourceChunkIndexArtifactId ?? uniqueRows[0]?.sourceChunkIndexArtifactId ?? null;
    return {
      name: 'source-chunk-index.json',
      content: `${JSON.stringify(sourceChunkIndexEnvelopeFromCatalogRows(uniqueRows), null, 2)}\n`,
      artifactId,
      createdAt: input.createdAt ?? uniqueRows[0]?.createdAt ?? null,
    };
  } catch (err) {
    console.warn(
      `[runner] source_chunk_index catalog unavailable for context pack: ${errorMessage(err)}`,
    );
    return null;
  }
}

function uniqueSourceChunkIndexCatalogRows(
  rows: readonly SourceChunkIndexCatalogEntry[],
): SourceChunkIndexCatalogEntry[] {
  const seen = new Set<string>();
  const selected: SourceChunkIndexCatalogEntry[] = [];
  for (const row of rows) {
    const key = [
      row.id,
      row.sourceChunkIndexArtifactId,
      row.sourceChunkRef,
      row.contentSha256,
      row.path,
      row.startLine,
      row.endLine,
    ].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(row);
    if (selected.length >= 500) break;
  }
  return selected;
}

function taskScopedSourceChunkIndexLinkedRecordRefs(
  inputArtifacts: readonly BuildContextPackInputArtifact[],
  taskBrief: string | null,
): string[] {
  if (!taskBrief) return [];
  const inventoryArtifact = inputArtifacts.find((artifact) => artifact.name === 'project-inventory.json');
  if (!inventoryArtifact) return [];
  return sourceChunkIndexLinkedRecordRefsForTaskBrief(inventoryArtifact.content, taskBrief);
}

function sourceChunkIndexLinkedRecordRefsForTaskBrief(
  content: string,
  taskBrief: string,
): string[] {
  const tokens = sourceChunkIndexTaskTokens(taskBrief);
  if (tokens.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 'ainp.project_inventory.v1') return [];

  const candidates = [
    ...sourceChunkIndexRecordCandidates(parsed.entrypoints, 'entrypoint'),
    ...sourceChunkIndexRecordCandidates(parsed.symbols, 'symbol'),
    ...sourceChunkIndexRecordCandidates(parsed.domainEntities, 'domain_entity'),
    ...sourceChunkIndexRecordCandidates(
      isRecord(parsed.symbolGraph) ? parsed.symbolGraph.edges : null,
      'graph_edge',
    ),
    ...sourceChunkIndexRecordCandidates(parsed.testSurfaces, 'test'),
    ...sourceChunkIndexRecordCandidates(parsed.hotspots, 'hotspot'),
    ...sourceChunkIndexRecordCandidates(parsed.capabilities, 'capability'),
  ].map((candidate) => ({
    ...candidate,
    score: tokens.filter((token) => candidate.searchTokens.has(token)).length,
  })).filter((candidate) => candidate.score > 0);
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => (
    b.score - a.score
    || a.id.localeCompare(b.id)
  ));

  const refs: string[] = [];
  for (const candidate of candidates.slice(0, 8)) {
    refs.push(...sourceChunkIndexLinkedRecordRefVariants(candidate.id, candidate.kind));
    if (candidate.kind === 'capability') {
      refs.push(
        ...sourceChunkIndexRecordRefVariantsForField(candidate.record, 'entrypointRefs', 'entrypoint'),
        ...sourceChunkIndexRecordRefVariantsForField(candidate.record, 'symbolRefs', 'symbol'),
        ...sourceChunkIndexRecordRefVariantsForField(candidate.record, 'domainEntityRefs', 'domain_entity'),
        ...sourceChunkIndexRecordRefVariantsForField(candidate.record, 'graphEdgeRefs', 'graph_edge'),
        ...sourceChunkIndexRecordRefVariantsForField(candidate.record, 'testRefs', 'test'),
        ...sourceChunkIndexRecordRefVariantsForField(candidate.record, 'hotspotRefs', 'hotspot'),
      );
    }
    if (refs.length >= SOURCE_CHUNK_INDEX_CATALOG_MAX_LINKED_RECORD_REFS) break;
  }
  return uniqueStrings(refs).slice(0, SOURCE_CHUNK_INDEX_CATALOG_MAX_LINKED_RECORD_REFS);
}

function sourceChunkIndexRecordCandidates(
  value: unknown,
  kind: SourceChunkIndexLinkedRecordKind,
): Array<{
  id: string;
  kind: SourceChunkIndexLinkedRecordKind;
  record: Record<string, unknown>;
  searchText: string;
  searchTokens: Set<string>;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((record) => {
      const searchText = sourceChunkIndexRecordSearchText(record);
      return {
        id: stringField(record, 'id') ?? '',
        kind,
        record,
        searchText,
        searchTokens: new Set(searchText.split(' ').filter(Boolean)),
      };
    })
    .filter((candidate) => candidate.id && candidate.searchText.length > 0);
}

type SourceChunkIndexLinkedRecordKind =
  | 'entrypoint'
  | 'symbol'
  | 'domain_entity'
  | 'graph_edge'
  | 'test'
  | 'hotspot'
  | 'capability';

function sourceChunkIndexRecordSearchText(record: Record<string, unknown>): string {
  return normalizeSourceChunkIndexSearchText([
    stringField(record, 'label'),
    stringField(record, 'name'),
    stringField(record, 'kind'),
    stringField(record, 'method'),
    stringField(record, 'route'),
    stringField(record, 'handler'),
    stringField(record, 'signature'),
    stringField(record, 'frameworkHint'),
    ...stringArrayField(record, 'targetHints'),
  ].filter((value): value is string => Boolean(value)).join(' '));
}

function sourceChunkIndexRecordRefVariantsForField(
  record: Record<string, unknown>,
  field: string,
  kind: SourceChunkIndexLinkedRecordKind,
): string[] {
  return stringArrayField(record, field)
    .flatMap((ref) => sourceChunkIndexLinkedRecordRefVariants(ref, kind));
}

function sourceChunkIndexLinkedRecordRefVariants(
  id: string,
  kind: SourceChunkIndexLinkedRecordKind,
): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [];
  const prefix = sourceChunkIndexLinkedRecordPrefix(kind);
  return uniqueStrings([trimmed, `${prefix}:${trimmed}`]);
}

function sourceChunkIndexLinkedRecordPrefix(kind: SourceChunkIndexLinkedRecordKind): string {
  if (kind === 'domain_entity') return 'domain_entity';
  if (kind === 'graph_edge') return 'graph_edge';
  if (kind === 'test') return 'test';
  return kind;
}

function sourceChunkIndexTaskTokens(value: string): string[] {
  return uniqueStrings(normalizeSourceChunkIndexSearchText(value)
    .split(' ')
    .filter((token) => token.length >= 3)
    .filter((token) => !SOURCE_CHUNK_INDEX_TASK_STOPWORDS.has(token)))
    .slice(0, 20);
}

const SOURCE_CHUNK_INDEX_TASK_STOPWORDS = new Set([
  'add',
  'and',
  'api',
  'app',
  'behavior',
  'build',
  'catalog',
  'change',
  'code',
  'context',
  'current',
  'exact',
  'fix',
  'for',
  'from',
  'implement',
  'index',
  'legacy',
  'lookup',
  'metadata',
  'path',
  'project',
  'record',
  'retrieval',
  'run',
  'source',
  'task',
  'test',
  'the',
  'this',
  'use',
  'with',
]);

function normalizeSourceChunkIndexSearchText(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hasSourceChunkIndexInput(inputArtifacts: readonly BuildContextPackInputArtifact[]): boolean {
  return inputArtifacts.some((artifact) => (
    artifact.name === 'source-chunk-index.json'
    || artifact.name === 'source_chunk_index.json'
    || artifact.name === 'sourceChunkIndex.json'
  ));
}

function sourceChunkIndexEnvelopeFromCatalogRows(rows: readonly SourceChunkIndexCatalogEntry[]) {
  return {
    schemaVersion: 'ainp.source_chunk_index.v1',
    source: 'api.source_chunk_index_entries',
    chunkCount: rows.length,
    maxEntries: rows.length,
    entries: rows.map((row) => ({
      id: row.id,
      sourceChunkRef: row.sourceChunkRef,
      contentSha256: row.contentSha256,
      path: row.path,
      language: row.language,
      startLine: row.startLine,
      endLine: row.endLine,
      lexicalTokens: row.lexicalTokens,
      searchText: row.searchText,
      linkedRecordRefs: row.linkedRecordRefs,
      sourceRefs: row.sourceRefs,
      entrypointRefs: row.entrypointRefs,
      symbolRefs: row.symbolRefs,
      domainEntityRefs: row.domainEntityRefs,
      graphEdgeRefs: row.graphEdgeRefs,
      testRefs: row.testRefs,
      hotspotRefs: row.hotspotRefs,
      capabilityRefs: row.capabilityRefs,
      ...(row.embeddingModel ? { embeddingModel: row.embeddingModel } : {}),
      ...(row.embeddingDimensions ? { embeddingDimensions: row.embeddingDimensions } : {}),
      ...(row.embeddingVector ? { embeddingVector: row.embeddingVector } : {}),
    })),
  };
}

function latestProjectInventoryArtifact(artifacts: readonly Artifact[]): Artifact | null {
  return artifacts
    .filter(isProjectInventoryArtifact)
    .sort(compareArtifactsByLatestFirst)[0] ?? null;
}

function latestSourceChunkIndexArtifact(
  artifacts: readonly Artifact[],
  inventoryArtifact: Artifact,
): Artifact | null {
  const indexArtifacts = artifacts.filter(isSourceChunkIndexArtifact);
  const paired = indexArtifacts.filter((artifact) => (
    metadataString(artifact.metadata, 'sourceInventoryArtifactId') === inventoryArtifact.id
  ));
  if (paired.length > 0) return paired.sort(compareArtifactsByLatestFirst)[0] ?? null;

  const hasExplicitPairing = indexArtifacts.some((artifact) => (
    metadataString(artifact.metadata, 'sourceInventoryArtifactId') !== null
  ));
  if (hasExplicitPairing) return null;

  return indexArtifacts.sort(compareArtifactsByLatestFirst)[0] ?? null;
}

function isProjectInventoryArtifact(artifact: Artifact): boolean {
  const metadata = artifact.metadata;
  return metadataString(metadata, 'role') === 'project_inventory'
    || metadataString(metadata, 'output') === 'project-inventory.json'
    || metadataString(metadata, 'schemaVersion') === 'ainp.project_inventory.v1';
}

function isSourceChunkIndexArtifact(artifact: Artifact): boolean {
  const metadata = artifact.metadata;
  return metadataString(metadata, 'role') === 'source_chunk_index'
    || metadataString(metadata, 'output') === 'source-chunk-index.json'
    || metadataString(metadata, 'schemaVersion') === 'ainp.source_chunk_index.v1';
}

function hasProjectInventoryInput(inputs: Readonly<Record<string, string>>): boolean {
  return Object.prototype.hasOwnProperty.call(inputs, 'project-inventory.json');
}

function compareWorkflowRunsByLatestFirst(a: WorkflowRun, b: WorkflowRun): number {
  return timestampForWorkflowRun(b) - timestampForWorkflowRun(a)
    || b.id.localeCompare(a.id);
}

function compareArtifactsByLatestFirst(a: Artifact, b: Artifact): number {
  return timestampForArtifact(b) - timestampForArtifact(a)
    || b.id.localeCompare(a.id);
}

function timestampForWorkflowRun(run: WorkflowRun): number {
  return Date.parse(run.updatedAt || run.createdAt) || Date.parse(run.createdAt) || 0;
}

function timestampForArtifact(artifact: Artifact): number {
  return Date.parse(artifact.createdAt) || 0;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sourceChunkIndexCatalogQueryForTaskBrief(taskBrief: string): string | null {
  const normalized = taskBrief.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;
  if (normalized.length <= SOURCE_CHUNK_INDEX_CATALOG_QUERY_MAX_LENGTH) return normalized;

  const bounded = normalized
    .slice(0, SOURCE_CHUNK_INDEX_CATALOG_QUERY_MAX_LENGTH)
    .trimEnd();
  const lastSpace = bounded.lastIndexOf(' ');
  return lastSpace >= 80 ? bounded.slice(0, lastSpace) : bounded;
}

function sourceChunkIndexCatalogQueryForContextRequest(
  request: ContextRequest,
  taskBrief: string,
): string | null {
  const requestQuery = [
    ...request.requestedRefs,
    ...request.questions,
  ].join(' ');
  const normalizedRequestQuery = requestQuery.replace(/\s+/g, ' ').trim();
  if (normalizedRequestQuery.length === 0) {
    return sourceChunkIndexCatalogQueryForTaskBrief(taskBrief);
  }

  const boundedTaskBriefQuery = sourceChunkIndexCatalogQueryForTaskBrief(taskBrief);
  const query = boundedTaskBriefQuery
    ? `${normalizedRequestQuery} ${boundedTaskBriefQuery}`
    : normalizedRequestQuery;
  return sourceChunkIndexCatalogQueryForTaskBrief(query);
}

export async function captureContextRequest(
  c: RunCtx,
  input: {
    skill: SkillSpec;
    skillCtx: Parameters<AgentBackend['run']>[1];
    result: Awaited<ReturnType<AgentBackend['run']>>;
    foundation: RunCtx['contextFoundation'];
    baseContextPack: ContextPack;
    taskId: string;
    invocationId: string;
    baseContextPackArtifactId: string;
    retryIndex?: number;
  },
  deps: InvokeSkillDeps = DEFAULT_INVOKE_SKILL_DEPS,
): Promise<ContextRequestCapture | null> {
  const parsed = await parseContextRequestFromRunResult(input);
  if (!parsed) return null;

  const request = sanitizeContextRequestForContextInjection(
    parsed.request,
    c.contextPolicy.sensitivePathPatterns,
  );
  if (request.requestedRefs.length === 0 && request.questions.length === 0) {
    console.warn(
      `[runner] context_request ${parsed.request.id} was ignored after sensitive path filtering removed all requested context`,
    );
    return null;
  }

  const taskBrief = agentTaskBriefForRunContext(input.skillCtx.title, c, input.skillCtx.inputs);
  const catalogQuery = sourceChunkIndexCatalogQueryForContextRequest(request, taskBrief);
  const inputArtifacts = await contextPackInputArtifactsForSkill(
    c,
    input.skillCtx.inputs,
    input.foundation,
    catalogQuery,
    deps,
  );
  const supplementPack = buildIncrementalContextPack({
    project: c.project,
    run: c.run,
    stage: input.skill.stage,
    stepRunId: input.skillCtx.stepRunId ?? null,
    workspacePath: input.skillCtx.workspacePath,
    branch: input.skillCtx.branch,
    taskBrief,
    projectProfile: input.foundation.projectProfileResult?.profile ?? null,
    projectProfileMarkdown: input.foundation.projectProfileResult?.markdown
      ?? input.skillCtx.inputs['project_profile.md'],
    acceptedKnowledgeMarkdown: acceptedKnowledgeMarkdownForContext({
      legacyMarkdown: input.foundation.acceptedKnowledge
        ?? input.skillCtx.inputs['accepted_knowledge.md'],
      knowledgeArtifacts: input.foundation.knowledgeArtifacts,
    }),
    knowledgeArtifacts: input.foundation.knowledgeArtifacts ?? [],
    runHistory: input.foundation.runHistory ?? [],
    inputNames: inputArtifacts.map((artifact) => artifact.name),
    inputArtifacts,
    budget: c.contextPolicy.budget,
    sensitivePathPatterns: c.contextPolicy.sensitivePathPatterns,
    contextRequest: request,
    baseContextPack: input.baseContextPack,
    retryIndex: input.retryIndex ?? 1,
  });

  const requestInputName = `context_request.${request.id}.json`;
  const supplementInputName = `context_supplement.${request.id}.json`;
  const supplementInvocationId = newId('ctxinv');
  const requestBody = `${JSON.stringify({
    schemaVersion: CONTEXT_REQUEST_SCHEMA_VERSION,
    sourceName: parsed.sourceName,
    taskId: input.taskId,
    invocationId: input.invocationId,
    baseContextPackId: input.baseContextPack.id,
    baseContextPackArtifactId: input.baseContextPackArtifactId,
    request,
  }, null, 2)}\n`;
  const supplementBody = `${JSON.stringify({
    schemaVersion: 'ainp.context_supplement.v1',
    invocationId: supplementInvocationId,
    contextRequestId: request.id,
    baseContextPackId: input.baseContextPack.id,
    baseContextPackArtifactId: input.baseContextPackArtifactId,
    contextPack: supplementPack,
  }, null, 2)}\n`;

  const contextRequestDir = join(input.skillCtx.artifactsDir, 'context-requests');
  await mkdir(contextRequestDir, { recursive: true });
  const requestPath = join(contextRequestDir, requestInputName);
  const supplementPath = join(contextRequestDir, supplementInputName);
  await writeFile(requestPath, requestBody, 'utf8');
  await writeFile(supplementPath, supplementBody, 'utf8');

  const requestArtifact = await deps.postArtifact({
    workflowRunId: input.skillCtx.workflowRunId,
    stepRunId: input.skillCtx.stepRunId ?? null,
    kind: 'other',
    uri: `file://${requestPath}`,
    size: Buffer.byteLength(requestBody, 'utf8'),
    contentType: 'application/json',
    metadata: {
      schemaVersion: CONTEXT_REQUEST_SCHEMA_VERSION,
      output: requestInputName,
      stage: input.skill.stage,
      contextRequestId: request.id,
      baseContextPackId: input.baseContextPack.id,
      baseContextPackArtifactId: input.baseContextPackArtifactId,
      invocationId: input.invocationId,
      sourceName: parsed.sourceName,
    },
  });
  const supplementArtifact = await deps.postArtifact({
    workflowRunId: input.skillCtx.workflowRunId,
    stepRunId: input.skillCtx.stepRunId ?? null,
    kind: 'context_pack',
    uri: `file://${supplementPath}`,
    size: Buffer.byteLength(supplementBody, 'utf8'),
    contentType: 'application/json',
    metadata: {
      schemaVersion: 'ainp.context_supplement.v1',
      output: supplementInputName,
      stage: input.skill.stage,
      contextRequestId: request.id,
      baseContextPackId: input.baseContextPack.id,
      baseContextPackArtifactId: input.baseContextPackArtifactId,
      invocationId: supplementInvocationId,
      retryIndex: input.retryIndex ?? 1,
      contextPackId: supplementPack.id,
      contextPackRole: 'supplement',
      contextSelection: contextSelectionAudit(supplementPack),
    },
  });
  await recordSelectedKnowledgeUsage(supplementPack, input.taskId, deps);

  c.inputs[requestInputName] = requestBody;
  c.inputs[supplementInputName] = supplementBody;
  c.inputArtifactIds[requestInputName] = requestArtifact.id;
  c.inputArtifactIds[supplementInputName] = supplementArtifact.id;

  const capture: ContextRequestCapture = {
    request,
    sourceName: parsed.sourceName,
    requestArtifactId: requestArtifact.id,
    supplementArtifactId: supplementArtifact.id,
    supplementContextPackId: supplementPack.id,
    supplementContextPack: supplementPack,
    baseContextPackId: input.baseContextPack.id,
    baseContextPackArtifactId: input.baseContextPackArtifactId,
    baseInvocationId: input.invocationId,
    supplementInvocationId,
  };
  c.contextRequestChain.push(capture);
  await deps.recordContextRequest({
    workflowRunId: input.skillCtx.workflowRunId,
    request,
    sourceName: parsed.sourceName,
    taskId: input.taskId,
    baseContextPackId: input.baseContextPack.id,
    baseContextPackArtifactId: input.baseContextPackArtifactId,
    supplementContextPackId: supplementPack.id,
    requestArtifactId: requestArtifact.id,
    supplementArtifactId: supplementArtifact.id,
  });
  console.log(
    `[runner] context_request ${request.id} -> supplement ${supplementPack.id}`,
  );
  return capture;
}

async function recordSelectedKnowledgeUsage(
  contextPack: ContextPack,
  taskId: string,
  deps: InvokeSkillDeps,
): Promise<void> {
  const items = selectedKnowledgeUsageItems(contextPack);
  if (items.length === 0) return;
  try {
    await deps.recordKnowledgeUsage({
      workflowRunId: contextPack.workflowRunId,
      contextPackId: contextPack.id,
      taskId,
      actor: 'runner',
      items,
    });
  } catch (err) {
    console.warn(
      `[runner] selected knowledge usage was not recorded: ${errorMessage(err)}`,
    );
  }
}

async function parseContextRequestFromRunResult(input: {
  skill: SkillSpec;
  skillCtx: Parameters<AgentBackend['run']>[1];
  result: Awaited<ReturnType<AgentBackend['run']>>;
}): Promise<ParsedContextRequest | null> {
  const sources: Array<{ name: string; text: string }> = [];
  if (input.result.lastMessage) {
    sources.push({ name: 'last_message', text: input.result.lastMessage });
  }
  for (const out of input.result.outputs) {
    if (!isContextRequestParseableOutput(out)) continue;
    const text = await Bun.file(out.path).text();
    sources.push({ name: out.name, text });
  }
  return parseContextRequestFromAgentOutput({
    workflowRunId: input.skillCtx.workflowRunId,
    stepRunId: input.skillCtx.stepRunId ?? null,
    stage: input.skill.stage,
    sources,
  });
}

function isContextRequestParseableOutput(output: {
  name: string;
  contentType: string;
  size: number;
}): boolean {
  if (output.size > 256_000) return false;
  return output.contentType === 'application/json'
    || output.contentType.startsWith('text/')
    || /\.(json|md|markdown|txt)$/i.test(output.name);
}

export async function ensureContextFoundation(c: RunCtx): Promise<RunCtx['contextFoundation']> {
  if (!c.contextFoundation.projectProfileResult) {
    const profileResult = await generateProjectProfile({
      projectId: c.project.id,
      name: c.project.name,
      localPath: c.project.localPath,
      reuseIfPresent: true,
    });
    c.contextFoundation.projectProfileResult = profileResult;
    c.inputs['project_profile.md'] = profileResult.markdown;
  }

  if (c.contextFoundation.acceptedKnowledge === null) {
    const acceptedKnowledge = await collectAcceptedKnowledge(c.project.id);
    c.contextFoundation.acceptedKnowledge = acceptedKnowledge;
    c.inputs['accepted_knowledge.md'] = acceptedKnowledge;
    if (acceptedKnowledge) {
      console.log(`[runner] accepted_knowledge: ${acceptedKnowledge.length} bytes`);
    }
  }

  if (c.contextFoundation.knowledgeArtifacts === null) {
    try {
      c.contextFoundation.knowledgeArtifacts = await api.listKnowledgeArtifacts({
        projectId: c.project.id,
      });
    } catch (err) {
      console.warn(
        `[runner] knowledge_artifacts unavailable for context pack: ${errorMessage(err)}`,
      );
      c.contextFoundation.knowledgeArtifacts = [];
    }
  }

  if (c.contextFoundation.runHistory === null) {
    try {
      c.contextFoundation.runHistory = await api.listWorkflowRuns({ projectId: c.project.id });
    } catch (err) {
      console.warn(
        `[runner] workflow run history unavailable for maturity profile: ${errorMessage(err)}`,
      );
      c.contextFoundation.runHistory = [];
    }
  }

  return c.contextFoundation;
}

export async function finishAgentSuccess(
  agent: InvokedAgent,
  outputArtifactIds: string[],
  summary: string,
  agentTaskFinished: typeof api.agentTaskFinished = api.agentTaskFinished,
  agentSessionFinished: typeof api.agentSessionFinished = api.agentSessionFinished,
): Promise<void> {
  const supplementIds = agent.contextRequest
    ? [agent.contextRequest.requestArtifactId, agent.contextRequest.supplementArtifactId]
    : [];
  const finished = await agentTaskFinished({
    taskId: agent.taskId,
    status: 'success',
    summary: agent.contextRequest
      ? `${summary}; context_request ${agent.contextRequest.request.id} supplemented by ${agent.contextRequest.supplementContextPackId}`
      : summary,
    outputArtifactIds: [...outputArtifactIds, ...supplementIds],
  });
  await agentSessionFinished({
    sessionId: agent.sessionId,
    status: 'success',
    agentResultId: finished.result.id,
    metadata: {
      outputArtifactIds: [...outputArtifactIds, ...supplementIds],
      invocationId: agent.invocationId,
      contextPackArtifactId: agent.contextPackArtifactId,
      contextRequestId: agent.contextRequest?.request.id ?? null,
      supplementContextPackId: agent.contextRequest?.supplementContextPackId ?? null,
      supplementContextPackArtifactId: agent.contextRequest?.supplementArtifactId ?? null,
    },
  });
}

export function agentTaskBriefForContext(
  title: string,
  inputs: Readonly<Record<string, string>>,
): string {
  const userRequest = inputs.user_request?.trim();
  return userRequest && userRequest.length > 0 ? userRequest : title;
}

function agentTaskBriefForRunContext(
  title: string,
  c: RunCtx,
  inputs: Readonly<Record<string, string>>,
): string {
  const userRequest = c.inputs.user_request?.trim();
  return userRequest && userRequest.length > 0
    ? userRequest
    : agentTaskBriefForContext(title, inputs);
}

function taskKindForSkill(skill: SkillSpec): AgentTaskKind {
  switch (skill.stage) {
    case 'context_pack':
      return 'context_pack';
    case 'requirement':
      return 'requirement_draft';
    case 'design':
      return 'design_draft';
    case 'implementation':
      return 'implementation';
    case 'review':
      return 'review';
    case 'report':
      return 'report';
    case 'analyze':
      return 'analyze';
    case 'scan':
      return 'scan';
    case 'plan':
      return 'plan';
    default:
      return 'noop';
  }
}

function renderAgentPromptAudit(
  skill: SkillSpec,
  inputs: Record<string, string>,
  inputArtifactIds: Record<string, string>,
  sensitivePathPatterns: readonly string[],
  contextPack?: ContextPack,
): string {
  const inputNames = Object.keys(inputs).sort();
  const lines = [
    `Skill: ${skill.id}@${skill.version}`,
    `Stage: ${skill.stage}`,
    '',
    skill.instructions,
    '',
    `Inputs: ${inputNames.join(', ') || '(none)'}`,
  ];
  if (contextPack) {
    lines.push(
      '',
      `ContextPack: ${contextPack.id}`,
      `ContextMode: ${contextPack.mode}`,
      'ContextManifest:',
      ...contextPack.manifest.map((item) => (
        `- ${item.ref}: ${item.reason} (priority=${item.priority}; mode=${item.mode}; sourceType=${item.sourceType ?? 'n/a'}; knowledgeClass=${item.knowledgeClass}; trustLevel=${item.trustLevel ?? 'n/a'}; freshness=${item.freshness ?? 'n/a'}; confidence=${item.confidence ?? 'n/a'}; score=${item.score ?? 'n/a'}; sourceRefs=${item.sourceRefs?.join(', ') || 'n/a'}${item.degradedFrom ? `; degraded=${item.degradedFrom}->${item.mode}; degradationReason=${item.degradationReason ?? 'n/a'}` : ''})`
      )),
    );
    if (contextPack.calibrationSignals && contextPack.calibrationSignals.length > 0) {
      lines.push(
        'KnowledgeReviewSignals:',
        ...contextPack.calibrationSignals.map((signal) => (
          `- ${signal.id}: ${signal.kind}/${signal.severity}; action=${signal.recommendedAction}; subjectRefs=${signal.subjectRefs.join(', ') || 'n/a'}; evidenceRefs=${signal.evidenceRefs.join(', ') || 'n/a'}; message=${signal.message}`
        )),
      );
    }
  }
  const inputAudit = inputInjectionAuditForPrompt({
    skill,
    inputs,
    inputArtifactIds,
    sensitivePathPatterns,
  });
  if (inputAudit.length > 0) {
    lines.push(
      'InputInjectionAudit:',
      ...inputAudit.map((item) => (
        `- ${item.artifactKey}: mode=${item.mode}; requested=${item.requestedMode}; required=${item.required}; sourceArtifactId=${item.sourceArtifactId ?? 'n/a'}; estimatedTokens=${item.estimatedTokens}; injectedTokens=${item.injectedTokens}${item.degradedFrom ? `; degradedFrom=${item.degradedFrom}; reason=${item.degradationReason ?? 'n/a'}` : ''}${item.warning ? `; warning=${item.warning}` : ''}`
      )),
    );
  }
  return lines.join('\n');
}

function knowledgeReviewActionForSignal(recommendedAction: string): string {
  switch (recommendedAction) {
    case 'mark_stale_or_supersede':
    case 'mark_stale_or_downgrade':
      return 'mark_stale';
    case 'open_knowledge_review':
    case 'review_before_use':
    case 'review_status_transition':
      return 'needs_review';
    default:
      return recommendedAction;
  }
}

function selectedKnowledgeUsageItems(contextPack: ContextPack): Array<{
  knowledgeArtifactId: string;
  mode?: string;
  score?: number;
  sourceRefs?: string[];
}> {
  const seen = new Set<string>();
  const items: Array<{
    knowledgeArtifactId: string;
    mode?: string;
    score?: number;
    sourceRefs?: string[];
  }> = [];
  for (const item of contextPack.manifest) {
    if (item.sourceType !== 'knowledge_artifact') continue;
    const knowledgeArtifactId = knowledgeArtifactIdFromManifestRef(item.ref);
    if (!knowledgeArtifactId || seen.has(knowledgeArtifactId)) continue;
    seen.add(knowledgeArtifactId);
    items.push({
      knowledgeArtifactId,
      mode: item.mode,
      score: item.score,
      sourceRefs: item.sourceRefs,
    });
  }
  return items;
}

function knowledgeArtifactIdFromManifestRef(ref: string): string | null {
  return ref.startsWith('knowledge_') ? ref.slice('knowledge_'.length) : null;
}
