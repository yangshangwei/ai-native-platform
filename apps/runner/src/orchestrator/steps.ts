import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type {
  ArtifactKind,
  GateRun,
  SkillSpec,
  VerifierAcMatrix,
  VerifierStatus,
} from '@ainp/shared';
import { VERIFIER_AC_MATRIX_SCHEMA_VERSION, errorMessage, nowIso } from '@ainp/shared';
import { api } from '../api-client';
import type { AgentBackend } from '../agents/types';
import { runWhitelistedCommand } from '../command-runner';
import { DEFAULT_MAX_LOG_BYTES, DEFAULT_TIMEOUT_MS, WORKTREES_DIR } from '../config';
import { findSkillForStage } from '../skills';
import { generateProjectProfile } from '../profile';
import {
  collectAcceptedKnowledge,
  persistKnowledgeCandidate,
  type KnowledgePromotionAction,
} from '../knowledge';
import { contextSelectionAudit } from '../context/builder';
import type { InvokedAgent, PromoteDraftInput, RunCtx } from './types';
import { finishAgentSuccess, invokeSkill } from './invoke-skill';
import {
  awaitApproval,
  enforceSensitiveChangeCheckpoint,
  postRejectionFeedback,
} from './approval';
import {
  acceptanceCriterionIdsFromInputs,
  persistVerifierMediaArtifacts,
  shouldRequireUiVerifier,
  verifierMediaSatisfiesCoverage,
  type PersistedVerifierMediaArtifact,
} from './verifier-media';

// ---------------------------------------------------------------------------
// T3.1 de-closure (06-12): the `executeXxx` step implementations plus the
// `runContextPack` / `runStage` helpers were inner closures of
// `cmdOrchestrate`. They are now top-level functions reading every piece of
// run-scoped state through the explicit `RunCtx` parameter; external
// collaborators are injected through `StepDeps` (extends the
// `enforceSensitiveChangeCheckpoint` deps pattern) so each step can be unit
// tested with stubs. Behavior is byte-for-byte equivalent to the closure
// version; `dispatchStep` in `../orchestrator.ts` remains the single-point
// router over these implementations.
// ---------------------------------------------------------------------------

type StepApi = Pick<
  typeof api,
  | 'stepStarted'
  | 'stepFinished'
  | 'postArtifact'
  | 'runGate'
  | 'awaitHuman'
  | 'commandRun'
  | 'mavenBuild'
  | 'stageTransition'
  | 'generateCompletionReport'
  | 'generateKnowledgeCandidate'
  | 'getWorkflowRun'
>;

export interface StepDeps {
  api: StepApi;
  mustSkill: typeof mustSkill;
  findSkillForStage: typeof findSkillForStage;
  invokeSkill: (
    c: RunCtx,
    skill: SkillSpec,
    skillCtx: Parameters<AgentBackend['run']>[1],
  ) => Promise<InvokedAgent>;
  finishAgentSuccess: (
    agent: InvokedAgent,
    outputArtifactIds: string[],
    summary: string,
  ) => Promise<void>;
  awaitApproval: typeof awaitApproval;
  postRejectionFeedback: typeof postRejectionFeedback;
  enforceSensitiveChangeCheckpoint: typeof enforceSensitiveChangeCheckpoint;
  promoteAcceptedDraftToKnowledge: (
    projectId: string,
    draft: PromoteDraftInput,
  ) => Promise<void>;
  runWhitelistedCommand: typeof runWhitelistedCommand;
  collectReports: typeof collectReports;
  persistVerifierMediaArtifacts: (
    c: RunCtx,
    stepRunId: string,
    verifierDir: string,
  ) => Promise<PersistedVerifierMediaArtifact[]>;
  generateProjectProfile: typeof generateProjectProfile;
  collectAcceptedKnowledge: typeof collectAcceptedKnowledge;
  persistKnowledgeCandidate: typeof persistKnowledgeCandidate;
}

