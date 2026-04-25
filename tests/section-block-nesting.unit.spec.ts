import { describe, expect, test } from 'vitest';

import { makeBlockSubsection, removeSubsection, findSectionByKey, buildSectionRenderSequence, moveBlockInVisualSequence } from '../src/section-ops';
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

/** Walks the section's flat visual sequence: blocks render before any subsections. */
function visualSequence(section: VisualSection): string[] {
  const out: string[] = [];
  section.blocks.forEach((b) => out.push(`block:${b.id}`));
  section.children.forEach((child) => {
    out.push(`sub-open:${child.key}`);
    out.push(...visualSequence(child));
    out.push(`sub-close:${child.key}`);
  });
  return out;
}

describe('makeBlockSubsection — wrap a section-level block in place', () => {
  test('only block in section becomes a one-block subsection', () => {
    const onlyBlock = makeBlock('text');
    const section = makeSection([onlyBlock]);

    const newSub = makeBlockSubsection([section], section.key, onlyBlock.id);

    expect(newSub).not.toBeNull();
    expect(section.blocks).toHaveLength(0);
    expect(section.children).toEqual([newSub]);
    expect(newSub!.blocks.map((b) => b.id)).toEqual([onlyBlock.id]);
    expect(newSub!.autoTail).toBeFalsy();
  });

  test('wrapping a middle block keeps blocks above and below in their visual positions', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const blockC = makeBlock('text');
    const blockD = makeBlock('text');
    const section = makeSection([blockA, blockB, blockC, blockD]);
    const before = visualSequence(section);

    const newSub = makeBlockSubsection([section], section.key, blockB.id);

    expect(newSub).not.toBeNull();
    expect(section.blocks.map((b) => b.id)).toEqual([blockA.id]);
    expect(section.children).toHaveLength(2);
    expect(section.children[0]).toBe(newSub);
    expect(newSub!.blocks.map((b) => b.id)).toEqual([blockB.id]);

    const tail = section.children[1];
    expect(tail.autoTail).toBe(true);
    expect(tail.blocks.map((b) => b.id)).toEqual([blockC.id, blockD.id]);

    // Visual order: A, sub-open(newSub), B, sub-close, sub-open(tail), C, D, sub-close.
    // The flat block ordering A→B→C→D is preserved, just with subsection boundaries inserted.
    const after = visualSequence(section);
    const blockOrder = after.filter((tok) => tok.startsWith('block:'));
    expect(blockOrder).toEqual(before.filter((tok) => tok.startsWith('block:')));
  });

  test('wrapping the last block does not create a tail subsection', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const section = makeSection([blockA, blockB]);

    const newSub = makeBlockSubsection([section], section.key, blockB.id);

    expect(newSub).not.toBeNull();
    expect(section.blocks.map((b) => b.id)).toEqual([blockA.id]);
    expect(section.children).toEqual([newSub]);
  });

  test('wrap then unwrap restores the original blocks list', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const blockC = makeBlock('text');
    const blockD = makeBlock('text');
    const section = makeSection([blockA, blockB, blockC, blockD]);
    const expectedBlockIds = section.blocks.map((b) => b.id);

    const newSub = makeBlockSubsection([section], section.key, blockB.id);
    const ok = removeSubsection([section], newSub!.key);

    expect(ok).toBe(true);
    expect(section.blocks.map((b) => b.id)).toEqual(expectedBlockIds);
    expect(section.children).toHaveLength(0);
  });

  test('returns null when the block is not in the named section', () => {
    const block = makeBlock('text');
    const section = makeSection([block]);

    const result = makeBlockSubsection([section], section.key, 'no-such-block');

    expect(result).toBeNull();
    expect(section.blocks).toHaveLength(1);
  });
});

describe('removeSubsection — unwrap a subsection back into its parent', () => {
  test('merges the subsection blocks into the parent and removes the subsection', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const sub = makeSection([blockA, blockB], [], 2);
    const parent = makeSection([], [sub]);
    const sections = [parent];

    const ok = removeSubsection(sections, sub.key);

    expect(ok).toBe(true);
    expect(parent.blocks.map((b) => b.id)).toEqual([blockA.id, blockB.id]);
    expect(parent.children).toHaveLength(0);
    expect(findSectionByKey(sections, sub.key)).toBeNull();
  });

  test('promotes the subsection child sections into the parent at its position', () => {
    const subBlock = makeBlock('text');
    const grandchildBlock = makeBlock('text');
    const grandchild = makeSection([grandchildBlock], [], 3);
    const sub = makeSection([subBlock], [grandchild], 2);
    const siblingBefore = makeSection([], [], 2);
    const siblingAfter = makeSection([], [], 2);
    const parent = makeSection([], [siblingBefore, sub, siblingAfter]);

    const ok = removeSubsection([parent], sub.key);

    expect(ok).toBe(true);
    expect(parent.blocks.map((b) => b.id)).toEqual([subBlock.id]);
    expect(parent.children).toEqual([siblingBefore, grandchild, siblingAfter]);
    expect(grandchild.level).toBe(parent.level + 1);
  });

  test('returns false when the section is not a subsection', () => {
    const top = makeSection([makeBlock('text')]);

    const ok = removeSubsection([top], top.key);

    expect(ok).toBe(false);
  });
});

