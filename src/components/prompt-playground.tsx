'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  FlaskConical,
  Info,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  generatePreviewPrompt,
  type PromptConfig,
  type RubricCriterion,
} from '@/lib/prompt-assembly';
import {
  getDefaultEnglishInstruction,
  getDefaultLengthInstruction,
  getDefaultToneInstruction,
  type EditablePromptSlots,
  type FeedbackStyleConfig,
} from '@/lib/grading-prompt-system';
import {
  comparePlaygroundGrades,
  gradePlaygroundWithConfig,
  optimizePlaygroundConfig,
} from '@/lib/gemini-service';

const SETS_STORAGE_KEY = 'prompt-playground-sets-v2';
const ACTIVE_SET_KEY = 'prompt-playground-active-set-id-v2';
const ORIGINAL_CONFIG_OPTION = '__original_config__';

type PlaygroundView = 'dashboard' | 'builder' | 'optimizer';

type FeedbackFormat = 'paragraph' | 'bullets';

type FeedbackBehaviorConfig = {
  lengthPreset: FeedbackStyleConfig['lengthPreset'];
  tonePreset: FeedbackStyleConfig['tonePreset'];
  englishLevelPreset: FeedbackStyleConfig['englishLevelPreset'];
  format: FeedbackFormat;
};

type BuilderPromptConfig = PromptConfig & {
  feedbackBehavior?: FeedbackBehaviorConfig;
  feedbackInstructionText?: string;
};

const DEFAULT_FEEDBACK_BEHAVIOR: FeedbackBehaviorConfig = {
  lengthPreset: 'medium',
  tonePreset: 'balanced',
  englishLevelPreset: 'standard',
  format: 'paragraph',
};

const LENGTH_TAG_OPTIONS: Array<{ value: FeedbackStyleConfig['lengthPreset']; label: string }> = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long (detailed)' },
];

const TONE_TAG_OPTIONS: Array<{ value: FeedbackStyleConfig['tonePreset']; label: string }> = [
  { value: 'direct', label: 'Strict' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'supportive', label: 'Encouraging' },
];

const WORDING_TAG_OPTIONS: Array<{ value: FeedbackStyleConfig['englishLevelPreset']; label: string }> = [
  { value: 'simple', label: 'Simple' },
  { value: 'standard', label: 'Standard' },
  { value: 'advanced', label: 'Advanced' },
];

const OPTIMIZER_FEEDBACK_TAGS: Array<{
  group: 'scoring' | 'feedback';
  label: string;
  instruction: string;
}> = [
  {
    group: 'scoring',
    label: 'Be more strict',
    instruction:
      'Apply stricter scoring for weak evidence quality and weak reasoning. Do not award high scores unless the evidence is specific and well-explained.',
  },
  {
    group: 'scoring',
    label: 'Be more lenient',
    instruction:
      'Be slightly more forgiving when the essay demonstrates partial understanding. Reward reasonable attempts even if execution is not fully polished.',
  },
  {
    group: 'scoring',
    label: 'Better distinguish levels',
    instruction:
      'Differentiate adjacent score levels more clearly. Reserve top scores for consistently strong performance and use middle scores for mixed quality.',
  },
  {
    group: 'feedback',
    label: 'More actionable suggestions',
    instruction:
      'Provide practical next-step suggestions the student can apply immediately. Use concrete actions tied to specific weaknesses.',
  },
  {
    group: 'feedback',
    label: 'More encouraging language',
    instruction:
      'Use constructive and encouraging language while remaining honest about weaknesses. Balance criticism with brief recognition of strengths.',
  },
  {
    group: 'feedback',
    label: 'More critical when needed',
    instruction:
      'Use direct critical language when important rubric expectations are missing. Avoid softening serious issues.',
  },
];

const PREDEFINED_RUBRIC: RubricCriterion[] = [
  {
    id: 'test-1',
    name: 'Ideas',
    minScore: 0,
    maxScore: 3,
    levels: {
      '3': 'Tells a story with ideas that are clearly focused on the topic and are thoroughly developed with specific, relevant details.',
      '2': 'Tells a story with ideas that are somewhat focused on the topic and are developed with a mix of specific and/or general details.',
      '1': 'Tells a story with ideas that are minimally focused on the topic and developed with limited and/or general details.',
      '0': 'Ideas are not focused on the task and/or are undeveloped.',
    },
  },
  {
    id: 'test-2',
    name: 'Organization',
    minScore: 0,
    maxScore: 3,
    levels: {
      '3': 'Organization and connections between ideas and/or events are clear and logically sequenced.',
      '2': 'Organization and connections between ideas and/or events are logically sequenced.',
      '1': 'Organization and connections between ideas and/or events are weak.',
      '0': 'No organization evident.',
    },
  },
  {
    id: 'test-3',
    name: 'Style',
    minScore: 0,
    maxScore: 3,
    levels: {
      '3': 'Command of language, including effective and compelling word choice and varied sentence structure, clearly supports the writer\'s purpose and audience.',
      '2': 'Adequate command of language, including effective word choice and clear sentences, supports the writer\'s purpose and audience.',
      '1': 'Limited use of language, including lack of variety in word choice and sentences, may hinder support for the writer\'s purpose and audience.',
      '0': 'Ineffective use of language for the writer\'s purpose and audience.',
    },
  },
  {
    id: 'test-4',
    name: 'Conventions',
    minScore: 0,
    maxScore: 3,
    levels: {
      '3': 'Consistent, appropriate use of conventions of Standard English for grammar, usage, spelling, capitalization, and punctuation for the grade level.',
      '2': 'Adequate use of conventions of Standard English for grammar, usage, spelling, capitalization, and punctuation for the grade level.',
      '1': 'Limited use of conventions of Standard English for grammar, usage, spelling, capitalization, and punctuation for the grade level.',
      '0': 'Ineffective use of conventions of Standard English for grammar, usage, spelling, capitalization, and punctuation.',
    },
  },
];

type PromptVersion = {
  id: string;
  name: string;
  createdAt: string;
  config: BuilderPromptConfig;
};

type OptimizationIteration = {
  id: string;
  createdAt: string;
  feedback: string;
  baselineVersionId: string | null;
  baselineConfig: BuilderPromptConfig;
  revisedConfig: BuilderPromptConfig;
};

type IterationComparison = {
  baseline: TestResult[];
  revised: TestResult[];
};

type EditableSet = {
  id: string;
  name: string;
  config: BuilderPromptConfig;
  configured: boolean;
  updatedAt: string;
  versions: PromptVersion[];
  currentVersionId: string | null;
  optimizationIterations: OptimizationIteration[];
};

interface TestResult {
  criterionName: string;
  justification: string[];
  evidenceQuotes: { quote: string }[];
  score: number;
}

type PlaygroundRunMode = 'parity';

type RunMetadata = {
  mode: PlaygroundRunMode;
  importable: boolean;
};

type RunMetrics = {
  mean: number;
  min: number;
  max: number;
  stdDev: number;
};

type CriterionMetric = {
  criterionName: string;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
};

type EssayItem = {
  id: string;
  text: string;
};

type GradeRunResult = {
  results: TestResult[];
  metadata: RunMetadata;
};

const makeDefaultConfig = (): BuilderPromptConfig => ({
  academicLevel: '',
  subject: '',
  assignmentDesc: '',
  feedbackText: 'Be specific and constructive. Reference evidence from the text.',
  criteria: [
    {
      id: crypto.randomUUID(),
      name: '',
      minScore: 0,
      maxScore: 3,
      levels: { '3': '', '2': '', '1': '', '0': '' },
    },
  ],
  showAdditionalMaterial: false,
  additionalMaterial: '',
  showAdditionalDescription: false,
  additionalDescription: '',
  feedbackBehavior: { ...DEFAULT_FEEDBACK_BEHAVIOR },
  feedbackInstructionText: '',
});

const cloneConfig = (c: BuilderPromptConfig): BuilderPromptConfig => JSON.parse(JSON.stringify(c)) as BuilderPromptConfig;

const getConfigSignature = (config: BuilderPromptConfig): string => JSON.stringify(config);

const cloneVersion = (v: PromptVersion): PromptVersion => ({ ...v, config: cloneConfig(v.config) });

const createVersion = (config: BuilderPromptConfig, index: number): PromptVersion => ({
  id: crypto.randomUUID(),
  name: `Version ${index}`,
  createdAt: new Date().toISOString(),
  config: cloneConfig(config),
});

