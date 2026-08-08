/**
 * 08-09 p0-3-executioncontract-reviewer-scope-creep (R1/R3) — the contracts
 * the shipped skills actually declare.
 *
 * R3's "did too little" half is already enforced by `SkillIO.required` (and
 * 07-26 deliberately classifies a missing required output as an operational
 * pause, not a business failure). What this file fixes is that the two
 * declarations cannot drift apart, plus the write-scope declarations
 * themselves.
 */
import { describe, expect, test } from 'vitest';
import {
  REVIEW_MARKDOWN_OUTPUT_NAME,
  REVIEW_VERDICT_OUTPUT_NAME,
  executionContractOutputConflicts,
  executionContractRequiresWorkspaceMeasurement,
  resolveExecutionContract,
} from '@ainp/shared';
import { SKILLS } from '../src/skills';

function skillById(id: string) {
  const skill = SKILLS.find((candidate) => candidate.id === id);
  if (!skill) throw new Error(`skill ${id} not found`);
  return skill;
}

describe('shipped skill execution contracts', () => {
  test('every declared contract agrees with the skill outputs', () => {
    for (const skill of SKILLS) {
      expect({ id: skill.id, conflicts: executionContractOutputConflicts(skill) }).toEqual({
        id: skill.id,
        conflicts: [],
      });
    }
  });

  test('the reviewer may not mutate the workspace', () => {
    const review = skillById('skill.review');
    expect(review.executionContract?.workspaceMutationPolicy).toBe('deny');
    expect(review.executionContract?.expectedOutputs).toEqual([
      REVIEW_MARKDOWN_OUTPUT_NAME,
      REVIEW_VERDICT_OUTPUT_NAME,
    ]);
  });

  test('implementation writes only inside its declared scope', () => {
    const implementation = skillById('skill.implementation');
    expect(implementation.executionContract?.workspaceMutationPolicy).toBe('allow_declared');
    // Same scope the prompt already advertises — now measured, not just said.
    expect(implementation.executionContract?.allowedPaths).toEqual(
      implementation.toolPolicy.writableGlobs,
    );
  });

  test('skills without a contract keep their pre-contract behavior', () => {
    // Backward-compatibility floor: an undeclared contract resolves to
    // `allow_any`, which the runner skips without spawning git.
    for (const skill of SKILLS.filter((candidate) => !candidate.executionContract)) {
      const contract = resolveExecutionContract(skill.executionContract);
      expect(contract.workspaceMutationPolicy).toBe('allow_any');
      expect(executionContractRequiresWorkspaceMeasurement(contract)).toBe(false);
    }
  });

  test('only the contract-bearing skills are measured', () => {
    const measured = SKILLS.filter((skill) =>
      executionContractRequiresWorkspaceMeasurement(resolveExecutionContract(skill.executionContract)),
    ).map((skill) => skill.id);
    expect(measured).toEqual(['skill.implementation', 'skill.review']);
  });
});
