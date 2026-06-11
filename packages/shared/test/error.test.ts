import { expect, test } from 'vitest';
import { errorMessage } from '../src';

test('errorMessage returns .message for Error instances', () => {
  expect(errorMessage(new Error('boom'))).toBe('boom');
  expect(errorMessage(new TypeError('bad type'))).toBe('bad type');
});

test('errorMessage stringifies non-Error values', () => {
  expect(errorMessage('plain string')).toBe('plain string');
  expect(errorMessage(42)).toBe('42');
  expect(errorMessage(null)).toBe('null');
  expect(errorMessage(undefined)).toBe('undefined');
  expect(errorMessage({ code: 1 })).toBe('[object Object]');
});