export const DEFAULT_STEP_DEPS: StepDeps = {
  api,
  mustSkill,
  findSkillForStage,
  invokeSkill: (c, skill, skillCtx) => invokeSkill(c, skill, skillCtx),
  finishAgentSuccess: (agent, outputArtifactIds, summary) =>
    finishAgentSuccess(agent, outputArtifactIds, summary),
  awaitApproval,
  postRejectionFeedback,
  enforceSensitiveChangeCheckpoint,
  promoteAcceptedDraftToKnowledge: (projectId, draft) =>
    promoteAcceptedDraftToKnowledge(projectId, draft),
  runWhitelistedCommand,
  collectReports,
  persistVerifierMediaArtifacts,
  generateProjectProfile,
  collectAcceptedKnowledge,
  persistKnowledgeCandidate,
};

// ---- step implementations (PRD R12: extracted from V1 inline blocks) -----
// Each `executeXxx(c)` is a 1:1 lift of the matching V1 inline block.
// `kind` / `skillId` from StageStep are NOT read here in W2-1=α; W2-3
// begins consuming them through a generic dispatcher.

export async function executeImplementation(
  c: RunCtx,
  deps: StepDeps = DEFAULT_STEP_DEPS,
): Promise<void> {
  const skill = await deps.mustSkill('implementation');
  const { step } = await deps.api.stepStarted({
    workflowRunId: c.run.id,
    stage: 'implementation',
    name: skill.id,
  });
  const stepId = step.id;
  const stepArtifactsDir = join(c.runArtifactsDir, 'implementation');
  const agent = await deps.invokeSkill(c, skill, {
    workflowRunId: c.run.id,
    stepRunId: stepId,
    workspacePath: c.workspace.path,
    branch: c.workspace.branch,
    title: c.opts.title,
    artifactsDir: stepArtifactsDir,
    inputs: c.inputs,
  });
  const out = { outputs: agent.outputs };
  const diffOut = out.outputs.find((o) => o.name === 'diff');
  const namesOut = out.outputs.find((o) => o.name === 'changed-files');
  if (!diffOut || !namesOut) throw new Error('implementation: missing diff outputs');
  const diffArtifact = await deps.api.postArtifact({
    workflowRunId: c.run.id,
    stepRunId: stepId,
    kind: 'diff',
    uri: `file://${diffOut.path}`,
    size: diffOut.size,
    contentType: diffOut.contentType,
    metadata: { changedFilesPath: namesOut.path },
  });
  c.inputArtifactIds[diffOut.name] = diffArtifact.id;
  const changedFiles = (await Bun.file(namesOut.path).text())
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  c.inputs['diff'] = await Bun.file(diffOut.path).text();
  await deps.finishAgentSuccess(
    agent,
    [diffArtifact.id],
    `implementation produced ${changedFiles.length} changed file(s)`,
  );
  console.log(
    `[runner] implementation diff artifact ${diffArtifact.id} (files=${changedFiles.length})`,
  );

  const diffGate = await deps.api.runGate({
    workflowRunId: c.run.id,
    stepRunId: stepId,
    gateId: 'diff_scope_gate',
    params: { changedFiles, allowedPrefixes: ['src/'] },
  });
  console.log(`[runner]   diff_scope_gate -> ${diffGate.gate.status}`);
  const sensGate = await deps.api.runGate({
    workflowRunId: c.run.id,
    stepRunId: stepId,
    gateId: 'sensitive_change_gate',
    params: { changedFiles },
  });
  console.log(`[runner]   sensitive_change_gate -> ${sensGate.gate.status}`);
  if (diffGate.gate.status === 'fail') {
    c.ok.value = false;
    await deps.api.stepFinished({ stepRunId: stepId, status: 'failed' });
    throw new Error('diff_scope_gate failed; aborting');
  }
  await deps.enforceSensitiveChangeCheckpoint({
    workflowRunId: c.run.id,
    stepRunId: stepId,
    gate: sensGate.gate,
    deps: {
      awaitHuman: deps.api.awaitHuman,
      stepFinished: deps.api.stepFinished,
      awaitApproval: deps.awaitApproval,
      postRejectionFeedback: deps.postRejectionFeedback,
    },
  });
  await deps.api.stepFinished({ stepRunId: stepId, status: 'passed' });
}

