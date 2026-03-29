import type {
  Criterion,
  ContextItem,
  AssessmentType,
  AssessmentLength,
  OverallAssessmentResult,
} from '@/types';

interface GradeSingleCriterionOptions {
  assessmentType?: AssessmentType;
  assessmentLength?: AssessmentLength;
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

async function callApi(action: string, payload: Record<string, unknown>) {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `API error ${res.status}`);
  }

  const data = await res.json();
  return data.result;
}

/**
 * Extract criteria from a rubric
 */
export const extractRubricCriteria = async (
  rubricContent: string,
  modelOverride?: string
): Promise<Criterion[] | 'NO_VALID_RUBRIC'> => {
  try {
    const result = await callApi('extractRubricCriteria', { rubricContent, modelOverride });
    return result;
  } catch (error) {
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
  try {
    const result = await callApi('gradeSingleCriterion', {
      essayContent,
      criterion: { name: criterion.name, id: criterion.id, scoreRange: criterion.scoreRange },
      assessmentType: options.assessmentType,
      assessmentLength: options.assessmentLength,
      contextList,
      modelOverride,
    });
    return result;
  } catch {
    return {
      justification: 'There was an error processing this criterion. Please try again.',
      evidence: [],
      score: null,
      error: 'REQUEST_FAILED',
    };
  }
};

/**
 * Generate an overall assessment based on criterion scores
 */
export const generateOverallAssessment = async (
  essayContent: string,
  criteriaWithScores: CriterionWithScore[],
  _options: Record<string, unknown> = {},
  contextList?: ContextItem[],
  modelOverride?: string
): Promise<OverallAssessmentResult> => {
  try {
    const result = await callApi('generateOverallAssessment', {
      essayContent,
      criteriaWithScores,
      contextList,
      modelOverride,
    });
    return result;
  } catch {
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
  _options: Record<string, unknown> = {},
  modelOverride?: string
): Promise<ReviseResult> => {
  try {
    const result = await callApi('reviseCriterionScore', {
      essayContent,
      criterion: { name: criterion.name, scoreRange: criterion.scoreRange },
      originalJustification,
      editedJustification,
      originalScore,
      modelOverride,
    });
    return result;
  } catch {
    return {
      revisedScore: originalScore,
      rationale: 'There was an error revising the score. The original score is retained.',
    };
  }
};

/**
 * Upload context dump — no longer needed server-side, kept for API compatibility
 */
export const uploadContextDump = async (
  _contextList: ContextItem[],
  _modelOverride?: string
): Promise<string> => {
  return 'context-not-used';
};

const geminiService = {
  extractRubricCriteria,
  gradeSingleCriterion,
  generateOverallAssessment,
  reviseCriterionScoreWithJustification,
  uploadContextDump,
};

export default geminiService;
