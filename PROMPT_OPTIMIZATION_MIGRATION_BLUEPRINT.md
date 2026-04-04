# Prompt Optimization Feature Reverse-Engineering
## Migration Blueprint (Simplified)

**Source Project**: `d:\prompt-craft`  
**Target Project**: `d:\AI-grading-assistant`  
**Extraction Date**: April 3, 2026  
**Scope**: Simplified iterative refinement of **rubric criteria** and **feedback settings** only
**Excluded**: academicLevel, subject, assignmentDesc, examples (not needed for playground testing)

---

## 0. Verified Source Anchors (Prompt-Craft)

The following implementation anchors were verified directly in `d:\prompt-craft` and should be treated as the source-of-truth for migration semantics.

### 0.1 Core page behavior

- Main container and state orchestration: `src/pages/PromptOptimization.tsx:404`
- Feedback-driven revision generation flow: `src/pages/PromptOptimization.tsx:498`
- Comparison run flow between older/newer prompt versions: `src/pages/PromptOptimization.tsx:595`
- Save and apply selected iteration as a new version: `src/pages/PromptOptimization.tsx:794`
- Feedback composer UI component used in iteration flow: `src/pages/PromptOptimization.tsx:290`

### 0.2 Prompt section compare/edit behavior

- Prompt config to section view model: `src/components/optimization/PromptSectionsEditor.tsx:65`
- Section edits back to config patch: `src/components/optimization/PromptSectionsEditor.tsx:86`
- Section comparison/editor component: `src/components/optimization/PromptSectionsEditor.tsx:141`

### 0.3 Frontend API calls used by optimizer

- Suggestion generation API wrapper: `src/lib/api.ts:261`
- Apply feedback / produce revised config: `src/lib/api.ts:314`
- Grade with arbitrary prompt config (comparison runs): `src/lib/api.ts:368`
- Compare grading endpoint wrapper: `src/lib/api.ts:470`

### 0.4 Backend optimizer routes

- Generate suggestions endpoint: `server/server.js:622`
- Apply feedback endpoint: `server/server.js:664`
- Grade with config endpoint: `server/server.js:751`
- Compare-grade endpoint: `server/server.js:793`

### 0.5 Backend optimization logic

- Suggestion generation service logic: `server/services/optimizationService.js:8`
- Feedback-to-revision service logic: `server/services/optimizationService.js:97`
- Revised config normalization (important behavior): `server/services/optimizationService.js:311`
- System prompt for suggestion generation: `server/services/optimizationService.js:350`

### 0.6 Important source note

- `src/components/PromptOptimization.tsx` exists but is empty in prompt-craft.
- The effective optimization page implementation is in `src/pages/PromptOptimization.tsx`.

### 0.7 Source -> Target Migration Matrix (Prompt-Craft -> AI-Grading-Assistant)

This matrix maps each verified prompt-craft anchor to the closest landing point in this repository.

#### Core page behavior

| Prompt-Craft Anchor | Target Landing Point | Migration Notes |
|---|---|---|
| `src/pages/PromptOptimization.tsx:404` (main container/state orchestration) | `src/components/prompt-playground.tsx:815` (`PromptPlayground` state root) | Optimizer is embedded as a view (`view === 'optimizer'`) instead of a dedicated route/page. |
| `src/pages/PromptOptimization.tsx:498` (feedback -> revised prompt generation) | `src/components/prompt-playground.tsx:1296` (`generateOptimizedWithLLM`), `src/components/prompt-playground.tsx:1268` (`persistOptimizationIteration`), `src/app/api/gemini/route.ts:878` (`handlePlaygroundOptimizeConfig`) | Same high-level flow (feedback in, revised config out), but frontend calls `/api/gemini` action dispatch rather than a dedicated optimize REST route. |
| `src/pages/PromptOptimization.tsx:595` (comparison run old/new) | `src/components/prompt-playground.tsx:1351` (`compareConfigs`), `src/app/api/gemini/route.ts:940` (`handlePlaygroundGrade`) | Comparison runs by grading the same essay against older/newer configs through prompt-config-applied grading. |
| `src/pages/PromptOptimization.tsx:794` (save/apply selected iteration as new version) | `src/components/prompt-playground.tsx:1374` (`applyOptimizedConfig`), `src/components/prompt-playground.tsx:1451` (`applyTestIterationConfig`), `src/components/prompt-playground.tsx:909` (`updateActiveSetConfig`) | Applied config is persisted to local prompt-set state/version history in playground, not server-side prompt version tables. |
| `src/pages/PromptOptimization.tsx:290` (feedback composer component) | `src/components/prompt-playground.tsx:1247` (`normalizeFeedbackParagraphs`), `src/components/prompt-playground.tsx:1253` (`hasFeedbackTag`), `src/components/prompt-playground.tsx:1258` (`toggleFeedbackTag`), optimizer UI block at `src/components/prompt-playground.tsx:2263` | Tag-driven feedback composition and freeform textarea exist inline in optimizer panel rather than as a standalone component. |

#### Prompt section compare/edit behavior

| Prompt-Craft Anchor | Target Landing Point | Migration Notes |
|---|---|---|
| `src/components/optimization/PromptSectionsEditor.tsx:65` (`configToSections`) | `src/components/prompt-playground.tsx:744` (`getEffectiveFeedbackInstructionText`), `src/components/prompt-playground.tsx:750` (`buildPromptSlotsFromConfig`) | Equivalent behavior is distributed across config helper functions; no single section-view model function currently. |
| `src/components/optimization/PromptSectionsEditor.tsx:86` (`sectionsToConfigPatch`) | `src/components/prompt-playground.tsx:1383` (`updateTestIteration`), `src/components/prompt-playground.tsx:1451` (`applyTestIterationConfig`), `src/components/prompt-playground.tsx:909` (`updateActiveSetConfig`) | Reverse mapping is applied through targeted state patches, not a centralized serializer. |
| `src/components/optimization/PromptSectionsEditor.tsx:141` (section comparison/editor component) | No 1:1 component in current repo | Current UI edits config directly and compares grade outputs; word-level section diff/editor parity is a migration gap. |

#### Frontend optimizer API mapping