export async function executeBuildTest(
  c: RunCtx,
  deps: StepDeps = DEFAULT_STEP_DEPS,
): Promise<void> {
  const mvn = existsSync(join(c.workspace.path, 'mvnw')) ? './mvnw' : 'mvn';
  const compileCommand = `${mvn} -B -DskipTests compile`;
  const testCommand = `${mvn} -B test`;
  const { step } = await deps.api.stepStarted({
    workflowRunId: c.run.id,
    stage: 'build_test',
    name: testCommand,
  });
  const stepId = step.id;
  const logDir = join(WORKTREES_DIR, c.project.id, c.run.id, 'logs');
  const compileCr = await deps.runWhitelistedCommand({
    workflowRunId: c.run.id,
    stepRunId: stepId,
    cwd: c.workspace.path,
    command: compileCommand,
    stage: 'compile',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxLogBytes: DEFAULT_MAX_LOG_BYTES,
    logDir,
  });
  await deps.api.commandRun(compileCr);
  console.log(`[runner] compile command ${compileCr.status} (exit=${compileCr.exitCode})`);
  if (compileCr.status !== 'passed') {
    c.ok.value = false;
    await deps.api.stepFinished({ stepRunId: stepId, status: 'failed' });
    throw new Error('compile command failed');
  }

  const cr = await deps.runWhitelistedCommand({
    workflowRunId: c.run.id,
    stepRunId: stepId,
    cwd: c.workspace.path,
    command: testCommand,
    stage: 'test',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxLogBytes: DEFAULT_MAX_LOG_BYTES,
    logDir,
  });
  await deps.api.commandRun(cr);
  console.log(`[runner] build_test command ${cr.status} (exit=${cr.exitCode})`);

  const reports = await deps.collectReports(
    c.workspace.path,
    join(c.runArtifactsDir, 'build_test', 'maven-reports'),
  );
  const result = await deps.api.mavenBuild({
    workflowRunId: c.run.id,
    stepRunId: stepId,
    jdkVersion: c.tools.jdk,
    mavenCommand: `${compileCommand} && ${testCommand}`,
    compileCommandRunId: compileCr.id,
    testCommandRunId: cr.id,
    reports,
  });
  console.log(
    `[runner]   build=${result.buildRun.status} compile_gate=${result.compileGate?.status ?? 'n/a'} test_gate=${result.testGate?.status ?? 'n/a'}`,
  );
  const testOk = result.compileGate?.status === 'pass' && result.testGate?.status === 'pass';
  await deps.api.stepFinished({ stepRunId: stepId, status: testOk ? 'passed' : 'failed' });
  if (!testOk) {
    c.ok.value = false;
    throw new Error('test_gate failed');
  }
}

