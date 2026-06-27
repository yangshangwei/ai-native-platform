import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AgentTaskKind, ContextPack, SkillSpec } from '@ainp/shared';
import { errorMessage } from '@ainp/shared';
import { api } from '../api-client';
import type { AgentBackend } from '../agents/types';
import { generateProjectProfile } from '../profile';
import { acceptedKnowledgeMarkdownForContext, collectAcceptedKnowledge } from '../knowledge';
import {
  buildContextPack,
  buildIncrementalContextPack,
  contextSelectionAudit,
  sanitizeContextRequestForContextInjection,
} from '../context/builder';
import {
  CONTEXT_REQUEST_SCHEMA_VERSION,
  parseContextRequestFromAgentOutput,
  type ParsedContextRequest,
} from '../context/request';
import type { ContextRequestCapture, InvokedAgent, RunCtx } from './types';

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
  recordContextRequest: typeof api.recordContextRequest;
  recordKnowledgeUsage: typeof api.recordKnowledgeUsage;
  recordKnowledgeAction: typeof api.recordKnowledgeAction;
}

export const DEFAULT_INVOKE_SKILL_DEPS: InvokeSkillDeps = {
  agentTaskStarted: api.agentTaskStarted,
  agentTaskFinished: api.agentTaskFinished,
  agentSessionStarted: api.agentSessionStarted,
  agentSessionFinished: api.agentSessionFinished,
  postArtifact: api.postArtifact,
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
  const taskBrief = agentTaskBriefForContext(skillCtx.title, skillCtx.inputs);
  const contextPack = buildContextPack({
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
    inputNames: Object.keys(skillCtx.inputs),
    inputArtifacts: Object.entries(skillCtx.inputs).map(([name, content]) => ({
      name,
      content,
      artifactId: c.inputArtifactIds[name] ?? null,
    })),
    budget: c.contextPolicy.budget,
    sensitivePathPatterns: c.contextPolicy.sensitivePathPatterns,
  });
  const enrichedCtx = {
    ...skillCtx,
    contextPack,
    sensitivePathPatterns: c.contextPolicy.sensitivePathPatterns,
  };
  const task = await deps.agentTaskStarted({
    workflowRunId: skillCtx.workflowRunId,
    stepRunId: skillCtx.stepRunId ?? null,
    kind: taskKindForSkill(skill),
    backend: c.backend.kind,
    prompt: renderAgentPromptAudit(skill, enrichedCtx.inputs, contextPack),
    inputArtifactIds: skill.inputs
      .map((i) => c.inputArtifactIds[i.name])
      .filter((id): id is string => Boolean(id)),
  });
  const session = await deps.agentSessionStarted({
    workflowRunId: skillCtx.workflowRunId,
    agentTaskId: task.task.id,
    stage: skill.stage,
    skillId: skill.id,
    skillVersion: skill.version,
    contextPackId: contextPack.id,
    retryIndex: 0,
    metadata: {
      contextMode: contextPack.mode,
      manifestCount: contextPack.manifest.length,
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
      foundation,
      baseContextPack: contextPack,
      taskId: task.task.id,
    }, deps);
    return {
      taskId: task.task.id,
      sessionId: session.session.id,
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
      metadata: { error: errorMessage(err) },
    });
    throw err;
  }
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

export async function captureContextRequest(
  c: RunCtx,
  input: {
    skill: SkillSpec;
    skillCtx: Parameters<AgentBackend['run']>[1];
    result: Awaited<ReturnType<AgentBackend['run']>>;
    foundation: RunCtx['contextFoundation'];
    baseContextPack: ContextPack;
    taskId: string;
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

  const supplementPack = buildIncrementalContextPack({
    project: c.project,
    run: c.run,
    stage: input.skill.stage,
    stepRunId: input.skillCtx.stepRunId ?? null,
    workspacePath: input.skillCtx.workspacePath,
    branch: input.skillCtx.branch,
    taskBrief: agentTaskBriefForContext(input.skillCtx.title, input.skillCtx.inputs),
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
    inputNames: Object.keys(input.skillCtx.inputs),
    inputArtifacts: Object.entries(input.skillCtx.inputs).map(([name, content]) => ({
      name,
      content,
      artifactId: c.inputArtifactIds[name] ?? null,
    })),
    budget: c.contextPolicy.budget,
    sensitivePathPatterns: c.contextPolicy.sensitivePathPatterns,
    contextRequest: request,
    baseContextPack: input.baseContextPack,
  });

  const requestInputName = `context_request.${request.id}.json`;
  const supplementInputName = `context_supplement.${request.id}.json`;
  const requestBody = `${JSON.stringify({
    schemaVersion: CONTEXT_REQUEST_SCHEMA_VERSION,
    sourceName: parsed.sourceName,
    taskId: input.taskId,
    baseContextPackId: input.baseContextPack.id,
    request,
  }, null, 2)}\n`;
  const supplementBody = `${JSON.stringify({
    schemaVersion: 'ainp.context_supplement.v1',
    contextRequestId: request.id,
    baseContextPackId: input.baseContextPack.id,
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
    baseContextPackId: input.baseContextPack.id,
  };
  c.contextRequestChain.push(capture);
  await deps.recordContextRequest({
    workflowRunId: input.skillCtx.workflowRunId,
    request,
    sourceName: parsed.sourceName,
    taskId: input.taskId,
    baseContextPackId: input.baseContextPack.id,
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
      contextRequestId: agent.contextRequest?.request.id ?? null,
      supplementContextPackId: agent.contextRequest?.supplementContextPackId ?? null,
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
