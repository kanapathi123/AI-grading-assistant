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

function asBoolean(value: unknown, defaultValue = false): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function toClampedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = asNumber(value);
  const safe = parsed === null ? fallback : parsed;
  return Math.max(min, Math.min(max, safe));
}

function buildLevelsFromRange(minScore: number, maxScore: number, baseLevels?: Record<string, string>): Record<string, string> {
  const levels: Record<string, string> = {};
  for (let score = Math.trunc(maxScore); score >= Math.trunc(minScore); score -= 1) {
    const key = String(score);
    const fromBase = baseLevels?.[key];
    levels[key] = typeof fromBase === 'string' && fromBase.trim() ? fromBase : `Score ${key} description`;
  }
  return levels;
}

function normalizeCriterionLevels(
  levels: unknown,
  minScore: number,
  maxScore: number,
  baseLevels?: Record<string, string>
): Record<string, string> {
  const next = buildLevelsFromRange(minScore, maxScore, baseLevels);
  if (!isObject(levels)) return next;

  for (const [scoreKey, value] of Object.entries(levels)) {
    const numeric = Number(scoreKey);
    if (!Number.isFinite(numeric)) continue;
    if (numeric < minScore || numeric > maxScore) continue;
    if (typeof value === 'string' && value.trim()) {
      next[String(Math.trunc(numeric))] = value;
    }
  }

  return next;
}

export function buildOptimizeConfigPrompt(currentConfig: Record<string, unknown>, feedback: string): string {
  return `
You are optimizing a JSON grading prompt configuration.
Revise the config based on feedback while preserving the same output schema.

CURRENT CONFIG JSON:
${JSON.stringify(currentConfig, null, 2)}

FEEDBACK:
${feedback}

Return ONLY valid JSON object with these keys:
{
  "academicLevel": string,
  "subject": string,
  "assignmentDesc": string,
  "feedbackText": string,
  "criteria": [
    {
      "id": string,
      "name": string,
      "minScore": number,
      "maxScore": number,
      "levels": {"scoreAsString": "description"}
    }
  ],
  "showAdditionalMaterial": boolean,
  "additionalMaterial": string,
  "showAdditionalDescription": boolean,
  "additionalDescription": string
}
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

export function normalizeOptimizedPromptConfig(
  revisedConfigRaw: Record<string, unknown>,
  currentConfigRaw: Record<string, unknown>
): Record<string, unknown> {
  const currentConfig = asRecord(currentConfigRaw);
  const currentCriteriaRaw = Array.isArray(currentConfig.criteria) ? currentConfig.criteria : [];

  const baseCriteria = currentCriteriaRaw.map((criterion, index) => {
    const c = asRecord(criterion);
    const minScore = toClampedNumber(c.minScore, 0, 0, 100);
    const maxScore = toClampedNumber(c.maxScore, Math.max(1, minScore + 1), minScore + 1, 100);
    const levels = normalizeCriterionLevels(c.levels, minScore, maxScore);
    return {
      id: typeof c.id === 'string' && c.id.trim() ? c.id : `criterion-${index + 1}`,
      name: typeof c.name === 'string' && c.name.trim() ? c.name : `Criterion ${index + 1}`,
      minScore,
      maxScore,
      levels,
    };
  });

  const revisedCriteriaRaw = Array.isArray(revisedConfigRaw.criteria) ? revisedConfigRaw.criteria : [];
  const revisedCriteria = revisedCriteriaRaw.map((criterion, index) => {
    const c = asRecord(criterion);
    const base = baseCriteria[index];
    const minScore = toClampedNumber(c.minScore, base?.minScore ?? 0, 0, 100);
    const maxScore = toClampedNumber(c.maxScore, base?.maxScore ?? Math.max(1, minScore + 1), minScore + 1, 100);

    return {
      id: typeof c.id === 'string' && c.id.trim() ? c.id : base?.id ?? `criterion-${index + 1}`,
      name: typeof c.name === 'string' && c.name.trim() ? c.name : base?.name ?? `Criterion ${index + 1}`,
      minScore,
      maxScore,
      levels: normalizeCriterionLevels(c.levels, minScore, maxScore, base?.levels),
    };
  });

  const criteria = revisedCriteria.length > 0 ? revisedCriteria : baseCriteria;

  const feedbackText =
    typeof revisedConfigRaw.feedbackText === 'string' && revisedConfigRaw.feedbackText.trim()
      ? revisedConfigRaw.feedbackText
      : typeof currentConfig.feedbackText === 'string'
      ? currentConfig.feedbackText
      : 'Be specific and constructive. Reference evidence from the text.';

  const additionalMaterial =
    typeof revisedConfigRaw.additionalMaterial === 'string'
      ? revisedConfigRaw.additionalMaterial
      : typeof currentConfig.additionalMaterial === 'string'
      ? currentConfig.additionalMaterial
      : '';

  const additionalDescription =
    typeof revisedConfigRaw.additionalDescription === 'string'
      ? revisedConfigRaw.additionalDescription
      : typeof currentConfig.additionalDescription === 'string'
      ? currentConfig.additionalDescription
      : '';

  return {
    academicLevel:
      typeof revisedConfigRaw.academicLevel === 'string'
        ? revisedConfigRaw.academicLevel
        : typeof currentConfig.academicLevel === 'string'
        ? currentConfig.academicLevel
        : '',
    subject:
      typeof revisedConfigRaw.subject === 'string'
        ? revisedConfigRaw.subject
        : typeof currentConfig.subject === 'string'
        ? currentConfig.subject
        : '',
    assignmentDesc:
      typeof revisedConfigRaw.assignmentDesc === 'string'
        ? revisedConfigRaw.assignmentDesc
        : typeof currentConfig.assignmentDesc === 'string'
        ? currentConfig.assignmentDesc
        : '',
    feedbackText,
    criteria,
    additionalMaterial,
    showAdditionalMaterial: asBoolean(revisedConfigRaw.showAdditionalMaterial, additionalMaterial.trim().length > 0),
    additionalDescription,
    showAdditionalDescription: asBoolean(
      revisedConfigRaw.showAdditionalDescription,
      additionalDescription.trim().length > 0
    ),
  };
}
