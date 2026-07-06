import { expect, test } from 'vitest';

import { ensureDocumentAttachmentStore } from '../src/attachment-store';
import { encryptComponentInDocument } from '../src/encrypted-components';
import { encryptDocumentBytes, fernetDecryptBytes, fernetEncryptBytes, generateFernetKey } from '../src/encryption';
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