| Prompt-Craft Anchor | Target Landing Point | Migration Notes |
|---|---|---|
| `src/lib/api.ts:261` (`generateOptimizationSuggestions`) | No 1:1 call in current optimizer flow | Suggestion endpoint equivalent is currently not exposed in frontend flow (feature gap or intentionally removed in simplified mode). |
| `src/lib/api.ts:314` (`applyOptimizationFeedback`) | Inline fetch in `src/components/prompt-playground.tsx:1303` -> `/api/gemini` action `playgroundOptimizeConfig` (`src/app/api/gemini/route.ts:264`) | Wrapper function not extracted yet; can be migrated into `src/lib/gemini-service.ts` if API-layer parity is desired. |
| `src/lib/api.ts:368` (`gradeWithConfig`) | `runGrade` in `src/components/prompt-playground.tsx:1037` -> `/api/gemini` action `playgroundGrade` (`src/app/api/gemini/route.ts:274`) | Same intent, different transport shape (action-based single endpoint). |
| `src/lib/api.ts:470` (`compareGrading`) | `compareConfigs` in `src/components/prompt-playground.tsx:1351` (client-side dual run) | Comparison is composed client-side by running two grade calls, not via dedicated compare endpoint. |

#### Backend route mapping

| Prompt-Craft Anchor | Target Landing Point | Migration Notes |
|---|---|---|
| `server/server.js:622` (`POST /api/optimize/suggestions`) | No 1:1 route in `src/app/api/gemini/route.ts` | Missing route/functionality in current simplified implementation. |
| `server/server.js:664` (`POST /api/optimize/apply`) | `src/app/api/gemini/route.ts:878` (`handlePlaygroundOptimizeConfig`) dispatched at `src/app/api/gemini/route.ts:264` | Consolidated into action-based Next route instead of Express route. |
| `server/server.js:751` (`POST /api/optimize/grade-with-config`) | `src/app/api/gemini/route.ts:940` (`handlePlaygroundGrade`) dispatched at `src/app/api/gemini/route.ts:274` | Parity grading exists under action dispatch. |
| `server/server.js:793` (`POST /api/optimize/compare-grade`) | No dedicated route; closest behavior is `compareConfigs` at `src/components/prompt-playground.tsx:1351` | Comparison moved to frontend orchestration. |

#### Backend optimization logic mapping

| Prompt-Craft Anchor | Target Landing Point | Migration Notes |
|---|---|---|
| `server/services/optimizationService.js:8` (suggestion generation service) | No 1:1 service module in current repo | Suggestion-generation subsystem is currently absent. |
| `server/services/optimizationService.js:97` (feedback-to-revision service) | `src/app/api/gemini/route.ts:878` (`handlePlaygroundOptimizeConfig`) | Revision generation exists, but is implemented inline in route handler. |
| `server/services/optimizationService.js:311` (revised config normalization) | No explicit normalizer helper after parse in `src/app/api/gemini/route.ts:878` | Important behavior gap: prompt-craft normalization/guardrails are not centralized here. |
| `server/services/optimizationService.js:350` (suggestion system prompt) | No 1:1 prompt in current repo | Only revision and grading prompts are currently defined in route handlers. |

#### Recommended extraction targets (if parity is required)

1. Add optimizer API wrappers in `src/lib/gemini-service.ts` (parallel to existing `callApi` pattern at line 40).
2. Extract optimization handlers from `src/app/api/gemini/route.ts` into a dedicated service module (prompt-craft-style separation of route vs service).
3. Add revised-config normalization utility to enforce criterion IDs/ranges/levels and protect against malformed LLM JSON.
4. Re-introduce suggestion generation as an optional flow if prompt-craft feature parity is desired.

---

## 1. Feature Overview

### User Flows

#### 1.1 Initial Load State
```
URL: /optimize/:id
Location State (OptimizationLocationState) - SIMPLIFIED:
├── essayText: string (single test essay)
├── baseCriteria: RubricCriterion[]
├── baseFeedbackInstructionText: string
└── gradingResult: GradingResultData (baseline grading with base config)

Initialization:
1. Extract essayText, baseCriteria, baseFeedbackInstructionText from location.state
2. Create PromptIteration[0] with id=1, name="Rubric 1"
   - criteria: baseCriteria (copy)
   - feedbackInstructionText: baseFeedbackInstructionText (copy)
   - gradingResult: from location.state (baseline)
3. Display baseline grading result for comparison
```

#### 1.2 Iteration Creation Flow (Simplified)
```
User edits in Playground UI:
  ├─ Modify RubricTable (criteria names, score ranges, level descriptions), Modify additional rubric
  └─ Modify Feedback Instructions textarea

User clicks "Grade and Compare" → triggers grading with the currently edited prompt config

Changes tracked:
  ├─ criteria: [{ id, name, minScore, maxScore, levels }]
  └─ feedbackInstructionText: string

Iteration snapshots are local, but grading is API-driven:
  → Create/keep iteration snapshot locally with new id
  → Set isGrading=true
  → Call POST /api/gemini with action="playgroundGrade"
     Request: {
       action: "playgroundGrade",
       payload: {
         essayText: string,
         criteria: Array<{ name, scoreRange }>,
         promptSlots: derived from current config,
         styleOverrides: derived from current config,
         assessmentType: "flow" | "bullets"
       }
     }
     Response: GradingResultData
  → Cache result in iteration.gradingResult
  → Compare with previous iteration's result (side-by-side)
```

#### 1.3 Comparison Run Flow (Test & Compare)
```
User Path:
  Click "Grade and Compare" (in optimizer panel)
    ↓ testRubricIteration(iterationId)
    ├─ Get current iteration criteria + feedbackInstructionText
    ├─ Validation: essayText not empty, criteria valid
    ├─ Set isGrading=true on iteration
    │
    └─ POST /api/gemini (action="playgroundGrade")
       Request:
         - essayText: the test essay (string)
         - prompt derived from edited config (prompt slots/style/criteria ranges)
       Response:
         - overallScore: number
         - maxScore: number
         - criteria: Array<{
             name,
             score,
             maxScore,
             feedback,
             evidenceQuotes
           }>
       ↓ onSuccess:
         1. Store result in iteration.gradingResult
         2. Set isGrading=false
         3. Display result (show side-by-side with baseline)
         4. Highlight changes in scoring if different from previous iteration
       ↓ onError:
         1. Set isGrading=false
         2. Toast error message
         3. Retain iteration data

No caching needed (single essay, no multi-iteration comparisons)
```

