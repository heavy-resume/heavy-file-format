#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const HVY_TAIL_SENTINEL = '--HVY-TAIL--';

async function main() {
  const { input, outDir } = parseArgs(process.argv.slice(2));
  const bytes = await readFile(input);
  const extraction = extractHvyAssets(new Uint8Array(bytes));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'document.hvy'), extraction.documentBytes);
  for (const attachment of extraction.attachments) {
    const path = join(outDir, attachment.url);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, attachment.bytes);
  }
  await writeFile(
    join(outDir, 'attachments.json'),
    `${JSON.stringify({
      source: basename(input),
      attachments: extraction.attachments.map(({ id, meta, length, url }) => ({ id, meta, length, url })),
    }, null, 2)}\n`
  );
  await writeFile(join(outDir, 'preview.json'), `${JSON.stringify(extractHostedPreviewMetadata(extraction.documentBytes), null, 2)}\n`);
  console.log(`Extracted ${extraction.attachments.length} attachment(s) to ${outDir}`);
}

export function extractHvyAssets(bytes) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const sentinelNeedle = encoder.encode(`\n${HVY_TAIL_SENTINEL}\n`);
  const sentinelIndex = lastIndexOfBytes(bytes, sentinelNeedle);
  if (sentinelIndex < 0) {
    return { documentBytes: bytes, attachments: [] };
  }

  const prefixText = decoder.decode(bytes.slice(0, sentinelIndex));
  let directiveStart = prefixText.length;
  while (directiveStart > 0) {
    const prevNewline = prefixText.lastIndexOf('\n', directiveStart - 1);
    const lineStart = prevNewline + 1;
    const candidate = prefixText.slice(lineStart, directiveStart);
    if (/^<!--hvy:tail\s+\{.*\}\s*-->$/.test(candidate)) {
      directiveStart = prevNewline;
    } else {
      break;
    }
  }
  if (directiveStart === prefixText.length) {
    return { documentBytes: bytes, attachments: [] };
  }

  const directives = parseTailDirectives(prefixText.slice(directiveStart + 1));
  const tailStart = sentinelIndex + sentinelNeedle.length;
  let offset = 0;
  const attachments = directives.map((directive, index) => {
    const available = Math.max(0, bytes.length - tailStart - offset);
    const requestedLength = directive.length ?? (index === directives.length - 1 ? available : 0);
    const length = Math.min(requestedLength, available);
    const attachmentBytes = bytes.slice(tailStart + offset, tailStart + offset + length);
    offset += length;
    return {
      id: directive.id,
      meta: directive.meta,
      length,
      url: attachmentUrlForId(directive.id),
      bytes: attachmentBytes,
    };
  });
  return {
    documentBytes: encoder.encode(prefixText.slice(0, directiveStart)),
    attachments,
  };
}

function parseArgs(args) {
  const input = args[0];
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : '';
  if (!input || !outDir) {
    throw new Error('Usage: node scripts/extract-hvy-assets.mjs input.hvy --out dist-hvy-viewer');
  }
  return { input, outDir };
}

export function extractHostedPreviewMetadata(documentBytes) {
  const text = new TextDecoder().decode(documentBytes);
  const meta = parseFrontMatterMetadata(text);
  const description = previewString(meta.description);
  const tags = normalizePreviewTags(meta.tags);
  return {
    title: previewString(meta.title) || 'HVY Viewer',
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function parseFrontMatterMetadata(text) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return {};
  }
  const newline = text.startsWith('---\r\n') ? '\r\n' : '\n';
  const endMarker = `${newline}---${newline}`;
  const endIndex = text.indexOf(endMarker, 3);
  if (endIndex < 0) {
    return {};
  }
  const yamlSource = text.slice(3 + newline.length, endIndex);
  const parsed = parseYaml(yamlSource);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function previewString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePreviewTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => previewString(tag)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function parseTailDirectives(source) {
  return source
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = line.match(/^<!--hvy:tail\s+(\{.*\})\s*-->$/);
      if (!match) {
        throw new Error(`Invalid tail directive: ${line}`);
      }
      const payload = JSON.parse(match[1]);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`Invalid tail directive payload: ${line}`);
      }
      const id = typeof payload.id === 'string' && payload.id.length > 0
        ? payload.id
        : inferAttachmentId(payload);
      if (!id) {
        throw new Error(`Tail directive is missing id: ${line}`);
      }
      const length = typeof payload.length === 'undefined' ? null : Number(payload.length);
      if (length !== null && (!Number.isFinite(length) || length < 0)) {
        throw new Error(`Tail directive has invalid length: ${line}`);
      }
      const { id: _id, length: _length, ...meta } = payload;
      return { id, length: length === null ? null : Math.floor(length), meta };
    });
}

function inferAttachmentId(payload) {
  if (payload.plugin === 'hvy.db-table' || payload.plugin === 'hvy.scripting') {
    return 'db';
  }
  return '';
}

function attachmentUrlForId(id) {
  if (id.startsWith('image:')) {
    return `image/${encodeURIComponent(id.slice('image:'.length))}`;
  }
  return `attachment/${encodeURIComponent(id)}`;
}

function lastIndexOfBytes(source, needle) {
  if (needle.length === 0 || source.length < needle.length) {
    return -1;
  }
  for (let index = source.length - needle.length; index >= 0; index -= 1) {
    let matches = true;
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
      if (source[index + needleIndex] !== needle[needleIndex]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return index;
    }
  }
  return -1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
