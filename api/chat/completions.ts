type ProviderPreference = 'auto' | 'siliconflow' | 'openai';

const normalizeProviderPreference = (raw: unknown): ProviderPreference => {
  if (raw === 'siliconflow' || raw === 'openai' || raw === 'auto') return raw;
  return 'auto';
};

const resolveProviderPreference = (req: any): ProviderPreference => {
  const headerValue = req?.headers?.['x-model-provider'];
  const picked = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const fromHeader = normalizeProviderPreference(typeof picked === 'string' ? picked.trim().toLowerCase() : '');
  if (fromHeader !== 'auto') return fromHeader;
  const fromEnv = normalizeProviderPreference((process.env.DEFAULT_MODEL_PROVIDER || '').trim().toLowerCase());
  return fromEnv;
};

const resolveOpenAIModelOverride = (req: any): string => {
  const headerValue = req?.headers?.['x-openai-model'];
  const picked = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof picked !== 'string') return '';
  return picked.trim();
};

const buildSiliconflowConfig = () => {
  const apiKey = process.env.SILICONFLOW_API_KEY || '';
  const baseUrl = (process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  const model = process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || 'deepseek-ai/DeepSeek-V3.2';
  return { apiKey, baseUrl, model };
};

const buildOpenAIConfig = (modelOverride = '') => {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = modelOverride || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return { apiKey, baseUrl, model };
};

const getModelConfig = (providerPreference: ProviderPreference, openAIModelOverride = '') => {
  const siliconflow = buildSiliconflowConfig();
  const openai = buildOpenAIConfig(openAIModelOverride);

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

const parseBody = (rawBody: unknown) => {
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  }
  if (rawBody && typeof rawBody === 'object') return rawBody as Record<string, unknown>;
  return null;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = parseBody(req.body);
  if (!body) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const providerPreference = resolveProviderPreference(req);
  const openAIModelOverride = resolveOpenAIModelOverride(req);
  let config: ReturnType<typeof getModelConfig>;
  try {
    config = getModelConfig(providerPreference, openAIModelOverride);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Server config error' });
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
    res.status(502).json({ error: 'Upstream request failed' });
    return;
  }

  const contentType = upstream.headers.get('content-type') || 'application/json';
  const cacheControl = upstream.headers.get('cache-control');

  res.status(upstream.status);
  res.setHeader('Content-Type', contentType);
  if (cacheControl) {
    res.setHeader('Cache-Control', cacheControl);
  }

  if (!upstream.body) {
    const text = await upstream.text();
    res.send(text);
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
    res.end();
  } catch {
    res.end();
  }
}
