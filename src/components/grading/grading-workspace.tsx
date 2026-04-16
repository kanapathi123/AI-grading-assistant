'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Plus,
  ChevronLeft,
  ChevronRight,
  Play,
  Check,
  Trash2,
  Sparkles,
  FileUp,
  Type,
} from 'lucide-react';
import type {
  Criterion,
  Assessment,
  Evidence,
  ContextItem,
  AssessmentType,
  AssessmentLength,
  HallucinationThreshold,
  OverallAssessmentResult,
  WorkflowStep,
} from '@/types';
import {
  extractRubricCriteria,
  createRubricCache,
  deleteRubricCache,
  gradeSingleCriterion,
  generateOverallAssessment,
} from '@/lib/gemini-service';
import { extractTextFromPdf } from '@/lib/pdf-utils';
import type { CsvRecorder } from '@/lib/csv-recorder';

import WelcomeSection from '@/components/grading/welcome-section';
import EssayUpload from '@/components/grading/essay-upload';
import AssessmentSettings from '@/components/grading/assessment-settings';
import RubricPreview from '@/components/grading/rubric-preview';
import ContextDialog from '@/components/grading/context-dialog';
import InteractiveGrading from '@/components/grading/interactive-grading';

/* -------------------------------------------------------------------------- */
/*  Props                                                                      */
/* -------------------------------------------------------------------------- */

export interface GradingWorkspaceProps {
  recorder: CsvRecorder;
}

type PlaygroundCriterionLevel = {
  score: number;
  description: string;
};

type PlaygroundCriterion = {
  name: string;
  scoreRange: { min: number; max: number };
  levels: PlaygroundCriterionLevel[];
};

type PlaygroundSet = {
  id: string;
  name: string;
  updatedAt: string;
  config?: {
    criteria?: unknown[];
    feedbackInstructionText?: string;
  };
};

const PLAYGROUND_SETS_STORAGE_KEY = 'prompt-playground-sets-v2';

/* -------------------------------------------------------------------------- */
/*  Step indicator                                                             */
/* -------------------------------------------------------------------------- */

const STEPS: { key: WorkflowStep; label: string }[] = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'rubric', label: 'Rubric' },
  { key: 'essay', label: 'Essay' },
  { key: 'settings', label: 'Settings' },
  { key: 'grading', label: 'Grading' },
  { key: 'complete', label: 'Complete' },
];

