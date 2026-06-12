import { describe, it, expect } from 'vitest';
import { customBuildCommandError, isWhitelisted } from '../src/utils/whitelist';

describe('command whitelist', () => {
  it('accepts the whitelisted maven and git commands', () => {
    expect(isWhitelisted('mvn -B test')).toBe(true);
    expect(isWhitelisted('mvn -B -DskipTests compile')).toBe(true);
    expect(isWhitelisted('./mvnw -B test')).toBe(true);
    expect(isWhitelisted('./mvnw -B -DskipTests compile')).toBe(true);
    expect(isWhitelisted('git status')).toBe(true);
    expect(isWhitelisted('git diff')).toBe(true);
    expect(isWhitelisted('git diff --name-only')).toBe(true);
    expect(isWhitelisted('git rev-parse HEAD')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isWhitelisted('rm -rf /')).toBe(false);
    expect(isWhitelisted('mvn install')).toBe(false);
    expect(isWhitelisted('mvn test')).toBe(false); // missing -B
    expect(isWhitelisted('git push')).toBe(false);
    expect(isWhitelisted('cat /etc/passwd')).toBe(false);
    expect(isWhitelisted('mvn -B test;rm -rf /')).toBe(false); // chaining
    expect(isWhitelisted('')).toBe(false);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(isWhitelisted('  mvn -B test  ')).toBe(true);
  });

  it('accepts project-level extraAllow entries by exact string match only', () => {
    const extra = ['gradle test', 'npm run build'];
    expect(isWhitelisted('gradle test', extra)).toBe(true);
    expect(isWhitelisted('  npm run build  ', extra)).toBe(true); // trims input
    expect(isWhitelisted('gradle test --info', extra)).toBe(false); // no prefix match
    expect(isWhitelisted('gradle', extra)).toBe(false); // no partial match
    expect(isWhitelisted('rm -rf /', extra)).toBe(false);
    expect(isWhitelisted('', extra)).toBe(false);
    expect(isWhitelisted('   ', ['   '])).toBe(false); // blank entries never match
  });

  it('still accepts the static whitelist when extraAllow is provided', () => {
    expect(isWhitelisted('mvn -B test', ['gradle test'])).toBe(true);
  });
});

describe('customBuildCommandError', () => {
  it('accepts plain whitespace-separated commands', () => {
    expect(customBuildCommandError('gradle test')).toBeNull();
    expect(customBuildCommandError('npm run build')).toBeNull();
    expect(customBuildCommandError('  make check  ')).toBeNull();
  });

  it('rejects empty commands', () => {
    expect(customBuildCommandError('')).toMatch(/empty/);
    expect(customBuildCommandError('   ')).toMatch(/empty/);
  });

  it('rejects shell metacharacters since commands run without a shell', () => {
    for (const bad of [
      'mvn -B test && rm -rf /',
      'a || b',
      'mvn test; echo done',
      'mvn test | tee log',
      'mvn test > out.txt',
      'mvn test < in.txt',
      'echo `whoami`',
      'echo $(whoami)',
      'mvn -Dtest="Foo Bar" test',
      "mvn -Dtest='Foo' test",
    ]) {
      expect(customBuildCommandError(bad), bad).toMatch(/shell metacharacter/);
    }
  });

  it('rejects embedded control characters (newline, carriage return, tab, NUL)', () => {
    for (const bad of [
      'gradle test\nrm -rf /',
      'gradle test\r\nrm -rf /',
      'gradle\ttest',
      'gradle\u0000test',
    ]) {
      expect(customBuildCommandError(bad), JSON.stringify(bad)).toMatch(/control characters/);
    }
    // Leading/trailing whitespace (including newlines) is trimmed, not rejected.
    expect(customBuildCommandError('\n  gradle test  \n')).toBeNull();
  });
});
