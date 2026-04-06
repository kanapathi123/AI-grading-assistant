import type { CriterionLevel } from '@/types';

export interface OptimizationSuggestion {
  id: string;
  text: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function toClampedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = asNumber(value);
  const safe = parsed === null ? fallback : parsed;
  return Math.max(min, Math.min(max, safe));
}

function buildLevelsFromRange(minScore: number, maxScore: number, baseLevels?: CriterionLevel[]): CriterionLevel[] {
  const levels: CriterionLevel[] = [];
  for (let score = Math.trunc(maxScore); score >= Math.trunc(minScore); score -= 1) {
    const fromBase = baseLevels?.find((l) => l.score === score);
    levels.push({ score, description: fromBase?.description?.trim() ? fromBase.description : `Score ${score} description` });
  }
  return levels;
}

function normalizeCriterionLevels(
  levels: unknown,
  minScore: number,
  maxScore: number,
  baseLevels?: CriterionLevel[]
): CriterionLevel[] {
  const next = buildLevelsFromRange(minScore, maxScore, baseLevels);
  // Handle CriterionLevel[] format (new)
  if (Array.isArray(levels)) {
    for (const item of levels) {
      if (!isObject(item)) continue;
      const score = asNumber((item as Record<string, unknown>).score);
      const desc = asString((item as Record<string, unknown>).description);
      if (score === null || score < minScore || score > maxScore) continue;
      if (desc?.trim()) {
        const idx = next.findIndex((l) => l.score === score);
        if (idx >= 0) next[idx] = { score, description: desc };
      }
    }
    return next;
  }
  // Handle legacy Record<string, string> format from AI responses
  if (isObject(levels)) {
    for (const [scoreKey, value] of Object.entries(levels)) {
      const numeric = Number(scoreKey);
      if (!Number.isFinite(numeric)) continue;
      if (numeric < minScore || numeric > maxScore) continue;
      if (typeof value === 'string' && value.trim()) {
        const idx = next.findIndex((l) => l.score === Math.trunc(numeric));
        if (idx >= 0) next[idx] = { score: next[idx].score, description: value };
      }
    }
  }
  return next;
}

export function buildOptimizeConfigPrompt(currentConfig: Record<string, unknown>, feedback: string): string {
  return `
You are optimizing a JSON grading prompt configuration.
Revise the config based on feedback.

Important rules:
- Keep the config valid and internally consistent.
- You may revise ONLY these keys:
  1) "criteria"
  2) "feedbackInstructionText" (additional instruction in feedback setting)
- Preserve criteria order and ids unless feedback explicitly asks to restructure rubric.
- Preserve score ranges unless feedback explicitly asks to change scoring scale.
- Return ONLY JSON (no markdown, no explanation).

CURRENT CONFIG JSON:
${JSON.stringify(currentConfig, null, 2)}

FEEDBACK:
${feedback}

Return ONLY one valid JSON object in this exact shape:
{
  "criteria": [
    {
      "id": number,
      "name": string,
      "scoreRange": { "min": number, "max": number },
      "levels": [{ "score": number, "description": string }]
    }
  ],
  "feedbackInstructionText": string
}

Do not add any other top-level fields.
`;
}

export function buildOptimizeSuggestionsPrompt(params: {
  currentConfig: Record<string, unknown>;
  essays?: Array<{ text: string }>;
  gradingResults?: Array<Record<string, unknown>>;
}): string {
  return `
You are an expert prompt designer for AI grading systems.

Analyze the current grading config and suggest concise, high-impact improvements.
Each suggestion must be 3-8 words and actionable.

CURRENT CONFIG:
${JSON.stringify(params.currentConfig, null, 2)}

SAMPLE ESSAYS:
${JSON.stringify(params.essays || [], null, 2)}

RECENT GRADING OUTPUTS:
${JSON.stringify(params.gradingResults || [], null, 2)}

Return ONLY valid JSON in this format:
{
  "suggestions": [
    { "id": "1", "text": "Clarify rubric boundaries" },
    { "id": "2", "text": "Require stronger evidence quotes" }
  ]
}
`;
}