#### 1.4 Manual Iteration Flow
```
User creates new iteration by:
  ├─ Clicking "New Rubric" → duplicate current iteration with fresh id
  ├─ Editing criteria in RubricTable
  ├─ Editing feedbackInstructionText textarea
  └─ Clicking "Grade and Compare" → runs grading with new config

No AI-generated revisions needed
```

#### 1.5 Apply Best Settings Flow
```
User Path:
  Select best iteration from history
    ↓ Click "Use This Configuration"
    ↓ Export selected iteration's:
       - criteria: RubricCriterion[]
       - feedbackInstructionText: string
    ↓ Navigate back to prompt-playground
    ↓ Import exported config into main playground config

No backend save needed (state is local to playground)
User can manually save via prompt-playground's save mechanism if desired
```

---

## 2. Data Contracts (Simplified)

### 2.1 Core State Structures

#### PromptIteration (Simplified Definition)
```typescript
interface PromptIteration {
  id: number;                           // Sequential: 1, 2, 3, ...
  name: string;                         // "Rubric 1", "Rubric 2", ...
  criteria: RubricCriterion[];          // Edited rubric criteria
  feedbackInstructionText: string;      // Edited feedback instructions
  gradingResult?: GradingResultData;    // Result from single test essay
  isGrading?: boolean;                  // Loading state during config-applied grading call
}

interface RubricCriterion {
  id: string;
  name: string;
  minScore: number;
  maxScore: number;
  levels: Record<string, string>;       // { "3": "description", "2": "...", ... }
}

interface GradingResultData {
  overallScore: number;
  maxScore: number;
  criteria: Array<{
    name: string;
    score: number;
    maxScore: number;
    feedback: string;
    evidenceQuotes: string[];
  }>;
}
```

#### OptimizationLocationState (Simplified)
```typescript
interface OptimizationLocationState {
  essayText: string;                    // Single test essay
  baseCriteria: RubricCriterion[];      // Initial rubric
  baseFeedbackInstructionText: string;  // Initial feedback instructions
  gradingResult: GradingResultData;     // Baseline grading result
}
```

### 2.2 API Contracts

#### POST /api/gemini (action = "playgroundGrade")
```
Purpose: Grade essays using the grading prompt assembled from the current/edited config

Request:
{
  action: "playgroundGrade",
  payload: {
    essayText: string,
    criteria: Array<{
      name: string,
      scoreRange: { min: number, max: number }
    }>,
    promptSlots: {
      lengthInstruction: string,
      toneInstruction: string,
      englishLevelInstruction: string,
      justificationStructureInstruction: string
    },
    styleOverrides: {
      lengthPreset?: "short" | "medium" | "long",
      tonePreset?: "encouraging" | "balanced" | "strict",
      englishLevelPreset?: "simple" | "standard" | "advanced"
    },
    assessmentType: "flow" | "bullets"
  }
}

Response:
{
  overallScore: number,
  maxScore: number,
  criteria: Array<{
    name: string,
    score: number,
    maxScore: number,
    feedback: string,
    evidenceQuotes: string[]
  }>
}

Error Response:
{ error: string }

Implementation:
- Build prompt from edited config fields (prompt slots + style + criteria ranges)
- Use Gemini API to grade essay against that derived prompt
- Extract evidence quotes from essay text
```

#### POST /api/gemini (action = "playgroundOptimizeConfig")
```
Purpose: Let the designer LLM revise config content using user feedback.

Request:
{
  action: "playgroundOptimizeConfig",
  payload: {
    currentConfig: BuilderPromptConfig,
    feedback: string
  }
}

Response:
{
  result: {
    revisedConfig: BuilderPromptConfig
  }
}
```

**Note**: The optimizer loop is: user feedback -> designer LLM revises config -> run grading using revised config -> compare older/newer grading performance.

### 2.3 Simplified State & Workflow

#### PromptPlaygroundState (Extended with testing features)
```typescript
// Core playground config (unchanged)
export interface PromptPlaygroundState {
  academicLevel: string;
  subject: string;
  assignmentDesc: string;
  feedbackInstructionText: string;     // NEW: For simplified feedback control
  criteria: RubricCriterion[];
  // ... other fields
}

// Extended for testing/iteration
interface TestingState {
  testEssayText: string;               // Single test essay
  testIterations: PromptIteration[]; // Array of test runs
  selectedIterationIndex: number;      // For comparison display
  baselineGradingResult?: GradingResultData;  // From first test run
  isGrading?: boolean;                 // Loading state during test
  lastTestError?: string;              // Error message if test failed
}

// PromptIteration for testing (simplified)
interface PromptIteration {
  id: number;                          // Incrementing ID
  timestamp: Date;                     // When test was run
  criteria: RubricCriterion[];         // Snapshot of rubric at test time
  feedbackInstructionText: string;     // Snapshot of feedback instructions
  gradingResult: GradingResultData;    // Test output
}
```

#### Simple Workflow
```
1. User enters test essay text in PromptPlayground
2. User edits rubric criteria and/or feedback instructions
3. User clicks "Grade and Compare"
4. UI calls POST /api/gemini with action="playgroundGrade" using prompt/config-derived payload
5. Result displayed + stored as new iteration
6. User can view previous iterations and delta-compare
7. User can revert to any previous iteration's config
8. When satisfied, user saves config to main playground
```

---

## 3. Artifact Transition Mapping

### 3.1 From OptimizationLocation to API Request

Simplified flow: no prompt construction, no full config merging

| Source | Target | Notes |
|---|---|---|
| essayText | request.essayText | Use directly |
| baseCriteria | request.criteria | Use directly (edited in place in iteration) |
| baseFeedbackInstructionText | request.feedbackInstructionText | Use directly (edited in place in iteration) |

### 3.2 API Response → Display