function normalizeSet(raw: EditableSet): EditableSet {
  const fallback = makeDefaultConfig();
  const config: BuilderPromptConfig = {
    ...fallback,
    ...(raw.config || fallback),
    criteria: Array.isArray(raw.config?.criteria) && raw.config.criteria.length > 0
      ? raw.config.criteria
      : fallback.criteria,
    feedbackBehavior: {
      ...DEFAULT_FEEDBACK_BEHAVIOR,
      ...((raw.config as BuilderPromptConfig | undefined)?.feedbackBehavior || {}),
    },
    feedbackInstructionText:
      typeof (raw.config as BuilderPromptConfig | undefined)?.feedbackInstructionText === 'string'
        ? ((raw.config as BuilderPromptConfig | undefined)?.feedbackInstructionText as string)
        : '',
  };

  const rawVersions = Array.isArray((raw as Partial<EditableSet>).versions)
    ? ((raw as Partial<EditableSet>).versions as PromptVersion[])
    : [];

  const versions = rawVersions
    .map((version, index) => ({
      id: version.id || crypto.randomUUID(),
      name: version.name || `Version ${index + 1}`,
      createdAt: version.createdAt || new Date().toISOString(),
      config: {
        ...fallback,
        ...(version.config || fallback),
        criteria:
          Array.isArray(version.config?.criteria) && version.config.criteria.length > 0
            ? version.config.criteria
            : fallback.criteria,
        feedbackBehavior: {
          ...DEFAULT_FEEDBACK_BEHAVIOR,
          ...((version.config as BuilderPromptConfig | undefined)?.feedbackBehavior || {}),
        },
        feedbackInstructionText:
          typeof (version.config as BuilderPromptConfig | undefined)?.feedbackInstructionText === 'string'
            ? ((version.config as BuilderPromptConfig | undefined)?.feedbackInstructionText as string)
            : '',
      },
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const currentVersionId =
    (raw as Partial<EditableSet>).currentVersionId &&
    versions.some((version) => version.id === (raw as Partial<EditableSet>).currentVersionId)
      ? ((raw as Partial<EditableSet>).currentVersionId as string)
      : versions[0]?.id || null;

  const rawIterations = Array.isArray((raw as Partial<EditableSet>).optimizationIterations)
    ? ((raw as Partial<EditableSet>).optimizationIterations as OptimizationIteration[])
    : [];

  const optimizationIterations = rawIterations
    .map((iteration) => ({
      id: iteration.id || crypto.randomUUID(),
      createdAt: iteration.createdAt || new Date().toISOString(),
      feedback: iteration.feedback || '',
      baselineVersionId: iteration.baselineVersionId || null,
      baselineConfig: {
        ...fallback,
        ...(iteration.baselineConfig || fallback),
        criteria:
          Array.isArray(iteration.baselineConfig?.criteria) && iteration.baselineConfig.criteria.length > 0
            ? iteration.baselineConfig.criteria
            : fallback.criteria,
        feedbackBehavior: {
          ...DEFAULT_FEEDBACK_BEHAVIOR,
          ...((iteration.baselineConfig as BuilderPromptConfig | undefined)?.feedbackBehavior || {}),
        },
        feedbackInstructionText:
          typeof (iteration.baselineConfig as BuilderPromptConfig | undefined)?.feedbackInstructionText === 'string'
            ? ((iteration.baselineConfig as BuilderPromptConfig | undefined)?.feedbackInstructionText as string)
            : '',
      },
      revisedConfig: {
        ...fallback,
        ...(iteration.revisedConfig || fallback),
        criteria:
          Array.isArray(iteration.revisedConfig?.criteria) && iteration.revisedConfig.criteria.length > 0
            ? iteration.revisedConfig.criteria
            : fallback.criteria,
        feedbackBehavior: {
          ...DEFAULT_FEEDBACK_BEHAVIOR,
          ...((iteration.revisedConfig as BuilderPromptConfig | undefined)?.feedbackBehavior || {}),
        },
        feedbackInstructionText:
          typeof (iteration.revisedConfig as BuilderPromptConfig | undefined)?.feedbackInstructionText === 'string'
            ? ((iteration.revisedConfig as BuilderPromptConfig | undefined)?.feedbackInstructionText as string)
            : '',
      },
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    id: raw.id || crypto.randomUUID(),
    name: raw.name || 'Untitled Prompt',
    config,
    configured: !!raw.configured,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    versions,
    currentVersionId,
    optimizationIterations,
  };
}
function RubricTable({
  criteria,
  onChange,
}: {
  criteria: RubricCriterion[];
  onChange: (next: RubricCriterion[]) => void;
}) {
  const addCriterion = () => {
    onChange([
      ...criteria,
      {
        id: crypto.randomUUID(),
        name: '',
        minScore: 0,
        maxScore: 3,
        levels: { '3': '', '2': '', '1': '', '0': '' },
      },
    ]);
  };

  const removeCriterion = (id: string) => {
    onChange(criteria.filter((c) => c.id !== id));
  };

  const updateCriterion = (id: string, key: keyof RubricCriterion, value: string | number) => {
    onChange(
      criteria.map((c) => {
        if (c.id !== id) return c;

        const next = { ...c, [key]: value };

        if (key === 'minScore' || key === 'maxScore') {
          const levels: Record<string, string> = {};
          for (let score = next.maxScore; score >= next.minScore; score -= 1) {
            levels[String(score)] = next.levels[String(score)] || '';
          }
          next.levels = levels;
        }

        return next;
      })
    );
  };

  const updateLevel = (id: string, score: string, value: string) => {
    onChange(criteria.map((c) => (c.id === id ? { ...c, levels: { ...c.levels, [score]: value } } : c)));
  };

  return (
    <div className="space-y-4">
      {criteria.map((criterion) => (
        <div key={criterion.id} className="space-y-2 py-3">
          <div className="mb-3 flex items-center gap-2">
            <input
              value={criterion.name}
              onChange={(e) => updateCriterion(criterion.id, 'name', e.target.value)}
              placeholder="Criterion name"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <input
              type="number"
              min={0}
              value={criterion.minScore}
              onChange={(e) => updateCriterion(criterion.id, 'minScore', Number(e.target.value))}
              className="w-14 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              title="Min score"
            />
            <input
              type="number"
              min={1}
              value={criterion.maxScore}
              onChange={(e) => updateCriterion(criterion.id, 'maxScore', Number(e.target.value))}
              className="w-14 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
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

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="w-16 border-r border-slate-200 py-2 text-center">Score</th>
                  <th className="px-3 py-2 text-left">Description</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(criterion.levels)
                  .sort((a, b) => Number(b) - Number(a))
                  .map((score) => (
                    <tr key={score} className="border-t border-slate-200">
                      <td className="border-r border-slate-200 py-2 text-center font-semibold text-slate-700">
                        {score}
                      </td>
                      <td className="p-2">
                        <textarea
                          rows={2}
                          value={criterion.levels[score] || ''}
                          onChange={(e) => updateLevel(criterion.id, score, e.target.value)}
                          placeholder={`Description for score ${score}`}
                          className="w-full rounded-md border border-transparent px-2 py-1 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
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

function CriterionResultCard({
  result,
  criteria,
}: {
  result: TestResult;
  criteria: RubricCriterion[];
}) {
  const [open, setOpen] = useState(true);
  const matched = criteria.find((c) => c.name === result.criterionName);
  const progress =
    matched && matched.maxScore > matched.minScore
      ? ((result.score - matched.minScore) / (matched.maxScore - matched.minScore)) * 100
      : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between bg-slate-50 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-800">{result.criterionName}</p>
          <p className="text-xs text-slate-500">
            {result.score}/{matched?.maxScore ?? '?'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-indigo-500"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>
      </button>
      {open && (
        <div className="space-y-3 p-4 text-sm">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Justification</p>
            <ul className="list-inside list-disc space-y-1 text-slate-700">
              {result.justification.map((row, idx) => (
                <li key={idx}>{row}</li>
              ))}
            </ul>
          </div>
          {result.evidenceQuotes?.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
              <div className="space-y-2">
                {result.evidenceQuotes.map((row, idx) => (
                  <blockquote key={idx} className="border-l-2 border-indigo-300 pl-3 italic text-slate-600">
                    &quot;{row.quote}&quot;
                  </blockquote>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type DiffOp = {
  type: 'equal' | 'add' | 'remove';
  text: string;
};

function buildWordDiffOps(oldText: string, nextText: string): DiffOp[] {
  const oldWords = oldText.split(/(\s+)/).filter((token) => token.length > 0);
  const newWords = nextText.split(/(\s+)/).filter((token) => token.length > 0);

  const rows = oldWords.length;
  const cols = newWords.length;
  const lcs: number[][] = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      if (oldWords[i] === newWords[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < rows && j < cols) {
    if (oldWords[i] === newWords[j]) {
      ops.push({ type: 'equal', text: oldWords[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'remove', text: oldWords[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', text: newWords[j] });
      j += 1;
    }
  }

  while (i < rows) {
    ops.push({ type: 'remove', text: oldWords[i] });
    i += 1;
  }

  while (j < cols) {
    ops.push({ type: 'add', text: newWords[j] });
    j += 1;
  }

  return ops;
}

function DiffTextPreview({
  oldText,
  newText,
  mode,
}: {
  oldText: string;
  newText: string;
  mode: 'old' | 'new';
}) {
  if (mode === 'old') {
    const plain = oldText || '';
    if (!plain.trim()) {
      return <p className="text-xs text-slate-400">No text.</p>;
    }
    return <p className="whitespace-pre-wrap text-xs leading-6 text-slate-700">{plain}</p>;
  }

  const ops = useMemo(() => buildWordDiffOps(oldText || '', newText || ''), [oldText, newText]);

  if (!ops.length) {
    return <p className="text-xs text-slate-400">No text.</p>;
  }

  return (
    <p className="whitespace-pre-wrap text-xs leading-6 text-slate-700">
      {ops.map((op, idx) => {
        if (op.type === 'equal') return <span key={`${mode}-op-${idx}`}>{op.text}</span>;
        if (op.type === 'remove') {
          return (
            <mark key={`${mode}-op-${idx}`} className="rounded bg-red-100 px-0.5 text-red-700 line-through">
              {op.text}
            </mark>
          );
        }
        return <mark key={`${mode}-op-${idx}`} className="rounded bg-emerald-100 px-0.5 text-emerald-800">{op.text}</mark>;
      })}
    </p>
  );
}

function IterationConfigReviewEditor({
  baselineConfig,
  revisedConfig,
  configStartNumber,
  onChange,
  isRubricEditing,
  onToggleRubricEdit,
}: {
  baselineConfig: BuilderPromptConfig;
  revisedConfig: BuilderPromptConfig;
  configStartNumber: number;
  onChange: (next: BuilderPromptConfig) => void;
  isRubricEditing: boolean;
  onToggleRubricEdit: () => void;
}) {
  const baselineInstruction = getEffectiveFeedbackInstructionText(baselineConfig);
  const revisedInstruction = getEffectiveFeedbackInstructionText(revisedConfig);

  const rubricChanged = JSON.stringify(baselineConfig.criteria) !== JSON.stringify(revisedConfig.criteria);
  const feedbackChanged = baselineInstruction !== revisedInstruction;

  const updateCriterion = (criterionId: string, patch: Partial<RubricCriterion>) => {
    const nextCriteria = revisedConfig.criteria.map((criterion) =>
      criterion.id === criterionId ? { ...criterion, ...patch } : criterion
    );
    onChange({ ...revisedConfig, criteria: nextCriteria });
  };

  const updateLevel = (criterionId: string, score: string, text: string) => {
    const nextCriteria = revisedConfig.criteria.map((criterion) => {
      if (criterion.id !== criterionId) return criterion;
      return {
        ...criterion,
        levels: {
          ...criterion.levels,
          [score]: text,
        },
      };
    });
    onChange({ ...revisedConfig, criteria: nextCriteria });
  };

  const criterionPairs = Array.from({ length: Math.max(baselineConfig.criteria.length, revisedConfig.criteria.length) }, (_, index) => {
    const revisedCriterion = revisedConfig.criteria[index];
    const baselineCriterion = revisedCriterion
      ? baselineConfig.criteria.find((row) => row.id === revisedCriterion.id) || baselineConfig.criteria[index]
      : baselineConfig.criteria[index];

    return {
      baselineCriterion,
      revisedCriterion,
      key: revisedCriterion?.id || baselineCriterion?.id || `criterion-${index}`,
    };
  });

  const renderRubricCriterion = (
    criterion: RubricCriterion,
    keyPrefix: string,
    editable: boolean,
    baselineCriterion?: RubricCriterion
  ) => {
    const scoreKeys = Object.keys(criterion.levels).sort((a, b) => Number(b) - Number(a));
    const hasBaseline = Boolean(baselineCriterion);
    const criterionChanged = baselineCriterion
      ? baselineCriterion.name !== criterion.name ||
        baselineCriterion.minScore !== criterion.minScore ||
        baselineCriterion.maxScore !== criterion.maxScore
      : false;

    return (
      <div
        key={`${keyPrefix}-${criterion.id}`}
        className={`h-full py-1 ${!editable && criterionChanged ? 'bg-emerald-50/50' : ''}`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          {editable ? (
            <input
              value={criterion.name}
              onChange={(e) => updateCriterion(criterion.id, { name: e.target.value })}
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
          ) : (
            <p className="text-sm font-semibold text-slate-800">{criterion.name || 'Unnamed criterion'}</p>
          )}

          {editable ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={criterion.minScore}
                onChange={(e) => updateCriterion(criterion.id, { minScore: Number(e.target.value) })}
                className="w-10 rounded-md border border-slate-200 px-1.5 py-0.5 text-center text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
              <span className="text-xs text-slate-500">-</span>
              <input
                type="number"
                min={1}
                value={criterion.maxScore}
                onChange={(e) => updateCriterion(criterion.id, { maxScore: Number(e.target.value) })}
                className="w-10 rounded-md border border-slate-200 px-1.5 py-0.5 text-center text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
          ) : (
            <span className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              {criterion.minScore}-{criterion.maxScore}
            </span>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="w-16 border-r border-slate-200 px-2 py-2 text-left font-semibold">Score</th>
                <th className="px-3 py-2 text-left font-semibold">Description</th>
              </tr>
            </thead>
            <tbody>
              {scoreKeys.map((scoreKey) => {
                const levelText = criterion.levels[scoreKey] || '';
                const oldLevelText = baselineCriterion?.levels?.[scoreKey] || '';
                const levelChanged = !editable && hasBaseline && oldLevelText !== levelText;

                return (
                  <tr key={`${keyPrefix}-${criterion.id}-${scoreKey}`} className="border-t border-slate-200 align-top">
                    <td className="border-r border-slate-200 px-2 py-2 font-semibold text-slate-700">{scoreKey}</td>
                    <td className={`px-3 py-2 ${levelChanged ? 'bg-emerald-50/70' : ''}`}>
                      {editable ? (
                        <textarea
                          rows={2}
                          value={levelText}
                          onChange={(e) => updateLevel(criterion.id, scoreKey, e.target.value)}
                          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                        />
                      ) : (
                        hasBaseline ? (
                          <DiffTextPreview oldText={oldLevelText} newText={levelText} mode="new" />
                        ) : (
                          <p className="text-xs text-slate-700">{levelText || 'Not set'}</p>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="mb-2">
          <span className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
            {configStartNumber === 1 ? 'Original Config' : `Config ${configStartNumber - 1}`}
          </span>
        </div>
        <div className="mb-2">
          <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            {`Config ${configStartNumber}`}
          </span>
        </div>
      </div>

      <details open={rubricChanged} className="rounded-xl border border-slate-200 bg-white">
        <summary className="grid cursor-pointer list-none gap-3 lg:grid-cols-2">
          <div className="flex items-center rounded-lg bg-[var(--card-border)] px-4 py-3 text-sm font-bold text-slate-800">
            <span className="inline-flex items-center gap-1.5 text-slate-900">
              <FileText className="h-4 w-4 text-slate-800" />
              Rubric Builder
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--card-border)] px-4 py-3 text-sm font-bold text-slate-800">
            <span className="inline-flex items-center gap-1.5 text-slate-900">
              <FileText className="h-4 w-4 text-slate-800" />
              Rubric Builder
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleRubricEdit();
              }}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${isRubricEditing ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              <Pencil className="h-3.5 w-3.5" />
              {isRubricEditing ? 'Done Editing' : 'Edit'}
            </button>
          </div>
        </summary>
        <div className="space-y-3 border-t border-slate-200 px-6 pb-4 pt-3">
          {criterionPairs.map(({ baselineCriterion, revisedCriterion, key }) => (
            <div key={key} className="grid items-stretch gap-3 lg:grid-cols-2">
              <div className="min-w-0">
                {baselineCriterion ? renderRubricCriterion(baselineCriterion, `base-${key}`, false) : null}
              </div>
              <div className="min-w-0">
                {revisedCriterion
                  ? renderRubricCriterion(revisedCriterion, `rev-${key}`, isRubricEditing, baselineCriterion)
                  : null}
              </div>
            </div>
          ))}
        </div>
      </details>

      <details open={feedbackChanged} className="rounded-xl border border-slate-200 bg-white">
        <summary className="grid cursor-pointer list-none gap-3 lg:grid-cols-2">
          <div className="flex items-center rounded-lg bg-[var(--card-border)] px-4 py-3 text-sm font-bold text-slate-800">
            <span className="inline-flex items-center gap-1.5 text-slate-900">
              <MessageSquare className="h-4 w-4 text-slate-800" />
              Feedback Setting
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--card-border)] px-4 py-3 text-sm font-bold text-slate-800">
            <span className="inline-flex items-center gap-1.5 text-slate-900">
              <MessageSquare className="h-4 w-4 text-slate-800" />
              Feedback Setting
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleRubricEdit();
              }}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${isRubricEditing ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              <Pencil className="h-3.5 w-3.5" />
              {isRubricEditing ? 'Done Editing' : 'Edit'}
            </button>
          </div>
        </summary>
        <div className="grid gap-3 border-t border-slate-200 px-4 pb-4 pt-3 lg:grid-cols-2">
          <div className="rounded-md border border-amber-100 bg-white p-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Feedback Instructions</p>
            <DiffTextPreview oldText={baselineInstruction} newText={revisedInstruction} mode="old" />
          </div>
          <div className="rounded-md border border-emerald-200 bg-white p-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {isRubricEditing ? 'Feedback Instructions' : 'Inline Diff Preview'}
            </p>
            {isRubricEditing ? (
              <p className="whitespace-pre-wrap text-xs leading-6 text-slate-700">{revisedInstruction || 'No text.'}</p>
            ) : (
              <DiffTextPreview oldText={baselineInstruction} newText={revisedInstruction} mode="new" />
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

const RUN_COLORS = ['#1e3a5f', '#f59e0b', '#10b981'] as const;

function ScoreConsistencyChart({
  essayRuns,
  criteria,
}: {
  essayRuns: TestResult[][];
  criteria: RubricCriterion[];
}) {
  const W = 640;
  const H = 280;
  const ml = 36, mr = 12, mt = 20, mb = 120;
  const cw = W - ml - mr;
  const ch = H - mt - mb;

  const yMin = criteria.length > 0 ? Math.min(...criteria.map((c) => c.minScore)) : 0;
  const yMax = Math.max(...criteria.map((c) => c.maxScore), yMin + 1);
  const yRange = Math.max(yMax - yMin, 1);
  const tickStep = yRange <= 5 ? 1 : yRange <= 10 ? 2 : yRange <= 25 ? 5 : yRange <= 50 ? 10 : 20;
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax; t += tickStep) ticks.push(t);
  if (ticks[ticks.length - 1] !== yMax) ticks.push(yMax);

  const numGroups = criteria.length;
  const groupWidth = numGroups > 0 ? cw / numGroups : cw;
  const numRuns = essayRuns.length;
  const barWidth = Math.min(28, (groupWidth * 0.72) / Math.max(numRuns, 1));
  const groupPad = (groupWidth - numRuns * barWidth) / 2;
  const yScale = (v: number) => ch - ((v - yMin) / yRange) * ch;

  const maxTotal = criteria.reduce((sum, c) => sum + c.maxScore, 0);
  const runTotals = essayRuns.map((run) => run.reduce((s, r) => s + r.score, 0));
  const avg = runTotals.length ? Math.round(runTotals.reduce((a, b) => a + b, 0) / runTotals.length) : 0;
  const spread = runTotals.length ? Math.max(...runTotals) - Math.min(...runTotals) : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">Score Consistency</p>
        <p className="text-xs text-slate-500">
          Avg: <span className="font-semibold text-slate-800">{avg}/{maxTotal}</span>
          &nbsp;&nbsp;Spread: <span className="font-semibold text-slate-800">&plusmn;{spread}</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-2xl">
        <g transform={`translate(${ml},${mt})`}>
          {ticks.map((tick) => {
            const y = yScale(tick);
            return (
              <g key={tick}>
                <line x1={0} y1={y} x2={cw} y2={y} stroke="#e2e8f0" strokeDasharray="4 3" strokeWidth={1} />
                <text x={-5} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#94a3b8">
                  {tick}
                </text>
              </g>
            );
          })}
          <line x1={0} y1={ch} x2={cw} y2={ch} stroke="#cbd5e1" strokeWidth={1} />
          {criteria.map((criterion, gi) => {
            const gx = gi * groupWidth;
            return (
              <g key={criterion.id}>
                {essayRuns.map((run, ri) => {
                  const result = run.find((r) => r.criterionName === criterion.name);
                  const score = result?.score ?? yMin;
                  const barH = Math.max(0, ((score - yMin) / yRange) * ch);
                  const bx = gx + groupPad + ri * barWidth;
                  const by = ch - barH;
                  return (
                    <rect
                      key={ri}
                      x={bx}
                      y={by}
                      width={Math.max(0, barWidth - 3)}
                      height={barH}
                      fill={RUN_COLORS[ri as 0 | 1 | 2] ?? '#94a3b8'}
                      rx={3}
                    />
                  );
                })}
                <text
                  x={gx + groupWidth / 2}
                  y={ch + 10}
                  textAnchor="end"
                  fontSize={10}
                  fill="#64748b"
                  transform={`rotate(-38 ${gx + groupWidth / 2} ${ch + 10})`}
                >
                  {criterion.name}
                </text>
              </g>
            );
          })}
          {/* legend centred under x-axis labels */}
          <g transform={`translate(${cw / 2 - (numRuns * 58) / 2},${ch + 70})`}>
            {essayRuns.map((_, ri) => (
              <g key={ri} transform={`translate(${ri * 62},0)`}>
                <rect width={10} height={10} fill={RUN_COLORS[ri as 0 | 1 | 2] ?? '#94a3b8'} rx={2} />
                <text x={14} y={9} fontSize={10} fill="#64748b">
                  Run {ri + 1}
                </text>
              </g>
            ))}
          </g>
        </g>
      </svg>
      <div className={`mx-auto mt-3 max-w-2xl grid gap-2 ${numRuns <= 1 ? 'grid-cols-1' : numRuns === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {runTotals.map((total, ri) => (
          <div key={ri} className="rounded-lg border border-slate-200 py-2.5 text-center">
            <p className="text-xs font-semibold" style={{ color: RUN_COLORS[ri as 0 | 1 | 2] ?? '#64748b' }}>
              Run {ri + 1}
            </p>
            <p className="mt-0.5 text-lg font-bold text-slate-800">
              {total} <span className="text-sm font-normal text-slate-400">/ {maxTotal}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function getScorePillClass(score: number, maxScore: number): string {
  if (maxScore <= 0) return 'bg-slate-400 text-white';
  const ratio = score / maxScore;
  if (ratio >= 0.8) return 'bg-emerald-500 text-white';
  if (ratio >= 0.6) return 'bg-amber-500 text-slate-900';
  return 'bg-rose-500 text-white';
}

function CompareResultColumn({
  title,
  total,
  maxTotal,
  rows,
  criteria,
  accent,
}: {
  title: string;
  total: number;
  maxTotal: number;
  rows: TestResult[];
  criteria: RubricCriterion[];
  accent: 'slate' | 'indigo';
}) {
  const titleClass = accent === 'indigo' ? 'text-indigo-700' : 'text-slate-600';

  return (
    <div className="space-y-2">
      <p className={`text-xs font-semibold ${titleClass}`}>{title}</p>
      <div className="flex items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-3xl font-bold leading-none text-slate-800">{total}</div>
        <div className="pb-0.5 text-sm font-medium text-slate-600">Overall Score</div>
        <div className="pb-0.5 text-sm text-slate-400">/ {maxTotal}</div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Criterion</th>
              <th className="w-20 px-2 py-2 text-left font-semibold">Score</th>
              <th className="px-2 py-2 text-left font-semibold">Feedback</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const maxForCriterion = criteria.find((c) => c.name === row.criterionName)?.maxScore ?? 0;
              return (
                <tr key={`${title}-${row.criterionName}`} className="border-t border-slate-200 align-top">
                  <td className="px-3 py-2 font-semibold text-slate-700">{row.criterionName}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getScorePillClass(row.score, maxForCriterion)}`}>
                      {row.score}/{maxForCriterion || '?'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    <p className="text-sm">{row.justification?.[0] || 'No feedback generated.'}</p>
                    {row.evidenceQuotes?.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-indigo-500">
                          Evidence ({row.evidenceQuotes.length})
                        </summary>
                        <div className="mt-2 space-y-1">
                          {row.evidenceQuotes.map((quoteRow, quoteIdx) => (
                            <blockquote
                              key={`${title}-${row.criterionName}-evidence-${quoteIdx}`}
                              className="border-l-2 border-amber-300 pl-2 text-xs italic text-slate-600"
                            >
                              &quot;{quoteRow.quote}&quot;
                            </blockquote>
                          ))}
                        </div>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getSetTotal(results: TestResult[]): number {
  return results.reduce((sum, row) => sum + row.score, 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildRunMetrics(totals: number[]): RunMetrics | null {
  if (totals.length === 0) return null;
  const mean = totals.reduce((sum, row) => sum + row, 0) / totals.length;
  const variance = totals.reduce((sum, row) => sum + Math.pow(row - mean, 2), 0) / totals.length;
  return {
    mean: round2(mean),
    min: round2(Math.min(...totals)),
    max: round2(Math.max(...totals)),
    stdDev: round2(Math.sqrt(variance)),
  };
}

function buildCriterionMetrics(runOutputs: TestResult[][]): CriterionMetric[] {
  if (runOutputs.length === 0) return [];

  const bucket = new Map<string, number[]>();

  runOutputs.forEach((run) => {
    run.forEach((row) => {
      const prev = bucket.get(row.criterionName) || [];
      bucket.set(row.criterionName, [...prev, row.score]);
    });
  });

  return Array.from(bucket.entries()).map(([criterionName, scores]) => {
    const mean = scores.reduce((sum, row) => sum + row, 0) / scores.length;
    const variance = scores.reduce((sum, row) => sum + Math.pow(row - mean, 2), 0) / scores.length;
    return {
      criterionName,
      mean: round2(mean),
      min: round2(Math.min(...scores)),
      max: round2(Math.max(...scores)),
      stdDev: round2(Math.sqrt(variance)),
    };
  });
}

function getMaxTotal(criteria: RubricCriterion[]): number {
  return criteria.reduce((sum, c) => sum + c.maxScore, 0);
}

function validateEditableBuilderConfig(config: BuilderPromptConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(config.criteria) || config.criteria.length === 0) {
    errors.push('At least one rubric criterion is required');
    return { valid: false, errors };
  }

  config.criteria.forEach((criterion, index) => {
    if (!String(criterion.name ?? '').trim()) {
      errors.push(`Criterion ${index + 1}: Name is required`);
    }
    if ((criterion.maxScore ?? 0) <= 0) {
      errors.push(`Criterion ${index + 1}: Max score must be > 0`);
    }
    if ((criterion.minScore ?? 0) < 0) {
      errors.push(`Criterion ${index + 1}: Min score cannot be negative`);
    }
    if ((criterion.minScore ?? 0) >= (criterion.maxScore ?? 0)) {
      errors.push(`Criterion ${index + 1}: Min score must be less than max score`);
    }
  });

  return { valid: errors.length === 0, errors };
}

function getFeedbackBehavior(config: BuilderPromptConfig): FeedbackBehaviorConfig {
  return {
    ...DEFAULT_FEEDBACK_BEHAVIOR,
    ...(config.feedbackBehavior || {}),
  };
}

function getDefaultFeedbackInstructionText(config: BuilderPromptConfig): string {
  const behavior = getFeedbackBehavior(config);
  const formatInstruction =
    behavior.format === 'bullets'
      ? 'Write feedback as bullet points.'
      : 'Write feedback as flow text.';

  return [
    formatInstruction,
    getDefaultLengthInstruction(behavior.lengthPreset),
    getDefaultToneInstruction(behavior.tonePreset),
    getDefaultEnglishInstruction(behavior.englishLevelPreset),
  ].join('\n');
}

function getEffectiveFeedbackInstructionText(config: BuilderPromptConfig): string {
  const custom = typeof config.feedbackInstructionText === 'string' ? config.feedbackInstructionText.trim() : '';
  return custom || getDefaultFeedbackInstructionText(config);
}

function buildPromptSlotsFromConfig(config: BuilderPromptConfig): EditablePromptSlots {
  const behavior = getFeedbackBehavior(config);
  const feedbackInstructionText = getEffectiveFeedbackInstructionText(config);
  return {
    lengthInstruction: getDefaultLengthInstruction(behavior.lengthPreset),
    toneInstruction: getDefaultToneInstruction(behavior.tonePreset),
    englishLevelInstruction: getDefaultEnglishInstruction(behavior.englishLevelPreset),
    justificationStructureInstruction: feedbackInstructionText,
  };
}

function buildStyleOverridesFromConfig(config: BuilderPromptConfig): Partial<FeedbackStyleConfig> {
  const behavior = getFeedbackBehavior(config);
  return {
    lengthPreset: behavior.lengthPreset,
    tonePreset: behavior.tonePreset,
    englishLevelPreset: behavior.englishLevelPreset,
  };
}

function getAssessmentTypeFromConfig(config: BuilderPromptConfig): 'flow' | 'bullets' {
  const behavior = getFeedbackBehavior(config);
  return behavior.format === 'bullets' ? 'bullets' : 'flow';
}

function normalizeTestResults(value: unknown): TestResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const item = row as Record<string, unknown>;
      const rawScore = item.score;
      const numericScore =
        typeof rawScore === 'number' && Number.isFinite(rawScore)
          ? rawScore
          : typeof rawScore === 'string'
          ? Number(rawScore)
          : 0;

      return {
        criterionName: typeof item.criterionName === 'string' ? item.criterionName : 'Unknown Criterion',
        justification: Array.isArray(item.justification)
          ? item.justification.filter((part): part is string => typeof part === 'string')
          : typeof item.justification === 'string'
          ? [item.justification]
          : [],
        evidenceQuotes: Array.isArray(item.evidenceQuotes)
          ? item.evidenceQuotes
              .filter((q): q is { quote: string } => !!q && typeof q === 'object' && typeof (q as { quote?: unknown }).quote === 'string')
              .map((q) => ({ quote: q.quote }))
          : [],
        score: Number.isFinite(numericScore) ? numericScore : 0,
      };
    });
}

function draftOptimizedConfig(base: BuilderPromptConfig, request: string): BuilderPromptConfig {
  const next = cloneConfig(base);
  const note = request.trim();
  if (!note) return next;

  const line = `Optimization objective: ${note}`;
  next.feedbackText = next.feedbackText?.trim() ? `${next.feedbackText.trim()}\n\n${line}` : line;
  return next;
}

export default function PromptPlayground() {
  const [view, setView] = useState<PlaygroundView>('dashboard');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [promptSets, setPromptSets] = useState<EditableSet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [config, setConfig] = useState<BuilderPromptConfig>(makeDefaultConfig);
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [savedPulse, setSavedPulse] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  const [essays, setEssays] = useState<EssayItem[]>([{ id: crypto.randomUUID(), text: '' }]);
  const [gradingLoading, setGradingLoading] = useState(false);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [runResultsByEssay, setRunResultsByEssay] = useState<TestResult[][][]>([]);
  const [runMetadata, setRunMetadata] = useState<RunMetadata | null>(null);
  const [resultsTab, setResultsTab] = useState<'graph' | 'results'>('results');
  const [runCount, setRunCount] = useState(1);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [configCollapsed, setConfigCollapsed] = useState(false);

  const [optimizerGoal, setOptimizerGoal] = useState('');
  const [optimizedConfig, setOptimizedConfig] = useState<BuilderPromptConfig | null>(null);
  const [optimizationLoading, setOptimizationLoading] = useState(false);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [selectedIterationId, setSelectedIterationId] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [baselineResults, setBaselineResults] = useState<TestResult[] | null>(null);
  const [optimizedResults, setOptimizedResults] = useState<TestResult[] | null>(null);
  const [comparisonByIteration, setComparisonByIteration] = useState<Record<string, IterationComparison>>({});
  const [iterationLastComparedConfigSignature, setIterationLastComparedConfigSignature] = useState<Record<string, string>>({});
  const [compareLoadingId, setCompareLoadingId] = useState<string | null>(null);
  const [lastAttemptedIterationId, setLastAttemptedIterationId] = useState<string | null>(null);
  const [iterationLastRunEssay, setIterationLastRunEssay] = useState<Record<string, string>>({});
  const [iterationEditModeById, setIterationEditModeById] = useState<Record<string, boolean>>({});
  const feedbackComposerRef = useRef<HTMLDivElement>(null);
  const newestIterationRef = useRef<HTMLDivElement | null>(null);
  const [composerAnchorIterationId, setComposerAnchorIterationId] = useState<string | null>(null);
  const [optimizerSessionIterationIds, setOptimizerSessionIterationIds] = useState<string[]>([]);

  const activeSet = useMemo(
    () => promptSets.find((row) => row.id === activeSetId) ?? null,
    [promptSets, activeSetId]
  );

  const activeVersions = activeSet?.versions || [];
  const activeIterations = activeSet?.optimizationIterations || [];
  const sessionIterations = useMemo(
    () => activeIterations.filter((iteration) => optimizerSessionIterationIds.includes(iteration.id)),
    [activeIterations, optimizerSessionIterationIds]
  );
  const originalSessionConfig = useMemo(
    () => sessionIterations[sessionIterations.length - 1]?.baselineConfig ?? config,
    [config, sessionIterations]
  );
  const iterationTimeline = useMemo(() => [...sessionIterations].reverse(), [sessionIterations]);

  const validation = useMemo(() => validateEditableBuilderConfig(config), [config]);

  const primaryRunOutputs = useMemo(() => runResultsByEssay[0] || [], [runResultsByEssay]);
  const runTotals = useMemo(
    () => primaryRunOutputs.map((runResult) => getSetTotal(runResult)),
    [primaryRunOutputs]
  );

  const runMetrics = useMemo(() => buildRunMetrics(runTotals), [runTotals]);
  const criterionMetrics = useMemo(() => buildCriterionMetrics(primaryRunOutputs), [primaryRunOutputs]);

  const filteredSets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return promptSets;
    return promptSets.filter((row) => {
      return (
        row.name.toLowerCase().includes(query) ||
        (row.config.subject || '').toLowerCase().includes(query)
      );
    });
  }, [promptSets, search]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETS_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as EditableSet[]) : [];
      const normalized = parsed.map(normalizeSet);
      setPromptSets(normalized);

      const storedActive = localStorage.getItem(ACTIVE_SET_KEY);
      const fallbackId = normalized[0]?.id ?? null;
      const chosenId = storedActive && normalized.some((row) => row.id === storedActive) ? storedActive : fallbackId;
      setActiveSetId(chosenId);

      if (chosenId) {
        const chosen = normalized.find((row) => row.id === chosenId);
        if (chosen) {
          setConfig(cloneConfig(chosen.config));
          setRenameValue(chosen.name);
          setSelectedVersionId(chosen.currentVersionId || chosen.versions[0]?.id || '');
        }
      }
    } catch {
      setPromptSets([]);
    }
  }, []);

  useEffect(() => {
    if (sessionIterations.length === 0) {
      setSelectedIterationId('');
      return;
    }
    if (!selectedIterationId) {
      setSelectedIterationId(ORIGINAL_CONFIG_OPTION);
    }
  }, [sessionIterations, selectedIterationId]);

  // Sync optimizedConfig to the selected iteration so applyOptimizedConfig always targets the right revision
  useEffect(() => {
    if (!selectedIterationId || selectedIterationId === ORIGINAL_CONFIG_OPTION) return;
    const found = sessionIterations.find((iteration) => iteration.id === selectedIterationId);
    if (found) setOptimizedConfig(cloneConfig(found.revisedConfig));
  }, [selectedIterationId, sessionIterations]);

  // Auto-scroll to newest iteration when one is appended
  useEffect(() => {
    if (view !== 'optimizer') return;
    if (newestIterationRef.current) {
      setTimeout(() => {
        newestIterationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIterations.length]);

  const persistSets = useCallback((next: EditableSet[], nextActiveId: string | null) => {
    setPromptSets(next);
    setActiveSetId(nextActiveId);
    localStorage.setItem(SETS_STORAGE_KEY, JSON.stringify(next));
    if (nextActiveId) {
      localStorage.setItem(ACTIVE_SET_KEY, nextActiveId);
    }
  }, []);

  const updateActiveSetConfig = useCallback(
    (nextConfig: BuilderPromptConfig, markConfigured?: boolean) => {
      if (!activeSetId) return;

      const now = new Date().toISOString();
      const nextSets = promptSets.map((row) => {
        if (row.id !== activeSetId) return row;
        return {
          ...row,
          config: cloneConfig(nextConfig),
          configured: markConfigured !== undefined ? markConfigured : row.configured,
          updatedAt: now,
          name: renameValue.trim() || row.name,
          currentVersionId: row.currentVersionId,
        };
      });

      persistSets(nextSets, activeSetId);
      setSavedPulse(true);
      setTimeout(() => setSavedPulse(false), 1500);
    },
    [activeSetId, persistSets, promptSets, renameValue]
  );

  const createSet = () => {
    const initialConfig = makeDefaultConfig();
    const item: EditableSet = {
      id: crypto.randomUUID(),
      name: `Assignment Instructions ${promptSets.length + 1}`,
      config: initialConfig,
      configured: false,
      updatedAt: new Date().toISOString(),
      versions: [],
      currentVersionId: null,
      optimizationIterations: [],
    };

    const next = [item, ...promptSets];
    persistSets(next, item.id);
    setConfig(cloneConfig(item.config));
    setRenameValue(item.name);
    setSelectedVersionId('');
    setEssays([{ id: crypto.randomUUID(), text: '' }]);
    setRunResultsByEssay([]);
    setGradingError(null);
    setView('builder');
    setIsRenamingTitle(false);
    setOptimizedConfig(null);
  };

  const openSet = (id: string, targetView: PlaygroundView = 'builder') => {
    const found = promptSets.find((row) => row.id === id);
    if (!found) return;

    setActiveSetId(id);
    localStorage.setItem(ACTIVE_SET_KEY, id);
    setConfig(cloneConfig(found.config));
    setRenameValue(found.name);
    setSelectedVersionId(found.currentVersionId || found.versions[0]?.id || '');
    setSelectedIterationId(found.optimizationIterations[0]?.id || '');
    setIsRenamingTitle(false);
    setOptimizedConfig(null);
    setEssays([{ id: crypto.randomUUID(), text: '' }]);
    setRunResultsByEssay([]);
    setGradingError(null);
    setView(targetView);
  };

  const deleteSet = (id: string) => {
    const next = promptSets.filter((row) => row.id !== id);
    const nextActive = activeSetId === id ? (next[0]?.id ?? null) : activeSetId;
    persistSets(next, nextActive);

    if (nextActive) {
      const selected = next.find((row) => row.id === nextActive);
      if (selected) {
        setConfig(cloneConfig(selected.config));
        setRenameValue(selected.name);
        setSelectedVersionId(selected.currentVersionId || selected.versions[0]?.id || '');
        setSelectedIterationId(selected.optimizationIterations[0]?.id || '');
      }
    } else {
      setConfig(makeDefaultConfig());
      setRenameValue('');
      setSelectedVersionId('');
      setSelectedIterationId('');
      setView('dashboard');
    }
  };

  const renameSet = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const next = promptSets.map((row) => {
      if (row.id !== id) return row;
      return { ...row, name: trimmed, updatedAt: new Date().toISOString() };
    });

    persistSets(next, activeSetId);
  };

  const runGrade = async (targetConfig: BuilderPromptConfig, essay: string): Promise<GradeRunResult> => {
    const parityCriteria = targetConfig.criteria.map((criterion) => ({
      name: criterion.name,
      scoreRange: {
        min: criterion.minScore,
        max: criterion.maxScore,
      },
    }));

    const result = await gradePlaygroundWithConfig({
      essayText: essay,
      criteria: parityCriteria,
      promptSlots: buildPromptSlotsFromConfig(targetConfig),
      styleOverrides: buildStyleOverridesFromConfig(targetConfig),
      assessmentType: getAssessmentTypeFromConfig(targetConfig),
    });

    const metadataRaw = (result as { metadata?: Partial<RunMetadata> }).metadata;
    const metadata: RunMetadata = {
      mode: 'parity',
      importable: Boolean(metadataRaw?.importable),
    };

    return {
      results: normalizeTestResults((result as { results?: unknown }).results),
      metadata,
    };
  };

  const primaryEssayText = essays.find((essay) => essay.text.trim())?.text || '';

  const setPrimaryEssayText = (text: string) => {
    setEssays((prev) => {
      if (prev.length === 0) return [{ id: crypto.randomUUID(), text }];
      return prev.map((essay, idx) => (idx === 0 ? { ...essay, text } : essay));
    });
  };

  const addEssay = () => {
    if (essays.length >= 3 || gradingLoading) return;
    setEssays((prev) => [...prev, { id: crypto.randomUUID(), text: '' }]);
  };

  const removeEssay = (id: string) => {
    if (gradingLoading || essays.length <= 1) return;
    setEssays((prev) => prev.filter((essay) => essay.id !== id));
  };

  const updateEssay = (id: string, text: string) => {
    setEssays((prev) => prev.map((essay) => (essay.id === id ? { ...essay, text } : essay)));
  };

  const uploadEssayFile = async (id: string, file: File) => {
    if (gradingLoading) return;
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const text = isPdf
        ? await (await import('@/lib/pdf-utils')).extractTextFromPdf(file)
        : await file.text();
      updateEssay(id, text || '');
    } catch {
      setGradingError('Failed to extract text from uploaded file');
    }
  };

  const runBuilderGrade = async () => {
    setConfigCollapsed(true);

    if (!validation.valid) return;
    const filledEssays = essays.filter((essay) => essay.text.trim());
    if (filledEssays.length === 0) return;

    setGradingLoading(true);
    setGradingError(null);
    setRunResultsByEssay([]);
    setRunMetadata(null);

    try {
      const runs = Math.min(3, Math.max(1, runCount));
      const perEssayOutputs: TestResult[][][] = essays.map(() => []);

      for (let essayIndex = 0; essayIndex < essays.length; essayIndex += 1) {
        const targetEssay = essays[essayIndex];
        if (!targetEssay.text.trim()) {
          perEssayOutputs[essayIndex] = [];
          continue;
        }

        const outputs: TestResult[][] = [];
        for (let idx = 0; idx < runs; idx += 1) {
          const graded = await runGrade(config, targetEssay.text);
          outputs.push(graded.results);
          if (essayIndex === 0 && idx === 0) {
            setRunMetadata(graded.metadata);
          }
        }
        perEssayOutputs[essayIndex] = outputs;
      }

      setRunResultsByEssay(perEssayOutputs);
    } catch (error) {
      setGradingError(error instanceof Error ? error.message : 'Failed to grade essay');
    } finally {
      setGradingLoading(false);
    }
  };

  const saveSetupAndEnterBuilder = () => {
    if (!validation.valid) return;
    if (!activeSetId) return;

    const now = new Date().toISOString();
    const nextVersion = createVersion(config, 1);
    const next = promptSets.map((row) => {
      if (row.id !== activeSetId) return row;
      return {
        ...row,
        config: cloneConfig(config),
        configured: true,
        updatedAt: now,
        versions: [nextVersion],
        currentVersionId: nextVersion.id,
        name: renameValue.trim() || row.name,
      };
    });

    persistSets(next, activeSetId);
    setSelectedVersionId(nextVersion.id);
    setSavedPulse(true);
    setTimeout(() => setSavedPulse(false), 1500);
  };

  const saveBuilderConfig = () => {
    if (!activeSetId || !activeSet) return;

    const now = new Date().toISOString();
    const versionCount = activeSet.versions.length + 1;
    const nextVersion = createVersion(config, versionCount);

    const next = promptSets.map((row) => {
      if (row.id !== activeSetId) return row;
      return {
        ...row,
        config: cloneConfig(config),
        updatedAt: now,
        versions: [nextVersion, ...row.versions.map(cloneVersion)],
        currentVersionId: nextVersion.id,
        name: renameValue.trim() || row.name,
      };
    });

    persistSets(next, activeSetId);
    setSelectedVersionId(nextVersion.id);
    setSavedPulse(true);
    setTimeout(() => setSavedPulse(false), 1500);
  };

  const reopenSetupMode = () => {
    if (!activeSetId) return;

    const now = new Date().toISOString();
    const next = promptSets.map((row) => {
      if (row.id !== activeSetId) return row;
      return {
        ...row,
        configured: false,
        updatedAt: now,
      };
    });

    persistSets(next, activeSetId);
  };

  const loadVersionIntoBuilder = () => {
    if (!activeSet || !selectedVersionId) return;
    const found = activeSet.versions.find((version) => version.id === selectedVersionId);
    if (!found) return;

    setConfig(cloneConfig(found.config));
  };

  const rollbackToVersion = () => {
    if (!activeSetId || !activeSet || !selectedVersionId) return;
    const found = activeSet.versions.find((version) => version.id === selectedVersionId);
    if (!found) return;

    const now = new Date().toISOString();
    const next = promptSets.map((row) => {
      if (row.id !== activeSetId) return row;
      return {
        ...row,
        config: cloneConfig(found.config),
        currentVersionId: found.id,
        updatedAt: now,
      };
    });

    setConfig(cloneConfig(found.config));
    persistSets(next, activeSetId);
    setSavedPulse(true);
    setTimeout(() => setSavedPulse(false), 1500);
  };

  const normalizeFeedbackParagraphs = (value: string): string[] =>
    value
      .split('\n\n')
      .map((row) => row.trim())
      .filter(Boolean);

  const hasFeedbackTag = (instruction: string): boolean => {
    const parts = normalizeFeedbackParagraphs(optimizerGoal);
    return parts.includes(instruction.trim());
  };

  const toggleFeedbackTag = (instruction: string) => {
    setOptimizerGoal((prev) => {
      const parts = normalizeFeedbackParagraphs(prev);
      const target = instruction.trim();
      const exists = parts.includes(target);
      const next = exists ? parts.filter((row) => row !== target) : [...parts, target];
      return next.join('\n\n');
    });
  };

  const persistOptimizationIteration = useCallback(
    (feedback: string, baselineConfig: BuilderPromptConfig, revisedConfig: BuilderPromptConfig) => {
      if (!activeSetId) return;

      const now = new Date().toISOString();
      const iteration: OptimizationIteration = {
        id: crypto.randomUUID(),
        createdAt: now,
        feedback,
        baselineVersionId: activeSet?.currentVersionId || null,
        baselineConfig: cloneConfig(baselineConfig),
        revisedConfig: cloneConfig(revisedConfig),
      };

      const next = promptSets.map((row) => {
        if (row.id !== activeSetId) return row;
        return {
          ...row,
          optimizationIterations: [iteration, ...row.optimizationIterations],
          updatedAt: now,
        };
      });

      persistSets(next, activeSetId);
      setSelectedIterationId(iteration.id);
      setOptimizerSessionIterationIds((prev) => [iteration.id, ...prev.filter((id) => id !== iteration.id)]);
    },
    [activeSet?.currentVersionId, activeSetId, persistSets, promptSets]
  );

  const generateOptimizedWithLLM = async () => {
    const feedback = optimizerGoal.trim();
    if (!feedback) return;

    const baseConfig = optimizedConfig || sessionIterations[0]?.revisedConfig || config;

    setOptimizationLoading(true);
    setOptimizationError(null);

    try {
      const optimized = await optimizePlaygroundConfig(baseConfig, feedback);
      const revised = optimized.revisedConfig as PromptConfig;
      setOptimizedConfig(revised);
      persistOptimizationIteration(feedback, baseConfig, revised);
      setBaselineResults(null);
      setOptimizedResults(null);
      setCompareError(null);
    } catch (error) {
      const fallback = draftOptimizedConfig(baseConfig, feedback);
      setOptimizedConfig(fallback);
      persistOptimizationIteration(feedback, baseConfig, fallback);
      setOptimizationError(
        error instanceof Error ? `${error.message} (fallback draft used)` : 'Optimization failed (fallback draft used)'
      );
    } finally {
      setOptimizationLoading(false);
    }
  };

  // loadIteration removed – replaced by the selectedIterationId sync effect above

  const runCompareForIteration = async (iterationId: string) => {
    setSelectedIterationId(iterationId);
    setCompareLoadingId(iterationId);
    setLastAttemptedIterationId(iterationId);
    try {
      await compareConfigs(iterationId);
      setIterationLastRunEssay((prev) => ({ ...prev, [iterationId]: primaryEssayText }));
      setComposerAnchorIterationId(iterationId);
    } finally {
      setCompareLoadingId(null);
    }
  };

  const updateIterationRevisedConfig = useCallback(
    (iterationId: string, nextRevisedConfig: BuilderPromptConfig) => {
      if (!activeSetId) return;

      const nextSets = promptSets.map((row) => {
        if (row.id !== activeSetId) return row;
        return {
          ...row,
          optimizationIterations: row.optimizationIterations.map((iteration) =>
            iteration.id === iterationId
              ? {
                  ...iteration,
                  revisedConfig: cloneConfig(nextRevisedConfig),
                }
              : iteration
          ),
          updatedAt: new Date().toISOString(),
        };
      });

      persistSets(nextSets, activeSetId);

      if (selectedIterationId === iterationId) {
        setOptimizedConfig(cloneConfig(nextRevisedConfig));
      }
    },
    [activeSetId, persistSets, promptSets, selectedIterationId]
  );

  const handleApplyIteration = () => {
    if (!selectedIterationId) return;
    const target =
      selectedIterationId === ORIGINAL_CONFIG_OPTION
        ? cloneConfig(originalSessionConfig)
        : (() => {
            const found = sessionIterations.find((iteration) => iteration.id === selectedIterationId);
            return found ? cloneConfig(found.revisedConfig) : null;
          })();
    if (!target) return;
    setOptimizedConfig(target);
    setConfig(cloneConfig(target));
    updateActiveSetConfig(target);
    setView('builder');
    setToastMessage('Config successfully imported to Prompt Builder');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const renderFeedbackComposer = () => (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Describe your revision</h2>
        <p className="text-sm text-slate-500">
          Select quick tags and add free-text instructions. A new iteration will be appended below.
        </p>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start">
          <p className="pt-1 text-sm font-medium text-slate-700">Scoring preferences</p>
          <div className="flex flex-wrap gap-2">
            {OPTIMIZER_FEEDBACK_TAGS.filter((tag) => tag.group === 'scoring').map((tag) => {
              const selected = hasFeedbackTag(tag.instruction);
              return (
                <button
                  key={tag.label}
                  type="button"
                  onClick={() => toggleFeedbackTag(tag.instruction)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${selected ? 'border-slate-600 bg-slate-700 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start">
          <p className="pt-1 text-sm font-medium text-slate-700">Feedback style</p>
          <div className="flex flex-wrap gap-2">
            {OPTIMIZER_FEEDBACK_TAGS.filter((tag) => tag.group === 'feedback').map((tag) => {
              const selected = hasFeedbackTag(tag.instruction);
              return (
                <button
                  key={tag.label}
                  type="button"
                  onClick={() => toggleFeedbackTag(tag.instruction)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${selected ? 'border-slate-600 bg-slate-700 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <textarea
        rows={6}
        value={optimizerGoal}
        onChange={(e) => setOptimizerGoal(e.target.value)}
        placeholder="Describe how you want to revise the prompt. You can combine predefined tags and custom instructions."
        className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={generateOptimizedWithLLM}
          disabled={!optimizerGoal.trim() || optimizationLoading}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-700 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {optimizationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {optimizationLoading ? 'Generating…' : 'Generate Revision'}
        </button>
        {optimizerGoal.trim() && !optimizationLoading && (
          <button
            type="button"
            onClick={() => setOptimizerGoal('')}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Clear
          </button>
        )}
      </div>

      {optimizationError && <p className="mt-2 text-xs text-amber-700">{optimizationError}</p>}
    </div>
  );

  const compareConfigs = async (iterationIdOverride?: string) => {
    if (!primaryEssayText.trim()) return;

    const targetIterationId = iterationIdOverride || selectedIterationId;
    const selectedIteration = sessionIterations.find((iteration) => iteration.id === targetIterationId);
    const baselineConfig = selectedIteration?.baselineConfig || config;
    const revisedConfig = selectedIteration?.revisedConfig || optimizedConfig;
    if (!revisedConfig) return;

    setCompareLoading(true);
    setCompareError(null);
    setBaselineResults(null);
    setOptimizedResults(null);

    try {
      const compared = await comparePlaygroundGrades({
        essayText: primaryEssayText,
        originalConfig: {
          ...baselineConfig,
          promptSlots: buildPromptSlotsFromConfig(baselineConfig),
          styleOverrides: buildStyleOverridesFromConfig(baselineConfig),
          assessmentType: getAssessmentTypeFromConfig(baselineConfig),
        },
        revisedConfig: {
          ...revisedConfig,
          promptSlots: buildPromptSlotsFromConfig(revisedConfig),
          styleOverrides: buildStyleOverridesFromConfig(revisedConfig),
          assessmentType: getAssessmentTypeFromConfig(revisedConfig),
        },
      });

      const toTestResults = (rows: Array<{ name: string; score: number; feedback: string; evidenceQuotes: string[] }>): TestResult[] =>
        rows.map((row) => ({
          criterionName: row.name,
          justification: row.feedback ? [row.feedback] : [],
          evidenceQuotes: row.evidenceQuotes.map((quote) => ({ quote })),
          score: row.score,
        }));

      const baseline = toTestResults(compared.original.criteria);
      const revised = toTestResults(compared.revised.criteria);

      setBaselineResults(baseline);
      setOptimizedResults(revised);

      if (selectedIteration) {
        setComparisonByIteration((prev) => ({
          ...prev,
          [selectedIteration.id]: { baseline, revised },
        }));
        setIterationLastComparedConfigSignature((prev) => ({
          ...prev,
          [selectedIteration.id]: getConfigSignature(selectedIteration.revisedConfig),
        }));
      }
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : 'Failed to compare prompts');
    } finally {
      setCompareLoading(false);
    }
  };

  const applyOptimizedConfig = () => {
    if (!optimizedConfig) return;
    setConfig(cloneConfig(optimizedConfig));
    updateActiveSetConfig(optimizedConfig);
    setView('builder');
  };

  const updateFeedbackBehaviorAndImport = (patch: Partial<FeedbackBehaviorConfig>) => {
    setConfig((current) => {
      const nextBehavior = {
        ...getFeedbackBehavior(current),
        ...patch,
      };

      const nextConfig: BuilderPromptConfig = {
        ...current,
        feedbackBehavior: nextBehavior,
      };

      return {
        ...nextConfig,
        feedbackInstructionText: getDefaultFeedbackInstructionText(nextConfig),
      };
    });
  };

  const isSetupMode = !!activeSet && !activeSet.configured;
  const latestBuilderRun = primaryRunOutputs[primaryRunOutputs.length - 1] || [];
  const showIterationHistory =
    iterationTimeline.length > 0 && (optimizerGoal.trim().length > 0 || composerAnchorIterationId !== null);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="min-h-screen w-full bg-[var(--background)] px-4 py-6"
    >
      {toastMessage && (
        <div className="fixed top-28 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2.5 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2.5 shadow-lg">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-sm font-medium text-emerald-800">{toastMessage}</p>
        </div>
      )}
      <div className="w-full">
      {view === 'dashboard' && (
        <div className="mx-auto w-full max-w-[2200px] px-4 py-2">
          <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Grading Playground</h1>
              <p className="text-sm text-slate-500">Test and improve your AI instructions</p>
            </div>
          </div>

          <div className="mb-6 max-w-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search prompt..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50/80 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <button
              onClick={createSet}
              className="group flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/10"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 transition-colors duration-200 group-hover:bg-indigo-500/20">
                <Plus className="h-6 w-6" />
              </div>
              <span className="text-sm font-semibold text-slate-700">Create New Grading Setup</span>
            </button>

            {filteredSets.map((row) => (
              <div key={row.id} className="group relative rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/10">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
                      <FileText className="h-5 w-5" />
                    </div>
                  </div>
                  <button
                    onClick={() => deleteSet(row.id)}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    title="Delete prompt set"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <input
                  defaultValue={row.name}
                  onBlur={(e) => renameSet(row.id, e.target.value)}
                  className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-lg font-medium leading-tight text-slate-900 focus:border-slate-200 focus:bg-slate-50 focus:outline-none"
                />

                <div className="mt-4 flex items-center justify-between border-t border-[var(--card-border)] pt-4">
                  <span className="text-xs text-slate-400">
                    {new Date(row.updatedAt).toLocaleDateString()} • {row.versions.length} versions
                  </span>
                  <button
                    onClick={() => openSet(row.id, 'builder')}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'builder' && activeSet && (
        <div className="flex items-start gap-3 px-4">
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => setView('dashboard')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            {!isSetupMode && configCollapsed && (
              <button
                onClick={() => setConfigCollapsed(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
                title="Expand configuration"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[2200px] px-4 py-2">
          <div className={`mb-4 flex items-center ${isSetupMode ? 'mx-auto max-w-[1800px]' : ''}`}>
              <div className="min-w-0 flex-1">
                {(!configCollapsed || isSetupMode) && (isRenamingTitle ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="h-9 w-full max-w-[420px] rounded-lg border border-slate-200 px-3 text-xl focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      autoFocus
                      onBlur={() => {
                        renameSet(activeSet.id, renameValue);
                        setIsRenamingTitle(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                        if (e.key === 'Escape') {
                          renameSet(activeSet.id, renameValue);
                          setIsRenamingTitle(false);
                        }
                      }}
                    />
                    {!isSetupMode && (
                      <button
                        onClick={() => setConfigCollapsed(true)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
                        title="Collapse configuration"
                      >
                        <PanelLeftClose className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h1 className="truncate font-display text-xl font-semibold">{activeSet.name}</h1>
                    <button
                      onClick={() => setIsRenamingTitle(true)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {!isSetupMode && (
                      <button
                        onClick={() => setConfigCollapsed(true)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
                        title="Collapse configuration"
                      >
                        <PanelLeftClose className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

          </div>

          {isSetupMode ? (
            <div className="mx-auto max-w-[1800px]">
              <div className="space-y-3 pb-24">


                <details open className="rounded-xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none bg-[var(--card-border)] px-6 py-3 text-sm font-bold text-slate-800">
                    <span className="inline-flex items-center gap-1.5 text-slate-900">
                      <FileText className="h-4 w-4 text-slate-800" />
                      Rubric Builder
                    </span>
                  </summary>
                  <div className="border-t border-slate-200 px-6 pb-4 pt-3">
                    <div className="mb-3 flex items-center justify-between">
                      <button
                        onClick={() => setConfig((c) => ({ ...c, criteria: PREDEFINED_RUBRIC }))}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-800"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Import Rubric
                      </button>
                    </div>
                    <RubricTable
                      criteria={config.criteria}
                      onChange={(criteria) => setConfig((c) => ({ ...c, criteria }))}
                    />
                  </div>
                </details>

                <details open className="rounded-xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none bg-[var(--card-border)] px-6 py-3 text-sm font-bold text-slate-800">
                    <span className="inline-flex items-center gap-1.5 text-slate-900">
                      <MessageSquare className="h-4 w-4 text-slate-800" />
                      Feedback Setting
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-amber-200/80 px-6 pb-4 pt-3">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback Format</p>
                      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&>*]:shrink-0">
                        {[
                          { value: 'paragraph' as const, label: 'Flow Text' },
                          { value: 'bullets' as const, label: 'Bullet Points' },
                        ].map((option) => (
                          <button
                            key={`setup-format-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ format: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).format === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Length</p>
                      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&>*]:shrink-0">
                        {LENGTH_TAG_OPTIONS.map((option) => (
                          <button
                            key={`setup-length-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ lengthPreset: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).lengthPreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Tone</p>
                      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&>*]:shrink-0">
                        {TONE_TAG_OPTIONS.map((option) => (
                          <button
                            key={`setup-tone-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ tonePreset: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).tonePreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Language Level (Wording)</p>
                      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&>*]:shrink-0">
                        {WORDING_TAG_OPTIONS.map((option) => (
                          <button
                            key={`setup-wording-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ englishLevelPreset: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).englishLevelPreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <textarea
                        rows={5}
                        value={config.feedbackInstructionText || ''}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            feedbackInstructionText: e.target.value,
                          }))
                        }
                        placeholder="Click tags to insert predefined prompts. You can edit this text freely."
                        className="w-full rounded-md border border-slate-300 bg-white/80 px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300"
                      />
                      <p className="mt-2 text-[11px] text-slate-600">Click tags to insert predefined prompts. You can edit this text freely.</p>
                    </div>
                  </div>
                </details>

              </div>

              <div className="sticky bottom-0 z-10 mt-4 border-t border-slate-200 bg-[var(--background)] pt-3 backdrop-blur-sm">
                <button
                  onClick={saveSetupAndEnterBuilder}
                  disabled={!validation.valid}
                  className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  Save Setup
                </button>

                {!validation.valid && (
                  <p className="mt-2 pb-2 text-center text-xs text-red-600">{validation.errors[0]}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="relative">
              <div className="flex flex-col gap-6 xl:flex-row">
                <div
                  className={`shrink-0 overflow-hidden transition-[width,opacity,transform] duration-300 ease-in-out ${configCollapsed ? 'pointer-events-none w-0 -translate-x-4 opacity-0' : 'w-full translate-x-0 opacity-100 xl:w-[420px]'}`}
                >
                  {!configCollapsed && (
                    <div className="flex h-[calc(100vh-190px)] min-h-0 w-full flex-col xl:w-[420px]">
                    {!isSetupMode && (
                      <div className="mb-3 flex items-center gap-2">
                        <select
                          value={selectedVersionId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setSelectedVersionId(id);
                            if (!activeSetId || !activeSet || !id) return;
                            const found = activeSet.versions.find((v) => v.id === id);
                            if (!found) return;
                            const now = new Date().toISOString();
                            const next = promptSets.map((row) => {
                              if (row.id !== activeSetId) return row;
                              return { ...row, config: cloneConfig(found.config), currentVersionId: found.id, updatedAt: now };
                            });
                            setConfig(cloneConfig(found.config));
                            persistSets(next, activeSetId);
                            setSavedPulse(true);
                            setTimeout(() => setSavedPulse(false), 1500);
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                          {activeVersions.map((version) => (
                            <option key={version.id} value={version.id}>
                              {version.name} • {new Date(version.createdAt).toLocaleString()}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {isSetupMode && (
                      <div className="mb-3 flex justify-end">
                        <button
                          onClick={saveBuilderConfig}
                          className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
                        >
                          {savedPulse ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                          {savedPulse ? 'Saved' : 'Save'}
                        </button>
                      </div>
                    )}

                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                      <details open className="rounded-xl border border-slate-200 bg-white">
                        <summary className="flex cursor-pointer list-none items-center justify-between bg-[var(--card-border)] px-6 py-3 text-sm font-bold text-slate-800">
                          <span className="inline-flex items-center gap-1.5 text-slate-900">
                            <FileText className="h-4 w-4 text-slate-800" />
                            Rubric Builder
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfig((c) => ({ ...c, criteria: PREDEFINED_RUBRIC })); }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-800"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            Import Rubric
                          </button>
                        </summary>
                        <div className="border-t border-slate-200 px-6 pb-4 pt-3">
                          <RubricTable
                            criteria={config.criteria}
                            onChange={(criteria) => setConfig((c) => ({ ...c, criteria }))}
                          />
                        </div>
                      </details>

                      <details open className="rounded-xl border border-slate-200 bg-white">
                        <summary className="cursor-pointer list-none bg-[var(--card-border)] px-6 py-3 text-sm font-bold text-slate-800">
                          <span className="inline-flex items-center gap-1.5 text-slate-900">
                            <MessageSquare className="h-4 w-4 text-slate-800" />
                            Feedback Setting
                          </span>
                        </summary>
                        <div className="space-y-3 border-t border-amber-200/80 px-6 pb-4 pt-3">
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback Format</p>
                            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&>*]:shrink-0">
                              {[
                                { value: 'paragraph' as const, label: 'Flow Text' },
                                { value: 'bullets' as const, label: 'Bullet Points' },
                              ].map((option) => (
                                <button
                                  key={`builder-format-${option.value}`}
                                  type="button"
                                  onClick={() => updateFeedbackBehaviorAndImport({ format: option.value })}
                                  className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).format === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Length</p>
                            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&>*]:shrink-0">
                              {LENGTH_TAG_OPTIONS.map((option) => (
                                <button
                                  key={`builder-length-${option.value}`}
                                  type="button"
                                  onClick={() => updateFeedbackBehaviorAndImport({ lengthPreset: option.value })}
                                  className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).lengthPreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Tone</p>
                            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&>*]:shrink-0">
                              {TONE_TAG_OPTIONS.map((option) => (
                                <button
                                  key={`builder-tone-${option.value}`}
                                  type="button"
                                  onClick={() => updateFeedbackBehaviorAndImport({ tonePreset: option.value })}
                                  className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).tonePreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Language Level (Wording)</p>
                            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&>*]:shrink-0">
                              {WORDING_TAG_OPTIONS.map((option) => (
                                <button
                                  key={`builder-wording-${option.value}`}
                                  type="button"
                                  onClick={() => updateFeedbackBehaviorAndImport({ englishLevelPreset: option.value })}
                                  className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).englishLevelPreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <textarea
                              rows={5}
                              value={config.feedbackInstructionText || ''}
                              onChange={(e) =>
                                setConfig((c) => ({
                                  ...c,
                                  feedbackInstructionText: e.target.value,
                                }))
                              }
                              placeholder="Click tags to insert predefined prompts. You can edit this text freely."
                              className="w-full rounded-md border border-slate-300 bg-white/80 px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300"
                            />
                            <p className="mt-2 text-[11px] text-slate-600">Click tags to insert predefined prompts. You can edit this text freely.</p>
                          </div>
                        </div>
                      </details>

                      {!validation.valid && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                          {validation.errors[0]}
                        </div>
                      )}
                      </div>

                      {!isSetupMode && (
                        <div className="sticky bottom-0 mt-3 border-t border-slate-200 bg-[var(--background)] pt-3 backdrop-blur-sm">
                          <button
                            onClick={saveBuilderConfig}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
                          >
                            {savedPulse ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                            {savedPulse ? 'Saved' : 'Save'}
                          </button>
                        </div>
                      )}
                    </div>
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-800">Student Essays</h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={addEssay}
                      disabled={essays.length >= 3 || gradingLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Essay
                    </button>
                  </div>
                </div>

                <div className="mb-4 space-y-3">
                  <div className={`grid gap-3 ${essays.length === 1 ? 'grid-cols-1' : essays.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {essays.map((essay, index) => (
                      <div key={essay.id}>
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Essay {index + 1}</p>
                          <div className="flex items-center gap-1">
                            <label className={gradingLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}>
                              <input
                                type="file"
                                accept=".txt,.md,.pdf"
                                className="hidden"
                                disabled={gradingLoading}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) uploadEssayFile(essay.id, file);
                                  e.currentTarget.value = '';
                                }}
                              />
                              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100">
                                <Upload className="h-3 w-3" />
                                Upload
                              </span>
                            </label>
                            {essays.length > 1 && (
                              <button
                                onClick={() => removeEssay(essay.id)}
                                disabled={gradingLoading}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Remove essay"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <textarea
                          value={essay.text}
                          onChange={(e) => updateEssay(essay.id, e.target.value)}
                          placeholder="Paste or type the student essay here..."
                          rows={8}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={runBuilderGrade}
                      disabled={!validation.valid || !primaryEssayText.trim() || gradingLoading}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {gradingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {gradingLoading ? 'Grading...' : `Run (${runCount}x)`}
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setRunMenuOpen((v) => !v)}
                        disabled={!validation.valid || !primaryEssayText.trim() || gradingLoading}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Select run count"
                      >
                        Run Times
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      {runMenuOpen && (
                        <div className="absolute right-0 top-11 z-20 w-36 rounded-lg border border-slate-200 bg-slate-50/95 p-1 shadow-lg backdrop-blur-sm">
                          {[1, 2, 3].map((n) => (
                            <button
                              key={n}
                              onClick={() => {
                                setRunCount(n);
                                setRunResultsByEssay([]);
                                setGradingError(null);
                                setRunMenuOpen(false);
                              }}
                              className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                            >
                              Run {n} time{n > 1 ? 's' : ''}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        const latestRun = primaryRunOutputs[primaryRunOutputs.length - 1] || null;
                        setBaselineResults(latestRun);
                        setOptimizedResults(null);
                        setCompareError(null);
                        setOptimizerSessionIterationIds([]);
                        setSelectedIterationId('');
                        setComposerAnchorIterationId(null);
                        setOptimizerGoal('');
                        setOptimizedConfig(null);
                        setComparisonByIteration({});
                        setIterationLastComparedConfigSignature({});
                        setIterationLastRunEssay({});
                        setIterationEditModeById({});
                        setLastAttemptedIterationId(null);
                        if (primaryEssayText.trim()) {
                          setPrimaryEssayText(primaryEssayText);
                        }
                        setView('optimizer');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Optimize Prompt
                    </button>
                  </div>
                </div>

                <div className="mb-3 mt-4 flex items-center justify-between">
                  <h2 className="text-sm font-medium">Results {runCount > 1 ? `(${runCount} runs)` : ''}</h2>
                  <div />
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  {gradingError && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {gradingError}
                    </div>
                  )}
                  {runResultsByEssay.some((runs) => runs.length > 0) ? (
                    <div className="space-y-3">
                      {runCount > 1 && (
                        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 text-xs">
                          <button
                            onClick={() => setResultsTab('graph')}
                            className={`rounded-md px-3 py-1.5 ${resultsTab === 'graph' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'}`}
                          >
                            Graph
                          </button>
                          <button
                            onClick={() => setResultsTab('results')}
                            className={`rounded-md px-3 py-1.5 ${resultsTab === 'results' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'}`}
                          >
                            Results
                          </button>
                        </div>
                      )}

                      {runCount > 1 && resultsTab === 'graph' ? (
                        <div className="flex gap-4 overflow-x-auto pb-1">
                          {runResultsByEssay.map((essayRuns, essayIdx) => {
                            if (essayRuns.length === 0) return null;
                            return (
                              <div key={`graph-${essayIdx}`} className="min-w-[480px] flex-1">
                                <p className="mb-2 text-sm font-medium text-slate-600">Essay {essayIdx + 1}</p>
                                <ScoreConsistencyChart essayRuns={essayRuns} criteria={config.criteria} />
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex gap-4 overflow-x-auto pb-1">
                          {runResultsByEssay.map((essayRuns, essayIdx) => {
                            if (essayRuns.length === 0) return null;
                            const runsToShow = runCount > 1 ? essayRuns : [essayRuns[essayRuns.length - 1]];
                            const multiEssay = runResultsByEssay.filter((r) => r.length > 0).length > 1;
                            const stackRuns = multiEssay && runCount > 1;
                            return (
                              <div key={`result-${essayIdx}`} className="min-w-[360px] flex-1 space-y-2">
                                <p className="text-sm font-medium text-slate-700">Essay {essayIdx + 1}</p>
                                <div className={stackRuns ? 'space-y-3' : `grid gap-3 ${runsToShow.length === 1 ? 'grid-cols-1' : runsToShow.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                                  {runsToShow.map((runRows, runIdx) => {
                                    const total = getSetTotal(runRows);
                                    const maxTotal = getMaxTotal(config.criteria);
                                    return (
                                      <div key={`essay-${essayIdx}-run-${runIdx}`} className="space-y-2">
                                        {runCount > 1 && (
                                          <p className="text-xs font-semibold text-indigo-500">Run {runIdx + 1}</p>
                                        )}
                                        <div className="flex items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                                          <div className="text-3xl font-bold leading-none text-slate-800">{total}</div>
                                          <div className="pb-0.5 text-sm font-medium text-slate-600">Overall Score</div>
                                          <div className="pb-0.5 text-sm text-slate-400">/ {maxTotal}</div>
                                        </div>
                                        <div className="overflow-hidden rounded-xl border border-slate-200">
                                          <table className="w-full text-sm">
                                            <thead className="bg-slate-50 text-slate-500">
                                              <tr>
                                                <th className="px-3 py-2 text-left font-semibold">Criterion</th>
                                                <th className="w-20 px-2 py-2 text-left font-semibold">Score</th>
                                                <th className="px-2 py-2 text-left font-semibold">Feedback</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {runRows.map((row) => {
                                                const maxScore = config.criteria.find((c) => c.name === row.criterionName)?.maxScore ?? 0;
                                                return (
                                                  <tr key={`${essayIdx}-${runIdx}-${row.criterionName}`} className="border-t border-slate-200 align-top">
                                                    <td className="px-3 py-2 font-semibold text-slate-700">{row.criterionName}</td>
                                                    <td className="px-2 py-2">
                                                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getScorePillClass(row.score, maxScore)}`}>
                                                        {row.score}/{maxScore || '?'}
                                                      </span>
                                                    </td>
                                                    <td className="px-2 py-2 text-slate-600">
                                                      <p className="text-sm">{row.justification?.[0] || 'No feedback generated.'}</p>
                                                      {row.evidenceQuotes?.length > 0 && (
                                                        <details className="mt-2">
                                                          <summary className="cursor-pointer text-xs font-medium text-indigo-500">
                                                            Evidence ({row.evidenceQuotes.length})
                                                          </summary>
                                                          <div className="mt-2 space-y-1">
                                                            {row.evidenceQuotes.map((quoteRow, quoteIdx) => (
                                                              <blockquote
                                                                key={`${essayIdx}-${runIdx}-${row.criterionName}-ev-${quoteIdx}`}
                                                                className="border-l-2 border-amber-300 pl-2 text-xs italic text-slate-600"
                                                              >
                                                                &quot;{quoteRow.quote}&quot;
                                                              </blockquote>
                                                            ))}
                                                          </div>
                                                        </details>
                                                      )}
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                      Run grading to see the results.
                    </div>
                  )}
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>
        </div>
        </div>
      )}

      {view === 'optimizer' && activeSet && (
        <div className="mx-auto w-full max-w-[2200px] px-4 py-2 pb-28">

          {/* ── Sticky header ── */}
          <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-slate-200 bg-[var(--background)] px-4 py-3 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setView('builder')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
                title="Back to Builder"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-2xl font-semibold">Improve Grading Instruction</h1>
                <p className="text-sm text-slate-500">Iteratively refine your instruction through feedback and testing.</p>
              </div>
              <button
                onClick={() => setView('dashboard')}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </button>
            </div>
          </div>

          {/* ── Step 1: Review ── */}
          <section className="mb-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Current Prompt Config</h2>
              <p className="mt-1 text-xs text-slate-500">Use the same controls as Builder: Rubric Builder and Feedback Setting.</p>
              <div className="mt-3 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                <details open className="rounded-xl border border-slate-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-[var(--card-border)] px-6 py-3 text-sm font-bold text-slate-800">
                    <span className="inline-flex items-center gap-1.5 text-slate-900">
                      <FileText className="h-4 w-4 text-slate-800" />
                      Rubric Builder
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfig((c) => ({ ...c, criteria: PREDEFINED_RUBRIC })); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-800"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Import Rubric
                    </button>
                  </summary>
                  <div className="border-t border-slate-200 px-6 pb-4 pt-3">
                    <RubricTable
                      criteria={config.criteria}
                      onChange={(criteria) => setConfig((c) => ({ ...c, criteria }))}
                    />
                  </div>
                </details>

                <details open className="rounded-xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none bg-[var(--card-border)] px-6 py-3 text-sm font-bold text-slate-800">
                    <span className="inline-flex items-center gap-1.5 text-slate-900">
                      <MessageSquare className="h-4 w-4 text-slate-800" />
                      Feedback Setting
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-amber-200/80 px-6 pb-4 pt-3">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback Format</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: 'paragraph' as const, label: 'Flow Text' },
                          { value: 'bullets' as const, label: 'Bullet Points' },
                        ].map((option) => (
                          <button
                            key={`optimizer-format-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ format: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).format === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Length</p>
                      <div className="flex flex-wrap gap-2">
                        {LENGTH_TAG_OPTIONS.map((option) => (
                          <button
                            key={`optimizer-length-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ lengthPreset: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).lengthPreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Tone</p>
                      <div className="flex flex-wrap gap-2">
                        {TONE_TAG_OPTIONS.map((option) => (
                          <button
                            key={`optimizer-tone-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ tonePreset: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).tonePreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Language Level (Wording)</p>
                      <div className="flex flex-wrap gap-2">
                        {WORDING_TAG_OPTIONS.map((option) => (
                          <button
                            key={`optimizer-wording-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ englishLevelPreset: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).englishLevelPreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback Instructions</p>
                      <textarea
                        rows={5}
                        value={config.feedbackInstructionText || ''}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            feedbackInstructionText: e.target.value,
                          }))
                        }
                        placeholder="Click tags to insert predefined prompts. You can edit this text freely."
                        className="w-full rounded-md border border-slate-300 bg-white/80 px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300"
                      />
                      <p className="mt-2 text-[11px] text-slate-600">Click tags to insert predefined prompts. You can edit this text freely.</p>
                    </div>
                  </div>
                </details>

                {!validation.valid && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                    {validation.errors[0]}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Baseline Grading Results</h2>
              <p className="mt-1 text-xs text-slate-500">Latest Builder run for this config.</p>
              {latestBuilderRun.length > 0 ? (
                <div className="mt-3 space-y-3">
                  <div className="flex items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-3xl font-bold leading-none text-slate-800">{getSetTotal(latestBuilderRun)}</div>
                    <div className="pb-0.5 text-sm font-medium text-slate-600">Overall Score</div>
                    <div className="pb-0.5 text-sm text-slate-400">/ {getMaxTotal(config.criteria)}</div>
                  </div>

                  <div className="max-h-[380px] overflow-y-auto">
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Criterion</th>
                            <th className="w-20 px-2 py-2 text-left font-semibold">Score</th>
                            <th className="px-2 py-2 text-left font-semibold">Feedback</th>
                          </tr>
                        </thead>
                        <tbody>
                          {latestBuilderRun.map((row) => {
                            const maxScore = config.criteria.find((c) => c.name === row.criterionName)?.maxScore ?? 0;
                            return (
                              <tr key={`baseline-${row.criterionName}`} className="border-t border-slate-200 align-top">
                                <td className="px-3 py-2 font-semibold text-slate-700">{row.criterionName}</td>
                                <td className="px-2 py-2">
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getScorePillClass(row.score, maxScore)}`}>
                                    {row.score}/{maxScore || '?'}
                                  </span>
                                </td>
                                <td className="px-2 py-2 text-slate-600">
                                  <p className="text-sm">{row.justification?.[0] || 'No feedback generated.'}</p>
                                  {row.evidenceQuotes?.length > 0 && (
                                    <div className="mt-2">
                                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                        Evidence ({row.evidenceQuotes.length})
                                      </p>
                                      <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-500">
                                        {row.evidenceQuotes.map((quoteRow, quoteIdx) => (
                                          <li key={`baseline-${row.criterionName}-evidence-${quoteIdx}`}>
                                            {quoteRow.quote}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                  Run grading in Builder first to see baseline results here.
                </div>
              )}
            </div>
          </section>

          {/* ── Step 2: Feedback Composer ── */}
          {(!composerAnchorIterationId || !comparisonByIteration[composerAnchorIterationId]) && (
            <section ref={feedbackComposerRef} className="mb-6">
              {renderFeedbackComposer()}
            </section>
          )}

          {/* ── Steps 3–5: Iteration History ── */}
          {showIterationHistory && (
            <section>
            
              <div className="space-y-4">
                {iterationTimeline.map((iteration, index) => {
                  const iterationIndex = index + 1;
                  const iterationCompare = comparisonByIteration[iteration.id];
                  const isComparing = compareLoadingId === iteration.id;
                  const lastEssay = iterationLastRunEssay[iteration.id];
                  const essayChangedSinceCompare = !!iterationCompare && lastEssay !== undefined && lastEssay !== primaryEssayText;
                  const baselineComparedSignature = iterationLastComparedConfigSignature[iteration.id];
                  const configChangedSinceCompare =
                    !!iterationCompare &&
                    typeof baselineComparedSignature === 'string' &&
                    baselineComparedSignature !== getConfigSignature(iteration.revisedConfig);
                  const isDirty = essayChangedSinceCompare || configChangedSinceCompare;
                  const isClean = !!iterationCompare && !isDirty;

                  const compareLabel = isComparing
                    ? 'Grading…'
                    : isDirty
                    ? 'Re-run (essay changed)'
                    : isClean
                    ? 'Re-run'
                    : 'Grade and Compare';

                  const compareIcon = isComparing
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : isClean || isDirty
                    ? <FlaskConical className="h-4 w-4" />
                    : <FlaskConical className="h-4 w-4" />;

                  const isNewest = index === iterationTimeline.length - 1;

                  return (
                    <div key={iteration.id} className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-slate-900">Iteration {iterationIndex}</p>
                          <div
                            className="group relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700"
                            role="img"
                            aria-label="Feedback info"
                          >
                            <Info className="h-3.5 w-3.5" />
                            <div className="pointer-events-none invisible absolute left-0 top-[calc(100%+8px)] z-20 w-[min(360px,calc(100vw-2rem))] rounded-md border border-slate-300 bg-white p-3 text-left opacity-0 shadow-lg transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Feedback applied</p>
                              <p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">{iteration.feedback || 'No feedback text.'}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isDirty && (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                              {configChangedSinceCompare ? 'Draft edited' : 'Essay changed'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        ref={(el) => { if (isNewest) newestIterationRef.current = el; }}
                        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                      >
                      {/* Config side-by-side */}
                      <div className="mb-4">
                        <IterationConfigReviewEditor
                          baselineConfig={iteration.baselineConfig}
                          revisedConfig={iteration.revisedConfig}
                          configStartNumber={iterationIndex}
                          onChange={(next) => updateIterationRevisedConfig(iteration.id, next)}
                          isRubricEditing={Boolean(iterationEditModeById[iteration.id])}
                          onToggleRubricEdit={() =>
                            setIterationEditModeById((prev) => ({
                              ...prev,
                              [iteration.id]: !prev[iteration.id],
                            }))
                          }
                        />
                      </div>

                      {/* Run Comparison block */}
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Run Comparison</p>
                        <textarea
                          rows={4}
                          value={primaryEssayText}
                          onChange={(e) => setPrimaryEssayText(e.target.value)}
                          placeholder="Paste the student essay to compare both configs…"
                          className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                        <button
                          onClick={() => runCompareForIteration(iteration.id)}
                          disabled={!primaryEssayText.trim() || compareLoading || isComparing}
                          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isDirty ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                        >
                          {compareIcon}
                          {compareLabel}
                        </button>
                        {lastAttemptedIterationId === iteration.id && compareError && !iterationCompare && (
                          <p className="mt-1 text-xs text-red-600">{compareError}</p>
                        )}
                      </div>

                      {/* Side-by-side grading results */}
                      {iterationCompare && (
                        <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
                          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">Grading Results</p>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <CompareResultColumn
                              title="Older Version"
                              total={getSetTotal(iterationCompare.baseline)}
                              maxTotal={getMaxTotal(iteration.baselineConfig.criteria)}
                              rows={iterationCompare.baseline}
                              criteria={iteration.baselineConfig.criteria}
                              accent="slate"
                            />
                            <CompareResultColumn
                              title="Newer Version"
                              total={getSetTotal(iterationCompare.revised)}
                              maxTotal={getMaxTotal(iteration.revisedConfig.criteria)}
                              rows={iterationCompare.revised}
                              criteria={iteration.revisedConfig.criteria}
                              accent="indigo"
                            />
                          </div>
                        </div>
                      )}

                      {/* Continue from here (only after comparison) */}
                      {iterationCompare && (
                        <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                          <p className="mb-2 text-xs font-semibold text-indigo-800">Continue from this iteration</p>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedIterationId(iteration.id);
                              setOptimizedConfig(cloneConfig(iteration.revisedConfig));
                              setOptimizerGoal('');
                              setComposerAnchorIterationId(iteration.id);
                              feedbackComposerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                            Revise from here
                          </button>
                          <p className="mt-1 text-[11px] text-indigo-600">Uses this iteration as the base for the next revision.</p>
                        </div>
                      )}

                        {composerAnchorIterationId === iteration.id && iterationCompare && (
                          <div ref={feedbackComposerRef} className="mt-4">
                            {renderFeedbackComposer()}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Sticky bottom Apply bar ── */}
      {view === 'optimizer' && activeSet && sessionIterations.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-[var(--background)] px-4 py-3 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <Sparkles className="h-4 w-4 shrink-0 text-indigo-500" />
            <select
              value={selectedIterationId}
              onChange={(e) => setSelectedIterationId(e.target.value)}
              className="w-full sm:min-w-[220px] sm:w-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value={ORIGINAL_CONFIG_OPTION}>Original Config</option>
              {iterationTimeline.map((iteration, idx) => (
                <option key={iteration.id} value={iteration.id}>
                  Config {idx + 1}
                </option>
              ))}
            </select>
            <p className="hidden text-xs text-slate-500 sm:block">Select the config to import to Builder</p>
            <button
              onClick={handleApplyIteration}
              disabled={!selectedIterationId}
              className="sm:ml-auto inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Import Config to Builder
            </button>
          </div>
        </div>
      )}
      </div>
    </motion.section>
  );
}

