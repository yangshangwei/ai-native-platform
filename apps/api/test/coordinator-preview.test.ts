import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Isolate this test's SQLite + runner home from other tests' state.
process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-coord-preview-test-')),
  'ainp.sqlite',
);
process.env.AINP_HOME = join(
  mkdtempSync(join(tmpdir(), 'ainp-coord-preview-home-')),
  '.ai-native',
);

let app: Awaited<typeof import('../src/app')>['app'];

beforeAll(async () => {
  ({ app } = await import('../src/app'));
});

/**
 * POST /coordinator/preview — dry-run rule classifier.
 *
 * The endpoint reuses the same `classifyByRulesCore` the runner-side
 * coordinator runs through, so the cases below should mirror the runner
 * tests in `apps/runner/test/coordinator-rules.test.ts` exactly. The
 * preview endpoint pulls keywords / regex / fallbacks from
 * `CONFIG_REGISTRY.default` (no override resolution — known MVP limitation
 * documented on the route handler).
 */

interface PreviewBody {
  predictedRunType: string | null;
  confidence: number;
  rulesFired: string[];
  hint: 'too_short' | 'large_scope' | null;
}

async function preview(title: string): Promise<{ status: number; body: PreviewBody }> {
  const res = await app.request('/coordinator/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return { status: res.status, body: (await res.json()) as PreviewBody };
}

describe('POST /coordinator/preview', () => {
  it('returns hint=too_short and predictedRunType=null for very short input', async () => {
    const { status, body } = await preview('权限');
    expect(status).toBe(200);
    expect(body.predictedRunType).toBeNull();
    expect(body.hint).toBe('too_short');
    expect(body.rulesFired).toContain('rule.too_short');
  });

  it('returns hint=large_scope for "完整的权限系统"', async () => {
    const { status, body } = await preview('我想要一个完整的权限系统，包括用户、角色、资源、审计');
    expect(status).toBe(200);
    expect(body.predictedRunType).toBeNull();
    expect(body.hint).toBe('large_scope');
    expect(body.rulesFired).toContain('rule.large_scope_detected');
  });

  it('returns predictedRunType=bugfix for clear bug reports', async () => {
    const { status, body } = await preview(
      '点击报告导出按钮后弹出空白对话框，预期应下载 markdown 但实际不工作',
    );
    expect(status).toBe(200);
    expect(body.predictedRunType).toBe('bugfix');
    expect(body.hint).toBeNull();
    expect(body.rulesFired).toContain('rule.bug_keywords_dominant');
    expect(body.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('returns predictedRunType=feature for clear feature requests', async () => {
    const { status, body } = await preview(
      '为报告页增加导出 Markdown 按钮，验收标准是 mvn test 通过',
    );
    expect(status).toBe(200);
    expect(body.predictedRunType).toBe('feature');
    expect(body.hint).toBeNull();
    expect(body.rulesFired).toContain('rule.feature_keywords_dominant');
  });

  it('returns predictedRunType=refactor for Chinese refactor requests', async () => {
    const { status, body } = await preview('重构 user 模块，把 auth 抽离成独立 service');
    expect(status).toBe(200);
    expect(body.predictedRunType).toBe('refactor');
    expect(body.hint).toBeNull();
    expect(body.rulesFired).toContain('rule.refactor_keywords_dominant');
  });

  it('returns predictedRunType=refactor for English "refactor"', async () => {
    const { status, body } = await preview('refactor the auth flow and extract a helper module');
    expect(status).toBe(200);
    expect(body.predictedRunType).toBe('refactor');
    expect(body.rulesFired).toContain('rule.refactor_keywords_dominant');
  });

  it('rejects missing title with 400', async () => {
    const res = await app.request('/coordinator/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: string };
    expect(j.error).toMatch(/title/i);
  });

  it('rejects empty title with 400', async () => {
    const res = await app.request('/coordinator/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
