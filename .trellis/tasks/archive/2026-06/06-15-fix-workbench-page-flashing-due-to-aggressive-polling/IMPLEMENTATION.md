# Implementation Summary

## Problem
Task detail page flashes every 3 seconds due to unconditional `loadRunDetail()` calls in the polling loop, causing the entire `data.activeDetail` object to be replaced even when no data has changed.

## Solution
Added conditional logic to only reload detail when key fields actually change.

## Changes Made

### File: `apps/web/src/main.ts` (lines 122-143)

**Before:**
```typescript
// Load detail silently to keep data fresh without causing flicker
if (ui.activeRunId) void loadRunDetail(ui.activeRunId, false);
```

**After:**
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

## Detection Logic

The new logic compares:
1. **`status`** - Detects run state changes (running → passed/failed/etc)
2. **`currentStage`** - Detects stage transitions (requirement → design → implementation)

These two fields are sufficient to catch all meaningful changes that require a detail reload.

**Note**: Originally planned to also check `updatedAt`, but this field is not exposed in `WorkflowRunDto`. The two fields above are sufficient for detecting state changes.

## Testing Checklist

### Manual Testing
- [ ] Start local environment with `npm run dev`
- [ ] Open a task detail page
- [ ] Observe for 30+ seconds - page should NOT flash
- [ ] Trigger a run state change (e.g., retry a stage)
- [ ] Verify UI updates within 3 seconds
- [ ] Switch between different tasks
- [ ] Verify new task details load correctly

### Expected Behavior
- **Stable state**: No flashing when run is unchanged
- **State changes**: UI updates within 3 seconds when status/stage changes
- **Task switching**: New task details load immediately

## Verification

- ✅ TypeScript compilation passes
- ✅ No type errors
- ✅ Code is properly commented
- ⏳ Manual testing pending

## Risk Assessment

**Low Risk** - The change is purely defensive:
- Does not modify the polling interval
- Does not change the fingerprint-based render optimization
- Only adds a conditional check before an existing call
- Falls back to reload on first load and ID changes
