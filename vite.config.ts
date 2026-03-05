import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

type ProviderPreference = 'auto' | 'siliconflow' | 'openai';

const normalizeProviderPreference = (raw: unknown): ProviderPreference => {
  if (raw === 'siliconflow' || raw === 'openai' || raw === 'auto') return raw;
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
  return { apiKey, baseUrl, model };
};

const buildOpenAIConfig = (env: Record<string, string>, modelOverride = '') => {
  const apiKey = env.OPENAI_API_KEY || '';
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = modelOverride || env.OPENAI_MODEL || 'gpt-4o-mini';
  return { apiKey, baseUrl, model };
};

const getModelConfig = (
  env: Record<string, string>,
  providerPreference: ProviderPreference,
  openAIModelOverride = ''
) => {
  const siliconflow = buildSiliconflowConfig(env);
  const openai = buildOpenAIConfig(env, openAIModelOverride);

  if (providerPreference === 'siliconflow') {
    if (!siliconflow.apiKey) throw new Error('Missing SILICONFLOW_API_KEY for siliconflow provider.');
    return siliconflow;
  }
  if (providerPreference === 'openai') {
    if (!openai.apiKey) throw new Error('Missing OPENAI_API_KEY for openai provider.');
    return openai;
  }

  if (siliconflow.apiKey) return siliconflow;
  if (openai.apiKey) return openai;
  throw new Error('Missing model API key. Set SILICONFLOW_API_KEY or OPENAI_API_KEY.');
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
      let config: { apiKey: string; baseUrl: string; model: string };
      try {
        config = getModelConfig(env, providerPreference, openAIModelOverride);
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Server config error' });
        return;
      }

      const upstreamPayload = {
        model: config.model,
        ...body,
      };

      let upstream: Response;
      try {
        upstream = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(upstreamPayload),
        });
      } catch {
        sendJson(res, 502, { error: 'Upstream request failed' });
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
