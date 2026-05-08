import { describe, expect, it } from 'vitest';
import { enforceSensitiveChangeCheckpoint } from '../src/orchestrator';

describe('runner sensitive change checkpoint', () => {
  it('pauses implementation and resumes when a warn gate is approved', async () => {
    const calls: string[] = [];

    await enforceSensitiveChangeCheckpoint({
      workflowRunId: 'run_sensitive',
      stepRunId: 'step_impl',
      gate: { status: 'warn' },
      deps: {
        awaitHuman: async (params) => {
          calls.push(`await:${params.stage}`);
        },
        stepFinished: async (params) => {
          calls.push(`step:${params.status}`);
        },
        awaitApproval: async (_workflowRunId, gateId) => {
          calls.push(`approval:${gateId}`);
          return { approved: true, comment: null };
        },
      },
    });

    expect(calls).toEqual(['await:implementation', 'approval:sensitive_change_gate']);
  });

  it('marks the implementation step failed when a warn gate is rejected', async () => {
    const calls: string[] = [];

    await expect(
      enforceSensitiveChangeCheckpoint({
        workflowRunId: 'run_sensitive',
        stepRunId: 'step_impl',
        gate: { status: 'warn' },
        deps: {
          awaitHuman: async (params) => {
            calls.push(`await:${params.stage}`);
          },
          stepFinished: async (params) => {
            calls.push(`step:${params.status}`);
          },
          awaitApproval: async () => ({ approved: false, comment: null }),
        },
      }),
    ).rejects.toThrow('sensitive_change_gate rejected');

    expect(calls).toEqual(['await:implementation', 'step:failed']);
  });

  it('does not pause when sensitive_change_gate passes', async () => {
    const calls: string[] = [];

    await enforceSensitiveChangeCheckpoint({
      workflowRunId: 'run_sensitive',
      stepRunId: 'step_impl',
      gate: { status: 'pass' },
      deps: {
        awaitHuman: async () => {
          calls.push('await');
        },
        stepFinished: async () => {
          calls.push('step');
        },
        awaitApproval: async () => ({ approved: true, comment: null }),
      },
    });

    expect(calls).toEqual([]);
  });

  it('persists rejection_feedback before throwing when reject carries a comment', async () => {
    const feedbackCalls: Array<{
      workflowRunId: string;
      stepRunId: string | null;
      gateId: string;
      comment: string;
    }> = [];
    const calls: string[] = [];

    await expect(
      enforceSensitiveChangeCheckpoint({
        workflowRunId: 'run_sensitive_with_comment',
        stepRunId: 'step_impl',
        gate: { status: 'warn' },
        deps: {
          awaitHuman: async () => {
            calls.push('await');
          },
          stepFinished: async (params) => {
            calls.push(`step:${params.status}`);
          },
          awaitApproval: async () => ({
            approved: false,
            comment: 'diff touches auth middleware — please split sensitive/non-sensitive changes',
          }),
          postRejectionFeedback: async (input) => {
            feedbackCalls.push(input);
          },
        },
      }),
    ).rejects.toThrow('sensitive_change_gate rejected');

    expect(feedbackCalls).toHaveLength(1);
    expect(feedbackCalls[0]).toMatchObject({
      workflowRunId: 'run_sensitive_with_comment',
      stepRunId: 'step_impl',
      gateId: 'sensitive_change_gate',
      comment: 'diff touches auth middleware — please split sensitive/non-sensitive changes',
    });
    expect(calls).toContain('step:failed');
    const feedbackIdx = calls.indexOf('step:failed');
    expect(feedbackIdx).toBeGreaterThanOrEqual(0);
  });

  it('still throws on reject when no comment is supplied (artifact persistence skipped)', async () => {
    const feedbackCalls: Array<unknown> = [];

    await expect(
      enforceSensitiveChangeCheckpoint({
        workflowRunId: 'run_sensitive_no_comment',
        stepRunId: 'step_impl',
        gate: { status: 'warn' },
        deps: {
          awaitHuman: async () => {},
          stepFinished: async () => {},
          awaitApproval: async () => ({ approved: false, comment: null }),
          postRejectionFeedback: async (input) => {
            feedbackCalls.push(input);
          },
        },
      }),
    ).rejects.toThrow('sensitive_change_gate rejected');

    expect(feedbackCalls).toHaveLength(0);
  });

  it('still throws on reject when postRejectionFeedback dep is omitted', async () => {
    await expect(
      enforceSensitiveChangeCheckpoint({
        workflowRunId: 'run_sensitive_no_dep',
        stepRunId: 'step_impl',
        gate: { status: 'warn' },
        deps: {
          awaitHuman: async () => {},
          stepFinished: async () => {},
          awaitApproval: async () => ({
            approved: false,
            comment: 'reason supplied but dep omitted',
          }),
        },
      }),
    ).rejects.toThrow('sensitive_change_gate rejected');
  });
});