| API Response | UI Display | Notes |
|---|---|---|
| overallScore | Show in results panel | Compare with baseline |
| criteria[].score | Show per-criterion score | Highlight deltas |
| criteria[].feedback | Show in evidence panel | Side-by-side with baseline |
| criteria[].evidenceQuotes | Highlight in essay viewer | Quote extraction proof |

### 3.3 Key Simplifications vs Prompt-Craft

| Prompt-Craft Feature | Simplified Version | Reason |
|---|---|---|
| Full prompt text construction + display | Rubric + feedback instructions only | Playground testing doesn't need full prompt |
| Comparison run (2 prompts, multiple essays) | Single-essay grading only | Focus on rubric/feedback refinement |
| AI-generated revision suggestions | Manual iteration only | Reduce API complexity, user-driven testing |
| Snapshot tracking + run state machine | Direct config-to-grading flow | No comparison needed |
| Prompt section editors | Rubric table + textarea editors | Direct, domain-specific UI |

---

## 4. UI Contracts

### 4.1 Prompt Playground Integration

The optimization flow is embedded within the prompt-playground component. Users access the optimization feature through a new "Test & Refine" tab or button.

```
<PromptPlayground />
├─ Main config editor 
│  └─ [NEW] RubricRefactoredTable Editor
│     ├─ Editable criteria rows (name, minScore, maxScore)
│     └─ Level-range descriptions (dynamic + / - buttons)
│
├─ Test Section
│  ├─ Essay text input (single test essay)
│  ├─ [NEW] FeedbackInstructionsEditor (textarea)
│  ├─ "Grade and Compare" button
│  ├─ Baseline Grading Results (from config-applied grading call)
│  └─ Comparison Panel (delta-highlighted vs baseline)
│
└─ Iteration History (Optional, collapsible section)
   ├─ List of previous test runs
   └─ Each with delta-highlighted results and "Use This" button
```

### 4.2 New UI Components (Simplified)

#### RubricRefactoredTable (Editable Rubric Editor)
```typescript
interface RubricRefactoredTableProps {
  criteria: RubricCriterion[];
  onChange: (criteria: RubricCriterion[]) => void;
  readOnly?: boolean;
  compact?: boolean;
}

// Layout:
//   Header row: Criterion | Min Score | Max Score | Levels Description
//   Data row: Editable input + score spinners + expand/collapse levels editor
//   Levels editor: Dynamic rows for each score level (e.g., 3=Advanced, 2=Proficient, 1=Developing)
//   Actions: +Add row, -Delete row, drag-to-reorder

// Validation:
//   - minScore < maxScore
//   - All levels between min/max defined
//   - Criterion names unique

interface RubricCriterion {
  id: string;
  name: string;
  minScore: number;
  maxScore: number;
  levels: Record<string, string>;  // { "3": "description", "2": "...", ... }
}
```

#### FeedbackInstructionsEditor (Textarea + Token Counter)
```typescript
interface FeedbackInstructionsEditorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}

// Layout:
//   Label: "Feedback Instructions"
//   Textarea: Multi-line editable text
//   Token count: Display estimated tokens (simple: value.length / 4)
//   Help text: "These instructions are sent to the AI grader to customize feedback generation"
//   Styling: Matches rubric table styling (rounded border, gray background)
```

#### SimplifiedGradingResultsPanel (Result Display with Delta Highlighting)
```typescript
interface SimplifiedGradingResultsPanel Props {
  currentResult: GradingResultData;
  baselineResult?: GradingResultData;
  isLoading?: boolean;
  error?: string;
  showDeltaHighlights?: boolean;  // Default: !!baselineResult
  className?: string;
}

// Layout:
//   Test Result Summary:
//     - Overall Score: X / Y
//     - Change indicator: +/- vs baseline (if provided)
//     - Color code: green (improvement), red (decline), gray (same)
//   
//   Criterion Breakdown:
//     For each criterion:
//       - Name
//       - Score: X / Y (with delta highlight)
//       - Feedback text (with quote extraction proof)
//       - Evidence quotes (highlighted in essay viewer)
//   
//   Comparison View:
//     If baselineResult provided:
//       - Side-by-side score columns
//       - Delta highlighting in feedback
//       - Score change badge

// Styling:
//   - Score boxes: rounded border, bg-blue-100 text-blue-900
//   - Positive delta: green highlight
//   - Negative delta: red highlight
//   - Feedback text: gray-700 background, italic quotes
```

#### IterationHistoryCard (Previous Test Result Summary)
```typescript
interface IterationHistoryCardProps {
  iteration: PromptIteration;
  baselineResult?: GradingResultData;
  onSelect: (iteration: PromptIteration) => void;
  isSelected?: boolean;
  showDeltaHighlights?: boolean;
}

// Layout:
//   Header:
//     <> Iteration #{Id} "Rubric {N}"
//     [Use This Configuration] button
//   
//   Rubric Changes:
//     - Show criteria changes in diff view (name, score ranges)
//   
//   Result Preview:
//     - Overall score delta badge
//     - Top 3 criteria deltas
//   
//   Result Details (collapsible):
//     - Full SimplifiedGradingResultsPanel

// Actions:
//   - Click row → select iteration (highlight)
//   - Click "Use This Configuration" → export config to parent editor
```

### 4.3 Interactive Controls & Conditions

#### Feedback Composer Tag Groups
```
Category 1: Scoring preferences
  [] Be more strict → instruction (3 sentences)
  [] Be more lenient → instruction (3 sentences)
  [] Better distinguish between performance levels → instruction (3 sentences)

Category 2: Feedback style
  [] Give more actionable suggestions → instruction (3 sentences)
  [] Include more encouraging language → instruction (3 sentences)
  [] Be more critical when needed → instruction (3 sentences)

Behavior:
  - Toggles are independent (multi-select allowed)
  - Each toggle appends full instruction paragraph if not present
  - Clicking again removes instruction by exact match
  - Freeform textarea allows combining tags + custom text
  - All tags visible simultaneously (not dropdown)
```

#### Essay Selection Dropdown (Run Comparison)
```
Trigger: In each Iteration card (render only if iterations.length > 1)
Options: selectedEssays (first 3 selected by default)
  Value: essayId
  Label: essay.title || essay.label || "Essay"
Selected: iteration.selectedEssayId || selectedEssayIds[0] || ""

onChange Handler: updateIterationEssay(iteration.id, essayId)
  → Updates selectedEssayId + populates gradingResult from cache
```

