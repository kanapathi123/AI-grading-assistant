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
  evidenceReferenceMode?: 'page' | 'text';
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
  'You are a strict essay grader for a masters level course. Hold students to a high standard. If something is weak, say so plainly. If something is good, say so briefly. Do not use fancy language, filler words, or unnecessary adjectives. Write like you are talking to the student directly - short sentences, plain English.\n\nGRADING METHODOLOGY:\n1. Read the full essay before grading anything.\n2. For each criterion, check the essay against EVERY score level in the rubric (low to high). Find the level that fits best.\n3. Give the score of the closest matching level. If it falls between two levels, pick the nearer one - do not default to the middle.\n4. In your justification, point to specific rubric levels and say why the essay fits or does not fit them.\n5. Do NOT make the score obvious from your justification - the reader should not be able to guess the exact number.\n\nWRITING STYLE:\n- Use simple, direct English. No fancy words. No filler.\n- Say "the essay does X" not "the essay demonstrates a commendable ability to X".\n- Say "this is missing" not "there is a notable absence of".\n- Keep sentences short. One idea per sentence.\n\nEVIDENCE RULES:\n- Every quote MUST be copied EXACTLY from the essay. Do not change any words, fix grammar, or rephrase.\n- If you cannot find an exact quote, do not make one up.\n- Pick quotes that are specific to this criterion, not generic lines that could apply to anything.';

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
  justificationStructureInstruction: '',
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
  const slots = args.effective.effectiveSlots;

  const justificationSchema =
    args.runtime.assessmentType === 'bullets'
      ? '"justification": ["bullet point 1", "bullet point 2", ...],'
      : '"justification": "Your detailed justification without revealing the exact score",';

  const justificationInstruction =
    args.runtime.assessmentType === 'bullets'
      ? 'Present your justification as bullet points. Return the justification as a JSON array of strings, where each string is a bullet point.'
      : 'Present your justification as a coherent paragraph. Return the justification as a single string.';

  const lengthInstruction =
    args.runtime.assessmentLength === 'short'
      ? args.runtime.assessmentType === 'bullets'
        ? 'Keep it to 3-4 bullet points. Each bullet should be 1 sentence.'
        : 'Keep the justification to 2-3 sentences total.'
      : args.runtime.assessmentLength === 'medium'
      ? args.runtime.assessmentType === 'bullets'
        ? 'Use 4-6 bullet points. Each bullet should be 1-2 sentences.'
        : 'Write 4-6 sentences in one paragraph.'
      : args.runtime.assessmentType === 'bullets'
      ? 'Use 6-8 bullet points. Each bullet can be 1-2 sentences with specific examples.'
      : 'Write a detailed paragraph of 6-10 sentences with specific examples from the essay.';

  const relateInstruction =
    'For each evidence quote, indicate which sentences or bullet points from your justification it supports. Return the indexes (starting from 0) as a field "relatedAssessmentIndexes" in each evidence object. If the justification is a paragraph, treat each sentence as a unit (split on periods, exclamation marks, or question marks). If it\'s a list, use each bullet as a unit.';

  const evidenceReferenceMode = args.runtime.evidenceReferenceMode || 'page';
  const spreadInstruction =
    evidenceReferenceMode === 'text'
      ? '   - From DIFFERENT parts of the essay (spread across the full response)'
      : '   - From DIFFERENT parts/pages of the essay (spread across the full document)';
  const evidenceObjectSchemaLines =
    evidenceReferenceMode === 'text'
      ? ['      "quote": "EXACT verbatim text from essay - character-for-character copy"']
      : [
          '      "quote": "EXACT verbatim text from essay - character-for-character copy",',
          '      "paragraph": "PAGE X, Section/Paragraph identifier",',
          '      "relatedAssessmentIndexes": [array of integers, optional]',
        ];
  const evidenceLinkingInstruction =
    evidenceReferenceMode === 'text'
      ? '4. Return evidence as an array of quote objects with only the "quote" field.'
      : `4. ${relateInstruction}`;

  const additionalFeedbackInstructionLines: string[] = [];
  if (slots.justificationStructureInstruction?.trim()) {
    additionalFeedbackInstructionLines.push(`${slots.justificationStructureInstruction}`);
  }
  if (args.effective.style.tonePreset !== DEFAULT_STYLE.tonePreset) {
    additionalFeedbackInstructionLines.push(`- Tone guidance: ${slots.toneInstruction}`);
  }
  if (args.effective.style.englishLevelPreset !== DEFAULT_STYLE.englishLevelPreset) {
    additionalFeedbackInstructionLines.push(`- English level guidance: ${slots.englishLevelInstruction}`);
  }

  const additionalFeedbackInstruction =
    additionalFeedbackInstructionLines.length > 0
      ? ['ADDITIONAL FEEDBACK INSTRUCTIONS:', ...additionalFeedbackInstructionLines].join('\n')
      : '';

  const intro =
    args.cacheMode === 'cached'
      ? 'Grade the following criterion using the rubric provided in the cached context.'
      : DEFAULT_GRADING_SYSTEM_PROMPT;

  const contextBlock = args.cacheMode === 'cached' ? '' : buildContextDump(args.runtime.contextDump);

  return [
    intro,
    contextBlock,
    `CRITERION: ${args.runtime.criterionName}`,
    `SCORE RANGE: ${args.runtime.scoreMin} to ${args.runtime.scoreMax}`,
    `ESSAY:\n${args.runtime.essayContent}`,
    'INSTRUCTIONS:',
    `1. First, evaluate the essay against EACH score level (${args.runtime.scoreMin} to ${args.runtime.scoreMax}) for this criterion. Determine which level the essay most closely matches.`,
    `2. Write a justification that is balanced and critical. Reference specific rubric level descriptions to explain your reasoning. Do not reveal or hint at the exact score. ${justificationInstruction} ${lengthInstruction}`,
    '3. Provide at least 5 VERBATIM quotes from the essay. CRITICAL: these must be EXACT copy-pastes from the essay - every word, space, and punctuation mark must match the original text exactly. Do NOT paraphrase, rephrase, reorder words, fix grammar, or alter the text in any way. If unsure of exact wording, use a shorter quote you are certain about.',
    '   Evidence requirements:',
    spreadInstruction,
    '   - UNIQUE to this criterion - avoid generic quotes that could apply to any criterion',
    '   - Include quotes showing both strengths AND weaknesses',
    '   - Each quote must be at least one full sentence or meaningful clause',
    evidenceLinkingInstruction,
    `5. Assign your numerical score (${args.runtime.scoreMin}-${args.runtime.scoreMax}) - must correspond to the rubric level you identified in step 1.`,
    ...(additionalFeedbackInstruction ? [`6. ${additionalFeedbackInstruction}`] : []),
    'FORMAT YOUR RESPONSE AS A VALID JSON object:',
    '{',
    `  ${justificationSchema}`,
    '  "evidence": [',
    '    {',
    ...evidenceObjectSchemaLines,
    '    },',
    '    ...',
    '  ],',
    '  "score": number',
    '}',
    'DO NOT include any explanatory text before or after the JSON object.',
    'ONLY return the JSON object and nothing else.',
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
