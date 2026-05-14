import { expect, test } from 'vitest';

import { resumeOutputGeneratorsPlugin } from '../src/plugins/resume-output-generators';
import type { HvyOutputGeneratorRequest } from '../src/plugins/types';

function request(values: Record<string, string>): HvyOutputGeneratorRequest {
  return {
    document: { meta: {}, extension: '.thvy', sections: [], attachments: [] },
    component: 'skill-record',
    variable: 'description',
    variableType: 'block',
    label: 'Description',
    values,
    target: { kind: 'section', sectionKey: 'section-test' },
  };
}

test('resume skill description generator uses only provided skill value', async () => {
  const generator = resumeOutputGeneratorsPlugin.outputGenerators?.find((item) => item.key === 'dev.heavy.resume.skill-description');
  if (!generator) throw new Error('Expected skill description generator');

  const response = await generator.generate(request({ skill: 'Systems Design' }));

  expect(response.prompt).toContain('Provided skill: Systems Design');
  expect(response.prompt).not.toContain('tool_technology');
  expect(response.answer).toBeUndefined();
});

test('resume tool description generator uses only provided tool value', async () => {
  const generator = resumeOutputGeneratorsPlugin.outputGenerators?.find((item) => item.key === 'dev.heavy.resume.tool-description');
  if (!generator) throw new Error('Expected tool description generator');

  const response = await generator.generate(request({ tool_technology: 'TypeScript' }));

  expect(response.prompt).toContain('Provided tool / technology: TypeScript');
  expect(response.prompt).not.toContain('skill');
  expect(response.answer).toBeUndefined();
});
