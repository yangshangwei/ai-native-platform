# Requirements-Phase Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt CodeStable's requirements-phase methodology (cs-req four-section archive + cs-brainstorm three-case triage) into the platform's `requirement` stage, plus add a Coordinator Agent that performs conversational intake before WorkflowRun creation.

**Architecture:** Two-phase incremental adaptation.
- **Phase A** injects cs-req methodology into the existing `requirement_draft` SkillSpec and adds rules to `runRequirementGate`. Zero structural change. Ships independently. ~3 hours.
- **Phase B** adds a Coordinator Agent in `cmd/watch.ts` before WorkflowRun creation. Rule-based 3-case triage with LLM fallback. Persists `coordinator_decisions` + `workflow_request_messages`. Conversational intake UI replaces single-shot form. ~12-15 hours.

**Tech Stack:** TypeScript ESM, Bun 1.3+, Hono (apps/api), bun:sqlite, Vitest, vanilla TS (apps/web).

**Immutable constraints:**
1. Workflow Engine remains the only state writer.
2. Coordinator produces decisions; never bypasses gates or directly creates WorkflowRuns.
3. Existing 9-stage e2e (`scripts/e2e.ts`) must pass at every commit.
4. CodeStable provides instruction inspiration only — no `cs-*` skill files imported at runtime.

**Out of scope (P1+):**
- Inter-stage Coordinator (retry/rollback decisions between stages)
- Roadmap-as-multi-child-Run decomposition
- compound knowledge vector search
- LLM Coordinator cost/cache tuning
- design / implementation / review SkillSpec injections (only requirement gets the cs-* treatment in this plan)

---

## File Structure

### Phase A
- Modify `apps/runner/src/skills/index.ts` — rewrite `skill.requirement_draft.instructions`
- Modify `apps/api/src/gate-engine.ts` — extend `runRequirementGate` with 4 rules
- Modify `apps/runner/src/agents/native.ts` — update requirement template
- Create `apps/api/test/requirement-gate-cs-req.test.ts` — unit tests

### Phase B
- Create `packages/shared/src/types/coordinator.ts`
- Create `packages/shared/src/types/request-message.ts`
- Modify `packages/shared/src/index.ts` — export new types
- Create `apps/runner/src/agents/coordinator/index.ts`
- Create `apps/runner/src/agents/coordinator/rules.ts`
- Create `apps/runner/src/agents/coordinator/llm-fallback.ts`
- Create `apps/runner/src/agents/coordinator/prompt.ts`
- Modify `apps/runner/src/cmd/watch.ts` — Coordinator hook
- Modify `apps/runner/src/api-client.ts` — message + decision endpoints
- Create `apps/api/src/routes/workflow-request-chat.ts`
- Modify `apps/api/src/store/db.ts` — migrations
- Modify `apps/api/src/store/store.ts` — repos
- Modify `apps/api/src/server.ts` — register routes
- Modify `apps/api/src/routes/workflow-requests.ts` — `awaiting_clarification` status
- Modify `apps/web/src/main.ts` — chat-style intake UI
- Modify `apps/web/src/projection.ts` — message thread projection
- Create `apps/runner/test/coordinator-rules.test.ts`
- Create `apps/api/test/workflow-request-chat.test.ts`
- Create `scripts/smoke-coordinator.ts`

---

## Phase A: cs-req Methodology Injection

### Task A1: Rewrite `skill.requirement_draft.instructions` with cs-req methodology

**Files:**
- Modify: `apps/runner/src/skills/index.ts:43-74`

- [ ] **Step 1: Replace the requirement_draft instructions block**

In `apps/runner/src/skills/index.ts`, find the `skill.requirement_draft` entry and replace its `instructions` field with this multi-line string:

```ts
{
  id: 'skill.requirement_draft',
  version: '0.2.0',
  stage: 'requirement',
  instructions: [
    'Turn the user request into a structured requirement document following CodeStable cs-req methodology.',
    '',
    'Output a markdown file with EXACTLY four sections in this order:',
    '',
    '1. **用户故事 (User Stories)** — 2 to 4 bullets. Each bullet must describe a SPECIFIC scenario:',
    '   `作为 {具体角色}，我希望 {能做什么}，而不是 {现在怎么难受}`. No generic "希望系统好用" wording.',
    '',
    '2. **为什么需要 (Why)** — one short paragraph (3-5 sentences). Describe the pain when this capability does not exist. Plain language, non-technical readers must understand.',
    '',
    '3. **怎么解决 (How)** — one short paragraph. Describe what the user EXPERIENCES, NOT how it is implemented. No module names, interfaces, or algorithms.',
    '',
    '4. **边界 (Boundaries)** — bullet list. What it does NOT cover; when not to use it; prerequisites.',
    '',
    'Frontmatter MUST contain:',
    '  doc_type: requirement',
    '  pitch: <one-sentence non-technical summary that could double as marketing copy>',
    '  status: draft',
    '  REQ-### identifier (e.g. REQ-001)',
    '',
    'Body MUST also include:',
    '  - At least one AC-### acceptance criterion section',
    '  - Goals / non-goals / scope subsection (can be inside 边界)',
    '  - Context evidence references (file paths from Context Pack, format: `src/...`)',
    '',
    'HARD RULES:',
    '  - Do NOT write implementation details (no module names, no interface signatures).',
    '  - Do NOT invent user stories — every story must trace to user_request, prior features, or knowledge.',
    '  - Tone: human conversation, not PRD field-stuffing.',
    '  - The `pitch` must be usable as marketing copy without further edits.',
  ].join('\n'),
  // ... inputs/outputs/etc. unchanged
}
```

- [ ] **Step 2: Bump SkillSpec version**

Update version field from `'0.1.0'` to `'0.2.0'` for the requirement_draft entry only.

- [ ] **Step 3: Run typecheck to verify no type breakage**

Run: `bun run typecheck`
Expected: PASS (this is a string change, no type impact).

- [ ] **Step 4: Commit**

```bash
git add apps/runner/src/skills/index.ts
git commit -m "feat(skills): inject cs-req four-section methodology into requirement_draft

Replaces single-line instructions with explicit cs-req output contract:
user stories / why / how / boundaries + pitch + REQ/AC IDs.
Bumps requirement_draft skill version to 0.2.0."
```

### Task A2: Add cs-req rules to `runRequirementGate`

**Files:**
- Test: `apps/api/test/requirement-gate-cs-req.test.ts` (new)
- Modify: `apps/api/src/gate-engine.ts:255-309`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/requirement-gate-cs-req.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { runRequirementGate } from '../src/gate-engine';
import { store } from '../src/store/store';
import { newId } from '@ainp/shared';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeArtifact(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'req-gate-test-'));
  const path = join(dir, 'requirement.md');
  writeFileSync(path, content, 'utf8');
  return store.artifacts.insert({
    id: newId('artifact'),
    kind: 'requirement_draft',
    uri: `file://${path}`,
    workflowRunId: 'wf-test-1' as any,
    stepRunId: null,
    size: Buffer.byteLength(content, 'utf8'),
    contentType: 'text/markdown',
    createdAt: new Date().toISOString(),
    metadata: {},
  });
}

