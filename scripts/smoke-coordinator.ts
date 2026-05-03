#!/usr/bin/env bun
/**
 * Smoke for the Coordinator triage engine. Drives 3 representative inputs
 * through `triageRequest` and asserts the expected route case / action.
 *
 * This exercises the rules path end-to-end (no LLM call required) which is
 * where the cs-brainstorm three-case mapping lives. The LLM fallback is
 * covered by a separate manual smoke against real Claude.
 *
 * Run:
 *   bun run scripts/smoke-coordinator.ts
 */

import { triageRequest } from '../apps/runner/src/agents/coordinator';

interface Case {
  label: string;
  input: string;
  expectAction: 'proceed' | 'pause_for_human' | 'abort';
  expectRoute?: 'feature_clear' | 'feature_brainstorm' | 'roadmap_needed' | 'bugfix' | 'unclear';
  expectRunType?: 'feature' | 'bugfix' | 'smoke';
}

const CASES: Case[] = [
  {
    label: 'clear bug',
    input: '点击导出按钮后弹出空白对话框，预期应下载 markdown 但实际不工作',
    expectAction: 'proceed',
    expectRoute: 'bugfix',
    expectRunType: 'bugfix',
  },
  {
    label: 'clear feature',
    input: '为报告页增加导出 Markdown 按钮，验收标准是 mvn test 通过',
    expectAction: 'proceed',
    expectRoute: 'feature_clear',
    expectRunType: 'feature',
  },
  {
    label: 'large scope',
    input: '我想要一个完整的权限系统，包括用户、角色、资源、审计',
    expectAction: 'pause_for_human',
  },
];

async function main(): Promise<void> {
  let failed = 0;
  for (const c of CASES) {
    const decision = await triageRequest({
      workflowRequestId: 'smoke_req',
      userRequest: c.input,
      messageHistory: [],
    });

    let ok = decision.decision.action === c.expectAction;
    if (ok && c.expectRoute && decision.decision.action === 'proceed') {
      ok = decision.decision.routeCase === c.expectRoute;
      if (ok && c.expectRunType) ok = decision.decision.runType === c.expectRunType;
    }

    const tag = ok ? '✅ PASS' : '❌ FAIL';
    const detail =
      decision.decision.action === 'proceed'
        ? `routeCase=${decision.decision.routeCase} runType=${decision.decision.runType}`
        : decision.decision.action === 'pause_for_human'
          ? `questions=${decision.decision.questions.length}`
          : `action=abort`;
    console.log(
      `${tag}  ${c.label.padEnd(15)} | source=${decision.source} confidence=${decision.confidence.toFixed(2)} ${detail}`,
    );
    if (!ok) {
      console.log(`         expected: action=${c.expectAction}${c.expectRoute ? ` routeCase=${c.expectRoute}` : ''}`);
      console.log(`         got:      action=${decision.decision.action} reason="${decision.decision.reason}"`);
      failed++;
    }
  }
  if (failed > 0) {
    console.error(`\nsmoke-coordinator: ${failed}/${CASES.length} failure(s)`);
    process.exit(1);
  }
  console.log('\nsmoke-coordinator: ALL PASS');
}

await main();
