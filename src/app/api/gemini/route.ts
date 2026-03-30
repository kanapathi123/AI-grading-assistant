import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, createUserContent } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || '';
const defaultModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ai = new GoogleGenAI({ apiKey });

function isThinkingModel(model: string): boolean {
  return model.includes('2.5') || model.includes('3');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, payload } = body;

    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    switch (action) {
      case 'extractRubricCriteria':
        return handleExtractRubric(payload);
      case 'createRubricCache':
        return handleCreateRubricCache(payload);
      case 'deleteRubricCache':
        return handleDeleteRubricCache(payload);
      case 'gradeSingleCriterion':
        return handleGradeCriterion(payload);
      case 'generateOverallAssessment':
        return handleOverallAssessment(payload);
      case 'reviseCriterionScore':
        return handleReviseScore(payload);
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
  const config: Record<string, unknown> = { maxOutputTokens: maxTokens };
  if (!isThinkingModel(model) && temperature !== undefined) {
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
  const config: Record<string, unknown> = {
    maxOutputTokens: maxTokens,
    cachedContent: cacheName,
  };
  if (!isThinkingModel(model) && temperature !== undefined) {
    config.temperature = temperature;
  }

  const response = await ai.models.generateContent({
    model,
    contents: [createUserContent([prompt])],
    config,
  });

  return (response.text ?? '').trim();
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

const GRADING_SYSTEM_PROMPT = `You are a rigorous, no-nonsense essay grader for a masters level course. You hold students to a high standard and do not give praise unless it is clearly warranted by the text. Avoid flattery, hedging, or softening language. If the essay is weak in an area, say so directly. If the essay is strong, acknowledge it briefly without exaggeration.

Your assessment must reference the rubric criterion directly. Do NOT make the score obvious from your justification — a reader should not be able to guess the exact score from your commentary alone. Focus on what the essay does and does not achieve relative to the criterion.`;

async function handleCreateRubricCache(payload: {
  rubricContent: string;
  contextList?: { title: string; content: string }[];
  modelOverride?: string;
}) {
  const model = payload.modelOverride || defaultModel;

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
      model,
      config: {
        contents: [createUserContent([cachedText])],
        systemInstruction: GRADING_SYSTEM_PROMPT,
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
  const model = payload.modelOverride || defaultModel;
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

  const maxTokens = isThinkingModel(model) ? 8192 : 2048;
  const raw = await callGemini(prompt, model, maxTokens, 0.1);

  if (raw.toUpperCase() === 'NO_VALID_RUBRIC') {
    return NextResponse.json({ result: 'NO_VALID_RUBRIC' });
  }

  const cleaned = cleanJsonArray(raw);
  const parsed = JSON.parse(cleaned);
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
  modelOverride?: string;
}) {
  const model = payload.modelOverride || defaultModel;
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
  if (assessmentLength === 'short') lengthInstruction = 'Be concise and brief.';
  else if (assessmentLength === 'medium') lengthInstruction = 'Be balanced in detail and length.';
  else lengthInstruction = 'Be detailed and extended.';

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

    Provide the following in your response:
    1. A justification for your assessment that is balanced and critical. Do not reveal or hint at the exact score. ${justificationInstruction} ${lengthInstruction}
    2. At least 5 specific EXACT quotes from the essay (copy-pasted verbatim, not paraphrased) that support or influenced your assessment. These must be:
       - Drawn from DIFFERENT parts/pages of the essay (do not cluster quotes from one section)
       - UNIQUE to this criterion — do not reuse generic quotes that could apply to any criterion
       - Include both quotes that demonstrate strengths AND weaknesses for this criterion
       - Each quote must be at least one full sentence (no fragments or single phrases)
    3. For each quote, indicate which sentences or bullet points from your justification it supports. ${relateInstruction}
    4. Your numerical score (${criterion.scoreRange.min}-${criterion.scoreRange.max})

    FORMAT YOUR RESPONSE AS A VALID JSON object:
    {
      ${justificationSchema}
      "evidence": [
        {
          "quote": "exact verbatim quote from essay — must be a complete sentence or clause, not just a few words",
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

    Provide the following in your response:
    1. A justification for your assessment that is balanced and critical. Do not reveal or hint at the exact score. ${justificationInstruction} ${lengthInstruction}
    2. At least 5 specific EXACT quotes from the essay (copy-pasted verbatim, not paraphrased) that support or influenced your assessment. These must be:
       - Drawn from DIFFERENT parts/pages of the essay (do not cluster quotes from one section)
       - UNIQUE to this criterion — do not reuse generic quotes that could apply to any criterion
       - Include both quotes that demonstrate strengths AND weaknesses for this criterion
       - Each quote must be at least one full sentence (no fragments or single phrases)
    3. For each quote, indicate which sentences or bullet points from your justification it supports. ${relateInstruction}
    4. Your numerical score (${criterion.scoreRange.min}-${criterion.scoreRange.max})

    FORMAT YOUR RESPONSE AS A VALID JSON object:
    {
      ${justificationSchema}
      "evidence": [
        {
          "quote": "exact verbatim quote from essay — must be a complete sentence or clause, not just a few words",
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

  const maxTokens = isThinkingModel(model) ? 8192 : 1024;

  let raw: string;
  if (hasCacheAvailable) {
    try {
      raw = await callGeminiWithCache(prompt, model, payload.cacheName!, maxTokens, 0.2);
    } catch (cacheError) {
      console.warn('Cached call failed, falling back to standard:', cacheError);
      // Fallback: send full prompt without cache
      raw = await callGemini(prompt, model, maxTokens, 0.2);
    }
  } else {
    raw = await callGemini(prompt, model, maxTokens, 0.2);
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
  const parsed = JSON.parse(cleaned);
  return NextResponse.json({ result: parsed });
}

/* ============================================================ */
/*  Overall Assessment                                            */
/* ============================================================ */

async function handleOverallAssessment(payload: {
  essayContent: string;
  criteriaWithScores: { name: string; teacherScore?: number | null; aiScore?: number | null; scoreRange: { max: number } }[];
  contextList?: { title: string; content: string }[];
  modelOverride?: string;
}) {
  const model = payload.modelOverride || defaultModel;

  const criteriaText = payload.criteriaWithScores
    .map((c) => `${c.name}: Score ${c.teacherScore || c.aiScore} out of ${c.scoreRange.max}`)
    .join('\n');

  let contextBlock = '';
  if (payload.contextList && payload.contextList.length > 0) {
    contextBlock =
      'CONTEXT DUMP:\n' +
      payload.contextList.map((ctx) => `- ${ctx.title}: ${ctx.content}`).join('\n') +
      '\n';
  }

  const prompt = `
    ${contextBlock}
    You are an expert essay grader. Given the following essay and the scores for each criterion, provide an overall assessment.
    Summarize the essay's strengths and areas for improvement.
    Then, generate a final grade on a 0-10 scale (with decimals allowed), where the individual criterion scores are on their own scales (typically 1-5).
    The final grade should reflect the average performance across all criteria, converted to a 10-point scale.

    Present strengths as a coherent paragraph. Present areas for improvement as a coherent paragraph.

    ESSAY:
    ${payload.essayContent}

    CRITERIA & SCORES:
    ${criteriaText}

    FORMAT YOUR RESPONSE AS A VALID JSON OBJECT with the following keys:
    {
      "strengths": string,
      "improvements": string,
      "overallGrade": number,
      "advice": string
    }
  `;

  const maxTokens = isThinkingModel(model) ? 8192 : 1024;
  const raw = await callGemini(prompt, model, maxTokens, 0.3);
  const cleaned = cleanJsonObject(raw);
  const parsed = JSON.parse(cleaned);
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
  const model = payload.modelOverride || defaultModel;
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

  const maxTokens = isThinkingModel(model) ? 4096 : 512;
  const raw = await callGemini(prompt, model, maxTokens, 0.2);
  const cleaned = cleanJsonObject(raw);
  const parsed = JSON.parse(cleaned);
  return NextResponse.json({ result: parsed });
}
