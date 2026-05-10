/**
 * Static registry of all runtime-configurable keys exposed via UI.
 *
 * MVP-M + Context Governance scope: 29 keys
 * (15 coordinator + 5 skill_prompts + 5 runtime + 4 context_policy).
 * Adding / removing a key REQUIRES a code PR; the UI never creates new keys.
 *
 * Source-of-truth defaults live in `./defaults.ts` (byte-for-byte transcribed
 * from the runner). The runner's `getConfig()` function consults this
 * registry's `default` field when no override is present, and the API's
 * `GET /config/registry` route returns this registry verbatim for UI rendering.
 */

import {
  COORDINATOR_BUG_KEYWORDS_DEFAULT,
  COORDINATOR_FEATURE_KEYWORDS_DEFAULT,
  COORDINATOR_LARGE_SCOPE_KEYWORDS_DEFAULT,
  COORDINATOR_LARGE_SCOPE_REGEX_DEFAULT,
  COORDINATOR_REFACTOR_KEYWORDS_DEFAULT,
  COORDINATOR_CONFIDENCE_THRESHOLD_DEFAULT,
  COORDINATOR_SYSTEM_PROMPT_DEFAULT,
  COORDINATOR_FALLBACK_TOO_SHORT_QUESTIONS_DEFAULT,
  COORDINATOR_FALLBACK_LARGE_SCOPE_TEMPLATE_DEFAULT,
  COORDINATOR_FALLBACK_LARGE_SCOPE_FOLLOWUP_DEFAULT,
  COORDINATOR_FALLBACK_LLM_UNAVAILABLE_DEFAULT,
  COORDINATOR_FALLBACK_LLM_INVOCATION_FAILED_DEFAULT,
  COORDINATOR_FALLBACK_LLM_EMPTY_DEFAULT,
  COORDINATOR_FALLBACK_LLM_INVALID_JSON_DEFAULT,
  COORDINATOR_FALLBACK_LLM_UNKNOWN_ACTION_DEFAULT,
  SKILL_CONTEXT_PACK_INSTRUCTIONS_DEFAULT,
  SKILL_REQUIREMENT_DRAFT_INSTRUCTIONS_DEFAULT,
  SKILL_DESIGN_INSTRUCTIONS_DEFAULT,
  SKILL_IMPLEMENTATION_INSTRUCTIONS_DEFAULT,
  SKILL_REVIEW_INSTRUCTIONS_DEFAULT,
  RUNNER_COORDINATOR_ONESHOT_TIMEOUT_MS_DEFAULT,
  RUNNER_WATCH_POLL_MS_DEFAULT,
  RUNNER_COMMAND_DEFAULT_TIMEOUT_MS_DEFAULT,
  RUNNER_COMMAND_MAX_LOG_BYTES_DEFAULT,
  RUNNER_CONFIG_CACHE_TTL_MS_DEFAULT,
  CONTEXT_POLICY_MAX_TOKENS_DEFAULT,
  CONTEXT_POLICY_RESERVED_FOR_REASONING_DEFAULT,
  CONTEXT_POLICY_RESERVED_FOR_OUTPUT_DEFAULT,
  CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT,
} from './defaults';

export type ConfigCategory = 'coordinator' | 'skill_prompts' | 'runtime' | 'context_policy';
export type ConfigType = 'number' | 'string' | 'string_array';

export interface ConfigEntry {
  type: ConfigType;
  default: number | string | readonly string[];
  description: string;
  category: ConfigCategory;
  /** For type === 'number' only. Inclusive lower bound. */
  min?: number;
  /** For type === 'number' only. Inclusive upper bound. */
  max?: number;
  /** UI hint: render as multi-line / autosize textarea. */
  multiline?: boolean;
  /** Cited source location for traceability (file:line). */
  source: string;
}

