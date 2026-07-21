const DELTA_MAGIC = new TextEncoder().encode('HVYD2');
const COPY_OPERATION = 0;
const LITERAL_OPERATION = 1;
const DEFAULT_BLOCK_SIZE = 32;
const MAX_MATCH_CANDIDATES = 64;

export interface HvyDocumentDeltaOptions {
  blockSize?: number;
  maxSizeRatio?: number;
}

/** Returns null only when maxSizeRatio is set and the delta exceeds that bound. */
export function createHvyDocumentDelta(
  base: Uint8Array,
  document: Uint8Array,
  options: HvyDocumentDeltaOptions = {},
): Uint8Array | null {
  const blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE;
  const maxSizeRatio = options.maxSizeRatio;
  if (!Number.isSafeInteger(blockSize) || blockSize < 4) {
    throw new Error('HVY delta blockSize must be an integer of at least 4 bytes.');
  }
  if (maxSizeRatio !== undefined && (!Number.isFinite(maxSizeRatio) || maxSizeRatio <= 0)) {
    throw new Error('HVY delta maxSizeRatio must be greater than zero.');
  }

  const sizeLimit = maxSizeRatio === undefined ? Number.POSITIVE_INFINITY : Math.floor(document.length * maxSizeRatio);
  const output: number[] = [...DELTA_MAGIC];
  writeVarint(output, document.length);
  const baseBlocks = indexBaseBlocks(base, blockSize);
  let literalStart = 0;
  let cursor = 0;
  let previousCopyEnd = 0;
  while (cursor + blockSize <= document.length) {
    const candidates = baseBlocks.get(hashBytes(document, cursor, blockSize));
    const match = candidates ? findLongestMatch(base, document, cursor, blockSize, candidates) : null;
    if (!match) {
      cursor += 1;
      continue;
    }
    appendLiteral(output, document, literalStart, cursor);
    writeInstruction(output, COPY_OPERATION, match.length);
    writeSignedVarint(output, match.offset - previousCopyEnd);
    previousCopyEnd = match.offset + match.length;
    cursor += match.length;
    literalStart = cursor;
    if (output.length > sizeLimit) return null;
  }
  appendLiteral(output, document, literalStart, document.length);
  return output.length <= sizeLimit ? Uint8Array.from(output) : null;
}

export function applyHvyDocumentDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  if (!isHvyDocumentDelta(delta)) throw new Error('Invalid HVYD2 document delta header.');
  const cursor = { offset: DELTA_MAGIC.length };
  const document = new Uint8Array(readVarint(delta, cursor));
  let documentOffset = 0;
  let previousCopyEnd = 0;
  while (cursor.offset < delta.length) {
    const instruction = readVarint(delta, cursor);
    const operation = instruction % 2;
    const length = Math.floor(instruction / 2);
    if (length === 0) throw new Error('Invalid zero-length HVYD2 operation.');
    if (operation === COPY_OPERATION) {
      const baseOffset = previousCopyEnd + readSignedVarint(delta, cursor);
      assertRange(baseOffset, length, base.length, 'copy');
      assertRange(documentOffset, length, document.length, 'output');
      document.set(base.subarray(baseOffset, baseOffset + length), documentOffset);
      documentOffset += length;
      previousCopyEnd = baseOffset + length;
    } else if (operation === LITERAL_OPERATION) {
      assertRange(cursor.offset, length, delta.length, 'literal');
      assertRange(documentOffset, length, document.length, 'output');
      document.set(delta.subarray(cursor.offset, cursor.offset + length), documentOffset);
      cursor.offset += length;
      documentOffset += length;
    } else {
      throw new Error(`Invalid HVYD2 operation ${operation}.`);
    }
  }
  if (documentOffset !== document.length) {
    throw new Error(`Invalid HVYD2 output length: expected ${document.length}, received ${documentOffset}.`);
  }
  return document;
}

export function isHvyDocumentDelta(bytes: Uint8Array): boolean {
  return bytes.length >= DELTA_MAGIC.length && DELTA_MAGIC.every((byte, index) => bytes[index] === byte);
}

function indexBaseBlocks(base: Uint8Array, blockSize: number): Map<number, number[]> {
  const blocks = new Map<number, number[]>();
  for (let offset = 0; offset + blockSize <= base.length; offset += blockSize) {
    const hash = hashBytes(base, offset, blockSize);
    const offsets = blocks.get(hash);
    if (offsets) offsets.push(offset);
    else blocks.set(hash, [offset]);
  }
  return blocks;
}

function findLongestMatch(base: Uint8Array, document: Uint8Array, documentOffset: number, blockSize: number, candidates: number[]): { offset: number; length: number } | null {
  let bestOffset = 0;
  let bestLength = 0;
  for (let candidateIndex = 0; candidateIndex < candidates.length && candidateIndex < MAX_MATCH_CANDIDATES; candidateIndex += 1) {
    const baseOffset = candidates[candidateIndex]!;
    if (!bytesEqual(base, baseOffset, document, documentOffset, blockSize)) continue;
    let length = blockSize;
    while (baseOffset + length < base.length && documentOffset + length < document.length && base[baseOffset + length] === document[documentOffset + length]) length += 1;
    if (length > bestLength) {
      bestOffset = baseOffset;
      bestLength = length;
    }
  }
  return bestLength >= blockSize ? { offset: bestOffset, length: bestLength } : null;
}

function appendLiteral(output: number[], document: Uint8Array, start: number, end: number): void {
  if (end <= start) return;
  writeInstruction(output, LITERAL_OPERATION, end - start);
  for (let index = start; index < end; index += 1) output.push(document[index]!);
}

function writeInstruction(output: number[], operation: number, length: number): void {
  writeVarint(output, length * 2 + operation);
}

function writeSignedVarint(output: number[], value: number): void {
  writeVarint(output, value < 0 ? (-value * 2) - 1 : value * 2);
}

function readSignedVarint(bytes: Uint8Array, cursor: { offset: number }): number {
  const encoded = readVarint(bytes, cursor);
  return encoded % 2 === 0 ? encoded / 2 : -Math.floor(encoded / 2) - 1;
}

function hashBytes(bytes: Uint8Array, offset: number, length: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < length; index += 1) hash = Math.imul(hash ^ bytes[offset + index]!, 0x01000193);
  return hash >>> 0;
}

function bytesEqual(left: Uint8Array, leftOffset: number, right: Uint8Array, rightOffset: number, length: number): boolean {
  for (let index = 0; index < length; index += 1) if (left[leftOffset + index] !== right[rightOffset + index]) return false;
  return true;
}

function writeVarint(output: number[], value: number): void {
  let remaining = value;
  while (remaining >= 0x80) {
    output.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  output.push(remaining);
}

function readVarint(bytes: Uint8Array, cursor: { offset: number }): number {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 8; count += 1) {
    if (cursor.offset >= bytes.length) throw new Error('Truncated HVYD2 varint.');
    const byte = bytes[cursor.offset++]!;
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error('HVYD2 varint exceeds the safe integer range.');
    if ((byte & 0x80) === 0) return value;
    multiplier *= 0x80;
  }
  throw new Error('Invalid HVYD2 varint.');
}

function assertRange(offset: number, length: number, limit: number, label: string): void {
  if (offset < 0 || length < 0 || offset > limit || length > limit - offset) throw new Error(`Invalid HVYD2 ${label} range.`);
}
