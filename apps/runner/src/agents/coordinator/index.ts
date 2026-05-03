/**
 * Coordinator entry point: rule-first triage with LLM fallback.
 *
 * (PR2) The confidence threshold that decides "rules win vs ask the
 * LLM" now comes from the runtime config layer (key:
 * `coordinator.confidence_threshold`, default 0.65). When no override
 * is present, behaviour is unchanged.
 *
 * (PR3, PRD §P0-1) `preferredBackend` is forwarded to the LLM fallback
 * so the project's configured `agentBackend` selects which CLI runs
 * first; the other backend is automatic fallback. When omitted the
 * fallback keeps its legacy claude-first behaviour.
 *
 * Always returns a CoordinatorDecision, never throws on classification
 * failure: ambiguous inputs degrade to pause_for_human.
 */

import type { CoordinatorDecision, WorkflowRequestId } from '@ainp/shared';
import { newId, nowIso } from '@ainp/shared';
import { classifyByRules, type ClassifyInput, type ClassifyOutput } from './rules';
import { classifyByLlm, type LlmBackendKind } from './llm-fallback';
import { getConfig } from '../../config-client';

export interface TriageInput {
  workflowRequestId: WorkflowRequestId;
  userRequest: string;
  messageHistory: { role: 'user' | 'coordinator'; content: string }[];
  /**
   * Project's configured agentBackend (PR3, PRD §P0-1). When set, the LLM
   * fallback tries the matching CLI first and the other CLI as fallback.
   */
  preferredBackend?: LlmBackendKind;
}

export async function triageRequest(input: TriageInput): Promise<CoordinatorDecision> {
  const ruleInput: ClassifyInput = {
    userRequest: input.userRequest,
    messageHistory: input.messageHistory,
  };

  const ruleResult = await classifyByRules(ruleInput);
  const threshold = await getConfig('coordinator.confidence_threshold');

  let final: ClassifyOutput;
  let source: CoordinatorDecision['source'];

  if (ruleResult.confidence >= threshold) {
    final = ruleResult;
    source = 'rules';
  } else {
    const llmResult = await classifyByLlm(ruleInput, {
      preferredBackend: input.preferredBackend,
    });
    final = llmResult;
    source = 'llm';
  }

  return {
    id: newId('coord'),
    workflowRequestId: input.workflowRequestId,
    workflowRunId: null,
    source,
    decision: final.decision,
    confidence: final.confidence,
    rulesFired: final.rulesFired,
    decidedAt: nowIso(),
  };
}

export { classifyByRules } from './rules';
export { classifyByLlm } from './llm-fallback';
export type { LlmBackendKind } from './llm-fallback';
