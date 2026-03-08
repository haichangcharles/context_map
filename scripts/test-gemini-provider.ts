import assert from 'node:assert/strict';

const originalEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
};

process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
process.env.GEMINI_MODEL = 'gemini-3-flash-preview';

const handlerModule = await import('../api/chat/completions.ts');
const handler = handlerModule.default;

const run = async () => {
  const originalFetch = global.fetch;
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: any = null;

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedHeaders = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) || {}).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ])
    );
    capturedBody = JSON.parse(String(init?.body || '{}'));

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  text: JSON.stringify({
                    primary_action: 'branch',
                    asset_action: 'none',
                    confidence: 0.91,
                    reason: 'Side investigation should branch.',
                    asset_reason: '',
                    show_suggestion: true,
                  }),
                },
              ],
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  }) as typeof global.fetch;

  try {
    const req = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-model-provider': 'gemini',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Return strict JSON only.' },
          { role: 'user', content: 'Mainline task is launch recommendation.' },
          { role: 'assistant', content: 'Current branch is launch memo outline.' },
          { role: 'user', content: 'Before that, compare Mixpanel and Amplitude pricing.' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            type: 'object',
            properties: {
              primary_action: { type: 'string' },
              asset_action: { type: 'string' },
              confidence: { type: 'number' },
              reason: { type: 'string' },
              asset_reason: { type: 'string' },
              show_suggestion: { type: 'boolean' },
            },
            required: [
              'primary_action',
              'asset_action',
              'confidence',
              'reason',
              'asset_reason',
              'show_suggestion',
            ],
          },
        },
      }),
    };

    let statusCode = 200;
    const responseHeaders = new Map<string, string>();
    const chunks: Buffer[] = [];

    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      setHeader(key: string, value: string) {
        responseHeaders.set(key.toLowerCase(), value);
      },
      write(chunk: Buffer | string) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      },
      end(chunk?: Buffer | string) {
        if (chunk) this.write(chunk);
      },
      json(payload: unknown) {
        this.setHeader('content-type', 'application/json');
        this.end(JSON.stringify(payload));
      },
      send(payload: unknown) {
        if (typeof payload === 'object') {
          this.setHeader('content-type', 'application/json');
          this.end(JSON.stringify(payload));
          return;
        }
        this.end(String(payload));
      },
    };

    await handler(req, res);

    assert.equal(statusCode, 200);
    assert.equal(
      capturedUrl,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent'
    );
    assert.equal(capturedHeaders['x-goog-api-key'], 'test-gemini-key');
    assert.equal(capturedBody.systemInstruction.parts[0].text, 'Return strict JSON only.');
    assert.equal(capturedBody.contents.length, 3);
    assert.equal(capturedBody.contents[0].role, 'user');
    assert.equal(capturedBody.contents[1].role, 'model');
    assert.equal(capturedBody.contents[2].role, 'user');
    assert.equal(capturedBody.generationConfig.responseMimeType, 'application/json');
    assert.equal(capturedBody.generationConfig.responseJsonSchema.type, 'object');

    const responseText = Buffer.concat(chunks).toString('utf8');
    const payload = JSON.parse(responseText);
    assert.equal(payload.choices[0].message.content.includes('"primary_action":"branch"'), true);

    console.log('Gemini provider translation tests passed.');
  } finally {
    global.fetch = originalFetch;
  }
};

try {
  await run();
} finally {
  process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
  process.env.GEMINI_BASE_URL = originalEnv.GEMINI_BASE_URL;
  process.env.GEMINI_MODEL = originalEnv.GEMINI_MODEL;
}
