# Score Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teachers to edit criterion scores on the Complete screen and in the Analytics session data table, with live stat recalculation.

**Architecture:** Two independent UI features sharing a common pattern — score cells become interactive inputs. Feature 1 edits in-memory `teacherScores` state; Feature 2 edits persisted `CsvRecorder` records and lifts state to `page.tsx`.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, localStorage persistence via CsvRecorder

---

## File Map

| File | Change |
|------|--------|
| `src/lib/csv-recorder.ts` | Add `updateTeacherScore(index, newScore)` method |
| `src/app/page.tsx` | Lift `records` into state; wire `handleUpdateTeacherScore` |
| `src/components/analytics/analytics-dashboard.tsx` | Add `onUpdateTeacherScore` prop; inline-edit teacher score cell |
| `src/components/grading/overall-assessment.tsx` | Add `handleTeacherScoreInput` prop; make score cells editable; remove `onRevisitCriteria` |
| `src/components/grading/interactive-grading.tsx` | Pass `handleTeacherScoreInput` to OverallAssessment; remove `onRevisitCriteria` |
| `src/components/grading/grading-workspace.tsx` | Remove `revisitCriteria` callback; remove `onRevisitCriteria` wiring |

---

## Task 1: Add `updateTeacherScore` to CsvRecorder

**Files:**
- Modify: `src/lib/csv-recorder.ts`

- [ ] **Step 1: Add the method**

In `src/lib/csv-recorder.ts`, add after `addGradeRecord`:

```ts
updateTeacherScore(index: number, newScore: number | null): void {
  const record = this.records[index];
  if (!record) return;
  record.teacher_score = newScore;
  record.score_difference =
    newScore !== null && record.ai_score !== null ? newScore - record.ai_score : null;
  // Recalculate avg_teacher_score_for_criterion for ALL records sharing this criterion
  const criterionName = record.criterion_name;
  const scores: number[] = this.records
    .map(r => (r.criterion_name === criterionName ? r.teacher_score : null))
    .filter((s): s is number => s !== null);
  const avg = scores.length > 0
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
    : null;
  for (const r of this.records) {
    if (r.criterion_name === criterionName) {
      r.avg_teacher_score_for_criterion = avg;
    }
  }
  this.saveToLocalStorage();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ~/Documents/essay_grader/essay-grader-web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `csv-recorder.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/csv-recorder.ts
git commit -m "feat: add updateTeacherScore to CsvRecorder"
```

---

## Task 2: Lift records state in page.tsx and wire update handler

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add records state and update handler**

Replace the current `page.tsx` content with:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTeacherSession } from '@/hooks/use-teacher-session';
import TeacherGate from '@/components/teacher-gate';
import Navbar from '@/components/navbar';
import Dashboard from '@/components/dashboard';
import PromptPlayground from '@/components/prompt-playground';
import type { GradeRecord } from '@/types';

const GradingWorkspace = dynamic(() => import('@/components/grading/grading-workspace'), { ssr: false });
const AnalyticsDashboard = dynamic(() => import('@/components/analytics/analytics-dashboard'), { ssr: false });

type ViewType = 'dashboard' | 'grading' | 'analytics' | 'playground';

const viewTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.25, ease: 'easeInOut' as const },
};

export default function Home() {
  const { teacherName, setTeacherName, recorder } = useTeacherSession();
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [analyticsRecords, setAnalyticsRecords] = useState<GradeRecord[]>([]);

  const refreshRecords = useCallback(() => {
    if (recorder) setAnalyticsRecords(recorder.getRecords());
  }, [recorder]);

  const handleExportCSV = useCallback(() => {
    recorder?.downloadCSV();
  }, [recorder]);

  const handleUpdateTeacherScore = useCallback((index: number, newScore: number | null) => {
    if (!recorder) return;
    recorder.updateTeacherScore(index, newScore);
    setAnalyticsRecords(recorder.getRecords());
  }, [recorder]);

  // Sync records when switching to analytics tab
  const handleNavigate = useCallback((view: ViewType) => {
    if (view === 'analytics') refreshRecords();
    setCurrentView(view);
  }, [refreshRecords]);

  if (!teacherName) {
    return <TeacherGate onSubmit={setTeacherName} />;
  }

  return (
    <div className="min-h-screen">
      <Navbar
        currentView={currentView}
        onNavigate={handleNavigate}
        teacherName={teacherName}
        onExportCSV={handleExportCSV}
      />

      <main className="pt-4">
        <AnimatePresence mode="wait">
          {currentView === 'dashboard' && (
            <motion.div key="dashboard" {...viewTransition}>
              <Dashboard
                onNavigateToGrading={() => handleNavigate('grading')}
                onNavigate={handleNavigate}
              />
            </motion.div>
          )}

          {currentView === 'grading' && (
            <motion.div key="grading" {...viewTransition}>
              {recorder && <GradingWorkspace recorder={recorder} />}
            </motion.div>
          )}

          {currentView === 'analytics' && (
            <motion.div key="analytics" {...viewTransition}>
              <AnalyticsDashboard
                records={analyticsRecords}
                teacherName={teacherName}
                onDownloadCSV={handleExportCSV}
                onUpdateTeacherScore={handleUpdateTeacherScore}
              />
            </motion.div>
          )}

          {currentView === 'playground' && (
            <motion.div key="playground" {...viewTransition}>
              <PromptPlayground />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: may show AnalyticsDashboard prop error (will be fixed in Task 3)

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: lift analytics records into state, wire updateTeacherScore"
```

