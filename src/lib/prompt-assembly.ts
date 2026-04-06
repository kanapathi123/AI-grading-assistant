// Ported from prompt-craft/src/lib/promptAssembly.ts
import type { Criterion } from '@/types';

export type RubricCriterion = Criterion;

export interface PromptConfig {
  academicLevel: string;
  subject: string;
  assignmentDesc: string;
  feedbackText: string;
  criteria: Criterion[];
  additionalMaterial?: string;
  showAdditionalMaterial?: boolean;
  additionalDescription?: string;
  showAdditionalDescription?: boolean;
}

export interface FewShotExample {
  essayText: string;
  correctedGrading: {
    results: Array<{
      criterionName: string;
      score: number;
      feedback: string;
      evidenceQuotes: string[];
    }>;
  };
}

function buildRubricJson(criteria: Criterion[]) {
  return {
    criteria: criteria.map((c) => {
      const levelsObj: Record<string, string> = {};
      if (Array.isArray(c.levels)) {
        c.levels.forEach((l) => { levelsObj[String(l.score)] = l.description; });
      } else {
        const min = c.scoreRange?.min ?? 0;
        const max = c.scoreRange?.max ?? 3;
        for (let score = max; score >= min; score -= 1) {
          levelsObj[String(score)] = `Score ${score} description`;
        }
      }
      return { name: c.name, minScore: c.scoreRange.min, maxScore: c.scoreRange.max, levels: levelsObj };
    }),
  };
}

/**
 * Generate the system prompt from saved configuration
 */
export function generateSystemPrompt(config: PromptConfig): string {
  const blocks: string[] = [];

  blocks.push(
    `You are an expert essay grader of a ${config.academicLevel} level ${config.subject} course. Grade the provided student essay based on the rubric. Evaluate each criterion independently and provide specific feedback with evidence from the text then provide score based on the feedback and evidence. Return ONLY valid JSON.`
  );

  const contextBlocks: string[] = [];
  contextBlocks.push(`CONTEXT`);
  contextBlocks.push(`Assignment: ${config.assignmentDesc}`);
  if (config.showAdditionalMaterial && config.additionalMaterial?.trim()) {
    contextBlocks.push(`Additional Material:\n${config.additionalMaterial}`);
  }
  blocks.push(contextBlocks.join('\n'));

  blocks.push(`RUBRIC\n${JSON.stringify(buildRubricJson(config.criteria), null, 2)}`);

  if (config.showAdditionalDescription && config.additionalDescription?.trim()) {
    blocks.push(`ADDITIONAL DESCRIPTION\n${config.additionalDescription}`);
  }

  blocks.push(
    `OUTPUT\nProvide the following in your response:\n- A justification for your evaluation (${config.feedbackText || 'Be specific and constructive.'})\n- At least 1 specific quote from the essay that supports your assessment\n- Your numerical score must be between minScore and maxScore for the criterion`
  );

  const justificationFormat = config.feedbackText
    ? `(${config.feedbackText})`
    : '(Be specific and constructive. Each point should be a separate string in the array.)';

  blocks.push(`OUTPUT FORMAT\nReturn ONLY valid JSON in this exact schema:
{
  "results": [
    {
      "criterionName": string (MUST exactly match the criterion name from the rubric),
      "justification": string[] ${justificationFormat},
      "evidenceQuotes": [{ "quote": string }] (array of quote objects from the essay),
      "score": number (MUST be between minScore and maxScore for this criterion)
    }
  ]
}

CRITICAL REQUIREMENTS:
1. Return one result object for EACH criterion in the rubric
2. The "criterionName" MUST exactly match the "name" field from the rubric
3. The "score" MUST be a number between the criterion's minScore and maxScore
4. Always return valid JSON, even if uncertain
5. Include all required fields without exception
6. Do NOT add extra criteria not in the rubric
7. Do NOT skip any criteria from the rubric
8. The output must be valid JSON (RFC 8259)
9. Avoid markdown, explanations, or comments outside the JSON
10. Do not use trailing commas
11. Strings must use double quotes
12. Escape double quotes within quotes using \\"
13. Ensure arrays and objects are properly closed.`);

  return blocks.join('\n\n');
}

