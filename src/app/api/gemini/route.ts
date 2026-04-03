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

function asBoolean(value: unknown, defaultValue = false): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
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
  const assessmentType = payload.assessmentType === 'bullets' ? 'bullets' : 'flow';
  const assessmentLength =
    payload.assessmentLength === 'short' || payload.assessmentLength === 'long' ? payload.assessmentLength : 'medium';

  const effectivePromptConfig = getEffectivePromptConfig({
    slotOverrides: asEditablePromptSlots(payload.promptSlots),
    styleOverrides: asFeedbackStyleOverrides(payload.styleOverrides),
  });

  const criterion = payload.criterion;

  // When using cache, the rubric + essay + system prompt are already cached
  // We only need to send the criterion-specific instructions
  const hasCacheAvailable = modelSelection.provider === 'gemini' && !!payload.cacheName;
  const prompt = buildGradeSingleCriterionPrompt({
    runtime: {
      essayContent: payload.essayContent,
      criterionName: criterion.name,
      scoreMin: criterion.scoreRange.min,
      scoreMax: criterion.scoreRange.max,
      contextDump: payload.contextList,
      assessmentType,
      assessmentLength,
    },
    effective: effectivePromptConfig,
    cacheMode: hasCacheAvailable ? 'cached' : 'non-cached',
  });

  const maxTokens = isThinkingModel(modelSelection) ? 8192 : 1024;

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

  const prompt = `
You are optimizing a JSON grading prompt configuration.
Revise the config based on feedback while preserving the same output schema.

CURRENT CONFIG JSON:
${JSON.stringify(payload.currentConfig, null, 2)}

FEEDBACK:
${payload.feedback}

Return ONLY valid JSON object with these keys:
{
  "academicLevel": string,
  "subject": string,
  "assignmentDesc": string,
  "feedbackText": string,
  "criteria": [
    {
      "id": string,
      "name": string,
      "minScore": number,
      "maxScore": number,
      "levels": {"scoreAsString": "description"}
    }
  ],
  "showAdditionalMaterial": boolean,
  "additionalMaterial": string,
  "showAdditionalDescription": boolean,
  "additionalDescription": string
}
`;

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
  return NextResponse.json({ result: { revisedConfig: parsed } });
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
  const modelSelection = resolveModelSelection(payload.modelOverride);

  if (!payload.essayText?.trim()) {
    return NextResponse.json({ error: 'essayText is required' }, { status: 400 });
  }

  const criteria = asPlaygroundCriteria(payload.criteria);
  if (!criteria || criteria.length === 0) {
    return NextResponse.json({ error: 'criteria are required' }, { status: 400 });
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

  return NextResponse.json({
    result: {
      results,
      metadata: {
        mode: 'parity',
        importable: true,
      },
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