#### Run Button (State-Driven Label)
```
Props:
  onClick: () => runComparisonPair(olderIterIndex, newerIterIndex, essayId, essayText)
  disabled: runButtonState === "running" || runButtonState === "completed_clean" || !selectedEssayForRun

Label Mapping:
  "idle" → "Run"
  "running" → "Grading..." (with spinner)
  "completed_clean" → "Finish Grading" (disabled, checkmark)
  "completed_dirty" → "Run" (enabled, config/essay changed)

Styling: Primary button, h-11 w-full, spinner icon on loading
```

#### Iteration Selection Radio Group (Save Footer)
```
Conditional: iterations.length > 1
Radio buttons: one per iteration (id=iteration.id)
  Label: iteration.name (e.g., "Prompt 2")
  Badge: Show "Revised" if iteration.revisionRationale exists

Controlled: value={applyVersion}, onChange={setApplyVersion}
Auto-default: Once iterations.length > 1 && !applyVersion, set to newest id
```

### 4.4 Sticky CTA Behavior

```
Save Footer (Assumed from PromptOptimization.tsx):
  Position: sticky bottom-0 z-30
  Background: bg-background/95 backdrop-blur
  Border: border-t
  Padding: py-4 px-6

Content:
  ├─ Iteration selector (radio group or dropdown)
  │  Label: "Save as Version"
  │  Controlled: applyVersion
  │
  └─ Button
     onClick: handleConfirmVersion()
     States:
       - Idle: "Save & Use This Version"
       - Disabled if: !applyVersion (no selection)
       - Loading if: saveVersionMutation.isPending
       - Success: Navigate to /builder
       - Error: Toast, remain on optimization page

Auto-Scroll Targeting:
  pendingScrollTarget = { type, iterationId }
  After new iteration created or comparison completed:
    ├─ Smooth scroll to referenced element
    └─ Only if not already visible in viewport
```

---

## 5. Simplified Async Workflow

```
Timeline Diagram:

INITIAL LOAD (useEffect)
  ├─ location.state present?
  │  ├─ YES: Extract versionConfig, importedResults
  │  │   ├─ Build promptText via buildVisiblePromptText(versionConfig)
  │  │   ├─ Create iterations[0]:
  │  │   │  - id=1, hasRun=true, gradingResults=importedResults.gradingResults
  │  │   │  - comparisonResults = indexed cache
  │  │   └─ setSelectedEssayIds(first 3)
  │  └─ NO: Render empty state, offer back button
  │
  └─ NO POLLING OR STREAMING

ITERATION CYCLE (User provides feedback → new iteration)

  Phase 1: Feedback Entry
    └─ User inputs feedback (freeform, tags, or both)
       └─ updateFeedback(iterationId, value) → local setState

  Phase 2: Generate Revision
    └─ User clicks "Generate Revision"
       ├─ Validation: feedback.trim() required
       ├─ setIterations(..., isGeneratingRevision=true)
       │
       └─ applyOptimizationFeedback({
            baseConfig: iteration.promptConfig,
            userFeedback: iteration.feedback
          })
          │
          ├─ POST /api/gemini (action="playgroundOptimizeConfig")
          │  Propagation: 500-3000ms (network + LLM)
          │  Retry: none (single attempt)
          │
          └─ Response: OptimizationApplyResponse
             ├─ onSuccess:
             │  1. Build nextIteration with new id (sequential)
             │  2. Merge baseConfig + revisedConfig
             │  3. Generate newPromptText
             │  4. Append to iterations
             │  5. setPendingScrollTarget({ type: "iteration", id: nextId })
             │  6. Toast success message (include summary)
             │  7. Clear isGeneratingRevision flag
             │
             └─ onError:
                1. Toast error
                2. Clear isGeneratingRevision flag
                3. Retain feedback in textarea (no auto-clear)

COMPARISON FLOW (Newer iteration vs older, single essay)

  Phase 1: Essay Selection
    └─ updateIterationEssay(iterationId, essayId)
       └─ local setState: iteration.selectedEssayId

  Phase 2: Run Comparison
    └─ Click "Run" (button state: "idle" or "completed_dirty")
       ├─ Validation: essayId, essayText, promptSetId, indices
       ├─ Build RunInputSnapshot (for state machine tracking)
       ├─ setIterations(..., isGrading=true on both)
       │
       └─ Promise.all([
            olderIteration.comparisonResults[essayId] cached
              ? Promise.resolve(cached)
              : gradeWithConfig(promptSetId, olderConfig, essayText),
            gradeWithConfig(promptSetId, newerConfig, essayText)
          ])
          │
          ├─ Two requests (or one if cached):
          │  POST /api/gemini (action="playgroundGrade")
          │  Request: { essayText, criteria, promptSlots, styleOverrides, assessmentType }
          │  Response: { overallScore, maxScore, criteria[] }
          │  Propagation: 1000-5000ms per request (LLM inference)
          │
          └─ Response: [GradingResultData, GradingResultData]
             ├─ onSuccess:
             │  1. Cache olderResult in olderIteration.comparisonResults[essayId]
             │  2. Cache newerResult in newerIteration.comparisonResults[essayId]
             │  3. newerIteration.lastCompletedRunSnapshot = currentSnapshot
             │  4. newerIteration.hasRun = true
             │  5. setIterations({ isGrading=false })
             │  6. setPendingScrollTarget({ type: "grading-results", id: newerIteration.id })
             │  7. setFeedbackOpenByIteration[newerIteration.id] = true
             │  8. Display results in newIteration card
             │
             └─ onError:
                1. Toast error
                2. Clear isGrading flag
                3. Retain all data
                4. User may retry with same essay or select new one

SAVE-AND-RETURN (Version persistence)

  Phase 1: Select Iteration
    └─ Radio group: applyVersion = String(iteration.id)
       └─ Auto-default to newest if not set (one-time on iterations.length > 1)

  Phase 2: Confirm and Save
    └─ Click "Save & Use This Version"
       ├─ Validation: selectedIteration found, applyVersion set
       ├─ Extract promptConfig from selectedIteration
       │
       └─ saveVersionMutation.mutate({
            name, description, academicLevel, subject, assignmentDesc,
            feedbackText, additionalMaterial, additionalDescription,
            criteria (mapped), promptContentOverride
          })
          │
          ├─ POST /api/prompt-sets/{promptSetId}/versions
          │  Request: createVersion payload
          │  Propagation: 500-2000ms (DB + async validation)
          │  Content-Type: application/json
          │
          └─ Response: { id: string, created_at: string }
             ├─ onSuccess:
             │  1. queryClient.refetchQueries(["prompt-set", promptSetId])
             │  2. Toast: "Version saved"
             │  3. navigate(`/builder/${promptSetId}`, {
             │       state: { returnedFromOptimization: true, builderEssays }
             │     })
             │  4. Unload PromptOptimization, load PromptBuilder
             │
             └─ onError:
                1. Toast error: "Failed to save optimized version"
                2. Remain on optimization page
                3. Retry available
                4. User can manually refetch or navigate back
```

