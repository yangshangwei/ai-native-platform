# New Task Form (Web UI)

## Scenario: user creates workflow request via web form

### 1. Scope / Trigger

- Trigger: changes to `apps/web/src/page-new-task.ts` (form rendering, validation, submission, preview), `apps/web/src/data-loading.ts` (task list filtering), or `apps/web/src/state.ts` (form draft persistence).
- Adding a new `type` option: update dropdown array + all type unions + preview display logic.
- Adding a new form field: update `newTaskFormDraft` schema + hydration/persistence logic.

### 2. Signatures

- `renderNewTaskPage()` → `HTMLElement` — renders the form + preview card
- `submitWorkflowRequest(event, form)` → `Promise<void>` — validates, calls `POST /workflow-requests`, updates state
- `fetchRecommendation()` → `Promise<void>` — calls `/coordinator/preview` + `/router/recommend`, renders preview card
- `newTaskFormDraft` (global state) — `{ projectId, title, details, type, flowId, startStage, branch }` — persisted across renders

### 3. Contracts

#### Form fields (user-facing)

| Field | Input Type | Required | Default | Purpose |
|-------|-----------|----------|---------|---------|
| 项目 | `<select>` | ✅ | first project | target project |
| 任务目标 | `<input>` | ✅ | (empty) | brief description of what to do |
| 补充说明 | `<textarea>` | ❌ | (empty) | acceptance criteria, constraints, references |
| **高级设置（折叠）** | `<details>` | - | - | power-user overrides |
| └─ 基于哪个分支 | `<select>` | ❌ | project.defaultBranch | git base branch |
| └─ 任务类型覆盖 | `<select>` | ❌ | `''` (AI 判定) | explicit runType: `feature \| bugfix \| smoke \| refactor \| ask` *(ask added 2026-06-25)* |
| └─ 执行路径覆盖 | `<select>` | ❌ | `''` (router 推荐) | explicit flowId: `feature.standard \| feature.fastforward \| issue.standard \| refactor.standard` |
| └─ 起始阶段 | `<select>` | ❌ | `''` (从第一阶段) | only for `feature.standard`; auto-hidden for other flows |

#### Type dropdown options (`:236`)

```ts
['feature', 'bugfix', 'smoke', 'refactor', 'ask']
// 'ask' = read-only Q&A (2026-06-25 added)
```

#### Submit payload (to `POST /workflow-requests`)

```ts
{
  projectId: string,
  title: string,       // trimmed
  details?: string,    // trimmed, omitted if empty
  branch: string,      // from select or project default
  type?: WorkflowRunType,  // only if user selected non-empty override
  flowId?: FlowId,         // only if user selected non-empty override
  startStage?: WorkflowStage, // only if flowId='feature.standard' and user selected non-empty
  kind?: 'ask',        // only if type='ask' (2026-06-25 added)
  firstMessage: {
    role: 'user',
    content: string    // composed from title + details
  }
}
```

#### Preview card display (after title blur)

Two-stage pipeline (debounced 400ms):
1. If user left `type=''` (AI 判定): `POST /coordinator/preview { title }` → `predictedRunType`
2. `POST /router/recommend { projectId, title, runType: userOverride || predictedRunType || 'feature' }` → `{ flowId, startStage, estimates, reason, rulesFired }`

Display:
```
┌─────────────────────────────────────────┐
│ 执行建议                                 │
│ AI 判定: ask（只读问答）· 置信 85%       │ ← when predictedRunType='ask'
│ 📖 问答模式：不开分支、不改文件，只回答问题 │ ← special hint for ask
│ feature.standard · 从头执行              │
│ 预估 ~12 分钟 / ~8000 tokens            │
│ 命中规则: rule.ask_question_detected    │
└─────────────────────────────────────────┘
```

When user manually selects `type='ask'`:
- Preview skips `/coordinator/preview` (no need to predict)
- Router receives `runType='ask'` explicitly
- Hint changes to: "你选择了只读问答，将不开分支、不改文件"

### 4. Validation & Error Matrix

