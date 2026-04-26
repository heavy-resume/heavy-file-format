import { describe, expect, test } from 'vitest';
import { mergeImagePresetCss } from '../src/editor/components/image/image';

describe('mergeImagePresetCss', () => {
  test('position preset preserves size declarations', () => {
    const before = 'width: 20rem; height: auto; display: block; border: 1px solid red;';
    const after = mergeImagePresetCss(before, 'center');
    expect(after).not.toBeNull();
    expect(after).toContain('width: 20rem');
    expect(after).toContain('height: auto');
    expect(after).toContain('border: 1px solid red');
    expect(after).toContain('margin: 0.5rem auto');
    expect(after).toContain('display: block');
  });

  test('size preset preserves margin/positioning declarations', () => {
    const before = 'margin: 0.5rem auto; display: block; border-radius: 8px;';
    const after = mergeImagePresetCss(before, 'small');
    expect(after).not.toBeNull();
    expect(after).toContain('margin: 0.5rem auto');
    expect(after).toContain('border-radius: 8px');
    expect(after).toContain('width: 20rem');
    expect(after).toContain('height: auto');
  });

  test('position preset clears margin longhands so the shorthand wins cleanly', () => {
    const before = 'margin-top: 2rem; margin-bottom: 2rem; padding: 1rem;';
    const after = mergeImagePresetCss(before, 'right');
    expect(after).not.toContain('margin-top');
    expect(after).not.toContain('margin-bottom');
    expect(after).toContain('padding: 1rem');
    expect(after).toContain('margin: 0.5rem 0 0.5rem auto');
  });

  test('preserves unrelated properties such as box-shadow and filter', () => {
    const before = 'box-shadow: 0 0 4px black; filter: grayscale(0.2); margin: 0.5rem 0;';
    const after = mergeImagePresetCss(before, 'fit-width');
    expect(after).toContain('box-shadow: 0 0 4px black');
    expect(after).toContain('filter: grayscale(0.2)');
    expect(after).toContain('margin: 0.5rem 0');
    expect(after).toContain('width: 100%');
  });

  test('replaces only width/height when switching between size presets', () => {
    const fromSmall = mergeImagePresetCss('margin: 0.5rem auto; display: block; width: 20rem; height: auto;', 'medium');
    expect(fromSmall).toContain('margin: 0.5rem auto');
    expect(fromSmall).toContain('width: 40rem');
    expect((fromSmall ?? '').match(/width:/g)?.length ?? 0).toBe(1);
  });

  test('returns null for an unknown preset', () => {
    expect(mergeImagePresetCss('margin: 0;', 'bogus')).toBeNull();
  });
});
