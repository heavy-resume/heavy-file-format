import { describe, expect, test } from 'vitest';

import { makeBlockSubsection, moveBlockToParentSection, findSectionByKey } from '../src/section-ops';
import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import type { VisualBlock, VisualSection } from '../src/editor/types';

function makeBlock(component = 'text'): VisualBlock {
  return createEmptyBlock(component);
}

function makeSection(blocks: VisualBlock[] = [], children: VisualSection[] = [], level = 1): VisualSection {
  const section = createEmptySection(level, '', false);
  section.blocks = blocks;
  section.children = children;
  return section;
}

describe('makeBlockSubsection — wrap a section-level block', () => {
  test('moves the block into a new subsection appended to children', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const section = makeSection([blockA, blockB]);
    const sections = [section];

    const newSub = makeBlockSubsection(sections, section.key, blockB.id);

    expect(newSub).not.toBeNull();
    expect(section.blocks.map((b) => b.id)).toEqual([blockA.id]);
    expect(section.children).toHaveLength(1);
    expect(section.children[0]).toBe(newSub);
    expect(newSub!.blocks.map((b) => b.id)).toEqual([blockB.id]);
    expect(newSub!.level).toBe(section.level + 1);
  });

  test('returns null when the block is not in the named section', () => {
    const block = makeBlock('text');
    const section = makeSection([block]);
    const result = makeBlockSubsection([section], section.key, 'no-such-block');
    expect(result).toBeNull();
    expect(section.blocks).toHaveLength(1);
  });
});

describe('moveBlockToParentSection — unwrap a block out of a subsection', () => {
  test('removes the subsection if it becomes empty', () => {
    const onlyBlock = makeBlock('text');
    const sub = makeSection([onlyBlock], [], 2);
    const parent = makeSection([], [sub]);
    const sections = [parent];

    const ok = moveBlockToParentSection(sections, sub.key, onlyBlock.id);

    expect(ok).toBe(true);
    expect(parent.children).toHaveLength(0);
    expect(parent.blocks.map((b) => b.id)).toEqual([onlyBlock.id]);
    expect(findSectionByKey(sections, sub.key)).toBeNull();
  });

  test('moving the last block leaves preceding blocks in the original subsection', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const sub = makeSection([blockA, blockB], [], 2);
    const parent = makeSection([], [sub]);

    const ok = moveBlockToParentSection([parent], sub.key, blockB.id);

    expect(ok).toBe(true);
    expect(sub.blocks.map((b) => b.id)).toEqual([blockA.id]);
    expect(parent.children).toEqual([sub]);
    expect(parent.blocks.map((b) => b.id)).toEqual([blockB.id]);
  });

  test('moving the first block drops the empty original and keeps trailing blocks in a new subsection', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const sub = makeSection([blockA, blockB], [], 2);
    const parent = makeSection([], [sub]);

    const ok = moveBlockToParentSection([parent], sub.key, blockA.id);

    expect(ok).toBe(true);
    expect(parent.blocks.map((b) => b.id)).toEqual([blockA.id]);
    expect(parent.children).toHaveLength(1);
    const newSub = parent.children[0];
    expect(newSub).not.toBe(sub);
    expect(newSub.blocks.map((b) => b.id)).toEqual([blockB.id]);
  });

  test('splits the subsection when moving a middle block', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const blockC = makeBlock('text');
    const blockD = makeBlock('text');
    const sub = makeSection([blockA, blockB, blockC, blockD], [], 2);
    const parent = makeSection([], [sub]);

    const ok = moveBlockToParentSection([parent], sub.key, blockB.id);

    expect(ok).toBe(true);
    // Parent now has the moved block in its blocks list.
    expect(parent.blocks.map((b) => b.id)).toEqual([blockB.id]);
    // Original subsection retains the preceding block.
    expect(sub.blocks.map((b) => b.id)).toEqual([blockA.id]);
    // A new subsection holds the trailing blocks, inserted right after the original.
    expect(parent.children).toHaveLength(2);
    expect(parent.children[0]).toBe(sub);
    const newSub = parent.children[1];
    expect(newSub.blocks.map((b) => b.id)).toEqual([blockC.id, blockD.id]);
    expect(newSub.level).toBe(sub.level);
  });

  test('returns false when the section is not a subsection', () => {
    const block = makeBlock('text');
    const top = makeSection([block]);
    const ok = moveBlockToParentSection([top], top.key, block.id);
    expect(ok).toBe(false);
    expect(top.blocks).toHaveLength(1);
  });
});
