import { afterEach, expect, test } from 'vitest';

import {
  filterPdfAllowedComponentDefs,
  isPdfAllowedBaseComponent,
  isPdfAllowedComponent,
  isPdfDocument,
} from '../src/pdf-document-capabilities';
import { setReferenceAppConfig } from '../src/reference-config';
import type { ComponentDefinition, VisualDocument } from '../src/types';

afterEach(() => {
  setReferenceAppConfig(null);
});

test('detects PHVY documents as PDF documents', () => {
  expect(isPdfDocument({ extension: '.phvy' })).toBe(true);
  expect(isPdfDocument({ extension: '.hvy' })).toBe(false);
});

test('allows only PDF-compatible base components', () => {
  setReferenceAppConfig({ features: { tables: true, allowExternalCss: false } });

  expect(isPdfAllowedBaseComponent('text')).toBe(true);
  expect(isPdfAllowedBaseComponent('container')).toBe(true);
  expect(isPdfAllowedBaseComponent('grid')).toBe(true);
  expect(isPdfAllowedBaseComponent('image')).toBe(true);
  expect(isPdfAllowedBaseComponent('table')).toBe(true);
  expect(isPdfAllowedBaseComponent('plugin')).toBe(false);
  expect(isPdfAllowedBaseComponent('expandable')).toBe(false);
});

test('resolves custom component templates through their PDF-compatible base type', () => {
  const meta: VisualDocument['meta'] = {
    component_defs: [
      { name: 'pdf-callout', baseType: 'container' },
      { name: 'interactive-detail', baseType: 'expandable' },
    ],
  };

  expect(isPdfAllowedComponent('pdf-callout', meta)).toBe(true);
  expect(isPdfAllowedComponent('interactive-detail', meta)).toBe(false);
  expect(filterPdfAllowedComponentDefs(meta.component_defs as ComponentDefinition[], meta).map((def) => def.name)).toEqual([
    'pdf-callout',
  ]);
});

test('omits table from PDF components when static tables are disabled', () => {
  setReferenceAppConfig({ features: { tables: false, allowExternalCss: false } });

  expect(isPdfAllowedBaseComponent('table')).toBe(false);
  expect(isPdfAllowedComponent('table', {})).toBe(false);
});
