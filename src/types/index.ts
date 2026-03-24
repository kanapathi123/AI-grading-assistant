export interface ScoreRange {
  min: number;
  max: number;
}

export interface CriterionLevel {
  score: number;
  description: string;
}

export interface Criterion {
  id: number;
  name: string;
  scoreRange: ScoreRange;
  levels: CriterionLevel[];
}

export interface Evidence {
  quote: string;
  paragraph: string;
  relatedAssessmentIndexes?: number[];
  context?: string;
  keywords?: string[];
}

export interface Assessment extends Criterion {
  justification: string | string[];
  evidence: Evidence[];
  score: number;
  aiScore: number | null;
  originalAiScore: number | null;
  revisionRationale: string | null;
  revisedAssessmentText: string | null;
  revisions?: Assessment[];
  error?: string;
}

export interface OverallAssessmentResult {
  strengths: string;
  improvements: string;
  overallGrade: number | string;
  advice: string;
  error?: string;
}

export interface ContextItem {
  id?: string;
  title: string;
  content: string;
}

export interface GradeRecord {
  timestamp: string;
  teacher_name: string;
  essay_id: string;
  criterion_name: string;
  criterion_id: string;
  teacher_score: number | null;
  ai_score: number | null;
  revised_ai_score: number | null;
  assessment_text: string | null;
  revised_assessment_text: string | null;
  revision_rationale: string | null;
  time_spent_seconds: number | null;
  hallucinations_detected: number;
  hallucinations_confirmed: number;
  hallucinations_reported: number;
  action_type: string;
}

export type AssessmentType = 'flow' | 'bullets';

export type AssessmentLength = 'short' | 'medium' | 'long';

export type HallucinationThreshold = 'low' | 'medium' | 'high';

export type ViewType = 'dashboard' | 'grading' | 'analytics';

export type WorkflowStep = 'welcome' | 'rubric' | 'essay' | 'settings' | 'grading' | 'complete';

export interface ThresholdConfig {
  minConfidence: number;
  minMatchScore: number;
  severities: string[];
}

export interface HallucinationResult {
  found: boolean;
  confidence: number;
  matchType: string;
  matchedChunk?: string;
  closestMatch?: string;
}

export interface DetectedHallucination {
  id: string;
  type: string;
  quote: string;
  fullQuote: string;
  correction: string;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  status: 'detected' | 'confirmed' | 'dismissed' | 'teacher-reported';
  matchResult: HallucinationResult;
  criterionName: string;
  explanation?: string;
  reportedAt?: string;
}
