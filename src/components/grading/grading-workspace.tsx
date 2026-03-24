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
  gradeSingleCriterion,
  generateOverallAssessment,
} from '@/lib/gemini-service';
import { extractTextFromPdf } from '@/lib/pdf-utils';
import type { CsvRecorder } from '@/lib/csv-recorder';

import WelcomeSection from '@/components/grading/welcome-section';
import EssayUpload from '@/components/grading/essay-upload';
import AssessmentSettings from '@/components/grading/assessment-settings';
import RubricModal from '@/components/grading/rubric-modal';
import RubricPreview from '@/components/grading/rubric-preview';
import ContextDialog from '@/components/grading/context-dialog';
import InteractiveGrading from '@/components/grading/interactive-grading';

/* -------------------------------------------------------------------------- */
/*  Props                                                                      */
/* -------------------------------------------------------------------------- */

export interface GradingWorkspaceProps {
  recorder: CsvRecorder;
}

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
  const [rubricContent, setRubricContent] = useState<string>('');
  const [rubricCriteria, setRubricCriteria] = useState<Criterion[]>([]);
  const [criteriaAssessments, setCriteriaAssessments] = useState<Record<string, Assessment>>({});

  /* ---- grading navigation state ---- */
  const [currentCriterionIndex, setCurrentCriterionIndex] = useState<number>(0);
  const [teacherScores, setTeacherScores] = useState<Record<string, number | null>>({});
  const [showAIScores, setShowAIScores] = useState<Record<string, boolean>>({});
  const [gradingComplete, setGradingComplete] = useState<boolean>(false);
  const [overallAssessment, setOverallAssessment] = useState<OverallAssessmentResult | null>(null);

  /* ---- settings state ---- */
  const [contextList, setContextList] = useState<ContextItem[]>([]);
  const [assessmentType, setAssessmentType] = useState<AssessmentType>('flow');
  const [assessmentLength, setAssessmentLength] = useState<AssessmentLength>('medium');
  const [hallucinationThreshold, setHallucinationThreshold] = useState<HallucinationThreshold>('medium');

  /* ---- UI state ---- */
  const [isProcessingRubric, setIsProcessingRubric] = useState<boolean>(false);
  const [showRubricModal, setShowRubricModal] = useState<boolean>(false);
  const [showContextDialog, setShowContextDialog] = useState<boolean>(false);

  /* ---- timing ---- */
  const [criterionStartTime, setCriterionStartTime] = useState<number | null>(null);

  /* ---- pdf evidence highlight ---- */
  const [activePdfEvidence, setActivePdfEvidence] = useState<Evidence | null>(null);

  /* ---- hallucination tracking ---- */
  const [hallucinationCounts, setHallucinationCounts] = useState<
    Record<string, { detected: number; confirmed: number; reported: number }>
  >({});

  /* ---- ref to prevent duplicate grading ---- */
  const gradingInProgress = useRef<Set<number>>(new Set());

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
    if (!pdfContent || !rubricContent) {
      console.error('PDF content and rubric content are required to start grading.');
      return;
    }

    setIsProcessingRubric(true);

    try {
      const criteria = await extractRubricCriteria(rubricContent);
      if (criteria === 'NO_VALID_RUBRIC') {
        console.error('Could not extract valid rubric criteria.');
        return;
      }
      setRubricCriteria(criteria);
      setCurrentCriterionIndex(0);
      setCriterionStartTime(Date.now());
      setCriteriaAssessments({});
      setTeacherScores({});
      setShowAIScores({});
      setGradingComplete(false);
      setOverallAssessment(null);
      setCurrentStep('grading');

      /* start grading the first criterion */
      await gradeCurrentCriterion(criteria, 0);
    } catch (err) {
      console.error('Error starting interactive grading:', err);
    } finally {
      setIsProcessingRubric(false);
    }
  }, [pdfContent, rubricContent, gradeCurrentCriterion]);

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

  const restartGrading = useCallback(() => {
    setCurrentStep('welcome');
    setEssayFile(null);
    setEssayFileName(null);
    setPdfContent('');
    setRubricContent('');
    setRubricCriteria([]);
    setCriteriaAssessments({});
    setCurrentCriterionIndex(0);
    setTeacherScores({});
    setShowAIScores({});
    setGradingComplete(false);
    setOverallAssessment(null);
    setContextList([]);
    setAssessmentType('flow');
    setAssessmentLength('medium');
    setHallucinationThreshold('medium');
    setIsProcessingRubric(false);
    setShowRubricModal(false);
    setShowContextDialog(false);
    setCriterionStartTime(null);
    setActivePdfEvidence(null);
    setHallucinationCounts({});
    gradingInProgress.current.clear();
  }, []);

  /* -------------------------------------------------------------------------- */
  /*  gradeNextEssay — keeps rubric + settings, resets essay/grading              */
  /* -------------------------------------------------------------------------- */

  const gradeNextEssay = useCallback(() => {
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
    setIsProcessingRubric(false);
    setCriterionStartTime(null);
    setActivePdfEvidence(null);
    setHallucinationCounts({});
    gradingInProgress.current.clear();
  }, []);

  /* -------------------------------------------------------------------------- */
  /*  revisitCriteria — goes back to rubric step                                 */
  /* -------------------------------------------------------------------------- */

  const revisitCriteria = useCallback(() => {
    setCurrentStep('rubric');
  }, []);

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
  /*  Rubric save handler                                                        */
  /* -------------------------------------------------------------------------- */

  const handleRubricSave = useCallback((content: string) => {
    setRubricContent(content);
    setShowRubricModal(false);
  }, []);

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
                nextDisabled={!rubricContent.trim()}
              >
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                      Upload Grading Rubric
                    </h2>
                    <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                      Paste your rubric text or upload a rubric PDF. The AI will extract criteria and scoring levels.
                    </p>
                  </div>

                  {rubricContent ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
                        <div className="flex items-center gap-3">
                          <Check className="h-5 w-5 text-emerald-500" />
                          <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                            Rubric loaded ({rubricContent.length} characters)
                          </span>
                        </div>
                        <button
                          onClick={() => setShowRubricModal(true)}
                          className="cursor-pointer text-sm font-medium text-[#6366F1] transition-colors hover:text-[#818CF8]"
                        >
                          Edit Rubric
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                        <pre className="whitespace-pre-wrap text-xs" style={{ color: 'var(--muted)' }}>
                          {rubricContent.slice(0, 800)}
                          {rubricContent.length > 800 && '...'}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowRubricModal(true)}
                        className="flex flex-1 cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--muted)]/30 px-6 py-10 transition-colors duration-200 hover:border-indigo-400 hover:bg-indigo-500/5"
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-500/10">
                          <Plus className="h-6 w-6 text-indigo-500" />
                        </div>
                        <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                          Add Rubric
                        </span>
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          Paste text or upload PDF
                        </span>
                      </button>
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
                nextDisabled={!pdfContent || !rubricContent}
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

                  {/* Rubric Criteria Preview */}
                  {rubricContent && (
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-[#1E1B4B] dark:text-[#E2E8F0]">
                        Rubric Criteria
                      </h3>
                      <RubricPreview
                        rubricContent={rubricContent}
                        onStartGrading={() => {}}
                        onReviseRubric={() => setCurrentStep('rubric')}
                        pdfUploaded={!!essayFile}
                        hideStartButton
                      />
                    </div>
                  )}

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
            <motion.div key="grading" {...slideVariants} className="flex flex-1 overflow-hidden">
              <InteractiveGrading
                pdfFile={essayFile}
                pdfContent={pdfContent}
                rubricContent={rubricContent}
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
                onRevisitCriteria={revisitCriteria}
                onGradeNextEssay={gradeNextEssay}
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

      {/* Rubric Modal */}
      {showRubricModal && (
        <RubricModal
          isOpen={showRubricModal}
          onClose={() => setShowRubricModal(false)}
          rubricContent={rubricContent}
          onSave={handleRubricSave}
        />
      )}
    </div>
  );
}
