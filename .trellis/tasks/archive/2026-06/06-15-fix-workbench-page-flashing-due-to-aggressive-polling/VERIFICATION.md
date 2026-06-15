# Verification Report - Fix Workbench Page Flashing

## Environment Status

✅ **Web Server**: Running at http://127.0.0.1:5173
✅ **API Server**: Running at http://127.0.0.1:8787
✅ **TypeCheck**: Passed
✅ **Code Changes**: Applied to `apps/web/src/main.ts`

## Code Change Verification

### Before (Line 123)
```typescript
if (ui.activeRunId) void loadRunDetail(ui.activeRunId, false);
```
**Issue**: Unconditionally reloads detail every 3 seconds, causing page flash.

### After (Lines 122-145)
```typescript
// Conditionally reload detail only when key fields change to avoid unnecessary
// re-renders that cause page flashing. We compare the latest run snapshot from
// data.runs with the current data.activeDetail to detect changes in status or
// currentStage (updatedAt is not exposed in WorkflowRunDto, but these two
// fields are sufficient to detect meaningful run state changes).
if (ui.activeRunId) {
  const latestRunSnapshot = data.runs.find(r => r.id === ui.activeRunId);
  const currentDetail = data.activeDetail;

  // Reload detail only if:
  // 1. No detail loaded yet (first load)
  // 2. Active run ID changed (switched to different task)
  // 3. Key fields changed: status or currentStage
  const shouldReload = !currentDetail
    || currentDetail.run.id !== ui.activeRunId
    || (latestRunSnapshot && (
      latestRunSnapshot.status !== currentDetail.run.status
      || latestRunSnapshot.currentStage !== currentDetail.run.currentStage
    ));

  if (shouldReload) {
    void loadRunDetail(ui.activeRunId, false);
  }
}
```
**Fix**: Smart conditional check - only reloads when state actually changes.

## Logic Flow Analysis

### Polling Cycle (Every 3 seconds)
1. ✅ `loadData({ render: false, keepDetail: true })` - Silently updates `data.runs` snapshot
2. ✅ Fingerprint check - Only renders if top-level data changed
3. ✅ **NEW**: Smart detail reload check
   - Compares `data.runs[activeRunId]` with `data.activeDetail.run`
   - Only reloads if `status` or `currentStage` differs
4. ✅ `maybeAutoStartRunnerForActiveTask()` - Unchanged

### Scenarios Covered

#### Scenario 1: Stable State (No Changes)
- **Before**: Reloads detail every 3s → Flash
- **After**: Skips reload → No flash ✅

#### Scenario 2: Status Change (running → passed)
- **Before**: Reloads detail → Updates UI
- **After**: Detects status change → Reloads detail → Updates UI ✅

#### Scenario 3: Stage Change (requirement → design)
- **Before**: Reloads detail → Updates UI  
- **After**: Detects stage change → Reloads detail → Updates UI ✅

#### Scenario 4: First Load
- **Before**: Loads detail
- **After**: `!currentDetail` → Loads detail ✅

#### Scenario 5: Task Switch
- **Before**: Loads new detail
- **After**: `currentDetail.run.id !== ui.activeRunId` → Loads new detail ✅

## Manual Testing Instructions

To complete verification, please perform the following tests in your browser:

### Test 1: Stable State (No Flashing)
1. Navigate to http://127.0.0.1:5173
2. Open any task detail page
3. **Expected**: Page loads normally
4. Observe for 30-60 seconds
5. **Expected**: Page should NOT flash or flicker
6. ✅ **Pass Criteria**: No visible flashing during stable state

### Test 2: State Change Detection
1. On the task detail page, trigger a run state change:
   - Click "重试该阶段" button, OR
   - Wait for a running task to complete
2. **Expected**: UI updates within 3 seconds
3. ✅ **Pass Criteria**: State changes reflect in UI promptly

### Test 3: Task Switching
1. From task detail page, click on another task
2. **Expected**: New task detail loads immediately
3. Switch back to original task
4. **Expected**: Original task detail loads immediately
5. ✅ **Pass Criteria**: Task switching works without issues

### Test 4: Multiple Tabs
1. Open the same task detail in two browser tabs
2. Observe both tabs for 30 seconds
3. **Expected**: Neither tab flashes
4. ✅ **Pass Criteria**: Multiple tabs remain stable

## Expected Browser Console Behavior

The modification does not add console logs, but you can verify the fix is working by:
1. Open browser DevTools → Network tab
2. Filter for `/workflow-runs/` requests
3. **Before fix**: Constant stream of detail requests every 3s
4. **After fix**: Detail requests only when state changes

## Rollback Plan

If issues arise, rollback is simple:
```bash
git checkout HEAD -- apps/web/src/main.ts
```

## Success Criteria

- [ ] Test 1: No flashing during stable state (30+ seconds)
- [ ] Test 2: State changes update within 3 seconds  
- [ ] Test 3: Task switching works normally
- [ ] Test 4: Multiple tabs work without issues

## Notes

- The fix is conservative and defensive
- No changes to polling interval or overall architecture
- Falls back to reloading on first load and ID changes
- Type-safe with TypeScript validation passing