export async function executeVerifier(
  c: RunCtx,
  deps: StepDeps = DEFAULT_STEP_DEPS,
): Promise<void> {
  if (!shouldRequireUiVerifier(c.run.title)) return;

  const { step } = await deps.api.stepStarted({
    workflowRunId: c.run.id,
    stage: 'review',
    name: 'verifier',
  });
  const stepId = step.id;
  const verifierDir = join(c.runArtifactsDir, 'verifier');
  await mkdir(verifierDir, { recursive: true });

  const mediaArtifacts = await deps.persistVerifierMediaArtifacts(c, stepId, verifierDir);
  const criterionIds = acceptanceCriterionIdsFromInputs(c.inputs);
  const criterionStatus: VerifierStatus = verifierMediaSatisfiesCoverage(mediaArtifacts)
    ? 'pass'
    : 'blocked';
  const matrix: VerifierAcMatrix = {
    schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
    workflowRunId: c.run.id,
    stepRunId: stepId,
    verifierRequired: true,
    verifierStatus: criterionStatus,
    acceptanceCriteria: criterionIds.map((id) => ({
      id,
      status: criterionStatus,
      evidenceRefs: mediaArtifacts.map(({ artifact, role }) => ({
        artifactId: artifact.id,
        role,
        claim: `${role} verifier media for ${id}`,
      })),
      notes: criterionStatus === 'pass'
        ? 'UI verifier media evidence present.'
        : 'Missing before+after screenshots or video evidence under .ainp-verifier/.',
    })),
    createdAt: nowIso(),
  };
  const matrixBody = `${JSON.stringify(matrix, null, 2)}\n`;
  const matrixPath = join(verifierDir, 'verifier-ac-matrix.json');
  await writeFile(matrixPath, matrixBody, 'utf8');
  const matrixArtifact = await deps.api.postArtifact({
    workflowRunId: c.run.id,
    stepRunId: stepId,
    kind: 'other',
    uri: `file://${matrixPath}`,
    size: Buffer.byteLength(matrixBody, 'utf8'),
    contentType: 'application/json',
    metadata: {
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      reportKind: 'verifier_ac_matrix',
      verifierArtifactType: 'ac_matrix',
      verifierRequired: true,
      verifierStatus: criterionStatus,
      stage: 'review',
      subStage: 'verifier',
      output: 'verifier-ac-matrix.json',
    },
  });
  c.inputs['verifier-ac-matrix.json'] = matrixBody;
  c.inputArtifactIds['verifier-ac-matrix.json'] = matrixArtifact.id;
  console.log(
    `[runner] verifier matrix ${matrixArtifact.id} (${criterionStatus}; media=${mediaArtifacts.length})`,
  );
  await deps.api.stepFinished({ stepRunId: stepId, status: 'passed' });
}

export async function executeAcceptance(
  c: RunCtx,
  deps: StepDeps = DEFAULT_STEP_DEPS,
): Promise<void> {
  const acceptanceTraceGate = await deps.api.runGate({
    workflowRunId: c.run.id,
    stepRunId: null,
    gateId: 'acceptance_gate',
  });
  console.log(`[runner]   acceptance_traceability_gate -> ${acceptanceTraceGate.gate.status}`);
  if (acceptanceTraceGate.gate.status === 'fail') {
    c.ok.value = false;
    throw new Error('acceptance traceability failed');
  }
  const preAcceptanceEvidenceGate = await deps.api.runGate({
    workflowRunId: c.run.id,
    stepRunId: null,
    gateId: 'evidence_gate',
  });
  console.log(`[runner]   evidence_gate before acceptance -> ${preAcceptanceEvidenceGate.gate.status}`);
  if (preAcceptanceEvidenceGate.gate.status === 'fail') {
    c.ok.value = false;
    throw new Error('evidence_gate failed before acceptance');
  }
  await deps.api.awaitHuman({ workflowRunId: c.run.id, stage: 'review' });
  console.log(`[runner] awaiting acceptance_gate approval…`);
  const { approved: accepted, comment: acceptanceComment } = await deps.awaitApproval(
    c.run.id,
    'acceptance_gate',
  );
  const acceptanceRejectSummary = !accepted && acceptanceComment
    ? `: ${acceptanceComment.slice(0, 200)}${acceptanceComment.length > 200 ? '…' : ''}`
    : '';
  console.log(
    `[runner]   acceptance_gate -> ${accepted ? 'approved' : 'rejected'}${acceptanceRejectSummary}`,
  );
  if (!accepted) {
    if (acceptanceComment) {
      await deps.postRejectionFeedback({
        workflowRunId: c.run.id,
        stepRunId: null,
        gateId: 'acceptance_gate',
        comment: acceptanceComment,
      });
    }
    c.ok.value = false;
    throw new Error('acceptance_gate rejected');
  }

  // V2 P0-1 / PR3: promote accepted requirement / design drafts to knowledge
  // entities. Failure inside the helper is logged but never thrown — R18.
  for (const draft of c.draftsToPromote) {
    await deps.promoteAcceptedDraftToKnowledge(c.project.id, draft);
  }
}

