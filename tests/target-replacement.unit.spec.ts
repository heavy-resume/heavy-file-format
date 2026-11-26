import { describe, expect, test } from 'vitest';
import { deserializeDocument } from '../src/serialization';
import {
  applyPreparedTargetReplacement,
  prepareTargetReplacement,
} from '../src/embed-target-edit';

describe('embedded target replacement', () => {
  test('expected result: a prepared replacement preserves target identity and mutates only when applied', () => {
    const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake section

 <!--hvy:text {"id":"fake-copy"}-->
  Fake original.
`, '.hvy');
    const originalBlock = document.sections[0]!.blocks[0]!;
    const originalRuntimeId = originalBlock.id;

    const prepared = prepareTargetReplacement(
      document,
      { sectionKey: document.sections[0]!.key, blockId: originalRuntimeId },
      '<!--hvy:image {"src":"fake.png","alt":"Fake image"}-->'
    );
    expect(originalBlock.schema.component).toBe('text');

    const expectedResult = applyPreparedTargetReplacement(prepared);

    expect(originalBlock.id).toBe(originalRuntimeId);
    expect(originalBlock.schema.component).toBe('image');
    expect(originalBlock.schema.id).toBe('fake-copy');
    expect(expectedResult.previousHvy).toContain('Fake original.');
    expect(expectedResult.replacementHvy).toContain('hvy:image');
  });

  test('expected result: invalid multi-component HVY leaves the target unchanged', () => {
    const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake section

 <!--hvy:text {}-->
  Fake original.
`, '.hvy');
    const target = {
      sectionKey: document.sections[0]!.key,
      blockId: document.sections[0]!.blocks[0]!.id,
    };

    expect(() => prepareTargetReplacement(
      document,
      target,
      '<!--hvy:text {}-->\nFake one.\n\n<!--hvy:text {}-->\nFake two.'
    )).toThrow('must be one valid HVY component');
    expect(document.sections[0]!.blocks[0]!.text).toBe('Fake original.');
  });
});
