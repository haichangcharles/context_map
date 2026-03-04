/* eslint-disable @typescript-eslint/no-explicit-any */
import { Node, Pattern } from '../types';
import { BranchSuggestionDecision, parseBranchSuggestionDecision } from '../utils/branchSuggestion';

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const getOpenAICompatConfig = () => {
  const apiKey = process.env.SILICONFLOW_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('SILICONFLOW_API_KEY is not set');
  }

  const baseUrl = (process.env.SILICONFLOW_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-ai/DeepSeek-V3.2';
  return { apiKey, baseUrl, model };
};

const mapNodesToMessages = (contextNodes: Node[]): AnthropicMessage[] =>
  contextNodes.map(node => ({
    role: node.role === 'assistant' ? 'assistant' : 'user',
    content: node.content,
  }));

const callOpenAICompat = async (
  system: string,
  messages: AnthropicMessage[],
  responseFormat?: { type: 'json_object' }
): Promise<string> => {
  const { apiKey, baseUrl, model } = getOpenAICompatConfig();
  const payloadMessages = [{ role: 'system' as const, content: system }, ...messages];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: payloadMessages,
      max_tokens: 4096,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model API request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  return text || 'No response generated.';
};

const callOpenAICompatStream = async (
  system: string,
  messages: AnthropicMessage[],
  onDelta: (delta: string) => void
): Promise<string> => {
  const { apiKey, baseUrl, model } = getOpenAICompatConfig();
  const payloadMessages = [{ role: 'system' as const, content: system }, ...messages];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: payloadMessages,
      max_tokens: 4096,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model API stream request failed (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Streaming response body is empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const processEvent = (rawEvent: string) => {
    const dataLines = rawEvent
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    if (dataLines.length === 0) return false;

    const dataStr = dataLines.join('\n');
    if (dataStr === '[DONE]') {
      return true;
    }

    try {
      const payload = JSON.parse(dataStr);
      const deltaContent = payload?.choices?.[0]?.delta?.content;
      if (typeof deltaContent === 'string' && deltaContent.length > 0) {
        fullText += deltaContent;
        onDelta(deltaContent);
      }
    } catch {
      // Ignore malformed chunks and continue parsing stream.
    }
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');

    let boundaryIndex = buffer.indexOf('\n\n');
    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      boundaryIndex = buffer.indexOf('\n\n');
      if (processEvent(rawEvent)) {
        return fullText;
      }
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    processEvent(tail);
  }

  return fullText;
};

const parseJsonFromText = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    if (fenced) {
      return JSON.parse(fenced);
    }
    const objectLike = text.match(/\{[\s\S]*\}/)?.[0];
    if (objectLike) {
      return JSON.parse(objectLike);
    }
    throw new Error('Failed to parse JSON from model response.');
  }
};

export const generateResponse = async (
  systemPrompt: string,
  contextNodes: Node[],
  userMessage: string,
  activePattern: Pattern | null,
  activeStepIndex?: number
): Promise<string> => {
  let fullSystemPrompt = systemPrompt;
  if (activePattern) {
    fullSystemPrompt += `\n\n[STRICT WORKFLOW GUIDANCE]:\n${activePattern.guidance_text}`;
    if (activeStepIndex !== undefined && activeStepIndex < activePattern.steps.length) {
      fullSystemPrompt += `\n\nCURRENT STEP TO EXECUTE: ${activePattern.steps[activeStepIndex]}`;
    }
  }

  const messages = mapNodesToMessages(contextNodes);
  messages.push({
    role: 'user',
    content: userMessage,
  });

  try {
    return await callOpenAICompat(fullSystemPrompt, messages);
  } catch (error) {
    console.error('Error generating response:', error);
    throw error;
  }
};

export const generateResponseStream = async (
  systemPrompt: string,
  contextNodes: Node[],
  userMessage: string,
  activePattern: Pattern | null,
  onDelta: (delta: string) => void,
  activeStepIndex?: number
): Promise<string> => {
  let fullSystemPrompt = systemPrompt;
  if (activePattern) {
    fullSystemPrompt += `\n\n[STRICT WORKFLOW GUIDANCE]:\n${activePattern.guidance_text}`;
    if (activeStepIndex !== undefined && activeStepIndex < activePattern.steps.length) {
      fullSystemPrompt += `\n\nCURRENT STEP TO EXECUTE: ${activePattern.steps[activeStepIndex]}`;
    }
  }

  const messages = mapNodesToMessages(contextNodes);
  messages.push({
    role: 'user',
    content: userMessage,
  });

  try {
    return await callOpenAICompatStream(fullSystemPrompt, messages, onDelta);
  } catch (error) {
    console.error('Error streaming response:', error);
    throw error;
  }
};

export const generateMainlineSummary = async (contextNodes: Node[]): Promise<string> => {
  const messages = mapNodesToMessages(contextNodes);

  try {
    return await callOpenAICompat(
      'Summarize the current progress and main task of this conversation in 2-3 sentences. Focus on the core objective and what has been achieved so far.',
      messages
    );
  } catch (error) {
    console.error('Error generating summary:', error);
    return 'Failed to generate summary.';
  }
};

export const extractPattern = async (contextNodes: Node[]): Promise<{ name: string, guidance_text: string, steps: string[] }> => {
  const messages = mapNodesToMessages(contextNodes);

  try {
    const result = await callOpenAICompat(
      'Analyze the provided conversation and extract a reusable Standard Operating Procedure (SOP) or workflow pattern. Return strict JSON only with shape: {"name":"...","guidance_text":"...","steps":["..."]}.',
      messages
    );
    return parseJsonFromText(result);
  } catch (error) {
    console.error('Error extracting pattern:', error);
    throw error;
  }
};

export const detectBranchSuggestion = async (
  linearContextNodes: Node[],
  userMessage: string
): Promise<BranchSuggestionDecision> => {
  const messages = mapNodesToMessages(linearContextNodes);
  messages.push({
    role: 'user',
    content: userMessage,
  });

  const systemPrompt =
    'You decide whether the latest user message should open a new conversation branch from the previous message in a linear chat. ' +
    'Branch-worthy examples: temporary one-off Q&A, clearly off-topic requests (e.g., weather), or obvious subtasks detached from the current main objective. ' +
    'Return strict JSON only with shape: {"should_branch":boolean,"confidence":number,"reason":"short reason"}. ' +
    'Set confidence in [0,1].';

  try {
    const result = await callOpenAICompat(systemPrompt, messages, { type: 'json_object' });
    return parseBranchSuggestionDecision(result);
  } catch (error) {
    console.error('Error detecting branch suggestion:', error);
    return {
      shouldBranch: false,
      confidence: 0,
      reason: '',
    };
  }
};
