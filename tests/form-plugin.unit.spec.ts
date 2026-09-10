import { describe, expect, test } from 'vitest';

import { claimFormInitialization, parseFormSpec, serializeFormConfig, serializeFormSpec } from '../src/plugins/form';
import { getFormPhotoResizeBounds, normalizeFormPhotoMeta } from '../src/plugins/form-photo-field/form-photo-field';
import type { VisualBlock } from '../src/editor/types';
import type { VisualDocument } from '../src/types';

describe('form plugin YAML', () => {
  test('initialization is claimed once per document and form component lifecycle', () => {
    const document = {} as VisualDocument;
    const form = { text: '', schema: { pluginConfig: {} } } as VisualBlock;

    expect(claimFormInitialization(document, form)).toBe(true);
    expect(claimFormInitialization(document, form)).toBe(false);
    expect(claimFormInitialization(document, { text: '', schema: { pluginConfig: {} } } as VisualBlock)).toBe(true);
    expect(claimFormInitialization({} as VisualDocument, form)).toBe(true);
  });

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
      changeScript: 'populate_food',
      submitScript: 'populate_food',
      submitLabel: 'Save lunch order',
      showSubmit: false,
      formCss: 'display: grid;',
      actionsCss: 'grid-column: 1 / -1;',
      submitCss: 'justify-self: end;',
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
    expect(parsed.spec.changeScript).toBe('populate_food');
    expect(parsed.spec.submitScript).toBe('populate_food');
    expect(parsed.spec.submitLabel).toBe('Save lunch order');
    expect(parsed.spec.showSubmit).toBe(false);
    expect(parsed.spec.formCss).toBe('display: grid;');
    expect(parsed.spec.actionsCss).toBe('grid-column: 1 / -1;');
    expect(parsed.spec.submitCss).toBe('justify-self: end;');
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
    type: textarea
    rows: 4
    placeholder: you@example.com
    meta:
      css: "max-width: 24rem;"
scripts:
  submit_form: |
    doc.header.set("submitted", True)
`);

    const expectedResult = serializeFormSpec(parsed.spec);

    expect(expectedResult).toContain('fields:');
    expect(expectedResult).toContain('type: textarea');
    expect(expectedResult).toContain('rows: 4');
    expect(expectedResult).toContain('placeholder: you@example.com');
    expect(expectedResult).toContain('meta:');
    expect(expectedResult).toContain('css: "max-width: 24rem;"');
    expect(expectedResult).toContain('submit_form');
    expect(expectedResult).not.toContain('submitLabel');
    expect(serializeFormConfig({
      ...parsed.spec,
      formCss: 'display: grid;',
      actionsCss: 'grid-column: 1 / -1;',
      submitCss: 'margin-inline-start: auto;',
      submitLabel: 'Send details',
      changeScript: 'submit_form',
      submitScript: 'submit_form',
    })).toMatchObject({
      formCss: 'display: grid;',
      actionsCss: 'grid-column: 1 / -1;',
      submitCss: 'margin-inline-start: auto;',
      submitLabel: 'Send details',
      changeScript: 'submit_form',
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
      scriptLibraries: ['random', 're', 'datetime', 'browser'],
      scriptStepBudget: 1234,
    });

    expect(parsed.error).toBeNull();
    expect(parsed.spec.submitAction).toBe('ai-generate');
    expect(parsed.spec.submitSourceScript).toBe('prepare');
    expect(parsed.spec.submitScript).toBe('apply');
    expect(parsed.spec.submitPrompt).toBe('Generate cards.');
    expect(parsed.spec.submitInputCharLimit).toBe(2500);
    expect(parsed.spec.submitOutputCharLimit).toBe(9000);
    expect(parsed.spec.scriptLibraries).toEqual(['random', 're', 'datetime']);
    expect(parsed.spec.scriptStepBudget).toBe(1234);
    expect(serializeFormConfig(parsed.spec)).toMatchObject({
      submitAction: 'ai-generate',
      submitSourceScript: 'prepare',
      submitScript: 'apply',
      submitPrompt: 'Generate cards.',
      submitInputCharLimit: 2500,
      submitOutputCharLimit: 9000,
      scriptLibraries: ['random', 're', 'datetime'],
      scriptStepBudget: 1234,
    });
  });

  test('normalizes and serializes photo constraints for submit scripts', () => {
    const parsed = parseFormSpec(`fields:
  - label: Profile Photo
    type: photo
    required: true
    meta:
      accept:
        - image/jpeg
        - image/png
      maxBytes: 5000000
      maxWidth: 1200
      maxHeight: 1200
scripts:
  submit: |
    photo = doc.form.get_value("Profile Photo")
`);

    expect(parsed.error).toBeNull();
    expect(parsed.spec.fields[0]).toMatchObject({
      label: 'Profile Photo',
      type: 'photo',
      value: null,
      required: true,
      meta: {
        accept: ['image/jpeg', 'image/png'],
        maxBytes: 5_000_000,
        maxWidth: 1200,
        maxHeight: 1200,
      },
    });

    const expectedResult = serializeFormSpec(parsed.spec);
    expect(expectedResult).toContain('type: photo');
    expect(expectedResult).toContain('maxBytes: 5000000');
    expect(expectedResult).toContain('maxWidth: 1200');
    expect(expectedResult).toContain('maxHeight: 1200');
    expect(expectedResult).not.toContain('value: null');
  });

  test('photo dimensions override document defaults only when configured', () => {
    expect(getFormPhotoResizeBounds(
      normalizeFormPhotoMeta({ maxWidth: 800 }),
      { image_attachment_max_dimensions: { width: 1600, height: 900 } },
    )).toEqual({ width: 800 });

    expect(getFormPhotoResizeBounds(
      normalizeFormPhotoMeta({}),
      { image_attachment_max_dimensions: { width: 1600, height: 900 } },
    )).toEqual({ width: 1600, height: 900 });
  });
});
