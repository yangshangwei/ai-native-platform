/**
 * Byte-for-byte default values for all runtime-configurable keys.
 *
 * Sources cited inline by file:line. These constants are duplicated here from
 * the runner because shared cannot import from apps/runner. When source files
 * change, this file must be updated in lockstep — the registry tests verify
 * the count of declared defaults.
 */

// ---- Coordinator: keyword dictionaries (apps/runner/src/agents/coordinator/rules.ts) ----

/** apps/runner/src/agents/coordinator/rules.ts:32 */
export const COORDINATOR_BUG_KEYWORDS_DEFAULT: readonly string[] = [
  'bug',
  '错误',
  '异常',
  '报错',
  '崩溃',
  '失败',
  'crash',
  'error',
  '弹出空白',
  '无法',
  '不能',
  '不工作',
  '不对',
  '应该',
  '预期',
  '实际',
];

/** apps/runner/src/agents/coordinator/rules.ts:51 */
export const COORDINATOR_FEATURE_KEYWORDS_DEFAULT: readonly string[] = [
  '增加',
  '新增',
  '加一个',
  '加个',
  '添加',
  '实现',
  '做一个',
  '支持',
  'add',
  'implement',
  'support',
  '希望',
  '验收标准',
  'acceptance',
];

/** apps/runner/src/agents/coordinator/rules.ts:69 */
export const COORDINATOR_LARGE_SCOPE_KEYWORDS_DEFAULT: readonly string[] = [
  '完整的',
  '一整套',
  '一套',
  '整个',
  'sso',
  '权限系统',
  '通知系统',
  '用户系统',
  '认证体系',
  '审计体系',
];

/** apps/runner/src/agents/coordinator/rules.ts:83 — regex literal source for "X系统 / Y体系" pattern */
export const COORDINATOR_LARGE_SCOPE_REGEX_DEFAULT = '(\\S+?\\s*系统|\\S+?\\s*体系)';

/** apps/runner/src/agents/coordinator/rules.ts (refactor branch added 2026-05-06) — refactor-leaning verbs in zh + en */
export const COORDINATOR_REFACTOR_KEYWORDS_DEFAULT: readonly string[] = [
  '重构',
  'refactor',
  '优化',
  '拆分',
  '抽离',
  '重写',
  '简化',
  '清理',
  'cleanup',
  'restructure',
  'extract',
  'simplify',
];

// ---- Coordinator: thresholds (apps/runner/src/agents/coordinator/index.ts) ----

/** apps/runner/src/agents/coordinator/index.ts:18 */
export const COORDINATOR_CONFIDENCE_THRESHOLD_DEFAULT = 0.65;

// ---- Coordinator: system prompt (apps/runner/src/agents/coordinator/prompt.ts:9-36) ----

export const COORDINATOR_SYSTEM_PROMPT_DEFAULT = `You are the Coordinator Agent for an AI-native software delivery platform.

Your ONLY job: triage the user's incoming request into ONE of these route cases.

1. feature_clear — clear, well-scoped new capability. The user said WHAT, FOR WHOM, and how to verify success.
2. feature_brainstorm — small feature but missing 1-2 of: target users / success criteria / scope. Ask AT MOST 2 clarifying questions, each with 2-4 concrete options if possible.
3. bugfix — describes broken existing behavior (报错 / 异常 / 不对 / 预期 vs 实际).
4. roadmap_needed — large request that decomposes into multiple features (e.g. "权限系统", "通知中心"). Ask the user to identify 2-3 top sub-capabilities and a minimal closed loop.
5. unclear — too vague to classify; ask for more context.

Hard rules:
- You are NOT writing requirements. You are NOT proposing implementation. You are ONLY triaging.
- If the user came with a solution in mind, FIRST ask what problem it solves before accepting the framing.
- Be a thinking partner, not a recorder. Don't echo the user's words back.
- If you ask questions, ask AT MOST 2.

OUTPUT FORMAT — emit ONE JSON object exactly matching this schema, with NO prose, NO markdown fences, NO preamble:

{
  "action": "proceed" | "pause_for_human" | "abort",
  "routeCase": "feature_clear" | "feature_brainstorm" | "bugfix" | "roadmap_needed" | "unclear",
  "runType": "feature" | "bugfix" | "smoke",
  "reason": "<one short line>",
  "questions": ["<q1>", "<q2>"]
}

If action != "pause_for_human", "questions" MUST be an empty array.
`;

// ---- Coordinator: fallback question strings (rules.ts + llm-fallback.ts) ----

/** apps/runner/src/agents/coordinator/rules.ts:101-105 — questions when input is too short to triage */
export const COORDINATOR_FALLBACK_TOO_SHORT_QUESTIONS_DEFAULT: readonly string[] = [
  '能再描述一下吗？这是哪个场景下出现的？例如"在哪儿"、"做了什么"、"看到什么"。',
  '主要是修复现有问题，还是新增能力？',
];

