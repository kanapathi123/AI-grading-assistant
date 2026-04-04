import type {
  Criterion,
  ContextItem,
  AssessmentType,
  AssessmentLength,
  OverallAssessmentResult,
} from '@/types';
import type { PromptConfig } from '@/lib/prompt-assembly';
import type { EditablePromptSlots, FeedbackStyleConfig } from '@/lib/grading-prompt-system';

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

export interface PlaygroundGradeCriterion {
  name: string;
  scoreRange: { min: number; max: number };
}

export interface PlaygroundGradeResult {
  results: Array<{
    criterionName: string;
    justification: string[];
    evidenceQuotes: Array<{ quote: string }>;
    score: number | null;
    error?: string;
  }>;
  metadata: {
    mode: 'parity';
    importable: boolean;
  };
}

export interface PlaygroundOptimizeResult {
  revisedConfig: PromptConfig;
}

export interface PlaygroundSuggestion {
  id: string;
  text: string;
}

export interface PlaygroundCompareGradeResult {
  original: {
    overallScore: number;
    maxScore: number;
    criteria: Array<{
      name: string;
      score: number;
      maxScore: number;
      feedback: string;
      evidenceQuotes: string[];
    }>;
  };
  revised: {
    overallScore: number;
    maxScore: number;
    criteria: Array<{
      name: string;
      score: number;
      maxScore: number;
      feedback: string;
      evidenceQuotes: string[];
    }>;
  };
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
 * Create a rubric cache — caches rubric + essay + system prompt for reuse across criteria
 */
export const createRubricCache = async (
  rubricContent: string,
  contextList?: ContextItem[],
  modelOverride?: string
): Promise<{ cacheName: string | null; tokenCount: number | null }> => {
  try {
    const result = await callApi('createRubricCache', {
      rubricContent,
      contextList,
      modelOverride,
    });
    return { cacheName: result.cacheName ?? null, tokenCount: result.tokenCount ?? null };
  } catch {
    return { cacheName: null, tokenCount: null };
  }
};

/**
 * Delete a rubric cache
 */
export const deleteRubricCache = async (cacheName: string): Promise<void> => {
  try {
    await callApi('deleteRubricCache', { cacheName });
  } catch {
    // Best-effort cleanup
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
  modelOverride?: string,
  cacheName?: string | null
): Promise<GradeSingleCriterionResult> => {
  try {
    const result = await callApi('gradeSingleCriterion', {
      essayContent,
      criterion: { name: criterion.name, id: criterion.id, scoreRange: criterion.scoreRange },
      assessmentType: options.assessmentType,
      assessmentLength: options.assessmentLength,
      contextList,
      modelOverride,
      cacheName: cacheName || undefined,
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
 * Optimize builder config using user feedback.
 */
export const optimizePlaygroundConfig = async (
  currentConfig: PromptConfig,
  feedback: string,
  modelOverride?: string
): Promise<PlaygroundOptimizeResult> => {
  const result = await callApi('playgroundOptimizeConfig', {
    currentConfig,
    feedback,
    modelOverride,
  });

  const revisedConfig = result?.revisedConfig as PromptConfig | undefined;
  if (!revisedConfig) {
    throw new Error('Optimization response did not include revisedConfig');
  }

  return { revisedConfig };
};

/**
 * Grade an essay using prompt slots and style derived from a config.
 */
export const gradePlaygroundWithConfig = async (params: {
  essayText: string;
  criteria: PlaygroundGradeCriterion[];
  promptSlots: EditablePromptSlots;
  styleOverrides?: Partial<FeedbackStyleConfig>;
  assessmentType?: 'flow' | 'bullets';
  modelOverride?: string;
}): Promise<PlaygroundGradeResult> => {
  const result = await callApi('playgroundGrade', {
    essayText: params.essayText,
    criteria: params.criteria,
    promptSlots: params.promptSlots,
    styleOverrides: params.styleOverrides,
    assessmentType: params.assessmentType || 'flow',
    modelOverride: params.modelOverride,
  });

  const results = Array.isArray(result?.results) ? result.results : [];
  const metadata = result?.metadata && typeof result.metadata === 'object'
    ? result.metadata
    : { mode: 'parity', importable: false };

  return {
    results,
    metadata,
  };
};

/**
 * Generate concise optimization suggestions from current config and recent runs.
 */
export const getPlaygroundOptimizationSuggestions = async (params: {
  currentConfig: PromptConfig;
  essays?: Array<{ text: string }>;
  gradingResults?: Array<Record<string, unknown>>;
  modelOverride?: string;
}): Promise<PlaygroundSuggestion[]> => {
  const result = await callApi('playgroundOptimizeSuggestions', {
    currentConfig: params.currentConfig,
    essays: params.essays,
    gradingResults: params.gradingResults,
    modelOverride: params.modelOverride,
  });

  return Array.isArray(result?.suggestions)
    ? result.suggestions.filter(
        (row: unknown): row is PlaygroundSuggestion =>
          !!row && typeof row === 'object' && typeof (row as PlaygroundSuggestion).id === 'string' && typeof (row as PlaygroundSuggestion).text === 'string'
      )
    : [];
};

/**
 * Compare grading outputs between two prompt configurations.
 */
export const comparePlaygroundGrades = async (params: {
  essayText: string;
  originalConfig: PromptConfig & {
    promptSlots: EditablePromptSlots;
    styleOverrides?: Partial<FeedbackStyleConfig>;
    assessmentType: 'flow' | 'bullets';
  };
  revisedConfig: PromptConfig & {
    promptSlots: EditablePromptSlots;
    styleOverrides?: Partial<FeedbackStyleConfig>;
    assessmentType: 'flow' | 'bullets';
  };
  modelOverride?: string;
}): Promise<PlaygroundCompareGradeResult> => {
  const result = await callApi('playgroundCompareGrade', {
    essayText: params.essayText,
    originalConfig: params.originalConfig,
    revisedConfig: params.revisedConfig,
    modelOverride: params.modelOverride,
  });

  if (!result?.original || !result?.revised) {
    throw new Error('Compare response missing original or revised result');
  }

  return result as PlaygroundCompareGradeResult;
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
  createRubricCache,
  deleteRubricCache,
  gradeSingleCriterion,
  generateOverallAssessment,
  reviseCriterionScoreWithJustification,
  optimizePlaygroundConfig,
  gradePlaygroundWithConfig,
  getPlaygroundOptimizationSuggestions,
  comparePlaygroundGrades,
  uploadContextDump,
};

export default geminiService;
