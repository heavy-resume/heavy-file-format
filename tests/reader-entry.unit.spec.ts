import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { encryptComponentInDocument } from '../src/encrypted-components';
import { encryptDocumentBytes } from '../src/encryption';
import {
  deserializeDocumentBytesAsync,
  exportDocumentSourceMarkdown,
  getComponentDefsFromMeta,
  visitBlocksInList,
} from '../src/reader';
import { deserializeDocument, serializeDocumentBytes } from '../src/serialization';

test('expected result: reader decrypts document and component bytes for traversal and source extraction', async () => {
  const keyring: Record<string, string> = {};
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-secret
    baseType: text
---

<!--hvy: {"id":"private"}-->
#! Private

<!--hvy:fake-secret {"id":"secret"}-->
Reader-only secret
`, '.hvy');
  await encryptComponentInDocument(
    document,
    document.sections[0]!.key,
    document.sections[0]!.blocks[0]!.id,
    { keyring },
  );
  const envelope = await encryptDocumentBytes(serializeDocumentBytes(document));
  keyring[envelope.keyId] = envelope.key;

  const expectedResult = await deserializeDocumentBytesAsync(envelope.bytes, '.hvy', {
    encryption: { keyring },
  });
  const visited: string[] = [];
  visitBlocksInList(expectedResult.sections[0]!.blocks, (block) => visited.push(block.text));

  expect(expectedResult.encryption?.keyId).toBe(envelope.keyId);
  expect(getComponentDefsFromMeta(expectedResult.meta).map((definition) => definition.name)).toEqual(['fake-secret']);
  expect(visited).toContain('Reader-only secret');
  expect(exportDocumentSourceMarkdown(expectedResult)).toContain('Reader-only secret');
});

test('expected result: reader browser bundle stays MV3-safe and excludes application runtimes', async () => {
  const result = await build({
    entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), '../src/reader.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    metafile: true,
    write: false,
  });
  const inputs = Object.keys(result.metafile.inputs);
  const forbiddenInputs = inputs.filter((path) => /(?:^|\/)(?:chat|pdf-export|pdf-preview)(?:\/|$)|(?:^|\/)plugins\/registry\.ts$|brython|sql\.js|\.css(?:\?|$)|(?:^|\/)(?:embed|main)\.ts$|(?:^|\/)(?:editor|reader)\/render\.ts$/.test(path));
  const bundledCode = result.outputFiles.map((file) => file.text).join('\n');

  expect(forbiddenInputs).toEqual([]);
  expect(bundledCode).not.toMatch(/\beval\s*\(|\bnew\s+Function\b|\bWebAssembly\b/);
});