export const CONFIG_REGISTRY = {
  // ============ Tab "coordinator" — 15 keys ============

  'coordinator.confidence_threshold': {
    type: 'number',
    default: COORDINATOR_CONFIDENCE_THRESHOLD_DEFAULT,
    min: 0,
    max: 1,
    description: '规则置信度 ≥ 此值则跳过 LLM 兜底',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/index.ts:18',
  },
  'coordinator.bug_keywords': {
    type: 'string_array',
    default: COORDINATOR_BUG_KEYWORDS_DEFAULT,
    description: 'bug 倾向关键词；任一命中加分（替换语义：保存即整段替换默认）',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/rules.ts:32',
  },
  'coordinator.feature_keywords': {
    type: 'string_array',
    default: COORDINATOR_FEATURE_KEYWORDS_DEFAULT,
    description: 'feature 倾向关键词（替换语义）',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/rules.ts:51',
  },
  'coordinator.large_scope_keywords': {
    type: 'string_array',
    default: COORDINATOR_LARGE_SCOPE_KEYWORDS_DEFAULT,
    description: '大范围需求关键词（替换语义）',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/rules.ts:69',
  },
  'coordinator.large_scope_regex': {
    type: 'string',
    default: COORDINATOR_LARGE_SCOPE_REGEX_DEFAULT,
    description: '匹配 "X系统 / Y体系" 模式的正则字面量（不含 / 分隔符）',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/rules.ts:83',
  },
  'coordinator.refactor_keywords': {
    type: 'string_array',
    default: COORDINATOR_REFACTOR_KEYWORDS_DEFAULT,
    description: '重构倾向关键词；命中 ≥1 且 length > 8 → runType=refactor（替换语义）',
    category: 'coordinator',
    source: 'packages/shared/src/coordinator/rules-core.ts (refactor branch)',
  },
  'coordinator.system_prompt': {
    type: 'string',
    default: COORDINATOR_SYSTEM_PROMPT_DEFAULT,
    multiline: true,
    description: 'LLM 兜底分诊的 system prompt（输出 schema 钉死在 prompt 里）',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/prompt.ts:9',
  },
  'coordinator.fallback.too_short_questions': {
    type: 'string_array',
    default: COORDINATOR_FALLBACK_TOO_SHORT_QUESTIONS_DEFAULT,
    description: '请求过短时反向追问的两句',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/rules.ts:101',
  },
  'coordinator.fallback.large_scope_template': {
    type: 'string',
    default: COORDINATOR_FALLBACK_LARGE_SCOPE_TEMPLATE_DEFAULT,
    description: '大范围需求时第一句（含 ${trigger} 占位符，runtime 替换）',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/rules.ts:124',
  },
  'coordinator.fallback.large_scope_followup': {
    type: 'string',
    default: COORDINATOR_FALLBACK_LARGE_SCOPE_FOLLOWUP_DEFAULT,
    description: '大范围需求时第二句',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/rules.ts:127',
  },
  'coordinator.fallback.llm_unavailable': {
    type: 'string',
    default: COORDINATOR_FALLBACK_LLM_UNAVAILABLE_DEFAULT,
    description: 'claude CLI 不存在时的兜底 question',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/llm-fallback.ts:24',
  },
  'coordinator.fallback.llm_invocation_failed': {
    type: 'string',
    default: COORDINATOR_FALLBACK_LLM_INVOCATION_FAILED_DEFAULT,
    description: 'claude CLI 调用失败时的兜底 question',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/llm-fallback.ts:39',
  },
  'coordinator.fallback.llm_empty': {
    type: 'string',
    default: COORDINATOR_FALLBACK_LLM_EMPTY_DEFAULT,
    description: 'LLM 返回为空时的兜底 question',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/llm-fallback.ts:131',
  },
  'coordinator.fallback.llm_invalid_json': {
    type: 'string',
    default: COORDINATOR_FALLBACK_LLM_INVALID_JSON_DEFAULT,
    description: 'LLM 返回非法 JSON 时的兜底 question',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/llm-fallback.ts:147',
  },
  'coordinator.fallback.llm_unknown_action': {
    type: 'string',
    default: COORDINATOR_FALLBACK_LLM_UNKNOWN_ACTION_DEFAULT,
    description: 'LLM 返回未知 action 时的兜底 question',
    category: 'coordinator',
    source: 'apps/runner/src/agents/coordinator/llm-fallback.ts:179',
  },

  // ============ Tab "skill_prompts" — 5 keys ============

  'skill.context_pack.instructions': {
    type: 'string',
    default: SKILL_CONTEXT_PACK_INSTRUCTIONS_DEFAULT,
    multiline: true,
    description: 'Stage 0 context_pack 的 instructions prompt',
    category: 'skill_prompts',
    source: 'apps/runner/src/skills/index.ts:19',
  },
  'skill.requirement_draft.instructions': {
    type: 'string',
    default: SKILL_REQUIREMENT_DRAFT_INSTRUCTIONS_DEFAULT,
    multiline: true,
    description: 'Stage 1 requirement_draft 的方法论 prompt（cs-req）',
    category: 'skill_prompts',
    source: 'apps/runner/src/skills/index.ts:46',
  },
  'skill.design.instructions': {
    type: 'string',
    default: SKILL_DESIGN_INSTRUCTIONS_DEFAULT,
    multiline: true,
    description: 'Stage 2 design 的方法论 prompt（cs-feat-design）',
    category: 'skill_prompts',
    source: 'apps/runner/src/skills/index.ts:108',
  },
  'skill.implementation.instructions': {
    type: 'string',
    default: SKILL_IMPLEMENTATION_INSTRUCTIONS_DEFAULT,
    multiline: true,
    description: 'Stage 3 implementation 的 prompt',
    category: 'skill_prompts',
    source: 'apps/runner/src/skills/index.ts:174',
  },
  'skill.review.instructions': {
    type: 'string',
    default: SKILL_REVIEW_INSTRUCTIONS_DEFAULT,
    multiline: true,
    description: 'Stage 5 review 的 prompt',
    category: 'skill_prompts',
    source: 'apps/runner/src/skills/index.ts:200',
  },

  // ============ Tab "runtime" — 5 keys ============

  'runner.coordinator.oneshot_timeout_ms': {
    type: 'number',
    default: RUNNER_COORDINATOR_ONESHOT_TIMEOUT_MS_DEFAULT,
    min: 1000,
    max: 300_000,
    description: 'Coordinator LLM 兜底单次调用超时（毫秒）',
    category: 'runtime',
    source: 'apps/runner/src/agents/coordinator/llm-fallback.ts:17',
  },
  'runner.watch.poll_ms': {
    type: 'number',
    default: RUNNER_WATCH_POLL_MS_DEFAULT,
    min: 500,
    max: 30_000,
    description: 'Runner watch 守护进程的 poll 周期（毫秒）',
    category: 'runtime',
    source: 'apps/runner/src/cmd/watch.ts:127',
  },
  'runner.command.default_timeout_ms': {
    type: 'number',
    default: RUNNER_COMMAND_DEFAULT_TIMEOUT_MS_DEFAULT,
    min: 5_000,
    max: 60 * 60 * 1000,
    description: '单条命令默认超时（毫秒）；mvn compile/test 用',
    category: 'runtime',
    source: 'apps/runner/src/config.ts',
  },
  'runner.command.max_log_bytes': {
    type: 'number',
    default: RUNNER_COMMAND_MAX_LOG_BYTES_DEFAULT,
    min: 1024,
    max: 50_000_000,
    description: '单 stream 日志硬上限（字节）；防爆盘',
    category: 'runtime',
    source: 'apps/runner/src/config.ts',
  },
  'runner.config.cache_ttl_ms': {
    type: 'number',
    default: RUNNER_CONFIG_CACHE_TTL_MS_DEFAULT,
    min: 200,
    max: 5_000,
    description: 'Runner 端 config 缓存 TTL（毫秒）；应略短于 watch poll',
    category: 'runtime',
    source: 'apps/runner/src/config-client.ts (new in this PR)',
  },

  // ============ Tab "context_policy" — 4 keys ============

  'context.policy.max_tokens': {
    type: 'number',
    default: CONTEXT_POLICY_MAX_TOKENS_DEFAULT,
    min: 1_000,
    max: 64_000,
    description: 'ContextPack 总 token 预算；超限时按 full → summary → retrieval_hint 降级',
    category: 'context_policy',
    source: 'apps/runner/src/context/builder.ts:DEFAULT_BUDGET',
  },
  'context.policy.reserved_for_reasoning': {
    type: 'number',
    default: CONTEXT_POLICY_RESERVED_FOR_REASONING_DEFAULT,
    min: 0,
    max: 32_000,
    description: '为模型推理预留的 context token；会从可注入上下文预算中扣除',
    category: 'context_policy',
    source: 'apps/runner/src/context/builder.ts:DEFAULT_BUDGET',
  },
  'context.policy.reserved_for_output': {
    type: 'number',
    default: CONTEXT_POLICY_RESERVED_FOR_OUTPUT_DEFAULT,
    min: 0,
    max: 32_000,
    description: '为模型输出预留的 context token；会从可注入上下文预算中扣除',
    category: 'context_policy',
    source: 'apps/runner/src/context/builder.ts:DEFAULT_BUDGET',
  },
  'context.policy.sensitive_path_patterns': {
    type: 'string_array',
    default: CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT,
    description: '敏感路径/文件名片段；命中则不进入 ContextPack selected context',
    category: 'context_policy',
    source: 'packages/shared/src/utils/context-policy.ts',
  },
} satisfies Record<string, ConfigEntry>;

