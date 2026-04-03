export interface EditablePromptSlots {
  criterionInstruction?: string;
  justificationStructureInstruction?: string;
  lengthInstruction?: string;
  toneInstruction?: string;
  englishLevelInstruction?: string;
}

export type LengthPreset = 'short' | 'medium' | 'long';
export type TonePreset = 'direct' | 'balanced' | 'supportive';
export type EnglishLevelPreset = 'simple' | 'standard' | 'advanced';

export interface FeedbackStyleConfig {
  lengthPreset: LengthPreset;
  tonePreset: TonePreset;
  englishLevelPreset: EnglishLevelPreset;
}

export interface PromptConfig {
  version: 'v1';
  slotsDraft: EditablePromptSlots;
  style: FeedbackStyleConfig;
}

export interface EffectivePromptConfig {
  version: 'v1';
  effectiveSlots: Required<EditablePromptSlots>;
  style: FeedbackStyleConfig;
}

export interface LockedPromptSections {
  criterionJsonSchemaContract: string;
  overallJsonSchemaContract: string;
  evidenceRequirements: string;
  scoreConstraints: string;
  strictJsonOnlyRules: string;
  parserSafetyRules: string;
}

export interface CriterionPromptRuntimeData {
  essayContent: string;
  criterionName: string;
  scoreMin: number;
  scoreMax: number;
  contextDump?: Array<{ title: string; content: string }>;
  assessmentType: 'flow' | 'bullets';
  assessmentLength: 'short' | 'medium' | 'long';
}

export interface OverallPromptRuntimeData {
  essayContent: string;
  criteriaWithScores: Array<{
    name: string;
    teacherScore?: number | null;
    aiScore?: number | null;
    maxScore: number;
  }>;
  contextDump?: Array<{ title: string; content: string }>;
}

export const DEFAULT_GRADING_SYSTEM_PROMPT =
  'You are a rigorous, no-nonsense essay grader for a masters level course. You hold students to a high standard and do not give praise unless it is clearly warranted by the text. Avoid flattery, hedging, or softening language. If the essay is weak in an area, say so directly. If the essay is strong, acknowledge it briefly without exaggeration.\n\nYour assessment must reference the rubric criterion directly. Do NOT make the score obvious from your justification - a reader should not be able to guess the exact score from your commentary alone. Focus on what the essay does and does not achieve relative to the criterion.';

export const LOCKED_PROMPT_SECTIONS: LockedPromptSections = {
  criterionJsonSchemaContract: `FORMAT YOUR RESPONSE AS A VALID JSON object:\n{\n  "justification": string | string[],\n  "evidence": [\n    {\n      "quote": "exact verbatim quote from essay - must be a complete sentence or clause, not just a few words",\n      "paragraph": "PAGE X, Section/Paragraph identifier",\n      "relatedAssessmentIndexes": [array of integers, optional]\n    },\n    ...\n  ],\n  "score": number\n}`,
  overallJsonSchemaContract: `FORMAT YOUR RESPONSE AS A VALID JSON OBJECT with the following keys:\n{\n  "strengths": string,\n  "improvements": string,\n  "overallGrade": number,\n  "advice": string\n}`,
  evidenceRequirements:
    'Provide at least 5 specific EXACT quotes from the essay (copy-pasted verbatim, not paraphrased) that support or influenced your assessment. Quotes must be from different parts of the essay, include strengths and weaknesses, and should not be generic across all criteria. For each quote, include relatedAssessmentIndexes mapping it to justification units.',
  scoreConstraints:
    'Score must be a number within the provided score range. Do not reveal or hint at the exact score in justification text.',
  strictJsonOnlyRules:
    'DO NOT include any explanatory text before or after JSON. Return JSON only.',
  parserSafetyRules:
    'Output must be valid JSON. Use double quotes, no trailing commas, and include all required fields.',
};

export function getDefaultLengthInstruction(preset: LengthPreset): string {
  if (preset === 'short') return 'Be concise and brief.';
  if (preset === 'long') return 'Be detailed and extended.';
  return 'Be balanced in detail and length.';
}

export function getDefaultToneInstruction(preset: TonePreset): string {
  if (preset === 'direct') return 'Use direct, clear, no-fluff language.';
  if (preset === 'supportive') return 'Use constructive language while keeping strict standards.';
  return 'Use professional and balanced language.';
}