---

## 6. Migration Risks

### 6.1 Hidden Coupling

#### Location State Dependency
- **Risk**: PromptOptimization page **requires** `location.state.versionConfig` + `location.state.importedResults`
- **Impact**: Direct navigation to `/optimize/:id` (bookmarking, deep linking) will fail silently → empty state
- **Mitigation**: Validate location state early; either:
  - Rewrite to fetch versionConfig from backend if not in state
  - Enforce navigation through PromptBuilder (passing state via navigate)
  - Add fallback redirect if state missing

#### Prompt Signature Caching (Run Button State)
- **Risk**: `getPromptSignature() = JSON.stringify(config)` is fragile
  - Property order in config object affects signature (JSON.stringify is stable in V8 but not spec-guaranteed for property iteration order)
  - Empty objects, null vs undefined, nested structure changes all affect signature
  - No versioning: future config schema changes will invalidate all cached snapshots
- **Impact**: Run button state machine may behave unpredictably after schema evolution
- **Mitigation**: Use stable hash (e.g., crypto.subtle.digest() or murmurhash) or serialize with stable property order

#### Comparison Results Cache Keying
- **Risk**: `comparisonResults: Record<essayId, GradingResultData>` keyed only by essayId
  - If same essay re-graded with different config between iterations, old cache entry is silently replaced
  - No multi-iteration caching: results for (essay, iter1, iter2) are not cached, only (essay)
- **Impact**: Memory leak risk if many essays × iterations, and potential correctness issues if UI assumes immutable cache
- **Mitigation**: Cache key should include iteration tuple: `comparisonResults: { [essayId]: { [iterPair]: GradingResultData } }`

#### Run Count Hard-Coded
- **Risk**: `selectedRunCount: "1"` is literal in snapshot → not used, but if future feature implements count selection, snapshot logic breaks
- **Impact**: Snapshot comparison will incorrectly match runs if count selection added
- **Mitigation**: Document why count is not variable; if feature added, must update snapshot serialization

### 6.2 API Contract Assumptions

#### Optimization Apply Endpoint Structure
- **Risk**: Response from `/optimize/apply` is assumed to merge cleanly with baseConfig
  - Server may return partial revisedConfig; fields not present default to baseConfig values
  - Type mismatch e.g., criteria array order, missing levels → silent failures
- **Impact**: Revised prompt may have inconsistent criteria structure, breaking subsequent grading
- **Mitigation**: Validate revisedConfig response schema; merge with explicit field mapping, not spread

#### Grade-with-Config Inference from Prompt Config
- **Risk**: `promptConfig` is not typed strictly; server infers grading schema (criteria definitions, score ranges) from config
  - No validation that config is well-formed for grading (missing criterion id, invalid score range, etc.)
- **Impact**: Silent grading failures or hallucinated results if config malformed
- **Mitigation**: Add client-side schema validation before sending grade-with-config; ensure all criteria have required fields

#### Version Creation Prompt Override
- **Risk**: `promptContentOverride` is optional in createVersion request, but UI assumes it's saved
  - Server may ignore override and regenerate prompt from config fields
  - No confirmation mechanism
- **Impact**: Saved version may have different prompt than what was optimized
- **Mitigation**: After version creation, refetch and verify promptContentOverride was persisted; or add server confirmation in response

### 6.3 UI State Synchronization Pitfalls

#### Iteration History Indexing
- **Risk**: UI uses `iterIndex + 1` to refer to iteration history after `slice(1)`
  - If user implements manual iteration deletion/reordering, indices become stale
  - Component uses `iterations.findIndex()` to map operations, but ref tracking uses `iteration.id`
- **Impact**: Scroll-to-target may fail for deleted iterations; comparison pair operations may operate on wrong iterations
- **Mitigation**: Always use `iteration.id` as source of truth; rebuild indices on render, don't cache

#### Comparison Open Sections Memoization
- **Risk**: `comparisonOpenSectionsByIteration: Record<iterationId, string[]>` is populated lazily via `getComparisonOpenSections()`
  - This function compares old/new prompt structures and infers which changed
  - If inference logic is wrong (e.g., misses rubric criterion with same name but different levels), sections won't expand
- **Impact**: User may not notice what actually changed in a revision
- **Mitigation**: Precompute open sections immediately on iteration creation; expose diff detection as testable pure function

#### Feedback Textarea Normalization
- **Risk**: Tag append/remove uses paragraph-based normalization (split on `\n\n`)
  - User freeform text may use single `\n`, inconsistent spacing, or block quotes
  - Deduplication by exact `.trim()` match may fail if whitespace differs
- **Impact**: Tags can duplicate if user's formatting doesn't match stored instruction exactly; or tags may not remove
- **Mitigation**: Normalize all text in feedback composer (trim each paragraph, normalize newlines to `\n\n` on enter)

#### Scroll Target Ref Management
- **Risk**: `iterationCardRefs.current[iteration.id] = node` may be null if element unmounts
  - useEffect assumes element is available synchronously; if layout shift happens, element may not be in viewport when scroll fires
  - No fallback if element not found → silent scroll miss
