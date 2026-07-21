import { describe, expect, test } from 'vitest';
import { applyHvyDocumentDelta, createHvyDocumentDelta, isHvyDocumentDelta } from '../src/document-delta';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('HVY document delta', () => {
  test('expected result: unchanged regions around several edits are copied', () => {
    const base = encode(`${'A'.repeat(256)}${'B'.repeat(256)}${'C'.repeat(256)}${'D'.repeat(256)}`);
    const document = encode(`${'A'.repeat(256)}changed-one${'B'.repeat(256)}changed-two${'C'.repeat(256)}${'D'.repeat(256)}`);
    const expectedResult = createHvyDocumentDelta(base, document);
    expect(expectedResult).not.toBeNull();
    expect(isHvyDocumentDelta(expectedResult!)).toBe(true);
    expect(expectedResult!.length).toBeLessThan(document.length / 4);
    expect(applyHvyDocumentDelta(base, expectedResult!)).toEqual(document);
  });

  test('expected result: reordered blocks are copied from their original locations', () => {
    const blocks = Array.from({ length: 40 }, (_, index) => `${String(index).padStart(3, '0')}:${String.fromCharCode(65 + (index % 26)).repeat(61)}`);
    const base = encode(blocks.join(''));
    const document = encode([...blocks.slice(20), ...blocks.slice(0, 20)].join(''));
    const expectedResult = createHvyDocumentDelta(base, document);
    expect(expectedResult).not.toBeNull();
    expect(expectedResult!.length).toBeLessThan(document.length / 10);
    expect(applyHvyDocumentDelta(base, expectedResult!)).toEqual(document);
  });

  test('expected result: size fallback is an optional storage policy', () => {
    const expectedResult = createHvyDocumentDelta(encode('old document content'), encode('x'));
    expect(expectedResult).not.toBeNull();
    expect(createHvyDocumentDelta(encode('old document content'), encode('x'), { maxSizeRatio: 2 })).toBeNull();
  });

  test('expected result: a literal-only delta contains only the target bytes and compact framing', () => {
    const base = new Uint8Array(4096).fill(1);
    const document = new Uint8Array(4096).fill(2);
    const expectedResult = createHvyDocumentDelta(base, document);
    expect(expectedResult).not.toBeNull();
    expect(expectedResult!.length - document.length).toBeLessThan(16);
    expect(applyHvyDocumentDelta(base, expectedResult!)).toEqual(document);
  });

  test('expected result: repetitive megabyte-scale content remains compact', () => {
    const base = new Uint8Array(1024 * 1024).fill(65);
    const document = base.slice();
    document.fill(66, 400_000, 400_100);
    const expectedResult = createHvyDocumentDelta(base, document);
    expect(expectedResult).not.toBeNull();
    expect(expectedResult!.length).toBeLessThan(256);
    expect(applyHvyDocumentDelta(base, expectedResult!)).toEqual(document);
  });

  test('expected result: malformed copy ranges are rejected', () => {
    expect(() => applyHvyDocumentDelta(encode('a'), Uint8Array.from([...encode('HVYD2'), 1, 2, 4])))
      .toThrow('Invalid HVYD2 copy range.');
  });
});
