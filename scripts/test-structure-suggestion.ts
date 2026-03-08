import assert from 'node:assert/strict';
import { detectStructureSuggestion } from '../src/services/gemini';
import { parseStructureSuggestionDecision } from '../src/utils/structureSuggestion';

const run = async () => {
  const parsed = parseStructureSuggestionDecision(
    JSON.stringify({
      primary_action: 'return_parent',
      asset_action: 'extract_task_sop',
      confidence: 0.82,
      reason: 'The branch seems to have produced a usable intermediate result.',
      asset_reason: 'The branch contains a reusable step sequence.',
      show_suggestion: true,
    })
  );

  assert.equal(parsed.primaryAction, 'return_parent');
  assert.equal(parsed.assetAction, 'extract_task_sop');
  assert.equal(parsed.confidence, 0.82);
  assert.equal(parsed.showSuggestion, true);

  const fallback = parseStructureSuggestionDecision('not-json');
  assert.equal(fallback.primaryAction, 'continue');
  assert.equal(fallback.assetAction, 'none');
  assert.equal(fallback.showSuggestion, false);

  const originalFetch = globalThis.fetch;
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: any = null;

  const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
    capturedBody = JSON.parse(String(init?.body || '{}'));

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                primary_action: 'branch',
                asset_action: 'extract_task_sop',
                confidence: 0.82,
                reason: 'A side task should branch.',
                asset_reason: 'Workflow is reusable.',
                show_suggestion: true,
              }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  }) as typeof globalThis.fetch;

  globalThis.fetch = mockFetch;

  try {
    const decision = await detectStructureSuggestion([], 'Compare analytics pricing before finalizing the memo.', {
      currentMode: 'mainline',
      branchDepth: 0,
      currentBranchIntent: 'Launch recommendation memo',
    });

    assert.equal(capturedHeaders['x-model-provider'], 'gemini');
    assert.equal(capturedBody.response_format.type, 'json_schema');
    assert.equal(capturedBody.response_format.json_schema.type, 'object');
    assert.equal(decision.primaryAction, 'branch');
    assert.equal(decision.assetAction, 'extract_task_sop');
    assert.equal(decision.showSuggestion, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  let explicitFetchCalled = false;
  globalThis.fetch = (async () => {
    explicitFetchCalled = true;
    throw new Error('explicit intent path should not hit fetch');
  }) as typeof globalThis.fetch;

  try {
    const explicit = await detectStructureSuggestion([], '我需要返回上一个级别，并且帮我抽取 SOP。', {
      currentMode: 'branch',
      branchDepth: 1,
      currentBranchIntent: '整理 launch readiness 流程',
    });

    assert.equal(explicit.primaryAction, 'return_parent');
    assert.equal(explicit.assetAction, 'extract_task_sop');
    assert.equal(explicit.showSuggestion, true);
    assert.equal(explicitFetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  explicitFetchCalled = false;
  globalThis.fetch = (async () => {
    explicitFetchCalled = true;
    throw new Error('explicit branch+extract path should not hit fetch');
  }) as typeof globalThis.fetch;

  try {
    const explicitBranchExtract = await detectStructureSuggestion([], '请给我开branch，然后总结SOP。', {
      currentMode: 'mainline',
      branchDepth: 0,
      currentBranchIntent: 'context-map MVP',
    });

    assert.equal(explicitBranchExtract.primaryAction, 'branch');
    assert.equal(explicitBranchExtract.assetAction, 'extract_task_sop');
    assert.equal(explicitBranchExtract.showSuggestion, true);
    assert.equal(explicitFetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Structure suggestion tests passed.');
};

await run();
