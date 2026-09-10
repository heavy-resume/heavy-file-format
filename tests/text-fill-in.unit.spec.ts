import { beforeAll, expect, test } from 'vitest';

import { applyRichAction } from '../src/block-ops';
import { deserializeDocument } from '../src/serialization';
import { initCallbacks, initState, state } from '../src/state';
import { applyTextFillInValue, removeTextFillInMarkers } from '../src/text-fill-in';
import { createTestState } from './serialization-test-helpers';

beforeAll(() => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
});

test('removing empty styled fill-ins does not leak markdown emphasis delimiters', () => {
  expect(removeTextFillInMarkers('Before _<!-- value -->_ after')).toBe('Before  after');
  expect(removeTextFillInMarkers('Before __<!-- value {"placeholder":"Name"} -->__ after')).toBe('Before  after');
  expect(removeTextFillInMarkers('Before ___<!-- value -->___ after')).toBe('Before  after');
});

test('filled styled fill-ins keep their markdown emphasis delimiters', () => {
  expect(applyTextFillInValue('Before _<!-- value -->_ after', 'Ada')).toBe('Before _Ada_ after');
});

test('expected result: converting selected duplicate text marks the selected occurrence as the fill-in', () => {
  initState(createTestState(deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {"id":"duplicate-text"}-->
  Repeat and Repeat
`, '.hvy')));

  const section = state.document.sections[0]!;
  const block = section.blocks[0]!;
  const selectedTextNode = { textContent: block.text };
  const selectedSecondOccurrence = {
    collapsed: false,
    commonAncestorContainer: selectedTextNode,
    startContainer: selectedTextNode,
    endContainer: selectedTextNode,
    startOffset: 11,
    endOffset: 17,
    toString: () => selectedTextNode.textContent.slice(11, 17),
  } as unknown as Range;
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      getSelection: () => ({
        rangeCount: 1,
        getRangeAt: () => selectedSecondOccurrence,
      }),
    },
  });
  try {
    applyRichAction('fill-in', {
      dataset: {
        field: 'block-rich',
        sectionKey: section.key,
        blockId: block.id,
      },
      contains: (node: unknown) => node === selectedTextNode,
    } as unknown as HTMLElement);

    expect(block.text).toBe('Repeat and <!-- value {"placeholder":"Repeat"} -->');
  } finally {
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});
