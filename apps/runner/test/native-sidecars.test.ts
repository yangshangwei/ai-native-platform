import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NativeBackend } from '../src/agents/native';
import { findSkillForStage } from '../src/skills';

describe('NativeBackend structured sidecars', () => {
  it('emits requirement markdown plus a versioned JSON sidecar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ainp-native-sidecar-'));
    const skill = findSkillForStage('requirement')!;
    const result = await new NativeBackend().run(skill, {
      workflowRunId: 'run_sidecar_req',
      stepRunId: 'step_req',
      workspacePath: dir,
      branch: 'ai/run_sidecar_req',
      title: 'Add CSV export',
      artifactsDir: dir,
      inputs: { user_request: 'Add CSV export' },
    });

    expect(result.outputs.map((o) => o.name).sort()).toEqual(['requirement.json', 'requirement.md']);
    const jsonOut = result.outputs.find((o) => o.name === 'requirement.json')!;
    expect(jsonOut.contentType).toBe('application/json');
    const sidecar = JSON.parse(await readFile(jsonOut.path, 'utf8')) as {
      schemaVersion: string;
      acceptanceCriteria: Array<{ id: string; text: string }>;
    };
    expect(sidecar.schemaVersion).toBe('ainp.requirement.v1');
    expect(sidecar.acceptanceCriteria.map((ac) => ac.id)).toContain('AC-001');
  });

  it('emits design and traceability JSON sidecars', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ainp-native-sidecar-design-'));
    const skill = findSkillForStage('design')!;
    const result = await new NativeBackend().run(skill, {
      workflowRunId: 'run_sidecar_design',
      stepRunId: 'step_design',
      workspacePath: dir,
      branch: 'ai/run_sidecar_design',
      title: 'Add CSV export',
      artifactsDir: dir,
      inputs: { user_request: 'Add CSV export' },
    });

    expect(result.outputs.map((o) => o.name).sort()).toEqual([
      'design.json',
      'design.md',
      'traceability.json',
    ]);
    const traceOut = result.outputs.find((o) => o.name === 'traceability.json')!;
    const traceability = JSON.parse(await readFile(traceOut.path, 'utf8')) as {
      schemaVersion: string;
      items: Record<string, { designItems: string[]; files: string[]; gates: string[] }>;
    };
    expect(traceability.schemaVersion).toBe('ainp.traceability.v1');
    expect(traceability.items['AC-001']?.designItems).toContain('D-001');
    expect(traceability.items['AC-001']?.files).toContain('src/main/java/sample/Calculator.java');
  });
});
