import { expect, test } from 'vitest';

import { ensureDocumentAttachmentStore } from '../src/attachment-store';
import { changeEncryptedComponentKeyInDocument, decryptComponentInDocument, encryptComponentInDocument } from '../src/encrypted-components';
import { decryptDocumentEnvelopeBytes, encryptDocumentBytes, fernetDecryptBytes, fernetEncryptBytes, generateFernetKey } from '../src/encryption';
import {
  deserializeDocument,
  deserializeDocumentBytes,
  deserializeDocumentBytesAsync,
  serializeDocument,
  serializeDocumentBytes,
  serializeDocumentBytesAsync,
} from '../src/serialization';

test('expected result: Fernet helper encrypts and decrypts bytes without numeric array conversion', async () => {
  const key = generateFernetKey();
  const payload = new TextEncoder().encode('large binary-ish payload');

  const token = await fernetEncryptBytes(payload, key);
  const expectedResult = await fernetDecryptBytes(token, key);

  expect(Array.from(expectedResult)).toEqual(Array.from(payload));
});

test('expected result: encrypted document envelope hides plaintext and decrypts with keyring', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"private"}-->
#! Private

 <!--hvy:text {}-->
  Secret document text
`, '.hvy');
  const encrypted = await encryptDocumentBytes(serializeDocumentBytes(document));

  expect(new TextDecoder().decode(encrypted.bytes)).not.toContain('Secret document text');

  const expectedResult = await deserializeDocumentBytesAsync(encrypted.bytes, '.hvy', {
    encryption: { keyring: { [encrypted.keyId]: encrypted.key } },
  });

  expect(expectedResult.encryption).toEqual({ algorithm: 'fernet', keyId: encrypted.keyId, encrypted: true });
  expect(expectedResult.sections[0]?.blocks[0]?.text).toBe('Secret document text');
});

test('expected result: document envelope helper returns decrypted serialized bytes and key id', async () => {
  const plainBytes = new TextEncoder().encode('saved history bytes');
  const encrypted = await encryptDocumentBytes(plainBytes);

  const expectedResult = await decryptDocumentEnvelopeBytes(encrypted.bytes, {
    keyring: { [encrypted.keyId]: encrypted.key },
  });

  expect(expectedResult).toEqual({ bytes: plainBytes, keyId: encrypted.keyId });
});

test('expected result: document envelope helper passes ordinary bytes through unchanged', async () => {
  const bytes = new TextEncoder().encode('ordinary history bytes');

  const expectedResult = await decryptDocumentEnvelopeBytes(bytes, null);

  expect(expectedResult).toEqual({ bytes, keyId: '' });
});

test('expected result: encrypted component round-trips as opaque tail when key is missing', async () => {
  const keyring: Record<string, string> = {};
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"private"}-->
#! Private

 <!--hvy:text {}-->
  Secret component text
`, '.hvy');

  const encrypted = await encryptComponentInDocument(document, document.sections[0]!.key, document.sections[0]!.blocks[0]!.id, {
    keyring,
  });
  const bytes = serializeDocumentBytes(document);
  const serializedText = new TextDecoder().decode(bytes);

  expect(serializedText).toContain(`<!--hvy:encrypted {"keyId":"${encrypted.keyId}"}-->`);
  expect(serializedText).toContain(`<!--hvy:tail {"id":"${encrypted.attachmentId}"`);
  expect(serializedText).not.toContain('Secret component text');

  const expectedResult = deserializeDocumentBytes(bytes, '.hvy');
  const block = expectedResult.sections[0]?.blocks[0];

  expect(block?.schema.kind).toBe('encrypted');
  expect(block?.schema.encryptedBlock).toBeNull();
  expect(ensureDocumentAttachmentStore(expectedResult).get(encrypted.attachmentId)?.bytes.length).toBeGreaterThan(0);
});

