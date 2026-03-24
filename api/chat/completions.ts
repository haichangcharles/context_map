type ProviderPreference = 'auto' | 'siliconflow' | 'openai' | 'gemini';
type OpenAICompatConfig = { provider: 'siliconflow' | 'openai'; apiKey: string; baseUrl: string; model: string };
type GeminiConfig = { provider: 'gemini'; apiKey: string; baseUrl: string; model: string };
type ModelConfig = OpenAICompatConfig | GeminiConfig;

const normalizeProviderPreference = (raw: unknown): ProviderPreference => {
  if (raw === 'siliconflow' || raw === 'openai' || raw === 'gemini' || raw === 'auto') return raw;
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
  return { provider: 'openai' as const, apiKey, baseUrl, model };
};

const buildGeminiConfig = () => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const baseUrl = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  return { provider: 'gemini' as const, apiKey, baseUrl, model };
};

const getModelConfig = (providerPreference: ProviderPreference, openAIModelOverride = '') => {
  const siliconflow = { provider: 'siliconflow' as const, ...buildSiliconflowConfig() };
  const openai = buildOpenAIConfig(openAIModelOverride);
  const gemini = buildGeminiConfig();

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

const normalizeOpenAICompatBody = (body: Record<string, unknown>) => {
  const normalized = { ...body };
  if (
    typeof normalized.max_completion_tokens !== 'number' &&
    typeof normalized.max_tokens === 'number'
  ) {
    normalized.max_completion_tokens = normalized.max_tokens;
  }
  delete normalized.max_tokens;
  return normalized;
};

const buildGeminiPayload = (body: Record<string, unknown>, config: GeminiConfig) => {
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
  if (typeof maxOutputTokens === 'number') {
    generationConfig.maxOutputTokens = maxOutputTokens;
  }
  if (responseFormat?.type === 'json_object') {
    generationConfig.responseMimeType = 'application/json';
  }
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

const sendGeminiResponseAsOpenAIShape = async (upstream: Response, res: any) => {
  const data = await upstream.json();
  const text = extractGeminiText(data);
  res.status(upstream.status);
  res.setHeader('Content-Type', 'application/json');
  res.send({
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
  let config: ModelConfig;
  try {
    config = getModelConfig(providerPreference, openAIModelOverride);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Server config error' });
    return;
  }

  let upstream: Response;
  try {
    if (config.provider === 'gemini') {
      if (body.stream === true) {
        res.status(400).json({ error: 'Gemini provider does not support streaming in this endpoint.' });
        return;
      }
      const { url, payload } = buildGeminiPayload(body, config);
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
        ...normalizeOpenAICompatBody(body),
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
    res.status(502).json({ error: 'Upstream request failed' });
    return;
  }

  if (config.provider === 'gemini') {
    if (!upstream.ok) {
      const errorText = await upstream.text();
      res.status(upstream.status).send(errorText);
      return;
    }
    await sendGeminiResponseAsOpenAIShape(upstream, res);
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