/** apps/runner/src/agents/coordinator/rules.ts:124 — first question when large-scope detected; contains ${trigger} placeholder */
export const COORDINATOR_FALLBACK_LARGE_SCOPE_TEMPLATE_DEFAULT =
  '这听起来是个比较大的需求（涉及"${trigger}"）。能不能先列出 2-3 个最优先的子能力？';

/** apps/runner/src/agents/coordinator/rules.ts:127 — second question when large-scope detected */
export const COORDINATOR_FALLBACK_LARGE_SCOPE_FOLLOWUP_DEFAULT =
  '有没有一个最小闭环可以先做出来端到端跑通？';

/** apps/runner/src/agents/coordinator/llm-fallback.ts:24 */
export const COORDINATOR_FALLBACK_LLM_UNAVAILABLE_DEFAULT =
  'LLM 后端暂不可用，能否补充 1-2 句具体场景？';

/** apps/runner/src/agents/coordinator/llm-fallback.ts:39 */
export const COORDINATOR_FALLBACK_LLM_INVOCATION_FAILED_DEFAULT =
  'LLM 调用失败，能否补充更多上下文？';

/** apps/runner/src/agents/coordinator/llm-fallback.ts:131 */
export const COORDINATOR_FALLBACK_LLM_EMPTY_DEFAULT = 'LLM 返回为空，能换种说法描述吗？';

/** apps/runner/src/agents/coordinator/llm-fallback.ts:147 */
export const COORDINATOR_FALLBACK_LLM_INVALID_JSON_DEFAULT =
  '我还需要确认一下需求范围：这是新增能力、修复现有问题，还是一次性验证/冒烟检查？';

/** apps/runner/src/agents/coordinator/llm-fallback.ts:179 */
export const COORDINATOR_FALLBACK_LLM_UNKNOWN_ACTION_DEFAULT =
  'LLM 返回的 action 不在已知集合，能再描述一次吗？';

// ---- SkillSpec instructions (apps/runner/src/skills/index.ts) ----

/** apps/runner/src/skills/index.ts:19 — Stage 0 context_pack */
export const SKILL_CONTEXT_PACK_INSTRUCTIONS_DEFAULT = `Create a lightweight Context Pack that only locates likely relevant repository areas for the user request.

Your job is repository orientation, not implementation analysis.

Output must include:
- A short summary of what the request appears to concern.
- Relevant files, modules, routes, commands, or config keys, with path references.
- Minimal line-hit evidence when useful.
- Any obvious upstream/downstream areas that later stages may need to inspect.

Hard rules:
- Do NOT propose an implementation plan.
- Do NOT diagnose root cause unless it is directly obvious from file names or comments.
- Do NOT trace full call chains unless needed to identify the correct entry point.
- Do NOT recommend code changes.
- Do NOT run tests, builds, or mutation commands.
- Prefer shallow search and file mapping over deep source analysis.
- Keep the output concise and evidence-oriented.

The goal is to help later stages know where to look, not decide how to change the code.`;

/** apps/runner/src/skills/index.ts:46-76 — Stage 1 requirement_draft (cs-req methodology) */
export const SKILL_REQUIREMENT_DRAFT_INSTRUCTIONS_DEFAULT = `Turn the user request into a structured requirement document following CodeStable cs-req methodology.

Output a markdown file with EXACTLY four sections in this order:

1. **用户故事 (User Stories)** — 2 to 4 bullets. Each bullet must describe a SPECIFIC scenario:
   \`作为 {具体角色}，我希望 {能做什么}，而不是 {现在怎么难受}\`. No generic "希望系统好用" wording.

2. **为什么需要 (Why)** — one short paragraph (3-5 sentences). Describe the pain when this capability does not exist. Plain language, non-technical readers must understand.

3. **怎么解决 (How)** — one short paragraph. Describe what the user EXPERIENCES, NOT how it is implemented. No module names, interfaces, or algorithms.

4. **边界 (Boundaries)** — bullet list. What it does NOT cover; when not to use it; prerequisites.

Frontmatter MUST contain:
  doc_type: requirement
  pitch: <one-sentence non-technical summary that could double as marketing copy>
  status: draft
  REQ-### identifier (e.g. REQ-001)

Body MUST also include:
  - At least one AC-### acceptance criterion section
  - Goals / non-goals / scope subsection (can be inside 边界)
  - Context evidence references (file paths from Context Pack, format: \`src/...\`)

HARD RULES:
  - Do NOT write implementation details (no module names, no interface signatures).
  - Do NOT invent user stories — every story must trace to user_request, prior features, or knowledge.
  - Tone: human conversation, not PRD field-stuffing.
  - The \`pitch\` must be usable as marketing copy without further edits.`;