export function getDefaultEnglishInstruction(preset: EnglishLevelPreset): string {
  if (preset === 'simple') return 'Use simple plain English.';
  if (preset === 'advanced') return 'Use precise academic English.';
  return 'Use standard professional English.';
}

const DEFAULT_STYLE: FeedbackStyleConfig = {
  lengthPreset: 'medium',
  tonePreset: 'balanced',
  englishLevelPreset: 'standard',
};

const DEFAULT_SLOT_DRAFT: Required<EditablePromptSlots> = {
  criterionInstruction:
    'Interpret the criterion strictly against rubric intent and avoid generic comments.',
  justificationStructureInstruction:
    'Present justification as clear, criterion-tied reasoning grounded in the essay evidence.',
  lengthInstruction: getDefaultLengthInstruction(DEFAULT_STYLE.lengthPreset),
  toneInstruction: getDefaultToneInstruction(DEFAULT_STYLE.tonePreset),
  englishLevelInstruction: getDefaultEnglishInstruction(DEFAULT_STYLE.englishLevelPreset),
};

function isBlockedInstruction(text: string): boolean {
  const blockedPatterns = [
    /ignore previous instructions/i,
    /do not return json/i,
    /change output format/i,
    /return markdown/i,
    /omit evidence/i,
    /do not include score/i,
    /rename fields/i,
  ];
  return blockedPatterns.some((pattern) => pattern.test(text));
}

function sanitizeSlotText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 1200) return undefined;
  if (isBlockedInstruction(trimmed)) return undefined;
  return trimmed;
}

function sanitizeEditableSlots(slots?: EditablePromptSlots): EditablePromptSlots {
  if (!slots) return {};
  return {
    criterionInstruction: sanitizeSlotText(slots.criterionInstruction),
    justificationStructureInstruction: sanitizeSlotText(slots.justificationStructureInstruction),
    lengthInstruction: sanitizeSlotText(slots.lengthInstruction),
    toneInstruction: sanitizeSlotText(slots.toneInstruction),
    englishLevelInstruction: sanitizeSlotText(slots.englishLevelInstruction),
  };
}

