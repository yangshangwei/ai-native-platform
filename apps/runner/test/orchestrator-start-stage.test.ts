import { describe, expect, test } from 'vitest';
import type { StageStep } from '@ainp/shared';
import { sliceStagesFromStartStage } from '../src/orchestrator';
import { FLOW_REGISTRY } from '../src/flows/registry';

// ---------------------------------------------------------------------------
// V2 W2-4 / PR2 — orchestrator slice-from-startStage unit tests.
// PRD R3-R6 + R-Risk-1 (throw on unknown startStage; never silently skip).
// ---------------------------------------------------------------------------

const FEATURE_STANDARD = FLOW_REGISTRY['feature.standard'];

describe('sliceStagesFromStartStage()', () => {
  test('null startStage returns stages unchanged (V1 default)', () => {
    const result = sliceStagesFromStartStage({
      flowId: 'feature.standard',
      runId: 'run_null_start',
      stages: FEATURE_STANDARD.stages,
      startStage: null,
    });
    expect(result).toBe(FEATURE_STANDARD.stages);
  });

  test('startStage matching index 0 returns stages unchanged (no log spam)', () => {
    const logs: string[] = [];
    const result = sliceStagesFromStartStage({
      flowId: 'feature.standard',
      runId: 'run_zero_idx',
      stages: FEATURE_STANDARD.stages,
      startStage: 'context_pack',
      log: (m) => logs.push(m),
    });
    expect(result).toBe(FEATURE_STANDARD.stages);
    expect(logs).toEqual([]);
  });

  test('startStage=implementation slices feature.standard prefix', () => {
    const logs: string[] = [];
    const result = sliceStagesFromStartStage({
      flowId: 'feature.standard',
      runId: 'run_impl_start',
      stages: FEATURE_STANDARD.stages,
      startStage: 'implementation',
      log: (m) => logs.push(m),
    });
    expect(result.map((s: StageStep) => s.stage)).toEqual([
      'implementation',
      'build_test',
      'review',
      'completion',
      'knowledge',
    ]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('implementation');
    expect(logs[0]).toContain('skipping 3');
  });

  test('startStage=design slices feature.standard 3-stage prefix', () => {
    const result = sliceStagesFromStartStage({
      flowId: 'feature.standard',
      runId: 'run_design_start',
      stages: FEATURE_STANDARD.stages,
      startStage: 'design',
    });
    expect(result.map((s: StageStep) => s.stage)).toEqual([
      'design',
      'implementation',
      'build_test',
      'review',
      'completion',
      'knowledge',
    ]);
  });

  test('R-Risk-1: startStage not in the flow throws (never silently skip)', () => {
    expect(() =>
      sliceStagesFromStartStage({
        flowId: 'feature.fastforward',
        runId: 'run_bad_start',
        stages: FLOW_REGISTRY['feature.fastforward'].stages,
        startStage: 'design',
      }),
    ).toThrow(/unknown startStage in flow.*design.*feature\.fastforward/);
  });

  test('R-Risk-1: error message includes flowId + runId for traceability', () => {
    let caught: Error | null = null;
    try {
      sliceStagesFromStartStage({
        flowId: 'issue.standard',
        runId: 'run_trace_id',
        stages: FLOW_REGISTRY['issue.standard'].stages,
        startStage: 'context_pack',
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('issue.standard');
    expect(caught!.message).toContain('run_trace_id');
    expect(caught!.message).toContain('context_pack');
  });
});
