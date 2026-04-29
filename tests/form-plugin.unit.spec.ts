import { describe, expect, test } from 'vitest';

import { parseFormSpec, serializeFormSpec } from '../src/plugins/form';

describe('form plugin YAML', () => {
  test('normalizes fields, options, scripts, and triggers from YAML', () => {
    const parsed = parseFormSpec(`fields:
  - name: food
    label: Food
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
  - name: subscribed
    label: Subscribe
    type: checkbox
    value: true
scripts:
  populate_food: |
    doc.form.set_value("note", "Bring a spoon.")
initialScript: populate_food
submitScript: populate_food
`);

    expect(parsed.error).toBeNull();
    expect(parsed.spec.fields[0]).toMatchObject({
      name: 'food',
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
    });
    expect(parsed.spec.fields[1]).toMatchObject({
      name: 'subscribed',
      type: 'checkbox',
      value: true,
    });
    expect(parsed.spec.scripts.populate_food).toContain('doc.form.set_value');
    expect(parsed.spec.initialScript).toBe('populate_food');
    expect(parsed.spec.submitScript).toBe('populate_food');
  });

  test('reports invalid YAML without throwing', () => {
    const parsed = parseFormSpec('fields:\n  - name: food\n    type: [');

    expect(parsed.error).toContain('Flow sequence');
    expect(parsed.spec.fields).toEqual([]);
  });

  test('serializes normalized form data back to YAML', () => {
    const parsed = parseFormSpec(`fields:
  - name: email
    label: Email
    type: email
    placeholder: you@example.com
scripts:
  submit_form: |
    doc.header.set("submitted", True)
submitScript: submit_form
`);

    const expectedResult = serializeFormSpec(parsed.spec);

    expect(expectedResult).toContain('fields:');
    expect(expectedResult).toContain('type: email');
    expect(expectedResult).toContain('placeholder: you@example.com');
    expect(expectedResult).toContain('submit_form');
  });
});
