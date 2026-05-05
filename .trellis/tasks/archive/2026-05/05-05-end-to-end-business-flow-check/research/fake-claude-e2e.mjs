#!/usr/bin/env node
/**
 * Task-local deterministic Claude CLI stub for the 2026-05-05
 * end-to-end business-flow validation task.
 *
 * Scope:
 * - lives only under this task's `research/` directory
 * - not imported by product code, test suites, or CI entrypoints
 * - used only to generate evidence for `run_75dd25561a7a`
 *
 * The implementation stage intentionally edits the sample Java worktree that
 * Runner points at so compile/test/report evidence is real without depending
 * on an external model account.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);

if (args.includes('--version')) {
  console.log('2.1.117 (Fake Claude Code E2E)');
  process.exit(0);
}

if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'fake', apiProvider: 'local' }));
  process.exit(0);
}

function argAfter(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function emit(obj) {
  console.log(JSON.stringify(obj));
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function outputPathFromPrompt(prompt) {
  const match = prompt.match(/\/[^\s]+\.md/);
  return match?.[0] ?? null;
}

function inferStage(systemPrompt, userPrompt) {
  const text = `${systemPrompt}\n${userPrompt}`;
  if (text.includes('stage=context_pack')) return 'context_pack';
  if (text.includes('stage=requirement')) return 'requirement';
  if (text.includes('stage=design')) return 'design';
  if (text.includes('stage=implementation')) return 'implementation';
  if (text.includes('stage=review')) return 'review';
  return 'coordinator';
}

function updateCalculator(cwd) {
  const src = join(cwd, 'src/main/java/sample/Calculator.java');
  const test = join(cwd, 'src/test/java/sample/CalculatorTest.java');
  let source = readFileSync(src, 'utf8');
  if (!source.includes('subtract(int a, int b)')) {
    source = source.replace(
      /\n}\s*$/,
      '\n\n  public static int subtract(int a, int b) {\n    return a - b;\n  }\n}\n',
    );
    writeFileSync(src, source, 'utf8');
  }

  let tests = readFileSync(test, 'utf8');
  if (!tests.includes('subtractsPositiveNumbers')) {
    tests = tests.replace(
      /\n}\s*$/,
      '\n\n  @Test\n  public void subtractsPositiveNumbers() {\n    assertEquals(2, Calculator.subtract(5, 3));\n  }\n}\n',
    );
    writeFileSync(test, tests, 'utf8');
  }
}

const systemPrompt = argAfter('--append-system-prompt') ?? '';
const userPrompt = args.at(-1) ?? '';
const stage = inferStage(systemPrompt, userPrompt);

emit({ type: 'system', subtype: 'init', cwd: process.cwd(), model: 'fake-claude-e2e' });
emit({
  type: 'assistant',
  message: { content: [{ type: 'text', text: `fake ${stage} stage executed` }] },
});

if (stage === 'coordinator') {
  console.log(JSON.stringify({
    action: 'proceed',
    routeCase: 'feature_clear',
    runType: 'feature',
    reason: 'fake coordinator classification',
  }));
  process.exit(0);
}

if (stage === 'implementation') {
  // This mutates the sample worktree used by the validation run, not product code.
  updateCalculator(process.cwd());
} else {
  const target = outputPathFromPrompt(systemPrompt);
  if (!target) {
    console.error('missing target path');
    process.exit(2);
  }
  const contentByStage = {
    context_pack: [
      '# Context Pack',
      '',
      '- Evidence: `src/main/java/sample/Calculator.java` contains arithmetic helpers.',
      '- Evidence: `src/test/java/sample/CalculatorTest.java` contains matching JUnit tests.',
      '',
    ].join('\n'),
    requirement: [
      '---',
      'doc_type: requirement',
      'pitch: Add subtraction to the sample calculator so arithmetic examples cover one more basic operation.',
      'status: draft',
      'id: REQ-001',
      '---',
      '',
      '# Requirement',
      '',
      '## 用户故事 (User Stories)',
      '',
      '- 作为示例项目维护者，我希望 calculator 支持 subtract，而不是只能演示 add/multiply。',
      '- 作为平台验收人员，我希望这个变化有明确测试，而不是只能从 agent 文案判断成功。',
      '',
      '## 为什么需要 (Why)',
      '',
      'The sample project needs a small, testable change for workflow validation. Without this, the end-to-end run cannot prove that implementation, build, test, and report evidence all connect. The change should stay intentionally narrow so the validation signal is about the workflow rather than product scope.',
      '',
      '## 怎么解决 (How)',
      '',
      'Users can call subtraction and see a passing unit test demonstrate the behavior.',
      '',
      '## 边界 (Boundaries)',
      '',
      '- Scope: only the Java sample calculator is in scope.',
      '- Non-goal: no UI, API, or persistence behavior changes.',
      '- Context Pack evidence: `src/main/java/sample/Calculator.java` and `src/test/java/sample/CalculatorTest.java`.',
      '',
      '## Acceptance Criteria / 验收标准',
      '',
      '### AC-001',
      '',
      '- `Calculator.subtract(5, 3)` returns `2`.',
      '',
    ].join('\n'),
    design: [
      '---',
      'doc_type: design',
      'design_id: DSN-001',
      'related_req: REQ-001',
      'status: draft',
      '---',
      '',
      '# Design',
      '',
      '## 现状 (Current State)',
      '',
      '- `src/main/java/sample/Calculator.java` exposes add and multiply helpers.',
      '- `src/test/java/sample/CalculatorTest.java` verifies existing arithmetic helpers.',
      '',
      '## 变化 (Changes)',
      '',
      'Add `subtract(int a, int b)` and a JUnit test covering AC-001.',
      '',
      'Requirement coverage: REQ-001 maps to DSN-001 and AC-001.',
      '',
      '## 挂载点 (Mount Points)',
      '',
      '- Calculator public API.',
      '- Calculator JUnit suite.',
      '- Maven Surefire report consumed by the runner.',
      '',
      '## 推进策略 (Roll-out)',
      '',
      '1. Add subtraction helper; exit when compilation succeeds.',
      '2. Add test; exit when Maven test passes.',
      '',
      '## 验收契约 (Acceptance)',
      '',
      '- Test strategy: REQ-001 / AC-001 is verified by `subtractsPositiveNumbers` and `mvn -B test`.',
      '- Risks: accidental behavior regression in existing arithmetic helpers; owner: runner build_test via Maven Surefire.',
      '',
    ].join('\n'),
    review: [
      '# Review',
      '',
      'Verdict: pass.',
      '',
      '- The diff adds a focused calculator helper and matching test.',
      '- Maven compile/test evidence should be used as final acceptance evidence.',
      '',
    ].join('\n'),
  };
  write(target, contentByStage[stage] ?? `# ${stage}\n\nFake artifact.\n`);
}

emit({ type: 'result', subtype: 'success', duration_ms: 1, total_cost_usd: 0, result: `fake ${stage} complete` });
