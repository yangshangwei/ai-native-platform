import { expect, test } from 'vitest';
import { isCommandOnlyText } from '../src';

// 08-09 P1-1 R2: this judgement used to exist as two byte-identical copies —
// `commandOnlyVerifierText` (runner, write side) and `isCommandOnlyText`
// (api gate engine, read side). These cases pin the LIFTED behaviour so the
// merge cannot silently change what counts as "just a command"; tuning the
// heuristic is deliberately a separate change (see the P1-1 PRD Out of Scope).

test('bare build and test commands carry no verification meaning', () => {
  expect(isCommandOnlyText('mvn test')).toBe(true);
  expect(isCommandOnlyText('./mvnw -B test')).toBe(true);
  expect(isCommandOnlyText('npm test')).toBe(true);
  expect(isCommandOnlyText('bun run typecheck')).toBe(true);
  expect(isCommandOnlyText('pytest')).toBe(true);
  expect(isCommandOnlyText('go test ./...')).toBe(true);
  expect(isCommandOnlyText('`mvn -B test`')).toBe(true);
});

test('generic pass/fail vocabulary alone is not verification', () => {
  expect(isCommandOnlyText('测试通过')).toBe(true);
  expect(isCommandOnlyText('全部用例通过')).toBe(true);
  expect(isCommandOnlyText('build passed')).toBe(true);
  expect(isCommandOnlyText('verified by test')).toBe(true);
});

test('an AC identifier is stripped before the residue is measured', () => {
  expect(isCommandOnlyText('AC-001')).toBe(true);
  expect(isCommandOnlyText('AC-001 mvn test')).toBe(true);
  expect(isCommandOnlyText('REQ-042 通过')).toBe(true);
});

test('concrete business behaviour survives the strip and is not command-only', () => {
  expect(isCommandOnlyText('打开登录页输入账号密码后跳转到首页并显示欢迎语')).toBe(false);
  expect(isCommandOnlyText('user sees the order total refreshed after removing an item')).toBe(false);
  // Command plus real behaviour: the behaviour is what remains, so it counts.
  expect(isCommandOnlyText('mvn test 后确认订单金额随明细删除而刷新')).toBe(false);
});

test('the residue threshold is measured on letters and digits only', () => {
  // Punctuation and whitespace are collapsed before the length check, so
  // decoration cannot push a command-only string over the bar.
  expect(isCommandOnlyText('  mvn   test  ...  ')).toBe(true);
  expect(isCommandOnlyText('!!! npm test !!!')).toBe(true);
  // Exactly at the boundary: 7 surviving characters is still command-only,
  // 8 is not. Pins `< 8` so a tuning change has to be deliberate.
  expect(isCommandOnlyText('abcdefg')).toBe(true);
  expect(isCommandOnlyText('abcdefgh')).toBe(false);
});

test('empty and whitespace-only text is command-only', () => {
  expect(isCommandOnlyText('')).toBe(true);
  expect(isCommandOnlyText('   ')).toBe(true);
});
