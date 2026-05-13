import { afterEach, expect, test } from 'vitest';

import { getComponentOptions } from '../src/component-defs';
import { getAiEditorDoubleClickDelayMs, setReferenceAppConfig } from '../src/reference-config';
import { registerSerializationTestState } from './serialization-test-helpers';

registerSerializationTestState();

afterEach(() => {
  setReferenceAppConfig(null);
});

test('component options exclude tables when the reference app disables them', () => {
  setReferenceAppConfig({
    features: {
      tables: false,
      allowExternalCss: false,
    },
  });

  expect(getComponentOptions()).not.toContain('table');
});

test('component options include tables when the reference app enables them', () => {
  setReferenceAppConfig({
    features: {
      tables: true,
      allowExternalCss: false,
    },
  });

  expect(getComponentOptions()).toContain('table');
});

test('ai editor double click delay defaults to the reader action delay', () => {
  expect(getAiEditorDoubleClickDelayMs()).toBe(250);
});

test('ai editor double click delay can be tuned by embedded hosts', () => {
  setReferenceAppConfig({
    aiEditor: {
      doubleClickDelayMs: 250.6,
    },
  });

  expect(getAiEditorDoubleClickDelayMs()).toBe(251);
});

test('ai editor double click delay does not go below zero', () => {
  setReferenceAppConfig({
    aiEditor: {
      doubleClickDelayMs: -25,
    },
  });

  expect(getAiEditorDoubleClickDelayMs()).toBe(0);
});