export function extractOptimizationSuggestions(parsed: Record<string, unknown> | null): OptimizationSuggestion[] {
  const suggestionsRaw = parsed && Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  return suggestionsRaw
    .map((row, idx) => {
      if (!isObject(row)) return null;
      const text = asString(row.text) || asString(row.suggestion) || asString(row.problem);
      if (!text || !text.trim()) return null;
      return {
        id: asString(row.id) || String(idx + 1),
        text: text.trim(),
      };
    })
    .filter((row): row is OptimizationSuggestion => row !== null)
    .slice(0, 8);
}

function extractScoreRangeFromRaw(c: Record<string, unknown>, fallbackMin: number, fallbackMax: number): { min: number; max: number } {
  if (isObject(c.scoreRange)) {
    const sr = c.scoreRange as Record<string, unknown>;
    const min = toClampedNumber(sr.min, fallbackMin, 0, 100);
    const max = toClampedNumber(sr.max, Math.max(fallbackMax, min + 1), min + 1, 100);
    return { min, max };
  }
  // Legacy flat format
  const min = toClampedNumber(c.minScore, fallbackMin, 0, 100);
  const max = toClampedNumber(c.maxScore, Math.max(fallbackMax, min + 1), min + 1, 100);
  return { min, max };
}

function unwrapOptimizedConfigPayload(value: Record<string, unknown>): Record<string, unknown> {
  if (isObject(value.revisedConfig)) return asRecord(value.revisedConfig);
  if (isObject(value.config)) return asRecord(value.config);
  if (isObject(value.optimizedConfig)) return asRecord(value.optimizedConfig);
  return value;
}

export function normalizeOptimizedPromptConfig(
  revisedConfigRaw: Record<string, unknown>,
  currentConfigRaw: Record<string, unknown>
): Record<string, unknown> {
  const currentConfig = asRecord(currentConfigRaw);
  const revisedConfig = unwrapOptimizedConfigPayload(asRecord(revisedConfigRaw));
  const currentCriteriaRaw = Array.isArray(currentConfig.criteria) ? currentConfig.criteria : [];

  const baseCriteria = currentCriteriaRaw.map((criterion, index) => {
    const c = asRecord(criterion);
    const scoreRange = extractScoreRangeFromRaw(c, 0, 3);
    const levels = normalizeCriterionLevels(c.levels, scoreRange.min, scoreRange.max);
    return {
      id: index + 1,
      name: typeof c.name === 'string' && c.name.trim() ? c.name : `Criterion ${index + 1}`,
      scoreRange,
      levels,
    };
  });

  const revisedCriteriaRaw = Array.isArray(revisedConfig.criteria) ? revisedConfig.criteria : [];
  const revisedCriteria = revisedCriteriaRaw.map((criterion, index) => {
    const c = asRecord(criterion);
    const base = baseCriteria[index];
    const scoreRange = extractScoreRangeFromRaw(c, base?.scoreRange.min ?? 0, base?.scoreRange.max ?? 3);
    return {
      id: index + 1,
      name: typeof c.name === 'string' && c.name.trim() ? c.name : base?.name ?? `Criterion ${index + 1}`,
      scoreRange,
      levels: normalizeCriterionLevels(c.levels, scoreRange.min, scoreRange.max, base?.levels),
    };
  });

  const criteria = revisedCriteria.length > 0 ? revisedCriteria : baseCriteria;

  const feedbackInstructionText =
    typeof revisedConfig.feedbackInstructionText === 'string'
      ? revisedConfig.feedbackInstructionText
      : typeof currentConfig.feedbackInstructionText === 'string'
      ? currentConfig.feedbackInstructionText
      : '';

  return {
    criteria,
    feedbackInstructionText,
  };
}
