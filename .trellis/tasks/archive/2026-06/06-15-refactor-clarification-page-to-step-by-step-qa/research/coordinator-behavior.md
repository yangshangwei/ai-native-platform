# Research: Coordinator Consecutive Clarification Behavior

- **Query**: How does the backend Coordinator handle consecutive clarification rounds? (new vs incremental questions, skip semantics, dynamic question order)
- **Scope**: internal (backend code + specs)
- **Date**: 2026-06-15

## Findings

### 1. Question Array Replacement Strategy

**Coordinator returns a COMPLETELY NEW questions array each time it pauses for human.**

Evidence:

- **Type definition** (`packages/shared/src/types/coordinator.ts:17-23`):
  ```typescript
  export type CoordinatorAction =
    | { action: 'proceed'; routeCase: RouteCase; runType: ...; reason: string; }
    | { action: 'pause_for_human'; questions: string[]; reason: string; }
    | { action: 'abort'; reason: string; }
  ```
  
- **Rule-based classifier** (`packages/shared/src/coordinator/rules-core.ts:74-82` for `too_short`, `:96-106` for `large_scope`):
  - Both return `{ action: 'pause_for_human', questions: [...] }` — always a full array, never appending to previous state.
  
- **Watch daemon handler** (`apps/runner/src/cmd/watch.ts:187-198`):
  ```typescript
  if (decision.decision.action === 'pause_for_human') {
    for (const q of decision.decision.questions) {
      await api.postRequestMessage({
        requestId: req.id,
        role: 'coordinator',
        content: q,
        coordinatorDecisionId: decision.id,
      });
    }
    await api.setRequestStatus({ requestId: req.id, status: 'awaiting_clarification' });
    console.log(`[runner] request ${req.id} -> awaiting_clarification (${decision.decision.questions.length} question(s))`);
    return { action: 'paused', decision };
  }
  ```
  - The runner posts **all questions in the array** to the message thread in one batch. No state tracking of "which question was already asked".

**Conclusion**: Each `pause_for_human` decision is self-contained. The questions array is not incremental — it's the full set the Coordinator wants to ask at that moment.

---

### 2. Message History Context for Dynamic Behavior

**Coordinator receives the full conversation history on each invocation and can adjust its response based on previous answers.**

Evidence:

- **Triage input interface** (`apps/runner/src/agents/coordinator/index.ts:29-43`):
  ```typescript
  export interface TriageInput {
    workflowRequestId: WorkflowRequestId;
    userRequest: string;
    messageHistory: { role: 'user' | 'coordinator'; content: string }[];
    preferredBackend?: LlmBackendKind;
    llmDeps?: LlmFallbackDeps;
  }
  ```
  
- **Watch daemon invocation** (`apps/runner/src/cmd/watch.ts:150-174`):
  ```typescript
  const { messages } = await api.listRequestMessages(req.id);
  const userRequest = messages.length > 0
    ? (messages.filter((m) => m.role === 'user').at(-1)?.content ?? req.title)
    : req.title;
  
  const decision = await triageRequest({
    workflowRequestId: req.id,
    userRequest,
    messageHistory: messages.map((m) => ({ role: m.role, content: m.content })),
    preferredBackend,
  });
  ```
  
- **LLM prompt builder** (`apps/runner/src/agents/coordinator/prompt.ts:14-28`):
  ```typescript
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
  ```

**Conclusion**: 
- Coordinator **does not maintain internal state** across rounds.
- Each triage call receives the full message history (all previous coordinator questions + user answers).
- The LLM fallback can dynamically adjust questions based on user answers.
- The rule-based path (`classifyByRulesCore`) currently does **not** use `messageHistory` — it only looks at the latest `userRequest` text. So rule-based decisions are static, but LLM fallback can be dynamic.

---

### 3. "Skip" Semantics

**No explicit "skip" handling in the Coordinator. Skip is treated as just another user message.**

Evidence:

- **No special skip keyword detection** in:
  - `packages/shared/src/coordinator/rules-core.ts` (rule-based classifier)
  - `apps/runner/src/agents/coordinator/llm-fallback.ts` (LLM fallback)
  - `apps/runner/src/agents/coordinator/decision.ts` (LLM response parser)
  
- **Message posting is content-agnostic** (`apps/web/src/routes/workflow-request-chat.ts:50-78`):
  ```typescript
  workflowRequestChat.post('/workflow-requests/:id/messages', async (c) => {
    const body = (await c.req.json()) as {
      role?: MessageRole;
      content?: string;
      coordinatorDecisionId?: string | null;
    };
    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: 'content required' }, 400);
    }
    const message: RequestMessage = {
      id: newId('msg'),
      workflowRequestId: id,
      role: body.role,
      content: body.content,  // ← No skip detection
      coordinatorDecisionId: body.coordinatorDecisionId ?? null,
      createdAt: nowIso(),
    };
    store.requestMessages.insert(message);
    return c.json(message, 201);
  });
  ```

**Behavior**: 
- If user sends "skip" or "我跳过这个问题", it goes into `messageHistory` as plain text.
- The LLM Coordinator sees it and decides how to respond (may accept and proceed, may ask again, may ask a different question).
- The rule-based classifier does **not** read message history, so it won't react to "skip" text.

**Conclusion**: "Skip" is a natural-language signal interpreted by the LLM Coordinator, not a system-level command. The rule-based path has no skip awareness.

