import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, createUserContent } from '@google/genai';
import {
  DEFAULT_GRADING_SYSTEM_PROMPT,
  buildGradeSingleCriterionPrompt,
  buildOverallAssessmentPrompt,
  buildPlaygroundParityPrompt,
  getEffectivePromptConfig,
  validateEditablePromptSlots,
  type EditablePromptSlots,
  type FeedbackStyleConfig,
} from '@/lib/grading-prompt-system';
import {
  buildOptimizeConfigPrompt,
  buildOptimizeSuggestionsPrompt,
  extractOptimizationSuggestions,
  normalizeOptimizedPromptConfig as normalizeOptimizedPromptConfigFromService,
} from '@/lib/playground-optimizer-service';

const apiKey = process.env.GEMINI_API_KEY || '';
const defaultGeminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const defaultModelOverride = process.env.AI_MODEL?.trim();
const defaultOllamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

type ModelProvider = 'gemini' | 'ollama';

interface ModelSelection {
  provider: ModelProvider;
  model: string;
}

function logResolvedModel(action: string, selection: ModelSelection) {
  console.info(`[ai-route] action=${action} provider=${selection.provider} model=${selection.model}`);
}

function resolveModelSelection(modelOverride?: string): ModelSelection {
  const rawSelection = modelOverride?.trim() || defaultModelOverride || defaultGeminiModel;

  if (rawSelection.startsWith('ollama:')) {
    const model = rawSelection.slice('ollama:'.length).trim() || defaultOllamaModel;
    return { provider: 'ollama', model };
  }

  if (rawSelection.startsWith('gemini:')) {
    const model = rawSelection.slice('gemini:'.length).trim() || defaultGeminiModel;
    return { provider: 'gemini', model };
  }

  return { provider: 'gemini', model: rawSelection };
}

function isThinkingModel(selection: ModelSelection): boolean {
  return selection.provider === 'gemini' && (selection.model.includes('2.5') || selection.model.includes('3'));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asEditablePromptSlots(value: unknown): EditablePromptSlots | undefined {
  if (!isObject(value)) return undefined;
  return {
    criterionInstruction: asOptionalString(value.criterionInstruction),
    justificationStructureInstruction: asOptionalString(value.justificationStructureInstruction),
    lengthInstruction: asOptionalString(value.lengthInstruction),
    toneInstruction: asOptionalString(value.toneInstruction),
    englishLevelInstruction: asOptionalString(value.englishLevelInstruction),
  };
}

function asFeedbackStyleOverrides(value: unknown): Partial<FeedbackStyleConfig> | undefined {
  if (!isObject(value)) return undefined;

  const lengthPreset = asOptionalString(value.lengthPreset);
  const tonePreset = asOptionalString(value.tonePreset);
  const englishLevelPreset = asOptionalString(value.englishLevelPreset);

  const result: Partial<FeedbackStyleConfig> = {};
  if (lengthPreset === 'short' || lengthPreset === 'medium' || lengthPreset === 'long') {
    result.lengthPreset = lengthPreset;
  }
  if (tonePreset === 'direct' || tonePreset === 'balanced' || tonePreset === 'supportive') {
    result.tonePreset = tonePreset;
  }
  if (englishLevelPreset === 'simple' || englishLevelPreset === 'standard' || englishLevelPreset === 'advanced') {
    result.englishLevelPreset = englishLevelPreset;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function asPlaygroundCriteria(
  value: unknown
): Array<{ name: string; scoreRange: { min: number; max: number } }> | undefined {
  if (!Array.isArray(value)) return undefined;

  const criteria: Array<{ name: string; scoreRange: { min: number; max: number } }> = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const name = asString(item.name);
    const scoreRange = isObject(item.scoreRange) ? item.scoreRange : null;
    const min = scoreRange ? asNumber(scoreRange.min) : null;
    const max = scoreRange ? asNumber(scoreRange.max) : null;
    if (!name || min === null || max === null) continue;
    criteria.push({ name, scoreRange: { min, max } });
  }

  return criteria.length > 0 ? criteria : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function safeParseJsonObject(text: string): Record<string, unknown> | null {
  const attempts = [
    text,
    text.replace(/,\s*([}\]])/g, '$1'),
    text.replace(/\u201c|\u201d/g, '"').replace(/\u2018|\u2019/g, "'"),
  ];

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (isObject(parsed)) return parsed;
    } catch {
      // Try next strategy
    }
  }

  return null;
}