test('expected result: decrypted encrypted component edits re-encrypt during async serialization', async () => {
  const keyring: Record<string, string> = {};
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"private"}-->
#! Private

 <!--hvy:text {}-->
  Secret component text
`, '.hvy');
  const encrypted = await encryptComponentInDocument(document, document.sections[0]!.key, document.sections[0]!.blocks[0]!.id, {
    keyring,
  });
  const opened = await deserializeDocumentBytesAsync(serializeDocumentBytes(document), '.hvy', { encryption: { keyring } });
  const encryptedBlock = opened.sections[0]?.blocks[0];
  if (!encryptedBlock || encryptedBlock.schema.kind !== 'encrypted' || !encryptedBlock.schema.encryptedBlock) {
    throw new Error('Expected decrypted encrypted component.');
  }

  encryptedBlock.schema.encryptedBlock.text = 'Changed encrypted text';
  const bytes = await serializeDocumentBytesAsync(opened, null, { encryption: { keyring } });
  const serializedText = new TextDecoder().decode(bytes);
  const expectedResult = await deserializeDocumentBytesAsync(bytes, '.hvy', { encryption: { keyring } });

  expect(serializedText).toContain(`<!--hvy:encrypted {"keyId":"${encrypted.keyId}"}-->`);
  expect(serializedText).not.toContain('Changed encrypted text');
  expect(expectedResult.sections[0]?.blocks[0]?.schema.encryptedBlock?.text).toBe('Changed encrypted text');
});

test('expected result: normal serialization does not include decrypted child block state', async () => {
  const keyring: Record<string, string> = {};
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"private"}-->
#! Private

 <!--hvy:text {}-->
  Secret component text
`, '.hvy');
  await encryptComponentInDocument(document, document.sections[0]!.key, document.sections[0]!.blocks[0]!.id, { keyring });
  const opened = await deserializeDocumentBytesAsync(serializeDocumentBytes(document), '.hvy', { encryption: { keyring } });

  expect(serializeDocument(opened)).not.toContain('Secret component text');
  expect(serializeDocument(opened)).toContain('<!--hvy:encrypted');
});

test('expected result: changing an encrypted component key replaces its key and attachment', async () => {
  const keyring: Record<string, string> = {};
  const removedKeyIds: string[] = [];
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"private"}-->
#! Private

 <!--hvy:text {}-->
  Secret component text
`, '.hvy');

  const before = await encryptComponentInDocument(document, document.sections[0]!.key, document.sections[0]!.blocks[0]!.id, { keyring });
  const expectedResult = await changeEncryptedComponentKeyInDocument(document, document.sections[0]!.key, before.encryptedBlockId, {
    keyring,
    onKeyRemoved(keyId) {
      removedKeyIds.push(keyId);
    },
  });
  const after = serializeDocument(document);

  expect(expectedResult.keyId).not.toBe(before.keyId);
  expect(after).toContain(`<!--hvy:encrypted {"keyId":"${expectedResult.keyId}"}-->`);
  expect(after).not.toContain(before.keyId);
  expect(ensureDocumentAttachmentStore(document).get(before.attachmentId)).toBeNull();
  expect(ensureDocumentAttachmentStore(document).get(expectedResult.attachmentId)?.bytes.length).toBeGreaterThan(0);
  expect(keyring[before.keyId]).toBeUndefined();
  expect(keyring[expectedResult.keyId]).toBe(expectedResult.key);
  expect(removedKeyIds).toEqual([before.keyId]);
});

test('expected result: removing component encryption restores content and drops its key and attachment', async () => {
  const keyring: Record<string, string> = {};
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"private"}-->
#! Private

 <!--hvy:text {}-->
  Secret component text
`, '.hvy');

  const before = await encryptComponentInDocument(document, document.sections[0]!.key, document.sections[0]!.blocks[0]!.id, { keyring });
  await decryptComponentInDocument(document, document.sections[0]!.key, before.encryptedBlockId, { keyring });
  const after = serializeDocument(document);

  expect(after).not.toContain('<!--hvy:encrypted');
  expect(after).toContain('Secret component text');
  expect(ensureDocumentAttachmentStore(document).get(before.attachmentId)).toBeNull();
  expect(keyring[before.keyId]).toBeUndefined();
});

test('expected result: a container occupying a grid cell is replaced by encryption and restored in place', async () => {
  const keyring: Record<string, string> = {};
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"private"}-->
#! Private

 <!--hvy:grid {}-->
  <!--hvy:grid:0 {"id":"private-cell"}-->
   <!--hvy:container {"id":"private-container"}-->

    <!--hvy:text {}-->
     Secret grid container text
`, '.hvy');
  const gridItem = document.sections[0]?.blocks[0]?.schema.gridItems?.[0];
  if (!gridItem) throw new Error('Expected grid item.');

  // BEFORE
  expect(gridItem.block.schema.kind).toBe('container');

  // TOOL CALL
  const encrypted = await encryptComponentInDocument(document, document.sections[0]!.key, gridItem.block.id, { keyring });

  // AFTER
  expect(gridItem.block.id).toBe(encrypted.encryptedBlockId);
  expect(gridItem.block.schema.kind).toBe('encrypted');
  expect(serializeDocument(document)).not.toContain('Secret grid container text');

  await decryptComponentInDocument(document, document.sections[0]!.key, encrypted.encryptedBlockId, { keyring });

  expect(gridItem.block.schema.kind).toBe('container');
  expect(serializeDocument(document)).toContain('Secret grid container text');
});
