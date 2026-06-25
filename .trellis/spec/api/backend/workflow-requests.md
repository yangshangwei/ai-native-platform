# Workflow Requests API

## Scenario: create and query workflow requests (task intake)

### 1. Scope / Trigger

- Trigger: changes to `apps/api/src/routes/workflow-requests.ts` (POST/GET/PATCH handlers), `apps/api/src/workflow-engine.ts` (`createWorkflowRequest`), or `packages/shared/src/types/workflow.ts` (`WorkflowRequest` schema).
- Adding a new `kind` value: update this spec's contracts section + validation matrix + test cases.
- Schema change touching `WorkflowRequest` fields: rebuild this spec + update migrations.

### 2. Signatures

- `POST /workflow-requests` — creates a new workflow request with optional `kind` field
  - Body: `{ projectId, title, branch?, details?, type?, flowId?, startStage?, kind?, firstMessage }` (all fields except `projectId`, `title`, `firstMessage` are optional)
  - Returns: 201 with `WorkflowRequestDto`
- `GET /workflow-requests` — lists all workflow requests (with filtering)
  - Query: `?status=pending|claimed|...` (optional)
  - Returns: 200 with `{ items: WorkflowRequestDto[] }`
  - **Default behavior (2026-06-25)**: filters out `kind='ask'` requests to keep task list clean
- `PATCH /workflow-requests/:id` — updates request fields (status, kind, etc.)
  - Body: `{ status?, kind?, ... }`
  - Returns: 200 with updated `WorkflowRequestDto`

### 3. Contracts

#### Request fields (POST body)

| Field | Type | Required | Constraints | Purpose |
|-------|------|----------|-------------|---------|
| `projectId` | string | ✅ | must exist, not archived, has agentBackend | target project |
| `title` | string | ✅ | non-empty, trimmed | task goal |
| `branch` | string | ❌ | defaults to project.defaultBranch | git base branch |
| `details` | string | ❌ | trimmed | additional context |
| `type` | `'feature' \| 'bugfix' \| 'smoke' \| 'refactor' \| 'ask'` | ❌ | from `WorkflowRunType` enum | explicit runType override (skips Coordinator if set) |
| `flowId` | `FlowId` | ❌ | from `FLOW_REGISTRY` | explicit flow override (skips Coordinator + Router if set) |
| `startStage` | `WorkflowStage` | ❌ | only meaningful for `feature.standard` | where to enter the flow |
| `kind` | `'ask' \| null` | ❌ | defaults to `null` | *(2026-06-25 added)* `'ask'` = read-only Q&A, won't enter runner watch loop |
| `firstMessage` | `{ role: 'user' \| 'coordinator', content: string }` | ✅ | role ∈ {user, coordinator}, content non-empty | atomic intake: request + first message in same transaction |

#### Response fields (`WorkflowRequestDto`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `wreq_...` format |
| `projectId` | string | - |
| `title` | string | - |
| `branch` | string | resolved from input or project default |
| `status` | `'pending' \| 'claimed' \| 'awaiting_clarification' \| ...` | lifecycle state; **ask requests use `'awaiting_clarification'` to avoid runner pickup** |
| `kind` | `'ask' \| null` | *(2026-06-25 added)* `null` = normal task, `'ask'` = read-only Q&A |
| `workflowRunId` | string \| null | `null` until runner claims and creates run; **always `null` for `kind='ask'`** |
| `type` | `WorkflowRunType \| null` | explicit override from input, or `null` if Coordinator should decide |
| `flowId` | `FlowId \| null` | explicit override from input, or `null` if Router should decide |
| `createdAt` | string (ISO 8601) | - |
| `updatedAt` | string (ISO 8601) | - |

### 4. Validation & Error Matrix

| Condition | Error | HTTP Status |
|-----------|-------|-------------|
| Missing `projectId` | `"projectId is required"` | 400 |
| Missing `title` | `"title is required"` | 400 |
| Empty `title` (after trim) | `"title cannot be empty"` | 400 |
| `projectId` not found | `"Project not found"` | 404 |
| Project archived | `"Project is archived"` | 400 |
| Project missing `agentBackend` | `"Project has no agent backend configured"` | 400 |
| `kind` not in `['ask', null]` | `"Invalid kind value"` | 400 |
| `type` not in `WorkflowRunType` | `"Invalid type value"` | 400 |
| `flowId` not in `FLOW_REGISTRY` | `"Invalid flowId value"` | 400 |
| Missing `firstMessage` | `"firstMessage is required"` | 400 |
| `firstMessage.role` not in `['user', 'coordinator']` | `"Invalid message role"` | 400 |
| Empty `firstMessage.content` | `"Message content cannot be empty"` | 400 |

### 5. Good/Base/Bad Cases

#### Good: Normal task creation
```bash
POST /workflow-requests
{
  "projectId": "proj_abc123",
  "title": "Add export feature to reports page",
  "firstMessage": { "role": "user", "content": "Add CSV export button to reports page" }
}
→ 201, kind=null, status='pending', runner picks it up
```

