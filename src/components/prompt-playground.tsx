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
import type { CriterionLevel } from '@/types';

const SETS_STORAGE_KEY = 'prompt-playground-sets-v2';
const ACTIVE_SET_KEY = 'prompt-playground-active-set-id-v2';
const ORIGINAL_CONFIG_OPTION = '__original_config__';
const DEBUG_PLAYGROUND_PROMPT = true;

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
    id: 1,
    name: 'Ideas',
    scoreRange: { min: 0, max: 3 },
    levels: [
      { score: 3, description: 'Tells a story with ideas that are clearly focused on the topic and are thoroughly developed with specific, relevant details.' },
      { score: 2, description: 'Tells a story with ideas that are somewhat focused on the topic and are developed with a mix of specific and/or general details.' },
      { score: 1, description: 'Tells a story with ideas that are minimally focused on the topic and developed with limited and/or general details.' },
      { score: 0, description: 'Ideas are not focused on the task and/or are undeveloped.' },
    ],
  },
  {
    id: 2,
    name: 'Organization',
    scoreRange: { min: 0, max: 3 },
    levels: [
      { score: 3, description: 'Organization and connections between ideas and/or events are clear and logically sequenced.' },
      { score: 2, description: 'Organization and connections between ideas and/or events are logically sequenced.' },
      { score: 1, description: 'Organization and connections between ideas and/or events are weak.' },
      { score: 0, description: 'No organization evident.' },
    ],
  },
  {
    id: 3,
    name: 'Style',
    scoreRange: { min: 0, max: 3 },
    levels: [
      { score: 3, description: "Command of language, including effective and compelling word choice and varied sentence structure, clearly supports the writer's purpose and audience." },
      { score: 2, description: "Adequate command of language, including effective word choice and clear sentences, supports the writer's purpose and audience." },
      { score: 1, description: "Limited use of language, including lack of variety in word choice and sentences, may hinder support for the writer's purpose and audience." },
      { score: 0, description: "Ineffective use of language for the writer's purpose and audience." },
    ],
  },
  {
    id: 4,
    name: 'Conventions',
    scoreRange: { min: 0, max: 3 },
    levels: [
      { score: 3, description: 'Consistent, appropriate use of conventions of Standard English for grammar, usage, spelling, capitalization, and punctuation for the grade level.' },
      { score: 2, description: 'Adequate use of conventions of Standard English for grammar, usage, spelling, capitalization, and punctuation for the grade level.' },
      { score: 1, description: 'Limited use of conventions of Standard English for grammar, usage, spelling, capitalization, and punctuation for the grade level.' },
      { score: 0, description: 'Ineffective use of conventions of Standard English for grammar, usage, spelling, capitalization, and punctuation.' },
    ],
  },
];

const EXAMPLE_RUBRIC: RubricCriterion[] = [
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
  runtime: SetRuntimeState;
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
  prompts?: Array<{ criterionName: string; prompt: string }>;
  outputs?: Array<{ criterionName: string; output: string }>;
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

type SetRuntimeState = {
  essays: EssayItem[];
  runResultsByEssay: TestResult[][][];
  runMetadata: RunMetadata | null;
  runConfig: BuilderPromptConfig | null;
  runCount: number;
  resultsTab: 'graph' | 'results';
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
      id: 1,
      name: '',
      scoreRange: { min: 0, max: 3 },
      levels: [{ score: 3, description: '' }, { score: 2, description: '' }, { score: 1, description: '' }, { score: 0, description: '' }],
    },
  ],
  showAdditionalMaterial: false,
  additionalMaterial: '',
  showAdditionalDescription: false,
  additionalDescription: '',
  feedbackBehavior: { ...DEFAULT_FEEDBACK_BEHAVIOR },
  feedbackInstructionText: '',
});

const makeDefaultEssays = (): EssayItem[] => [{ id: crypto.randomUUID(), text: '' }];

const makeDefaultSetRuntime = (): SetRuntimeState => ({
  essays: makeDefaultEssays(),
  runResultsByEssay: [],
  runMetadata: null,
  runConfig: null,
  runCount: 1,
  resultsTab: 'results',
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

function migrateCriteria(raw: unknown[]): RubricCriterion[] {
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { id: index + 1, name: '', scoreRange: { min: 0, max: 3 }, levels: [] };
    }
    const c = item as Record<string, unknown>;

    let scoreRange: { min: number; max: number };
    if (c.scoreRange && typeof c.scoreRange === 'object' && !Array.isArray(c.scoreRange)) {
      const sr = c.scoreRange as { min?: unknown; max?: unknown };
      scoreRange = { min: typeof sr.min === 'number' ? sr.min : 0, max: typeof sr.max === 'number' ? sr.max : 3 };
    } else {
      scoreRange = { min: typeof c.minScore === 'number' ? c.minScore : 0, max: typeof c.maxScore === 'number' ? c.maxScore : 3 };
    }

    let levels: CriterionLevel[];
    if (Array.isArray(c.levels) && c.levels.every((l) => l && typeof l === 'object' && 'score' in l)) {
      levels = (c.levels as Array<{ score: unknown; description: unknown }>).map((l) => ({
        score: typeof l.score === 'number' ? l.score : Number(l.score),
        description: typeof l.description === 'string' ? l.description : '',
      }));
    } else if (c.levels && typeof c.levels === 'object' && !Array.isArray(c.levels)) {
      levels = Object.entries(c.levels as Record<string, string>)
        .map(([key, description]) => ({ score: Number(key), description: String(description) }))
        .filter((l) => Number.isFinite(l.score));
    } else {
      levels = [];
      for (let score = scoreRange.max; score >= scoreRange.min; score -= 1) {
        levels.push({ score, description: '' });
      }
    }

    const id = typeof c.id === 'number' ? c.id : index + 1;
    return { id, name: typeof c.name === 'string' ? c.name : '', scoreRange, levels };
  });
}