| Condition | UI Behavior | Error Message |
|-----------|-------------|---------------|
| Project not selected | Submit button disabled | "请先连接项目。" |
| Title empty (after trim) | Submit button disabled | "请填写任务目标。" |
| Project has no `agentBackend` | Submit button disabled | "请先为这个项目配置执行方式。" |
| Backend preflight fails | Submit button disabled | "执行方式连接检测未通过，请处理后重试。" |
| Projects load error | Show inline notice + retry button | "项目列表加载失败" |
| Submit API error | Show inline notice | Error message from API |

Submit button is enabled **only when**:
- Project selected
- Project has `agentBackend`
- Title non-empty
- Backend preflight passed (or no preflight run yet)

### 5. Good/Base/Bad Cases

#### Good: Normal task creation
```
User fills:
  项目: my-project
  任务目标: Add export feature
  补充说明: CSV format, include all columns
  
Preview shows: feature.standard · ~15分钟

Submit → POST /workflow-requests {
  projectId: "proj_...",
  title: "Add export feature",
  details: "CSV format, include all columns",
  branch: "main",
  firstMessage: { role: "user", content: "Add export feature\n\nCSV format, include all columns" }
}
→ Creates normal task, appears in workbench
```

#### Good: Ask (read-only Q&A) auto-detected
```
User fills:
  项目: my-project
  任务目标: 为什么登录流程用 JWT 而不是 session？
  
Preview shows: AI 判定: ask（只读问答）· 置信 90%
               📖 问答模式：不开分支、不改文件，只回答问题

Submit → POST /workflow-requests {
  projectId: "proj_...",
  title: "为什么登录流程用 JWT 而不是 session？",
  kind: "ask",  // derived from Coordinator prediction
  firstMessage: { role: "user", content: "为什么登录流程用 JWT 而不是 session？" }
}
→ Creates ask request, does NOT appear in workbench task list
```

#### Good: Manual ask selection (override)
```
User fills:
  项目: my-project
  任务目标: Optimize database queries
  高级设置 > 任务类型覆盖: ask

Preview shows: 使用你在高级设置里指定的任务类型
               📖 问答模式：不开分支、不改文件，只回答问题

Submit → POST /workflow-requests {
  kind: "ask",  // explicit override from dropdown
  ...
}
→ Creates ask request (even though title doesn't look like a question)
```

#### Base: Explicit flow override
```
User fills:
  任务目标: Quick bugfix
  高级设置 > 执行路径覆盖: feature.fastforward

Submit → POST /workflow-requests {
  flowId: "feature.fastforward",  // skips Coordinator + Router
  ...
}
```

#### Bad: Empty title
```
User leaves 任务目标 empty

Submit button disabled
Hint: "请填写任务目标。"
```

#### Bad: Project has no backend
```
User selects project with no agentBackend configured

Submit button disabled
Hint: "请先为这个项目配置执行方式。"
```

### 6. Tests Required

#### Unit tests (`apps/web/test/page-new-task.test.ts` or E2E)
- **Render**: dropdown includes 'ask' option
- **Type union sync**: all 5 places (`:64 / :236 / :359 / :373 / :392`) include 'ask'
- **Preview**: title "为什么 X" triggers `predictedRunType='ask'` from mock Coordinator
- **Submit**: when type='ask' selected, POST body includes `kind='ask'`
- **Submit**: when Coordinator predicts ask, POST body includes `kind='ask'`
- **Filtering**: after creating ask request, it doesn't appear in `data.requests` (filtered by `data-loading.ts`)

#### Assertion points
- Assert dropdown `<option value="ask">` exists
- Assert preview card shows "ask（只读问答）" + special hint when `predictedRunType='ask'`
- Assert `submitWorkflowRequest` passes `kind='ask'` when type dropdown = 'ask' OR Coordinator predicts ask
- Assert task list (workbench / myTodos / reports) excludes newly created ask request

### 7. Wrong vs Correct

#### Wrong: Type union out of sync
```ts
// Don't do this — breaks when a new type is added
const typeSelect = el('select', ...);
for (const type of ['feature', 'bugfix', 'smoke', 'refactor']) {
  // ❌ Missing 'ask' — will cause type error or missing option
}

// Also need to update:
// - :64 newTaskFormDraft.type
// - :359 CoordinatorPreviewResponse type
// - :373 userOverrideType
// - :392 runTypeForRouter
```

