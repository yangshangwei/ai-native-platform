/**
 * Acceptance-criterion text heuristics shared by the write side (the runner,
 * which decides `AcceptanceBusinessStatus`) and the read side (the api Gate
 * Engine, which re-checks it).
 *
 * 08-09 P1-1 R2: this judgement previously existed as two byte-identical
 * copies — `commandOnlyVerifierText` in
 * `apps/runner/src/orchestrator/steps.ts` and `isCommandOnlyText` in
 * `apps/api/src/gate-engine.ts`. A change to either side would have made the
 * writer and the reader disagree about what counts as "just a command".
 * Same discipline as `deriveGraphRunStatus` and `parseReviewerVerdict`:
 * one judgement, one implementation, every caller goes through it.
 *
 * The behavior here is a verbatim lift of both copies. Tuning the heuristic
 * (notably the `< 8` residue threshold) is deliberately a separate change —
 * see the P1-1 PRD "Out of Scope".
 */

/**
 * True when the text carries no verification meaning beyond naming a build or
 * test command. Strips tool invocations, generic pass/fail vocabulary (both
 * English and Chinese), and `AC-###` / `REQ-###` identifiers; whatever letters
 * and digits survive are the actual business content.
 *
 * `"mvn -B test"` → true. `"打开登录页输入账号密码后跳转到首页"` → false.
 */
export function isCommandOnlyText(text: string): boolean {
  const normalized = text
    .replace(/`[^`]*(?:mvn|mvnw|bun|npm|pnpm|yarn|pytest|gradle|go test)[^`]*`/gi, ' ')
    .replace(/\b(?:\.\/)?mvnw?\b[\w\s./:=+-]*/gi, ' ')
    .replace(/\b(?:bun|npm|pnpm|yarn|pytest|gradle|go)\b[\w\s./:=+-]*/gi, ' ')
    .replace(/\b(?:test|tests|compile|build|typecheck|lint|verify|verified|verifies|passed?|passing|green|exit|command|standard|is|by)\b/gi, ' ')
    .replace(/验收|标准|命令|测试|编译|通过|全部|用例|运行|项目|标准|成功|失败|错误|无/g, ' ')
    .replace(/\b(?:AC|REQ)-\d{3}\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return normalized.length < 8;
}