function safeParseJsonArray(text: string): unknown[] | null {
  const attempts = [
    text,
    text.replace(/,\s*([}\]])/g, '$1'),
    text.replace(/\u201c|\u201d/g, '"').replace(/\u2018|\u2019/g, "'"),
  ];

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Try next strategy
    }
  }

  return null;
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isObject(body)) {
      return badRequest('Request body must be a JSON object');
    }

    const action = asString(body.action);
    const payload = body.payload;

    if (!action) {
      return badRequest('action is required');
    }

    if (!isObject(payload)) {
      return badRequest('payload must be a JSON object');
    }

    logResolvedModel(action, resolveModelSelection(asOptionalString(payload.modelOverride)));

    switch (action) {
      case 'extractRubricCriteria':
        if (!asString(payload.rubricContent)) return badRequest('payload.rubricContent must be a string');
        return handleExtractRubric(payload as { rubricContent: string; modelOverride?: string });
      case 'createRubricCache':
        if (!asString(payload.rubricContent)) return badRequest('payload.rubricContent must be a string');
        return handleCreateRubricCache(
          payload as {
            rubricContent: string;
            contextList?: { title: string; content: string }[];
            modelOverride?: string;
          }
        );
      case 'deleteRubricCache':
        if (!asString(payload.cacheName)) return badRequest('payload.cacheName must be a string');
        return handleDeleteRubricCache(payload as { cacheName: string });
      case 'gradeSingleCriterion':
        if (!asString(payload.essayContent)) return badRequest('payload.essayContent must be a string');
        if (!isObject(payload.criterion)) return badRequest('payload.criterion must be an object');
        return handleGradeCriterion(
          payload as {
            essayContent: string;
            criterion: { name: string; id: number; scoreRange: { min: number; max: number } };
            assessmentType?: string;
            assessmentLength?: string;
            contextList?: { title: string; content: string }[];
            cacheName?: string;
            promptSlots?: EditablePromptSlots;
            styleOverrides?: Partial<FeedbackStyleConfig>;
            modelOverride?: string;
          }
        );
      case 'generateOverallAssessment':
        if (!asString(payload.essayContent)) return badRequest('payload.essayContent must be a string');
        if (!Array.isArray(payload.criteriaWithScores)) {
          return badRequest('payload.criteriaWithScores must be an array');
        }
        return handleOverallAssessment(
          payload as {
            essayContent: string;
            criteriaWithScores: {
              name: string;
              teacherScore?: number | null;
              aiScore?: number | null;
              scoreRange: { max: number };
            }[];
            contextList?: { title: string; content: string }[];
            promptSlots?: EditablePromptSlots;
            styleOverrides?: Partial<FeedbackStyleConfig>;
            modelOverride?: string;
          }
        );
      case 'reviseCriterionScore':
        if (!asString(payload.essayContent)) return badRequest('payload.essayContent must be a string');
        if (!isObject(payload.criterion)) return badRequest('payload.criterion must be an object');
        if (!asString(payload.originalJustification)) {
          return badRequest('payload.originalJustification must be a string');
        }
        if (!asString(payload.editedJustification)) {
          return badRequest('payload.editedJustification must be a string');
        }
        if (asNumber(payload.originalScore) === null) {
          return badRequest('payload.originalScore must be a number');
        }
        return handleReviseScore(
          payload as {
            essayContent: string;
            criterion: { name: string; scoreRange: { min: number; max: number } };
            originalJustification: string;
            editedJustification: string;
            originalScore: number;
            modelOverride?: string;
          }
        );
      case 'playgroundOptimizeConfig':
        if (!isObject(payload.currentConfig)) return badRequest('payload.currentConfig must be an object');
        if (!asString(payload.feedback)) return badRequest('payload.feedback must be a string');
        return handlePlaygroundOptimizeConfig(
          payload as {
            currentConfig: Record<string, unknown>;
            feedback: string;
            modelOverride?: string;
          }
        );
      case 'playgroundOptimizeSuggestions':
        if (!isObject(payload.currentConfig)) return badRequest('payload.currentConfig must be an object');
        return handlePlaygroundOptimizeSuggestions(
          payload as {
            currentConfig: Record<string, unknown>;
            essays?: Array<{ text: string }>;
            gradingResults?: Array<Record<string, unknown>>;
            modelOverride?: string;
          }
        );
      case 'playgroundGrade':
        if (!asString(payload.essayText)) return badRequest('payload.essayText must be a string');
        if (!Array.isArray(payload.criteria)) {
          return badRequest('payload.criteria must be an array');
        }
        return handlePlaygroundGrade(
          payload as {
            essayText: string;
            criteria?: Array<{ name: string; scoreRange: { min: number; max: number } }>;
            promptSlots?: EditablePromptSlots;
            styleOverrides?: Partial<FeedbackStyleConfig>;
            modelOverride?: string;
          }
        );
      case 'playgroundCompareGrade':
        if (!asString(payload.essayText)) return badRequest('payload.essayText must be a string');
        if (!isObject(payload.originalConfig)) return badRequest('payload.originalConfig must be an object');
        if (!isObject(payload.revisedConfig)) return badRequest('payload.revisedConfig must be an object');
        return handlePlaygroundCompareGrade(
          payload as {
            essayText: string;
            originalConfig: Record<string, unknown>;
            revisedConfig: Record<string, unknown>;
            modelOverride?: string;
          }
        );
      case 'validatePromptImport':
        if (!isObject(payload.promptSlots)) return badRequest('payload.promptSlots must be an object');
        return handleValidatePromptImport(
          payload as {
            promptSlots: EditablePromptSlots;
            sourceMode?: 'parity';
          }
        );
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Gemini API route error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

async function callGemini(prompt: string, model: string, maxTokens: number, temperature?: number) {
  if (!ai) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const config: Record<string, unknown> = { maxOutputTokens: maxTokens };
  if (!isThinkingModel({ provider: 'gemini', model }) && temperature !== undefined) {
    config.temperature = temperature;
  }

  const response = await ai.models.generateContent({
    model,
    contents: [createUserContent([prompt])],
    config,
  });

  return (response.text ?? '').trim();
}

/** Call Gemini using a cached context — only sends the new per-criterion prompt */
async function callGeminiWithCache(
  prompt: string,
  model: string,
  cacheName: string,
  maxTokens: number,
  temperature?: number
) {
  if (!ai) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const config: Record<string, unknown> = {
    maxOutputTokens: maxTokens,
    cachedContent: cacheName,
  };
  if (!isThinkingModel({ provider: 'gemini', model }) && temperature !== undefined) {
    config.temperature = temperature;
  }

  const response = await ai.models.generateContent({
    model,
    contents: [createUserContent([prompt])],
    config,
  });

  return (response.text ?? '').trim();
}

async function callOllama(prompt: string, model: string, maxTokens: number, temperature?: number) {
  const options: Record<string, unknown> = {
    num_predict: maxTokens,
  };

  if (temperature !== undefined) {
    options.temperature = temperature;
  }

  const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Ollama request failed (${response.status})`);
  }

  const data = (await response.json()) as { response?: unknown; error?: unknown };
  if (typeof data.error === 'string' && data.error) {
    throw new Error(data.error);
  }

  if (typeof data.response !== 'string') {
    throw new Error('Invalid Ollama response');
  }

  return data.response.trim();
}

async function callModel(prompt: string, selection: ModelSelection, maxTokens: number, temperature?: number) {
  if (selection.provider === 'ollama') {
    return callOllama(prompt, selection.model, maxTokens, temperature);
  }

  return callGemini(prompt, selection.model, maxTokens, temperature);
}

function cleanJsonArray(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```json\s*/g, '');
  cleaned = cleaned.replace(/```\s*$/g, '');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }
  return cleaned;
}

function cleanJsonObject(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```json\s*/g, '');
  cleaned = cleaned.replace(/```\s*$/g, '');
  cleaned = cleaned.replace(/^```js|^```javascript|^```/gi, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

/* ============================================================ */
/*  Rubric Context Cache                                         */
/* ============================================================ */

const GRADING_SYSTEM_PROMPT = `You are a strict essay grader for a masters level course. Hold students to a high standard. If something is weak, say so plainly. If something is good, say so briefly. Do not use fancy language, filler words, or unnecessary adjectives. Write like you are talking to the student directly — short sentences, plain English.

GRADING METHODOLOGY:
1. Read the full essay before grading anything.
2. For each criterion, check the essay against EVERY score level in the rubric (low to high). Find the level that fits best.
3. Give the score of the closest matching level. If it falls between two levels, pick the nearer one — do not default to the middle.
4. In your justification, point to specific rubric levels and say why the essay fits or does not fit them.
5. Do NOT make the score obvious from your justification — the reader should not be able to guess the exact number.

WRITING STYLE:
- Use simple, direct English. No fancy words. No filler.
- Say "the essay does X" not "the essay demonstrates a commendable ability to X".
- Say "this is missing" not "there is a notable absence of".
- Keep sentences short. One idea per sentence.

EVIDENCE RULES:
- Every quote MUST be copied EXACTLY from the essay. Do not change any words, fix grammar, or rephrase.
- If you cannot find an exact quote, do not make one up.
- Pick quotes that are specific to this criterion, not generic lines that could apply to anything.`;

async function handleCreateRubricCache(payload: {
  rubricContent: string;
  contextList?: { title: string; content: string }[];
  modelOverride?: string;
}) {
  const modelSelection = resolveModelSelection(payload.modelOverride);

  if (modelSelection.provider !== 'gemini') {
    return NextResponse.json({
      result: { cacheName: null, tokenCount: null, error: 'Caching is only supported for Gemini models' },
    });
  }

  if (!ai) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  }

  let contextBlock = '';
  if (payload.contextList && payload.contextList.length > 0) {
    contextBlock =
      'CONTEXT DUMP:\n' +
      payload.contextList.map((ctx) => `- ${ctx.title}: ${ctx.content}`).join('\n') +
      '\n\n';
  }

  const cachedText = `${contextBlock}RUBRIC:\n${payload.rubricContent}`;

  try {
    const cache = await ai.caches.create({
      model: modelSelection.model,
      config: {
        contents: [createUserContent([cachedText])],
        systemInstruction: DEFAULT_GRADING_SYSTEM_PROMPT,
        displayName: `essay-grader-rubric-${Date.now()}`,
        ttl: '3600s', // 1 hour
      },
    });

    return NextResponse.json({
      result: {
        cacheName: cache.name,
        tokenCount: cache.usageMetadata?.totalTokenCount ?? null,
      },
    });
  } catch (error) {
    console.error('Cache creation failed:', error);
    // Not fatal — grading can proceed without cache
    return NextResponse.json({
      result: { cacheName: null, error: 'Cache creation failed, will use standard requests' },
    });
  }
}

async function handleDeleteRubricCache(payload: { cacheName: string }) {
  if (!ai) {
    return NextResponse.json({ result: { deleted: false } });
  }

  try {
    await ai.caches.delete({ name: payload.cacheName });
    return NextResponse.json({ result: { deleted: true } });
  } catch {
    return NextResponse.json({ result: { deleted: false } });
  }
}

/* ============================================================ */
/*  Extract Rubric                                                */
/* ============================================================ */

async function handleExtractRubric(payload: { rubricContent: string; modelOverride?: string }) {
  const modelSelection = resolveModelSelection(payload.modelOverride);
  const prompt = `
    If the provided text is not a grading rubric, or you are not confident you can extract meaningful criteria, respond with the string: NO_VALID_RUBRIC (no JSON, no explanation).

    Analyze the following grading rubric and extract each criterion.
    For each criterion, identify:
    1. The name/title of the criterion
    2. The possible score range (e.g., 1-5)
    3. The description for each score level

    RUBRIC:
    ${payload.rubricContent}

    FORMAT YOUR RESPONSE AS A VALID JSON ARRAY with objects containing:
    {
      "id": number,
      "name": "criterion name",
      "scoreRange": { "min": number, "max": number },
      "levels": [
        { "score": number, "description": "description for this score level" },
        ...
      ]
    }

    DO NOT include any explanatory text before or after the JSON array.
    ONLY return the JSON array and nothing else.
  `;

  const maxTokens = isThinkingModel(modelSelection) ? 8192 : 2048;
  const raw = await callModel(prompt, modelSelection, maxTokens, 0.1);

  if (raw.toUpperCase() === 'NO_VALID_RUBRIC') {
    return NextResponse.json({ result: 'NO_VALID_RUBRIC' });
  }

  const cleaned = cleanJsonArray(raw);
  const parsed = safeParseJsonArray(cleaned);
  if (!parsed) {
    return NextResponse.json({ result: 'NO_VALID_RUBRIC' });
  }
  return NextResponse.json({ result: parsed });
}

/* ============================================================ */
/*  Grade Single Criterion                                        */
/* ============================================================ */

async function handleGradeCriterion(payload: {
  essayContent: string;
  criterion: { name: string; id: number; scoreRange: { min: number; max: number } };
  assessmentType?: string;
  assessmentLength?: string;
  contextList?: { title: string; content: string }[];
  cacheName?: string;
  promptSlots?: EditablePromptSlots;
  styleOverrides?: Partial<FeedbackStyleConfig>;
  modelOverride?: string;
}) {
  const modelSelection = resolveModelSelection(payload.modelOverride);
  const assessmentType = payload.assessmentType || 'flow';
  const assessmentLength = payload.assessmentLength || 'long';

  let justificationInstruction = '';
  let justificationSchema = '';
  if (assessmentType === 'bullets') {
    justificationInstruction =
      'Present your justification as bullet points. Return the justification as a JSON array of strings, where each string is a bullet point.';
    justificationSchema =
      '"justification": ["bullet point 1", "bullet point 2", ...],';
  } else {
    justificationInstruction =
      'Present your justification as a coherent paragraph. Return the justification as a single string.';
    justificationSchema =
      '"justification": "Your detailed justification without revealing the exact score",';
  }

  const relateInstruction = `
    For each evidence quote, indicate which sentences or bullet points from your justification it supports. Return the indexes (starting from 0) as a field "relatedAssessmentIndexes" in each evidence object.
    If the justification is a paragraph, treat each sentence as a unit (split on periods, exclamation marks, or question marks). If it's a list, use each bullet as a unit.`;

  let lengthInstruction = '';
  if (assessmentLength === 'short') {
    lengthInstruction = assessmentType === 'bullets'
      ? 'Keep it to 3-4 bullet points. Each bullet should be 1 sentence.'
      : 'Keep the justification to 2-3 sentences total.';
  } else if (assessmentLength === 'medium') {
    lengthInstruction = assessmentType === 'bullets'
      ? 'Use 4-6 bullet points. Each bullet should be 1-2 sentences.'
      : 'Write 4-6 sentences in one paragraph.';
  } else {
    lengthInstruction = assessmentType === 'bullets'
      ? 'Use 6-8 bullet points. Each bullet can be 1-2 sentences with specific examples.'
      : 'Write a detailed paragraph of 6-10 sentences with specific examples from the essay.';
  }

  const criterion = payload.criterion;

  // When using cache, the rubric + essay + system prompt are already cached
  // We only need to send the criterion-specific instructions
  const hasCacheAvailable = !!payload.cacheName;

  let prompt: string;
  if (hasCacheAvailable) {
    prompt = `
    Grade the following criterion using the rubric provided in the cached context.

    ESSAY:
    ${payload.essayContent}

    CRITERION: ${criterion.name}
    SCORE RANGE: ${criterion.scoreRange.min} to ${criterion.scoreRange.max}

    INSTRUCTIONS:
    1. First, evaluate the essay against EACH score level (${criterion.scoreRange.min} to ${criterion.scoreRange.max}) for this criterion. Determine which level the essay most closely matches.
    2. Write a justification that is balanced and critical. Reference specific rubric level descriptions to explain your reasoning. Do not reveal or hint at the exact score. ${justificationInstruction} ${lengthInstruction}
    3. Provide at least 5 VERBATIM quotes from the essay. CRITICAL: these must be EXACT copy-pastes from the essay — every word, space, and punctuation mark must match the original text exactly. Do NOT paraphrase, rephrase, reorder words, fix grammar, or alter the text in any way. If unsure of exact wording, use a shorter quote you are certain about.
       Evidence requirements:
       - From DIFFERENT parts/pages of the essay (spread across the full document)
       - UNIQUE to this criterion — avoid generic quotes that could apply to any criterion
       - Include quotes showing both strengths AND weaknesses
       - Each quote must be at least one full sentence or meaningful clause
    4. ${relateInstruction}
    5. Assign your numerical score (${criterion.scoreRange.min}-${criterion.scoreRange.max}) — must correspond to the rubric level you identified in step 1.

    FORMAT YOUR RESPONSE AS A VALID JSON object:
    {
      ${justificationSchema}
      "evidence": [
        {
          "quote": "EXACT verbatim text from essay — character-for-character copy",
          "paragraph": "PAGE X, Section/Paragraph identifier",
          "relatedAssessmentIndexes": [array of integers, optional]
        },
        ...
      ],
      "score": number
    }

    DO NOT include any explanatory text before or after the JSON object.
    ONLY return the JSON object and nothing else.
    `;
  } else {
    let contextBlock = '';
    if (payload.contextList && payload.contextList.length > 0) {
      contextBlock =
        'CONTEXT DUMP:\n' +
        payload.contextList.map((ctx) => `- ${ctx.title}: ${ctx.content}`).join('\n') +
        '\n';
    }

    prompt = `
    ${contextBlock}
    ${GRADING_SYSTEM_PROMPT}

    CRITERION: ${criterion.name}
    SCORE RANGE: ${criterion.scoreRange.min} to ${criterion.scoreRange.max}

    ESSAY:
    ${payload.essayContent}

    INSTRUCTIONS:
    1. First, evaluate the essay against EACH score level (${criterion.scoreRange.min} to ${criterion.scoreRange.max}) for this criterion. Determine which level the essay most closely matches.
    2. Write a justification that is balanced and critical. Reference specific rubric level descriptions to explain your reasoning. Do not reveal or hint at the exact score. ${justificationInstruction} ${lengthInstruction}
    3. Provide at least 5 VERBATIM quotes from the essay. CRITICAL: these must be EXACT copy-pastes from the essay — every word, space, and punctuation mark must match the original text exactly. Do NOT paraphrase, rephrase, reorder words, fix grammar, or alter the text in any way. If unsure of exact wording, use a shorter quote you are certain about.
       Evidence requirements:
       - From DIFFERENT parts/pages of the essay (spread across the full document)
       - UNIQUE to this criterion — avoid generic quotes that could apply to any criterion
       - Include quotes showing both strengths AND weaknesses
       - Each quote must be at least one full sentence or meaningful clause
    4. ${relateInstruction}
    5. Assign your numerical score (${criterion.scoreRange.min}-${criterion.scoreRange.max}) — must correspond to the rubric level you identified in step 1.

    FORMAT YOUR RESPONSE AS A VALID JSON object:
    {
      ${justificationSchema}
      "evidence": [
        {
          "quote": "EXACT verbatim text from essay — character-for-character copy",
          "paragraph": "PAGE X, Section/Paragraph identifier",
          "relatedAssessmentIndexes": [array of integers, optional]
        },
        ...
      ],
      "score": number
    }

    DO NOT include any explanatory text before or after the JSON object.
    ONLY return the JSON object and nothing else.
    `;
  }

  const maxTokens = isThinkingModel(modelSelection) ? 8192 : 2048;

  let raw: string;
  if (hasCacheAvailable) {
    try {
      raw = await callGeminiWithCache(prompt, modelSelection.model, payload.cacheName!, maxTokens, 0.2);
    } catch (cacheError) {
      console.warn('Cached call failed, falling back to standard:', cacheError);
      // Fallback: send full prompt without cache
      raw = await callModel(prompt, modelSelection, maxTokens, 0.2);
    }
  } else {
    raw = await callModel(prompt, modelSelection, maxTokens, 0.2);
  }

  if (!raw) {
    return NextResponse.json({
      result: {
        justification: 'The AI returned an empty response. Please try again.',
        evidence: [],
        score: null,
        error: 'EMPTY_RESPONSE',
      },
    });
  }

  const cleaned = cleanJsonObject(raw);
  const parsed = safeParseJsonObject(cleaned);
  if (!parsed) {
    return NextResponse.json({
      result: {
        justification: 'Unable to parse model output reliably. Please rerun this criterion.',
        evidence: [],
        score: null,
        error: 'PARSE_ERROR',
      },
    });
  }
  return NextResponse.json({ result: parsed });
}

/* ============================================================ */
/*  Overall Assessment                                            */
/* ============================================================ */

async function handleOverallAssessment(payload: {
  essayContent: string;
  criteriaWithScores: { name: string; teacherScore?: number | null; aiScore?: number | null; scoreRange: { max: number } }[];
  contextList?: { title: string; content: string }[];
  promptSlots?: EditablePromptSlots;
  styleOverrides?: Partial<FeedbackStyleConfig>;
  modelOverride?: string;
}) {
  const modelSelection = resolveModelSelection(payload.modelOverride);
  const effectivePromptConfig = getEffectivePromptConfig({
    slotOverrides: asEditablePromptSlots(payload.promptSlots),
    styleOverrides: asFeedbackStyleOverrides(payload.styleOverrides),
  });

  const prompt = buildOverallAssessmentPrompt({
    runtime: {
      essayContent: payload.essayContent,
      criteriaWithScores: payload.criteriaWithScores.map((criterion) => ({
        name: criterion.name,
        teacherScore: criterion.teacherScore,
        aiScore: criterion.aiScore,
        maxScore: criterion.scoreRange.max,
      })),
      contextDump: payload.contextList,
    },
    effective: effectivePromptConfig,
  });

  const maxTokens = isThinkingModel(modelSelection) ? 8192 : 1024;
  const raw = await callModel(prompt, modelSelection, maxTokens, 0.3);
  const cleaned = cleanJsonObject(raw);
  const parsed = safeParseJsonObject(cleaned);
  if (!parsed) {
    return NextResponse.json({
      result: {
        strengths: '',
        improvements: '',
        overallGrade: '',
        advice: '',
        error: 'PARSE_ERROR',
      },
    });
  }
  return NextResponse.json({ result: parsed });
}

/* ============================================================ */
/*  Revise Score                                                  */
/* ============================================================ */

async function handleReviseScore(payload: {
  essayContent: string;
  criterion: { name: string; scoreRange: { min: number; max: number } };
  originalJustification: string;
  editedJustification: string;
  originalScore: number;
  modelOverride?: string;
}) {
  const modelSelection = resolveModelSelection(payload.modelOverride);
  const criterion = payload.criterion;

  const prompt = `
    You are an expert essay grader. The following is an essay, a rubric criterion, and two versions of the justification for the assessment of this criterion: the original justification (from an AI) and an edited justification (from a human reviewer). The original numerical score was ${payload.originalScore}.

    Please carefully consider the edited justification. If the edits suggest a different score is warranted, revise the score accordingly. Otherwise, keep the original score. Provide a brief rationale for your decision.

    ESSAY:
    ${payload.essayContent}

    CRITERION: ${criterion.name}
    SCORE RANGE: ${criterion.scoreRange.min} to ${criterion.scoreRange.max}

    ORIGINAL JUSTIFICATION:
    ${payload.originalJustification}

    EDITED JUSTIFICATION:
    ${payload.editedJustification}

    ORIGINAL SCORE: ${payload.originalScore}

    FORMAT YOUR RESPONSE AS A VALID JSON object:
    {
      "revisedScore": number,
      "rationale": "A brief explanation for your decision"
    }

    DO NOT include any explanatory text before or after the JSON object.
    ONLY return the JSON object and nothing else.
  `;

  const maxTokens = isThinkingModel(modelSelection) ? 4096 : 512;
  const raw = await callModel(prompt, modelSelection, maxTokens, 0.2);
  const cleaned = cleanJsonObject(raw);
  const parsed = safeParseJsonObject(cleaned);
  if (!parsed) {
    return NextResponse.json({
      result: {
        revisedScore: payload.originalScore,
        rationale: 'Unable to parse revised score response. Keeping original score.',
      },
    });
  }
  return NextResponse.json({ result: parsed });
}

/* ============================================================ */
/*  Playground Optimize Config                                   */
/* ============================================================ */

async function handlePlaygroundOptimizeConfig(payload: {
  currentConfig: Record<string, unknown>;
  feedback: string;
  modelOverride?: string;
}) {
  const modelSelection = resolveModelSelection(payload.modelOverride);

  if (!payload.currentConfig || !payload.feedback?.trim()) {
    return NextResponse.json({ error: 'currentConfig and feedback are required' }, { status: 400 });
  }

  const prompt = buildOptimizeConfigPrompt(payload.currentConfig, payload.feedback);

  const maxTokens = isThinkingModel(modelSelection) ? 8192 : 4096;
  const raw = await callModel(prompt, modelSelection, maxTokens, 0.2);

  if (!raw) {
    return NextResponse.json({ error: 'Empty response from AI' }, { status: 500 });
  }

  const cleaned = cleanJsonObject(raw);
  const parsed = safeParseJsonObject(cleaned);
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid optimization response format' }, { status: 502 });
  }

  const normalized = normalizeOptimizedPromptConfigFromService(parsed, payload.currentConfig);
  return NextResponse.json({ result: { revisedConfig: normalized } });
}