export function validateEditablePromptSlots(slots?: EditablePromptSlots): {
  ok: boolean;
  errors: string[];
  sanitizedSlots: EditablePromptSlots;
} {
  const errors: string[] = [];
  if (!slots) {
    return { ok: true, errors, sanitizedSlots: {} };
  }

  const rawValues = Object.values(slots).filter((value): value is string => typeof value === 'string');
  for (const value of rawValues) {
    if (value.trim().length > 1200) {
      errors.push('Each slot instruction must be <= 1200 characters.');
      break;
    }
    if (isBlockedInstruction(value)) {
      errors.push('Unsafe instruction detected. Do not override output format or core instructions.');
      break;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    sanitizedSlots: sanitizeEditableSlots(slots),
  };
}

export function buildInstructionFromSlots(args: {
  slotOverrides?: EditablePromptSlots;
  draftSlots?: EditablePromptSlots;
  style: FeedbackStyleConfig;
}): Required<EditablePromptSlots> {
  const override = sanitizeEditableSlots(args.slotOverrides);
  const draft = sanitizeEditableSlots(args.draftSlots);

  return {
    criterionInstruction:
      override.criterionInstruction || draft.criterionInstruction || DEFAULT_SLOT_DRAFT.criterionInstruction,
    justificationStructureInstruction:
      override.justificationStructureInstruction ||
      draft.justificationStructureInstruction ||
      DEFAULT_SLOT_DRAFT.justificationStructureInstruction,
    lengthInstruction:
      override.lengthInstruction ||
      draft.lengthInstruction ||
      getDefaultLengthInstruction(args.style.lengthPreset),
    toneInstruction:
      override.toneInstruction ||
      draft.toneInstruction ||
      getDefaultToneInstruction(args.style.tonePreset),
    englishLevelInstruction:
      override.englishLevelInstruction ||
      draft.englishLevelInstruction ||
      getDefaultEnglishInstruction(args.style.englishLevelPreset),
  };
}

export function getEffectivePromptConfig(input?: {
  storedConfig?: PromptConfig | null;
  slotOverrides?: EditablePromptSlots;
  styleOverrides?: Partial<FeedbackStyleConfig>;
}): EffectivePromptConfig {
  const storedStyle = input?.storedConfig?.style;
  const style: FeedbackStyleConfig = {
    lengthPreset: input?.styleOverrides?.lengthPreset || storedStyle?.lengthPreset || DEFAULT_STYLE.lengthPreset,
    tonePreset: input?.styleOverrides?.tonePreset || storedStyle?.tonePreset || DEFAULT_STYLE.tonePreset,
    englishLevelPreset:
      input?.styleOverrides?.englishLevelPreset ||
      storedStyle?.englishLevelPreset ||
      DEFAULT_STYLE.englishLevelPreset,
  };

  return {
    version: 'v1',
    style,
    effectiveSlots: buildInstructionFromSlots({
      slotOverrides: input?.slotOverrides,
      draftSlots: input?.storedConfig?.slotsDraft,
      style,
    }),
  };
}

function buildContextDump(contextDump?: Array<{ title: string; content: string }>): string {
  if (!contextDump || contextDump.length === 0) return '';
  return 'CONTEXT DUMP:\n' + contextDump.map((ctx) => `- ${ctx.title}: ${ctx.content}`).join('\n');
}

export function buildGradeSingleCriterionPrompt(args: {
  runtime: CriterionPromptRuntimeData;
  effective: EffectivePromptConfig;
  cacheMode: 'cached' | 'non-cached';
  locked?: LockedPromptSections;
}): string {
  const locked = args.locked || LOCKED_PROMPT_SECTIONS;
  const slots = args.effective.effectiveSlots;

  const justificationSchema =
    args.runtime.assessmentType === 'bullets'
      ? '"justification": ["bullet point 1", "bullet point 2", ...],'
      : '"justification": "Your detailed justification without revealing the exact score",';

  const modeIntro =
    args.cacheMode === 'cached'
      ? 'Grade the following criterion using the rubric provided in the cached context.'
      : DEFAULT_GRADING_SYSTEM_PROMPT;

  const contextBlock = args.cacheMode === 'cached' ? '' : buildContextDump(args.runtime.contextDump);

  return [
    modeIntro,
    contextBlock,
    `ESSAY:\n${args.runtime.essayContent}`,
    `CRITERION: ${args.runtime.criterionName}`,
    `SCORE RANGE: ${args.runtime.scoreMin} to ${args.runtime.scoreMax}`,
    `CRITERION INTERPRETATION GUIDANCE:\n${slots.criterionInstruction}`,
    `JUSTIFICATION STRUCTURE GUIDANCE:\n${slots.justificationStructureInstruction}`,
    `LENGTH GUIDANCE:\n${slots.lengthInstruction}`,
    `TONE GUIDANCE:\n${slots.toneInstruction}`,
    `ENGLISH LEVEL GUIDANCE:\n${slots.englishLevelInstruction}`,
    locked.evidenceRequirements,
    locked.scoreConstraints,
    locked.criterionJsonSchemaContract.replace('"justification": string | string[],', justificationSchema),
    locked.strictJsonOnlyRules,
    locked.parserSafetyRules,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildOverallAssessmentPrompt(args: {
  runtime: OverallPromptRuntimeData;
  effective: EffectivePromptConfig;
  locked?: LockedPromptSections;
}): string {
  const locked = args.locked || LOCKED_PROMPT_SECTIONS;
  const slots = args.effective.effectiveSlots;
  const criteriaText = args.runtime.criteriaWithScores
    .map((criterion) => `${criterion.name}: Score ${criterion.teacherScore ?? criterion.aiScore} out of ${criterion.maxScore}`)
    .join('\n');

  return [
    buildContextDump(args.runtime.contextDump),
    'You are an expert essay grader. Given the essay and criterion scores, provide an overall assessment.',
    `TONE GUIDANCE:\n${slots.toneInstruction}`,
    `LENGTH GUIDANCE:\n${slots.lengthInstruction}`,
    `ENGLISH LEVEL GUIDANCE:\n${slots.englishLevelInstruction}`,
    `ESSAY:\n${args.runtime.essayContent}`,
    `CRITERIA & SCORES:\n${criteriaText}`,
    'Present strengths as a coherent paragraph and improvements as a coherent paragraph.',
    locked.overallJsonSchemaContract,
    locked.strictJsonOnlyRules,
    locked.parserSafetyRules,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildPlaygroundParityPrompt(args: {
  runtime: CriterionPromptRuntimeData;
  effective: EffectivePromptConfig;
  cacheMode: 'cached' | 'non-cached';
}): string {
  return buildGradeSingleCriterionPrompt(args);
}
