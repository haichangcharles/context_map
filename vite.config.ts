import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

type ProviderPreference = 'auto' | 'siliconflow' | 'openai' | 'gemini';
type OpenAICompatConfig = { provider: 'siliconflow' | 'openai'; apiKey: string; baseUrl: string; model: string };
type GeminiConfig = { provider: 'gemini'; apiKey: string; baseUrl: string; model: string };
type ModelConfig = OpenAICompatConfig | GeminiConfig;

const normalizeProviderPreference = (raw: unknown): ProviderPreference => {
  if (raw === 'siliconflow' || raw === 'openai' || raw === 'gemini' || raw === 'auto') return raw;
  return 'auto';
};

const resolveProviderPreference = (
  req: { headers: Record<string, string | string[] | undefined> },
  env: Record<string, string>
): ProviderPreference => {
  const headerValue = req.headers['x-model-provider'];
  const picked = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const fromHeader = normalizeProviderPreference(typeof picked === 'string' ? picked.trim().toLowerCase() : '');
  if (fromHeader !== 'auto') return fromHeader;
  return normalizeProviderPreference((env.DEFAULT_MODEL_PROVIDER || '').trim().toLowerCase());
};

const resolveOpenAIModelOverride = (req: {
  headers: Record<string, string | string[] | undefined>;
}): string => {
  const headerValue = req.headers['x-openai-model'];
  const picked = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return typeof picked === 'string' ? picked.trim() : '';
};

const buildSiliconflowConfig = (env: Record<string, string>) => {
  const apiKey = env.SILICONFLOW_API_KEY || '';
  const baseUrl = (env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  const model = env.DEEPSEEK_MODEL || env.OPENAI_MODEL || 'deepseek-ai/DeepSeek-V3.2';
  return { provider: 'siliconflow' as const, apiKey, baseUrl, model };
};

const buildOpenAIConfig = (env: Record<string, string>, modelOverride = '') => {
  const apiKey = env.OPENAI_API_KEY || '';
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = modelOverride || env.OPENAI_MODEL || 'gpt-4o-mini';
  return { provider: 'openai' as const, apiKey, baseUrl, model };
};

const buildGeminiConfig = (env: Record<string, string>) => {
  const apiKey = env.GEMINI_API_KEY || '';
  const baseUrl = (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const model = env.GEMINI_MODEL || 'gemini-3-flash-preview';
  return { provider: 'gemini' as const, apiKey, baseUrl, model };
};

const getModelConfig = (
  env: Record<string, string>,
  providerPreference: ProviderPreference,
  openAIModelOverride = ''
) => {
  const siliconflow = buildSiliconflowConfig(env);
  const openai = buildOpenAIConfig(env, openAIModelOverride);
  const gemini = buildGeminiConfig(env);

  if (providerPreference === 'siliconflow') {
    if (!siliconflow.apiKey) throw new Error('Missing SILICONFLOW_API_KEY for siliconflow provider.');
    return siliconflow;
  }
  if (providerPreference === 'openai') {
    if (!openai.apiKey) throw new Error('Missing OPENAI_API_KEY for openai provider.');
    return openai;
  }
  if (providerPreference === 'gemini') {
    if (!gemini.apiKey) throw new Error('Missing GEMINI_API_KEY for gemini provider.');
    return gemini;
  }

  if (siliconflow.apiKey) return siliconflow;
  if (openai.apiKey) return openai;
  if (gemini.apiKey) return gemini;
  throw new Error('Missing model API key. Set SILICONFLOW_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
};

const sendJson = (res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void }, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const readJsonBody = async (req: {
  on: (event: 'data' | 'end' | 'error', handler: (chunk?: Buffer) => void) => void;
}): Promise<Record<string, unknown> | null> => {
  const chunks: Buffer[] = [];
  return await new Promise((resolve) => {
    req.on('data', (chunk?: Buffer) => {
      if (chunk) chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
};

const buildGeminiPayload = (env: Record<string, string>, body: Record<string, unknown>, config: GeminiConfig) => {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages.filter(
    (message): message is { role: string; content: string } =>
      !!message &&
      typeof message === 'object' &&
      typeof (message as Record<string, unknown>).role === 'string' &&
      typeof (message as Record<string, unknown>).content === 'string'
  );

  const systemMessage = messages.find((message) => message.role === 'system');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  const responseFormat = body.response_format as
    | { type?: string; json_schema?: unknown }
    | undefined;
  const maxOutputTokens =
    typeof body.max_completion_tokens === 'number'
      ? body.max_completion_tokens
      : typeof body.max_tokens === 'number'
        ? body.max_tokens
        : undefined;

  const generationConfig: Record<string, unknown> = {};
  if (typeof maxOutputTokens === 'number') generationConfig.maxOutputTokens = maxOutputTokens;
  if (responseFormat?.type === 'json_object') generationConfig.responseMimeType = 'application/json';
  if (responseFormat?.type === 'json_schema') {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseJsonSchema = responseFormat.json_schema;
  }

  return {
    url: `${config.baseUrl}/models/${config.model}:generateContent`,
    payload: {
      ...(systemMessage
        ? {
            systemInstruction: {
              parts: [{ text: systemMessage.content }],
            },
          }
        : {}),
      contents,
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    },
  };
};

const extractGeminiText = (data: any): string => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('');
};

const createChatCompletionsDevPlugin = (env: Record<string, string>): Plugin => ({
  name: 'dev-chat-completions-middleware',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/chat/completions')) {
        next();
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      const body = await readJsonBody(req);
      if (!body) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const providerPreference = resolveProviderPreference(req, env);
      const openAIModelOverride = resolveOpenAIModelOverride(req);
      let config: ModelConfig;
      try {
        config = getModelConfig(env, providerPreference, openAIModelOverride);
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Server config error' });
        return;
      }

      let upstream: Response;
      try {
        if (config.provider === 'gemini') {
          if (body.stream === true) {
            sendJson(res, 400, { error: 'Gemini provider does not support streaming in this endpoint.' });
            return;
          }
          const { url, payload } = buildGeminiPayload(env, body, config);
          upstream = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey,
            },
            body: JSON.stringify(payload),
          });
        } else {
          const upstreamPayload = {
            model: config.model,
            ...body,
          };

          upstream = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(upstreamPayload),
          });
        }
      } catch {
        sendJson(res, 502, { error: 'Upstream request failed' });
        return;
      }

      if (config.provider === 'gemini') {
        if (!upstream.ok) {
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(await upstream.text());
          return;
        }

        const data = await upstream.json();
        const text = extractGeminiText(data);
        sendJson(res, upstream.status, {
          id: data?.responseId || null,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: data?.modelVersion || data?.model || 'gemini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: text,
              },
              finish_reason: data?.candidates?.[0]?.finishReason?.toLowerCase?.() || 'stop',
            },
          ],
          usage: data?.usageMetadata || null,
        });
        return;
      }

      res.statusCode = upstream.status;
      const contentType = upstream.headers.get('content-type');
      const cacheControl = upstream.headers.get('cache-control');
      if (contentType) res.setHeader('Content-Type', contentType);
      if (cacheControl) res.setHeader('Cache-Control', cacheControl);

      if (!upstream.body) {
        res.end(await upstream.text());
        return;
      }

      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            res.write(Buffer.from(value));
          }
        }
      } finally {
        res.end();
      }
    });
  },
});

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), createChatCompletionsDevPlugin(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR can be disabled via DISABLE_HMR env var in constrained environments.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