async function handlePlaygroundOptimizeSuggestions(payload: {
  currentConfig: Record<string, unknown>;
  essays?: Array<{ text: string }>;
  gradingResults?: Array<Record<string, unknown>>;
  modelOverride?: string;
}) {
  const modelSelection = resolveModelSelection(payload.modelOverride);

  const prompt = buildOptimizeSuggestionsPrompt({
    currentConfig: payload.currentConfig,
    essays: payload.essays,
    gradingResults: payload.gradingResults,
  });

  const maxTokens = isThinkingModel(modelSelection) ? 4096 : 2048;
  const raw = await callModel(prompt, modelSelection, maxTokens, 0.2);
  const cleaned = cleanJsonObject(raw);
  const parsed = safeParseJsonObject(cleaned);

  const suggestions = extractOptimizationSuggestions(parsed);

  return NextResponse.json({ result: { suggestions } });
}

/* ============================================================ */
/*  Playground Grade                                             */
/* ============================================================ */

async function handlePlaygroundGrade(payload: {
  essayText: string;
  criteria?: Array<{ name: string; scoreRange: { min: number; max: number } }>;
  promptSlots?: EditablePromptSlots;
  styleOverrides?: Partial<FeedbackStyleConfig>;
  assessmentType?: 'flow' | 'bullets';
  modelOverride?: string;
}) {
  const graded = await gradePlaygroundParity(payload);

  return NextResponse.json({
    result: graded,
  });
}

