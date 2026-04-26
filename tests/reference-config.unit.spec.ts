import { afterEach, expect, test } from 'vitest';

import { getComponentOptions } from '../src/component-defs';
import { setReferenceAppConfig } from '../src/reference-config';
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