---

### 4. Question Replacement Pattern

**When Coordinator returns the same question, it's a brand-new decision — not a state mutation.**

Evidence from clarification flow (`apps/web/test/coordinator-clarification.test.ts`):

- The test shows the frontend handles **option selection and auto-reply merging**, not question state tracking.
- Each `CoordinatorDecision` is immutable — stored separately with a unique `id` and `decidedAt` timestamp.

**Typical patterns**:

1. **User answer insufficient** → LLM Coordinator returns `pause_for_human` with the **same question** (or a rephrased variant).
   - Frontend sees a new `questions` array from a new decision.
   - No "retry counter" in the backend.

2. **User answer sufficient** → Coordinator returns `proceed` (action changes, no more questions).

3. **User answer opens new branch** → LLM Coordinator returns `pause_for_human` with a **different question**.

---

### 5. Dynamic Question Order Support

**LLM fallback: YES. Rule-based: NO.**

- **Rule-based classifier** (`packages/shared/src/coordinator/rules-core.ts`):
  - Returns fixed question templates from config (e.g., `fallbackTooShortQuestions`, `fallbackLargeScopeTemplate`).
  - Does not read `messageHistory`, so no dynamic adjustment.
  
- **LLM fallback** (`apps/runner/src/agents/coordinator/llm-fallback.ts`):
  - Sends full conversation history to the LLM.
  - LLM can choose any question order, skip questions, or follow up based on answers.
  - System prompt (from `coordinator.system_prompt` config key) governs LLM behavior — not inspected in this research, but the transport layer supports dynamic decisions.

**Conclusion**: Dynamic question order is LLM-driven, not rule-driven. The system architecture supports it (message history is always passed), but the rule-based path uses static templates.

---

## Code Pattern: Coordinator Invocation Cycle

```typescript
// 1. User submits answer → POST /workflow-requests/:id/messages { role: 'user', content: '...' }
// 2. User (or frontend auto) → PATCH /workflow-requests/:id/status { status: 'pending' }
// 3. Runner watch loop picks up pending request
// 4. Runner fetches ALL messages (coordinator + user)
const { messages } = await api.listRequestMessages(req.id);
const userRequest = messages.filter((m) => m.role === 'user').at(-1)?.content ?? req.title;

// 5. Runner calls triageRequest with FULL message history
const decision = await triageRequest({
  workflowRequestId: req.id,
  userRequest,
  messageHistory: messages.map((m) => ({ role: m.role, content: m.content })),
  preferredBackend,
});

// 6. Coordinator decides:
//    - action: 'proceed' → create WorkflowRun
//    - action: 'pause_for_human' → post decision.questions to message thread, set status = 'awaiting_clarification'
//    - action: 'abort' → set status = 'cancelled'
```

**Key insight**: The Coordinator is **stateless** — its decision depends only on the input (user request + message history). The runner's message persistence provides the "memory" across rounds.

---

## Files Found

| File Path | Description |
|---|---|
| `packages/shared/src/types/coordinator.ts` | `CoordinatorAction` type definition (proceed / pause_for_human / abort) |
| `packages/shared/src/coordinator/rules-core.ts` | Rule-based classifier (static question templates, no history awareness) |
| `apps/runner/src/agents/coordinator/index.ts` | Triage entry point (`triageRequest` function, rule + LLM fallback orchestration) |
| `apps/runner/src/agents/coordinator/llm-fallback.ts` | LLM fallback implementation (Claude Code / Codex CLI invocation with history context) |
| `apps/runner/src/agents/coordinator/prompt.ts` | User prompt builder (includes conversation history for LLM) |
| `apps/runner/src/cmd/watch.ts` | Watch daemon (`defaultTriage` — fetches messages, invokes triageRequest, posts questions) |
| `apps/api/src/routes/workflow-request-chat.ts` | Message API endpoints (POST messages, GET messages, PATCH status) |
| `.trellis/spec/api/backend/smart-router.md` | Coordinator boundary definition (clarifies Coordinator vs Router separation) |

---

## Summary for Main Agent

### Question 1: New vs Incremental Questions

**Answer**: Coordinator returns a **completely new `questions` array** each time. Not incremental. The runner posts all questions in that array to the message thread.

### Question 2: Skip Semantics

**Answer**: No explicit skip handling. If user sends "skip" / "我跳过这个问题", it's treated as plain text in the message history. The LLM Coordinator can interpret it naturally, but the rule-based classifier ignores message history entirely.

### Question 3: Dynamic Question Order

**Answer**: 
- **LLM fallback**: YES — receives full conversation history, can adjust questions dynamically.
- **Rule-based path**: NO — uses static question templates from config, does not read message history.

The system architecture supports dynamic behavior (message history is always passed), but only the LLM fallback uses it.

---

## Caveats / Not Found

- **System prompt content**: The actual LLM system prompt (config key `coordinator.system_prompt`) was not inspected. It may contain specific instructions about skip handling or question prioritization.
  
- **Historical behavior**: No multi-round clarification integration tests found. Unit tests cover single-round triage (user request → decision), but consecutive round behavior is inferred from code structure, not directly observed.

- **Frontend question queue logic**: This research focused on backend behavior. The frontend's proposed "local question queue" (PRD section "Open Questions → 方案 A") is not backend-aware — backend always returns full arrays.
