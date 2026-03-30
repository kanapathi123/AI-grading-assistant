'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ArrowRight,
  Eye,
} from 'lucide-react';
import type { Criterion, Assessment, Evidence, ContextItem, AssessmentType, AssessmentLength, HallucinationThreshold, OverallAssessmentResult } from '@/types';
import { reviseCriterionScoreWithJustification } from '@/lib/gemini-service';
import AssessmentSection from '@/components/grading/assessment-section';
import EvidenceSection from '@/components/grading/evidence-section';
import HallucinationPanel from '@/components/grading/hallucination-panel';
import EditJustificationModal from '@/components/grading/edit-justification-modal';
import PdfViewer, { PdfHighlight } from '@/components/grading/pdf-viewer';
import OverallAssessment from '@/components/grading/overall-assessment';

/* -------------------------------------------------------------------------- */
/*  Props                                                                      */
/* -------------------------------------------------------------------------- */

export interface InteractiveGradingProps {
  /* data */
  pdfFile: string | null;
  pdfContent: string;
  rubricContent: string;
  rubricCriteria: Criterion[];
  criteriaAssessments: Record<string, Assessment>;
  currentCriterionIndex: number;
  teacherScores: Record<string, number | null>;
  showAIScores: Record<string, boolean>;
  contextList: ContextItem[];
  assessmentType: AssessmentType;
  assessmentLength: AssessmentLength;
  hallucinationThreshold: HallucinationThreshold;
  gradingComplete: boolean;
  overallAssessment: OverallAssessmentResult | null;

  /* actions */
  handleTeacherScoreInput: (criterionId: string, score: number) => void;
  revealAIScore: (criterionId: string) => void;
  moveToNextCriterion: () => void;
  moveToPreviousCriterion: () => void;
  finishGrading: () => Promise<void>;
  restartGrading: () => void;
  gradeCurrentCriterion: (criteria: Criterion[], index: number) => Promise<void>;
  setCriteriaAssessments: React.Dispatch<React.SetStateAction<Record<string, Assessment>>>;

  /* timing */
  criterionStartTime: number | null;

  /* pdf evidence */
  activePdfEvidence: Evidence | null;
  setActivePdfEvidence: React.Dispatch<React.SetStateAction<Evidence | null>>;

