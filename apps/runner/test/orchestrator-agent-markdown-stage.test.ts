import { describe, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Artifact, StepRun } from '@ainp/shared';
import { executeAgentMarkdownStage, type StepDeps } from '../src/orchestrator/steps';
import type { InvokedAgent } from '../src/orchestrator/types';
import { runCtxFixture, skillFixture } from './helpers/orchestrator-fixtures';

// ---------------------------------------------------------------------------
// T3.1 de-closure: `executeAgentMarkdownStage` is the generalized
// "agent → markdown artifact" step that replaced the four copy-pasted
// executeReport/Analyze/Scan/Plan inner functions. These injected tests pin
// its artifact + RunCtx mutation contract for both issue and refactor stages.
// ---------------------------------------------------------------------------

function depsFixture(agent: InvokedAgent) {
  const deps = {
    api: {
      stepStarted: vi.fn(async () => ({ step: { id: 'step_md' } as unknown as StepRun })),
      stepFinished: vi.fn(async () => ({})),
      stepCheckpoint: vi.fn(async () => ({ checkpoint: { id: 'scp_md' } })),
      postArtifact: vi.fn(async () => ({ id: 'art_md_1' } as unknown as Artifact)),
    },
    mustSkill: vi.fn(async (stage: string) => skillFixture(stage as 'report')),
    invokeSkill: vi.fn(async () => agent),
    finishAgentSuccess: vi.fn(async () => {}),
  };
  return { deps: deps as unknown as StepDeps, raw: deps };
}

describe('executeAgentMarkdownStage (de-closured four-in-one)', () => {
  test('report: posts each output as kind=other and feeds RunCtx inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'md-stage-'));
    const reportPath = join(dir, 'report.md');
    await writeFile(reportPath, '# Bug report\n\nNPE in gate engine.\n', 'utf8');
    const agent: InvokedAgent = {
      taskId: 'task_md',
      sessionId: 'ags_md',
      invocationId: 'ctxinv_md',
      contextPackArtifactId: 'art_context_pack_md',
      outputs: [
        { name: 'report.md', path: reportPath, contentType: 'text/markdown', size: 33 },
      ],
      contextPack: { id: 'cp_md' } as InvokedAgent['contextPack'],
      contextRequest: null,
    };
    const { deps, raw } = depsFixture(agent);
    const c = runCtxFixture();

    await executeAgentMarkdownStage('report', c, deps);

    expect(raw.mustSkill).toHaveBeenCalledWith('report');
    expect(raw.api.stepStarted).toHaveBeenCalledWith({
      workflowRunId: 'run_orch',
      stage: 'report',
      name: 'skill.report',
    });
    expect(raw.api.postArtifact).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run_orch',
      stepRunId: 'step_md',
      kind: 'other',
      uri: `file://${reportPath}`,
      metadata: { skill: 'skill.report', output: 'report.md', stage: 'report' },
    }));
    expect(c.inputs['report.md']).toBe('# Bug report\n\nNPE in gate engine.\n');
    expect(c.inputArtifactIds['report.md']).toBe('art_md_1');
    expect(raw.finishAgentSuccess).toHaveBeenCalledWith(
      agent,
      ['art_md_1'],
      'report produced 1 artifact(s)',
    );
    expect(raw.api.stepFinished).toHaveBeenCalledWith({
      stepRunId: 'step_md',
      status: 'passed',
    });
    expect(c.ok.value).toBe(true);
  });

  test('scan: invokeSkill receives the run-scoped context from RunCtx', async () => {
    const agent: InvokedAgent = {
      taskId: 'task_scan',
      sessionId: 'ags_scan',
      invocationId: 'ctxinv_scan',
      contextPackArtifactId: 'art_context_pack_scan',
      outputs: [],
      contextPack: { id: 'cp_scan' } as InvokedAgent['contextPack'],
      contextRequest: null,
    };
    const { deps, raw } = depsFixture(agent);
    const c = runCtxFixture();

    await executeAgentMarkdownStage('scan', c, deps);

    expect(raw.invokeSkill).toHaveBeenCalledWith(c, expect.objectContaining({ stage: 'scan' }), {
      workflowRunId: 'run_orch',
      stepRunId: 'step_md',
      workspacePath: '/tmp/workspace',
      branch: 'ai/run-1',
      title: 'Orchestrator de-closure test run',
      artifactsDir: join('/tmp/run-artifacts', 'scan'),
      inputs: c.inputs,
    });
    expect(raw.finishAgentSuccess).toHaveBeenCalledWith(
      agent,
      [],
      'scan produced 0 artifact(s)',
    );
  });
});
