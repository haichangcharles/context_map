import assert from 'node:assert/strict';
import { extractPatternByType } from '../src/services/gemini';
import type { Node } from '../src/types';

const contextNodes: Node[] = [
  {
    node_id: 'n1',
    project_id: 'project-1',
    parent_id: null,
    role: 'user',
    content: 'Summarize the project state and propose next steps.',
    branch_id: null,
    timestamp: '2026-03-07T21:00:00.000Z',
    metadata: {},
  },
  {
    node_id: 'n2',
    project_id: 'project-1',
    parent_id: 'n1',
    role: 'assistant',
    content: 'I will first summarize progress, then list blockers, then propose next actions.',
    branch_id: null,
    timestamp: '2026-03-07T21:00:01.000Z',
    metadata: {},
  },
];

const run = async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const parsedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    requestBodies.push(parsedBody);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'State Summary Loop',
                requires_human_review: false,
                instruction: 'Summarize current state, identify blockers, then propose next actions.',
                example: 'Summarize status before recommending follow-up work.',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const extracted = await extractPatternByType(contextNodes, 'task_sop');
    assert.equal(extracted.name, 'State Summary Loop');
    assert.equal(requestBodies.length, 1);

    const responseFormat = requestBodies[0]?.response_format as { type?: string } | undefined;
    assert.equal(responseFormat?.type, 'json_object');

    const messages = requestBodies[0]?.messages as Array<{ role?: string; content?: string }> | undefined;
    assert.equal(messages?.length, 2);
    assert.equal(messages?.[0]?.role, 'system');
    assert.equal(messages?.[1]?.role, 'user');
    const transcriptPrompt = messages?.[1]?.content || '';
    assert.ok(transcriptPrompt.includes('Conversation transcript:'));
    assert.ok(transcriptPrompt.includes('1. User: Summarize the project state and propose next steps.'));
    assert.ok(transcriptPrompt.includes('2. Assistant: I will first summarize progress, then list blockers, then propose next actions.'));

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    await assert.rejects(
      () => extractPatternByType(contextNodes, 'context_case'),
      /Pattern extraction returned empty content/
    );

    console.log('Pattern extraction transcript/json_object tests passed.');
  } finally {
    globalThis.fetch = originalFetch;
  }
};

void run();
