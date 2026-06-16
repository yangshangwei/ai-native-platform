import { describe, expect, it } from 'vitest';
import { knowledgeEvidenceSummary } from '../src/page-knowledge';

describe('knowledge evidence summary', () => {
  it('turns command run evidence into user-readable copy', () => {
    const summary = knowledgeEvidenceSummary('Decision', 'commandRuns=cmd_51d6069b2109,cmd_400ade1a4e37');

    expect(summary.reason).toBe('本条建议来自实际执行过的验证命令，可证明这次结论不是凭空生成。');
    expect(summary.reason).not.toContain('commandRuns=');
    expect(summary.chips.map((chip) => chip.label)).toContain('2 条命令记录');
  });

  it('turns gate run evidence into user-readable copy', () => {
    const summary = knowledgeEvidenceSummary('Decision', 'gateRuns=gate_381cb10f2c6c,gate_5ef195bbbdc8,gate_348b99e2aa71');

    expect(summary.reason).toBe('本条建议来自已通过的质量检查，可作为后续任务复用的可信经验。');
    expect(summary.reason).not.toContain('gateRuns=');
    expect(summary.chips.map((chip) => chip.label)).toContain('3 个质量检查');
  });

  it('uses kind-specific copy when evidence is missing or unrecognized', () => {
    const summary = knowledgeEvidenceSummary('Pitfall', '');

    expect(summary.reason).toBe('这是一条本次任务暴露出的风险经验，收录后可帮助后续任务少走弯路。');
    expect(summary.chips.map((chip) => chip.label)).toEqual(['来自本次任务']);
  });
});
