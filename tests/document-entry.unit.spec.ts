import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import {
  deserializeDocumentBytesAsync,
  instantiateReusableBlockFromDocument,
  serializeDocumentBytesAsync,
} from '../src/document';
import { encryptComponentInDocument } from '../src/encrypted-components';
import { encryptDocumentBytes, isEncryptedDocumentBytes } from '../src/encryption';
import { deserializeDocument, serializeDocumentBytes } from '../src/serialization';

test('expected result: document entry instantiates reusable blocks from the supplied document metadata', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: application-entry
    baseType: text
    text: |-
      ## {% company %}
      **{% role %}**
      Applied {% application_date %}
      [Job posting]({% job_url %})
    templateVariables:
      company:
        type: text
      role:
        type: text
      application_date:
        type: text
      job_url:
        type: url
---
`, '.hvy');

  const expectedResult = instantiateReusableBlockFromDocument(document, 'application-entry', {
    company: 'Example Robotics',
    role: 'Software Engineer',
    application_date: '10/05/2026',
    job_url: 'https://example.com/job',
  });

  expect(expectedResult?.schema.component).toBe('application-entry');
  expect(expectedResult?.text).toContain('## Example Robotics');
  expect(expectedResult?.text).toContain('**Software Engineer**');
  expect(expectedResult?.text).toContain('Applied 10/05/2026');
  expect(expectedResult?.text).toContain('[Job posting](https://example.com/job)');
  expect(expectedResult?.text).not.toContain('{%');
});

test('expected result: document entry serializes component edits and restores the document envelope', async () => {
  const keyring: Record<string, string> = {};
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"private"}-->
#! Private

<!--hvy:text {"id":"secret"}-->
Original secret
`, '.hvy');
  await encryptComponentInDocument(
    document,
    document.sections[0]!.key,
    document.sections[0]!.blocks[0]!.id,
    { keyring },
  );
  const envelope = await encryptDocumentBytes(serializeDocumentBytes(document));
  keyring[envelope.keyId] = envelope.key;
  const opened = await deserializeDocumentBytesAsync(envelope.bytes, '.hvy', {
    encryption: { keyring },
  });
  const encryptedBlock = opened.sections[0]?.blocks[0];
  if (!encryptedBlock || encryptedBlock.schema.kind !== 'encrypted' || !encryptedBlock.schema.encryptedBlock) {
    throw new Error('Expected an unlocked encrypted component.');
  }
  encryptedBlock.schema.encryptedBlock.text = 'Revised secret';

  const expectedResult = await serializeDocumentBytesAsync(opened, {
    encryption: { keyring },
  });
  const reopened = await deserializeDocumentBytesAsync(expectedResult, '.hvy', {
    encryption: { keyring },
  });

  expect(isEncryptedDocumentBytes(expectedResult)).toBe(true);
  expect(new TextDecoder().decode(expectedResult)).not.toContain('Revised secret');
  expect(reopened.encryption?.keyId).toBe(envelope.keyId);
  expect(reopened.sections[0]?.blocks[0]?.schema.encryptedBlock?.text).toBe('Revised secret');
});

test('expected result: document browser bundle stays MV3-safe and excludes application runtimes', async () => {
  const result = await build({
    entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), '../src/document.ts')],
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
