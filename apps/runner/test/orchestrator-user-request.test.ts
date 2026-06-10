import { describe, expect, test } from 'vitest';
import {
  agentTaskBriefForContext,
  agentUserRequestForOrchestrate,
} from '../src/orchestrator';

describe('orchestrator agent user request selection', () => {
  test('defaults direct runner orchestrate calls to the title-only request', () => {
    expect(agentUserRequestForOrchestrate({ title: 'Build import workflow' })).toBe(
      'Build import workflow',
    );
  });

  test('uses the clarified request for agent inputs without changing the run title', () => {
    const title = 'Build import workflow';
    const clarified = [
      'Original request title:',
      title,
      '',
      'Clarification conversation:',
      '1. User: I need importing from CSV.',
      '2. Coordinator: Which columns and validation rules matter?',
      '3. User: Name and email are required; duplicates should be skipped.',
    ].join('\n');

    expect(agentUserRequestForOrchestrate({ title, userRequest: clarified })).toBe(clarified);
    expect(title).toBe('Build import workflow');
  });

  test('builds ContextPack task briefs from inputs.user_request', () => {
    const clarified = 'Clarified task brief with later user replies.';

    expect(agentTaskBriefForContext('Original request title', {
      user_request: clarified,
    })).toBe(clarified);
  });

  test('falls back to the original title when the clarified input is blank', () => {
    expect(agentTaskBriefForContext('Original request title', {
      user_request: '   ',
    })).toBe('Original request title');
  });
});
