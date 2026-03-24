import { GoogleGenAI, createUserContent } from '@google/genai';
import geminiConfig from '@/lib/gemini-config';
import type {
  Criterion,
  ContextItem,
  AssessmentType,
  AssessmentLength,
  OverallAssessmentResult,
} from '@/types';

const ai = new GoogleGenAI({ apiKey: geminiConfig.apiKey });

interface GradeSingleCriterionOptions {
  assessmentType?: AssessmentType;
  assessmentLength?: AssessmentLength;
  generationConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CriterionWithScore {
  name: string;
  teacherScore?: number | null;
  aiScore?: number | null;
  scoreRange: { max: number };
  [key: string]: unknown;
}

interface GradeSingleCriterionResult {
  justification: string | string[];
  evidence: Array<{
    quote: string;
    paragraph: string;
    relatedAssessmentIndexes?: number[];
  }>;
  score: number | null;
  error?: string;
}

interface ReviseResult {
  revisedScore: number;
  rationale: string;
  error?: string;
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

function is503Error(error: unknown): boolean {
  if (error && typeof error === 'object' && 'message' in error) {
    return /503|overloaded|UNAVAILABLE/i.test((error as Error).message);
  }
  return false;
}

/**
 * Extract criteria from a rubric
 */
export const extractRubricCriteria = async (
  rubricContent: string,
  modelOverride?: string
): Promise<Criterion[] | 'NO_VALID_RUBRIC'> => {
  const prompt = `
    If the provided text is not a grading rubric, or you are not confident you can extract meaningful criteria, respond with the string: NO_VALID_RUBRIC (no JSON, no explanation).

    Analyze the following grading rubric and extract each criterion.
    For each criterion, identify:
    1. The name/title of the criterion
    2. The possible score range (e.g., 1-5)
    3. The description for each score level

    RUBRIC:
    ${rubricContent}

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

  const rubricModel = modelOverride || geminiConfig.model;
  const isThinkingRubric = rubricModel.includes('2.5') || rubricModel.includes('3');
  const mergedGenerationConfig: Record<string, unknown> = {
    maxOutputTokens: isThinkingRubric ? 8192 : 2048,
  };
  if (!isThinkingRubric) {
    mergedGenerationConfig.temperature = 0.1;
  }

  try {
    const response = await ai.models.generateContent({
      model: rubricModel,
      contents: [createUserContent([prompt])],
      config: mergedGenerationConfig,
    });

    let cleanedResponse = (response.text ?? '').trim();

    if (cleanedResponse.toUpperCase() === 'NO_VALID_RUBRIC') {
      return 'NO_VALID_RUBRIC';
    }

    cleanedResponse = cleanJsonArray(cleanedResponse);
    return JSON.parse(cleanedResponse) as Criterion[];
  } catch (error) {
    if (is503Error(error) && (!modelOverride || modelOverride === geminiConfig.model)) {
      try {
        return await extractRubricCriteria(rubricContent, 'gemini-1.5-flash');
      } catch {
        throw new Error('MODEL_OVERLOADED');
      }
    }
    throw error;
  }
};

/**
 * Upload a context dump to Gemini's context caching endpoint.
 */
export const uploadContextDump = async (
  contextList: ContextItem[],
  modelOverride?: string
): Promise<string> => {
  try {
    const contents = contextList.map((item) =>
      createUserContent([{ text: `${item.title}\n${item.content}` }])
    );
    const modelToUse = modelOverride || geminiConfig.model;
    const cache = await ai.caches.create({
      model: modelToUse,
      config: {
        contents: contents,
        systemInstruction:
          'You are an expert essay grading assistant. Use the provided context for all subsequent requests.',
      },
    });
    return cache.name!;
  } catch (error) {
    if (is503Error(error) && (!modelOverride || modelOverride === geminiConfig.model)) {
      try {
        return await uploadContextDump(contextList, 'gemini-1.5-flash');
      } catch {
        throw new Error('MODEL_OVERLOADED');
      }
    }
    throw error;
  }
};

/**
 * Grade a single criterion from a rubric
 */
export const gradeSingleCriterion = async (
  essayContent: string,
  criterion: Criterion,
  options: GradeSingleCriterionOptions = {},
  contextList?: ContextItem[],
  modelOverride?: string
): Promise<GradeSingleCriterionResult> => {
  const assessmentType = options.assessmentType || 'flow';
  const assessmentLength = options.assessmentLength || 'long';

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
    lengthInstruction = 'Be concise and brief.';
  } else if (assessmentLength === 'medium') {
    lengthInstruction = 'Be balanced in detail and length.';
  } else {
    lengthInstruction = 'Be detailed and extended.';
  }

  let contextBlock = '';
  if (contextList && contextList.length > 0) {
    contextBlock =
      'CONTEXT DUMP:\n' +
      contextList.map((ctx) => `- ${ctx.title}: ${ctx.content}`).join('\n') +
      '\n';
  }

  const prompt = `
    ${contextBlock}
    You are an expert essay grader of a masters level course. Grade the following essay based on a single criterion from a rubric. Your assessment must include specific references to the rubric criterion, quoting or paraphrasing the relevant rubric language as appropriate. Be critical and concise like a masters level professor would be.

    CRITERION: ${criterion.name}
    SCORE RANGE: ${criterion.scoreRange.min} to ${criterion.scoreRange.max}

    ESSAY:
    ${essayContent}

    Provide the following in your response:
    1. A justification for your assessment (without revealing the exact score). ${justificationInstruction} ${lengthInstruction}
    2. At least 3 specific quotes from the essay that support your assessment
    3. For each quote, indicate which sentences or bullet points from your justification it supports. ${relateInstruction}
    4. Your numerical score (${criterion.scoreRange.min}-${criterion.scoreRange.max})

    FORMAT YOUR RESPONSE AS A VALID JSON object:
    {
      ${justificationSchema}
      "evidence": [
        {
          "quote": "exact quote from essay",
          "paragraph": "paragraph number or location",
          "relatedAssessmentIndexes": [array of integers, optional]
        },
        ...
      ],
      "score": number
    }

    DO NOT include any explanatory text before or after the JSON object.
    ONLY return the JSON object and nothing else.
  `;

  const modelToUse = modelOverride || geminiConfig.model;
  const isThinkingModel = modelToUse.includes('2.5') || modelToUse.includes('3');

  const mergedGenerationConfig: Record<string, unknown> = {
    ...(options.generationConfig || {}),
    maxOutputTokens: isThinkingModel ? 8192 : 1024,
  };

  // Thinking models don't support temperature; non-thinking do
  if (!isThinkingModel) {
    mergedGenerationConfig.temperature = 0.2;
  }

  try {
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: [createUserContent([prompt])],
      config: mergedGenerationConfig,
    });

    const rawText = response.text ?? '';
    if (!rawText.trim()) {
      console.error('gradeSingleCriterion: empty response from model');
      return {
        justification: 'The AI returned an empty response. Please try again.',
        evidence: [],
        score: null,
        error: 'EMPTY_RESPONSE',
      };
    }
    let cleanedResponse = rawText.trim();
    cleanedResponse = cleanJsonObject(cleanedResponse);
    return JSON.parse(cleanedResponse) as GradeSingleCriterionResult;
  } catch (error) {
    if (is503Error(error) && (!modelOverride || modelOverride === geminiConfig.model)) {
      try {
        return await gradeSingleCriterion(
          essayContent,
          criterion,
          options,
          contextList,
          'gemini-1.5-flash'
        );
      } catch {
        return {
          justification:
            'The Gemini API is overloaded. Please try again in a few minutes.',
          evidence: [],
          score: null,
          error: 'MODEL_OVERLOADED',
        };
      }
    }
    console.error('gradeSingleCriterion error:', error);
    return {
      justification:
        'There was an error processing this criterion. Please try again.',
      evidence: [],
      score: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Generate an overall assessment based on criterion scores
 */
export const generateOverallAssessment = async (
  essayContent: string,
  criteriaWithScores: CriterionWithScore[],
  options: Record<string, unknown> = {},
  contextList?: ContextItem[],
  modelOverride?: string
): Promise<OverallAssessmentResult> => {
  const strengthsInstruction = 'Present strengths as a coherent paragraph.';
  const improvementsInstruction =
    'Present areas for improvement as a coherent paragraph.';
  const lengthInstruction = '';

  const criteriaText = criteriaWithScores
    .map(
      (c) =>
        `${c.name}: Score ${c.teacherScore || c.aiScore} out of ${c.scoreRange.max}`
    )
    .join('\n');

  let contextBlock = '';
  if (contextList && contextList.length > 0) {
    contextBlock =
      'CONTEXT DUMP:\n' +
      contextList.map((ctx) => `- ${ctx.title}: ${ctx.content}`).join('\n') +
      '\n';
  }

  const prompt = `
    ${contextBlock}
    You are an expert essay grader. Given the following essay and the scores for each criterion, provide an overall assessment.
    Summarize the essay's strengths and areas for improvement.
    Then, generate a final grade on a 0-10 scale (with decimals allowed), where the individual criterion scores are on their own scales (typically 1-5).
    The final grade should reflect the average performance across all criteria, converted to a 10-point scale.

    ${strengthsInstruction} ${improvementsInstruction} ${lengthInstruction}

    ESSAY:
    ${essayContent}

    CRITERIA & SCORES:
    ${criteriaText}

    FORMAT YOUR RESPONSE AS A VALID JSON OBJECT with the following keys:
    {
      "strengths": string,
      "improvements": string,
      "overallGrade": number, // final grade on a 0-10 scale (decimals allowed)
      "advice": string
    }
  `;

  const overallModel = modelOverride || geminiConfig.model;
  const isThinkingOverall = overallModel.includes('2.5') || overallModel.includes('3');
  const mergedGenerationConfig: Record<string, unknown> = {
    ...((options.generationConfig as Record<string, unknown>) || {}),
    maxOutputTokens: isThinkingOverall ? 8192 : 1024,
  };
  if (!isThinkingOverall) {
    mergedGenerationConfig.temperature = 0.3;
  }

  try {
    const response = await ai.models.generateContent({
      model: overallModel,
      contents: [createUserContent([prompt])],
      config: mergedGenerationConfig,
    });

    let cleanedResponse = (response.text ?? '').trim();
    cleanedResponse = cleanJsonObject(cleanedResponse);
    return JSON.parse(cleanedResponse) as OverallAssessmentResult;
  } catch (error) {
    if (is503Error(error) && (!modelOverride || modelOverride === geminiConfig.model)) {
      try {
        return await generateOverallAssessment(
          essayContent,
          criteriaWithScores,
          options,
          contextList,
          'gemini-1.5-flash'
        );
      } catch {
        return {
          strengths:
            'The Gemini API is overloaded. Please try again in a few minutes.',
          improvements: 'Please review the individual criteria scores.',
          overallGrade: 'N/A',
          advice: 'Consider reviewing each criterion individually.',
          error: 'MODEL_OVERLOADED',
        };
      }
    }
    return {
      strengths: 'There was an error generating the overall assessment.',
      improvements: 'Please review the individual criteria scores.',
      overallGrade: 'N/A',
      advice: 'Consider reviewing each criterion individually.',
    };
  }
};

/**
 * Revise the AI's score for a criterion based on edited justification text.
 */
export const reviseCriterionScoreWithJustification = async (
  essayContent: string,
  criterion: Criterion,
  originalJustification: string,
  editedJustification: string,
  originalScore: number,
  options: Record<string, unknown> = {},
  modelOverride?: string
): Promise<ReviseResult> => {
  const prompt = `
    You are an expert essay grader. The following is an essay, a rubric criterion, and two versions of the justification for the assessment of this criterion: the original justification (from an AI) and an edited justification (from a human reviewer). The original numerical score was ${originalScore}.

    Please carefully consider the edited justification. If the edits suggest a different score is warranted, revise the score accordingly. Otherwise, keep the original score. Provide a brief rationale for your decision.

    ESSAY:
    ${essayContent}

    CRITERION: ${criterion.name}
    SCORE RANGE: ${criterion.scoreRange.min} to ${criterion.scoreRange.max}

    ORIGINAL JUSTIFICATION:
    ${originalJustification}

    EDITED JUSTIFICATION:
    ${editedJustification}

    ORIGINAL SCORE: ${originalScore}

    FORMAT YOUR RESPONSE AS A VALID JSON object:
    {
      "revisedScore": number, // the new score (or the original if unchanged)
      "rationale": "A brief explanation for your decision"
    }

    DO NOT include any explanatory text before or after the JSON object.
    ONLY return the JSON object and nothing else.
  `;

  const reviseModel = modelOverride || geminiConfig.model;
  const isThinkingRevise = reviseModel.includes('2.5') || reviseModel.includes('3');
  const mergedGenerationConfig: Record<string, unknown> = {
    ...((options.generationConfig as Record<string, unknown>) || {}),
    maxOutputTokens: isThinkingRevise ? 4096 : 512,
  };
  if (!isThinkingRevise) {
    mergedGenerationConfig.temperature = 0.2;
  }

  try {
    const response = await ai.models.generateContent({
      model: reviseModel,
      contents: [createUserContent([prompt])],
      config: mergedGenerationConfig,
    });

    let cleanedResponse = (response.text ?? '').trim();
    cleanedResponse = cleanJsonObject(cleanedResponse);
    return JSON.parse(cleanedResponse) as ReviseResult;
  } catch (error) {
    if (is503Error(error) && (!modelOverride || modelOverride === geminiConfig.model)) {
      try {
        return await reviseCriterionScoreWithJustification(
          essayContent,
          criterion,
          originalJustification,
          editedJustification,
          originalScore,
          options,
          'gemini-1.5-flash'
        );
      } catch {
        return {
          revisedScore: originalScore,
          rationale:
            'The Gemini API is overloaded. Please try again in a few minutes.',
          error: 'MODEL_OVERLOADED',
        };
      }
    }
    return {
      revisedScore: originalScore,
      rationale:
        'There was an error revising the score. The original score is retained.',
    };
  }
};

const geminiService = {
  extractRubricCriteria,
  gradeSingleCriterion,
  generateOverallAssessment,
  reviseCriterionScoreWithJustification,
  uploadContextDump,
};

export default geminiService;