---

## Task 3: Inline-edit teacher score cell in Analytics

**Files:**
- Modify: `src/components/analytics/analytics-dashboard.tsx`

- [ ] **Step 1: Add `onUpdateTeacherScore` to AnalyticsDashboardProps and SessionDataTab**

At the top of the file, update `AnalyticsDashboardProps`:

```ts
interface AnalyticsDashboardProps {
  records: GradeRecord[];
  teacherName: string;
  onDownloadCSV: () => void;
  onUpdateTeacherScore: (index: number, newScore: number | null) => void;
}
```

Update `SessionDataTab` signature:

```ts
function SessionDataTab({
  records,
  onDownloadCSV,
  onUpdateTeacherScore,
}: {
  records: GradeRecord[];
  onDownloadCSV: () => void;
  onUpdateTeacherScore: (index: number, newScore: number | null) => void;
}) {
```

- [ ] **Step 2: Add inline-edit cell component inside the file (above SessionDataTab)**

Add this small component above `SessionDataTab`:

```tsx
function EditableScoreCell({
  value,
  min,
  max,
  onSave,
}: {
  value: number | null;
  min: number;
  max: number;
  onSave: (newScore: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));

  function commit() {
    const parsed = parseFloat(draft);
    if (!isNaN(parsed) && parsed >= min && parsed <= max) {
      onSave(parsed);
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(String(value ?? '')); setEditing(true); }}
        className="cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
        title="Click to edit"
        style={{ color: 'var(--foreground)' }}
      >
        {value ?? '-'}
      </span>
    );
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={1}
      value={draft}
      autoFocus
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-16 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-center text-sm outline-none focus:ring-2 focus:ring-indigo-400 dark:border-indigo-600 dark:bg-slate-700"
      style={{ color: 'var(--foreground)' }}
    />
  );
}
```

- [ ] **Step 3: Replace the teacher score `<td>` in the table**

Find this line in `SessionDataTab`'s table body:

```tsx
<td className="whitespace-nowrap px-4 py-2.5 text-center" style={{ color: 'var(--foreground)' }}>{r.teacher_score ?? '-'}</td>
```

Replace it with:

```tsx
<td className="whitespace-nowrap px-4 py-2.5 text-center">
  <EditableScoreCell
    value={r.teacher_score}
    min={r.score_min}
    max={r.score_max}
    onSave={newScore => onUpdateTeacherScore(i, newScore)}
  />
</td>
```

- [ ] **Step 4: Pass `onUpdateTeacherScore` through in the main component**

Find where `SessionDataTab` is rendered (inside the main `AnalyticsDashboard` component) and add the prop:

```tsx
<SessionDataTab
  records={records}
  onDownloadCSV={onDownloadCSV}
  onUpdateTeacherScore={onUpdateTeacherScore}
/>
```