function normalizeSet(raw: EditableSet): EditableSet {
  const fallback = makeDefaultConfig();
  const config: BuilderPromptConfig = {
    ...fallback,
    ...(raw.config || fallback),
    criteria: Array.isArray(raw.config?.criteria) && raw.config.criteria.length > 0
      ? migrateCriteria(raw.config.criteria)
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
            ? migrateCriteria(version.config.criteria)
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
            ? migrateCriteria(iteration.baselineConfig.criteria)
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
            ? migrateCriteria(iteration.revisedConfig.criteria)
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

  const rawRuntime = (raw as Partial<EditableSet>).runtime;
  const normalizedEssays =
    rawRuntime && Array.isArray((rawRuntime as Partial<SetRuntimeState>).essays)
      ? ((rawRuntime as Partial<SetRuntimeState>).essays as unknown[])
          .filter((essay) => essay && typeof essay === 'object')
          .map((essay, index) => {
            const row = essay as Record<string, unknown>;
            return {
              id: typeof row.id === 'string' && row.id.trim() ? row.id : `essay-${index + 1}`,
              text: typeof row.text === 'string' ? row.text : '',
            };
          })
          .filter((essay) => typeof essay.id === 'string')
      : [];

  const runtime: SetRuntimeState = {
    essays: normalizedEssays.length > 0 ? normalizedEssays : makeDefaultEssays(),
    runResultsByEssay:
      rawRuntime && Array.isArray((rawRuntime as Partial<SetRuntimeState>).runResultsByEssay)
        ? ((rawRuntime as Partial<SetRuntimeState>).runResultsByEssay as unknown[]).map((essayRuns) =>
            Array.isArray(essayRuns)
              ? essayRuns.map((singleRun) => normalizeTestResults(singleRun))
              : []
          )
        : [],
    runMetadata:
      rawRuntime && (rawRuntime as Partial<SetRuntimeState>).runMetadata && typeof (rawRuntime as Partial<SetRuntimeState>).runMetadata === 'object'
        ? ({
            mode: 'parity',
            importable: Boolean(((rawRuntime as Partial<SetRuntimeState>).runMetadata as Partial<RunMetadata>)?.importable),
            prompts: Array.isArray(((rawRuntime as Partial<SetRuntimeState>).runMetadata as Partial<RunMetadata>)?.prompts)
              ? (((rawRuntime as Partial<SetRuntimeState>).runMetadata as Partial<RunMetadata>).prompts as Array<{ criterionName?: unknown; prompt?: unknown }>).filter(
                  (row): row is { criterionName: string; prompt: string } =>
                    typeof row.criterionName === 'string' && typeof row.prompt === 'string'
                )
              : undefined,
            outputs: Array.isArray(((rawRuntime as Partial<SetRuntimeState>).runMetadata as Partial<RunMetadata>)?.outputs)
              ? (((rawRuntime as Partial<SetRuntimeState>).runMetadata as Partial<RunMetadata>).outputs as Array<{ criterionName?: unknown; output?: unknown }>).filter(
                  (row): row is { criterionName: string; output: string } =>
                    typeof row.criterionName === 'string' && typeof row.output === 'string'
                )
              : undefined,
          } as RunMetadata)
        : null,
    runConfig:
      rawRuntime && (rawRuntime as Partial<SetRuntimeState>).runConfig && typeof (rawRuntime as Partial<SetRuntimeState>).runConfig === 'object'
        ? ({
            ...fallback,
            ...((rawRuntime as Partial<SetRuntimeState>).runConfig as Partial<BuilderPromptConfig>),
            criteria:
              Array.isArray(((rawRuntime as Partial<SetRuntimeState>).runConfig as Partial<BuilderPromptConfig>)?.criteria) &&
              (((rawRuntime as Partial<SetRuntimeState>).runConfig as Partial<BuilderPromptConfig>).criteria?.length || 0) > 0
                ? migrateCriteria(((rawRuntime as Partial<SetRuntimeState>).runConfig as Partial<BuilderPromptConfig>).criteria as unknown[])
                : fallback.criteria,
            feedbackBehavior: {
              ...DEFAULT_FEEDBACK_BEHAVIOR,
              ...((((rawRuntime as Partial<SetRuntimeState>).runConfig as Partial<BuilderPromptConfig>)?.feedbackBehavior as
                | Partial<FeedbackBehaviorConfig>
                | undefined) || {}),
            },
            feedbackInstructionText:
              typeof ((rawRuntime as Partial<SetRuntimeState>).runConfig as Partial<BuilderPromptConfig>)?.feedbackInstructionText === 'string'
                ? (((rawRuntime as Partial<SetRuntimeState>).runConfig as Partial<BuilderPromptConfig>).feedbackInstructionText as string)
                : '',
          } as BuilderPromptConfig)
        : null,
    runCount:
      rawRuntime && typeof (rawRuntime as Partial<SetRuntimeState>).runCount === 'number'
        ? Math.min(3, Math.max(1, Math.floor((rawRuntime as Partial<SetRuntimeState>).runCount as number)))
        : 1,
    resultsTab:
      rawRuntime && (rawRuntime as Partial<SetRuntimeState>).resultsTab === 'graph'
        ? 'graph'
        : 'results',
  };

  // Migrate legacy runtime entries: preserve the set's saved config as a frozen run snapshot.
  if (!runtime.runConfig && runtime.runResultsByEssay.some((essayRuns) => essayRuns.length > 0)) {
    runtime.runConfig = cloneConfig(config);
  }

  return {
    id: raw.id || crypto.randomUUID(),
    name: raw.name || 'Untitled Prompt',
    config,
    configured: !!raw.configured,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    versions,
    currentVersionId,
    optimizationIterations,
    runtime,
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

  const updateCriterion = (id: number, patch: Partial<RubricCriterion>) => {
    onChange(
      criteria.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        if ('scoreRange' in patch) {
          const { min, max } = next.scoreRange;
          const existingLevels = next.levels;
          const newLevels: CriterionLevel[] = [];
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
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <input
              type="number"
              min={0}
              value={criterion.scoreRange.min}
              onChange={(e) => updateCriterion(criterion.id, { scoreRange: { ...criterion.scoreRange, min: Number(e.target.value) } })}
              className="w-14 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              title="Min score"
            />
            <input
              type="number"
              min={1}
              value={criterion.scoreRange.max}
              onChange={(e) => updateCriterion(criterion.id, { scoreRange: { ...criterion.scoreRange, max: Number(e.target.value) } })}
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
                {[...criterion.levels]
                  .sort((a, b) => b.score - a.score)
                  .map((level) => (
                    <tr key={level.score} className="border-t border-slate-200">
                      <td className="border-r border-slate-200 py-2 text-center font-semibold text-slate-700">
                        {level.score}
                      </td>
                      <td className="p-2">
                        <textarea
                          rows={2}
                          value={level.description}
                          onChange={(e) => updateLevel(criterion.id, level.score, e.target.value)}
                          placeholder={`Description for score ${level.score}`}
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
    matched && matched.scoreRange.max > matched.scoreRange.min
      ? ((result.score - matched.scoreRange.min) / (matched.scoreRange.max - matched.scoreRange.min)) * 100
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
            {result.score}/{matched?.scoreRange.max ?? '?'}
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
    return <p className="whitespace-pre-wrap text-xs leading-4 text-slate-700">{plain}</p>;
  }

  const ops = useMemo(() => buildWordDiffOps(oldText || '', newText || ''), [oldText, newText]);

  if (!ops.length) {
    return <p className="text-xs text-slate-400">No text.</p>;
  }

  return (
    <p className="whitespace-pre-wrap text-xs leading-4 text-slate-700">
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
  isFeedbackEditing,
  onToggleFeedbackEdit,
}: {
  baselineConfig: BuilderPromptConfig;
  revisedConfig: BuilderPromptConfig;
  configStartNumber: number;
  onChange: (next: BuilderPromptConfig) => void;
  isRubricEditing: boolean;
  onToggleRubricEdit: () => void;
  isFeedbackEditing: boolean;
  onToggleFeedbackEdit: () => void;
}) {
  const baselineInstruction = getEffectiveFeedbackInstructionText(baselineConfig);
  const revisedInstruction = getEffectiveFeedbackInstructionText(revisedConfig);
  const baselineBehavior = getFeedbackBehavior(baselineConfig);
  const revisedBehavior = getFeedbackBehavior(revisedConfig);

  const rubricChanged = JSON.stringify(baselineConfig.criteria) !== JSON.stringify(revisedConfig.criteria);
  const feedbackBehaviorChanged = JSON.stringify(baselineBehavior) !== JSON.stringify(revisedBehavior);
  const feedbackChanged = feedbackBehaviorChanged || baselineInstruction !== revisedInstruction;

  const updateCriterion = (criterionId: number, patch: Partial<RubricCriterion>) => {
    const nextCriteria = revisedConfig.criteria.map((criterion) => {
      if (criterion.id !== criterionId) return criterion;
      const next = { ...criterion, ...patch };
      if ('scoreRange' in patch) {
        const { min, max } = next.scoreRange;
        const existingLevels = next.levels;
        const newLevels: CriterionLevel[] = [];
        for (let score = max; score >= min; score -= 1) {
          const existing = existingLevels.find((l) => l.score === score);
          newLevels.push({ score, description: existing?.description ?? '' });
        }
        next.levels = newLevels;
      }
      return next;
    });
    onChange({ ...revisedConfig, criteria: nextCriteria });
  };

  const updateLevel = (criterionId: number, score: number, text: string) => {
    const nextCriteria = revisedConfig.criteria.map((criterion) => {
      if (criterion.id !== criterionId) return criterion;
      return {
        ...criterion,
        levels: criterion.levels.map((l) => l.score === score ? { ...l, description: text } : l),
      };
    });
    onChange({ ...revisedConfig, criteria: nextCriteria });
  };

  const updateFeedbackBehavior = (patch: Partial<FeedbackBehaviorConfig>) => {
    onChange({
      ...revisedConfig,
      feedbackBehavior: {
        ...revisedBehavior,
        ...patch,
      },
    });
  };

  const updateFeedbackInstructionText = (text: string) => {
    onChange({
      ...revisedConfig,
      feedbackInstructionText: text,
    });
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
    const sortedLevels = [...criterion.levels].sort((a, b) => b.score - a.score);
    const hasBaseline = Boolean(baselineCriterion);
    return (
      <div
        key={`${keyPrefix}-${criterion.id}`}
        className="h-full py-1"
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
                value={criterion.scoreRange.min}
                onChange={(e) => updateCriterion(criterion.id, { scoreRange: { ...criterion.scoreRange, min: Number(e.target.value) } })}
                className="w-10 rounded-md border border-slate-200 px-1.5 py-0.5 text-center text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
              <span className="text-xs text-slate-500">-</span>
              <input
                type="number"
                min={1}
                value={criterion.scoreRange.max}
                onChange={(e) => updateCriterion(criterion.id, { scoreRange: { ...criterion.scoreRange, max: Number(e.target.value) } })}
                className="w-10 rounded-md border border-slate-200 px-1.5 py-0.5 text-center text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
          ) : (
            <span className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              {criterion.scoreRange.min}-{criterion.scoreRange.max}
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
              {sortedLevels.map((level) => {
                const levelText = level.description;
                const oldLevelText = baselineCriterion?.levels?.find((l) => l.score === level.score)?.description ?? '';
                return (
                  <tr key={`${keyPrefix}-${criterion.id}-${level.score}`} className="border-t border-slate-200 align-top">
                    <td className="border-r border-slate-200 px-2 py-2 font-semibold text-slate-700">{level.score}</td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <textarea
                          rows={2}
                          value={levelText}
                          onChange={(e) => updateLevel(criterion.id, level.score, e.target.value)}
                          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                        />
                      ) : (
                        hasBaseline ? (
                          <DiffTextPreview oldText={oldLevelText} newText={levelText} mode="new" />
                        ) : (
                          <p className="whitespace-pre-wrap text-xs leading-4 text-slate-700">{levelText || 'Not set'}</p>
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
              Rubric
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--card-border)] px-4 py-3 text-sm font-bold text-slate-800">
            <span className="inline-flex items-center gap-1.5 text-slate-900">
              <FileText className="h-4 w-4 text-slate-800" />
              Rubric
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
              <div className="min-w-0 lg:pl-4">
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
                onToggleFeedbackEdit();
              }}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${isFeedbackEditing ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              <Pencil className="h-3.5 w-3.5" />
              {isFeedbackEditing ? 'Done Editing' : 'Edit'}
            </button>
          </div>
        </summary>
        <div className="grid gap-3 border-t border-slate-200 px-4 pb-4 pt-3 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Feedback Format</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {[
                { value: 'paragraph' as const, label: 'Flow Text' },
                { value: 'bullets' as const, label: 'Bullet Points' },
              ].map((option) => (
                <span
                  key={`baseline-format-${option.value}`}
                  className={`inline-flex rounded-full border px-3 py-1 text-xs ${baselineBehavior.format === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700'}`}
                >
                  {option.label}
                </span>
              ))}
            </div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Feedback Length</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {LENGTH_TAG_OPTIONS.map((option) => (
                <span
                  key={`baseline-length-${option.value}`}
                  className={`inline-flex rounded-full border px-3 py-1 text-xs ${baselineBehavior.lengthPreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700'}`}
                >
                  {option.label}
                </span>
              ))}
            </div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Feedback Instructions</p>
            <DiffTextPreview oldText={baselineInstruction} newText={revisedInstruction} mode="old" />
          </div>
          <div className="lg:pl-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Feedback Format</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {[
                { value: 'paragraph' as const, label: 'Flow Text' },
                { value: 'bullets' as const, label: 'Bullet Points' },
              ].map((option) => (
                isFeedbackEditing ? (
                  <button
                    key={`iteration-format-${option.value}`}
                    type="button"
                    onClick={() => updateFeedbackBehavior({ format: option.value })}
                    className={`rounded-full border px-3 py-1 text-xs ${revisedBehavior.format === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                  >
                    {option.label}
                  </button>
                ) : (
                  <span
                    key={`iteration-format-${option.value}`}
                    className={`inline-flex rounded-full border px-3 py-1 text-xs ${revisedBehavior.format === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700'}`}
                  >
                    {option.label}
                  </span>
                )
              ))}
            </div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Feedback Length</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {LENGTH_TAG_OPTIONS.map((option) => (
                isFeedbackEditing ? (
                  <button
                    key={`iteration-length-${option.value}`}
                    type="button"
                    onClick={() => updateFeedbackBehavior({ lengthPreset: option.value })}
                    className={`rounded-full border px-3 py-1 text-xs ${revisedBehavior.lengthPreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700 hover:bg-white'}`}
                  >
                    {option.label}
                  </button>
                ) : (
                  <span
                    key={`iteration-length-${option.value}`}
                    className={`inline-flex rounded-full border px-3 py-1 text-xs ${revisedBehavior.lengthPreset === option.value ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-300 bg-slate-100/80 text-slate-700'}`}
                  >
                    {option.label}
                  </span>
                )
              ))}
            </div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Feedback Instructions</p>
            {isFeedbackEditing ? (
              <textarea
                rows={5}
                value={revisedConfig.feedbackInstructionText || ''}
                onChange={(e) => updateFeedbackInstructionText(e.target.value)}
                placeholder="Add extra guidance for how feedback should be written..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
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

  const yMin = criteria.length > 0 ? Math.min(...criteria.map((c) => c.scoreRange.min)) : 0;
  const yMax = Math.max(...criteria.map((c) => c.scoreRange.max), yMin + 1);
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

  const maxTotal = criteria.reduce((sum, c) => sum + c.scoreRange.max, 0);
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
  feedbackFormat,
  accent,
}: {
  title: string;
  total: number;
  maxTotal: number;
  rows: TestResult[];
  criteria: RubricCriterion[];
  feedbackFormat: 'paragraph' | 'bullets';
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
              const maxForCriterion = criteria.find((c) => c.name === row.criterionName)?.scoreRange.max ?? 0;
              return (
                <tr key={`${title}-${row.criterionName}`} className="border-t border-slate-200 align-top">
                  <td className="px-3 py-2 font-semibold text-slate-700">{row.criterionName}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getScorePillClass(row.score, maxForCriterion)}`}>
                      {row.score}/{maxForCriterion || '?'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {row.justification?.length > 0 ? (
                      feedbackFormat === 'bullets' ? (
                        <ul className="list-disc space-y-1 pl-4 text-sm">
                          {row.justification.map((part, idx) => (
                            <li key={`${title}-${row.criterionName}-j-${idx}`}>{part}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="space-y-1 text-sm">
                          {row.justification.map((part, idx) => (
                            <p key={`${title}-${row.criterionName}-j-${idx}`}>{part}</p>
                          ))}
                        </div>
                      )
                    ) : (
                      <p className="text-sm">No feedback generated.</p>
                    )}
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
  return criteria.reduce((sum, c) => sum + c.scoreRange.max, 0);
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
    if ((criterion.scoreRange.max ?? 0) <= 0) {
      errors.push(`Criterion ${index + 1}: Max score must be > 0`);
    }
    if ((criterion.scoreRange.min ?? 0) < 0) {
      errors.push(`Criterion ${index + 1}: Min score cannot be negative`);
    }
    if ((criterion.scoreRange.min ?? 0) >= (criterion.scoreRange.max ?? 0)) {
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

function getEffectiveFeedbackInstructionText(config: BuilderPromptConfig): string {
  return typeof config.feedbackInstructionText === 'string' ? config.feedbackInstructionText.trim() : '';
}

function buildPromptSlotsFromConfig(config: BuilderPromptConfig): EditablePromptSlots {
  const behavior = getFeedbackBehavior(config);
  const feedbackInstructionText = getEffectiveFeedbackInstructionText(config);
  return {
    lengthInstruction: getDefaultLengthInstruction(behavior.lengthPreset),
    toneInstruction: getDefaultToneInstruction(behavior.tonePreset),
    englishLevelInstruction: getDefaultEnglishInstruction(behavior.englishLevelPreset),
    justificationStructureInstruction: feedbackInstructionText || undefined,
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

function getAssessmentLengthFromConfig(config: BuilderPromptConfig): 'short' | 'medium' | 'long' {
  const behavior = getFeedbackBehavior(config);
  return behavior.lengthPreset;
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
  next.feedbackInstructionText = next.feedbackInstructionText?.trim()
    ? `${next.feedbackInstructionText.trim()}\n\n${line}`
    : line;
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

  const [essays, setEssays] = useState<EssayItem[]>(makeDefaultEssays);
  const [gradingLoading, setGradingLoading] = useState(false);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [runResultsByEssay, setRunResultsByEssay] = useState<TestResult[][][]>([]);
  const [runMetadata, setRunMetadata] = useState<RunMetadata | null>(null);
  const [runConfig, setRunConfig] = useState<BuilderPromptConfig | null>(null);
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
  const [iterationFeedbackEditModeById, setIterationFeedbackEditModeById] = useState<Record<string, boolean>>({});
  const newestIterationRef = useRef<HTMLDivElement | null>(null);
  const [optimizerSessionIterationIds, setOptimizerSessionIterationIds] = useState<string[]>([]);

  const activeSet = useMemo(
    () => promptSets.find((row) => row.id === activeSetId) ?? null,
    [promptSets, activeSetId]
  );

  const applyRuntimeState = useCallback((runtime: SetRuntimeState) => {
    setEssays(runtime.essays.length > 0 ? runtime.essays : makeDefaultEssays());
    setRunResultsByEssay(runtime.runResultsByEssay || []);
    setRunMetadata(runtime.runMetadata || null);
    setRunConfig(runtime.runConfig || null);
    setRunCount(Math.min(3, Math.max(1, runtime.runCount || 1)));
    setResultsTab(runtime.resultsTab === 'graph' ? 'graph' : 'results');
    setGradingError(null);
  }, []);

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
          applyRuntimeState(chosen.runtime || makeDefaultSetRuntime());
        }
      }
    } catch {
      setPromptSets([]);
    }
  }, [applyRuntimeState]);

  useEffect(() => {
    if (!activeSetId || !activeSet) return;

    const nextRuntime: SetRuntimeState = {
      essays: essays.length > 0 ? essays : makeDefaultEssays(),
      runResultsByEssay,
      runMetadata,
      runConfig,
      runCount,
      resultsTab,
    };

    const currentSerialized = JSON.stringify(activeSet.runtime);
    const nextSerialized = JSON.stringify(nextRuntime);
    if (currentSerialized === nextSerialized) return;

    const nextSets = promptSets.map((row) =>
      row.id === activeSetId
        ? {
            ...row,
            runtime: nextRuntime,
          }
        : row
    );

    setPromptSets(nextSets);
    localStorage.setItem(SETS_STORAGE_KEY, JSON.stringify(nextSets));
  }, [activeSet, activeSetId, essays, promptSets, resultsTab, runConfig, runCount, runMetadata, runResultsByEssay]);

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
      runtime: makeDefaultSetRuntime(),
    };

    const next = [item, ...promptSets];
    persistSets(next, item.id);
    setConfig(cloneConfig(item.config));
    setRenameValue(item.name);
    setSelectedVersionId('');
    applyRuntimeState(item.runtime);
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
    applyRuntimeState(found.runtime || makeDefaultSetRuntime());
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
        applyRuntimeState(selected.runtime || makeDefaultSetRuntime());
      }
    } else {
      setConfig(makeDefaultConfig());
      setRenameValue('');
      setSelectedVersionId('');
      setSelectedIterationId('');
      applyRuntimeState(makeDefaultSetRuntime());
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
        min: criterion.scoreRange.min,
        max: criterion.scoreRange.max,
      },
    }));

    const result = await gradePlaygroundWithConfig({
      essayText: essay,
      criteria: parityCriteria,
      promptSlots: buildPromptSlotsFromConfig(targetConfig),
      styleOverrides: buildStyleOverridesFromConfig(targetConfig),
      assessmentType: getAssessmentTypeFromConfig(targetConfig),
      assessmentLength: getAssessmentLengthFromConfig(targetConfig),
      debugPrompt: DEBUG_PLAYGROUND_PROMPT,
    });

    const metadataRaw = (result as { metadata?: Partial<RunMetadata> }).metadata;
    const metadata: RunMetadata = {
      mode: 'parity',
      importable: Boolean(metadataRaw?.importable),
      prompts: Array.isArray(metadataRaw?.prompts)
        ? metadataRaw.prompts.filter(
            (row): row is { criterionName: string; prompt: string } =>
              !!row &&
              typeof row === 'object' &&
              typeof (row as { criterionName?: unknown }).criterionName === 'string' &&
              typeof (row as { prompt?: unknown }).prompt === 'string'
          )
        : undefined,
      outputs: Array.isArray(metadataRaw?.outputs)
        ? metadataRaw.outputs.filter(
            (row): row is { criterionName: string; output: string } =>
              !!row &&
              typeof row === 'object' &&
              typeof (row as { criterionName?: unknown }).criterionName === 'string' &&
              typeof (row as { output?: unknown }).output === 'string'
          )
        : undefined,
    };

    if (metadata.prompts?.length) {
      console.groupCollapsed('[Prompt Playground] Prompts sent to LLM');
      metadata.prompts.forEach((row, idx) => {
        console.log(`#${idx + 1} ${row.criterionName}\n${row.prompt}`);
      });
      console.groupEnd();
    }

    if (metadata.outputs?.length) {
      console.groupCollapsed('[Prompt Playground] LLM outputs');
      metadata.outputs.forEach((row, idx) => {
        console.log(`#${idx + 1} ${row.criterionName}\n${row.output}`);
      });
      console.groupEnd();
    }

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
    const snapshot = cloneConfig(config);
    setRunConfig(snapshot);

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
          const graded = await runGrade(snapshot, targetEssay.text);
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
    setConfigCollapsed(false);
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
      const optimizerInput: Record<string, unknown> = {
        criteria: baseConfig.criteria,
        feedbackInstructionText: baseConfig.feedbackInstructionText || '',
      };
      const optimized = await optimizePlaygroundConfig(optimizerInput, feedback);
      const revisedPatch = optimized.revisedConfig as Partial<BuilderPromptConfig>;
      const revised: BuilderPromptConfig = {
        ...baseConfig,
        criteria: Array.isArray(revisedPatch.criteria) && revisedPatch.criteria.length > 0
          ? (revisedPatch.criteria as RubricCriterion[])
          : baseConfig.criteria,
        feedbackInstructionText:
          typeof revisedPatch.feedbackInstructionText === 'string'
            ? revisedPatch.feedbackInstructionText
            : baseConfig.feedbackInstructionText,
      };
      setOptimizedConfig(revised);
      persistOptimizationIteration(feedback, baseConfig, revised);
      setOptimizerGoal('');
      setBaselineResults(null);
      setOptimizedResults(null);
      setCompareError(null);
    } catch (error) {
      const fallback = draftOptimizedConfig(baseConfig, feedback);
      setOptimizedConfig(fallback);
      persistOptimizationIteration(feedback, baseConfig, fallback);
      setOptimizerGoal('');
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
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">What would you like to improve?</h2>
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
        placeholder="Describe how you want to revise the latest config for the next iteration."
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
          assessmentLength: getAssessmentLengthFromConfig(baselineConfig),
        },
        revisedConfig: {
          ...revisedConfig,
          promptSlots: buildPromptSlotsFromConfig(revisedConfig),
          styleOverrides: buildStyleOverridesFromConfig(revisedConfig),
          assessmentType: getAssessmentTypeFromConfig(revisedConfig),
          assessmentLength: getAssessmentLengthFromConfig(revisedConfig),
        },
      });

      const toTestResults = (rows: Array<{ name: string; score: number; feedback: string; feedbackParts?: string[]; evidenceQuotes: string[] }>): TestResult[] =>
        rows.map((row) => ({
          criterionName: row.name,
          justification: Array.isArray(row.feedbackParts) && row.feedbackParts.length > 0
            ? row.feedbackParts
            : row.feedback
            ? [row.feedback]
            : [],
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

      return nextConfig;
    });
  };

  const isSetupMode = !!activeSet && !activeSet.configured;
  const latestBuilderRun = primaryRunOutputs[primaryRunOutputs.length - 1] || [];
  const latestIteration = sessionIterations[0] ?? null;
  const latestIterationId = latestIteration?.id ?? null;
  const latestIterationCompare = latestIterationId ? comparisonByIteration[latestIterationId] : null;
  const latestComparedSignature = latestIterationId ? iterationLastComparedConfigSignature[latestIterationId] : undefined;
  const latestComparedEssay = latestIterationId ? iterationLastRunEssay[latestIterationId] : undefined;
  const latestConfigCompared =
    latestIteration !== null &&
    typeof latestComparedSignature === 'string' &&
    latestComparedSignature === getConfigSignature(latestIteration.revisedConfig);
  const latestEssayCompared = latestIteration !== null && latestComparedEssay === primaryEssayText;
  const latestCompareReady = Boolean(latestIterationCompare) && latestConfigCompared && latestEssayCompared;
  const canShowFeedbackComposer =
    sessionIterations.length === 0 ||
    latestCompareReady;
  const showIterationHistory = iterationTimeline.length > 0;

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
                      Rubric
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
                      <button
                        onClick={() => setConfig((c) => ({ ...c, criteria: EXAMPLE_RUBRIC }))}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-indigo-300 px-2.5 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                      >
                        Load Example
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
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">FEEDBACK LENGTH</p>
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
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Additional Instruction</p>
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
                  className={`shrink-0 transition-[width,opacity,transform] duration-300 ease-in-out ${configCollapsed ? 'pointer-events-none w-0 -translate-x-4 overflow-hidden opacity-0' : 'w-full translate-x-0 overflow-visible opacity-100 xl:w-[420px]'}`}
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
                          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-800 focus:outline-none focus:ring-0"
                        >
                          {activeVersions.map((version) => (
                            <option key={version.id} value={version.id}>
                              {version.name} • {new Date(version.createdAt).toLocaleString()}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => setConfigCollapsed(true)}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
                          title="Collapse configuration"
                        >
                          <PanelLeftClose className="h-4 w-4" />
                        </button>
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
                            Rubric
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfig((c) => ({ ...c, criteria: PREDEFINED_RUBRIC })); }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-800"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            Import Rubric
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfig((c) => ({ ...c, criteria: EXAMPLE_RUBRIC })); }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-indigo-300 px-2.5 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                          >
                            Load Example
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
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">FEEDBACK LENGTH</p>
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
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Additional Instruction</p>
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
                      Add Essay ({Math.max(0, 3 - essays.length)} left)
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
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 shadow-sm">
                        <button
                          onClick={runBuilderGrade}
                          disabled={!validation.valid || !primaryEssayText.trim() || gradingLoading}
                          className="inline-flex flex-1 items-center justify-center gap-2 bg-slate-800 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {gradingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          {gradingLoading ? 'Grading...' : 'Run'}
                        </button>
                        <button
                          onClick={() => setRunMenuOpen((v) => !v)}
                          disabled={!validation.valid || !primaryEssayText.trim() || gradingLoading}
                          aria-haspopup="menu"
                          aria-expanded={runMenuOpen}
                          className="relative inline-flex min-w-[142px] items-center justify-center border-l-2 border-slate-500 bg-slate-800 px-3 py-2.5 pr-8 text-sm font-medium text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Select run count"
                        >
                          <span className="text-center">Times: {runCount}</span>
                          <span className="absolute right-3 text-slate-200">
                            <ChevronDown className="h-4 w-4" />
                          </span>
                        </button>
                      </div>
                      {runMenuOpen && (
                        <div className="absolute right-0 top-full z-20 mt-1.5 w-44 rounded-lg border border-slate-200 bg-slate-50/95 p-1 shadow-lg backdrop-blur-sm">
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
                  </div>
                </div>

                <div className="mb-3 mt-4 flex items-center gap-2">
                  <h2 className="text-sm font-medium">Results {runCount > 1 ? `(${runCount} runs)` : ''}</h2>
                  <button
                    onClick={() => {
                      const latestRun = primaryRunOutputs[primaryRunOutputs.length - 1] || null;
                      setBaselineResults(latestRun);
                      setOptimizedResults(null);
                      setCompareError(null);
                      setOptimizerSessionIterationIds([]);
                      setSelectedIterationId('');
                      setOptimizerGoal('');
                      setOptimizedConfig(null);
                      setComparisonByIteration({});
                      setIterationLastComparedConfigSignature({});
                      setIterationLastRunEssay({});
                      setIterationEditModeById({});
                      setIterationFeedbackEditModeById({});
                      setLastAttemptedIterationId(null);
                      if (primaryEssayText.trim()) {
                        setPrimaryEssayText(primaryEssayText);
                      }
                      setView('optimizer');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-800 shadow-sm transition-colors hover:bg-sky-200"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Improve Grading
                  </button>
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
                                <ScoreConsistencyChart essayRuns={essayRuns} criteria={(runConfig ?? config).criteria} />
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
                                    const maxTotal = getMaxTotal((runConfig ?? config).criteria);
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
                                                const maxScore = (runConfig ?? config).criteria.find((c) => c.name === row.criterionName)?.scoreRange.max ?? 0;
                                                return (
                                                  <tr key={`${essayIdx}-${runIdx}-${row.criterionName}`} className="border-t border-slate-200 align-top">
                                                    <td className="px-3 py-2 font-semibold text-slate-700">{row.criterionName}</td>
                                                    <td className="px-2 py-2">
                                                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getScorePillClass(row.score, maxScore)}`}>
                                                        {row.score}/{maxScore || '?'}
                                                      </span>
                                                    </td>
                                                    <td className="px-2 py-2 text-slate-600">
                                                      {row.justification?.length > 0 ? (
                                                        getFeedbackBehavior(runConfig ?? config).format === 'bullets' ? (
                                                          <ul className="list-disc space-y-1 pl-4 text-sm">
                                                            {row.justification.map((part, idx) => (
                                                              <li key={`${essayIdx}-${runIdx}-${row.criterionName}-j-${idx}`}>{part}</li>
                                                            ))}
                                                          </ul>
                                                        ) : (
                                                          <div className="space-y-1 text-sm">
                                                            {row.justification.map((part, idx) => (
                                                              <p key={`${essayIdx}-${runIdx}-${row.criterionName}-j-${idx}`}>{part}</p>
                                                            ))}
                                                          </div>
                                                        )
                                                      ) : (
                                                        <p className="text-sm">No feedback generated.</p>
                                                      )}
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
                <h1 className="truncate font-display text-2xl font-semibold">Improve Grading Instructions</h1>
                <p className="text-sm text-slate-500">Refine your grading instructions iteratively to enhance evaluation quality.</p>
              </div>
            </div>
          </div>

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
                          isFeedbackEditing={Boolean(iterationFeedbackEditModeById[iteration.id])}
                          onToggleFeedbackEdit={() =>
                            setIterationFeedbackEditModeById((prev) => ({
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
                              feedbackFormat={getFeedbackBehavior(iteration.baselineConfig).format}
                              accent="slate"
                            />
                            <CompareResultColumn
                              title="Newer Version"
                              total={getSetTotal(iterationCompare.revised)}
                              maxTotal={getMaxTotal(iteration.revisedConfig.criteria)}
                              rows={iterationCompare.revised}
                              criteria={iteration.revisedConfig.criteria}
                              feedbackFormat={getFeedbackBehavior(iteration.revisedConfig).format}
                              accent="indigo"
                            />
                          </div>
                        </div>
                      )}

                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Step 2: Feedback Composer ── */}
          {canShowFeedbackComposer ? (
            <section className="mb-6 mt-6">
              {renderFeedbackComposer()}
            </section>
          ) : (
            <section className="mb-6 mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">What would you like to improve?</h2>
              <p className="mt-2 text-sm text-slate-500">
                Grade and compare the latest config before creating the next revision.
              </p>
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