- **Impact**: User feedback about revisions may be missed if new iteration scrolls out of view due to re-renders
- **Mitigation**: Implement mutation observer or visibility API to detect when element appears; retry scroll if element null on first attempt

### 6.4 Mock Data / Offline Mode

#### Mock Grade-with-Config Always Returns Same Result
- **Risk**: `generateMockRunResult(0)` is deterministic per-seed; comparing two different configs grades to identical results
  - User sees no difference between old/new prompts when working offline
- **Impact**: Optimization feedback seems ineffective when testing without backend
- **Mitigation**: Pass iteration index or config hash to generateMockRunResult to vary output; surface warning that mock mode is active

#### Mock Suggestion Generation Unused
- **Risk**: `generateOptimizationSuggestions` is not called by PromptOptimization UI
  - Parameter `suggestions` in PromptIteration is never populated or displayed
- **Impact**: Dead code; future feature expecting suggestions will fail silently
- **Mitigation**: Either wire suggestions API into UI (add suggestion display below feedback) or remove dead code

### 6.5 Performance Concerns

#### Promise.All on Comparison Grading
- **Risk**: Two sequential grading calls in Promise.all may timeout if server is slow
  - No request timeout; browser default (~30-60s) may be too lenient for UX
- **Impact**: User stuck in "Grading..." state indefinitely if one request hangs
- **Mitigation**: Add AbortController with 10-15s timeout per request; toast user if timeout; allow retry

#### Large Essay Arrays
- **Risk**: `selectedEssayEntries.map()` + grid layout supports up to ~10 essays, but importedResults could have 100+
  - Iteration history renders side-by-side PromptSectionsEditor ×4 sections ×N iterations = O(N) DOM nodes
- **Impact**: Slow scroll; memory leak if iterations accumulate
- **Mitigation**: Virtualize iteration history; limit essays displayed to 5-10; lazy-load prompt sections inside collapsed containers

---

## 7. Minimal Acceptance Tests

### 7.1 Feature Completeness Tests

#### Test: Load Optimization Page with Location State
```
Given: Navigate to /optimize/:id with location.state={ versionConfig, importedResults, promptSetId, promptVersionId }
When: Page loads
Then:
  ✓ iterations[0] created with hasRun=true
  ✓ Current Prompt panel shows promptConfig sections (readOnly)
  ✓ Grading Results panel shows essays + results grid
  ✓ First 3 essays pre-selected in selectedEssayIds
  ✓ Feedback Composer visible with empty textarea
  ✓ "Generate Revision" button disabled if feedback empty
```

#### Test: Generate Revision from Feedback
```
Given: iterations[0] with feedback textarea ready
When: User types "Be more strict" (or selects tag), clicks "Generate Revision"
Then:
  ✓ isGeneratingRevision=true (spinner shows, button disabled)
  ✓ POST /api/gemini called with action="playgroundOptimizeConfig" and { currentConfig, feedback }
  ✓ Server returns revisedConfig + summary
  ✓ iterations[1] created with id=2, name="Prompt 2", hasRun=false
  ✓ promptConfig merged (baseConfig fields + revisedConfig fields)
  ✓ promptText regenerated via buildVisiblePromptText
  ✓ revisionRationale = response.summary
  ✓ userFeedback = original feedback text
  ✓ Iteration History section appears (because iterations.length > 1)
  ✓ Toast: "Revision generated"
  ✓ Scroll to new iteration (smooth scroll if off-screen)
```

#### Test: Compare Prompts with Run
```
Given: iterations[0] and iterations[1] exist; essay selected; no prior run
When: Click "Run" button in iterations[1] card
Then:
  ✓ isGrading=true on both iterations
  ✓ Run button disabled + shows "Grading..."
  ✓ Two POST /api/gemini calls with action="playgroundGrade" (or one cached)
  ✓ Both resolve with GradingResultData
  ✓ comparisonResults[essayId] populated on both iterations
  ✓ iterations[1].lastCompletedRunSnapshot = current snapshot
  ✓ iterations[1].hasRun=true
  ✓ isGrading=false after success
  ✓ Grading results appear in iteration card (side-by-side or collapsed)
  ✓ Run button state changes to "completed_clean" (show "Finish Grading", disabled)
```

#### Test: Run Button State Machine
```
Scenario 1: No Prior Run
  ├─ runButtonState = "idle"
  └─ Button: "Run" (enabled)

Scenario 2: Running
  ├─ isGrading=true
  └─ Button: "Grading..." (disabled, spinner)

Scenario 3: Completed, No Changes
  ├─ lastCompletedSnapshot === currentSnapshot
  └─ Button: "Finish Grading" (disabled, checkmark)

Scenario 4: Completed, Config Changed
  ├─ lastCompletedSnapshot !== currentSnapshot
  └─ Button: "Run" (enabled)

Scenario 5: No Essay Selected
  ├─ !selectedEssayForRun
  └─ Button: disabled regardless of other state
```

#### Test: Save Version and Navigate
```
Given: iterations[1] has been created and run; user selects Prompt 2 in save radio group
When: Click "Save & Use This Version"
Then:
  ✓ applyVersion="2"
  ✓ POST /api/prompt-sets/{promptSetId}/versions called
  ✓ Payload includes: name, description, criteria (mapped), promptContentOverride
  ✓ Server returns { id, created_at }
  ✓ queryClient.refetchQueries(["prompt-set", promptSetId])
  ✓ navigate(`/builder/${promptSetId}`, { state: { returnedFromOptimization: true, builderEssays } })
  ✓ PromptBuilder page loads (or previous state restored)
  ✓ Toast: "Version saved"
```

### 7.2 Data Integrity Tests

#### Test: Prompt Config Merge on Revision
```
Given:
  baseConfig = { academicLevel: "masters", subject: "CS", criteria: [{ id: "1", name: "Logic" }] }
  revisedConfig = { criteria: [{ id: "1", name: "Logic", description: "..." }] }
When: New iteration created from response
Then:
  ✓ promptConfig.academicLevel = "masters" (from base, not in revised)
  ✓ promptConfig.subject = "CS" (from base)
  ✓ promptConfig.criteria = revisedConfig.criteria (overwrite if present)
  ✓ All fields consistently typed
```

