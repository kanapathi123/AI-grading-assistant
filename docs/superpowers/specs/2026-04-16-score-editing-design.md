# Score Editing Design
**Date:** 2026-04-16
**Branch:** develop

## Overview

Two features that allow teachers to correct teacher scores after grading is complete:

1. **Inline score editing on the Complete screen** — edit any criterion's teacher score directly in the criteria breakdown table without leaving the complete view.
2. **Inline teacher score editing in the Analytics tab** — correct a recorded teacher score post-session; all derived stats recalculate live.

---

## Feature 1: Inline Score Editing on Complete Screen

### What it does

On the "Grading Complete" page (`overall-assessment.tsx`), the criteria breakdown table's "Your Score" column becomes an interactive score selector. Each cell renders the valid score buttons for that criterion (bounded by `scoreRange.min`/`scoreRange.max`). The active score is highlighted in indigo; others are muted outlines. Clicking a different score calls `handleTeacherScoreInput` — the same callback used during grading — so the average grade at the top recalculates immediately.

### Changes

**`src/components/grading/overall-assessment.tsx`**
- Add `handleTeacherScoreInput: (criterionName: string, score: number) => void` prop
- Remove `onRevisitCriteria` prop (button removed — table is now always editable)
- Replace the static "Your Score" cell with a row of score buttons per criterion
- Keep "Grade Again" and "Grade Next Essay" buttons unchanged

**`src/components/grading/interactive-grading.tsx`**
- Pass `handleTeacherScoreInput` down to `OverallAssessment`
- Remove `onRevisitCriteria` prop pass-through

**`src/components/grading/grading-workspace.tsx`**
- Remove `revisitCriteria` callback and `onRevisitCriteria` wiring
- No other changes needed — `handleTeacherScoreInput` already exists and is already passed to `InteractiveGrading`

### Data flow

```
OverallAssessment (score button click)
  → handleTeacherScoreInput(criterionName, newScore)          [grading-workspace]
  → setTeacherScores(prev => ({ ...prev, [criterionId]: score }))
  → teacherScores prop updates → average recalculates via useMemo in OverallAssessment
```

### Constraints
- Score buttons must respect each criterion's `scoreRange.min`/`scoreRange.max`
- Visual style matches existing score selectors in the grading flow (indigo active, outline inactive)
- No re-grading, no AI calls, no navigation

---

## Feature 2: Inline Teacher Score Editing in Analytics

### What it does

In the Analytics tab's Session Data table, the teacher score cell becomes click-to-edit. Clicking it renders a small number input bounded to the record's `score_min`/`score_max`. Pressing Enter or blurring saves; Escape cancels. Saving calls `onUpdateTeacherScore(index, newScore)`, which updates the underlying `CsvRecorder` record and persists to localStorage. All stat cards and tables in the Overview and Agreement tabs recalculate automatically since they derive from `records` via `useMemo`.

### Changes

**`src/lib/csv-recorder.ts`**
- Add `updateTeacherScore(index: number, newScore: number | null): void`
  - Updates `teacher_score` on the record at `index`
  - Recalculates `score_difference` (teacher_score − ai_score, null if either is null)
  - Recalculates `avg_teacher_score_for_criterion` for all records sharing that `criterion_name`
  - Calls `saveToLocalStorage()`

**`src/components/analytics/analytics-dashboard.tsx`**
- Add `onUpdateTeacherScore: (index: number, newScore: number | null) => void` to `AnalyticsDashboardProps`
- Pass it through to `SessionDataTab`
- `SessionDataTab`: replace static teacher score cell with an inline-edit cell component
  - Idle state: shows score value, clicking activates input
  - Active state: `<input type="number">` with `min`/`max` from record, auto-focused
  - Enter/blur: validate (within range), call `onUpdateTeacherScore`, return to idle
  - Escape: return to idle without saving
  - If value is unchanged, no-op

**`src/app/page.tsx`**
- Lift `records` into state: `const [analyticsRecords, setAnalyticsRecords] = useState<GradeRecord[]>([])`
- Feed analytics with `analyticsRecords` instead of `recorder.getRecords()` inline
- Refresh on grading complete: `setAnalyticsRecords(recorder.getRecords())`
- Add `handleUpdateTeacherScore(index, newScore)`:
  ```ts
  recorder.updateTeacherScore(index, newScore);
  setAnalyticsRecords(recorder.getRecords());
  ```
- Pass `onUpdateTeacherScore={handleUpdateTeacherScore}` to `AnalyticsDashboard`

### Data flow

```
SessionDataTab cell (Enter/blur)
  → onUpdateTeacherScore(index, newScore)                     [page.tsx]
  → recorder.updateTeacherScore(index, newScore)              [csv-recorder]
    → updates record, recalculates score_difference + avg
    → saveToLocalStorage()
  → setAnalyticsRecords(recorder.getRecords())
  → records prop update → all useMemo stats recalculate       [analytics-dashboard]
```

### Constraints
- Only `teacher_score` is editable — AI scores, timestamps, and all other fields are read-only
- Input is bounded to `score_min`/`score_max` of that record
- Invalid/empty input on blur reverts to previous value (no null-ing out an existing score accidentally)
- `avg_teacher_score_for_criterion` must be recalculated across ALL records for that criterion, not just the edited one

---

## Out of Scope
- Re-grading or changing AI scores from either screen
- Editing other fields (timestamps, hallucination counts, etc.) in analytics
- Persisting edits to any backend — localStorage only