#### Correct: All type unions synced
```ts
// Do this — all 5 places include 'ask'
for (const type of ['feature', 'bugfix', 'smoke', 'refactor', 'ask']) {
  // ✅ Complete list
}

// And verify all union types also include 'ask':
type: '' | 'feature' | 'bugfix' | 'smoke' | 'refactor' | 'ask'
```

#### Wrong: Preview hint doesn't distinguish ask
```ts
// Don't do this — ask looks identical to feature
if (coordPreview.predictedRunType) {
  children.push(el('p', { text: `AI 判定: ${coordPreview.predictedRunType}` }));
}
// ❌ User doesn't know 'ask' is special (won't open branch, won't change files)
```

#### Correct: Preview shows special hint for ask
```ts
// Do this — give visual cue that ask is different
if (coordPreview.predictedRunType === 'ask') {
  children.push(
    el('p', { text: 'AI 判定: ask（只读问答）· 置信 85%' }),
    el('p', { class: 'muted compact', text: '📖 问答模式：不开分支、不改文件，只回答问题' })
  );
} else if (coordPreview.predictedRunType) {
  children.push(el('p', { text: `AI 判定: ${coordPreview.predictedRunType}` }));
}
// ✅ Clear distinction
```

---

## Design Decisions

### Decision: Why `kind='ask'` derived from Coordinator prediction?

**Context**: When Coordinator predicts `runType='ask'`, we need to pass `kind='ask'` to the API.

**Options Considered**:
1. Let API derive `kind` from `type` field (if `type='ask'` → `kind='ask'`)
2. Frontend explicitly sets `kind='ask'` when Coordinator predicts ask or user selects ask
3. Separate `kind` and `type` entirely (user can set type without affecting kind)

**Decision**: We chose Option 2 (frontend sets `kind` explicitly) because:
- **Clarity**: The frontend knows the intent (ask vs normal task) at form submission time. Passing `kind` explicitly makes the API contract clearer.
- **Coordinator vs Router**: Coordinator predicts `runType` (which influences Router), but `kind` is a separate dimension that controls whether the request enters the runner watch loop. Frontend is the right place to bridge these two.
- **Explicit override**: When user manually selects `type='ask'`, frontend can immediately set `kind='ask'` without waiting for server to infer.

**Consequences**:
- Frontend must correctly map: `(Coordinator predicts ask) OR (user selects type='ask')` → `kind='ask'`
- API trusts `kind` field; doesn't re-derive it from `type`

### Decision: Why show special hint for ask in preview?

**Context**: Preview card shows predicted flow + estimates. When `predictedRunType='ask'`, user needs to know this is fundamentally different (won't change files).

**Decision**: Show explicit "📖 问答模式：不开分支、不改文件，只回答问题" hint.

**Why**: Without this, user sees "ask" but doesn't understand what it means. The hint:
- Sets expectation (this is read-only)
- Prevents confusion (user won't wait for PR to be created)
- Builds trust (user knows AI understood their intent)

---

## Common Mistakes

### Mistake: Forgetting to pass `kind` when Coordinator predicts ask

**Symptom**: User asks question, Coordinator preview shows "ask", but submitted request creates normal task (opens branch, tries to run flow)

**Cause**: Frontend doesn't check `coordPreview.predictedRunType === 'ask'` when building submit payload

**Fix**: In `submitWorkflowRequest`, derive `kind` from type override OR Coordinator prediction

**Prevention**: Unit test asserting: preview shows ask → submit includes `kind='ask'`

### Mistake: Type unions out of sync (missing 'ask' in one of 5 places)

**Symptom**: TypeScript error, or ask option missing from dropdown

**Cause**: Added 'ask' to `:236` dropdown but forgot `:64 / :359 / :373 / :392`

**Fix**: Grep all type unions and add 'ask' to each

**Prevention**: 
- Code review checklist: "Did you update all 5 type unions?"
- Consider refactoring to single source of truth (e.g., `const KNOWN_RUN_TYPES = [...]` imported everywhere)
