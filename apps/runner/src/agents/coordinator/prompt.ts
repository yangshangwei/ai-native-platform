/**
 * Coordinator user-prompt builder.
 *
 * (PR2) `COORDINATOR_SYSTEM_PROMPT` used to live here as a hardcoded
 * const. It now lives in the runtime config layer at key
 * `coordinator.system_prompt` (default value byte-for-byte transcribed
 * in `packages/shared/src/config/defaults.ts`) and is read by
 * `classifyByLlm` at call time.
 *
 * The output contract is still strict JSON (encoded inside the system
 * prompt itself) so the parser drops directly into a CoordinatorAction.
 */

export function buildUserPrompt(
  userRequest: string,
  history: { role: string; content: string }[],
): string {
  const lines: string[] = [`User request: ${userRequest}`, ''];
  if (history.length > 0) {
    lines.push('Conversation so far (most recent last):');
    for (const m of history) {
      lines.push(`  [${m.role}] ${m.content}`);
    }
    lines.push('');
  }
  lines.push('Triage now. Output JSON only.');
  return lines.join('\n');
}
