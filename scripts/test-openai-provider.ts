import assert from 'node:assert/strict';

const originalEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  DEFAULT_MODEL_PROVIDER: process.env.DEFAULT_MODEL_PROVIDER,
};

process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
process.env.OPENAI_MODEL = 'gpt-5.3-chat-latest';
process.env.DEFAULT_MODEL_PROVIDER = 'openai';

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
        id: 'chatcmpl_test',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-5.3-chat-latest',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
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
        'x-model-provider': 'openai',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 123,
        stream: true,
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
    assert.equal(capturedUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(capturedHeaders.authorization, 'Bearer test-openai-key');
    assert.equal(capturedBody.model, 'gpt-5.3-chat-latest');
    assert.equal(capturedBody.max_completion_tokens, 123);
    assert.equal('max_tokens' in capturedBody, false);

    const responseText = Buffer.concat(chunks).toString('utf8');
    const payload = JSON.parse(responseText);
    assert.equal(payload.choices[0].message.content, 'ok');

    console.log('OpenAI provider payload normalization tests passed.');
  } finally {
    global.fetch = originalFetch;
  }
};

try {
  await run();
} finally {
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL;
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL;
  process.env.DEFAULT_MODEL_PROVIDER = originalEnv.DEFAULT_MODEL_PROVIDER;
}