#### Good: Ask (read-only Q&A) request
```bash
POST /workflow-requests
{
  "projectId": "proj_abc123",
  "title": "How does the authentication flow work?",
  "kind": "ask",
  "firstMessage": { "role": "user", "content": "Can you explain the auth flow?" }
}
→ 201, kind='ask', status='awaiting_clarification' (not 'pending'), runner ignores it
```

#### Base: Explicit type override (skips Coordinator)
```bash
POST /workflow-requests
{
  "projectId": "proj_abc123",
  "title": "Refactor config loader",
  "type": "refactor",
  "firstMessage": { "role": "user", "content": "Simplify config loading logic" }
}
→ 201, kind=null, type='refactor', Coordinator sees explicit type and doesn't re-classify
```

#### Bad: Missing required fields
```bash
POST /workflow-requests
{ "projectId": "proj_abc123" }
→ 400, "title is required"
```

#### Bad: Invalid kind value
```bash
POST /workflow-requests
{
  "projectId": "proj_abc123",
  "title": "Some task",
  "kind": "invalid_kind",
  "firstMessage": { "role": "user", "content": "..." }
}
→ 400, "Invalid kind value"
```

### 6. Tests Required

#### Unit/Integration tests (`apps/api/test/workflow-requests.test.ts`)
- **POST**: create with `kind='ask'` → status is `'awaiting_clarification'`, not `'pending'`
- **POST**: create without `kind` → kind is `null`, status is `'pending'`
- **POST**: missing `title` → 400
- **POST**: invalid `kind` value → 400
- **GET**: default query excludes `kind='ask'` → only normal tasks returned
- **GET**: explicit `?status=...` filter works
- **PATCH**: upgrade ask to normal task (`kind=null`, `status='pending'`) → runner picks it up

#### Assertion points
- Assert `response.kind === 'ask'` when created with `kind='ask'`
- Assert `response.status === 'awaiting_clarification'` for ask requests
- Assert `response.workflowRunId === null` for ask requests
- Assert GET default list excludes ask requests
- Assert runner watch loop only queries `status='pending'` (mock or integration test with runner)

### 7. Wrong vs Correct

#### Wrong: Ask request with `status='pending'`
```ts
// Don't do this — runner will pick it up
await createWorkflowRequest({
  ...input,
  kind: 'ask',
  status: 'pending', // ❌ Wrong: runner watch loop will claim this
});
```

#### Correct: Ask request with `status='awaiting_clarification'`
```ts
// Do this — runner ignores non-pending status
await createWorkflowRequest({
  ...input,
  kind: 'ask',
  status: 'awaiting_clarification', // ✅ Correct: runner never picks this up
});
```

#### Wrong: Forgetting to filter ask in custom queries
```ts
// Don't do this — leaks ask requests into task list
const allRequests = await api('/workflow-requests');
const taskCount = allRequests.items.length; // ❌ includes ask requests
```

#### Correct: Always filter ask requests
```ts
// Do this — defense-in-depth filtering
const allRequests = await api('/workflow-requests'); // API already filters by default
const taskCount = allRequests.items.filter(r => r.kind !== 'ask').length; // ✅ extra safety
```

---

## Design Decisions

### Decision: Why `kind` instead of new `status` value?

**Context**: Need to distinguish read-only Q&A requests from normal tasks.

**Options Considered**:
1. Add `kind='ask'` field + keep status separate
2. Add new status like `'ask_active'` or `'readonly'`
3. Use a boolean flag `isReadOnly`

**Decision**: We chose Option 1 (`kind` field) because:
- **Semantics**: `kind` describes **what the request is**, `status` describes **where it is in the lifecycle**. Ask is a different kind of request, not just a different lifecycle state.
- **Extensibility**: If we add more request kinds in the future (e.g., `'automation'`, `'scheduled'`), they map naturally to `kind`. Using status for this would conflate two orthogonal dimensions.
- **Status transitions**: Ask requests can still move through lifecycle states (`awaiting_clarification` → future: `'resolved'`?) independently of their kind.
- **Filtering**: Filtering by `kind` at the API layer is cleaner than filtering by status (which is used for many purposes).

**Consequences**:
- Need to filter `kind='ask'` in task list queries (done at API layer + frontend defense-in-depth)
- Need to ensure ask requests use non-`'pending'` status to avoid runner pickup

---

## Common Mistakes

### Mistake: Creating ask request with `status='pending'`

**Symptom**: Runner picks up ask request and tries to execute it (fails because no flow defined for ask)

**Cause**: Forgetting to set `status='awaiting_clarification'` when `kind='ask'`

**Fix**: In `createWorkflowRequest`, always set `status='awaiting_clarification'` when `kind='ask'`

**Prevention**: Unit test asserting `kind='ask'` → `status !== 'pending'`

### Mistake: Forgetting to filter `kind='ask'` in custom queries

**Symptom**: Ask requests appear in task list / reports / todos

**Cause**: Frontend or API bypasses the default filter and queries all requests

**Fix**: Always filter `.filter(r => r.kind !== 'ask')` when consuming `data.requests`

**Prevention**: 
- API-layer default filter in `GET /workflow-requests` (done)
- Frontend defense-in-depth filter in `data-loading.ts` (done)
- Code review checklist: "Does this query filter out ask requests?"