/**
 * Generate a preview prompt (no essay, for display in the UI)
 */
export function generatePreviewPrompt(config: PromptConfig): string {
  const blocks: string[] = [];

  blocks.push(
    `You are an expert essay grader of a ${config.academicLevel} level ${config.subject} course. Grade the provided student essay based on the rubric. Evaluate each criterion independently and provide specific feedback with evidence from the text then provide score based on the feedback and evidence. Return ONLY valid JSON.`
  );

  const contextBlocks: string[] = [];
  contextBlocks.push(`CONTEXT`);
  contextBlocks.push(`Assignment: ${config.assignmentDesc}`);
  if (config.showAdditionalMaterial && config.additionalMaterial?.trim()) {
    contextBlocks.push(`Additional Material:\n${config.additionalMaterial}`);
  }
  blocks.push(contextBlocks.join('\n'));

  blocks.push(`RUBRIC\n${JSON.stringify(buildRubricJson(config.criteria), null, 2)}`);

  if (config.showAdditionalDescription && config.additionalDescription?.trim()) {
    blocks.push(`ADDITIONAL DESCRIPTION\n${config.additionalDescription}`);
  }

  blocks.push(
    `OUTPUT\nProvide the following in your response:\n- A feedback for your evaluation. ${config.feedbackText || 'Be specific and constructive.'}\n- At least 1 specific quote from the essay that supports your assessment\n- Your numerical score must be between minScore and maxScore for the criterion`
  );

  return blocks.join('\n\n');
}

/**
 * Generate a system prompt with few-shot examples
 */
export function generateSystemPromptWithExamples(
  config: PromptConfig,
  examples: FewShotExample[]
): string {
  const prompt = generateSystemPrompt(config);
  if (examples.length === 0) return prompt;

  const exampleBlocks = examples.map(
    (ex, i) =>
      `EXAMPLE ${i + 1}:\nEssay:\n${ex.essayText}\n\nExpected Output:\n${JSON.stringify(ex.correctedGrading, null, 2)}`
  );
  const examplesSection = `EXAMPLES\n${exampleBlocks.join('\n\n')}`;
  const outputMarker = '\n\nOUTPUT\n';

  if (prompt.includes(outputMarker)) {
    return prompt.replace(outputMarker, `\n\n${examplesSection}${outputMarker}`);
  }
  return `${prompt}\n\n${examplesSection}`;
}

/**
 * Validate that a config is complete enough to run
 */
export function validatePromptConfig(
  config: Partial<PromptConfig>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.academicLevel?.trim()) errors.push('Academic Level is required');
  if (!config.subject?.trim()) errors.push('Subject is required');
  if (!config.assignmentDesc?.trim()) errors.push('Assignment Description is required');
  if (!config.feedbackText?.trim()) errors.push('Feedback Instructions are required');

  if (!config.criteria || config.criteria.length === 0) {
    errors.push('At least one rubric criterion is required');
  } else {
    config.criteria.forEach((c, idx) => {
      if (!String(c.name ?? '').trim()) errors.push(`Criterion ${idx + 1}: Name is required`);
      if ((c.scoreRange?.max ?? 0) <= 0) errors.push(`Criterion ${idx + 1}: Max score must be > 0`);
      if ((c.scoreRange?.min ?? 0) < 0) errors.push(`Criterion ${idx + 1}: Min score cannot be negative`);
      if ((c.scoreRange?.min ?? 0) >= (c.scoreRange?.max ?? 0))
        errors.push(`Criterion ${idx + 1}: Min score must be less than max score`);
    });
  }

  if (config.showAdditionalMaterial && !config.additionalMaterial?.trim())
    errors.push('Additional Material is enabled but empty');
  if (config.showAdditionalDescription && !config.additionalDescription?.trim())
    errors.push('Additional Description is enabled but empty');

  return { valid: errors.length === 0, errors };
}
