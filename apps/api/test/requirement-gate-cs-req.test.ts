import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Artifact, RuleResult } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-csreq-test-')), 'ainp.sqlite');

let gates: typeof import('../src/gate-engine');

beforeAll(async () => {
  gates = await import('../src/gate-engine');
});

function artifactFor(content: string): Artifact {
  const path = join(tmpdir(), `csreq-${Math.random().toString(16).slice(2)}.md`);
  writeFileSync(path, content, 'utf8');
  return {
    id: `art_csreq_${Math.random().toString(16).slice(2)}`,
    kind: 'requirement_draft',
    uri: `file://${path}`,
    workflowRunId: 'run_csreq',
    stepRunId: 'step_csreq',
    size: Buffer.byteLength(content, 'utf8'),
    contentType: 'text/markdown',
    createdAt: new Date().toISOString(),
    metadata: {},
  };
}

function findRule(results: RuleResult[], ruleId: string): RuleResult | undefined {
  return results.find((r) => r.ruleId === ruleId);
}

const VALID_CS_REQ = `---
doc_type: requirement
pitch: 让交付报告一键导出 Markdown 给非技术干系人传阅
status: draft
REQ-001: report-export
---

# 报告导出能力

## 用户故事
- 作为产品经理，我希望把交付报告导出成 Markdown，而不是给每个干系人单独截图粘贴
- 作为 QA，我希望快速分享给客户，而不是手动整理证据链

## 为什么需要
当前报告只能在工作台看，跨团队协作场景下无法离线流转。这导致每次需要给非技术同事或外部客户看结果时，都要花额外时间整理。让导出成为一键操作能消除这个摩擦。

## 怎么解决
工作台增加导出按钮，点击后下载当前 run 的 Markdown 报告。

## 边界
- 验收标准 AC-001: 点击按钮在 2 秒内开始下载
- 不覆盖 PDF 导出（如有需要走单独的 feature）
- 不打包附件，仅纯文本
- goals: 让报告可离线传阅；non-goals: 不做内嵌图片
- 前置：当前 run 已 completed

引用：\`src/server/reports.ts\`
`;