async function gradePlaygroundParity(payload: {
  essayText: string;
  criteria?: Array<{ name: string; scoreRange: { min: number; max: number } }>;
  promptSlots?: EditablePromptSlots;
  styleOverrides?: Partial<FeedbackStyleConfig>;
  assessmentType?: 'flow' | 'bullets';
  modelOverride?: string;
}): Promise<{ results: Array<Record<string, unknown>>; metadata: { mode: 'parity'; importable: boolean } }> {
  const modelSelection = resolveModelSelection(payload.modelOverride);

  if (!payload.essayText?.trim()) {
    throw new Error('essayText is required');
  }

  const criteria = asPlaygroundCriteria(payload.criteria);
  if (!criteria || criteria.length === 0) {
    throw new Error('criteria are required');
  }

  const effectivePromptConfig = getEffectivePromptConfig({
    slotOverrides: asEditablePromptSlots(payload.promptSlots),
    styleOverrides: asFeedbackStyleOverrides(payload.styleOverrides),
  });
  const assessmentType = payload.assessmentType === 'bullets' ? 'bullets' : 'flow';

  const results: Array<Record<string, unknown>> = [];
  for (const criterion of criteria) {
    const prompt = buildPlaygroundParityPrompt({
      runtime: {
        essayContent: payload.essayText,
        criterionName: criterion.name,
        scoreMin: criterion.scoreRange.min,
        scoreMax: criterion.scoreRange.max,
        assessmentType,
        assessmentLength: 'medium',
      },
      effective: effectivePromptConfig,
      cacheMode: 'non-cached',
    });

    const maxTokens = isThinkingModel(modelSelection) ? 8192 : 4096;
    const raw = await callModel(prompt, modelSelection, maxTokens, 0.2);
    const cleaned = cleanJsonObject(raw);
    const parsed = safeParseJsonObject(cleaned);

    if (!parsed) {
      results.push({
        criterionName: criterion.name,
        justification: ['Unable to parse model output reliably. Please rerun this criterion.'],
        evidenceQuotes: [],
        score: null,
        error: 'PARSE_ERROR',
      });
      continue;
    }

    const justification = parsed.justification;
    const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
    const evidenceQuotes = evidence
      .filter((item) => isObject(item) && typeof item.quote === 'string')
      .map((item) => ({ quote: String(item.quote) }));

    results.push({
      criterionName: criterion.name,
      justification:
        Array.isArray(justification)
          ? justification.filter((j): j is string => typeof j === 'string')
          : typeof justification === 'string'
          ? [justification]
          : [],
      evidenceQuotes,
      score: asNumber(parsed.score),
      rawResult: parsed,
    });
  }

  return {
    results,
    metadata: {
      mode: 'parity',
      importable: true,
    },
  };
}

