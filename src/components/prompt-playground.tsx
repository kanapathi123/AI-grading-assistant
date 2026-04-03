'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Loader2,
  Pencil,
  Play,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Search,
  Settings2,
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

const SETS_STORAGE_KEY = 'prompt-playground-sets-v2';
const ACTIVE_SET_KEY = 'prompt-playground-active-set-id-v2';

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
  revisedConfig: BuilderPromptConfig;
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
        <div key={criterion.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
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
                          placeholder={`What does ${score} look like?`}
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

      <button
        onClick={addCriterion}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
      >
        <Plus className="h-4 w-4" />
        Add Criterion
      </button>
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

  const activeSet = useMemo(
    () => promptSets.find((row) => row.id === activeSetId) ?? null,
    [promptSets, activeSetId]
  );

  const activeVersions = activeSet?.versions || [];
  const activeIterations = activeSet?.optimizationIterations || [];

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
    if (activeIterations.length === 0) {
      setSelectedIterationId('');
      return;
    }
    if (!selectedIterationId) {
      setSelectedIterationId(activeIterations[0].id);
    }
  }, [activeIterations, selectedIterationId]);

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
      name: `New Prompt ${promptSets.length + 1}`,
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

    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'playgroundGrade',
        payload: {
          mode: 'parity',
          essayText: essay,
          criteria: parityCriteria,
          promptSlots: buildPromptSlotsFromConfig(targetConfig),
          styleOverrides: buildStyleOverridesFromConfig(targetConfig),
          assessmentType: getAssessmentTypeFromConfig(targetConfig),
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    const result = data.result || {};
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

  const makeOptimizedDraft = () => {
    setOptimizedConfig(draftOptimizedConfig(config, optimizerGoal));
    setBaselineResults(null);
    setOptimizedResults(null);
    setCompareError(null);
  };

  const persistOptimizationIteration = useCallback(
    (feedback: string, revisedConfig: BuilderPromptConfig) => {
      if (!activeSetId) return;

      const now = new Date().toISOString();
      const iteration: OptimizationIteration = {
        id: crypto.randomUUID(),
        createdAt: now,
        feedback,
        baselineVersionId: activeSet?.currentVersionId || null,
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
    },
    [activeSet?.currentVersionId, activeSetId, persistSets, promptSets]
  );

  const generateOptimizedWithLLM = async () => {
    const feedback = optimizerGoal.trim();
    if (!feedback) return;

    setOptimizationLoading(true);
    setOptimizationError(null);

    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'playgroundOptimizeConfig',
          payload: {
            currentConfig: config,
            feedback,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Optimization request failed');
      }

      const revised = (data.result?.revisedConfig || data.result) as PromptConfig;
      setOptimizedConfig(revised);
      persistOptimizationIteration(feedback, revised);
      setBaselineResults(null);
      setOptimizedResults(null);
      setCompareError(null);
    } catch (error) {
      const fallback = draftOptimizedConfig(config, feedback);
      setOptimizedConfig(fallback);
      persistOptimizationIteration(feedback, fallback);
      setOptimizationError(
        error instanceof Error ? `${error.message} (fallback draft used)` : 'Optimization failed (fallback draft used)'
      );
    } finally {
      setOptimizationLoading(false);
    }
  };

  const loadIteration = () => {
    if (!selectedIterationId) return;
    const found = activeIterations.find((iteration) => iteration.id === selectedIterationId);
    if (!found) return;

    setOptimizerGoal(found.feedback);
    setOptimizedConfig(cloneConfig(found.revisedConfig));
    setBaselineResults(null);
    setOptimizedResults(null);
    setCompareError(null);
  };

  const compareConfigs = async () => {
    if (!optimizedConfig || !primaryEssayText.trim()) return;

    setCompareLoading(true);
    setCompareError(null);
    setBaselineResults(null);
    setOptimizedResults(null);

    try {
      const [base, opt] = await Promise.all([
        runGrade(config, primaryEssayText),
        runGrade(optimizedConfig, primaryEssayText),
      ]);

      setBaselineResults(base.results);
      setOptimizedResults(opt.results);
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

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="min-h-screen w-full bg-[#FBFAF9] px-4 py-6"
    >
      <div className="mx-auto w-full max-w-7xl">
      {view === 'dashboard' && (
        <div className="container py-2">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-3xl tracking-tight">My Prompt</h1>
              <p className="mt-1 text-slate-500">Design and optimize your AI grading prompts</p>
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
              className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/60 transition-all hover:border-indigo-400 hover:shadow-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <Plus className="h-6 w-6 text-slate-600" />
              </div>
              <span className="text-sm font-medium text-slate-600">Create New Prompt</span>
            </button>

            {filteredSets.map((row) => (
              <div key={row.id} className="group relative rounded-lg border border-slate-200 bg-slate-50/60 p-5 transition-all hover:border-indigo-200 hover:shadow-md">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100">
                      <FileText className="h-4 w-4 text-slate-500" />
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {row.config.subject || 'No subject'}
                    </span>
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
                  className="mb-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-display text-lg leading-tight focus:border-slate-200 focus:bg-slate-50 focus:outline-none"
                />
                <p className="line-clamp-2 text-sm text-slate-500">{row.config.assignmentDesc || 'No description yet.'}</p>

                <div className="mt-4 flex items-center justify-between border-t pt-4">
                  <span className="text-xs text-slate-400">
                    {new Date(row.updatedAt).toLocaleDateString()} • {row.versions.length} versions
                  </span>
                  <button
                    onClick={() => openSet(row.id, 'builder')}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
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
        <div className="container py-2">
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => setView('dashboard')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            <div className="min-w-0 flex-1">
              {isRenamingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-9 w-full max-w-md rounded-lg border border-slate-200 px-3 text-xl focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameSet(activeSet.id, renameValue);
                        setIsRenamingTitle(false);
                      }
                      if (e.key === 'Escape') {
                        setRenameValue(activeSet.name);
                        setIsRenamingTitle(false);
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      renameSet(activeSet.id, renameValue);
                      setIsRenamingTitle(false);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      setRenameValue(activeSet.name);
                      setIsRenamingTitle(false);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="truncate font-display text-xl">{activeSet.name}</h1>
                  <button
                    onClick={() => setIsRenamingTitle(true)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <p className="text-xs text-slate-500">Prompt Builder</p>
            </div>

          </div>

          {isSetupMode ? (
            <div className="mx-auto max-w-6xl">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-800">Initial Prompt Setup</p>
                  <p className="text-sm text-slate-500">Set up the configuration first, then continue into the prompt builder.</p>
                </div>
                <button
                  onClick={saveSetupAndEnterBuilder}
                  disabled={!validation.valid}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  Save Setup
                </button>
              </div>

              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">


                <details open className="rounded-lg border border-violet-200 bg-violet-50/50">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800">
                    Rubric Builder
                  </summary>
                  <div className="border-t border-violet-200/70 px-4 pb-4 pt-3">
                    <p className="mb-3 text-xs text-slate-600">
                      Edit the grading standard itself: criteria names, score ranges, and what each score level means.
                    </p>
                    <RubricTable
                      criteria={config.criteria}
                      onChange={(criteria) => setConfig((c) => ({ ...c, criteria }))}
                    />
                  </div>
                </details>

                <details open className="rounded-lg border border-amber-200 bg-amber-50/60">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800">
                    Feedback Setting
                  </summary>
                  <div className="space-y-3 border-t border-amber-200/70 px-4 pb-4 pt-3">
                    <p className="text-xs text-slate-600">
                      Select tags to import predefined feedback prompts. Criterion interpretation and justification structure are fixed.
                    </p>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback Format</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: 'paragraph' as const, label: 'Flow Text' },
                          { value: 'bullets' as const, label: 'Bullet Points' },
                        ].map((option) => (
                          <button
                            key={`setup-format-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ format: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).format === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
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
                            key={`setup-length-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ lengthPreset: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).lengthPreset === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
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
                            key={`setup-tone-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ tonePreset: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).tonePreset === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
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
                            key={`setup-wording-${option.value}`}
                            type="button"
                            onClick={() => updateFeedbackBehaviorAndImport({ englishLevelPreset: option.value })}
                            className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).englishLevelPreset === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
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
                        className="w-full rounded-md border border-slate-200 px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                      />
                      <p className="mt-2 text-[11px] text-slate-500">Click tags to insert predefined prompts. You can edit this text freely.</p>
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
          ) : (
            <div className="flex gap-6">
              <div className="shrink-0">
                {configCollapsed ? (
                  <div className="flex items-center justify-center pt-1">
                    <button
                      onClick={() => setConfigCollapsed(false)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
                      title="Open configuration"
                    >
                      <PanelLeftOpen className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="w-[380px] transition-all duration-300">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-medium">Prompt Configuration</h2>
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={saveBuilderConfig}
                          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                          {savedPulse ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                          {savedPulse ? 'Saved' : 'Save'}
                        </button>
                        <button
                          onClick={() => setConfigCollapsed(true)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
                          title="Collapse configuration"
                        >
                          <PanelLeftClose className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {!isSetupMode && (
                      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                        <select
                          value={selectedVersionId}
                          onChange={(e) => setSelectedVersionId(e.target.value)}
                          className="min-w-[220px] rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                          {activeVersions.map((version) => (
                            <option key={version.id} value={version.id}>
                              {version.name} • {new Date(version.createdAt).toLocaleString()}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={loadVersionIntoBuilder}
                          disabled={!selectedVersionId}
                          className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Preview
                        </button>
                        <button
                          onClick={rollbackToVersion}
                          disabled={!selectedVersionId}
                          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Restore as Current
                        </button>
                        <span className="text-xs text-slate-500">Current: {activeSet.versions.length} saved versions</span>
                        <p className="w-full text-[11px] text-slate-500">
                          Preview only loads the selected version into the editor. Restore as Current saves that version as the active one.
                        </p>
                      </div>
                    )}

                    <div className="h-[calc(100vh-190px)] space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4">
                        <p className="text-sm font-semibold text-slate-800">What each section changes</p>
                        <div className="mt-2 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                          <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                            <p className="font-semibold text-slate-800">Rubric Builder</p>
                            <p>Changes scoring logic and score boundaries per criterion.</p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                            <p className="font-semibold text-slate-800">Feedback Setting</p>
                            <p>Changes feedback behavior: explanation structure, tone, length, and English style.</p>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-600">
                          Use Run with sample essays to test impact: rubric edits affect scores, feedback setting edits affect feedback quality.
                        </p>
                      </div>

                      <details open className="rounded-lg border border-violet-200 bg-violet-50/50">
                        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800">
                          Rubric Builder
                        </summary>
                        <div className="border-t border-violet-200/70 px-4 pb-4 pt-3">
                          <p className="mb-3 text-xs text-slate-600">
                            Edit the grading standard itself: criteria names, score ranges, and what each score level means.
                          </p>
                          <RubricTable
                            criteria={config.criteria}
                            onChange={(criteria) => setConfig((c) => ({ ...c, criteria }))}
                          />
                        </div>
                      </details>

                      <details open className="rounded-lg border border-amber-200 bg-amber-50/60">
                        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800">
                          Feedback Setting
                        </summary>
                        <div className="space-y-3 border-t border-amber-200/70 px-4 pb-4 pt-3">
                          <p className="text-xs text-slate-600">
                            Select tags to import predefined feedback prompts. Criterion interpretation and justification structure are fixed.
                          </p>
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback Format</p>
                            <div className="flex flex-wrap gap-2">
                              {[
                                { value: 'paragraph' as const, label: 'Flow Text' },
                                { value: 'bullets' as const, label: 'Bullet Points' },
                              ].map((option) => (
                                <button
                                  key={`builder-format-${option.value}`}
                                  type="button"
                                  onClick={() => updateFeedbackBehaviorAndImport({ format: option.value })}
                                  className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).format === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
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
                                  key={`builder-length-${option.value}`}
                                  type="button"
                                  onClick={() => updateFeedbackBehaviorAndImport({ lengthPreset: option.value })}
                                  className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).lengthPreset === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
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
                                  key={`builder-tone-${option.value}`}
                                  type="button"
                                  onClick={() => updateFeedbackBehaviorAndImport({ tonePreset: option.value })}
                                  className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).tonePreset === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
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
                                  key={`builder-wording-${option.value}`}
                                  type="button"
                                  onClick={() => updateFeedbackBehaviorAndImport({ englishLevelPreset: option.value })}
                                  className={`rounded-full border px-3 py-1 text-xs ${getFeedbackBehavior(config).englishLevelPreset === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
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
                              className="w-full rounded-md border border-slate-200 px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                            />
                            <p className="mt-2 text-[11px] text-slate-500">Click tags to insert predefined prompts. You can edit this text freely.</p>
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
                      <div key={essay.id} className="rounded-xl bg-slate-50/60 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Essay {index + 1}</p>
                          <div className="flex items-center gap-1">
                            <label className="cursor-pointer">
                              <input
                                type="file"
                                accept=".txt,.md,.pdf"
                                className="hidden"
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
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-red-50 hover:text-red-600"
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
                      onClick={() => setView('optimizer')}
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
                        <div className={`grid gap-3 ${essays.length === 1 ? 'grid-cols-1' : essays.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                          {runResultsByEssay.map((essayRuns, essayIdx) => {
                            if (essayRuns.length === 0) return null;
                            const totals = essayRuns.map((run) => getSetTotal(run));
                            const maxTotal = Math.max(...totals, 1);
                            return (
                              <div key={`graph-${essayIdx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Essay {essayIdx + 1}</p>
                                <div className="space-y-2">
                                  {totals.map((value, idx) => (
                                    <div key={`essay-${essayIdx}-run-${idx}`} className="space-y-1">
                                      <div className="flex items-center justify-between text-xs text-slate-600">
                                        <span>Run {idx + 1}</span>
                                        <span>{value}</span>
                                      </div>
                                      <div className="h-2 w-full rounded-full bg-slate-200">
                                        <div
                                          className="h-full rounded-full bg-indigo-500"
                                          style={{ width: `${Math.max(4, Math.min(100, (value / maxTotal) * 100))}%` }}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className={`grid gap-3 ${essays.length === 1 ? 'grid-cols-1' : essays.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                          {runResultsByEssay.map((essayRuns, essayIdx) => {
                            if (essayRuns.length === 0) return null;
                            const activeRun = essayRuns[essayRuns.length - 1] || [];
                            return (
                              <div key={`result-${essayIdx}`} className="space-y-2">
                                <p className="text-sm font-medium text-slate-600">Essay {essayIdx + 1}</p>
                                <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
                                  <div className="flex items-end gap-3">
                                    <div className="text-4xl font-bold leading-none text-slate-800">{getSetTotal(activeRun)}</div>
                                    <div className="pb-1 text-sm text-slate-400">/ {getMaxTotal(config.criteria)}</div>
                                    <div className="pb-1 text-sm font-semibold text-slate-600">Overall Score</div>
                                  </div>
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
                                      {activeRun.map((row) => (
                                        <tr key={`${essayIdx}-${row.criterionName}`} className="border-t border-slate-200 align-top">
                                          <td className="px-3 py-2 font-semibold text-slate-700">{row.criterionName}</td>
                                          <td className="px-2 py-2">
                                            <span className="inline-flex rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">
                                              {row.score}/{config.criteria.find((c) => c.name === row.criterionName)?.maxScore ?? '?'}
                                            </span>
                                          </td>
                                          <td className="px-2 py-2 text-slate-600">{row.justification?.[0] || 'No feedback generated.'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {runMetrics && runCount > 1 && (
                        <div className="grid gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800 sm:grid-cols-4">
                          <div>
                            <p className="font-semibold">Mean Total</p>
                            <p>{runMetrics.mean}</p>
                          </div>
                          <div>
                            <p className="font-semibold">Min</p>
                            <p>{runMetrics.min}</p>
                          </div>
                          <div>
                            <p className="font-semibold">Max</p>
                            <p>{runMetrics.max}</p>
                          </div>
                          <div>
                            <p className="font-semibold">Std Dev</p>
                            <p>{runMetrics.stdDev}</p>
                          </div>
                        </div>
                      )}

                      {criterionMetrics.length > 0 && runCount > 1 && (
                        <div className="overflow-hidden rounded-md border border-slate-200">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-500">
                              <tr>
                                <th className="px-2 py-2 text-left">Criterion</th>
                                <th className="px-2 py-2 text-left">Mean</th>
                                <th className="px-2 py-2 text-left">Range</th>
                                <th className="px-2 py-2 text-left">Std Dev</th>
                              </tr>
                            </thead>
                            <tbody>
                              {criterionMetrics.map((metric) => (
                                <tr key={metric.criterionName} className="border-t border-slate-200">
                                  <td className="px-2 py-2 text-slate-700">{metric.criterionName}</td>
                                  <td className="px-2 py-2 text-slate-600">{metric.mean}</td>
                                  <td className="px-2 py-2 text-slate-600">{metric.min} - {metric.max}</td>
                                  <td className="px-2 py-2 text-slate-600">{metric.stdDev}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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
          )}
        </div>
      )}

      {view === 'optimizer' && activeSet && (
        <div className="container py-2">
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => setView('builder')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-xl">Prompt Optimizer</h1>
              <p className="text-xs text-slate-500">{activeSet.name}</p>
            </div>
            <button
              onClick={() => setView('dashboard')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                <h2 className="text-sm font-semibold">Optimization Request</h2>
              </div>
              <textarea
                rows={6}
                value={optimizerGoal}
                onChange={(e) => setOptimizerGoal(e.target.value)}
                placeholder="Example: Be stricter on evidence quality and keep feedback concise."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={generateOptimizedWithLLM}
                  disabled={!optimizerGoal.trim() || optimizationLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {optimizationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Generate Revision (LLM)
                </button>
                <button
                  onClick={makeOptimizedDraft}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Sparkles className="h-4 w-4" />
                  Quick Draft
                </button>
              </div>
              {optimizationError && <p className="mt-2 text-xs text-amber-700">{optimizationError}</p>}

              {activeIterations.length > 0 && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Optimization Iterations</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedIterationId}
                      onChange={(e) => setSelectedIterationId(e.target.value)}
                      className="min-w-[220px] rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      {activeIterations.map((iteration, idx) => (
                        <option key={iteration.id} value={iteration.id}>
                          Iteration {activeIterations.length - idx} • {new Date(iteration.createdAt).toLocaleString()}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={loadIteration}
                      className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Load Iteration
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-indigo-500" />
                <h2 className="text-sm font-semibold">Essay for Comparison</h2>
              </div>
              <textarea
                rows={6}
                value={essays[0]?.text || ''}
                onChange={(e) => setPrimaryEssayText(e.target.value)}
                placeholder="Paste the essay used to compare baseline and optimized prompts..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <button
                onClick={compareConfigs}
                disabled={!optimizedConfig || !primaryEssayText.trim() || compareLoading}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {compareLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                Compare
              </button>
              {compareError && <p className="mt-2 text-xs text-red-600">{compareError}</p>}
            </div>
          </div>

          {optimizedConfig && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Prompt Comparison</h3>
                <button
                  onClick={applyOptimizedConfig}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Apply to Builder
                </button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Current Prompt</p>
                  <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                    {generatePreviewPrompt(config)}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Optimized Prompt</p>
                  <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-xs text-slate-700">
                    {generatePreviewPrompt(optimizedConfig)}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {baselineResults && optimizedResults && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-800">Current Results</h4>
                <p className="mb-3 text-xs text-slate-500">
                  Total: {getSetTotal(baselineResults)} / {getMaxTotal(config.criteria)}
                </p>
                <div className="space-y-2">
                  {baselineResults.map((row) => (
                    <CriterionResultCard key={`base-${row.criterionName}`} result={row} criteria={config.criteria} />
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-800">Optimized Results</h4>
                <p className="mb-3 text-xs text-slate-500">
                  Total: {getSetTotal(optimizedResults)} / {getMaxTotal(optimizedConfig?.criteria || config.criteria)}
                </p>
                <div className="space-y-2">
                  {optimizedResults.map((row) => (
                    <CriterionResultCard
                      key={`opt-${row.criterionName}`}
                      result={row}
                      criteria={optimizedConfig?.criteria || config.criteria}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </motion.section>
  );
}