// V2 W2-2a/W2-2b: report / analyze (issue.standard) and scan / plan
// (refactor.standard) are all "agent → markdown artifact" stages; outputs
// land as kind='other' (PRD ADR Q5: no KnowledgeArtifactKind extension).

export async function executeAgentMarkdownStage(
  stage: 'report' | 'analyze' | 'scan' | 'plan',
  c: RunCtx,
  deps: StepDeps = DEFAULT_STEP_DEPS,
): Promise<void> {
  const skill = await deps.mustSkill(stage);
  const { step } = await deps.api.stepStarted({
    workflowRunId: c.run.id,
    stage,
    name: skill.id,
  });
  const stepId = step.id;
  const stepArtifactsDir = join(c.runArtifactsDir, stage);
  const agent = await deps.invokeSkill(c, skill, {
    workflowRunId: c.run.id,
    stepRunId: stepId,
    workspacePath: c.workspace.path,
    branch: c.workspace.branch,
    title: c.opts.title,
    artifactsDir: stepArtifactsDir,
    inputs: c.inputs,
  });
  const artifactIds: string[] = [];
  for (const out of agent.outputs) {
    const a = await deps.api.postArtifact({
      workflowRunId: c.run.id,
      stepRunId: stepId,
      kind: 'other',
      uri: `file://${out.path}`,
      size: out.size,
      contentType: out.contentType,
      metadata: { skill: skill.id, output: out.name, stage },
    });
    c.inputs[out.name] = await Bun.file(out.path).text();
    c.inputArtifactIds[out.name] = a.id;
    artifactIds.push(a.id);
    console.log(`[runner] ${stage} artifact ${a.id} (${out.name})`);
  }
  await deps.finishAgentSuccess(
    agent,
    artifactIds,
    `${stage} produced ${artifactIds.length} artifact(s)`,
  );
  await deps.api.stepFinished({ stepRunId: stepId, status: 'passed' });
}

export async function executeCompletion(
  c: RunCtx,
  deps: StepDeps = DEFAULT_STEP_DEPS,
): Promise<void> {
  await deps.api.stageTransition({ workflowRunId: c.run.id, stage: 'completion' });
  const evidenceGate = await deps.api.runGate({
    workflowRunId: c.run.id,
    stepRunId: null,
    gateId: 'evidence_gate',
  });
  console.log(`[runner]   evidence_gate -> ${evidenceGate.gate.status}`);
  if (evidenceGate.gate.status === 'fail') {
    c.ok.value = false;
    throw new Error('evidence_gate failed');
  }
  const reportJson = await deps.api.generateCompletionReport(c.run.id);
  console.log(`[runner] completion_report -> ${reportJson.artifact.uri}`);
}

export async function executeKnowledgePromotion(
  c: RunCtx,
  deps: StepDeps = DEFAULT_STEP_DEPS,
): Promise<void> {
  await deps.api.stageTransition({ workflowRunId: c.run.id, stage: 'knowledge' });
  const knowJson = await deps.api.generateKnowledgeCandidate(c.run.id);
  console.log(`[runner] knowledge_candidate -> ${knowJson.artifact.uri}`);

  await deps.api.awaitHuman({ workflowRunId: c.run.id, stage: 'knowledge' });
  console.log(`[runner] awaiting knowledge_gate approval…`);
  const { approved: promoted } = await deps.awaitApproval(c.run.id, 'knowledge_gate');
  console.log(`[runner]   knowledge_gate -> ${promoted ? 'approved' : 'rejected'}`);
  if (!promoted) {
    // V1 quirk: knowledge gate rejection sets ok but does NOT throw —
    // the run cleanly proceeds through `finally` and reports failure.
    c.ok.value = false;
  } else {
    const detail = await deps.api.getWorkflowRun(c.run.id);
    const actions: KnowledgePromotionAction[] = detail.actions
      .filter((action) => action.kind === 'knowledge_suggestion_action')
      .map((action) => ({
        targetId: action.targetId,
        action: action.action,
        payload: action.payload,
      }));
    const stored = await deps.persistKnowledgeCandidate({
      projectId: c.project.id,
      runId: c.run.id,
      candidateUri: knowJson.artifact.uri,
      actions,
    });
    if (stored) {
      console.log(`[runner] knowledge persisted -> ${stored}`);
    }
  }
}

