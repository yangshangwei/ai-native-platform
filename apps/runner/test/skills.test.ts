import { describe, expect, test } from 'bun:test';
import { findSkillForStage } from '../src/skills/index.js';

describe('ExecutionContract validation', () => {
  test('writer skill has valid ExecutionContract', () => {
    expect(() => findSkillForStage('writer')).not.toThrow();
  });

  test('implementer skill has valid ExecutionContract', () => {
    expect(() => findSkillForStage('implementer')).not.toThrow();
  });

  test('verifier skill has valid ExecutionContract', () => {
    expect(() => findSkillForStage('verifier')).not.toThrow();
  });

  test('reviewer skill has valid ExecutionContract', () => {
    expect(() => findSkillForStage('reviewer')).not.toThrow();
  });

  test('all skills have valid ExecutionContracts', () => {
    const stages = ['writer', 'implementer', 'verifier', 'reviewer'] as const;
    for (const stage of stages) {
      expect(() => findSkillForStage(stage)).not.toThrow();
    }
  });
});

// Manual mutation test instructions:
// To verify ExecutionContract validation catches conflicts:
// 1. In skills/index.ts, find skill.design outputs[] array (around line 237)
// 2. Add a conflicting output: { name: 'invalid.md', kind: 'artifact', required: true, description: 'test' }
// 3. Run: bun test apps/runner/test/skills.test.ts
// 4. Expect test to fail with ExecutionContract conflict error
// 5. Remove the invalid output to restore passing state
