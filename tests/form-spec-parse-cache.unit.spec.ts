import { beforeEach, expect, test, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { parseFormSpec } from '../src/plugins/form-spec/form-spec';

vi.mock('yaml', async (importOriginal) => {
  const original = await importOriginal<typeof import('yaml')>();
  return { ...original, parse: vi.fn(original.parse) };
});

const fakeFormSource = (name: string) => `fields:
  - label: ${name}
    type: select
    options:
      - Fake option
scripts:
  fake_script: |
    doc.header.set("fake", 1)
`;

beforeEach(() => {
  vi.mocked(parseYaml).mockClear();
});

test('parsing the same form source again reuses the YAML parse', () => {
  const source = fakeFormSource('Fake reuse');
  const firstResult = parseFormSpec(source);

  const secondResult = parseFormSpec(source);

  expect(secondResult).toEqual(firstResult);
  expect(vi.mocked(parseYaml)).toHaveBeenCalledTimes(1);
});

test('changing a parsed spec does not affect the next parse of that source', () => {
  const source = fakeFormSource('Fake mutation');
  const firstResult = parseFormSpec(source);

  firstResult.spec.fields[0]!.label = 'Changed label';
  firstResult.spec.fields[0]!.options.push({ label: 'Changed option', value: 'Changed option' });
  firstResult.spec.fields.push({ ...firstResult.spec.fields[0]! });
  firstResult.spec.scripts.fake_script = 'changed';

  const expectedResult = parseFormSpec(source);
  expect(expectedResult.spec.fields).toHaveLength(1);
  expect(expectedResult.spec.fields[0]!.label).toBe('Fake mutation');
  expect(expectedResult.spec.fields[0]!.options).toEqual([{ label: 'Fake option', value: 'Fake option' }]);
  expect(expectedResult.spec.scripts.fake_script).toBe('doc.header.set("fake", 1)\n');
});

test('invalid YAML reports the same error every time', () => {
  const source = 'fields: [unterminated';

  const firstResult = parseFormSpec(source);
  const secondResult = parseFormSpec(source);

  expect(firstResult.error).toBeTruthy();
  expect(secondResult.error).toBe(firstResult.error);
});

test('the same source with different config applies each config', () => {
  const source = fakeFormSource('Fake config');

  expect(parseFormSpec(source, { submitLabel: 'First' }).spec.submitLabel).toBe('First');
  expect(parseFormSpec(source, { submitLabel: 'Second' }).spec.submitLabel).toBe('Second');
});

test('a different source is parsed on its own', () => {
  expect(parseFormSpec(fakeFormSource('Fake first')).spec.fields[0]!.label).toBe('Fake first');
  expect(parseFormSpec(fakeFormSource('Fake second')).spec.fields[0]!.label).toBe('Fake second');
});