// ---- stage helpers (PRD ADR Q1=α: logic kept unchanged) -------------------

export async function runContextPack(
  c: RunCtx,
  deps: StepDeps = DEFAULT_STEP_DEPS,
): Promise<void> {
  // a. project profile (lazy: scan once and reuse on subsequent runs).
  const profileResult = await deps.generateProjectProfile({
    projectId: c.project.id,
    name: c.project.name,
    localPath: c.project.localPath,
    reuseIfPresent: true,
  });
  c.contextFoundation.projectProfileResult = profileResult;

  const { step } = await deps.api.stepStarted({
    workflowRunId: c.run.id,
    stage: 'context_pack',
    name: 'context_pack',
  });
  const stepId = step.id;
  const stageArtifactsDir = join(c.runArtifactsDir, 'context_pack');
  await mkdir(stageArtifactsDir, { recursive: true });

  const profileArtifact = await deps.api.postArtifact({
    workflowRunId: c.run.id,
    stepRunId: stepId,
    kind: 'project_profile',
    uri: `file://${profileResult.profileMdPath}`,
    size: Buffer.byteLength(profileResult.markdown, 'utf8'),
    contentType: 'text/markdown',
    metadata: {
      projectId: c.project.id,
      projectName: c.project.name,
      generatedAt: profileResult.profile.generatedAt,
    },
  });
  c.inputs['project_profile.md'] = profileResult.markdown;
  c.inputArtifactIds['project_profile.md'] = profileArtifact.id;
  console.log(`[runner] project_profile artifact ${profileArtifact.id}`);

  // b. accepted knowledge from prior runs (knowledge → context loop).
  const acceptedKnowledge = await deps.collectAcceptedKnowledge(c.project.id);
  c.contextFoundation.acceptedKnowledge = acceptedKnowledge;
  c.inputs['accepted_knowledge.md'] = acceptedKnowledge;
  if (acceptedKnowledge) {
    console.log(`[runner] accepted_knowledge: ${acceptedKnowledge.length} bytes`);
  }

  // c. run the Context Pack skill.
  const skill = await deps.findSkillForStage('context_pack');
  if (!skill) throw new Error('no skill for stage context_pack');
  const agent = await deps.invokeSkill(c, skill, {
    workflowRunId: c.run.id,
    stepRunId: stepId,
    workspacePath: c.workspace.path,
    branch: c.workspace.branch,
    title: c.opts.title,
    artifactsDir: stageArtifactsDir,
    inputs: c.inputs,
  });
  const artifactIds: string[] = [];
  for (const out of agent.outputs) {
    const a = await deps.api.postArtifact({
      workflowRunId: c.run.id,
      stepRunId: stepId,
      kind: 'context_pack',
      uri: `file://${out.path}`,
      size: out.size,
      contentType: out.contentType,
      metadata: {
        skill: skill.id,
        output: out.name,
        stage: 'context_pack',
        contextSelection: contextSelectionAudit(agent.contextPack),
      },
    });
    c.inputs[out.name] = await Bun.file(out.path).text();
    c.inputArtifactIds[out.name] = a.id;
    artifactIds.push(a.id);
    console.log(`[runner] context_pack artifact ${a.id} (${out.name})`);
  }
  await deps.finishAgentSuccess(
    agent,
    artifactIds,
    `context_pack produced ${artifactIds.length} artifact(s)`,
  );
  await deps.api.stepFinished({ stepRunId: stepId, status: 'passed' });
}