describe('runRequirementGate cs-req rules', () => {
  test('passes a complete cs-req document', () => {
    const a = artifactFor(VALID_CS_REQ);
    const gate = gates.runRequirementGate({
      workflowRunId: 'run_csreq',
      stepRunId: 'step_csreq',
      artifact: a,
    });
    expect(gate.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'requirement.pitch_present')?.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'requirement.four_sections_present')?.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'requirement.user_stories_min_2')?.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'requirement.boundary_present')?.status).toBe('pass');
  });

  test('rejects mixed AC bullets when any criterion is only a command', () => {
    const a = artifactFor(`---
doc_type: requirement
id: REQ-001
pitch: 让 Calculator 像处理加法和乘法一样，可靠地完成整数减法。
status: draft
---

## 用户故事 (User Stories)

- 作为维护示例计算能力的开发者，我希望能直接表达两个整数相减，而不是把减法绕成加负数或临时手算。
- 作为补充计算器测试的开发者，我希望减法结果能被自动验收，而不是只能靠人工判断这次改动是否正确。

## 为什么需要 (Why)

现在的计算器已经能覆盖常见的加法和乘法，但缺少减法会让一个很基础的计算场景断掉。

## 怎么解决 (How)

使用者可以在同一个计算器能力里选择做整数减法，输入两个整数后得到前者减去后者的结果。

## 边界 (Boundaries)

- **目标**：覆盖两个整数之间的基础减法。
- **范围**：只关注 Calculator 的整数减法能力；上下文证据来自 \`src/main/java/sample/Calculator.java\`。
- **非目标**：不扩展小数、货币、表达式解析、连续运算、溢出特殊处理或界面交互。
- **AC-001**：给定两个整数，使用者能得到第一个整数减去第二个整数的结果。
- **AC-002**：项目标准验收命令 \`mvn test\` 通过。
`);
    const gate = gates.runRequirementGate({
      workflowRunId: 'run_csreq',
      stepRunId: 'step_csreq',
      artifact: a,
    });

    expect(gate.status).toBe('fail');
    expect(findRule(gate.ruleResults, 'requirement.acceptance_criteria_present')?.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'requirement.acceptance_business_meaning_present')?.status).toBe('fail');
  });

  test('passes numbered level-2 cs-req headings from real agent output', () => {
    const a = artifactFor(`---
doc_type: requirement
req_id: REQ-002
status: draft
pitch: 让 Calculator 像做加法一样轻松做减法。
---

# REQ-002: 为 Calculator 增加整数减法能力

## 1. 用户故事

- 作为调用 sample.Calculator 的业务开发者，我希望能直接求两个整数的差，而不是为了做个减法还得自己写 add(a, -b)。
- 作为这个计算工具的维护者，我希望减法和已有的加法、乘法摆在一起，而不是让调用方记两套不一样的用法。

## 2. 为什么需要

今天这个计算工具能做加法、能做乘法，唯独不能做减法。缺了它，任何需要求差的人都得绕路。

## 3. 怎么解决

给使用者一个减法能力：传入两个整数，立刻拿到前者减后者的结果。

### 验收标准

- **AC-001 减法结果正确**：给定任意两个整数 a、b，求差返回 a - b。
- **AC-002 mvn test 通过**：测试套件在 Maven 下全部通过。

## 4. 边界

- 目标：补齐整数减法。
- 非目标：不做小数、大数、溢出安全运算。
- 范围：只关注 Calculator 的整数减法能力；上下文证据来自 \`src/main/java/sample/Calculator.java\`。
`);
    const gate = gates.runRequirementGate({
      workflowRunId: 'run_csreq',
      stepRunId: 'step_csreq',
      artifact: a,
    });

    expect(gate.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'requirement.four_sections_present')?.status).toBe('pass');
    expect(findRule(gate.ruleResults, 'requirement.boundary_present')?.status).toBe('pass');
  });

  test('fails when pitch frontmatter is missing', () => {
    const a = artifactFor(VALID_CS_REQ.replace(/^pitch: .*$\n/m, ''));
    const gate = gates.runRequirementGate({
      workflowRunId: 'run_csreq',
      stepRunId: 'step_csreq',
      artifact: a,
    });
    expect(findRule(gate.ruleResults, 'requirement.pitch_present')?.status).toBe('fail');
  });

  test('fails when 用户故事 section is missing', () => {
    const a = artifactFor(VALID_CS_REQ.replace(/## 用户故事[\s\S]*?(?=\n## )/, ''));
    const gate = gates.runRequirementGate({
      workflowRunId: 'run_csreq',
      stepRunId: 'step_csreq',
      artifact: a,
    });
    expect(findRule(gate.ruleResults, 'requirement.four_sections_present')?.status).toBe('fail');
  });

  test('fails when user stories has fewer than 2 bullets', () => {
    const oneStory = VALID_CS_REQ.replace(/- 作为 QA[\s\S]*?\n/, '');
    const a = artifactFor(oneStory);
    const gate = gates.runRequirementGate({
      workflowRunId: 'run_csreq',
      stepRunId: 'step_csreq',
      artifact: a,
    });
    expect(findRule(gate.ruleResults, 'requirement.user_stories_min_2')?.status).toBe('fail');
  });

  test('fails when 边界 section is missing or empty', () => {
    const noBoundary = VALID_CS_REQ.replace(/## 边界[\s\S]*$/, '');
    const a = artifactFor(noBoundary);
    const gate = gates.runRequirementGate({
      workflowRunId: 'run_csreq',
      stepRunId: 'step_csreq',
      artifact: a,
    });
    expect(findRule(gate.ruleResults, 'requirement.boundary_present')?.status).toBe('fail');
  });
});