function buildConfigCriteriaForParity(config: Record<string, unknown>): Array<{ name: string; scoreRange: { min: number; max: number } }> {
  if (!Array.isArray(config.criteria)) return [];

  return config.criteria
    .map((row) => {
      if (!isObject(row)) return null;
      const name = asString(row.name);
      const minScore = asNumber(row.minScore);
      const maxScore = asNumber(row.maxScore);
      if (!name || minScore === null || maxScore === null) return null;
      return {
        name,
        scoreRange: {
          min: minScore,
          max: maxScore,
        },
      };
    })
    .filter((row): row is { name: string; scoreRange: { min: number; max: number } } => row !== null);
}

function toCompareResult(
  graded: Array<Record<string, unknown>>,
  criteria: Array<{ name: string; scoreRange: { min: number; max: number } }>
) {
  const criteriaWithScores = graded.map((row) => {
    const criterionName = asString(row.criterionName) || 'Unknown Criterion';
    const criterion = criteria.find((c) => c.name === criterionName);
    const score = asNumber(row.score) ?? 0;
    const feedbackParts = Array.isArray(row.justification)
      ? row.justification.filter((part): part is string => typeof part === 'string')
      : [];
    const evidenceQuotes = Array.isArray(row.evidenceQuotes)
      ? row.evidenceQuotes
          .filter((item) => isObject(item) && typeof item.quote === 'string')
          .map((item) => String(item.quote))
      : [];

    return {
      name: criterionName,
      score,
      maxScore: criterion?.scoreRange.max ?? 0,
      feedback: feedbackParts.join(' '),
      evidenceQuotes,
    };
  });

  const overallScore = criteriaWithScores.reduce((sum, row) => sum + row.score, 0);
  const maxScore = criteria.reduce((sum, row) => sum + row.scoreRange.max, 0);

  return {
    overallScore,
    maxScore,
    criteria: criteriaWithScores,
  };
}