export async function runStage(
  c: RunCtx,
  stage: 'requirement' | 'design' | 'review',
  artifactKind: 'requirement_draft' | 'design_doc' | 'other',
  rulebasedGateId: GateRun['gateId'] | null,
  deps: StepDeps = DEFAULT_STEP_DEPS,
): Promise<void> {
  const skill = await deps.mustSkill(stage);
  const { step } = await deps.api.stepStarted({
    workflowRunId: c.run.id,
    stage,
    name: skill.id,
  });
  const stepArtifactsDir = join(c.runArtifactsDir, stage);
  const agent = await deps.invokeSkill(c, skill, {
    workflowRunId: c.run.id,
    stepRunId: step.id,
    workspacePath: c.workspace.path,
    branch: c.workspace.branch,
    title: c.opts.title,
    artifactsDir: stepArtifactsDir,
    inputs: c.inputs,
  });
  const artifactIds: string[] = [];
  for (const out of agent.outputs) {
    const text = await Bun.file(out.path).text();
    const kind = artifactKindForStageOutput(stage, artifactKind, out.name);
    const metadata = metadataForStageOutput(skill.id, stage, out.name, out.contentType, text);
    const a = await deps.api.postArtifact({
      workflowRunId: c.run.id,
      stepRunId: step.id,
      kind,
      uri: `file://${out.path}`,
      size: out.size,
      contentType: out.contentType,
      metadata,
    });
    c.inputs[out.name] = text;
    c.inputArtifactIds[out.name] = a.id;
    // V2 P0-1 / PR3: track requirement / design drafts for post-acceptance promotion.
    if (kind === 'requirement_draft' || kind === 'design_doc') {
      c.draftsToPromote.push({
        artifactId: a.id,
        kind,
        uri: `file://${out.path}`,
        size: out.size,
        contentType: out.contentType,
        text,
      });
    }
    artifactIds.push(a.id);
    console.log(`[runner] ${stage} artifact ${a.kind} -> ${a.uri}`);
  }
  await deps.finishAgentSuccess(
    agent,
    artifactIds,
    `${stage} produced ${artifactIds.length} artifact(s)`,
  );
  await deps.api.stepFinished({ stepRunId: step.id, status: 'passed' });

  if (rulebasedGateId) {
    const gateRes = await deps.api.runGate({
      workflowRunId: c.run.id,
      stepRunId: step.id,
      gateId: rulebasedGateId,
    });
    console.log(`[runner]   ${rulebasedGateId} -> ${gateRes.gate.status}`);
    if (gateRes.gate.status === 'fail') {
      c.ok.value = false;
      throw new Error(`${rulebasedGateId} failed`);
    }
    // Pause for human approval after the rule-based gate passes. Only
    // requirement / design reach this block — review passes a null
    // rulebasedGateId (acceptance approval lives in executeAcceptance).
    await deps.api.awaitHuman({ workflowRunId: c.run.id, stage });
    console.log(`[runner] awaiting ${stage} approval…`);
    const approverGateId = stage === 'requirement' ? 'requirement_gate' : 'design_gate';
    const { approved, comment: approvalComment } = await deps.awaitApproval(
      c.run.id,
      approverGateId,
    );
    const approverRejectSummary = !approved && approvalComment
      ? `: ${approvalComment.slice(0, 200)}${approvalComment.length > 200 ? '…' : ''}`
      : '';
    console.log(
      `[runner]   ${approverGateId} -> ${approved ? 'approved' : 'rejected'}${approverRejectSummary}`,
    );
    if (!approved) {
      if (approvalComment) {
        await deps.postRejectionFeedback({
          workflowRunId: c.run.id,
          stepRunId: null,
          gateId: approverGateId,
          comment: approvalComment,
        });
      }
      c.ok.value = false;
      throw new Error(`${approverGateId} rejected`);
    }
  }
}

// ---- shared step utilities -------------------------------------------------

export async function mustSkill(
  stage: 'requirement' | 'design' | 'implementation' | 'review' | 'report' | 'analyze' | 'scan' | 'plan',
) {
  const s = await findSkillForStage(stage);
  if (!s) throw new Error(`no skill for stage ${stage}`);
  return s;
}

