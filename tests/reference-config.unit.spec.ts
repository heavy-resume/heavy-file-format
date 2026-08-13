import { afterEach, expect, test } from 'vitest';

import { getComponentOptions } from '../src/component-defs';
import {
  getAiEditorDoubleClickDelayMs,
  getReferenceAppConfig,
  setReferenceAppConfig,
  setRuntimeSemanticFilterConcurrency,
} from '../src/reference-config';
import { registerSerializationTestState } from './serialization-test-helpers';

registerSerializationTestState();

afterEach(() => {
  setRuntimeSemanticFilterConcurrency(null);
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

test('semantic filter provider can be supplied through reference config', () => {
  const semanticFilterProvider = () => [];
  setReferenceAppConfig({
    semanticFilterProvider,
  });

  expect(getReferenceAppConfig().semanticFilterProvider).toBe(semanticFilterProvider);
});

test('semantic filter concurrency defaults to three and can be configured', () => {
  expect(getReferenceAppConfig().semanticFilterConcurrency).toBe(3);

  setReferenceAppConfig({ semanticFilterConcurrency: 2 });

  expect(getReferenceAppConfig().semanticFilterConcurrency).toBe(2);
});

test('semantic filter concurrency can be scoped to the active embedded runtime', () => {
  setRuntimeSemanticFilterConcurrency(1);

  expect(getReferenceAppConfig().semanticFilterConcurrency).toBe(1);

  setRuntimeSemanticFilterConcurrency(null);
  expect(getReferenceAppConfig().semanticFilterConcurrency).toBe(3);
});