  /* new navigation callbacks */
  onRevisitCriteria?: () => void;
  onGradeNextEssay?: () => void;
  onHallucinationUpdate?: (criterionName: string, counts: { detected: number; confirmed: number; reported: number }) => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function InteractiveGrading({
  pdfFile,
  pdfContent,
  rubricContent,
  rubricCriteria,
  criteriaAssessments,
  currentCriterionIndex,
  teacherScores,
  showAIScores,
  contextList,
  assessmentType,
  assessmentLength,
  hallucinationThreshold,
  gradingComplete,
  overallAssessment,
  handleTeacherScoreInput,
  revealAIScore,
  moveToNextCriterion,
  moveToPreviousCriterion,
  finishGrading,
  restartGrading,
  gradeCurrentCriterion,
  setCriteriaAssessments,
  criterionStartTime,
  activePdfEvidence,
  setActivePdfEvidence,
  onRevisitCriteria,
  onGradeNextEssay,
  onHallucinationUpdate,
}: InteractiveGradingProps) {
  /* ---- internal state ---- */
  const [editingJustification, setEditingJustification] = useState(false);
  const [editedJustification, setEditedJustification] = useState('');
  const [editedBullets, setEditedBullets] = useState<string[]>([]);
  const [hoveredAssessmentIndexes, setHoveredAssessmentIndexes] = useState<number[]>([]);
  const [isRevisingScore, setIsRevisingScore] = useState(false);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [showHallucinationPopup, setShowHallucinationPopup] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [hoveredEvidenceIndex, setHoveredEvidenceIndex] = useState<number | null>(null);

  /* ---- derived ---- */
  const criterion = rubricCriteria[currentCriterionIndex] ?? null;
  const criterionId = criterion?.name ?? '';
  const assessment = criterionId ? criteriaAssessments[criterionId] : undefined;
  const teacherScore = criterionId ? teacherScores[criterionId] ?? null : null;
  const aiScoreRevealed = criterionId ? showAIScores[criterionId] ?? false : false;
  const isFirstCriterion = currentCriterionIndex === 0;
  const isLastCriterion = currentCriterionIndex === rubricCriteria.length - 1;
  const totalCriteria = rubricCriteria.length;

  const scoreOptions = useMemo(() => {
    if (!criterion) return [];
    const opts: number[] = [];
    for (let i = criterion.scoreRange.min; i <= criterion.scoreRange.max; i++) {
      opts.push(i);
    }
    return opts;
  }, [criterion]);

  /* ---- build highlights from all assessed criteria evidence + justification quotes ---- */
  const pdfHighlights = useMemo<PdfHighlight[]>(() => {
    const result: PdfHighlight[] = [];
    for (const [name, a] of Object.entries(criteriaAssessments)) {
      // Dedup only within the same criterion
      const seenInCriterion = new Set<string>();
      if (a?.evidence) {
        for (const ev of a.evidence) {
          const key = ev.quote.toLowerCase().trim();
          if (!seenInCriterion.has(key)) {
            seenInCriterion.add(key);
            result.push({ text: ev.quote, criterionName: name });
          }
        }
      }
      // Also extract inline quotes from justification (text between quotation marks)
      if (a?.justification) {
        const justText = typeof a.justification === 'string' ? a.justification : a.justification.join(' ');
        const quoteMatches = justText.match(/[""\u201C\u201D]([^""\u201C\u201D]{20,}?)[""\u201C\u201D]/g);
        if (quoteMatches) {
          for (const m of quoteMatches) {
            const cleaned = m.replace(/^[""\u201C\u201D]|[""\u201C\u201D]$/g, '').trim();
            const key = cleaned.toLowerCase();
            if (cleaned.length >= 20 && !seenInCriterion.has(key)) {
              seenInCriterion.add(key);
              result.push({ text: cleaned, criterionName: name });
            }
          }
        }
      }
    }
    return result;
  }, [criteriaAssessments]);

  /* ---- loading state detection ---- */
  const isInitialLoading = rubricCriteria.length > 0 && Object.keys(criteriaAssessments).length === 0;
  const isCriterionLoading = criterion != null && !assessment;

  /* reset warning on criterion change */
  useEffect(() => {
    setShowHallucinationPopup(false);
    setGradingError(null);
    setEditingJustification(false);
  }, [currentCriterionIndex]);

  /* -------------------------------------------------------------------------- */
  /*  handleSaveJustification                                                    */
  /* -------------------------------------------------------------------------- */

  const handleSaveJustification = useCallback(
    async (newJustification: string, newBullets: string[]) => {
      if (!criterion || !assessment) return;

      const originalJustificationStr = typeof assessment.justification === 'string'
        ? assessment.justification
        : assessment.justification.join('\n');

      /* immediately update justification in UI */
      setCriteriaAssessments((prev) => ({
        ...prev,
        [criterionId]: {
          ...prev[criterionId],
          justification: assessmentType === 'bullets' ? newBullets : newJustification,
        },
      }));

      setEditingJustification(false);

      /* async: revise score based on new justification */
      setIsRevisingScore(true);
      try {
        const result = await reviseCriterionScoreWithJustification(
          pdfContent,
          criterion,
          originalJustificationStr,
          newJustification,
          assessment.score,
        );

        setCriteriaAssessments((prev) => ({
          ...prev,
          [criterionId]: {
            ...prev[criterionId],
            score: result.revisedScore,
            aiScore: result.revisedScore,
            justification: assessmentType === 'bullets' ? newBullets : newJustification,
            revisionRationale: result.rationale,
            revisedAssessmentText: newJustification,
          },
        }));
      } catch (err) {
        console.error('Error revising score:', err);
        setGradingError(
          err instanceof Error ? err.message : 'Failed to revise score based on edits.'
        );
      } finally {
        setIsRevisingScore(false);
      }
    },
    [criterion, assessment, criterionId, rubricContent, pdfContent, contextList, setCriteriaAssessments]
  );

  /* -------------------------------------------------------------------------- */
  /*  handleFinishGrading                                                        */
  /* -------------------------------------------------------------------------- */

  const handleFinishGrading = useCallback(async () => {
    setIsFinishing(true);
    setGradingError(null);
    try {
      /* grade last criterion if it hasn't been graded yet */
      if (criterion && !assessment) {
        await gradeCurrentCriterion(rubricCriteria, currentCriterionIndex);
      }
      await finishGrading();
    } catch (err) {
      console.error('Error finishing grading:', err);
      setGradingError(
        err instanceof Error ? err.message : 'Failed to finish grading.'
      );
    } finally {
      setIsFinishing(false);
    }
  }, [criterion, assessment, gradeCurrentCriterion, rubricCriteria, currentCriterionIndex, finishGrading]);

  /* -------------------------------------------------------------------------- */
  /*  handleNext                                                                 */
  /* -------------------------------------------------------------------------- */

  const handleNext = useCallback(async () => {
    setIsProcessing(true);
    setGradingError(null);
    try {
      moveToNextCriterion();
    } catch (err) {
      console.error('Error moving to next:', err);
      setGradingError(err instanceof Error ? err.message : 'Error advancing criterion.');
    } finally {
      setIsProcessing(false);
    }
  }, [moveToNextCriterion]);

  /* -------------------------------------------------------------------------- */
  /*  Render: Overall assessment (grading complete)                              */
  /* -------------------------------------------------------------------------- */

  if (gradingComplete && overallAssessment) {
    const assessmentsArray = rubricCriteria.map((c) => criteriaAssessments[c.name]).filter(Boolean);
    return (
      <OverallAssessment
        overallAssessment={overallAssessment}
        criteriaAssessments={assessmentsArray}
        teacherScores={teacherScores}
        restartGrading={restartGrading}
        onRevisitCriteria={onRevisitCriteria}
        onGradeNextEssay={onGradeNextEssay}
      />
    );
  }

  /* -------------------------------------------------------------------------- */
  /*  Render: Initial loading                                                    */
  /* -------------------------------------------------------------------------- */

  if (isInitialLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-12 w-12 text-[#6366F1]" />
        </motion.div>
        <p className="mt-6 text-sm font-medium text-gray-500 dark:text-slate-400">
          Analyzing rubric and preparing grading interface...
        </p>
      </div>
    );
  }

  /* -------------------------------------------------------------------------- */
  /*  Render: main grading UI                                                    */
  /* -------------------------------------------------------------------------- */

  const previousScore = assessment?.originalAiScore ?? null;
  const revisionRationale = assessment?.revisionRationale ?? null;
  const progressPct = totalCriteria > 0 ? ((currentCriterionIndex + 1) / totalCriteria) * 100 : 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full gap-0">
      {/* ============================================================ */}
      {/*  LEFT COLUMN — Grading Controls (60%)                        */}
      {/* ============================================================ */}
      <div className="relative flex w-[60%] flex-col overflow-y-auto border-r border-gray-200 dark:border-slate-700">
        {/* Error banner */}
        <AnimatePresence>
          {gradingError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mx-4 mt-4 flex items-center justify-between rounded-lg bg-red-50 px-4 py-3 dark:bg-red-900/20"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-[#EF4444]" />
                <p className="text-sm text-[#EF4444]">{gradingError}</p>
              </div>
              <button
                onClick={() => setGradingError(null)}
                className="cursor-pointer rounded p-1 text-[#EF4444] transition-colors hover:bg-red-100 dark:hover:bg-red-900/40"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-6 p-6">
          {/* ---- Progress bar ---- */}
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold text-[#1E1B4B] dark:text-[#E2E8F0]">
                Criterion {currentCriterionIndex + 1} of {totalCriteria}
              </span>
              <span className="text-gray-500 dark:text-slate-400">
                {Math.round(progressPct)}% complete
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-[#6366F1] to-[#818CF8]"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>

          {/* ---- Criterion card ---- */}
          {criterion && (
            <motion.div
              key={criterionId}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3 }}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <h3 className="mb-3 text-lg font-bold text-[#1E1B4B] dark:text-[#E2E8F0]">
                {criterion.name}
              </h3>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-slate-500">
                Score range: {criterion.scoreRange.min} &ndash; {criterion.scoreRange.max}
              </p>
              <div className="space-y-2">
                {criterion.levels.map((level) => (
                  <div
                    key={level.score}
                    className="flex gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm dark:border-slate-700/50"
                  >
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#F5F3FF] text-xs font-bold text-[#6366F1] dark:bg-slate-700 dark:text-[#818CF8]">
                      {level.score}
                    </span>
                    <p className="text-gray-500 dark:text-slate-400">
                      {level.description}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ---- Error with retry ---- */}
          {assessment?.error && (
            <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800/40 dark:bg-red-950/20">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-[#EF4444]" />
                <div>
                  <p className="text-sm font-medium text-[#EF4444]">
                    Failed to grade this criterion
                  </p>
                  <p className="mt-0.5 text-xs text-red-400">
                    {assessment.error === 'EMPTY_RESPONSE' ? 'The AI returned an empty response.' :
                     assessment.error === 'MODEL_OVERLOADED' ? 'The AI model is overloaded. Try again in a moment.' :
                     assessment.error === 'REQUEST_FAILED' ? 'Network error — check your connection.' :
                     assessment.error}
                  </p>
                </div>
              </div>
              <button
                onClick={() => gradeCurrentCriterion(rubricCriteria, currentCriterionIndex)}
                className="cursor-pointer flex-shrink-0 rounded-lg bg-[#EF4444] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
              >
                Retry
              </button>
            </div>
          )}

          {/* ---- Assessment section ---- */}
          {assessment && !assessment.error && (
            <AssessmentSection
              assessmentType={assessmentType}
              currentAssessment={assessment}
              editingJustification={editingJustification}
              editedJustification={editedJustification}
              editedBullets={editedBullets}
              setEditedJustification={setEditedJustification}
              setEditedBullets={setEditedBullets}
              setEditingJustification={setEditingJustification}
              hoveredAssessmentIndexes={hoveredAssessmentIndexes}
              setHoveredAssessmentIndexes={setHoveredAssessmentIndexes}
              handleSaveJustification={() => {
                const justStr = typeof assessment.justification === 'string'
                  ? assessment.justification
                  : assessment.justification.join('\n');
                handleSaveJustification(editedJustification || justStr, editedBullets);
              }}
            />
          )}

          {/* ---- Evidence section ---- */}
          {assessment && !assessment.error && (
            <EvidenceSection
              showEvidence={showEvidence}
              setShowEvidence={setShowEvidence}
              currentAssessment={assessment}
              hoveredEvidenceIndex={hoveredEvidenceIndex}
              setHoveredEvidenceIndex={setHoveredEvidenceIndex}
              hoveredAssessmentIndexes={hoveredAssessmentIndexes}
              setHoveredAssessmentIndexes={setHoveredAssessmentIndexes}
            />
          )}

          {/* ---- Hallucination panel ---- */}
          {assessment && !assessment.error && (
            <HallucinationPanel
              essayContent={pdfContent}
              evidenceQuotes={assessment.evidence}
              hallucinationThreshold={hallucinationThreshold}
              criterionName={criterionId}
              onHallucinationDetected={(detected) => {
                onHallucinationUpdate?.(criterionId, {
                  detected: detected.length,
                  confirmed: detected.filter((h) => h.status === 'confirmed').length,
                  reported: 0,
                });
              }}
              onHallucinationReported={() => {
                onHallucinationUpdate?.(criterionId, {
                  detected: 0,
                  confirmed: 0,
                  reported: 1,
                });
              }}
            />
          )}

          {/* Hallucination warning popup removed - panel handles detection */}

          {/* ---- Scoring section ---- */}
          {criterion && assessment && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <h4 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                Scoring
              </h4>

              <div className="grid grid-cols-2 gap-6">
                {/* Teacher score */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#1E1B4B] dark:text-[#E2E8F0]">
                    Your Score
                  </label>
                  <select
                    value={teacherScore ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) handleTeacherScoreInput(criterionId, parseInt(val, 10));
                    }}
                    className="w-full cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-[#1E1B4B] transition-colors focus:border-[#6366F1] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-700 dark:text-[#E2E8F0] dark:focus:border-[#818CF8]"
                  >
                    <option value="">Select score...</option>
                    {scoreOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {/* AI score */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#1E1B4B] dark:text-[#E2E8F0]">
                    AI Score
                  </label>

                  {!aiScoreRevealed ? (
                    <button
                      onClick={() => revealAIScore(criterionId)}
                      disabled={teacherScore === null}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#6366F1]/30 bg-[#F5F3FF] px-4 py-2.5 text-sm font-medium text-[#6366F1] transition-all hover:border-[#6366F1]/60 hover:bg-[#EEF2FF] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#6366F1]/30 disabled:hover:bg-[#F5F3FF] dark:border-[#818CF8]/30 dark:bg-slate-700 dark:text-[#818CF8] dark:hover:border-[#818CF8]/60 dark:hover:bg-slate-600 dark:disabled:hover:bg-slate-700"
                    >
                      <Eye className="h-4 w-4" />
                      Reveal AI Score
                    </button>
                  ) : (
                    <div className="space-y-2">
                      {/* Show previous vs revised if revision occurred */}
                      {previousScore !== null && previousScore !== assessment.score ? (
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-400 line-through dark:bg-slate-700 dark:text-slate-500">
                            {previousScore}
                          </span>
                          <ArrowRight className="h-4 w-4 text-[#6366F1] dark:text-[#818CF8]" />
                          <motion.span
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="rounded-lg bg-[#6366F1] px-3 py-2 text-sm font-bold text-white"
                          >
                            {assessment.score}
                          </motion.span>
                        </div>
                      ) : (
                        <motion.div
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="flex h-[42px] w-full items-center justify-center rounded-lg bg-[#6366F1] text-lg font-bold text-white"
                        >
                          {assessment.score}
                        </motion.div>
                      )}

                      {/* Revising state */}
                      {isRevisingScore && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center gap-2 text-xs text-[#F59E0B]"
                        >
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Revising score based on edits...
                        </motion.div>
                      )}

                      {/* Revision rationale */}
                      {revisionRationale && !isRevisingScore && (
                        <motion.p
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-lg bg-[#F5F3FF] px-3 py-2 text-xs text-gray-600 dark:bg-slate-700 dark:text-slate-400"
                        >
                          {revisionRationale}
                        </motion.p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---- Navigation row ---- */}
          <div className="flex items-center justify-between border-t border-gray-200 pt-4 dark:border-slate-700">
            <button
              onClick={moveToPreviousCriterion}
              disabled={isFirstCriterion}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-[#1E1B4B] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-[#E2E8F0] dark:hover:bg-slate-800"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>

            <div className="flex items-center gap-3">
              {!isLastCriterion ? (
                <button
                  onClick={handleNext}
                  disabled={isProcessing}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#6366F1] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#5558E6] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={handleFinishGrading}
                  disabled={isFinishing}
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#10B981] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0EA572] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isFinishing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Finishing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Finish Grading
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ---- Criterion loading overlay ---- */}
        <AnimatePresence>
          {isCriterionLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center backdrop-blur-sm"
            >
              <div className="rounded-xl bg-white/90 p-8 shadow-lg dark:bg-slate-800/90">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="mx-auto w-fit"
                >
                  <Loader2 className="h-10 w-10 text-[#6366F1]" />
                </motion.div>
                <p className="mt-4 text-sm font-medium text-gray-500 dark:text-slate-400">
                  Loading next criterion...
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---- Processing overlay ---- */}
        <AnimatePresence>
          {(isProcessing || isFinishing) && !isCriterionLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[2px] dark:bg-slate-900/60"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Loader2 className="h-10 w-10 text-[#6366F1]" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ============================================================ */}
      {/*  RIGHT COLUMN — PDF Viewer (40%)                             */}
      {/* ============================================================ */}
      <div className="h-full w-[40%] overflow-hidden">
        <PdfViewer
          url={pdfFile}
          highlights={pdfHighlights}
        />
      </div>

      {/* ============================================================ */}
      {/*  Edit Justification Modal                                     */}
      {/* ============================================================ */}
      {editingJustification && assessment && (
        <EditJustificationModal
          isOpen={editingJustification}
          onClose={() => setEditingJustification(false)}
          initialValue={editedJustification}
          isBullets={assessmentType === 'bullets'}
          initialBullets={editedBullets}
          onSave={(value: string, bullets?: string[]) => {
            handleSaveJustification(value, bullets ?? []);
          }}
          warningText="Editing will update AI score"
        />
      )}
    </div>
  );
}
