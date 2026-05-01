import { describe, it, expect } from 'vitest';
import { newId, slugify } from '../src/utils/id';

describe('newId', () => {
  it('produces a prefix_id pair with hex tail', () => {
    const id = newId('run');
    expect(id).toMatch(/^run_[0-9a-f]{12}$/);
  });

  it('returns distinct ids on subsequent calls', () => {
    const a = newId('foo');
    const b = newId('foo');
    expect(a).not.toBe(b);
  });
});

describe('slugify', () => {
  it('lowercases, collapses non-alnum to dashes, trims', () => {
    expect(slugify('Add Order CSV Export')).toBe('add-order-csv-export');
    expect(slugify('  hello, WORLD!  ')).toBe('hello-world');
  });

  it('caps length and falls back when empty', () => {
    expect(slugify('A'.repeat(100))).toHaveLength(30);
    expect(slugify('!!!!')).toBe('task');
    expect(slugify('')).toBe('task');
  });
});