Also add `onUpdateTeacherScore` to the `AnalyticsDashboard` function signature destructuring.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/components/analytics/analytics-dashboard.tsx
git commit -m "feat: inline-edit teacher score in analytics session data table"
```

---

## Task 4: Make score cells editable in OverallAssessment

**Files:**
- Modify: `src/components/grading/overall-assessment.tsx`

- [ ] **Step 1: Update props interface**

Replace the existing `OverallAssessmentProps` interface:

```ts
interface OverallAssessmentProps {
  overallAssessment: OverallAssessmentResult;
  criteriaAssessments: Assessment[];
  teacherScores: Record<string, number | null>;
  handleTeacherScoreInput: (criterionName: string, score: number) => void;
  restartGrading: () => void;
  onGradeNextEssay?: () => void;
}
```

- [ ] **Step 2: Update function signature**

```tsx
export default function OverallAssessment({
  overallAssessment,
  criteriaAssessments,
  teacherScores,
  handleTeacherScoreInput,
  restartGrading,
  onGradeNextEssay,
}: OverallAssessmentProps) {
```

- [ ] **Step 3: Replace the "Your Score" `<td>` with score buttons**

Find this in the table body:

```tsx
<td className="px-5 py-3 text-center text-sm font-semibold text-[#6366F1]">
  {teacherScores[criterion.name] ?? '-'}
</td>
```

Replace with:

```tsx
<td className="px-5 py-3 text-center">
  <div className="flex items-center justify-center gap-1 flex-wrap">
    {Array.from(
      { length: criterion.scoreRange.max - criterion.scoreRange.min + 1 },
      (_, i) => criterion.scoreRange.min + i
    ).map(score => {
      const isActive = teacherScores[criterion.name] === score;
      return (
        <button
          key={score}
          onClick={() => handleTeacherScoreInput(criterion.name, score)}
          className={`h-7 w-7 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
            isActive
              ? 'bg-[#6366F1] text-white'
              : 'border border-gray-300 bg-white text-gray-500 hover:border-[#6366F1] hover:text-[#6366F1] dark:border-slate-600 dark:bg-slate-700 dark:text-gray-400'
          }`}
        >
          {score}
        </button>
      );
    })}
  </div>
</td>
```

- [ ] **Step 4: Remove the "Revisit Criteria" button from the action buttons section**

Find and remove this block entirely:

```tsx
<button
  onClick={onRevisitCriteria}
  className="cursor-pointer inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700"
>
  <ListChecks className="h-4 w-4" />
  Revisit Criteria
</button>
```

Also remove `ListChecks` from the lucide-react import.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: may show InteractiveGrading prop errors (fixed in Task 5)

- [ ] **Step 6: Commit**

```bash
git add src/components/grading/overall-assessment.tsx
git commit -m "feat: editable score buttons on complete screen, remove revisit criteria button"
```

---

## Task 5: Update InteractiveGrading to wire new props

**Files:**
- Modify: `src/components/grading/interactive-grading.tsx`

- [ ] **Step 1: Update props interface**

In `InteractiveGradingProps`, replace:

```ts
onRevisitCriteria?: () => void;
```

with:

```ts
handleTeacherScoreInput: (criterionId: string, score: number) => void;
```

(Note: `handleTeacherScoreInput` already exists in the interface — confirm it's there. If so, just remove `onRevisitCriteria`.)

- [ ] **Step 2: Update function destructuring**

Remove `onRevisitCriteria` from the destructured props list.

- [ ] **Step 3: Pass `handleTeacherScoreInput` to OverallAssessment**

Find where `OverallAssessment` is rendered and update its props:

```tsx
<OverallAssessment
  overallAssessment={overallAssessment}
  criteriaAssessments={Object.values(criteriaAssessments)}
  teacherScores={teacherScores}
  handleTeacherScoreInput={handleTeacherScoreInput}
  restartGrading={restartGrading}
  onGradeNextEssay={onGradeNextEssay}
/>
```

(Remove `onRevisitCriteria` from this call.)

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: may show grading-workspace prop errors (fixed in Task 6)

- [ ] **Step 5: Commit**

```bash
git add src/components/grading/interactive-grading.tsx
git commit -m "feat: wire handleTeacherScoreInput to OverallAssessment, remove onRevisitCriteria"
```

---

## Task 6: Clean up grading-workspace

**Files:**
- Modify: `src/components/grading/grading-workspace.tsx`

- [ ] **Step 1: Remove `revisitCriteria` callback**

Find and delete this entire block:

```ts
const revisitCriteria = useCallback(() => {
  // Invalidate cache since rubric may change
  if (cacheName) deleteRubricCache(cacheName).catch(() => {});
  setCacheName(null);
  setCurrentStep('rubric');
}, [cacheName]);
```

- [ ] **Step 2: Remove `onRevisitCriteria` prop from InteractiveGrading render**

Find the `<InteractiveGrading>` JSX and remove:

```tsx
onRevisitCriteria={revisitCriteria}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors

- [ ] **Step 4: Start dev server and manually verify both features**

```bash
npm run dev
```

Manual checks:
1. Grade an essay through to the Complete screen
2. Confirm the "Your Score" column shows score buttons for each criterion
3. Click a different score — confirm the Overall Grade average updates
4. Navigate to Analytics → Session Data
5. Click a teacher score cell — confirm it becomes an editable input
6. Change the score, press Enter — confirm the value updates and Overview stats recalculate

- [ ] **Step 5: Commit**

```bash
git add src/components/grading/grading-workspace.tsx
git commit -m "feat: remove revisitCriteria, clean up grading workspace"
```
