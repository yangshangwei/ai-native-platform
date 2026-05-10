import { describe, expect, it } from 'vitest';
import {
  buildCoordinatorChoiceReply,
  mergeCoordinatorAutoReply,
  parseCoordinatorQuestion,
} from '../src/coordinator-clarification';

describe('coordinator clarification helpers', () => {
  it('extracts an inline A option before line-based B/C/D options', () => {
    const parsed = parseCoordinatorQuestion(`这个验证码开关主要解决什么问题？ A. 临时关闭验证码便于测试
B. 按环境控制验证码
C. 改善登录性能
D. 以上都不是`);

    expect(parsed.prompt).toBe('这个验证码开关主要解决什么问题？');
    expect(parsed.options).toEqual([
      { label: 'A', text: '临时关闭验证码便于测试' },
      { label: 'B', text: '按环境控制验证码' },
      { label: 'C', text: '改善登录性能' },
      { label: 'D', text: '以上都不是' },
    ]);
  });

  it('extracts an inline A option attached directly to a full-width question mark', () => {
    const parsed = parseCoordinatorQuestion(`这个验证码开关主要解决什么问题？A. 防机器人/撞库
B. 运营临时风控
C. 合规或客户要求
D. 其他`);

    expect(parsed.prompt).toBe('这个验证码开关主要解决什么问题？');
    expect(parsed.options).toEqual([
      { label: 'A', text: '防机器人/撞库' },
      { label: 'B', text: '运营临时风控' },
      { label: 'C', text: '合规或客户要求' },
      { label: 'D', text: '其他' },
    ]);
  });

  it('parses fully inline option strings', () => {
    const parsed = parseCoordinatorQuestion('请选择范围：A. 只改 UI B. 同时改 API C. 暂缓');

    expect(parsed.prompt).toBe('请选择范围');
    expect(parsed.options).toEqual([
      { label: 'A', text: '只改 UI' },
      { label: 'B', text: '同时改 API' },
      { label: 'C', text: '暂缓' },
    ]);
  });

  it('normalizes prompt punctuation when an inline option follows a separated colon', () => {
    const parsed = parseCoordinatorQuestion('请选择范围： A. 只改 UI B. 同时改 API C. 暂缓');

    expect(parsed.prompt).toBe('请选择范围');
    expect(parsed.options.map((option) => option.label)).toEqual(['A', 'B', 'C']);
  });

  it('does not treat dotted version-like text as answer options', () => {
    const parsed = parseCoordinatorQuestion('请确认版本 A.1 与 B.2 是否兼容。');

    expect(parsed.prompt).toBe('请确认版本 A.1 与 B.2 是否兼容。');
    expect(parsed.options).toEqual([]);
  });

  it('marks multi-select questions from natural-language hints', () => {
    expect(parseCoordinatorQuestion('哪些能力需要包含？ A. 搜索 B. 分享 C. 导出').multiple).toBe(true);
    expect(parseCoordinatorQuestion('这个开关主要解决什么问题？ A. 测试 B. 性能').multiple).toBe(false);
  });

  it('builds complete natural-language answer lines from selected options', () => {
    const reply = buildCoordinatorChoiceReply([
      {
        prompt: '这个验证码开关主要解决什么问题？',
        selectedOptions: [{ label: 'B', text: '按环境控制验证码' }],
      },
      {
        prompt: '哪些环境要启用？',
        selectedOptions: [
          { label: 'A', text: '生产环境' },
          { label: 'C', text: '预发环境' },
        ],
      },
    ]);

    expect(reply).toBe('关于「这个验证码开关主要解决什么问题」，我选择：按环境控制验证码。\n关于「哪些环境要启用」，我选择：生产环境、预发环境。');
  });

  it('replaces the previous generated reply while preserving manual supplement', () => {
    const previous = '关于「这个验证码开关主要解决什么问题」，我选择：临时关闭验证码便于测试。';
    const next = '关于「这个验证码开关主要解决什么问题」，我选择：按环境控制验证码。';
    const merged = mergeCoordinatorAutoReply(`${previous}\n\n另外要保留灰度开关。`, previous, next);

    expect(merged).toBe(`${next}\n\n另外要保留灰度开关。`);
  });
});