function artifactKindForStageOutput(
  stage: 'requirement' | 'design' | 'review',
  fallback: ArtifactKind,
  outputName: string,
): ArtifactKind {
  if (outputName === 'traceability.json') return 'traceability';
  if (stage === 'requirement') return 'requirement_draft';
  if (stage === 'design') return 'design_doc';
  return fallback;
}

function metadataForStageOutput(
  skillId: string,
  stage: 'requirement' | 'design' | 'review',
  outputName: string,
  contentType: string,
  text: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { skill: skillId, output: outputName, stage };
  const isJson = contentType === 'application/json' || outputName.endsWith('.json');
  if (!isJson) return metadata;

  metadata.structured = true;
  const schemaVersion = safeJsonSchemaVersion(text);
  if (schemaVersion) metadata.schemaVersion = schemaVersion;
  return metadata;
}

function safeJsonSchemaVersion(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { schemaVersion?: unknown };
    return typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : null;
  } catch {
    return null;
  }
}

export async function collectReports(
  workspacePath: string,
  outputDir: string,
): Promise<Parameters<typeof api.mavenBuild>[0]['reports']> {
  const { collectMavenReports, persistMavenReports } = await import('../reports');
  const reports = await persistMavenReports(await collectMavenReports(workspacePath), outputDir);
  const out: Parameters<typeof api.mavenBuild>[0]['reports'] = [];
  if (reports.surefire) {
    out.push({
      framework: 'maven-surefire',
      reportFiles: reports.surefire.reportPaths.map((p) => `file://${p}`),
      aggregate: {
        total: reports.surefire.total,
        passed: reports.surefire.passed,
        failed: reports.surefire.failed,
        skipped: reports.surefire.skipped,
        errors: reports.surefire.errors,
      },
    });
  }
  if (reports.failsafe) {
    out.push({
      framework: 'maven-failsafe',
      reportFiles: reports.failsafe.reportPaths.map((p) => `file://${p}`),
      aggregate: {
        total: reports.failsafe.total,
        passed: reports.failsafe.passed,
        failed: reports.failsafe.failed,
        skipped: reports.failsafe.skipped,
        errors: reports.failsafe.errors,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// V2 P0-2 / PR5: promoteAcceptedDraftToKnowledge (thin HTTP wrapper)
//
// After acceptance_gate passes, lift each requirement_draft / design_doc into
// a knowledge entity (REQ-### / DSN-###). The entire algorithm (entity_id
// resolution, version bump, supersede prior accepted, INSERT
// knowledge_artifacts, UPSERT entity head) lives server-side in a single
// `db.transaction(...)` per Q5=5-A — see `apps/api/src/promote.ts`.
//
// This wrapper just maps `PromoteDraftInput` → `PromoteRequest`, calls
// `api.promoteDraft`, and downgrades failures to a log line so the
// acceptance gate is never broken (R12 / R28).
// ---------------------------------------------------------------------------

export interface PromoteDeps {
  promoteDraft: typeof api.promoteDraft;
  log?: (msg: string) => void;
  errorLog?: (msg: string) => void;
}

export async function promoteAcceptedDraftToKnowledge(
  projectId: string,
  draft: PromoteDraftInput,
  deps: PromoteDeps = { promoteDraft: api.promoteDraft },
): Promise<void> {
  const log = deps.log ?? ((m) => console.log(m));
  const errorLog = deps.errorLog ?? ((m) => console.error(m));
  try {
    const result = await deps.promoteDraft({
      projectId,
      kind: draft.kind,
      draftArtifactId: draft.artifactId,
      draftText: draft.text,
      uri: draft.uri,
      size: draft.size,
      contentType: draft.contentType,
    });
    log(
      `[runner] promoted ${draft.kind} ${draft.artifactId} -> ${result.entityKind} ${result.entityId} v${result.version} (id=${result.knowledgeArtifactId})`,
    );
  } catch (err) {
    // R12 / R28: failure MUST be downgraded — never break acceptance gate.
    errorLog(
      `[runner] promoteAcceptedDraftToKnowledge failed for ${draft.kind} ${draft.artifactId}: ${
        errorMessage(err)
      }`,
    );
  }
}
