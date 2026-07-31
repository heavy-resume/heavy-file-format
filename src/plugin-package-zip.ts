import { unzipSync } from 'fflate';
import {
  HVY_PLUGIN_PACKAGE_MANIFEST,
  loadHvyPluginModule,
  normalizePluginPackagePath,
  parseHvyPluginPackageManifest,
  type HvyPluginModuleNamespace,
  type HvyPluginPackageManifest,
} from './plugin-package';
import type { HvyPlugin } from './plugins/types';

export interface HvyPluginZipLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxCompressionRatio: number;
}

export interface LoadHvyPluginZipOptions {
  limits?: Partial<HvyPluginZipLimits>;
  importModule?(url: string): Promise<HvyPluginModuleNamespace>;
  createObjectUrl?(blob: Blob): string;
  revokeObjectUrl?(url: string): void;
}

export interface LoadedHvyPluginPackage {
  manifest: HvyPluginPackageManifest;
  plugin: HvyPlugin;
  styles: string[];
  resourceUrl(path: string): string;
  dispose(): void;
}

const DEFAULT_LIMITS: HvyPluginZipLimits = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxEntries: 256,
  maxExpandedBytes: 40 * 1024 * 1024,
  maxEntryBytes: 16 * 1024 * 1024,
  maxCompressionRatio: 200,
};

const UTF8_FLAG = 0x0800;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

interface ZipEntryMetadata {
  path: string;
  compressedSize: number;
  expandedSize: number;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)) >>> 0;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32(bytes, offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new Error('Plugin package is not a supported ZIP archive.');
}

function inspectZip(bytes: Uint8Array, limits: HvyPluginZipLimits): ZipEntryMetadata[] {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new Error(`Plugin package exceeds the ${limits.maxArchiveBytes}-byte archive limit.`);
  }
  const endOffset = findEndOfCentralDirectory(bytes);
  const entryCount = readUint16(bytes, endOffset + 10);
  const centralSize = readUint32(bytes, endOffset + 12);
  const centralOffset = readUint32(bytes, endOffset + 16);
  if (entryCount > limits.maxEntries) throw new Error(`Plugin package exceeds the ${limits.maxEntries}-entry limit.`);
  if (centralOffset + centralSize > endOffset) throw new Error('Plugin package has an invalid central directory.');

  const decoder = new TextDecoder();
  const entries: ZipEntryMetadata[] = [];
  const normalizedPaths = new Set<string>();
  let expandedTotal = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(bytes, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Plugin package has an invalid central directory entry.');
    }
    const flags = readUint16(bytes, offset + 8);
    if ((flags & 0x0001) !== 0) throw new Error('Encrypted ZIP entries are not supported.');
    const compressedSize = readUint32(bytes, offset + 20);
    const expandedSize = readUint32(bytes, offset + 24);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const externalAttributes = readUint32(bytes, offset + 38);
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const path = normalizePluginPackagePath(decoder.decode(rawName));
    if ((flags & UTF8_FLAG) === 0 && rawName.some((value) => value > 0x7f)) {
      throw new Error(`Plugin package path "${path}" must be UTF-8 or ASCII.`);
    }
    if (normalizedPaths.has(path)) throw new Error(`Plugin package contains duplicate path "${path}".`);
    normalizedPaths.add(path);
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) throw new Error(`Plugin package path "${path}" must not be a link.`);
    if (path.endsWith('/')) throw new Error(`Plugin package path "${path}" must identify a regular file.`);
    if (expandedSize > limits.maxEntryBytes) throw new Error(`Plugin package entry "${path}" exceeds its size limit.`);
    if (compressedSize === 0 ? expandedSize > 0 : expandedSize / compressedSize > limits.maxCompressionRatio) {
      throw new Error(`Plugin package entry "${path}" exceeds its compression-ratio limit.`);
    }
    expandedTotal += expandedSize;
    if (expandedTotal > limits.maxExpandedBytes) {
      throw new Error(`Plugin package exceeds the ${limits.maxExpandedBytes}-byte expanded limit.`);
    }
    entries.push({ path, compressedSize, expandedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error('Plugin package central directory size does not match.');
  return entries;
}

function defaultImportModule(url: string): Promise<HvyPluginModuleNamespace> {
  return import(/* @vite-ignore */ url) as Promise<HvyPluginModuleNamespace>;
}

function rewriteCssResourceUrls(css: string, cssPath: string, resourceUrl: (path: string) => string): string {
  const baseSegments = cssPath.split('/');
  baseSegments.pop();
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote: string, value: string) => {
    const reference = value.trim();
    if (/^(?:data:|blob:|https?:|#|\/)/i.test(reference)) return match;
    const segments = [...baseSegments];
    for (const segment of reference.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (segments.length === 0) throw new Error(`CSS resource "${reference}" escapes the plugin package.`);
        segments.pop();
      } else {
        segments.push(segment);
      }
    }
    return `url("${resourceUrl(segments.join('/'))}")`;
  });
}

export async function loadHvyPluginZip(
  archiveBytes: Uint8Array,
  options: LoadHvyPluginZipOptions = {}
): Promise<LoadedHvyPluginPackage> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const metadata = inspectZip(archiveBytes, limits);
  const files = unzipSync(archiveBytes);
  if (Object.keys(files).length !== metadata.length) throw new Error('Plugin package ZIP entries did not decode consistently.');
  const manifestBytes = files[HVY_PLUGIN_PACKAGE_MANIFEST];
  if (!manifestBytes) throw new Error(`Plugin package must contain ${HVY_PLUGIN_PACKAGE_MANIFEST} at its root.`);
  const manifest = parseHvyPluginPackageManifest(manifestBytes);
  for (const path of [manifest.entry, ...manifest.styles, ...(manifest.documentation ? [manifest.documentation] : [])]) {
    if (!files[path]) throw new Error(`Plugin package is missing manifest file "${path}".`);
  }

  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const urls = new Map<string, string>();
  const resourceUrl = (pathValue: string): string => {
    const path = normalizePluginPackagePath(pathValue);
    const bytes = files[path];
    if (!bytes) throw new Error(`Plugin package resource "${path}" does not exist.`);
    let url = urls.get(path);
    if (!url) {
      url = createObjectUrl(new Blob([bytes as BlobPart]));
      urls.set(path, url);
    }
    return url;
  };

  try {
    const entryUrl = createObjectUrl(new Blob([files[manifest.entry] as BlobPart], { type: 'text/javascript' }));
    urls.set(manifest.entry, entryUrl);
    const plugin = await loadHvyPluginModule({
      manifest,
      importEntry: () => (options.importModule ?? defaultImportModule)(entryUrl),
      resourceUrl,
    });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const styles = manifest.styles.map((path) => (
      rewriteCssResourceUrls(decoder.decode(files[path]), path, resourceUrl)
    ));
    return {
      manifest,
      plugin,
      styles,
      resourceUrl,
      dispose: () => {
        for (const url of urls.values()) revokeObjectUrl(url);
        urls.clear();
      },
    };
  } catch (error) {
    for (const url of urls.values()) revokeObjectUrl(url);
    throw error;
  }
}
