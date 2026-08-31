import type { JsonObject } from './hvy/types';

export interface ImageIntrinsicDimensions {
  width: number;
  height: number;
}

export function getImageIntrinsicDimensions(meta: JsonObject): ImageIntrinsicDimensions | null {
  const width = normalizeDimension(meta.pixelWidth);
  const height = normalizeDimension(meta.pixelHeight);
  return width !== null && height !== null ? { width, height } : null;
}

export function addImageIntrinsicDimensions(
  id: string,
  meta: JsonObject,
  bytes: Uint8Array | undefined,
  replaceExisting = false
): JsonObject {
  if (!id.startsWith('image:') || (!replaceExisting && getImageIntrinsicDimensions(meta)) || !bytes?.length) {
    return meta;
  }
  const dimensions = inferImageIntrinsicDimensions(bytes, meta.mediaType);
  return dimensions
    ? { ...meta, pixelWidth: dimensions.width, pixelHeight: dimensions.height }
    : meta;
}

export function inferImageIntrinsicDimensions(
  bytes: Uint8Array,
  mediaType: unknown
): ImageIntrinsicDimensions | null {
  if (mediaType === 'image/svg+xml' || looksLikeSvg(bytes)) {
    return readSvgDimensions(bytes);
  }
  if (isPng(bytes)) {
    return dimensions(readUint32BigEndian(bytes, 16), readUint32BigEndian(bytes, 20));
  }
  if (isJpeg(bytes)) {
    return readJpegDimensions(bytes);
  }
  if (isWebp(bytes)) {
    return readWebpDimensions(bytes);
  }
  if (isBmp(bytes)) {
    return dimensions(readUint32LittleEndian(bytes, 18), Math.abs(readInt32LittleEndian(bytes, 22)));
  }
  if (isIcon(bytes)) {
    return dimensions(bytes[6] || 256, bytes[7] || 256);
  }
  return null;
}

function readSvgDimensions(bytes: Uint8Array): ImageIntrinsicDimensions | null {
  const source = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 16_384)));
  const svg = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!svg) return null;
  const width = readSvgLength(svg, 'width');
  const height = readSvgLength(svg, 'height');
  if (width !== null && height !== null) return dimensions(width, height);
  const viewBox = svg.match(/\bviewBox\s*=\s*["']\s*[-+\d.e]+[\s,]+[-+\d.e]+[\s,]+([-+\d.e]+)[\s,]+([-+\d.e]+)\s*["']/i);
  return viewBox ? dimensions(Number(viewBox[1]), Number(viewBox[2])) : null;
}

function readSvgLength(svg: string, name: string): number | null {
  const match = svg.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([-+\\d.e]+)(?:px)?\\s*["']`, 'i'));
  return match ? normalizeDimension(Number(match[1])) : null;
}

function readJpegDimensions(bytes: Uint8Array): ImageIntrinsicDimensions | null {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = readUint16BigEndian(bytes, offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) return null;
    if (isJpegStartOfFrame(marker)) {
      return dimensions(readUint16BigEndian(bytes, offset + 7), readUint16BigEndian(bytes, offset + 5));
    }
    offset += length + 2;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): ImageIntrinsicDimensions | null {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return dimensions(readUint24LittleEndian(bytes, 24) + 1, readUint24LittleEndian(bytes, 27) + 1);
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const packed = readUint32LittleEndian(bytes, 21);
    return dimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return dimensions(readUint16LittleEndian(bytes, 26) & 0x3fff, readUint16LittleEndian(bytes, 28) & 0x3fff);
  }
  return null;
}

function dimensions(width: number, height: number): ImageIntrinsicDimensions | null {
  const normalizedWidth = normalizeDimension(width);
  const normalizedHeight = normalizeDimension(height);
  return normalizedWidth !== null && normalizedHeight !== null
    ? { width: normalizedWidth, height: normalizedHeight }
    : null;
}

function normalizeDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG';
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

function isBmp(bytes: Uint8Array): boolean {
  return bytes.length >= 26 && ascii(bytes, 0, 2) === 'BM';
}

function isIcon(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512))).includes('<svg');
}

function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function readInt32LittleEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}
