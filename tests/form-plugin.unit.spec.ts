import { describe, expect, test } from 'vitest';

import { parseFormSpec, serializeFormConfig, serializeFormSpec } from '../src/plugins/form';

describe('form plugin YAML', () => {
  test('normalizes fields, options, scripts, and triggers from YAML', () => {
    const parsed = parseFormSpec(`fields:
  - label: Food
    type: select
    value: soup
    required: true
    options:
      - Apple
      - label: Soup
        value: soup
    triggers:
      input: live_update
      change: populate_food
      blur: validate_food
    meta:
      css: "gap: 0.5rem;"
  - label: Subscribe
    type: checkbox
    value: true
scripts:
  populate_food: |
    doc.form.set_value("Notes", "Bring a spoon.")
`, {
      initialScript: 'populate_food',
      submitScript: 'populate_food',
      submitLabel: 'Save lunch order',
      showSubmit: false,
    });

    expect(parsed.error).toBeNull();
    expect(parsed.spec.fields[0]).toMatchObject({
      label: 'Food',
      type: 'select',
      value: 'soup',
      required: true,
      options: [
        { label: 'Apple', value: 'Apple' },
        { label: 'Soup', value: 'soup' },
      ],
      triggers: {
        input: 'live_update',
        change: 'populate_food',
        blur: 'validate_food',
      },
      meta: {
        css: 'gap: 0.5rem;',
      },
    });
    expect(parsed.spec.fields[1]).toMatchObject({
      label: 'Subscribe',
      type: 'checkbox',
      value: true,
    });
    expect(parsed.spec.scripts.populate_food).toContain('doc.form.set_value');
    expect(parsed.spec.initialScript).toBe('populate_food');
    expect(parsed.spec.submitScript).toBe('populate_food');
    expect(parsed.spec.submitLabel).toBe('Save lunch order');
    expect(parsed.spec.showSubmit).toBe(false);
  });

  test('reports invalid YAML without throwing', () => {
    const parsed = parseFormSpec('fields:\n  - label: Food\n    type: [');

    expect(parsed.error).toContain('Flow sequence');
    expect(parsed.spec.fields).toEqual([]);
  });

  test('normalizes case-insensitive dropdown field aliases to select', () => {
    const parsed = parseFormSpec(`fields:
  - label: Chore
    type: DROPDOWN
`);

    expect(parsed.error).toBeNull();
    expect(parsed.spec.fields[0]?.type).toBe('select');
    expect(serializeFormSpec(parsed.spec)).toContain('type: select');
  });

  test('serializes normalized form data back to YAML', () => {
    const parsed = parseFormSpec(`fields:
  - label: Email
    type: email
    placeholder: you@example.com
    meta:
      css: "max-width: 24rem;"
scripts:
  submit_form: |
    doc.header.set("submitted", True)
`);

    const expectedResult = serializeFormSpec(parsed.spec);

    expect(expectedResult).toContain('fields:');
    expect(expectedResult).toContain('type: email');
    expect(expectedResult).toContain('placeholder: you@example.com');
    expect(expectedResult).toContain('meta:');
    expect(expectedResult).toContain('css: "max-width: 24rem;"');
    expect(expectedResult).toContain('submit_form');
    expect(expectedResult).not.toContain('submitLabel');
    expect(serializeFormConfig({ ...parsed.spec, submitLabel: 'Send details', submitScript: 'submit_form' })).toMatchObject({
      submitLabel: 'Send details',
      submitScript: 'submit_form',
    });
  });

  test('normalizes AI submit behavior from plugin config', () => {
    const parsed = parseFormSpec(`fields:
  - label: Topic
    type: text
scripts:
  prepare: |
    return doc.form.get_value("Topic")
  apply: |
    doc.header.set("generated", response)
`, {
      submitAction: 'ai-generate',
      submitSourceScript: 'prepare',
      submitScript: 'apply',
      submitPrompt: 'Generate cards.',
      submitInputCharLimit: 2500,
      submitOutputCharLimit: 9000,
      submitLabel: 'Generate flashcards',
      scriptLibraries: ['random', 'browser'],
      scriptStepBudget: 1234,
    });

    expect(parsed.error).toBeNull();
    expect(parsed.spec.submitAction).toBe('ai-generate');
    expect(parsed.spec.submitSourceScript).toBe('prepare');
    expect(parsed.spec.submitScript).toBe('apply');
    expect(parsed.spec.submitPrompt).toBe('Generate cards.');
    expect(parsed.spec.submitInputCharLimit).toBe(2500);
    expect(parsed.spec.submitOutputCharLimit).toBe(9000);
    expect(parsed.spec.scriptLibraries).toEqual(['random']);
    expect(parsed.spec.scriptStepBudget).toBe(1234);
    expect(serializeFormConfig(parsed.spec)).toMatchObject({
      submitAction: 'ai-generate',
      submitSourceScript: 'prepare',
      submitScript: 'apply',
      submitPrompt: 'Generate cards.',
      submitInputCharLimit: 2500,
      submitOutputCharLimit: 9000,
      scriptLibraries: ['random'],
      scriptStepBudget: 1234,
    });
  });
});
