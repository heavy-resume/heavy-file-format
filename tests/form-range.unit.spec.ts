import { describe, expect, test } from 'vitest';

import { executeHvyCliCommand, createHvyCliSession } from '../src/cli-core/commands';
import { deserializeDocument } from '../src/serialization';
import { parseFormSpec, serializeFormSpec } from '../src/plugins/form-spec/form-spec';
import { createLiveState, reconcileLiveState } from '../src/plugins/form-live-state/form-live-state';
import { resolveFormRangeValue } from '../src/plugins/form-range-field/form-range-field';

describe('range field YAML', () => {
  test('parses bounds and round-trips them as numbers', () => {
    const before = `fields:
  - label: Fake volume
    type: range
    value: 0
    min: -10
    max: 10
    step: 0.5
`;

    const parsed = parseFormSpec(before);

    expect(parsed.error).toBeNull();
    expect(parsed.spec.fields[0]).toMatchObject({ type: 'range', value: '0', min: -10, max: 10, step: 0.5 });
    expect(serializeFormSpec(parsed.spec)).toBe(before.trimEnd());
  });

  test('defaults missing bounds and writes them out explicitly', () => {
    const parsed = parseFormSpec(`fields:
  - label: Fake volume
    type: range
`);

    expect(parsed.spec.fields[0]).toMatchObject({ value: '', min: 0, max: 100, step: 1 });
    expect(serializeFormSpec(parsed.spec)).toBe(`fields:
  - label: Fake volume
    type: range
    min: 0
    max: 100
    step: 1`);
  });

  test('replaces invalid bounds with defaults and drops a non-numeric default value', () => {
    const parsed = parseFormSpec(`fields:
  - label: Fake volume
    type: range
    value: loud
    min: low
    max: [1]
    step: 0
`);

    expect(parsed.spec.fields[0]).toMatchObject({ value: '', min: 0, max: 100, step: 1 });
    expect(serializeFormSpec(parsed.spec)).not.toContain('loud');
  });

  test('other field types do not write range bounds', () => {
    const parsed = parseFormSpec(`fields:
  - label: Fake note
    type: text
    min: 1
`);

    expect(serializeFormSpec(parsed.spec)).toBe(`fields:
  - label: Fake note
    type: text`);
  });
});

describe('range value resolution', () => {
  const percent = { min: 0, max: 100, step: 1 };

  test.each([
    ['midpoint when missing', '', percent, '50'],
    ['midpoint when not numeric', 'loud', percent, '50'],
    ['midpoint when boolean', true, percent, '50'],
    ['keeps a value on a step', '25', percent, '25'],
    ['accepts a number', 25, percent, '25'],
    ['keeps zero', '0', percent, '0'],
    ['clamps above max', '500', percent, '100'],
    ['clamps below min', '-5', percent, '0'],
    ['rounds to the nearest step', '12', { min: 0, max: 100, step: 5 }, '10'],
    ['rounds ties up', '5', { min: 0, max: 100, step: 10 }, '10'],
    ['measures steps from min', '4', { min: 1, max: 9, step: 2 }, '5'],
    ['stays below a max off the step grid', '10', { min: 0, max: 10, step: 3 }, '9'],
    ['snaps the midpoint default', '', { min: 0, max: 100, step: 30 }, '60'],
    ['does not accumulate float error', '0.3', { min: 0, max: 1, step: 0.1 }, '0.3'],
    ['keeps a float max reachable', '0.3', { min: 0, max: 0.3, step: 0.1 }, '0.3'],
    ['handles negative decimal bounds', '-0.25', { min: -1, max: 1, step: 0.25 }, '-0.25'],
    ['uses min when max is below min', '5', { min: 10, max: 0, step: 1 }, '10'],
  ])('%s', (_name, value, bounds, expectedResult) => {
    expect(resolveFormRangeValue(value, bounds)).toBe(expectedResult);
  });
});

describe('range live state', () => {
  test('starts at the resolved value so scripts read what the slider shows', () => {
    const live = createLiveState(parseFormSpec(`fields:
  - label: Fake default
    type: range
  - label: Fake authored
    type: range
    value: 500
`).spec);

    expect(live.values).toEqual({ 'Fake default': '50', 'Fake authored': '100' });
  });

  test('keeps moved values across refreshes and clamps them when bounds shrink', () => {
    const spec = parseFormSpec(`fields:
  - label: Fake volume
    type: range
`).spec;
    const live = createLiveState(spec);
    live.values['Fake volume'] = '80';

    reconcileLiveState(live, spec);
    expect(live.values['Fake volume']).toBe('80');

    spec.fields[0]!.max = 60;
    reconcileLiveState(live, spec);
    expect(live.values['Fake volume']).toBe('60');
  });
});

test('hvy lint accepts range bounds and lists range as a valid type', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake section

<!--hvy:plugin {"id":"fake-range-form","plugin":"hvy.form","pluginConfig":{"version":"0.1"}}-->
fields:
  - label: Fake volume
    type: range
    min: 0
    max: 10
    step: 2
  - label: Fake other
    type: slider
`, '.hvy');

  const result = await executeHvyCliCommand(document, createHvyCliSession(), 'hvy lint');

  expect(result.output).not.toContain('unsupported key');
  expect(result.output).toContain('form field "Fake other" uses unsupported type "slider". Valid types: text, textarea, number, range, select, checkbox, radio, date, email, tel, url, password, hidden, photo.');
});
