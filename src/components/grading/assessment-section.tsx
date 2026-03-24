'use client';

import React, { useState } from 'react';
import { Pencil, AlertTriangle, Save, X } from 'lucide-react';
import Modal from '@/components/ui/modal';
import { Assessment, AssessmentType } from '@/types';

interface AssessmentSectionProps {
  assessmentType: AssessmentType;
  currentAssessment: Assessment;
  editingJustification: boolean;
  editedJustification: string;
  editedBullets: string[];
  setEditedJustification: (value: string) => void;
  setEditedBullets: (value: string[]) => void;
  setEditingJustification: (value: boolean) => void;
  hoveredAssessmentIndexes: number[];
  setHoveredAssessmentIndexes: (indexes: number[]) => void;
  handleSaveJustification: () => void;
}

const SENTENCE_REGEX = /[^.!?]+[.!?]+/g;

function splitSentences(text: string): string[] {
  const matches = text.match(SENTENCE_REGEX);
  return matches ?? [text];
}

export default function AssessmentSection({
  assessmentType,
  currentAssessment,
  editingJustification,
  editedJustification,
  editedBullets,
  setEditedJustification,
  setEditedBullets,
  setEditingJustification,
  hoveredAssessmentIndexes,
  setHoveredAssessmentIndexes,
  handleSaveJustification,
}: AssessmentSectionProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const displayText =
    currentAssessment.revisedAssessmentText ?? currentAssessment.justification;

  const justificationText = Array.isArray(displayText)
    ? displayText.join(' ')
    : displayText;

  const justificationBullets = Array.isArray(displayText)
    ? displayText
    : splitSentences(displayText);

  const sentences = splitSentences(justificationText);

  function openEditModal() {
    if (Array.isArray(displayText)) {
      setEditedBullets([...justificationBullets]);
    } else {
      setEditedJustification(justificationText);
    }
    setModalOpen(true);
    setEditingJustification(true);
  }

  function closeEditModal() {
    setModalOpen(false);
    setEditingJustification(false);
  }

  function onSave() {
    handleSaveJustification();
    closeEditModal();
  }

  function handleBulletChange(index: number, value: string) {
    const updated = [...editedBullets];
    updated[index] = value;
    setEditedBullets(updated);
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[#6366F1]">
          Assessment
        </h3>
        <button
          onClick={openEditModal}
          className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-[#6366F1] transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-[#818CF8] dark:hover:bg-indigo-950/60"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
      </div>

      {/* Warning tag */}
      <div className="mb-4 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-[#F59E0B] dark:bg-amber-950/30 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Editing will update AI score
      </div>

      {/* Justification display */}
      <div className="text-sm leading-relaxed text-[#1E1B4B] dark:text-[#E2E8F0]">
        {assessmentType === 'flow' ? (
          <p>
            {sentences.map((sentence, idx) => (
              <span
                key={idx}
                onMouseEnter={() => setHoveredAssessmentIndexes([idx])}
                onMouseLeave={() => setHoveredAssessmentIndexes([])}
                className={`cursor-default rounded px-0.5 transition-colors ${
                  hoveredAssessmentIndexes.includes(idx)
                    ? 'bg-indigo-100 dark:bg-indigo-900/40'
                    : ''
                }`}
              >
                {sentence}
              </span>
            ))}
          </p>
        ) : (
          <ul className="space-y-2">
            {justificationBullets.map((bullet, idx) => (
              <li
                key={idx}
                onMouseEnter={() => setHoveredAssessmentIndexes([idx])}
                onMouseLeave={() => setHoveredAssessmentIndexes([])}
                className={`cursor-default rounded-lg px-3 py-2 transition-colors ${
                  hoveredAssessmentIndexes.includes(idx)
                    ? 'bg-indigo-100 dark:bg-indigo-900/40'
                    : 'bg-gray-50 dark:bg-slate-700/50'
                }`}
              >
                <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#6366F1]" />
                {bullet.trim()}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Edit Justification Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeEditModal}
        title="Edit Justification"
      >
        <div className="space-y-4">
          <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-[#F59E0B] dark:bg-amber-950/30 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Editing will update AI score
          </div>

          {assessmentType === 'flow' || !Array.isArray(displayText) ? (
            <textarea
              value={editedJustification}
              onChange={(e) => setEditedJustification(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-[#1E1B4B] outline-none transition-colors focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-800 dark:text-[#E2E8F0]"
            />
          ) : (
            <div className="space-y-3">
              {editedBullets.map((bullet, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6366F1]" />
                  <textarea
                    value={bullet}
                    onChange={(e) => handleBulletChange(idx, e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm text-[#1E1B4B] outline-none transition-colors focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 dark:border-slate-600 dark:bg-slate-800 dark:text-[#E2E8F0]"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={closeEditModal}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
            <button
              onClick={onSave}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
            >
              <Save className="h-4 w-4" />
              Save Changes
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