/** apps/runner/src/skills/index.ts:108-136 — Stage 2 design (cs-feat-design methodology) */
export const SKILL_DESIGN_INSTRUCTIONS_DEFAULT = `Given the approved requirement and the Context Pack, draft a design document following CodeStable cs-feat-design methodology.

Frontmatter MUST contain:
  doc_type: design
  design_id: DSN-### (e.g. DSN-001)
  related_req: REQ-### (the requirement this design implements)
  status: draft

Body MUST contain these five sections in this order:

1. **现状 (Current State)** — describe the relevant existing code, types, control flow that this change touches. Cite file paths from the Context Pack with line numbers when possible (\`src/...:NN\`). One short paragraph or bullet list.

2. **变化 (Changes)** — describe what the new state looks like, contrasted with 现状. Two halves:
   - Noun layer (types / data shapes / interfaces) — show signatures with brief examples
   - Orchestration layer (control flow / call graph delta) — short prose or a tiny diagram

3. **挂载点 (Mount Points)** — 3 to 5 bullets. Each bullet is a place this feature plugs into. Test: "if I removed this bullet, the feature would disappear or break in user-visible ways." Things that just enable internal correctness do NOT count.

4. **推进策略 (Roll-out)** — ordered numbered steps for HOW to implement, sliced by paradigm (data → orchestration → tests), not by file. Each step has a single exit signal (e.g. "tests for X pass").

5. **验收契约 (Acceptance)** — must reference REQ-### / AC-### identifiers from the requirement. Must include a test strategy keyed to AC-###. Must list risks with an explicit mitigation owner.

HARD RULES:
  - Do NOT repeat the requirement document; reference REQ-### / AC-### instead.
  - Do NOT prescribe code line-by-line — that is implementation stage.
  - Every claim about existing code MUST cite a \`src/...\` path; uncited assertions are forbidden.
  - 挂载点 must be ≥ 3 and ≤ 5 (CodeStable says 3-5 is the sweet spot — fewer means scope is too thin, more means the design is sprawling).`;

/** apps/runner/src/skills/index.ts:174-175 — Stage 3 implementation */
export const SKILL_IMPLEMENTATION_INSTRUCTIONS_DEFAULT =
  'Implement the approved design. Allowed to edit files inside the worktree only. Stay within paths surfaced in the Context Pack unless the design explicitly broadens scope.';

/** apps/runner/src/skills/index.ts:200-201 — Stage 5 review */
export const SKILL_REVIEW_INSTRUCTIONS_DEFAULT =
  'Read the diff and the test report and write a short review (verdict, risks, follow-ups).';

// ---- Runner runtime defaults (apps/runner/src/cmd/watch.ts + config.ts + llm-fallback.ts) ----

/** apps/runner/src/agents/coordinator/llm-fallback.ts:17 */
export const RUNNER_COORDINATOR_ONESHOT_TIMEOUT_MS_DEFAULT = 30_000;

/** apps/runner/src/cmd/watch.ts:127 */
export const RUNNER_WATCH_POLL_MS_DEFAULT = 2_000;

/** apps/runner/src/config.ts — DEFAULT_TIMEOUT_MS */
export const RUNNER_COMMAND_DEFAULT_TIMEOUT_MS_DEFAULT = 5 * 60 * 1000;

/** apps/runner/src/config.ts — DEFAULT_MAX_LOG_BYTES */
export const RUNNER_COMMAND_MAX_LOG_BYTES_DEFAULT = 8 * 1024 * 1024;

/** New in this PR — runner config-client cache TTL; should be slightly shorter than watch poll. */
export const RUNNER_CONFIG_CACHE_TTL_MS_DEFAULT = 1500;

// ---- Context policy (Context Injection Layer Phase 6) ---------------------

/** apps/runner/src/context/builder.ts — default ContextPack total token budget. */
export const CONTEXT_POLICY_MAX_TOKENS_DEFAULT = 12_000;

/** apps/runner/src/context/builder.ts — token budget reserved for model reasoning. */
export const CONTEXT_POLICY_RESERVED_FOR_REASONING_DEFAULT = 2_000;

/** apps/runner/src/context/builder.ts — token budget reserved for model output. */
export const CONTEXT_POLICY_RESERVED_FOR_OUTPUT_DEFAULT = 2_000;

/**
 * packages/shared/src/utils/context-policy.ts — path fragments that are
 * never injected as selected context. Exact globbing is intentionally avoided;
 * matching is conservative substring/extension based and dependency-free.
 */
export const CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT: readonly string[] = [
  '.env',
  '.npmrc',
  '.netrc',
  '.ssh/',
  '.aws/credentials',
  'id_rsa',
  'id_ed25519',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  'secrets/',
  'credentials',
];