#### Test: Section Comparison Change Detection
```
Given: iterations[0].promptConfig vs iterations[1].promptConfig differ in feedbackText
When: getComparisonOpenSections(id, olderSections, newerSections)
Then:
  ✓ Detects "output" section is changed (feedbackText ≠)
  ✓ Returns ["output"] in openSections
  ✓ Output section expanded in PromptSectionsEditor comparison
```

#### Test: Essay Result Alignment
```
Given: importedResults.essays[0] has id="essay-1"; gradingResults[0] is result for title="Essay A"
When: selectedEssayIds includes "essay-1"
Then:
  ✓ selectedEssayEntries maps essay.id → correct gradingResult by index
  ✓ Display shows paired essay + result
  ✓ No orphaned results (all have matching essay)
```

### 7.3 Error Handling Tests

#### Test: Missing Location State
```
Given: User navigates to /optimize/:id without location.state
When: PromptOptimization renders
Then:
  ✓ Renders "No data" fallback message
  ✓ Shows "Back" button to return to builder
  ✓ No crash; graceful error handling
```

#### Test: Grade-with-Config API Failure
```
Given: iterations[0] and [1] ready; user clicks Run
When: POST /optimize/grade-with-config returns 500 error
Then:
  ✓ isGrading=false on both (cleared in catch)
  ✓ Toast: "Comparison failed: [error message]"
  ✓ Results not cached (comparisonResults unchanged)
  ✓ User can retry with same essay or select new one
  ✓ No partial state (both iterations cleared simultaneously)
```

#### Test: Apply Feedback Timeout
```
Given: User submits feedback; POST /optimize/apply hangs >15s
When: Request times out (AbortController or server delay)
Then:
  ✓ isGeneratingRevision=false
  ✓ Toast error: "Revision generation failed: timeout or network error"
  ✓ Feedback textarea retains user's text (not auto-cleared)
  ✓ User can retry or modify feedback
```

#### Test: Save Version with Invalid Config
```
Given: iterations[1].promptConfig has malformed criteria (missing id)
When: User clicks "Save & Use This Version"
Then:
  ✓ POST /api/prompt-sets/.../versions sent
  ✓ Server validation error: 400 Bad Request
  ✓ onError catches, Toast: "Failed to save optimized version"
  ✓ User remains in optimization view
  ✓ Can review/edit criteria in PromptSectionsEditor before retry
```

### 7.4 UX Behavior Tests

#### Test: Feedback Tag Composition
```
Given: FeedbackComposer with empty textarea
When: Click "Be more strict" tag + Click "Give more actionable suggestions" tag
Then:
  ✓ Both instructions appended to textarea (separated by \n\n)
  ✓ Both tags show selected visual (dark background)
  ✓ User can edit combined text in textarea
  ✓ Click tag again → removes instruction (deduplicated removal)
  ✓ Textarea can be manually edited independently of tags
```

#### Test: Essay Selection Persistence
```
Given: iterations[1] with selectedEssayId=undefined
When: User selects essay from dropdown (e.g., "Essay 2")
Then:
  ✓ iteration.selectedEssayId = "essay-2"
  ✓ gradingResult populated from comparisonResults if cached
  ✓ Run button enabled (if not already running)
  ✓ Switching to different essay: selectedEssayId changes, new gradingResult loaded
```

#### Test: Scroll to New Iteration
```
Given: iterations[0] visible; user generates revision
When: iterations[1] created; setPendingScrollTarget({ type: "iteration", iterationId: 2 })
Then:
  ✓ After 80ms timeout, smooth scroll to iterations[1] card
  ✓ If already visible (top >= 96px, top <= 70% viewport), skip scroll
  ✓ Scroll clears pendingScrollTarget
  ✓ User sees new iteration without manual scroll
```

---

## 8. Minimal Example: Feature Extraction Checklist

### What to Port to AI-Grading-Assistant

```
✓ PromptOptimization.tsx (main page component)
  ├─ State: iterations, applyVersion, selectedEssayIds, UI toggles
  ├─ Mutations: applyFeedbackMutation, saveVersionMutation
  ├─ Effects: initialization, auto-select newest, scroll targeting
  └─ Render: header, two-column layout, feedback composer, iteration history

✓ PromptSectionsEditor.tsx (reusable editor + comparison)
  ├─ Sections model (roleTask, context, rubric, output)
  ├─ configToSections() / sectionsToConfigPatch() converters
  ├─ Diff highlighting + word-level comparison
  └─ Editable rubric table, optional field toggles

✓ API Endpoints (in lib/api.ts)
  ├─ applyOptimizationFeedback(promptSetId, promptVersionId, baseConfig, userFeedback)
  ├─ gradeWithConfig(promptSetId, promptConfig, essayText)
  └─ createVersion() wrapper

✓ Types (lib/types/optimization.ts)
  ├─ PromptIteration, VersionConfig, OptimizationLocationState
  ├─ OptimizationApplyRequest/Response, ComparisonGradingRequest
  └─ GradingResultData (reuse if available)

✓ Utilities
  ├─ buildVisiblePromptText() - prompt assembly
  ├─ buildRunSnapshot(), isSameRunSnapshot() - run state machine
  ├─ deriveRunButtonState() - button label logic
  ├─ getPromptSignature() - config hashing (consider replacing)
  ├─ FeedbackTag groups + string normalization functions
  └─ computeWordDiff() from lib/diffUtils (for highlighting)

✗ Don't Port (project-specific):
  ├─ React Router routing (adjust to your navigation model)
  ├─ UI component framework (use your existing components)
  ├─ Mock data (implement fallback for your API)
  └─ GradingResults component (may need adaptation)
```

---

## End of Blueprint

This migration blueprint captures the Prompt Optimization feature's exact structure, dependencies, and workflows without prescribing implementation changes. Use it as a reference for:

1. **Backend Implementation**: Implement the three core endpoints (optimize/apply, optimize/grade-with-config, versions)
2. **Frontend Port**: Adapt components to use your UI library and routing
3. **Integration Testing**: Use minimal acceptance tests to validate parity
4. **Risk Mitigation**: Address hidden coupling (location state, signature hashing, cache keying) early
