'use client';

import React, { useState } from 'react';
import { RotateCcw, CheckCircle, FileText, ListChecks, FileUp } from 'lucide-react';
import { Assessment, OverallAssessmentResult } from '@/types';

interface OverallAssessmentProps {
  overallAssessment: OverallAssessmentResult;
  criteriaAssessments: Assessment[];
  teacherScores: Record<string, number | null>;
  restartGrading: () => void;
  onRevisitCriteria?: () => void;
  onGradeNextEssay?: () => void;
}

export default function OverallAssessment({
  overallAssessment,
  criteriaAssessments,
  teacherScores,
  restartGrading,
  onRevisitCriteria,
  onGradeNextEssay,
}: OverallAssessmentProps) {
  const [strengths, setStrengths] = useState(overallAssessment.strengths);
  const [improvements, setImprovements] = useState(overallAssessment.improvements);
  const [advice, setAdvice] = useState(overallAssessment.advice);
  const [overallGrade, setOverallGrade] = useState(
    String(overallAssessment.overallGrade)
  );

  function getFinalScore(criterion: Assessment): string {
    const teacherScore = teacherScores[criterion.name];
    const aiScore = criterion.aiScore;
    if (teacherScore != null && aiScore != null) {
      return String(Math.round((teacherScore + aiScore) / 2));
    }
    return String(teacherScore ?? aiScore ?? '-');
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-6 text-center shadow-sm dark:border-green-800/40 dark:from-green-950/20 dark:to-emerald-950/20">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#10B981]/10">
          <CheckCircle className="h-8 w-8 text-[#10B981]" />
        </div>
        <h2 className="text-2xl font-bold text-[#1E1B4B] dark:text-[#E2E8F0]">
          Grading Complete
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Review and edit your final assessment below
        </p>
      </div>

      {/* Editable sections */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Strengths */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-[#10B981]">
            Strengths
          </label>
          <textarea
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-[#1E1B4B] outline-none transition-colors focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-700 dark:text-[#E2E8F0]"
          />
        </div>

        {/* Improvements */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-[#F59E0B]">
            Areas for Improvement
          </label>
          <textarea
            value={improvements}
            onChange={(e) => setImprovements(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-[#1E1B4B] outline-none transition-colors focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-700 dark:text-[#E2E8F0]"
          />
        </div>
      </div>

      {/* Advice */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-[#6366F1]">
          Advice
        </label>
        <textarea
          value={advice}
          onChange={(e) => setAdvice(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-[#1E1B4B] outline-none transition-colors focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-700 dark:text-[#E2E8F0]"
        />
      </div>

      {/* Overall Grade */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-[#6366F1]">
          Overall Grade
        </label>
        <input
          type="text"
          value={overallGrade}
          onChange={(e) => setOverallGrade(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xl font-bold text-[#1E1B4B] outline-none transition-colors focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-700 dark:text-[#E2E8F0]"
        />
      </div>

      {/* Criteria Breakdown Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-slate-700">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[#6366F1]">
            <FileText className="h-4 w-4" />
            Criteria Breakdown
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-700">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Criterion
                </th>
                <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Your Score
                </th>
                <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  AI Score
                </th>
                <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Final Score
                </th>
              </tr>
            </thead>
            <tbody>
              {criteriaAssessments.map((criterion) => (
                <tr
                  key={criterion.id}
                  className="border-b border-gray-50 transition-colors hover:bg-gray-50 dark:border-slate-700/50 dark:hover:bg-slate-700/30"
                >
                  <td className="px-5 py-3 text-sm font-medium text-[#1E1B4B] dark:text-[#E2E8F0]">
                    {criterion.name}
                  </td>
                  <td className="px-5 py-3 text-center text-sm font-semibold text-[#6366F1]">
                    {teacherScores[criterion.name] ?? '-'}
                  </td>
                  <td className="px-5 py-3 text-center text-sm font-semibold text-[#818CF8]">
                    {criterion.aiScore ?? '-'}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="inline-flex items-center justify-center rounded-full bg-indigo-100 px-3 py-1 text-sm font-bold text-[#6366F1] dark:bg-indigo-900/40 dark:text-[#818CF8]">
                      {getFinalScore(criterion)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-center gap-4 pb-8">
        <button
          onClick={onRevisitCriteria}
          className="cursor-pointer inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700"
        >
          <ListChecks className="h-4 w-4" />
          Revisit Criteria
        </button>
        <button
          onClick={restartGrading}
          className="cursor-pointer inline-flex items-center gap-2 rounded-lg border border-[#6366F1] bg-white px-5 py-2.5 text-sm font-medium text-[#6366F1] shadow-sm transition-colors hover:bg-indigo-50 dark:border-[#818CF8] dark:bg-slate-800 dark:text-[#818CF8] dark:hover:bg-slate-700"
        >
          <RotateCcw className="h-4 w-4" />
          Grade Again
        </button>
        <button
          onClick={onGradeNextEssay}
          className="cursor-pointer inline-flex items-center gap-2 rounded-lg bg-[#6366F1] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600"
        >
          <FileUp className="h-4 w-4" />
          Grade Next Essay
        </button>
      </div>
    </div>
  );
}
