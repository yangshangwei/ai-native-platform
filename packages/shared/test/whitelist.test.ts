import { describe, it, expect } from 'vitest';
import { isWhitelisted } from '../src/utils/whitelist';

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
});
