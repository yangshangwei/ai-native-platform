# Legacy Project Capability Map Bootstrap - Regression Test Plan

## Test Goals

Regression coverage must prove:

1. The enhanced inventory stays backward-compatible.
2. New scanner sections are deterministic and evidence-backed.
3. Sensitive/generated/binary/oversized files are still excluded before
   extraction.
4. Profile bootstrap remains read-only and keeps its existing stage order.
5. The profile agent receives clearer capability-map instructions.
6. Existing context/knowledge behavior is not bypassed or auto-promoted.

## Focused Unit Tests

### Inventory Shape

| Test | Expected |
| --- | --- |
| Existing fixture scan still has `schemaVersion='ainp.project_inventory.v1'`. | Backward-compatible schema marker remains. |
| Existing `repo`, `scan`, `sources`, `commands`, `modules`, `git`, `exclusions`, `warnings` fields remain. | Existing consumers still work. |
| New arrays are always present. | Empty arrays are emitted when no evidence exists. |
| Output ordering is stable. | Repeated fixture scan produces same ids/order. |

### Entrypoints

Fixture source:

```ts
router.get('/users/:id', getUser);
router.post('/users', createUser);
export async function workerMain() {}
```

Expected:

- `http_route` entrypoints for `GET /users/:id` and `POST /users`.
- source refs include file path and line number.
- job/bootstrap hints appear only when path/name evidence exists.

### Symbols

Fixture source:

```ts
export class UserService {}
export function getUser() {}
interface UserDto {}
```

Expected:

- class/function/interface symbols appear with compact signatures.
- exported flag is true for exported declarations.
- no large source body appears in symbol records.

### Domain Entities

Fixture source/path examples:

- `src/models/User.ts`
- `src/entities/InvoiceEntity.ts`
- `src/schema/order-schema.ts`
- `src/dto/CreateUserDto.ts`

Expected:

- domain/entity hints appear with conservative kind and confidence.
- hints cite paths/symbol refs.
- unsupported names do not become high-confidence business facts.

### Test Surfaces

Fixture files:

- `src/user-service.test.ts`
- `apps/api/test/users-route.test.ts`
- `UserServiceTest.java`

Expected:

- test surfaces include framework hints where possible.
- target hints include nearby route/module/entity names.

### Hotspots

Fixture inputs:

- fake git summary with repeated churn path;
- source file with many symbols;
- source file with multiple entrypoints.

Expected:

- hotspots are scored and sorted deterministically.
- hotspot source refs point to the relevant file/git evidence.

### Capabilities

Fixture:

- user route file,
- user service symbol,
- user model/entity,
- user test file.

Expected:

- capability label groups related `user` evidence.
- capability includes entrypoint, symbol, test, and source refs.
- confidence is high only when entrypoint and supporting evidence exist.
- open questions remain when grouping is heuristic.

### Safety

Fixture files:

- `.env`
- `secrets/api-key.txt`
- `node_modules/generated.js`
- `large-file.ts`
- binary file

Expected:

- excluded files do not appear in new scanner arrays.
- secret text does not appear in serialized inventory.
- exclusions include the correct reason.

## Integration Tests

### Runner Inventory Stage

| Test | Expected |
| --- | --- |
| `executeInventory` persists enriched `project-inventory.json`. | Artifact metadata remains `role='project_inventory'`, schema v1. |
| Inventory stage does not select agent backend. | Backend selection mock is not called. |
| Inventory stage finishes passed when scanner succeeds. | Step status is passed. |

### Profile Bootstrap Flow

| Test | Expected |
| --- | --- |
| `profile.bootstrap` stage order remains `inventory -> profile -> completion -> knowledge`. | Flow registry tests pass. |
| Dispatcher does not run implementation/build_test/review. | Blocked spies are not called. |
| Profile stage receives `project-inventory.json` with capability sections. | Agent input contains new arrays. |
| Missing backend fails at profile after inventory. | Inventory artifact remains; no profile/knowledge artifacts are produced. |

### Knowledge And Context

| Test | Expected |
| --- | --- |
| Profile-derived knowledge candidates remain draft/reviewable. | No accepted knowledge row is written without approval. |
| Accepted profile-derived knowledge remains eligible in later ContextPack. | Existing context-builder tests continue to pass. |
| Draft profile candidates are not authoritative context. | Existing context-builder tests continue to pass. |

## Manual QA

1. Register a real legacy project.
2. Start "Generate legacy profile".
3. Inspect `project-inventory.json`.
4. Confirm capability map shows recognizable user-facing/API/CLI/job surfaces.
5. Inspect `project-profile.md`.
6. Confirm facts cite source refs and uncertain items appear as open questions.
7. Accept one knowledge candidate and start a later task.
8. Confirm accepted knowledge appears in context governance.

## Commands

Focused:

```bash
bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/orchestrator-profile-bootstrap.test.ts apps/runner/test/context-builder.test.ts
```

Flow/API/Web smoke related to profile bootstrap:

```bash
bun run test -- packages/shared/test/flow-registry.test.ts apps/runner/test/flow-registry.test.ts apps/api/test/workflow-request-routes.test.ts apps/api/test/report-sidecars.test.ts apps/web/test/projects-rendering.test.ts
```

Full:

```bash
bun run test
bun run typecheck
```

## Regression Risks

- Regex extraction creates noisy/incorrect capability labels.
- New fields accidentally include sensitive file content.
- Source extraction bypasses existing file-size/generated/binary filters.
- Profile prompt over-trusts heuristic capability labels.
- Inventory output becomes nondeterministic because line/path iteration order is
  unstable.
- Full E2E still covers only `feature.standard`; profile-bootstrap E2E remains
  a separate follow-up unless implemented in this task.