export type ConfigKey = keyof typeof CONFIG_REGISTRY;

/** Resolved type of a key's default value. Use for return-type annotations on getConfig. */
export type RegistryDefault<K extends ConfigKey> = (typeof CONFIG_REGISTRY)[K]['default'];

/** Total = 15 + 5 + 5 + 4 = 29 keys. Asserted by tests. */
export const CONFIG_REGISTRY_KEY_COUNT = 29 as const;

/** All registered keys in declaration order. */
export function configKeys(): ConfigKey[] {
  return Object.keys(CONFIG_REGISTRY) as ConfigKey[];
}

/** Keys filtered by category. */
export function configKeysByCategory(category: ConfigCategory): ConfigKey[] {
  return configKeys().filter((k) => CONFIG_REGISTRY[k].category === category);
}

/**
 * Validate a candidate value against a key's declared type / range.
 * Returns null if valid, an error message string otherwise.
 *
 * Used by:
 *   - API PUT /config/overrides/:key to reject malformed input at write time
 *   - Runner getConfig() to reject malformed override at read time (defense in depth)
 */
export function validateConfigValue(key: ConfigKey, value: unknown): string | null {
  const entry = CONFIG_REGISTRY[key] as ConfigEntry;
  switch (entry.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `expected number, got ${typeof value}`;
      }
      if (entry.min !== undefined && value < entry.min) {
        return `value ${value} below min ${entry.min}`;
      }
      if (entry.max !== undefined && value > entry.max) {
        return `value ${value} above max ${entry.max}`;
      }
      return null;
    case 'string':
      if (typeof value !== 'string') {
        return `expected string, got ${typeof value}`;
      }
      return null;
    case 'string_array':
      if (!Array.isArray(value)) return `expected array, got ${typeof value}`;
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
          return `expected string at index ${i}, got ${typeof value[i]}`;
        }
      }
      return null;
    default: {
      const _: never = entry.type;
      return `unknown type ${String(_)}`;
    }
  }
}

/** Type-erased default lookup. Returns the key's compiled-in default value. */
export function getDefault(key: ConfigKey): number | string | readonly string[] {
  return CONFIG_REGISTRY[key].default;
}
