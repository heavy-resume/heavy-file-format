import { describe, expect, test } from 'vitest';
import { exportTargetHvy } from '../src/embed-target';
import { deserializeDocument } from '../src/serialization';

describe('embedded target HVY export', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-profile"}-->
#! Fake profile

 <!--hvy:container {"id":"fake-container","containerTitle":"Fake container"}-->

  <!--hvy:text {"id":"fake-child"}-->
   Fake child text.

<!--hvy: {"id":"fake-other"}-->
#! Fake other

 Other text.
`, '.hvy');

  test('expected result: a section export includes only that section and its owned components', () => {
    const expectedResult = exportTargetHvy(document, { sectionKey: document.sections[0]!.key });

    expect(expectedResult).toContain('#! Fake profile');
    expect(expectedResult).toContain('"id":"fake-container"');
    expect(expectedResult).toContain('Fake child text.');
    expect(expectedResult).not.toContain('#! Fake other');
    expect(expectedResult).not.toContain('hvy_version:');
  });

  test('expected result: a nested component export includes its complete HVY fragment', () => {
    const child = document.sections[0]!.blocks[0]!.schema.containerBlocks[0]!;
    const expectedResult = exportTargetHvy(document, {
      sectionKey: document.sections[0]!.key,
      blockId: child.id,
    });

    expect(expectedResult).toContain('<!--hvy:text {"id":"fake-child"}-->');
    expect(expectedResult).toContain('Fake child text.');
    expect(expectedResult).not.toContain('fake-container');
    expect(expectedResult).not.toContain('#! Fake profile');
  });

  test('expected result: missing targets fail with target-specific errors', () => {
    expect(() => exportTargetHvy(document, { sectionKey: 'missing-section' })).toThrow('HVY section target was not found');
    expect(() => exportTargetHvy(document, {
      sectionKey: document.sections[0]!.key,
      blockId: 'missing-block',
    })).toThrow('HVY component target was not found');
  });
});