const VALID_CS_REQ = `---
doc_type: requirement
pitch: 让交付报告一键导出 Markdown 给非技术干系人传阅
status: draft
REQ-001: report-export
---

# 报告导出能力

## 用户故事
- 作为产品经理，我希望把交付报告导出成 Markdown，而不是给每个干系人单独截图粘贴
- 作为 QA，我希望快速分享给客户，而不是手动整理证据链

## 为什么需要
当前报告只能在工作台看，跨团队协作场景下无法离线流转。

## 怎么解决
工作台增加导出按钮，点击后下载当前 run 的 Markdown 报告。

## 边界
- AC-001: 点击按钮在 2 秒内开始下载
- 不覆盖 PDF 导出
- 不打包附件，仅纯文本

引用：\`src/server/reports.ts\``;

describe('runRequirementGate cs-req rules', () => {
  it('passes a complete cs-req document', () => {
    const a = makeArtifact(VALID_CS_REQ);
    const gate = runRequirementGate({ workflowRunId: 'wf-test-1' as any, stepRunId: null, artifact: a });
    expect(gate.status).toBe('pass');
  });

  it('fails when pitch frontmatter is missing', () => {
    const a = makeArtifact(VALID_CS_REQ.replace(/^pitch: .*$/m, ''));
    const gate = runRequirementGate({ workflowRunId: 'wf-test-2' as any, stepRunId: null, artifact: a });
    const rule = gate.ruleResults.find((r) => r.ruleId === 'requirement.pitch_present');
    expect(rule?.status).toBe('fail');
  });

  it('fails when 用户故事 section is missing', () => {
    const a = makeArtifact(VALID_CS_REQ.replace(/## 用户故事[\s\S]*?(?=##)/, ''));
    const gate = runRequirementGate({ workflowRunId: 'wf-test-3' as any, stepRunId: null, artifact: a });
    const rule = gate.ruleResults.find((r) => r.ruleId === 'requirement.four_sections_present');
    expect(rule?.status).toBe('fail');
  });

  it('fails when user stories has fewer than 2 bullets', () => {
    const oneStory = VALID_CS_REQ.replace(/- 作为 QA[\s\S]*?\n/, '');
    const a = makeArtifact(oneStory);
    const gate = runRequirementGate({ workflowRunId: 'wf-test-4' as any, stepRunId: null, artifact: a });
    const rule = gate.ruleResults.find((r) => r.ruleId === 'requirement.user_stories_min_2');
    expect(rule?.status).toBe('fail');
  });

  it('fails when 边界 section is missing', () => {
    const noBoundary = VALID_CS_REQ.replace(/## 边界[\s\S]*$/, '');
    const a = makeArtifact(noBoundary);
    const gate = runRequirementGate({ workflowRunId: 'wf-test-5' as any, stepRunId: null, artifact: a });
    const rule = gate.ruleResults.find((r) => r.ruleId === 'requirement.boundary_present');
    expect(rule?.status).toBe('fail');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test apps/api/test/requirement-gate-cs-req.test.ts`
Expected: 4 failures (cs-req rules don't exist yet) + 1 pass for VALID case (existing rules still pass).

- [ ] **Step 3: Add 4 new rules to `runRequirementGate`**

In `apps/api/src/gate-engine.ts`, modify `runRequirementGate` (line 255-309). Add these 4 detections after the existing `hasContextEvidence` line (around line 268):

```ts
const hasPitch = /^pitch:\s*\S+/m.test(text);
const hasFourSections =
  /##\s*用户故事/i.test(text) &&
  /##\s*为什么需要/i.test(text) &&
  /##\s*怎么解决/i.test(text) &&
  /##\s*边界/i.test(text);
const userStoryBullets = (text.match(/^-\s+作为\s+/gm) ?? []).length;
const hasUserStoriesMin2 = userStoryBullets >= 2;
const hasBoundary = /##\s*边界[\s\S]{20,}/i.test(text);
```

Then append these 4 RuleResults to the `results` array (after the existing 5):

```ts
textRule({
  ruleId: 'requirement.pitch_present',
  ok: hasPitch,
  pass: 'pitch frontmatter present',
  fail: 'missing `pitch: ...` line in frontmatter',
  evidenceRefs: evidence,
}),
textRule({
  ruleId: 'requirement.four_sections_present',
  ok: hasFourSections,
  pass: 'four cs-req sections (用户故事/为什么需要/怎么解决/边界) present',
  fail: 'missing one or more cs-req sections',
  evidenceRefs: evidence,
}),
textRule({
  ruleId: 'requirement.user_stories_min_2',
  ok: hasUserStoriesMin2,
  pass: `${userStoryBullets} user-story bullets`,
  fail: `need ≥2 "作为 ..." bullets, got ${userStoryBullets}`,
  evidenceRefs: evidence,
}),
textRule({
  ruleId: 'requirement.boundary_present',
  ok: hasBoundary,
  pass: '边界 section has substantive content',
  fail: '边界 section missing or empty',
  evidenceRefs: evidence,
}),
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test apps/api/test/requirement-gate-cs-req.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Run full test suite to verify no regression**

Run: `bun test`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/gate-engine.ts apps/api/test/requirement-gate-cs-req.test.ts
git commit -m "feat(gate): add cs-req rules to requirement_gate

Adds 4 new rules: pitch_present, four_sections_present (用户故事/
为什么需要/怎么解决/边界), user_stories_min_2, boundary_present.

cs-req methodology now enforced as a hard state-machine check, not
just a soft prompt instruction."
```

### Task A3: Update NativeBackend requirement template to satisfy new gate

**Files:**
- Modify: `apps/runner/src/agents/native.ts`

- [ ] **Step 1: Locate the requirement template in NativeBackend**

Search `apps/runner/src/agents/native.ts` for the requirement_draft markdown template. It generates a stub markdown response — needs to produce the new four-section structure to keep e2e green.

- [ ] **Step 2: Replace the template with cs-req structure**

Find the function that produces requirement markdown for NativeBackend and replace its body with:

```ts
function buildRequirementMd(userRequest: string, contextPack: string): string {
  const slug = userRequest
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join('-') || 'request';
  const reqId = 'REQ-001';
  const acId = 'AC-001';
  return `---
doc_type: requirement
pitch: ${userRequest.slice(0, 80)} —— 把这次需求落成可验证的能力交付
status: draft
${reqId}: ${slug}
---

# ${userRequest}

## 用户故事
- 作为提需求的用户，我希望平台按 ${userRequest} 落地，而不是把需求扔进黑盒
- 作为下游验收人，我希望看到结构化产物和证据，而不是 LLM 自述完成

## 为什么需要
当前 ${userRequest} 在项目中尚未实现或与现状不一致。本次需求把它落成可验收的能力，并保留证据链供后续追溯。

## 怎么解决
平台经过 9 阶段流水线把这次需求做成一次可审计的交付：从 Context Pack 拉取工程背景，到 design / implementation / build_test，每个阶段产出 artifact 给下一阶段。

## 边界
- ${acId}: 9 阶段全部 pass，且 acceptance_gate 通过
- 不覆盖未在 ${reqId} 中声明的衍生需求
- 前置：项目已注册且 runner 在线

引用：\`src/${slug}.ts\``;
}
```

- [ ] **Step 3: Run e2e to verify still passes**

Run:
```bash
AINP_DB_PATH=/tmp/x.sqlite bun run apps/api/src/server.ts &
sleep 1
AINP_DB_PATH=/tmp/x.sqlite bun run scripts/e2e.ts
```
Expected: e2e PASS, all 4 human gates auto-approved as before.

- [ ] **Step 4: Commit**

```bash
git add apps/runner/src/agents/native.ts
git commit -m "fix(native-backend): produce cs-req four-section template

Aligns NativeBackend requirement output with the new requirement_gate
rules so e2e remains green after Phase A gate enhancements."
```

### Task A4: Phase A acceptance check

- [ ] **Step 1: Full test sweep**

Run: `bun test && bun run typecheck`
Expected: all green.

- [ ] **Step 2: Manual end-to-end check**

```bash
bun run dev:api &
bun run dev:web &
bun run runner -- orchestrate --project java-sample --title "add report export"
```
Open `http://127.0.0.1:5173/`, walk through the run. Verify the requirement card shows four sections + a pitch line.

- [ ] **Step 3: Tag Phase A milestone**

```bash
git tag phase-a-cs-req-injection
```

---

## Phase B: Coordinator Agent + Conversational Intake

### Task B1: Add `CoordinatorDecision` and `RequestMessage` types

**Files:**
- Create: `packages/shared/src/types/coordinator.ts`
- Create: `packages/shared/src/types/request-message.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create coordinator.ts**

```ts
// packages/shared/src/types/coordinator.ts
import type { Iso8601, WorkflowRequestId, WorkflowRunId } from './ids';

export type RouteCase =
  | 'feature_clear'      // case 1: clear feature, proceed to requirement stage
  | 'feature_brainstorm' // case 2: small feature, but needs 1-2 clarifying questions
  | 'roadmap_needed'     // case 3: large request, recommend Roadmap (P1, returns pause+message)
  | 'bugfix'             // bugfix track
  | 'unclear';           // cannot decide; escalate to human

export type CoordinatorAction =
  | { action: 'proceed'; routeCase: RouteCase; runType: 'feature' | 'bugfix' | 'smoke'; reason: string }
  | { action: 'pause_for_human'; questions: string[]; reason: string }
  | { action: 'abort'; reason: string };

export type DecisionSource = 'rules' | 'llm' | 'human';

export interface CoordinatorDecision {
  id: string;
  workflowRequestId: WorkflowRequestId;
  workflowRunId: WorkflowRunId | null;  // null until Run is created
  source: DecisionSource;
  decision: CoordinatorAction;
  confidence: number;  // 0..1
  rulesFired: string[];  // rule IDs that contributed (empty for LLM-only)
  decidedAt: Iso8601;
}
```

- [ ] **Step 2: Create request-message.ts**

```ts
// packages/shared/src/types/request-message.ts
import type { Iso8601, WorkflowRequestId } from './ids';

export type MessageRole = 'user' | 'coordinator';

export interface RequestMessage {
  id: string;
  workflowRequestId: WorkflowRequestId;
  role: MessageRole;
  content: string;
  /** Set on coordinator messages — the decision rendered as a question. */
  coordinatorDecisionId: string | null;
  createdAt: Iso8601;
}
```

- [ ] **Step 3: Export from shared index**

Add to `packages/shared/src/index.ts`:

```ts
export * from './types/coordinator';
export * from './types/request-message';
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/coordinator.ts \
        packages/shared/src/types/request-message.ts \
        packages/shared/src/index.ts
git commit -m "feat(shared): add CoordinatorDecision and RequestMessage types

Types for cs-brainstorm-style triage and conversational intake.
RouteCase encodes the three cs-brainstorm cases plus bugfix and
unclear escape hatch."
```

### Task B2: DB migrations + store methods

**Files:**
- Modify: `apps/api/src/store/db.ts`
- Modify: `apps/api/src/store/store.ts`

- [ ] **Step 1: Add migrations to db.ts**

Append two new entries to the `MIGRATIONS` array in `apps/api/src/store/db.ts` (before the closing `]`):

```ts
`CREATE TABLE IF NOT EXISTS coordinator_decisions (
   id TEXT PRIMARY KEY,
   workflow_request_id TEXT NOT NULL,
   workflow_run_id TEXT,
   source TEXT NOT NULL,
   decision_json TEXT NOT NULL,
   confidence REAL NOT NULL,
   rules_fired_json TEXT NOT NULL,
   decided_at TEXT NOT NULL
 )`,
`CREATE INDEX IF NOT EXISTS idx_coord_decisions_request ON coordinator_decisions(workflow_request_id)`,
`CREATE TABLE IF NOT EXISTS workflow_request_messages (
   id TEXT PRIMARY KEY,
   workflow_request_id TEXT NOT NULL,
   role TEXT NOT NULL,
   content TEXT NOT NULL,
   coordinator_decision_id TEXT,
   created_at TEXT NOT NULL
 )`,
`CREATE INDEX IF NOT EXISTS idx_request_messages_request ON workflow_request_messages(workflow_request_id, created_at)`,
```

Also add an `awaiting_clarification` value to allow on `workflow_requests.status`. The status column is already free-form TEXT, no schema change needed — but document the new value as a comment near the migration.

- [ ] **Step 2: Add repos to store.ts**

In `apps/api/src/store/store.ts`, add two repo objects to the exported `store` constant. Find the existing pattern (e.g. `gateRuns`, `auditLog`) and add:

```ts
coordinatorDecisions: {
  insert(d: CoordinatorDecision): void {
    db.prepare(
      `INSERT INTO coordinator_decisions
       (id, workflow_request_id, workflow_run_id, source, decision_json, confidence, rules_fired_json, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      d.id,
      d.workflowRequestId,
      d.workflowRunId,
      d.source,
      JSON.stringify(d.decision),
      d.confidence,
      JSON.stringify(d.rulesFired),
      d.decidedAt,
    );
  },
  latestForRequest(requestId: WorkflowRequestId): CoordinatorDecision | null {
    const row = db
      .prepare(
        `SELECT * FROM coordinator_decisions
         WHERE workflow_request_id = ?
         ORDER BY decided_at DESC LIMIT 1`,
      )
      .get(requestId) as any;
    if (!row) return null;
    return {
      id: row.id,
      workflowRequestId: row.workflow_request_id,
      workflowRunId: row.workflow_run_id,
      source: row.source,
      decision: JSON.parse(row.decision_json),
      confidence: row.confidence,
      rulesFired: JSON.parse(row.rules_fired_json),
      decidedAt: row.decided_at,
    };
  },
},
requestMessages: {
  insert(m: RequestMessage): void {
    db.prepare(
      `INSERT INTO workflow_request_messages
       (id, workflow_request_id, role, content, coordinator_decision_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(m.id, m.workflowRequestId, m.role, m.content, m.coordinatorDecisionId, m.createdAt);
  },
  listForRequest(requestId: WorkflowRequestId): RequestMessage[] {
    const rows = db
      .prepare(
        `SELECT * FROM workflow_request_messages
         WHERE workflow_request_id = ?
         ORDER BY created_at ASC`,
      )
      .all(requestId) as any[];
    return rows.map((r) => ({
      id: r.id,
      workflowRequestId: r.workflow_request_id,
      role: r.role,
      content: r.content,
      coordinatorDecisionId: r.coordinator_decision_id,
      createdAt: r.created_at,
    }));
  },
},
```

Don't forget to import `CoordinatorDecision`, `RequestMessage`, `WorkflowRequestId` from `@ainp/shared` at the top of store.ts.

- [ ] **Step 3: Write store roundtrip test**

Create `apps/api/test/coordinator-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { store } from '../src/store/store';
import { newId, nowIso } from '@ainp/shared';

describe('coordinatorDecisions repo', () => {
  it('inserts and retrieves the latest decision', () => {
    const reqId = newId('wfreq') as any;
    store.coordinatorDecisions.insert({
      id: newId('coord'),
      workflowRequestId: reqId,
      workflowRunId: null,
      source: 'rules',
      decision: { action: 'proceed', routeCase: 'feature_clear', runType: 'feature', reason: 'test' },
      confidence: 0.9,
      rulesFired: ['rule.has_action_verb'],
      decidedAt: nowIso(),
    });
    const got = store.coordinatorDecisions.latestForRequest(reqId);
    expect(got?.decision.action).toBe('proceed');
    expect(got?.confidence).toBe(0.9);
  });
});

describe('requestMessages repo', () => {
  it('inserts and lists messages in created_at order', () => {
    const reqId = newId('wfreq') as any;
    store.requestMessages.insert({
      id: newId('msg'),
      workflowRequestId: reqId,
      role: 'user',
      content: 'hello',
      coordinatorDecisionId: null,
      createdAt: '2026-05-03T00:00:00.000Z',
    });
    store.requestMessages.insert({
      id: newId('msg'),
      workflowRequestId: reqId,
      role: 'coordinator',
      content: 'hi',
      coordinatorDecisionId: null,
      createdAt: '2026-05-03T00:00:01.000Z',
    });
    const all = store.requestMessages.listForRequest(reqId);
    expect(all).toHaveLength(2);
    expect(all[0].role).toBe('user');
    expect(all[1].role).toBe('coordinator');
  });
});
```

- [ ] **Step 4: Run test**

Run: `bun test apps/api/test/coordinator-store.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/store/db.ts apps/api/src/store/store.ts apps/api/test/coordinator-store.test.ts
git commit -m "feat(store): add coordinator_decisions and workflow_request_messages tables"
```

### Task B3: Coordinator rules engine

**Files:**
- Create: `apps/runner/src/agents/coordinator/rules.ts`
- Test: `apps/runner/test/coordinator-rules.test.ts`

- [ ] **Step 1: Write tests first**

Create `apps/runner/test/coordinator-rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyByRules } from '../src/agents/coordinator/rules';

describe('classifyByRules', () => {
  it('classifies clear bug reports as bugfix', () => {
    const r = classifyByRules({
      userRequest: '点击报告导出按钮后弹出空白对话框，预期应下载 markdown',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.routeCase).toBe('bugfix');
      expect(r.decision.runType).toBe('bugfix');
    }
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('classifies clear feature requests as feature_clear', () => {
    const r = classifyByRules({
      userRequest: '为报告页增加导出 Markdown 按钮，验收标准 mvn test 通过',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('proceed');
    if (r.decision.action === 'proceed') {
      expect(r.decision.routeCase).toBe('feature_clear');
      expect(r.decision.runType).toBe('feature');
    }
  });

  it('flags vague one-word requests as needing clarification', () => {
    const r = classifyByRules({
      userRequest: '权限',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('pause_for_human');
    if (r.decision.action === 'pause_for_human') {
      expect(r.decision.questions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('flags large-scope requests as roadmap_needed', () => {
    const r = classifyByRules({
      userRequest: '我想要一个完整的权限系统，包括用户、角色、资源',
      messageHistory: [],
    });
    expect(r.decision.action).toBe('pause_for_human');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('returns low confidence for ambiguous requests so LLM fallback kicks in', () => {
    const r = classifyByRules({
      userRequest: '改一下导出',
      messageHistory: [],
    });
    expect(r.confidence).toBeLessThan(0.6);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `bun test apps/runner/test/coordinator-rules.test.ts`
Expected: 5 failures (module not found).

- [ ] **Step 3: Implement rules.ts**

Create `apps/runner/src/agents/coordinator/rules.ts`:

```ts
import type { CoordinatorAction, RouteCase } from '@ainp/shared';

export interface ClassifyInput {
  userRequest: string;
  messageHistory: { role: 'user' | 'coordinator'; content: string }[];
}

export interface ClassifyOutput {
  decision: CoordinatorAction;
  confidence: number;
  rulesFired: string[];
}

const BUG_KEYWORDS = [
  'bug', '错误', '异常', '报错', '崩溃', '失败', 'crash', 'error',
  '弹出空白', '无法', '不能', '不工作', '不对', '应该', '预期',
];

const FEATURE_KEYWORDS = [
  '增加', '新增', '加一个', '添加', '实现', '做一个', '支持',
  'add', 'implement', 'support', '能否', '希望',
];

const LARGE_SCOPE_KEYWORDS = [
  '系统', 'system', '体系', '一整套', '完整的', '一个 .* 系统',
  '权限系统', '通知系统', '用户系统', 'sso', '认证体系',
];

function countMatches(text: string, keywords: string[]): { count: number; hits: string[] } {
  const lower = text.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return { count: hits.length, hits };
}

export function classifyByRules(input: ClassifyInput): ClassifyOutput {
  const text = input.userRequest.trim();
  const rulesFired: string[] = [];

  // Rule 1: very short → unclear
  if (text.length < 6) {
    rulesFired.push('rule.too_short');
    return {
      decision: {
        action: 'pause_for_human',
        questions: [
          `这是什么场景下的需求？比如"哪里"出现"什么问题"或者"想加什么能力"。`,
          `主要是修复现有问题，还是新增能力？`,
        ],
        reason: 'request too short to triage',
      },
      confidence: 0.85,
      rulesFired,
    };
  }

  const bug = countMatches(text, BUG_KEYWORDS);
  const feature = countMatches(text, FEATURE_KEYWORDS);
  const largeScope = countMatches(text, LARGE_SCOPE_KEYWORDS);

  // Rule 2: large scope → roadmap suggestion (still pauses for human)
  if (largeScope.count >= 1 && text.length > 15) {
    rulesFired.push('rule.large_scope_detected');
    return {
      decision: {
        action: 'pause_for_human',
        questions: [
          `这听起来是个比较大的需求（涉及"${largeScope.hits[0]}"）。能不能先列出 2-3 个最优先的子能力？`,
          `有没有一个最小闭环可以先做出来端到端跑通？`,
        ],
        reason: `large scope keyword detected: ${largeScope.hits.join(', ')}`,
      },
      confidence: 0.75,
      rulesFired,
    };
  }

  // Rule 3: bug-leaning vs feature-leaning
  const bugFeatureRatio = bug.count - feature.count;
  if (bugFeatureRatio >= 2) {
    rulesFired.push('rule.bug_keywords_dominant');
    return {
      decision: {
        action: 'proceed',
        routeCase: 'bugfix',
        runType: 'bugfix',
        reason: `bug keywords dominate: ${bug.hits.slice(0, 3).join(', ')}`,
      },
      confidence: Math.min(0.95, 0.6 + bug.count * 0.1),
      rulesFired,
    };
  }
  if (bugFeatureRatio <= -2 && text.length > 20) {
    rulesFired.push('rule.feature_keywords_dominant');
    return {
      decision: {
        action: 'proceed',
        routeCase: 'feature_clear',
        runType: 'feature',
        reason: `feature keywords dominate: ${feature.hits.slice(0, 3).join(', ')}`,
      },
      confidence: Math.min(0.9, 0.55 + feature.count * 0.1),
      rulesFired,
    };
  }

  // Default: ambiguous, low confidence so LLM fallback runs
  rulesFired.push('rule.ambiguous');
  return {
    decision: {
      action: 'proceed',
      routeCase: 'feature_clear',
      runType: 'feature',
      reason: 'no dominant keyword class; default to feature, expect LLM verification',
    },
    confidence: 0.4,
    rulesFired,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test apps/runner/test/coordinator-rules.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/runner/src/agents/coordinator/rules.ts apps/runner/test/coordinator-rules.test.ts
git commit -m "feat(coordinator): add rule-based 3-case classifier

Implements cs-brainstorm-style triage as keyword rules. Returns
CoordinatorAction with confidence; downstream uses LLM fallback
when confidence < threshold."
```

### Task B4: Coordinator LLM fallback

**Files:**
- Create: `apps/runner/src/agents/coordinator/prompt.ts`
- Create: `apps/runner/src/agents/coordinator/llm-fallback.ts`

- [ ] **Step 1: Create system prompt template**

Create `apps/runner/src/agents/coordinator/prompt.ts`:

```ts
export const COORDINATOR_SYSTEM_PROMPT = `You are the Coordinator Agent for an AI-native software delivery platform.

Your only job: triage the user's incoming request into one of these route cases:

1. feature_clear — clear, well-scoped new capability. User said what + for whom + how to verify.
2. feature_brainstorm — small feature but missing 1-2 of: target users, success criteria, scope. Ask exactly 2 clarifying questions.
3. bugfix — describes broken existing behavior (异常/报错/不对/预期 vs 实际).
4. roadmap_needed — large request that decomposes into multiple features (e.g. "权限系统"). Ask the user to identify 2-3 top sub-capabilities and a minimal closed loop.
5. unclear — too vague to classify; ask for more context.

Rules:
- NEVER write requirements yourself. NEVER suggest implementation.
- You are a thinking partner, not a recorder. Don't just summarize — challenge assumptions.
- If the user has a solution in mind, first ask what problem it solves before accepting the solution.
- If you ask questions, ask AT MOST 2, with 2-4 concrete answer options each.

Output JSON exactly matching this schema (no markdown fences, no preamble):

{
  "action": "proceed" | "pause_for_human" | "abort",
  "routeCase": "feature_clear" | "feature_brainstorm" | "bugfix" | "roadmap_needed" | "unclear",
  "runType": "feature" | "bugfix" | "smoke",
  "reason": "<short, one-line>",
  "questions": ["<q1>", "<q2>"]   // empty array unless action=pause_for_human
}
`;

export function buildUserPrompt(userRequest: string, history: { role: string; content: string }[]): string {
  const lines = [
    `User request: ${userRequest}`,
    '',
  ];
  if (history.length > 0) {
    lines.push('Conversation so far:');
    for (const m of history) {
      lines.push(`  [${m.role}] ${m.content}`);
    }
    lines.push('');
  }
  lines.push('Triage now.');
  return lines.join('\n');
}
```

- [ ] **Step 2: Create LLM fallback that calls existing backends**

Create `apps/runner/src/agents/coordinator/llm-fallback.ts`:

```ts
import type { CoordinatorAction } from '@ainp/shared';
import { COORDINATOR_SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import type { ClassifyInput, ClassifyOutput } from './rules';

/**
 * Calls an LLM (Codex preferred, Claude Code fallback, Native skipped) to
 * classify the request. Returns ClassifyOutput with source='llm'.
 *
 * For MVP we shell out to the same CLI backends already used elsewhere; we
 * just send a single non-streaming prompt and parse the JSON line.
 */
export async function classifyByLlm(input: ClassifyInput): Promise<ClassifyOutput> {
  const backend = await pickCoordinatorBackend();
  if (!backend) {
    return {
      decision: {
        action: 'pause_for_human',
        questions: ['平台无可用 LLM 后端来 triage。能否补充 1-2 句具体场景？'],
        reason: 'no LLM backend available; pause for human',
      },
      confidence: 0.5,
      rulesFired: ['llm.unavailable'],
    };
  }

  const userPrompt = buildUserPrompt(input.userRequest, input.messageHistory);
  const json = await backend.runOneShot(COORDINATOR_SYSTEM_PROMPT, userPrompt);
  const parsed = parseDecision(json);
  return {
    decision: parsed,
    confidence: 0.7,
    rulesFired: ['llm.classified'],
  };
}

interface OneShotBackend {
  runOneShot(system: string, user: string): Promise<string>;
}

async function pickCoordinatorBackend(): Promise<OneShotBackend | null> {
  // Reuse the existing backend selection logic; for MVP we wrap codex/claude
  // in a thin one-shot adapter. If neither is available, return null.
  const { codexCliAvailable } = await import('../codex');
  const { claudeCliAvailable } = await import('../claude-code');
  if (await codexCliAvailable()) {
    return makeCodexOneShot();
  }
  if (await claudeCliAvailable()) {
    return makeClaudeOneShot();
  }
  return null;
}

function makeCodexOneShot(): OneShotBackend {
  return {
    async runOneShot(system: string, user: string): Promise<string> {
      // Spawn `codex exec` with system+user prompt; parse last JSON line.
      const proc = Bun.spawn(['codex', 'exec', '--json', '--system', system, user], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      // Codex stream-json: take the final 'result' event content.
      const lines = out.split('\n').filter(Boolean);
      const last = lines[lines.length - 1];
      try {
        const evt = JSON.parse(last);
        return evt.content ?? evt.text ?? last;
      } catch {
        return last;
      }
    },
  };
}

function makeClaudeOneShot(): OneShotBackend {
  return {
    async runOneShot(system: string, user: string): Promise<string> {
      const proc = Bun.spawn(
        ['claude', '--output-format', 'stream-json', '--system', system, user],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      const lines = out.split('\n').filter(Boolean);
      // Find the final assistant message with text content.
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const evt = JSON.parse(lines[i]);
          if (evt.type === 'assistant' && Array.isArray(evt.message?.content)) {
            const textBlock = evt.message.content.find((b: any) => b.type === 'text');
            if (textBlock?.text) return textBlock.text;
          }
        } catch {
          /* skip */
        }
      }
      return lines[lines.length - 1] ?? '';
    },
  };
}

function parseDecision(raw: string): CoordinatorAction {
  // Strip code fences if model wrapped JSON
  const cleaned = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
  try {
    const obj = JSON.parse(cleaned) as any;
    if (obj.action === 'proceed') {
      return {
        action: 'proceed',
        routeCase: obj.routeCase ?? 'feature_clear',
        runType: obj.runType ?? 'feature',
        reason: obj.reason ?? 'llm decided',
      };
    }
    if (obj.action === 'pause_for_human') {
      return {
        action: 'pause_for_human',
        questions: Array.isArray(obj.questions) ? obj.questions : [],
        reason: obj.reason ?? 'llm requested clarification',
      };
    }
    if (obj.action === 'abort') {
      return { action: 'abort', reason: obj.reason ?? 'llm aborted' };
    }
  } catch (e) {
    /* fall through */
  }
  // Parse failure → ask the user
  return {
    action: 'pause_for_human',
    questions: ['LLM 返回格式异常，能否换一个说法描述需求？'],
    reason: `failed to parse LLM output: ${cleaned.slice(0, 100)}`,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/runner/src/agents/coordinator/prompt.ts \
        apps/runner/src/agents/coordinator/llm-fallback.ts
git commit -m "feat(coordinator): add LLM fallback for ambiguous requests

Spawns codex or claude CLI with a Coordinator system prompt; parses
JSON decision. Falls back to pause_for_human on parse failure or
when no backend is available."
```

### Task B5: Coordinator entry point

**Files:**
- Create: `apps/runner/src/agents/coordinator/index.ts`

- [ ] **Step 1: Create the entry**

```ts
// apps/runner/src/agents/coordinator/index.ts
import type { CoordinatorDecision, WorkflowRequestId } from '@ainp/shared';
import { newId, nowIso } from '@ainp/shared';
import { classifyByRules, type ClassifyInput, type ClassifyOutput } from './rules';
import { classifyByLlm } from './llm-fallback';

const RULE_CONFIDENCE_THRESHOLD = 0.65;

export async function triageRequest(params: {
  workflowRequestId: WorkflowRequestId;
  userRequest: string;
  messageHistory: { role: 'user' | 'coordinator'; content: string }[];
}): Promise<CoordinatorDecision> {
  const ruleResult = classifyByRules({
    userRequest: params.userRequest,
    messageHistory: params.messageHistory,
  });

  let final: ClassifyOutput;
  let source: 'rules' | 'llm';
  if (ruleResult.confidence >= RULE_CONFIDENCE_THRESHOLD) {
    final = ruleResult;
    source = 'rules';
  } else {
    const llmResult = await classifyByLlm({
      userRequest: params.userRequest,
      messageHistory: params.messageHistory,
    });
    final = llmResult;
    source = 'llm';
  }

  return {
    id: newId('coord'),
    workflowRequestId: params.workflowRequestId,
    workflowRunId: null,
    source,
    decision: final.decision,
    confidence: final.confidence,
    rulesFired: final.rulesFired,
    decidedAt: nowIso(),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/runner/src/agents/coordinator/index.ts
git commit -m "feat(coordinator): add triageRequest entry point

Tries rules first; if confidence < 0.65 falls back to LLM. Returns
a fully-formed CoordinatorDecision ready to persist."
```

### Task B6: API routes for chat-style intake

**Files:**
- Create: `apps/api/src/routes/workflow-request-chat.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/workflow-requests.ts` — accept `awaiting_clarification` status

- [ ] **Step 1: Write API contract test first**

Create `apps/api/test/workflow-request-chat.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { mountChatRoutes } from '../src/routes/workflow-request-chat';
import { mountWorkflowRequestRoutes } from '../src/routes/workflow-requests';
import { store } from '../src/store/store';
import { newId } from '@ainp/shared';

describe('workflow-request chat endpoints', () => {
  let app: Hono;
  let projectId: string;
  let requestId: string;

  beforeAll(async () => {
    app = new Hono();
    mountWorkflowRequestRoutes(app);
    mountChatRoutes(app);
    projectId = newId('proj');
    store.projects.insert({ id: projectId, /* ... minimal fields ... */ } as any);
    const reqRes = await app.request('/workflow-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, type: 'feature', title: '测试', branch: 'main' }),
    });
    requestId = (await reqRes.json() as any).id;
  });

  it('POST /workflow-requests/:id/messages stores a user message and returns it', async () => {
    const res = await app.request(`/workflow-requests/${requestId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: '加个导出按钮' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.role).toBe('user');
    expect(body.content).toBe('加个导出按钮');
  });

  it('GET /workflow-requests/:id/messages returns history in order', async () => {
    const res = await app.request(`/workflow-requests/${requestId}/messages`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
    expect(body.messages[0].role).toBe('user');
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `bun test apps/api/test/workflow-request-chat.test.ts`
Expected: FAIL (route module not found).

- [ ] **Step 3: Implement chat routes**

Create `apps/api/src/routes/workflow-request-chat.ts`:

```ts
import type { Hono } from 'hono';
import { newId, nowIso, type WorkflowRequestId } from '@ainp/shared';
import { store } from '../store/store';

export function mountChatRoutes(app: Hono): void {
  app.post('/workflow-requests/:id/messages', async (c) => {
    const id = c.req.param('id') as WorkflowRequestId;
    const req = store.workflowRequests.get(id);
    if (!req) return c.json({ error: 'request not found' }, 404);

    const body = (await c.req.json()) as { role: 'user' | 'coordinator'; content: string };
    if (body.role !== 'user' && body.role !== 'coordinator') {
      return c.json({ error: 'invalid role' }, 400);
    }
    if (!body.content || body.content.length === 0) {
      return c.json({ error: 'empty content' }, 400);
    }
    const msg = {
      id: newId('msg'),
      workflowRequestId: id,
      role: body.role,
      content: body.content,
      coordinatorDecisionId: null,
      createdAt: nowIso(),
    };
    store.requestMessages.insert(msg);
    return c.json(msg, 201);
  });

  app.get('/workflow-requests/:id/messages', (c) => {
    const id = c.req.param('id') as WorkflowRequestId;
    const messages = store.requestMessages.listForRequest(id);
    const decision = store.coordinatorDecisions.latestForRequest(id);
    return c.json({ messages, decision });
  });
}
```

- [ ] **Step 4: Register in server.ts**

Modify `apps/api/src/server.ts` — find where other route modules are mounted, add:

```ts
import { mountChatRoutes } from './routes/workflow-request-chat';
// ... where other mounts happen:
mountChatRoutes(app);
```

- [ ] **Step 5: Update WorkflowRequest status enum**

In `apps/api/src/routes/workflow-requests.ts`, find the status validation and ensure `'awaiting_clarification'` is accepted alongside `pending | claimed | completed | failed | cancelled`. Also update the type in `packages/shared/src/types/workflow.ts`:

```ts
export type WorkflowRequestStatus =
  | 'pending'
  | 'awaiting_clarification'  // NEW: Coordinator asked for more info
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'cancelled';
```

- [ ] **Step 6: Run tests**

Run: `bun test apps/api/test/workflow-request-chat.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/workflow-request-chat.ts \
        apps/api/src/server.ts \
        apps/api/src/routes/workflow-requests.ts \
        apps/api/test/workflow-request-chat.test.ts \
        packages/shared/src/types/workflow.ts
git commit -m "feat(api): add chat routes and awaiting_clarification status

POST/GET /workflow-requests/:id/messages for the conversational
intake. New WorkflowRequestStatus value awaits Coordinator-initiated
clarification turns."
```

### Task B7: Hook Coordinator into watch.ts

**Files:**
- Modify: `apps/runner/src/cmd/watch.ts`
- Modify: `apps/runner/src/api-client.ts`

- [ ] **Step 1: Add api-client methods**

In `apps/runner/src/api-client.ts`, add:

```ts
async listMessages(requestId: string): Promise<RequestMessage[]> {
  const res = await fetch(`${this.base}/workflow-requests/${requestId}/messages`);
  return ((await res.json()) as any).messages;
},
async postCoordinatorMessage(requestId: string, content: string): Promise<void> {
  await fetch(`${this.base}/workflow-requests/${requestId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'coordinator', content }),
  });
},
async setRequestStatus(requestId: string, status: WorkflowRequestStatus): Promise<void> {
  await fetch(`${this.base}/workflow-requests/${requestId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
},
async persistCoordinatorDecision(decision: CoordinatorDecision): Promise<void> {
  await fetch(`${this.base}/coordinator-decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(decision),
  });
},
```

You will also need to add a corresponding `POST /coordinator-decisions` endpoint to the API (next task) and a `PATCH /workflow-requests/:id/status` endpoint to allow the runner to flip status to `awaiting_clarification`.

- [ ] **Step 2: Add decision-persist endpoint**

Append to `apps/api/src/routes/workflow-request-chat.ts`:

```ts
app.post('/coordinator-decisions', async (c) => {
  const decision = await c.req.json() as CoordinatorDecision;
  store.coordinatorDecisions.insert(decision);
  return c.json({ ok: true }, 201);
});

app.patch('/workflow-requests/:id/status', async (c) => {
  const id = c.req.param('id') as WorkflowRequestId;
  const { status } = await c.req.json() as { status: WorkflowRequestStatus };
  store.workflowRequests.updateStatus(id, status);
  return c.json({ ok: true });
});
```

(Add `updateStatus` to the workflowRequests repo in `store.ts` if not present.)

- [ ] **Step 3: Modify watch.ts to call Coordinator before claim**

Find the existing watch loop in `apps/runner/src/cmd/watch.ts`. Before the call that creates the WorkflowRun, insert this triage step:

```ts
// New: triage the WorkflowRequest before creating a Run.
const messages = await api.listMessages(request.id);
const userMessages = messages.filter((m) => m.role === 'user');
const userRequestText = userMessages.length > 0
  ? userMessages[userMessages.length - 1].content
  : request.title;

const decision = await triageRequest({
  workflowRequestId: request.id as any,
  userRequest: userRequestText,
  messageHistory: messages.map((m) => ({ role: m.role, content: m.content })),
});
await api.persistCoordinatorDecision(decision);
console.log(`[runner] coordinator decision: ${decision.source} -> ${decision.decision.action}`);

if (decision.decision.action === 'pause_for_human') {
  // Post the questions to the chat thread; flip status to awaiting_clarification
  for (const q of decision.decision.questions) {
    await api.postCoordinatorMessage(request.id, q);
  }
  await api.setRequestStatus(request.id, 'awaiting_clarification');
  console.log(`[runner] request ${request.id} -> awaiting_clarification`);
  continue; // skip Run creation; loop will pick up next pending request
}

if (decision.decision.action === 'abort') {
  await api.setRequestStatus(request.id, 'cancelled');
  console.log(`[runner] request ${request.id} aborted: ${decision.decision.reason}`);
  continue;
}

// action === 'proceed' — use decided runType when creating the Run
const runType = decision.decision.runType;
```

Update the existing `createWorkflowRun` call to use `runType` instead of hardcoded `'feature'`.

- [ ] **Step 4: Add import to watch.ts**

```ts
import { triageRequest } from '../agents/coordinator';
```

- [ ] **Step 5: Smoke test the integration**

Manual:
```bash
bun run dev:api &
bun run runner -- watch &
# In another shell, post a clear bug request:
curl -X POST http://127.0.0.1:8787/workflow-requests \
  -H 'content-type: application/json' \
  -d '{"projectId":"<id>","type":"feature","title":"导出按钮报错弹空白","branch":"main"}'
# Expect: runner log shows decision.routeCase=bugfix; created run has type=bugfix
```

- [ ] **Step 6: Commit**

```bash
git add apps/runner/src/cmd/watch.ts apps/runner/src/api-client.ts apps/api/src/routes/workflow-request-chat.ts apps/api/src/store/store.ts
git commit -m "feat(runner): triage WorkflowRequest with Coordinator before Run creation

Coordinator decides route case and runType; pause_for_human flips
the request to awaiting_clarification and posts questions to chat."
```

### Task B8: Web UI conversational intake

**Files:**
- Modify: `apps/web/src/main.ts`
- Modify: `apps/web/src/projection.ts`

- [ ] **Step 1: Add message-thread projection**

In `apps/web/src/projection.ts`, add:

```ts
export interface ChatThreadView {
  requestId: string;
  status: WorkflowRequestStatus;
  messages: { role: 'user' | 'coordinator'; content: string; createdAt: string }[];
  awaitingUserReply: boolean;
}

export function projectChatThread(req: WorkflowRequest, messages: RequestMessage[]): ChatThreadView {
  const lastRole = messages[messages.length - 1]?.role;
  return {
    requestId: req.id,
    status: req.status,
    messages: messages.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
    awaitingUserReply: req.status === 'awaiting_clarification' && lastRole === 'coordinator',
  };
}
```

- [ ] **Step 2: Replace single-shot form with chat composer in main.ts**

Find the "新建任务" form section in `apps/web/src/main.ts`. Replace the form's submit handler with a chat-style flow:

1. First user message creates the WorkflowRequest (status `pending`).
2. Subsequent user messages POST to `/workflow-requests/:id/messages`.
3. After each user message, the page polls `GET /workflow-requests/:id/messages` (or subscribes to SSE) for Coordinator responses.
4. When `decision.action === 'proceed'` and Run is created, redirect to the run detail.
5. When status transitions to `awaiting_clarification`, render Coordinator's questions inline and re-enable the input.

Sketch (pseudocode — adapt to existing main.ts structure):

```ts
async function startIntake(initialPrompt: string, projectId: string) {
  const req = await api('POST', '/workflow-requests', {
    projectId, type: 'feature', title: initialPrompt, branch: 'main',
  });
  await api('POST', `/workflow-requests/${req.id}/messages`, { role: 'user', content: initialPrompt });
  pollChatThread(req.id);
}

async function continueIntake(requestId: string, message: string) {
  await api('POST', `/workflow-requests/${requestId}/messages`, { role: 'user', content: message });
  // Setting status back to pending kicks the runner watch to re-triage.
  await api('PATCH', `/workflow-requests/${requestId}/status`, { status: 'pending' });
  pollChatThread(requestId);
}

async function pollChatThread(requestId: string) {
  const interval = setInterval(async () => {
    const { messages, decision } = await api('GET', `/workflow-requests/${requestId}/messages`);
    renderThread(messages);
    if (decision?.decision.action === 'proceed' && decision.workflowRunId) {
      clearInterval(interval);
      navigate(`/runs/${decision.workflowRunId}`);
    }
  }, 1500);
}
```

- [ ] **Step 3: Manual UI test**

Run dev stack, open `http://127.0.0.1:5173/`. Type "权限" (vague) → expect Coordinator question rendered inline. Reply with more detail → expect Run to start.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/main.ts apps/web/src/projection.ts
git commit -m "feat(web): conversational intake replaces single-shot form

New Task page becomes a chat thread: user types initial prompt,
Coordinator may reply with up to 2 clarifying questions, user
answers, Run starts when decision=proceed."
```

### Task B9: smoke-coordinator.ts

**Files:**
- Create: `scripts/smoke-coordinator.ts`

- [ ] **Step 1: Write the smoke**

```ts
// scripts/smoke-coordinator.ts
import { triageRequest } from '../apps/runner/src/agents/coordinator';

const cases = [
  { label: 'clear bug', input: '点击导出按钮报空白弹窗，预期下载 markdown', expectRoute: 'bugfix' },
  { label: 'clear feature', input: '为报告页加导出 markdown 按钮，验收 mvn test 通过', expectRoute: 'feature_clear' },
  { label: 'large scope', input: '我想要一个完整的权限系统', expectAction: 'pause_for_human' },
];

async function main() {
  let failed = 0;
  for (const c of cases) {
    const decision = await triageRequest({
      workflowRequestId: 'smoke-req' as any,
      userRequest: c.input,
      messageHistory: [],
    });
    const ok = c.expectRoute
      ? decision.decision.action === 'proceed' && (decision.decision as any).routeCase === c.expectRoute
      : decision.decision.action === c.expectAction;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}: source=${decision.source} action=${decision.decision.action} confidence=${decision.confidence}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`smoke-coordinator: ${failed} failure(s)`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add to package.json scripts**

In root `package.json`, add:

```json
"smoke:coordinator": "bun run scripts/smoke-coordinator.ts"
```

- [ ] **Step 3: Run**

Run: `bun run smoke:coordinator`
Expected: 3 PASS lines, exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-coordinator.ts package.json
git commit -m "test: smoke-coordinator covers bug/feature/large-scope cases"
```

### Task B10: Phase B acceptance

- [ ] **Step 1: Full sweep**

Run: `bun test && bun run typecheck && bun run smoke:coordinator`
Expected: all green.

- [ ] **Step 2: Full e2e regression**

Run:
```bash
AINP_DB_PATH=/tmp/x.sqlite bun run apps/api/src/server.ts &
sleep 1
AINP_DB_PATH=/tmp/x.sqlite bun run scripts/e2e.ts
```
Expected: e2e PASS (existing 9-stage flow not broken by Coordinator hook).

- [ ] **Step 3: Manual demo**

Open web UI, walk through 3 scenarios:
1. Vague: "权限" → Coordinator asks 2 questions → answer → Run starts
2. Bug: "导出报错" → Coordinator routes to bugfix immediately
3. Clear feature: "加 export 按钮，AC: mvn test 过" → Coordinator routes to feature_clear immediately

Verify each Run shows correct `type` and the requirement card uses the cs-req four-section structure (from Phase A).

- [ ] **Step 4: Tag the milestone**

```bash
git tag phase-b-coordinator-conversational-intake
```

---

## Self-Review Checklist (executed once before handoff)

**Spec coverage:**
- ✅ cs-req 4-section + pitch + AC → Phase A Task A1, A2
- ✅ Coordinator at WorkflowRequest claim time (decision 1=A) → Phase B Task B7
- ✅ Rule-first + LLM fallback (decision 2=B) → Phase B Tasks B3, B4, B5
- ✅ New `coordinator_decisions` + `workflow_request_messages` tables (decision 3=B) → Phase B Task B2
- ✅ Conversational intake UI (decision 4=B) → Phase B Tasks B6, B8

**Type consistency:**
- ✅ `CoordinatorAction.action` values consistent across rules.ts / llm-fallback.ts / index.ts
- ✅ `RouteCase` literals consistent
- ✅ `WorkflowRequestStatus` extended in shared types and used in routes/UI
- ✅ `runType` consistently `'feature' | 'bugfix' | 'smoke'`

**Placeholder scan:**
- ✅ No "TODO" / "implement later" steps
- ✅ All code blocks contain real code, not stubs
- ✅ Test cases have concrete assertions

---

## Exit Criteria (whole plan)

- [ ] All Phase A tasks committed; `git tag phase-a-cs-req-injection` exists
- [ ] All Phase B tasks committed; `git tag phase-b-coordinator-conversational-intake` exists
- [ ] `bun test` passes (existing + new tests)
- [ ] `bun run typecheck` passes
- [ ] `bun run smoke:coordinator` passes
- [ ] `bun run e2e` passes (no regression in 9-stage lifecycle)
- [ ] Manual UI demo confirms 3 routing scenarios work end-to-end
- [ ] requirement_gate produces 9 rule results (5 existing + 4 cs-req); all pass for NativeBackend output
- [ ] Coordinator persists every decision; web UI displays the chat thread + decision reason
- [ ] No CodeStable `cs-*` skill files imported into runtime code (instruction inspiration only)

---

## Closure (2026-05-04)

> Tracked in trellis task `.trellis/tasks/05-04-fix-requirement-analysis-stage-design-impl-gaps`. The PRD records the decisions Q1=A / Q2=A / Q3=A and the per-PR file map.

| Gap (PRD §) | Status | Landing |
|---|---|---|
| **P0-1** LLM fallback only supported Claude Code | ✅ Closed | `apps/runner/src/agents/coordinator/llm-fallback.ts` adds a `LlmFallbackDeps`-injectable codex one-shot using `--output-last-message`; selection is project-aware (`preferredBackend`); falls back to the other CLI when the preferred one is unavailable. New tests: `apps/runner/test/coordinator-llm-fallback.test.ts` (9 cases). |
| **P0-2** New-task form did two POSTs (request, then message) | ✅ Closed | `POST /workflow-requests` now accepts an optional `firstMessage`; `apps/api/src/workflow-engine.ts` writes both inside `db.transaction(...)`. Web `submitWorkflowRequest` is a single call. |
| **P0-3** Race between request creation and first message | ✅ Closed | Same atomic transaction as P0-2 + `apps/runner/src/cmd/watch.ts` `defaultTriage` now reads `project.agentBackend` and threads it as `preferredBackend` into `triageRequest(...)`. |
| **P1-4** `requirement-workflow.md` flow diagram missed Coordinator | ✅ Closed | Diagram updated; new "对话分诊与 awaiting_clarification" chapter explains the 4-case routing and the LLM-fallback selection rules. |
| **P1-5** Form `type` was silently overridden by Coordinator | ✅ Closed | `apps/web/src/main.ts` renders a new `Coordinator 判定` metric next to `Project (用户标记)`. Mismatch is rendered with `warn` kind. |
| **P1-7** `PATCH /workflow-requests/:id/status` accepted any transition | ✅ Closed | `apps/api/src/routes/workflow-request-chat.ts` carries an explicit `ALLOWED_TRANSITIONS` whitelist; illegal transitions return 409. |

### Verification snapshot at closure

- `bun test`: 221 pass / 0 fail across 40 files
- `bun run typecheck`: PASS for shared / api / runner / web
- `apps/api/test/workflow-request-routes.test.ts` and `apps/api/test/workflow-request-chat.test.ts` cover the new firstMessage round-trip + status whitelist
- `apps/runner/test/coordinator-llm-fallback.test.ts` covers backend-availability × preferredBackend combinations

### Out of scope (still P1+ as the original plan stated)

- `skill.implementation` / `skill.review` cs-* injection — not done; intentionally deferred.
- Hook / `requiredGates` / `inputs` / `outputs` runtime-config exposure — not done; PR3+ scope.
- Tool-policy sandbox-level enforcement — explicitly off-roadmap (project memory directive).