function StepIndicator({ currentStep }: { currentStep: WorkflowStep }) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-3">
      {STEPS.map((step, i) => {
        const isActive = i === currentIndex;
        const isDone = i < currentIndex;
        return (
          <React.Fragment key={step.key}>
            {i > 0 && (
              <div
                className="h-0.5 w-6 rounded-full transition-colors duration-300"
                style={{ background: isDone ? '#6366F1' : 'var(--card-border)' }}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                  isActive
                    ? 'bg-[#6366F1] text-white shadow-md shadow-indigo-500/30'
                    : isDone
                    ? 'bg-[#6366F1] text-white'
                    : 'border border-[var(--card-border)] text-[var(--muted)]'
                }`}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={`hidden text-xs font-medium sm:inline ${
                  isActive ? 'text-[#6366F1]' : isDone ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'
                }`}
              >
                {step.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Step wrapper with navigation                                               */
/* -------------------------------------------------------------------------- */

function StepContainer({
  children,
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  nextIcon,
}: {
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextIcon?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      {children}
      <div className="flex items-center justify-between pt-2">
        {onBack ? (
          <button
            onClick={onBack}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--card-border)] px-4 py-2.5 text-sm font-medium transition-colors duration-200 hover:bg-[var(--card-bg)]"
            style={{ color: 'var(--muted)' }}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        ) : (
          <div />
        )}
        {onNext && (
          <button
            onClick={onNext}
            disabled={nextDisabled}
            className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#6366F1] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:bg-[#5558E6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {nextLabel || 'Next'}
            {nextIcon || <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Slide animation                                                            */
/* -------------------------------------------------------------------------- */

const slideVariants = {
  initial: { opacity: 0, x: 40 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.25 } },
  exit: { opacity: 0, x: -40, transition: { duration: 0.15 } },
};

const EXAMPLE_RUBRIC_CRITERIA: Criterion[] = [
  {
    id: 1, name: 'System Design',
    scoreRange: { min: 1, max: 5 },
    levels: [
      { score: 5, description: 'Demonstrates a comprehensive and well-justified system design. All components are clearly defined, logically connected, and appropriate for the problem scope. Trade-offs are discussed thoughtfully.' },
      { score: 4, description: 'Presents a solid system design with most components well-defined. Minor gaps in justification or connectivity between components.' },
      { score: 3, description: 'Provides an adequate system design. Some components may be underdeveloped or lack clear justification. Connections between components are present but not fully articulated.' },
      { score: 2, description: 'System design is incomplete or poorly justified. Key components are missing or not logically connected.' },
      { score: 1, description: 'No meaningful system design is presented, or the design is fundamentally flawed.' },
    ],
  },
  {
    id: 2, name: 'Tools',
    scoreRange: { min: 1, max: 5 },
    levels: [
      { score: 5, description: 'Selects and applies highly appropriate tools and technologies for the task. Justifies tool choices with clear reasoning and demonstrates deep understanding of their capabilities and limitations.' },
      { score: 4, description: 'Uses appropriate tools with reasonable justification. Demonstrates good understanding of tool capabilities.' },
      { score: 3, description: 'Tools are adequate but choices may not be fully justified. Some understanding of tool capabilities demonstrated.' },
      { score: 2, description: 'Tool selection is questionable or poorly justified. Limited understanding of tool capabilities shown.' },
      { score: 1, description: 'Tools are inappropriate for the task or no tools are discussed.' },
    ],
  },
  {
    id: 3, name: 'Process Reflection',
    scoreRange: { min: 1, max: 5 },
    levels: [
      { score: 5, description: 'Provides deep and insightful reflection on the development process. Clearly identifies challenges, decisions, and lessons learned. Demonstrates critical thinking about what worked and what could be improved.' },
      { score: 4, description: 'Offers meaningful reflection with identification of key challenges and decisions. Some critical analysis present.' },
      { score: 3, description: 'Reflection is present but surface-level. Identifies some challenges but lacks depth in analysis.' },
      { score: 2, description: 'Minimal reflection provided. Few challenges or decisions are discussed.' },
      { score: 1, description: 'No meaningful reflection on the process is provided.' },
    ],
  },
  {
    id: 4, name: 'Expectations & Conclusion',
    scoreRange: { min: 1, max: 5 },
    levels: [
      { score: 5, description: 'Sets clear expectations and provides a compelling conclusion. Effectively summarizes key findings, acknowledges limitations, and outlines future directions with specificity.' },
      { score: 4, description: 'Expectations are clear and conclusion is well-structured. Most key points are summarized with some discussion of limitations and future work.' },
      { score: 3, description: 'Expectations and conclusion are present but may lack clarity or completeness. Some summary of findings provided.' },
      { score: 2, description: 'Expectations are vague and conclusion is weak. Limited summary of findings.' },
      { score: 1, description: 'No clear expectations set and conclusion is missing or meaningless.' },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/*  RubricTable component                                                      */
/* -------------------------------------------------------------------------- */

function RubricTable({
  criteria,
  onChange,
}: {
  criteria: Criterion[];
  onChange: (next: Criterion[]) => void;
}) {
  const addCriterion = () => {
    onChange([
      ...criteria,
      {
        id: criteria.length > 0 ? Math.max(...criteria.map((c) => c.id)) + 1 : 1,
        name: '',
        scoreRange: { min: 0, max: 3 },
        levels: [{ score: 3, description: '' }, { score: 2, description: '' }, { score: 1, description: '' }, { score: 0, description: '' }],
      },
    ]);
  };

  const removeCriterion = (id: number) => {
    onChange(criteria.filter((c) => c.id !== id));
  };

  const updateCriterion = (id: number, patch: Partial<Criterion>) => {
    onChange(
      criteria.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        if ('scoreRange' in patch) {
          const { min, max } = next.scoreRange;
          const existingLevels = next.levels;
          const newLevels = [];
          for (let score = max; score >= min; score -= 1) {
            const existing = existingLevels.find((l) => l.score === score);
            newLevels.push({ score, description: existing?.description ?? '' });
          }
          next.levels = newLevels;
        }
        return next;
      })
    );
  };

  const updateLevel = (id: number, score: number, value: string) => {
    onChange(criteria.map((c) => (c.id === id ? { ...c, levels: c.levels.map((l) => l.score === score ? { ...l, description: value } : l) } : c)));
  };

  return (
    <div className="space-y-4">
      {criteria.map((criterion) => (
        <div key={criterion.id} className="space-y-2 py-3">
          <div className="mb-3 flex items-center gap-2">
            <input
              value={criterion.name}
              onChange={(e) => updateCriterion(criterion.id, { name: e.target.value })}
              placeholder="Criterion name"
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <input
              type="number"
              min={0}
              value={criterion.scoreRange.min}
              onChange={(e) => updateCriterion(criterion.id, { scoreRange: { ...criterion.scoreRange, min: Number(e.target.value) } })}
              className="w-14 rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              title="Min score"
            />
            <input
              type="number"
              min={1}
              value={criterion.scoreRange.max}
              onChange={(e) => updateCriterion(criterion.id, { scoreRange: { ...criterion.scoreRange, max: Number(e.target.value) } })}
              className="w-14 rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              title="Max score"
            />
            <button
              onClick={() => removeCriterion(criterion.id)}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
              title="Remove criterion"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="w-16 border-r border-slate-200 py-2 text-center">Score</th>
                  <th className="px-3 py-2 text-left">Description</th>
                </tr>
              </thead>
              <tbody>
                {[...criterion.levels]
                  .sort((a, b) => b.score - a.score)
                  .map((level) => (
                    <tr key={level.score} className="border-t border-slate-200 bg-white">
                      <td className="border-r border-slate-200 py-2 text-center font-semibold text-slate-700">
                        {level.score}
                      </td>
                      <td className="p-2">
                        <textarea
                          rows={2}
                          value={level.description}
                          onChange={(e) => updateLevel(criterion.id, level.score, e.target.value)}
                          placeholder={`Description for score ${level.score}`}
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div>
        <button
          onClick={addCriterion}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Add Criterion
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function GradingWorkspace({ recorder }: GradingWorkspaceProps) {
  /* ---- workflow step ---- */
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('welcome');

  /* ---- core data state ---- */
  const [essayFile, setEssayFile] = useState<string | null>(null);
  const [essayFileName, setEssayFileName] = useState<string | null>(null);
  const [pdfContent, setPdfContent] = useState<string>('');
  const [rubricCriteria, setRubricCriteria] = useState<Criterion[]>([
    { id: 1, name: '', scoreRange: { min: 0, max: 3 }, levels: [{ score: 3, description: '' }, { score: 2, description: '' }, { score: 1, description: '' }, { score: 0, description: '' }] },
  ]);
  const [criteriaAssessments, setCriteriaAssessments] = useState<Record<string, Assessment>>({});

  /* ---- grading navigation state ---- */
  const [currentCriterionIndex, setCurrentCriterionIndex] = useState<number>(0);
  const [teacherScores, setTeacherScores] = useState<Record<string, number | null>>({});
  const [showAIScores, setShowAIScores] = useState<Record<string, boolean>>({});
  const [gradingComplete, setGradingComplete] = useState<boolean>(false);
  const [overallAssessment, setOverallAssessment] = useState<OverallAssessmentResult | null>(null);
  const [originalOverallAssessment, setOriginalOverallAssessment] = useState<OverallAssessmentResult | null>(null);

  /* ---- settings state ---- */
  const [contextList, setContextList] = useState<ContextItem[]>([]);
  const [assessmentType, setAssessmentType] = useState<AssessmentType>('flow');
  const [assessmentLength, setAssessmentLength] = useState<AssessmentLength>('medium');
  const [hallucinationThreshold, setHallucinationThreshold] = useState<HallucinationThreshold>('medium');
  const [additionalInstructions, setAdditionalInstructions] = useState<string>('');

  /* ---- UI state ---- */
  const [isProcessingRubric, setIsProcessingRubric] = useState<boolean>(false);
  const [rubricCreationMode, setRubricCreationMode] = useState<'manual' | 'paste' | 'upload' | 'import'>('import');
  const [playgroundSets, setPlaygroundSets] = useState<PlaygroundSet[]>([]);
  const [selectedPlaygroundSetId, setSelectedPlaygroundSetId] = useState<string>('');
  const [settingsSelectedSetId, setSettingsSelectedSetId] = useState<string>('');
  const [showContextDialog, setShowContextDialog] = useState<boolean>(false);
  const [rubricPasteContent, setRubricPasteContent] = useState<string>('');
  const [rubricUploadExtracting, setRubricUploadExtracting] = useState<boolean>(false);
  const [rubricUploadFileName, setRubricUploadFileName] = useState<string | null>(null);
  const rubricFileInputRef = useRef<HTMLInputElement>(null);

  /* ---- timing ---- */
  const [criterionStartTime, setCriterionStartTime] = useState<number | null>(null);

  /* ---- pdf evidence highlight ---- */
  const [activePdfEvidence, setActivePdfEvidence] = useState<Evidence | null>(null);

  /* ---- hallucination tracking ---- */
  const [hallucinationCounts, setHallucinationCounts] = useState<
    Record<string, { detected: number; confirmed: number; reported: number }>
  >({});

  /* ---- context cache for rubric+essay reuse ---- */
  const [cacheName, setCacheName] = useState<string | null>(null);

  /* ---- ref to prevent duplicate grading ---- */
  const gradingInProgress = useRef<Set<number>>(new Set());

  const parsePlaygroundCriteria = useCallback((rawCriteria: unknown[]): PlaygroundCriterion[] => {
    return rawCriteria
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => {
        const row = item as Record<string, unknown>;
        const name = typeof row.name === 'string' ? row.name.trim() : '';

        const rawScoreRange = row.scoreRange;
        const scoreRange =
          rawScoreRange && typeof rawScoreRange === 'object' && !Array.isArray(rawScoreRange)
            ? {
                min: Number((rawScoreRange as { min?: unknown }).min ?? 0),
                max: Number((rawScoreRange as { max?: unknown }).max ?? 0),
              }
            : { min: 0, max: 0 };

        const levels = Array.isArray(row.levels)
          ? (row.levels as unknown[])
              .filter((level) => level && typeof level === 'object' && !Array.isArray(level))
              .map((level) => {
                const levelRow = level as Record<string, unknown>;
                return {
                  score: Number(levelRow.score ?? NaN),
                  description: typeof levelRow.description === 'string' ? levelRow.description.trim() : '',
                };
              })
              .filter((level) => Number.isFinite(level.score) && level.description)
          : [];

        return {
          name,
          scoreRange,
          levels,
        } satisfies PlaygroundCriterion;
      })
      .filter((criterion) => criterion.name && criterion.levels.length > 0)
      .map((criterion) => ({
        ...criterion,
        levels: [...criterion.levels].sort((a, b) => b.score - a.score),
      }));
  }, []);

  const convertPlaygroundCriteriaToEditable = useCallback((criteria: PlaygroundCriterion[]): Criterion[] => {
    return criteria.map((criterion, index) => ({
      id: index + 1,
      name: criterion.name,
      scoreRange: criterion.scoreRange,
      levels: criterion.levels,
    }));
  }, []);

  /* -------------------------------------------------------------------------- */
  /*  PDF extraction — auto-extract when essayFile changes                      */
  /* -------------------------------------------------------------------------- */

  useEffect(() => {
    if (!essayFile) return;
    let cancelled = false;
    (async () => {
      const text = await extractTextFromPdf(essayFile);
      if (!cancelled && text) setPdfContent(text);
    })();
    return () => { cancelled = true; };
  }, [essayFile]);

  useEffect(() => {
    if (currentStep !== 'rubric' && currentStep !== 'settings') return;

    try {
      const raw = localStorage.getItem(PLAYGROUND_SETS_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as PlaygroundSet[]) : [];
      const normalized = Array.isArray(parsed)
        ? parsed
            .filter((set) => set && typeof set === 'object')
            .map((set) => ({
              id: String((set as PlaygroundSet).id || ''),
              name: String((set as PlaygroundSet).name || 'Untitled Prompt Set'),
              updatedAt: String((set as PlaygroundSet).updatedAt || ''),
              config: (set as PlaygroundSet).config,
            }))
            .filter((set) => set.id)
        : [];

      setPlaygroundSets(normalized);
      if (normalized.length > 0) {
        setSelectedPlaygroundSetId((current) => {
          if (current && normalized.some((set) => set.id === current)) return current;
          return normalized[0].id;
        });
        const instructionSets = normalized.filter(
          (set) => typeof set.config?.feedbackInstructionText === 'string' && set.config.feedbackInstructionText.trim()
        );
        setSettingsSelectedSetId((current) => {
          if (current && instructionSets.some((set) => set.id === current)) return current;
          return instructionSets[0]?.id ?? '';
        });
      } else {
        setSelectedPlaygroundSetId('');
        setSettingsSelectedSetId('');
      }
    } catch {
      setPlaygroundSets([]);
      setSelectedPlaygroundSetId('');
      setSettingsSelectedSetId('');
    }
  }, [currentStep]);

  /* -------------------------------------------------------------------------- */
  /*  gradeCurrentCriterion                                                      */
  /* -------------------------------------------------------------------------- */

  const gradeCurrentCriterion = useCallback(
    async (criteria: Criterion[], index: number) => {
      if (gradingInProgress.current.has(index)) return;
      gradingInProgress.current.add(index);

      const criterion = criteria[index];
      if (!criterion) {
        gradingInProgress.current.delete(index);
        return;
      }

      try {
        const result = await gradeSingleCriterion(
          pdfContent,
          criterion,
          { assessmentType, assessmentLength },
          contextList,
          undefined,
          cacheName,
        );

        const newAssessment: Assessment = {
          ...criterion,
          justification: result.justification,
          evidence: (result.evidence ?? []).map((e) => ({
            quote: e.quote,
            paragraph: e.paragraph,
            relatedAssessmentIndexes: e.relatedAssessmentIndexes,
          })),
          score: result.score ?? criterion.scoreRange.min,
          aiScore: result.score,
          originalAiScore: result.score,
          originalJustification: typeof result.justification === 'string'
            ? result.justification
            : Array.isArray(result.justification) ? result.justification.join('\n') : null,
          revisionRationale: null,
          revisedAssessmentText: null,
          error: result.error,
        };

        setCriteriaAssessments((prev) => ({
          ...prev,
          [criterion.name]: newAssessment,
        }));
      } catch (err) {
        console.error(`Error grading criterion "${criterion.name}":`, err);
        throw err;
      } finally {
        gradingInProgress.current.delete(index);
      }
    },
    [pdfContent, contextList, assessmentType, assessmentLength],
  );

  /* -------------------------------------------------------------------------- */
  /*  startInteractiveGrading                                                    */
  /* -------------------------------------------------------------------------- */

  const startInteractiveGrading = useCallback(async () => {
    if (!pdfContent || !rubricCriteria.some((c) => c.name.trim())) {
      console.error('PDF content and rubric criteria are required to start grading.');
      return;
    }

    setIsProcessingRubric(true);

    try {
      setCurrentCriterionIndex(0);
      setCriterionStartTime(Date.now());
      setCriteriaAssessments({});
      setTeacherScores({});
      setShowAIScores({});
      setGradingComplete(false);
      setOverallAssessment(null);
      setCurrentStep('grading');

      /* start grading the first criterion */
      await gradeCurrentCriterion(rubricCriteria, 0);
    } catch (err) {
      console.error('Error starting interactive grading:', err);
    } finally {
      setIsProcessingRubric(false);
    }
  }, [pdfContent, rubricCriteria, gradeCurrentCriterion]);

  /* -------------------------------------------------------------------------- */
  /*  handleTeacherScoreInput                                                    */
  /* -------------------------------------------------------------------------- */

  const handleTeacherScoreInput = useCallback((criterionId: string, score: number) => {
    setTeacherScores((prev) => ({ ...prev, [criterionId]: score }));
  }, []);

  /* -------------------------------------------------------------------------- */
  /*  revealAIScore                                                              */
  /* -------------------------------------------------------------------------- */

  const revealAIScore = useCallback((criterionId: string) => {
    setShowAIScores((prev) => ({ ...prev, [criterionId]: true }));
  }, []);

  /* -------------------------------------------------------------------------- */
  /*  moveToNextCriterion                                                        */
  /* -------------------------------------------------------------------------- */

  const moveToNextCriterion = useCallback(() => {
    const criterion = rubricCriteria[currentCriterionIndex];
    if (!criterion) return;

    /* Record current criterion to CSV */
    const assessment = criteriaAssessments[criterion.name];
    if (assessment && recorder) {
      const elapsedMs = criterionStartTime ? Date.now() - criterionStartTime : 0;
      const hCounts = hallucinationCounts[criterion.name] ?? { detected: 0, confirmed: 0, reported: 0 };
      const tScore = teacherScores[criterion.name] ?? null;
      const aScore = assessment.aiScore;
      recorder.addGradeRecord({
        essay_id: essayFileName || '',
        criterion_name: criterion.name,
        criterion_id: String(criterion.id),
        score_min: criterion.scoreRange.min,
        score_max: criterion.scoreRange.max,
        teacher_score: tScore,
        ai_score: aScore,
        revised_ai_score: assessment.originalAiScore !== aScore ? aScore : null,
        score_difference: tScore !== null && aScore !== null ? tScore - aScore : null,
        assessment_type: assessmentType,
        assessment_length: assessmentLength,
        hallucination_threshold: hallucinationThreshold,
        evidence_count: assessment.evidence?.length ?? 0,
        time_spent_seconds: Math.round(elapsedMs / 1000),
        hallucinations_detected: hCounts.detected,
        hallucinations_confirmed: hCounts.confirmed,
        hallucinations_reported: hCounts.reported,
        action_type: 'grade',
        assessment_was_edited: assessment.revisedAssessmentText !== null,
        original_ai_score: assessment.originalAiScore,
        edited_justification_text: assessment.revisedAssessmentText ?? null,
        original_ai_feedback: assessment.originalJustification ?? null,
        ai_strengths: null,
        final_strengths: null,
        ai_improvements: null,
        final_improvements: null,
        ai_advice: null,
        final_advice: null,
      });
    }

    const nextIndex = currentCriterionIndex + 1;
    if (nextIndex >= rubricCriteria.length) return;

    setCurrentCriterionIndex(nextIndex);
    setCriterionStartTime(Date.now());
    setActivePdfEvidence(null);

    /* Grade next criterion if not already graded */
    const nextCriterion = rubricCriteria[nextIndex];
    if (nextCriterion && !criteriaAssessments[nextCriterion.name]) {
      gradeCurrentCriterion(rubricCriteria, nextIndex);
    }
  }, [
    rubricCriteria,
    currentCriterionIndex,
    criteriaAssessments,
    recorder,
    criterionStartTime,
    teacherScores,
    essayFileName,
    gradeCurrentCriterion,
    hallucinationCounts,
    assessmentType,
    assessmentLength,
    hallucinationThreshold,
  ]);

  /* -------------------------------------------------------------------------- */
  /*  moveToPreviousCriterion                                                    */
  /* -------------------------------------------------------------------------- */

  const moveToPreviousCriterion = useCallback(() => {
    if (currentCriterionIndex <= 0) return;
    setCurrentCriterionIndex((prev) => prev - 1);
    setCriterionStartTime(Date.now());
    setActivePdfEvidence(null);
  }, [currentCriterionIndex]);

  /* -------------------------------------------------------------------------- */
  /*  finishGrading                                                              */
  /* -------------------------------------------------------------------------- */

  const finishGrading = useCallback(async () => {
    /* Record last criterion to CSV */
    const criterion = rubricCriteria[currentCriterionIndex];
    if (criterion) {
      const assessment = criteriaAssessments[criterion.name];
      if (assessment && recorder) {
        const elapsedMs = criterionStartTime ? Date.now() - criterionStartTime : 0;
        const hCounts = hallucinationCounts[criterion.name] ?? { detected: 0, confirmed: 0, reported: 0 };
        const tScore = teacherScores[criterion.name] ?? null;
        const aScore = assessment.aiScore;
        recorder.addGradeRecord({
          essay_id: essayFileName || '',
          criterion_name: criterion.name,
          criterion_id: String(criterion.id),
          score_min: criterion.scoreRange.min,
          score_max: criterion.scoreRange.max,
          teacher_score: tScore,
          ai_score: aScore,
          revised_ai_score: assessment.originalAiScore !== aScore ? aScore : null,
          score_difference: tScore !== null && aScore !== null ? tScore - aScore : null,
          assessment_type: assessmentType,
          assessment_length: assessmentLength,
          hallucination_threshold: hallucinationThreshold,
          evidence_count: assessment.evidence?.length ?? 0,
          time_spent_seconds: Math.round(elapsedMs / 1000),
          hallucinations_detected: hCounts.detected,
          hallucinations_confirmed: hCounts.confirmed,
          hallucinations_reported: hCounts.reported,
          action_type: 'grade',
          assessment_was_edited: assessment.revisedAssessmentText !== null,
          original_ai_score: assessment.originalAiScore,
          edited_justification_text: assessment.revisedAssessmentText ?? null,
          original_ai_feedback: assessment.originalJustification ?? null,
          ai_strengths: null,
          final_strengths: null,
          ai_improvements: null,
          final_improvements: null,
          ai_advice: null,
          final_advice: null,
        });
      }
    }

    /* Generate overall assessment */
    try {
      const criteriaWithScores = rubricCriteria.map((c) => {
        const a = criteriaAssessments[c.name];
        return {
          name: c.name,
          teacherScore: teacherScores[c.name] ?? null,
          aiScore: a?.aiScore ?? null,
          scoreRange: c.scoreRange,
        };
      });

      const overall = await generateOverallAssessment(
        pdfContent,
        criteriaWithScores,
        {},
        contextList,
      );

      setOverallAssessment(overall);
      setOriginalOverallAssessment(overall);
      setGradingComplete(true);
      setCurrentStep('complete');
    } catch (err) {
      console.error('Error generating overall assessment:', err);
      throw err;
    }
  }, [
    rubricCriteria,
    currentCriterionIndex,
    criteriaAssessments,
    recorder,
    criterionStartTime,
    teacherScores,
    essayFileName,
    pdfContent,
    contextList,
    hallucinationCounts,
    assessmentType,
    assessmentLength,
    hallucinationThreshold,
  ]);

  /* -------------------------------------------------------------------------- */
  /*  restartGrading                                                             */
  /* -------------------------------------------------------------------------- */

  const handleFinalOverall = useCallback((edited: { strengths: string; improvements: string; advice: string }) => {
    if (!recorder || !originalOverallAssessment) return;
    // Write one combined overall-assessment row with before/after for all three fields
    recorder.addGradeRecord({
      essay_id: essayFileName || '',
      criterion_name: 'overall_assessment',
      criterion_id: '0',
      score_min: 0,
      score_max: 0,
      teacher_score: null,
      ai_score: null,
      revised_ai_score: null,
      score_difference: null,
      assessment_type: assessmentType,
      assessment_length: assessmentLength,
      hallucination_threshold: hallucinationThreshold,
      evidence_count: 0,
      time_spent_seconds: null,
      hallucinations_detected: 0,
      hallucinations_confirmed: 0,
      hallucinations_reported: 0,
      action_type: 'overall_assessment',
      assessment_was_edited:
        originalOverallAssessment.strengths !== edited.strengths ||
        originalOverallAssessment.improvements !== edited.improvements ||
        originalOverallAssessment.advice !== edited.advice,
      original_ai_score: null,
      edited_justification_text: null,
      original_ai_feedback: null,
      ai_strengths: originalOverallAssessment.strengths,
      final_strengths: edited.strengths,
      ai_improvements: originalOverallAssessment.improvements,
      final_improvements: edited.improvements,
      ai_advice: originalOverallAssessment.advice,
      final_advice: edited.advice,
    });
  }, [recorder, originalOverallAssessment, essayFileName, assessmentType, assessmentLength, hallucinationThreshold]);

  const restartGrading = useCallback(() => {
    // Clean up cache on full restart
    if (cacheName) deleteRubricCache(cacheName).catch(() => {});
    setCacheName(null);
    setCurrentStep('welcome');
    setEssayFile(null);
    setEssayFileName(null);
    setPdfContent('');
    setRubricCriteria([
      { id: 1, name: '', scoreRange: { min: 0, max: 3 }, levels: [{ score: 3, description: '' }, { score: 2, description: '' }, { score: 1, description: '' }, { score: 0, description: '' }] },
    ]);
    setCriteriaAssessments({});
    setCurrentCriterionIndex(0);
    setTeacherScores({});
    setShowAIScores({});
    setGradingComplete(false);
    setOverallAssessment(null);
    setOriginalOverallAssessment(null);
    setContextList([]);
    setAssessmentType('flow');
    setAssessmentLength('medium');
    setHallucinationThreshold('medium');
    setAdditionalInstructions('');
    setSettingsSelectedSetId('');
    setIsProcessingRubric(false);
    setShowContextDialog(false);
    setCriterionStartTime(null);
    setActivePdfEvidence(null);
    setHallucinationCounts({});
    gradingInProgress.current.clear();
  }, [cacheName]);

  /* -------------------------------------------------------------------------- */
  /*  gradeNextEssay — keeps rubric + settings, resets essay/grading              */
  /* -------------------------------------------------------------------------- */

  const gradeNextEssay = useCallback(() => {
    // Keep cache — rubric stays the same, only essay changes
    setCurrentStep('essay');
    setEssayFile(null);
    setEssayFileName(null);
    setPdfContent('');
    setCriteriaAssessments({});
    setCurrentCriterionIndex(0);
    setTeacherScores({});
    setShowAIScores({});
    setGradingComplete(false);
    setOverallAssessment(null);
    setOriginalOverallAssessment(null);
    setIsProcessingRubric(false);
    setCriterionStartTime(null);
    setActivePdfEvidence(null);
    setHallucinationCounts({});
    gradingInProgress.current.clear();
  }, [cacheName]);

  /* -------------------------------------------------------------------------- */
  /*  updateHallucinationCounts                                                  */
  /* -------------------------------------------------------------------------- */

  const updateHallucinationCounts = useCallback(
    (criterionName: string, counts: { detected: number; confirmed: number; reported: number }) => {
      setHallucinationCounts((prev) => {
        const existing = prev[criterionName] ?? { detected: 0, confirmed: 0, reported: 0 };
        return {
          ...prev,
          [criterionName]: {
            detected: counts.detected || existing.detected,
            confirmed: counts.confirmed || existing.confirmed,
            reported: existing.reported + (counts.reported || 0),
          },
        };
      });
    },
    [],
  );

  /* -------------------------------------------------------------------------- */
  /*  Rubric operations                                                          */
  /* -------------------------------------------------------------------------- */

  const selectedPlaygroundSet = playgroundSets.find((set) => set.id === selectedPlaygroundSetId) ?? null;
  const playgroundSetsWithInstructions = playgroundSets.filter(
    (set) => typeof set.config?.feedbackInstructionText === 'string' && set.config.feedbackInstructionText.trim()
  );
  const selectedPlaygroundCriteria = selectedPlaygroundSet?.config?.criteria
    ? parsePlaygroundCriteria(selectedPlaygroundSet.config.criteria)
    : [];
  const canImportFromPlayground = selectedPlaygroundCriteria.length > 0;

  const importRubricFromPlayground = useCallback(() => {
    if (!canImportFromPlayground) return;
    const editableCriteria = convertPlaygroundCriteriaToEditable(selectedPlaygroundCriteria);
    setRubricCriteria(editableCriteria);
  }, [convertPlaygroundCriteriaToEditable, canImportFromPlayground, selectedPlaygroundCriteria]);

  const handleRubricPasteExtract = useCallback(async () => {
    if (!rubricPasteContent.trim()) return;
    setIsProcessingRubric(true);
    try {
      const result = await extractRubricCriteria(rubricPasteContent);
      if (result === 'NO_VALID_RUBRIC') {
        alert('Could not extract valid rubric criteria from the pasted text. Please check the format.');
      } else if (Array.isArray(result) && result.length > 0) {
        setRubricCriteria(result as Criterion[]);
        setRubricCreationMode('manual');
      }
    } catch {
      alert('Failed to extract rubric. Please try again.');
    } finally {
      setIsProcessingRubric(false);
    }
  }, [rubricPasteContent]);

  const handleRubricPdfUpload = useCallback(async (file: File) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      alert('Please upload a PDF file.');
      return;
    }
    setRubricUploadExtracting(true);
    setRubricUploadFileName(file.name);
    try {
      const text = await extractTextFromPdf(file);
      if (!text?.trim()) {
        alert('Could not extract text from the PDF.');
        setRubricUploadExtracting(false);
        return;
      }
      setRubricPasteContent(text);
      // Auto-extract criteria from the PDF text
      const result = await extractRubricCriteria(text);
      if (result === 'NO_VALID_RUBRIC') {
        alert('Extracted text but could not identify rubric criteria. You can edit the text in Paste mode.');
        setRubricCreationMode('paste');
      } else if (Array.isArray(result) && result.length > 0) {
        setRubricCriteria(result as Criterion[]);
        setRubricCreationMode('manual');
      }
    } catch {
      alert('Error reading PDF. Try pasting the rubric text instead.');
    } finally {
      setRubricUploadExtracting(false);
    }
  }, []);

  const handleRubricFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleRubricPdfUpload(file);
      if (rubricFileInputRef.current) rubricFileInputRef.current.value = '';
    },
    [handleRubricPdfUpload],
  );

  /* -------------------------------------------------------------------------- */
  /*  RENDER                                                                     */
  /* -------------------------------------------------------------------------- */

  return (
    <div className="relative flex h-full w-full flex-col" style={{ background: 'var(--background)' }}>
      {/* Step indicator (hidden during active grading/complete) */}
      {currentStep !== 'grading' && currentStep !== 'complete' && (
        <StepIndicator currentStep={currentStep} />
      )}

      <div className="flex flex-1 flex-col overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* ============================================================== */}
          {/*  Step 1: Welcome                                                */}
          {/* ============================================================== */}
          {currentStep === 'welcome' && (
            <motion.div key="welcome" {...slideVariants}>
              <WelcomeSection onContinue={() => setCurrentStep('rubric')} />
            </motion.div>
          )}

          {/* ============================================================== */}
          {/*  Step 2: Rubric                                                 */}
          {/* ============================================================== */}
          {currentStep === 'rubric' && (
            <motion.div key="rubric" {...slideVariants}>
              <StepContainer
                onBack={() => setCurrentStep('welcome')}
                onNext={() => setCurrentStep('essay')}
                nextDisabled={!rubricCriteria.some((c) => c.name.trim())}
              >
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                      Create Grading Rubric
                    </h2>
                    <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                      Define your rubric criteria with scoring levels.
                    </p>
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-2 border-b border-[var(--card-border)]">
                    <button
                      onClick={() => setRubricCreationMode('paste')}
                      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                        rubricCreationMode === 'paste'
                          ? 'border-b-2 border-[#6366F1] text-[#6366F1]'
                          : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      <Type className="h-3.5 w-3.5" />
                      Paste Text
                    </button>
                    <button
                      onClick={() => setRubricCreationMode('upload')}
                      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                        rubricCreationMode === 'upload'
                          ? 'border-b-2 border-[#6366F1] text-[#6366F1]'
                          : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      <FileUp className="h-3.5 w-3.5" />
                      Upload PDF
                    </button>
                    <button
                      onClick={() => setRubricCreationMode('manual')}
                      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                        rubricCreationMode === 'manual'
                          ? 'border-b-2 border-[#6366F1] text-[#6366F1]'
                          : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create Manually
                    </button>
                    {playgroundSets.length > 0 && (
                      <button
                        onClick={() => setRubricCreationMode('import')}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                          rubricCreationMode === 'import'
                            ? 'border-b-2 border-[#6366F1] text-[#6366F1]'
                            : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Import from Playground
                      </button>
                    )}
                  </div>

                  {/* Paste mode */}
                  {rubricCreationMode === 'paste' && (
                    <div className="space-y-3">
                      <textarea
                        rows={10}
                        value={rubricPasteContent}
                        onChange={(e) => setRubricPasteContent(e.target.value)}
                        placeholder="Paste your rubric text here. AI will extract criteria and scoring levels automatically..."
                        className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-[#1E1B4B] placeholder-gray-400 focus:border-[#6366F1] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-800 dark:text-[#E2E8F0]"
                      />
                      <button
                        onClick={handleRubricPasteExtract}
                        disabled={!rubricPasteContent.trim() || isProcessingRubric}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#6366F1] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#5558E6] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isProcessingRubric ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {isProcessingRubric ? 'Extracting...' : 'Extract Criteria with AI'}
                      </button>
                    </div>
                  )}

                  {/* Upload mode */}
                  {rubricCreationMode === 'upload' && (
                    <div className="space-y-3">
                      <input
                        ref={rubricFileInputRef}
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={handleRubricFileChange}
                      />
                      {rubricUploadExtracting ? (
                        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-500/5 py-12">
                          <Loader2 className="mb-3 h-8 w-8 animate-spin text-indigo-500" />
                          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                            Extracting criteria from {rubricUploadFileName}...
                          </p>
                        </div>
                      ) : (
                        <div
                          onClick={() => rubricFileInputRef.current?.click()}
                          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--muted)]/30 py-12 transition-colors duration-200 hover:border-indigo-400 hover:bg-indigo-500/5"
                        >
                          <FileUp className="mb-3 h-8 w-8" style={{ color: 'var(--muted)' }} />
                          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                            Click to upload a rubric PDF
                          </p>
                          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                            AI will extract criteria automatically
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab Content */}
                  {rubricCreationMode === 'manual' && (
                    <div className="space-y-4">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setRubricCriteria(EXAMPLE_RUBRIC_CRITERIA.map((c) => ({ ...c, levels: c.levels.map((l) => ({ ...l })) })))}
                          className="flex items-center gap-1.5 rounded-md border border-dashed border-[#6366F1] px-3 py-1.5 text-xs font-medium text-[#6366F1] hover:bg-[#6366F1]/10"
                        >
                          Load Example
                        </button>
                      </div>
                      <RubricTable criteria={rubricCriteria} onChange={setRubricCriteria} />
                    </div>
                  )}

                  {rubricCreationMode === 'import' && playgroundSets.length > 0 && (
                    <div className="space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                          Select Playground Prompt Set
                        </label>
                        <select
                          value={selectedPlaygroundSetId}
                          onChange={(e) => setSelectedPlaygroundSetId(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-[#1E1B4B] focus:border-[#6366F1] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-800 dark:text-[#E2E8F0]"
                        >
                          {playgroundSets.map((set) => (
                            <option key={set.id} value={set.id}>
                              {set.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {canImportFromPlayground && (
                        <>
                          <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                              Preview ({selectedPlaygroundCriteria.length} criteria)
                            </p>
                            <RubricTable 
                              criteria={convertPlaygroundCriteriaToEditable(selectedPlaygroundCriteria)} 
                              onChange={() => {}} 
                            />
                          </div>

                          <button
                            type="button"
                            onClick={importRubricFromPlayground}
                            className="w-full cursor-pointer rounded-lg bg-[#6366F1] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#5558E6]"
                          >
                            Import Selected Criteria
                          </button>
                        </>
                      )}

                      {!canImportFromPlayground && (
                        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-center">
                          <p style={{ color: 'var(--muted)' }}>No valid criteria to import from this set.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </StepContainer>
            </motion.div>
          )}

          {/* ============================================================== */}
          {/*  Step 3: Essay Upload                                           */}
          {/* ============================================================== */}
          {currentStep === 'essay' && (
            <motion.div key="essay" {...slideVariants}>
              <StepContainer
                onBack={() => setCurrentStep('rubric')}
                onNext={() => setCurrentStep('settings')}
                nextDisabled={!essayFile}
              >
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                      Upload Student Essay
                    </h2>
                    <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                      Upload the PDF essay you want to grade.
                    </p>
                  </div>
                  <EssayUpload
                    essayFile={essayFile}
                    essayFileName={essayFileName}
                    onFileSelected={(dataUri, name) => {
                      setEssayFile(dataUri);
                      setEssayFileName(name);
                    }}
                  />
                </div>
              </StepContainer>
            </motion.div>
          )}

          {/* ============================================================== */}
          {/*  Step 4: Settings                                               */}
          {/* ============================================================== */}
          {currentStep === 'settings' && (
            <motion.div key="settings" {...slideVariants}>
              <StepContainer
                onBack={() => setCurrentStep('essay')}
                onNext={startInteractiveGrading}
                nextLabel="Start Grading"
                nextDisabled={!pdfContent || !rubricCriteria.some((c) => c.name.trim())}
                nextIcon={<Play className="h-4 w-4" />}
              >
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                      Grading Settings
                    </h2>
                    <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                      Configure how the AI should assess the essay.
                    </p>
                  </div>

                  <AssessmentSettings
                    assessmentType={assessmentType}
                    assessmentLength={assessmentLength}
                    hallucinationThreshold={hallucinationThreshold}
                    setAssessmentType={setAssessmentType}
                    setAssessmentLength={setAssessmentLength}
                    setHallucinationThreshold={setHallucinationThreshold}
                  />

                  {/* Additional Instructions */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                        Additional Instruction
                      </h3>
                      {playgroundSetsWithInstructions.length > 0 && (
                        <div className="flex items-center gap-2">
                          <select
                            value={settingsSelectedSetId}
                            onChange={(e) => setSettingsSelectedSetId(e.target.value)}
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-[#1E1B4B] focus:border-[#6366F1] focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-[#E2E8F0]"
                          >
                            {playgroundSetsWithInstructions.map((set) => (
                              <option key={set.id} value={set.id}>
                                {set.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              const set = playgroundSetsWithInstructions.find((s) => s.id === settingsSelectedSetId);
                              const text = set?.config?.feedbackInstructionText;
                              if (typeof text === 'string' && text.trim()) {
                                setAdditionalInstructions(text);
                              } else {
                                alert('The selected playground set has no Additional Instruction saved.');
                              }
                            }}
                            className="rounded-md border border-[#6366F1] px-2 py-1 text-xs font-medium text-[#6366F1] hover:bg-[#6366F1]/10"
                          >
                            Import from Playground
                          </button>
                        </div>
                      )}
                    </div>
                    <textarea
                      value={additionalInstructions}
                      onChange={(e) => setAdditionalInstructions(e.target.value)}
                      placeholder="Add any additional instructions for the AI grader..."
                      rows={4}
                      className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-[#1E1B4B] placeholder-gray-400 focus:border-[#6366F1] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-800 dark:text-[#E2E8F0] dark:placeholder-slate-500"
                    />
                  </div>

                  {/* Context */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-[#1E1B4B] dark:text-[#E2E8F0]">
                      Additional Context
                    </h3>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowContextDialog(true)}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-[#1E1B4B] transition-colors hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-[#E2E8F0] dark:hover:bg-slate-700"
                      >
                        <Plus className="h-4 w-4" />
                        Add Context
                      </button>
                      {contextList.length > 0 && (
                        <span className="text-sm" style={{ color: 'var(--muted)' }}>
                          {contextList.length} context item{contextList.length !== 1 ? 's' : ''} added
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </StepContainer>
            </motion.div>
          )}

          {/* ============================================================== */}
          {/*  Step 5: Active Grading / Step 6: Complete                      */}
          {/* ============================================================== */}
          {(currentStep === 'grading' || currentStep === 'complete') && (
            <motion.div key="grading" {...slideVariants} className="flex h-full flex-1 overflow-hidden">
              <InteractiveGrading
                pdfFile={essayFile}
                pdfContent={pdfContent}
                rubricCriteria={rubricCriteria}
                criteriaAssessments={criteriaAssessments}
                currentCriterionIndex={currentCriterionIndex}
                teacherScores={teacherScores}
                showAIScores={showAIScores}
                contextList={contextList}
                assessmentType={assessmentType}
                assessmentLength={assessmentLength}
                hallucinationThreshold={hallucinationThreshold}
                gradingComplete={gradingComplete}
                overallAssessment={overallAssessment}
                handleTeacherScoreInput={handleTeacherScoreInput}
                revealAIScore={revealAIScore}
                moveToNextCriterion={moveToNextCriterion}
                moveToPreviousCriterion={moveToPreviousCriterion}
                finishGrading={finishGrading}
                restartGrading={restartGrading}
                gradeCurrentCriterion={gradeCurrentCriterion}
                setCriteriaAssessments={setCriteriaAssessments}
                criterionStartTime={criterionStartTime}
                activePdfEvidence={activePdfEvidence}
                setActivePdfEvidence={setActivePdfEvidence}
                setAssessmentType={setAssessmentType}
                onGradeNextEssay={gradeNextEssay}
                onFinalOverall={handleFinalOverall}
                onHallucinationUpdate={updateHallucinationCounts}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Processing rubric spinner */}
      <AnimatePresence>
        {isProcessingRubric && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          >
            <div className="rounded-xl bg-white p-8 shadow-2xl dark:bg-slate-800">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="mx-auto w-fit"
              >
                <Loader2 className="h-10 w-10 text-[#6366F1]" />
              </motion.div>
              <p className="mt-4 text-sm font-medium text-gray-600 dark:text-slate-300">
                Extracting rubric criteria and preparing grading...
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context Dialog */}
      {showContextDialog && (
        <ContextDialog
          isOpen={showContextDialog}
          onClose={() => setShowContextDialog(false)}
          contextList={contextList}
          setContextList={setContextList}
        />
      )}
    </div>
  );
}
