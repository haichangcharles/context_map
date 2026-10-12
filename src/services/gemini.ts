/* eslint-disable @typescript-eslint/no-explicit-any */
import { Node, PatternType } from '../types';
import { BranchSuggestionDecision, parseBranchSuggestionDecision } from '../utils/branchSuggestion';
import { buildStructureSuggestionSystemPrompt } from '../utils/promptBuilders';
import { StructureSuggestionDecision, parseStructureSuggestionDecision } from '../utils/structureSuggestion';
import { appendDeltaWithinLimit } from './streamLimit';
import { getModelProviderPreference, getOpenAIModelOverride } from './modelProvider';
import {
  formatUserModelForStructureAgent,
  getUserModelFeatureEnabled,
  readUserModel,
} from './userModel';
import { getActiveUserId } from '../utils/branchFeedbackDataset';

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type JsonObjectResponseFormat = { type: 'json_object' };
type JsonSchemaResponseFormat = { type: 'json_schema'; json_schema: Record<string, unknown> };
type ResponseFormat = JsonObjectResponseFormat | JsonSchemaResponseFormat;

const JSON_OBJECT_RESPONSE_FORMAT: JsonObjectResponseFormat = { type: 'json_object' };

const mapNodesToMessages = (contextNodes: Node[]): AnthropicMessage[] =>
  contextNodes.map(node => ({
    role: node.role === 'assistant' ? 'assistant' : 'user',
    content: node.content,
  }));