async function handlePlaygroundCompareGrade(payload: {
  essayText: string;
  originalConfig: Record<string, unknown>;
  revisedConfig: Record<string, unknown>;
  modelOverride?: string;
}) {
  const originalCriteria = buildConfigCriteriaForParity(payload.originalConfig);
  const revisedCriteria = buildConfigCriteriaForParity(payload.revisedConfig);

  if (originalCriteria.length === 0 || revisedCriteria.length === 0) {
    return NextResponse.json({ error: 'Both configs must include valid criteria' }, { status: 400 });
  }

  const originalSlots = asEditablePromptSlots(payload.originalConfig.promptSlots);
  const revisedSlots = asEditablePromptSlots(payload.revisedConfig.promptSlots);

  const [original, revised] = await Promise.all([
    gradePlaygroundParity({
      essayText: payload.essayText,
      criteria: originalCriteria,
      promptSlots: originalSlots,
      styleOverrides: asFeedbackStyleOverrides(payload.originalConfig.styleOverrides),
      assessmentType: payload.originalConfig.assessmentType === 'bullets' ? 'bullets' : 'flow',
      modelOverride: payload.modelOverride,
    }),
    gradePlaygroundParity({
      essayText: payload.essayText,
      criteria: revisedCriteria,
      promptSlots: revisedSlots,
      styleOverrides: asFeedbackStyleOverrides(payload.revisedConfig.styleOverrides),
      assessmentType: payload.revisedConfig.assessmentType === 'bullets' ? 'bullets' : 'flow',
      modelOverride: payload.modelOverride,
    }),
  ]);

  return NextResponse.json({
    result: {
      original: toCompareResult(original.results, originalCriteria),
      revised: toCompareResult(revised.results, revisedCriteria),
    },
  });
}

async function handleValidatePromptImport(payload: {
  promptSlots: EditablePromptSlots;
  sourceMode?: 'parity';
}) {
  const validation = validateEditablePromptSlots(payload.promptSlots);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: 'Invalid prompt slot content',
        result: {
          valid: false,
          errors: validation.errors,
          sanitizedSlots: validation.sanitizedSlots,
        },
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    result: {
      valid: true,
      errors: [],
      sanitizedSlots: validation.sanitizedSlots,
      importable: true,
    },
  });
}

