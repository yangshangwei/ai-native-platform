import { describe, expect, test } from 'vitest';
import { parseContextRequestFromAgentOutput } from '../src/context/request';

describe('ContextRequest parser', () => {
  test('parses a fenced JSON context_request from the last message', () => {
    const parsed = parseContextRequestFromAgentOutput({
      workflowRunId: 'run_ctxreq',
      stepRunId: 'step_impl',
      stage: 'implementation',
      now: '2026-05-09T00:00:00.000Z',
      idFactory: () => 'ctxreq_generated',
      sources: [
        {
          name: 'last_message',
          text: [
            'Need more platform context.',
            '```json',
            JSON.stringify({
              context_request: {
                reason: 'Need the API runner event route before adding persistence.',
                requestedRefs: ['code:apps/api/src/routes/runner-events.ts'],
                questions: ['Which route should record context_request actions?'],
                priority: 1,
              },
            }),
            '```',
          ].join('\n'),
        },
      ],
    });

    expect(parsed).toMatchObject({
      sourceName: 'last_message',
      request: {
        id: 'ctxreq_generated',
        workflowRunId: 'run_ctxreq',
        stepRunId: 'step_impl',
        stage: 'implementation',
        priority: 1,
        status: 'open',
        requestedRefs: ['code:apps/api/src/routes/runner-events.ts'],
      },
    });
  });

  test('parses a narrow fenced YAML subset but ignores prose-only requests', () => {
    const proseOnly = parseContextRequestFromAgentOutput({
      workflowRunId: 'run_ctxreq',
      stage: 'review',
      sources: [
        {
          name: 'last_message',
          text: 'context_request: please inspect the diff',
        },
      ],
      idFactory: () => 'ctxreq_ignored',
    });
    expect(proseOnly).toBeNull();

    const parsed = parseContextRequestFromAgentOutput({
      workflowRunId: 'run_ctxreq',
      stage: 'review',
      now: '2026-05-09T00:00:00.000Z',
      idFactory: () => 'ctxreq_yaml',
      sources: [
        {
          name: 'review.md',
          text: [
            '```yaml',
            'context_request:',
            '  reason: Need the latest diff artifact before reviewing.',
            '  requestedRefs:',
            '    - artifact:art_diff',
            '  questions:',
            '    - What files changed in the implementation step?',
            '  priority: 2',
            '```',
          ].join('\n'),
        },
      ],
    });

    expect(parsed?.request).toMatchObject({
      id: 'ctxreq_yaml',
      priority: 2,
      requestedRefs: ['artifact:art_diff'],
      questions: ['What files changed in the implementation step?'],
    });
  });

  test('ignores malformed or non-fenced context_request payloads conservatively', () => {
    const base = {
      workflowRunId: 'run_ctxreq',
      stage: 'implementation' as const,
      idFactory: () => 'ctxreq_should_not_parse',
    };

    expect(parseContextRequestFromAgentOutput({
      ...base,
      sources: [
        {
          name: 'last_message',
          text: JSON.stringify({
            context_request: {
              reason: 'Raw JSON in the last message is not the prompt contract.',
              requestedRefs: ['code:apps/runner/src/context/request.ts'],
            },
          }),
        },
      ],
    })).toBeNull();

    expect(parseContextRequestFromAgentOutput({
      ...base,
      sources: [
        {
          name: 'last_message',
          text: [
            '```json',
            '{"context_request":{"reason":"truncated","requestedRefs":["code:x"]',
            '```',
          ].join('\n'),
        },
      ],
    })).toBeNull();

    expect(parseContextRequestFromAgentOutput({
      ...base,
      sources: [
        {
          name: 'last_message',
          text: [
            '```yaml',
            'reason: Missing the context_request root.',
            'requestedRefs:',
            '  - code:x',
            '```',
          ].join('\n'),
        },
      ],
    })).toBeNull();

    expect(parseContextRequestFromAgentOutput({
      ...base,
      sources: [
        {
          name: 'last_message',
          text: [
            '```yaml',
            'context_request:',
            'reason: Missing indentation under root.',
            'requestedRefs:',
            '  - code:x',
            '```',
          ].join('\n'),
        },
      ],
    })).toBeNull();
  });

  test('rejects invalid array and priority fields instead of partially coercing them', () => {
    const parsed = parseContextRequestFromAgentOutput({
      workflowRunId: 'run_ctxreq',
      stage: 'implementation',
      idFactory: () => 'ctxreq_invalid',
      sources: [
        {
          name: 'context_request.json',
          text: JSON.stringify({
            context_request: {
              reason: 'Need code context.',
              requestedRefs: ['code:ok', 42],
              questions: ['Which module owns this?'],
              priority: 9,
            },
          }),
        },
      ],
    });

    expect(parsed).toBeNull();
  });

  test('parses raw JSON only from JSON artifact sources', () => {
    const parsed = parseContextRequestFromAgentOutput({
      workflowRunId: 'run_ctxreq',
      stepRunId: 'step_impl',
      stage: 'implementation',
      now: '2026-05-09T00:00:00.000Z',
      idFactory: () => 'ctxreq_json_artifact',
      sources: [
        {
          name: 'context_request.json',
          text: JSON.stringify({
            context_request: {
              reason: 'Need the route artifact.',
              requestedRefs: ['artifact:runner-events'],
              priority: 1,
            },
          }),
        },
      ],
    });

    expect(parsed?.request).toMatchObject({
      id: 'ctxreq_json_artifact',
      requestedRefs: ['artifact:runner-events'],
      priority: 1,
    });
  });
});