describe('buildSectionRenderSequence — interleaves blocks and anchored subsections', () => {
  test('renders unanchored children at the end (legacy)', () => {
    const blockA = makeBlock('text');
    const child = makeSection([], [], 2);
    const section = makeSection([blockA], [child]);

    const seq = buildSectionRenderSequence(section);

    expect(seq.map((s) => s.kind)).toEqual(['block', 'child']);
  });

  test('places an anchored subsection right after its anchor block', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const inline = makeSection([], [], 2);
    inline.renderAfterBlockId = blockA.id;
    const section = makeSection([blockA, blockB], [inline]);

    const seq = buildSectionRenderSequence(section);

    expect(seq.map((s) => (s.kind === 'block' ? s.block.id : `child:${s.child.key}`))).toEqual([
      blockA.id,
      `child:${inline.key}`,
      blockB.id,
    ]);
  });

  test('places `before-blocks` (empty-string anchor) subsections at the top', () => {
    const blockA = makeBlock('text');
    const before = makeSection([], [], 2);
    before.renderAfterBlockId = '';
    const section = makeSection([blockA], [before]);

    const seq = buildSectionRenderSequence(section);

    expect(seq.map((s) => s.kind)).toEqual(['child', 'block']);
  });
});

describe('moveBlockInVisualSequence — arrows swap blocks past adjacent subsections', () => {
  test('down arrow on a block swaps it past a following anchored subsection', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const sub = makeSection([], [], 2);
    sub.renderAfterBlockId = blockA.id;
    const section = makeSection([blockA, blockB], [sub]);

    const ok = moveBlockInVisualSequence([section], section.key, blockA.id, 1);

    expect(ok).toBe(true);
    // After the swap, the subsection should render before blockA.
    const seq = buildSectionRenderSequence(section);
    expect(seq.map((s) => (s.kind === 'block' ? s.block.id : `child:${s.child.key}`))).toEqual([
      `child:${sub.key}`,
      blockA.id,
      blockB.id,
    ]);
    expect(sub.renderAfterBlockId).toBe('');
  });

  test('up arrow on a block swaps it past a preceding anchored subsection', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const sub = makeSection([], [], 2);
    sub.renderAfterBlockId = blockA.id;
    const section = makeSection([blockA, blockB], [sub]);

    const ok = moveBlockInVisualSequence([section], section.key, blockB.id, -1);

    expect(ok).toBe(true);
    const seq = buildSectionRenderSequence(section);
    expect(seq.map((s) => (s.kind === 'block' ? s.block.id : `child:${s.child.key}`))).toEqual([
      blockA.id,
      blockB.id,
      `child:${sub.key}`,
    ]);
    expect(sub.renderAfterBlockId).toBe(blockB.id);
  });

  test('down arrow on the last block at end of sequence is a no-op', () => {
    const blockA = makeBlock('text');
    const section = makeSection([blockA]);

    const ok = moveBlockInVisualSequence([section], section.key, blockA.id, 1);

    expect(ok).toBe(false);
  });
});

describe('makeBlockSubsection — anchors new subsections inline', () => {
  test('wrapping a middle block anchors the new and tail subsections after the previous block', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const blockC = makeBlock('text');
    const section = makeSection([blockA, blockB, blockC]);

    const newSub = makeBlockSubsection([section], section.key, blockB.id);

    expect(newSub).not.toBeNull();
    expect(newSub!.renderAfterBlockId).toBe(blockA.id);
    const tail = section.children[1];
    expect(tail.autoTail).toBe(true);
    expect(tail.renderAfterBlockId).toBe(blockA.id);

    const seq = buildSectionRenderSequence(section);
    expect(seq.map((s) => (s.kind === 'block' ? s.block.id : s.child.key))).toEqual([
      blockA.id,
      newSub!.key,
      tail.key,
    ]);
  });

  test('wrapping the first block anchors the new subsection before all blocks', () => {
    const blockA = makeBlock('text');
    const blockB = makeBlock('text');
    const section = makeSection([blockA, blockB]);

    const newSub = makeBlockSubsection([section], section.key, blockA.id);

    expect(newSub!.renderAfterBlockId).toBe('');
  });
});
