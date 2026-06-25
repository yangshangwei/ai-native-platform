import type { ClassifyOutput } from './rules';

export interface CoordinatorMessage {
  role: 'user' | 'coordinator';
  content: string;
}

const MAX_ROUNDS_RULE = 'coordinator.max_clarification_rounds_reached';

export function countCoordinatorMessages(messageHistory: readonly CoordinatorMessage[]): number {
  return messageHistory.filter((message) => message.role === 'coordinator').length;
}

export function hasReachedMaxClarificationRounds(
  messageHistory: readonly CoordinatorMessage[],
  maxClarificationRounds: number,
): boolean {
  return countCoordinatorMessages(messageHistory) >= maxClarificationRounds;
}

export function enforceMaxClarificationRounds(
  output: ClassifyOutput,
  maxClarificationRounds: number,
  coordinatorMessageCount: number,
): ClassifyOutput {
  if (
    coordinatorMessageCount < maxClarificationRounds ||
    output.decision.action !== 'pause_for_human'
  ) {
    return output;
  }

  return {
    ...output,
    decision: {
      action: 'abort',
      reason: `maximum clarification rounds reached (${maxClarificationRounds}); refusing to ask another clarification question`,
    },
    confidence: Math.max(output.confidence, 0.7),
    rulesFired: output.rulesFired.includes(MAX_ROUNDS_RULE)
      ? output.rulesFired
      : [...output.rulesFired, MAX_ROUNDS_RULE],
  };
}
