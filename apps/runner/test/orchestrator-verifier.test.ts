import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  VERIFIER_AC_MATRIX_SCHEMA_VERSION,
  type Artifact,
  type StepRun,
  type VerifierAcMatrix,
} from '@ainp/shared';
import { executeVerifier, type StepDeps } from '../src/orchestrator/steps';
import { runCtxFixture } from './helpers/orchestrator-fixtures';

describe('executeVerifier', () => {
  test('persists one business acceptance row per requirement AC with authoritative evidence refs', async () => {
    const postedArtifacts: Array<Record<string, unknown>> = [];
    const deps = {
      api: {
        stepStarted: vi.fn(async () => ({
          step: { id: 'step_verifier' } as unknown as StepRun,
        })),
        stepFinished: vi.fn(async () => ({})),
        postArtifact: vi.fn(async (input: Record<string, unknown>) => {
          postedArtifacts.push(input);
          return { id: 'art_verifier_matrix' } as unknown as Artifact;
        }),
      },
      persistVerifierMediaArtifacts: vi.fn(async () => []),
    } as unknown as StepDeps;
    const c = runCtxFixture({
      runArtifactsDir: mkdtempSync(join(tmpdir(), 'ainp-execute-verifier-')),
      inputs: {
        'requirement.md': [
          '# Requirement',
          '- AC-001: A valid login succeeds without captcha when captcha is disabled.',
          '- AC-002: At the enabled boundary, login still requires captcha.',
          '- AC-003: Invalid captcha configuration falls back to requiring captcha.',
          'Implementation notes compare the new behavior with AC-999: this is not a criterion declaration.',
        ].join('\n'),
        'design.md': [
          '| Requirement | Design | AC | Verification |',
          '|---|---|---|---|',
          '| REQ-001 | disabled branch | AC-001 | Login integration test verifies the disabled captcha behavior. |',
          '| REQ-001 | enabled branch | AC-002 | Login integration test verifies the enabled boundary behavior. |',
          '| REQ-001 | safe fallback | AC-003 | Login integration test verifies invalid config fallback behavior. |',
          '| REQ-001 | historical note | AC-998 | This design-only reference is not a requirement AC. |',
        ].join('\n'),
      },
      inputArtifactIds: {
        'requirement.md': 'art_requirement',
        'design.md': 'art_design',
        diff: 'art_diff',
        'review.md': 'art_review',
      },
    });

    await executeVerifier(c, deps);

    expect(deps.api.stepStarted).toHaveBeenCalledWith({
      workflowRunId: c.run.id,
      stage: 'review',
      name: 'verifier',
    });
    expect(postedArtifacts).toHaveLength(1);
    expect(postedArtifacts[0]).toMatchObject({
      workflowRunId: c.run.id,
      stepRunId: 'step_verifier',
      kind: 'other',
      contentType: 'application/json',
      metadata: {
        schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
        reportKind: 'verifier_ac_matrix',
        verifierArtifactType: 'ac_matrix',
      },
    });
    const matrix = JSON.parse(c.inputs['verifier-ac-matrix.json']!) as VerifierAcMatrix;
    expect(matrix.acceptanceCriteria.map((row) => [row.id, row.scenarioType, row.businessStatus]))
      .toEqual([
        ['AC-001', 'core', 'passed'],
        ['AC-002', 'boundary', 'passed'],
        ['AC-003', 'exception', 'passed'],
      ]);
    for (const row of matrix.acceptanceCriteria) {
      expect(row.evidenceRefs.map((ref) => ref.artifactId)).toEqual([
        'art_requirement',
        'art_design',
        'art_diff',
        'art_review',
      ]);
    }
    expect(c.inputArtifactIds['verifier-ac-matrix.json']).toBe('art_verifier_matrix');
    expect(deps.api.stepFinished).toHaveBeenCalledWith({
      stepRunId: 'step_verifier',
      status: 'passed',
    });
  });

  test('does not treat design range or prose references as omitted AC verification methods', async () => {
    const deps = {
      api: {
        stepStarted: vi.fn(async () => ({
          step: { id: 'step_verifier_missing_mappings' } as unknown as StepRun,
        })),
        stepFinished: vi.fn(async () => ({})),
        postArtifact: vi.fn(async () => (
          { id: 'art_verifier_matrix_missing_mappings' } as unknown as Artifact
        )),
      },
      persistVerifierMediaArtifacts: vi.fn(async () => []),
    } as unknown as StepDeps;
    const c = runCtxFixture({
      runArtifactsDir: mkdtempSync(join(tmpdir(), 'ainp-execute-verifier-missing-mappings-')),
      inputs: {
        'requirement.md': [
          '- AC-001: Disabling captcha lets a valid login proceed without a challenge.',
          '- AC-002: Enabling captcha still requires a challenge.',
          '- AC-003: Invalid configuration falls back to requiring captcha.',
        ].join('\n'),
        'design.md': [
          'Coverage references AC-001 ~ AC-003 for the captcha toggle.',
          'The implementation discussion mentions AC-002 and AC-003 outcomes without mapping tests.',
          '- AC-001: Login integration fixture verifies captcha-disabled behavior.',
        ].join('\n'),
      },
      inputArtifactIds: {
        'requirement.md': 'art_requirement_missing_mappings',
        'design.md': 'art_design_missing_mappings',
      },
    });

    await executeVerifier(c, deps);

    const matrix = JSON.parse(c.inputs['verifier-ac-matrix.json']!) as VerifierAcMatrix;
    const rows = Object.fromEntries(matrix.acceptanceCriteria.map((row) => [row.id, row]));
    expect(rows['AC-001']).toMatchObject({ businessStatus: 'passed', status: 'pass' });
    expect(rows['AC-002']).toMatchObject({ businessStatus: 'missing', status: 'blocked' });
    expect(rows['AC-002']?.verificationMethod).toBeUndefined();
    expect(rows['AC-003']).toMatchObject({ businessStatus: 'missing', status: 'blocked' });
    expect(rows['AC-003']?.verificationMethod).toBeUndefined();
  });
});
