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
          return true;
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
          awaitApproval: async () => false,
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
        awaitApproval: async () => true,
      },
    });

    expect(calls).toEqual([]);
  });
});
