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
