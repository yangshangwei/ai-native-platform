/**
 * Coordinator entry point: rule-first triage with LLM fallback.
 *
 * Tries the keyword classifier first. If its confidence is at or above
 * the threshold (0.65), use it directly — saving an LLM round-trip on
 * the easy cases (clear bug, clear feature, very short input, large
 * scope keyword). Otherwise call the LLM fallback to classify.
 *
 * Always returns a CoordinatorDecision, never throws on classification
 * failure: ambiguous inputs degrade to pause_for_human.
 */

import type { CoordinatorDecision, WorkflowRequestId } from '@ainp/shared';
import { newId, nowIso } from '@ainp/shared';
import { classifyByRules, type ClassifyInput, type ClassifyOutput } from './rules';
import { classifyByLlm } from './llm-fallback';

const RULE_CONFIDENCE_THRESHOLD = 0.65;

export interface TriageInput {
  workflowRequestId: WorkflowRequestId;
  userRequest: string;
  messageHistory: { role: 'user' | 'coordinator'; content: string }[];
}

export async function triageRequest(input: TriageInput): Promise<CoordinatorDecision> {
  const ruleInput: ClassifyInput = {
    userRequest: input.userRequest,
    messageHistory: input.messageHistory,
  };

  const ruleResult = classifyByRules(ruleInput);
  let final: ClassifyOutput;
  let source: CoordinatorDecision['source'];

  if (ruleResult.confidence >= RULE_CONFIDENCE_THRESHOLD) {
    final = ruleResult;
    source = 'rules';
  } else {
    const llmResult = await classifyByLlm(ruleInput);
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
