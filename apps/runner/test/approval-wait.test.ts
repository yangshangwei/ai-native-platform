import { describe, expect, it } from 'vitest';

import { waitForApprovalDecision } from '../src/orchestrator';

describe('runner approval waiting', () => {
  it('waits without a default timeout so UI human checkpoints do not fail by themselves', async () => {
    let polls = 0;

    const decision = await waitForApprovalDecision({
      workflowRunId: 'run_wait_for_human',
      gateId: 'requirement_gate',
      findApproval: async () => {
        polls += 1;
        return polls < 3 ? null : { decision: 'approved', comment: null };
      },
      sleep: async () => {},
      timeoutMs: null,
    });

    expect(decision).toEqual({ approved: true, comment: null });
    expect(polls).toBe(3);
  });
});
