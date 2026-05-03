import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Artifact, RuleResult } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-csdesign-test-')), 'ainp.sqlite');

let gates: typeof import('../src/gate-engine');

beforeAll(async () => {
  gates = await import('../src/gate-engine');
});

function artifactFor(content: string): Artifact {
  const path = join(tmpdir(), `csdesign-${Math.random().toString(16).slice(2)}.md`);
  writeFileSync(path, content, 'utf8');
  return {
    id: `art_csdesign_${Math.random().toString(16).slice(2)}`,
    kind: 'design_doc',
    uri: `file://${path}`,
    workflowRunId: 'run_csdesign',
    stepRunId: 'step_csdesign',
    size: Buffer.byteLength(content, 'utf8'),
    contentType: 'text/markdown',
    createdAt: new Date().toISOString(),
    metadata: {},
  };
}

function findRule(results: RuleResult[], ruleId: string): RuleResult | undefined {
  return results.find((r) => r.ruleId === ruleId);
}

const VALID_CS_DESIGN = `---
doc_type: design
design_id: DSN-001
related_req: REQ-001
status: draft
---

# DSN-001: divide method

对应需求：REQ-001（AC-001 ~ AC-004）

## 现状
\`Calculator\` 类在 \`src/main/java/sample/Calculator.java\` 已有 \`add\` 与 \`multiply\`。两个方法都是 \`public static int\` 入参 \`int, int\`。

## 变化
新增方法 \`divide(int a, int b)\`：
- 名词层：返回 \`int\`，与 \`add\` / \`multiply\` 同形态
- 编排层：被除数为 0 时抛 \`ArithmeticException\`

## 挂载点
- \`src/main/java/sample/Calculator.java\` 新增 \`divide\` 方法
- \`src/test/java/sample/CalculatorTest.java\` 新增 3 个 \`@Test\`
- 新增的 \`@Test\` 与 AC-001 ~ AC-003 一一对应

## 推进策略
1. 在 Calculator 写 divide
2. 在 CalculatorTest 加用例
3. \`mvn test\` 全绿

## 验收契约
- AC-001: divide(6,2) == 3 — \`mvn test\` 用例
- AC-002: divide(7,2) == 3 — 测试策略覆盖整数截断
- AC-003: divide(1,0) 抛 ArithmeticException
- 风险：无；mitigation owner：design-stage 自验

引用：\`src/main/java/sample/Calculator.java\` \`src/test/java/sample/CalculatorTest.java\`
`;

describe('runDesignGate cs-feat-design rules', () => {
  test('passes a complete cs-feat-design document', () => {
    const a = artifactFor(VALID_CS_DESIGN);
    const gate = gates.runDesignGate({
      workflowRunId: 'run_csdesign',
      stepRunId: 'step_csdesign',
      artifact: a,
    });
    expect(gate.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'design.dsn_id_present')?.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'design.current_state_section_present')?.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'design.changes_section_present')?.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'design.mount_points_count_in_range')?.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'design.rollout_section_present')?.status).toBe('pass');
  });

  test('fails when DSN-### frontmatter is missing', () => {
    const a = artifactFor(VALID_CS_DESIGN.replace(/^design_id: DSN-\d+$\n/m, ''));
    const gate = gates.runDesignGate({
      workflowRunId: 'run_csdesign',
      stepRunId: 'step_csdesign',
      artifact: a,
    });
    expect(findRule(gate.ruleResults, 'design.dsn_id_present')?.status).toBe('fail');
  });

  test('fails when 现状 section is missing', () => {
    const a = artifactFor(VALID_CS_DESIGN.replace(/## 现状[\s\S]*?(?=\n## )/, ''));
    const gate = gates.runDesignGate({
      workflowRunId: 'run_csdesign',
      stepRunId: 'step_csdesign',
      artifact: a,
    });
    expect(findRule(gate.ruleResults, 'design.current_state_section_present')?.status).toBe('fail');
  });

  test('fails when 挂载点 has fewer than 3 bullets', () => {
    const a = artifactFor(
      VALID_CS_DESIGN.replace(
        /## 挂载点[\s\S]*?(?=\n## )/,
        '## 挂载点\n- only one mount point\n\n',
      ),
    );
    const gate = gates.runDesignGate({
      workflowRunId: 'run_csdesign',
      stepRunId: 'step_csdesign',
      artifact: a,
    });
    expect(findRule(gate.ruleResults, 'design.mount_points_count_in_range')?.status).toBe('fail');
  });

  test('fails when 挂载点 has more than 5 bullets (sprawling design)', () => {
    const sprawling = '## 挂载点\n' + Array.from({ length: 7 }, (_, i) => `- mount ${i + 1}`).join('\n') + '\n\n';
    const a = artifactFor(VALID_CS_DESIGN.replace(/## 挂载点[\s\S]*?(?=\n## )/, sprawling));
    const gate = gates.runDesignGate({
      workflowRunId: 'run_csdesign',
      stepRunId: 'step_csdesign',
      artifact: a,
    });
    expect(findRule(gate.ruleResults, 'design.mount_points_count_in_range')?.status).toBe('fail');
  });

  test('fails when 推进策略 section is missing', () => {
    const a = artifactFor(VALID_CS_DESIGN.replace(/## 推进策略[\s\S]*?(?=\n## )/, ''));
    const gate = gates.runDesignGate({
      workflowRunId: 'run_csdesign',
      stepRunId: 'step_csdesign',
      artifact: a,
    });
    expect(findRule(gate.ruleResults, 'design.rollout_section_present')?.status).toBe('fail');
  });
});
