import type { HvyPlugin } from './types';

const SKILL_DESCRIPTION_GENERATOR_KEY = 'dev.heavy.resume.skill-description';
const TOOL_DESCRIPTION_GENERATOR_KEY = 'dev.heavy.resume.tool-description';

export const resumeOutputGeneratorsPlugin: HvyPlugin = {
  id: 'dev.heavy.resume-generators',
  displayName: 'Resume Generators',
  outputGenerators: [
    {
      key: SKILL_DESCRIPTION_GENERATOR_KEY,
      label: 'Generate',
      requiredVariables: ['skill'],
      generate: (request) => ({
        prompt: buildDescriptionPrompt({
          label: 'skill',
          value: request.values.skill,
          instruction: 'Write a concise resume-ready description of this skill.',
        }),
        responseInstructions: 'Return only the generated description text. Use one concise sentence. Do not include Markdown, labels, or explanations.',
        inputCharLimit: 600,
        outputCharLimit: 320,
      }),
    },
    {
      key: TOOL_DESCRIPTION_GENERATOR_KEY,
      label: 'Generate',
      requiredVariables: ['tool_technology'],
      generate: (request) => ({
        prompt: buildDescriptionPrompt({
          label: 'tool / technology',
          value: request.values.tool_technology,
          instruction: 'Write a concise resume-ready description of this tool or technology.',
        }),
        responseInstructions: 'Return only the generated description text. Use one concise sentence. Do not include Markdown, labels, or explanations.',
        inputCharLimit: 600,
        outputCharLimit: 320,
      }),
    },
  ],
};

function buildDescriptionPrompt(params: { label: string; value: string | undefined; instruction: string }): string {
  return [
    params.instruction,
    `Provided ${params.label}: ${params.value?.trim() ?? ''}`,
    'Keep it specific enough for a resume library entry, but do not invent personal experience.',
  ].join('\n');
}