const callOpenAICompat = async (
  system: string,
  messages: AnthropicMessage[],
  responseFormat?: ResponseFormat,
): Promise<string> => {
  const payloadMessages = [{ role: 'system' as const, content: system }, ...messages];

  const response = await fetch('/api/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-model-provider': getModelProviderPreference(),
      'x-openai-model': getOpenAIModelOverride(),
    },
    body: JSON.stringify({
      messages: payloadMessages,
      max_completion_tokens: 4096,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model API request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text : 'No response generated.';
};

const callOpenAICompatStream = async (
  system: string,
  messages: AnthropicMessage[],
  onDelta: (delta: string) => void,
  options?: {
    maxChars?: number;
    signal?: AbortSignal;
    onTruncated?: () => void;
  }
): Promise<string> => {
  const payloadMessages = [{ role: 'system' as const, content: system }, ...messages];
  let truncationEmitted = false;

  const response = await fetch('/api/chat/completions', {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-model-provider': getModelProviderPreference(),
      'x-openai-model': getOpenAIModelOverride(),
    },
    body: JSON.stringify({
      messages: payloadMessages,
      max_completion_tokens: 4096,
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
        const limited = appendDeltaWithinLimit(fullText, deltaContent, options?.maxChars);
        fullText = limited.nextText;
        if (limited.acceptedDelta) {
          onDelta(limited.acceptedDelta);
        }
        if (limited.truncated) {
          if (!truncationEmitted) {
            truncationEmitted = true;
            options?.onTruncated?.();
          }
          return true;
        }
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

type ExtractedPattern = {
  name: string;
  requires_human_review: boolean;
  instruction: string;
  example: string;
};

const PATTERN_TYPE_LABEL: Record<PatternType, string> = {
  reasoning: 'Reasoning',
  task_sop: 'Task SOP',
  context_case: 'Context Case',
};

const buildPatternExtractionTranscript = (contextNodes: Node[]): string =>
  contextNodes
    .map((node, index) => {
      const speaker = node.role === 'assistant' ? 'Assistant' : node.role === 'system' ? 'System' : 'User';
      return `${index + 1}. ${speaker}: ${node.content}`;
    })
    .join('\n');

const PATTERN_SYSTEM_PROMPTS: Record<PatternType, string> = {
  reasoning:
    'You are a prompt-extractor that derives a reusable, domain-agnostic REASONING SOP from a conversation.\n\n' +
    'Purpose: This protocol is meant to be appended to another LLM system prompt so future tasks follow the same reasoning style and step order.\n\n' +
    'Output MUST be valid JSON with exactly 4 keys: name, requires_human_review, instruction, example.\n' +
    '- name: 2-6 words, concise Title Case label.\n' +
    '- requires_human_review: boolean only (true or false).\n' +
    '- instruction: imperative, domain-agnostic, reusable reasoning SOP.\n' +
    '- example: a HIGH-LEVEL usage sketch only, not a concrete task instance.\n\n' +
    'Constraints:\n' +
    '- Keep domain-agnostic language.\n' +
    '- Prefer 5-7 steps embedded in a compact text block, not JSON arrays.\n' +
    '- The example exists only to clarify how the pattern should be reused later.\n' +
    '- Because this pattern will be appended to future prompts, a detailed example is dangerous: the model may overfit to the example and copy irrelevant task details.\n' +
    '- Therefore the example must stay abstract and reusable.\n' +
    '- Do NOT include concrete business context, names, dates, metrics, product details, customer counts, or scenario-specific facts in the example.\n' +
    '- Do NOT write the example as a ready-made answer template.\n' +
    '- The example should describe the role of the reasoning pattern at a high level, not instantiate a full task.\n' +
    '- Always return best effort.\n' +
    '- If the transcript is mostly fragmented one-off Q&A, unrelated topic hops, or shallow factual replies, do not pretend there is a strong reusable reasoning SOP.\n' +
    '- In those weak cases, set requires_human_review=true and explicitly explain that the extracted pattern is only a tentative conversational heuristic, not a validated SOP.\n' +
    '- If confidence is low, set requires_human_review=true and explicitly note uncertainty.\n' +
    '- If extraction is weak or incomplete, still return valid JSON and set requires_human_review=true.\n' +
    'Return only the JSON object.',
  task_sop:
    'You are a prompt-extractor that derives a reusable TASK SOP from a conversation.\n\n' +
    'Purpose: append this protocol to another LLM system prompt so when the same task type appears, the model follows a consistent procedure and checks.\n\n' +
    'Output MUST be valid JSON with exactly 4 keys: name, requires_human_review, instruction, example.\n' +
    '- name: 2-6 words, concise Title Case label.\n' +
    '- requires_human_review: boolean only (true or false).\n' +
    '- instruction: include required inputs, ordered steps, intermediate artifacts, and final quality checklist in compact text.\n' +
    '- example: a HIGH-LEVEL usage sketch only, showing when to apply the SOP, not a concrete filled-out case.\n\n' +
    'Constraints:\n' +
    '- Infer the most plausible task type from the conversation.\n' +
    '- The example is only a reuse hint for future prompts.\n' +
    '- Because future models may copy examples too literally, do NOT put concrete names, facts, dates, numbers, organizations, or scenario-specific content into the example.\n' +
    '- Do NOT write a detailed sample memo, detailed sample report, or task-specific answer body.\n' +
    '- The example should stay abstract: it should illustrate the kind of situation where the SOP applies, not provide a specific worked case.\n' +
    '- Always return best effort.\n' +
    '- Only produce a confident SOP when the conversation shows a repeatable workflow with stable steps.\n' +
    '- A transcript that only demonstrates direct factual answering or lightweight Q&A does not qualify as a strong task SOP by itself.\n' +
    '- If the transcript is ad hoc Q&A, mixed topics, or lacks a stable procedure, set requires_human_review=true and state that no reliable SOP was demonstrated.\n' +
    '- If task type is ambiguous or incomplete, set requires_human_review=true and phrase conservatively.\n' +
    '- If extraction is weak or incomplete, still return valid JSON and set requires_human_review=true.\n' +
    'Return only the JSON object.',
  context_case:
    'You are a prompt-extractor that compresses a conversation into a CONTEXT CASE for cross-session continuation.\n\n' +
    'Output MUST be valid JSON with exactly 4 keys: name, requires_human_review, instruction, example.\n' +
    '- name: 2-6 words, concise Title Case label.\n' +
    '- requires_human_review: boolean only (true or false).\n' +
    '- instruction: appendable context block including background, key points, current status, open questions, and next actions.\n' +
    '- example: a HIGH-LEVEL note about how a future LLM should consult this context, not a concrete continuation.\n\n' +
    'Constraints:\n' +
    '- Do not invent facts.\n' +
    '- Preserve only supported information.\n' +
    '- The example must remain abstract because concrete continuation examples can anchor future generations too strongly and distort the new task.\n' +
    '- Do NOT add new facts, names, deadlines, metrics, deliverables, or specific future dialogue in the example.\n' +
    '- Do NOT write a sample future answer.\n' +
    '- The example should only explain the intended reuse behavior at a high level.\n' +
    '- Always return best effort if any coherent thread exists.\n' +
    '- If the transcript mixes unrelated topics or lacks a single continuing objective, set requires_human_review=true and make that fragmentation explicit in the instruction.\n' +
    '- In fragmented cases, keep only the durable facts and avoid implying a stronger narrative continuity than the transcript supports.\n' +
    '- If ambiguous status or multiple threads, set requires_human_review=true and note ambiguity.\n' +
    '- If extraction is weak or incomplete, still return valid JSON and set requires_human_review=true.\n' +
    'Return only the JSON object.',
};

const buildFallbackPattern = (type: PatternType): ExtractedPattern => {
  const label = PATTERN_TYPE_LABEL[type];
  return {
    name: `${label} Draft`,
    requires_human_review: true,
    instruction:
      `This ${label} extraction is a conservative fallback because the source conversation was incomplete or ambiguous. ` +
      'Before operational use, review and refine this instruction with explicit constraints and steps.',
    example:
      'In a future turn, append this draft after the main system prompt, then manually verify whether each instruction line is still valid for the new task.',
  };
};

const sanitizeExtractedPattern = (raw: unknown, type: PatternType): ExtractedPattern => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return buildFallbackPattern(type);
  }
  const obj = raw as Record<string, unknown>;
  const allowedKeys = ['name', 'requires_human_review', 'instruction', 'example'];
  const hasOnlyAllowedKeys = Object.keys(obj).every((k) => allowedKeys.includes(k));
  const hasRequiredKeys = allowedKeys.every((k) => k in obj);
  if (!hasOnlyAllowedKeys || !hasRequiredKeys) {
    return buildFallbackPattern(type);
  }
  if (typeof obj.name !== 'string' || typeof obj.instruction !== 'string' || typeof obj.example !== 'string') {
    return buildFallbackPattern(type);
  }
  if (typeof obj.requires_human_review !== 'boolean') {
    return buildFallbackPattern(type);
  }
  return {
    name: obj.name.trim() || `${PATTERN_TYPE_LABEL[type]} Draft`,
    requires_human_review: obj.requires_human_review,
    instruction: obj.instruction.trim(),
    example: obj.example.trim(),
  };
};

export const generateResponse = async (
  systemPrompt: string,
  contextNodes: Node[],
  userMessage: string,
  patternPromptAppendix?: string
): Promise<string> => {
  let fullSystemPrompt = systemPrompt;
  if (patternPromptAppendix?.trim()) {
    fullSystemPrompt += `\n\n${patternPromptAppendix.trim()}`;
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
  patternPromptAppendix: string | undefined,
  onDelta: (delta: string) => void,
  options?: {
    maxChars?: number;
    signal?: AbortSignal;
    onTruncated?: () => void;
  }
): Promise<string> => {
  let fullSystemPrompt = systemPrompt;
  if (patternPromptAppendix?.trim()) {
    fullSystemPrompt += `\n\n${patternPromptAppendix.trim()}`;
  }

  const messages = mapNodesToMessages(contextNodes);
  messages.push({
    role: 'user',
    content: userMessage,
  });

  try {
    return await callOpenAICompatStream(fullSystemPrompt, messages, onDelta, options);
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

export const generateBranchSummary = async (branchNodes: Node[]): Promise<string> => {
  const messages = mapNodesToMessages(branchNodes);

  try {
    return await callOpenAICompat(
      'Summarize this branch conversation in 1-2 very brief sentences (30 words max). ' +
        'State only: (1) what question or intent motivated this branch, and (2) what key takeaway or conclusion it produced for the parent thread. ' +
        'Do NOT include intermediate steps, failed attempts, or implementation details.',
      messages
    );
  } catch (error) {
    console.error('Error generating branch summary:', error);
    return '';
  }
};

export const extractPatternByType = async (
  contextNodes: Node[],
  type: PatternType
): Promise<ExtractedPattern> => {
  const transcript = buildPatternExtractionTranscript(contextNodes);
  const promptInput = [
    'Conversation transcript:',
    transcript,
    '',
    'Return JSON only with keys: name, requires_human_review, instruction, example.',
  ].join('\n');

  try {
    const result = await callOpenAICompat(
      PATTERN_SYSTEM_PROMPTS[type],
      [{ role: 'user', content: promptInput }],
      JSON_OBJECT_RESPONSE_FORMAT
    );
    if (!result.trim()) {
      throw new Error('Pattern extraction returned empty content.');
    }
    const parsed = parseJsonFromText(result);
    return sanitizeExtractedPattern(parsed, type);
  } catch (error) {
    console.error('Error extracting pattern:', error);
    throw error instanceof Error ? error : new Error(`Failed to extract ${PATTERN_TYPE_LABEL[type]} pattern.`);
  }
};

export const detectBranchSuggestion = async (
  linearContextNodes: Node[],
  userMessage: string,
  detectionContext?: {
    currentMode: 'mainline' | 'branch';
    branchDepth: number;
    currentBranchIntent?: string;
    parentContextTLDR?: string;
    mainlineTLDR?: string;
    totalBranchCount?: number;
    activeBranchCount?: number;
    recentBranchIntents?: string[];
  }
): Promise<BranchSuggestionDecision> => {
  const messages = mapNodesToMessages(linearContextNodes);
  messages.push({
    role: 'user',
    content: userMessage,
  });

  const contextLines = [
    `Current mode: ${detectionContext?.currentMode || 'mainline'}.`,
    `Branch depth: ${detectionContext?.branchDepth ?? 0}.`,
    detectionContext?.currentBranchIntent
      ? `Current branch intent: ${detectionContext.currentBranchIntent}`
      : '',
    detectionContext?.parentContextTLDR ? `Parent context TLDR: ${detectionContext.parentContextTLDR}` : '',
    detectionContext?.mainlineTLDR ? `Mainline TLDR: ${detectionContext.mainlineTLDR}` : '',
    typeof detectionContext?.totalBranchCount === 'number'
      ? `Total branches in project: ${detectionContext.totalBranchCount}.`
      : '',
    typeof detectionContext?.activeBranchCount === 'number'
      ? `Active branches: ${detectionContext.activeBranchCount}.`
      : '',
    detectionContext?.recentBranchIntents?.length
      ? `Recent branch intents: ${detectionContext.recentBranchIntents.join(' || ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const systemPrompt =
    'You decide whether the latest user message should open a new conversation branch from the previous message in a linear chat. ' +
    'Primary criterion: compare message against CURRENT branch topic first; only secondarily consider parent/mainline context. ' +
    'Use cognitive workload awareness: when branches already exist, avoid creating new branches casually. ' +
    'If a message fits an existing off-topic/side-thread style, prefer staying in current thread over opening another branch. ' +
    'Branch-worthy examples: temporary one-off Q&A, clearly off-topic requests (e.g., weather), or obvious subtasks detached from the current branch objective. ' +
    'If branch depth is higher (>=2), be more conservative and avoid creating new branches unless confidence is clearly high. ' +
    (contextLines ? `\n\nExecution context:\n${contextLines}\n` : '') +
    'Return strict JSON only with shape: {"should_branch":boolean,"confidence":number,"reason":"short reason"}. ' +
    'Set confidence in [0,1].';

  try {
    const result = await callOpenAICompat(systemPrompt, messages, { type: 'json_object' });
    const decision = parseBranchSuggestionDecision(result);
    if (!decision.shouldBranch) return decision;

    const totalBranchCount = detectionContext?.totalBranchCount ?? 0;
    const branchDepth = detectionContext?.branchDepth ?? 0;
    const currentMode = detectionContext?.currentMode ?? 'mainline';
    const hasHighBranchLoad = totalBranchCount >= 4;
    const cautiousThreshold =
      currentMode === 'mainline'
        ? 0.5
        : branchDepth >= 3
        ? 0.8
        : hasHighBranchLoad
        ? 0.72
        : 0.62;

    if (decision.confidence < cautiousThreshold) {
      return {
        shouldBranch: false,
        confidence: decision.confidence,
        reason: decision.reason || 'Below cautious threshold under current branch workload.',
      };
    }

    return decision;
  } catch (error) {
    console.error('Error detecting branch suggestion:', error);
    return {
      shouldBranch: false,
      confidence: 0,
      reason: '',
    };
  }
};

export const detectStructureSuggestion = async (
  linearContextNodes: Node[],
  userMessage: string,
  detectionContext?: {
    currentMode: 'mainline' | 'branch';
    branchDepth: number;
    currentBranchIntent?: string;
    parentContextTLDR?: string;
    mainlineTLDR?: string;
    totalBranchCount?: number;
    activeBranchCount?: number;
    recentBranchIntents?: string[];
  }
): Promise<StructureSuggestionDecision> => {
  const messages = mapNodesToMessages(linearContextNodes);
  messages.push({
    role: 'user',
    content: userMessage,
  });

  const contextLines = [
    `Current mode: ${detectionContext?.currentMode || 'mainline'}.`,
    `Branch depth: ${detectionContext?.branchDepth ?? 0}.`,
    detectionContext?.currentBranchIntent
      ? `Current branch intent: ${detectionContext.currentBranchIntent}`
      : '',
    detectionContext?.parentContextTLDR ? `Parent context TLDR: ${detectionContext.parentContextTLDR}` : '',
    detectionContext?.mainlineTLDR ? `Mainline TLDR: ${detectionContext.mainlineTLDR}` : '',
    typeof detectionContext?.totalBranchCount === 'number'
      ? `Total branches in project: ${detectionContext.totalBranchCount}.`
      : '',
    typeof detectionContext?.activeBranchCount === 'number'
      ? `Active branches: ${detectionContext.activeBranchCount}.`
      : '',
    detectionContext?.recentBranchIntents?.length
      ? `Recent branch intents: ${detectionContext.recentBranchIntents.join(' || ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const activeUserId = getActiveUserId();
  const userModelBlock =
    getUserModelFeatureEnabled() && activeUserId
      ? (() => {
          const userModel = readUserModel(activeUserId);
          return userModel ? formatUserModelForStructureAgent(userModel) : '';
        })()
      : '';

  const systemPrompt = buildStructureSuggestionSystemPrompt({
    contextLines,
    userModelBlock,
  });

  try {
    const result = await callOpenAICompat(
      systemPrompt,
      messages
    );
    return parseStructureSuggestionDecision(result);
  } catch (error) {
    console.error('[structure-agent] detection failed', {
      error: error instanceof Error ? error.message : String(error),
      currentMode: detectionContext?.currentMode || 'mainline',
      branchDepth: detectionContext?.branchDepth ?? 0,
      userMessage,
      contextNodeCount: linearContextNodes.length,
    });
    return {
      primaryAction: 'continue',
      assetAction: 'none',
      confidence: 0,
      reason: '',
      assetReason: '',
      showSuggestion: false,
    };
  }
};
