import { describe, expect, test } from 'vitest';

import { getAttachment, setAttachment } from '../src/attachments';
import {
  decodeUserFileAttachmentTarget,
  countUserFileAttachmentReferences,
  defaultUserFileAttachmentName,
  encodeUserFileAttachmentTarget,
  listUserFileAttachments,
  normalizeUserFileAttachmentName,
  removeUserFileAttachment,
  renameUserFileAttachment,
  replaceUserFileAttachment,
  resolveUserFileAttachment,
  storeUserFileAttachment,
  suggestUniqueUserFileAttachmentName,
} from '../src/document-attachments';
import { deserializeDocument, deserializeDocumentBytes, serializeDocumentBytes } from '../src/serialization';
import { renderUserFileAttachmentLinksInHtml } from '../src/document-attachment-links';

function createDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"files"}-->
#! Files
`, '.hvy');
}

describe('named document attachments', () => {
  test('before, list catalog, expected result: implementation attachments are excluded', () => {
    const document = createDocument();
    setAttachment(document, 'db', { plugin: 'hvy.db-table', mediaType: 'application/vnd.sqlite3' }, new Uint8Array([1]));
    setAttachment(document, 'file:handbook', {
      role: 'user-file',
      name: 'Employee Handbook',
      filename: 'employee-handbook.pdf',
      mediaType: 'application/pdf',
    }, new Uint8Array([2, 3]));

    const expectedResult = listUserFileAttachments(document);

    expect(expectedResult).toEqual([{
      id: 'file:handbook',
      name: 'Employee Handbook',
      filename: 'employee-handbook.pdf',
      mediaType: 'application/pdf',
      length: 2,
      meta: {
        role: 'user-file',
        name: 'Employee Handbook',
        filename: 'employee-handbook.pdf',
        mediaType: 'application/pdf',
      },
    }]);
  });

  test('expected result: attachment names normalize without changing their display spelling', () => {
    expect(normalizeUserFileAttachmentName('  Ｅmployee Handbook  ')).toBe('employee handbook');
  });

  test('before, encode and decode target, expected result: names remain author-facing', () => {
    const target = encodeUserFileAttachmentTarget('Employee Handbook (2026)');

    expect(target).toBe('@attachment:Employee%20Handbook%20%282026%29');
    expect(decodeUserFileAttachmentTarget(target)).toBe('Employee Handbook (2026)');
    expect(decodeUserFileAttachmentTarget('@attachment:bad%escape')).toBeNull();
    expect(decodeUserFileAttachmentTarget('https://example.test')).toBeNull();
  });

  test('before, resolve target, expected result: lookup is name-based and case-insensitive', () => {
    const document = createDocument();
    setAttachment(document, 'file:opaque-storage-id', {
      role: 'user-file',
      name: 'Employee Handbook',
      filename: 'handbook.pdf',
      mediaType: 'application/pdf',
    }, new Uint8Array([1, 2, 3]));

    const expectedResult = resolveUserFileAttachment(document, '@attachment:employee%20handbook');

    expect(expectedResult).toMatchObject({
      status: 'resolved',
      attachment: {
        id: 'file:opaque-storage-id',
        name: 'Employee Handbook',
      },
    });
    expect(resolveUserFileAttachment(document, '@attachment:Missing')).toEqual({ status: 'missing', name: 'Missing' });
    expect(resolveUserFileAttachment(document, '@attachment:bad%escape')).toEqual({ status: 'invalid', name: '' });
  });

  test('before, duplicate descriptors, expected result: ambiguous names do not resolve silently', () => {
    const document = createDocument();
    setAttachment(document, 'file:first', {
      role: 'user-file', name: 'Guide', filename: 'first.pdf', mediaType: 'application/pdf',
    }, new Uint8Array([1]));
    setAttachment(document, 'file:second', {
      role: 'user-file', name: ' guide ', filename: 'second.pdf', mediaType: 'application/pdf',
    }, new Uint8Array([2]));

    const expectedResult = resolveUserFileAttachment(document, '@attachment:Guide');

    expect(expectedResult.status).toBe('ambiguous');
    if (expectedResult.status === 'ambiguous') {
      expect(expectedResult.attachments.map((entry) => entry.id)).toEqual(['file:first', 'file:second']);
    }
  });

  test('expected result: default and duplicate attachment names are readable', () => {
    const document = createDocument();
    setAttachment(document, 'file:first', {
      role: 'user-file', name: 'Employee Handbook', filename: 'handbook.pdf', mediaType: 'application/pdf',
    }, new Uint8Array([1]));
    setAttachment(document, 'file:second', {
      role: 'user-file', name: 'Employee Handbook 2', filename: 'handbook-2.pdf', mediaType: 'application/pdf',
    }, new Uint8Array([2]));

    expect(defaultUserFileAttachmentName('employee-handbook.pdf')).toBe('employee-handbook');
    expect(suggestUniqueUserFileAttachmentName(document, 'Employee Handbook')).toBe('Employee Handbook 3');
  });

  test('before, store attachment, expected result: canonical metadata and bytes are stored together', async () => {
    const document = createDocument();

    const expectedResult = await storeUserFileAttachment(document, {
      id: 'file:handbook',
      name: ' Employee Handbook ',
      filename: 'employee-handbook.pdf',
      mediaType: 'application/pdf',
      bytes: new Uint8Array([10, 20, 30]),
      meta: { source: 'upload', role: 'not-authoritative' },
    });

    expect(expectedResult).toMatchObject({
      id: 'file:handbook',
      name: 'Employee Handbook',
      filename: 'employee-handbook.pdf',
      mediaType: 'application/pdf',
      length: 3,
    });
    expect(getAttachment(document, 'file:handbook')).toEqual({
      id: 'file:handbook',
      meta: {
        source: 'upload',
        role: 'user-file',
        name: 'Employee Handbook',
        filename: 'employee-handbook.pdf',
        mediaType: 'application/pdf',
      },
      bytes: new Uint8Array([10, 20, 30]),
    });
    await expect(storeUserFileAttachment(document, {
      id: 'file:duplicate',
      name: 'employee handbook',
      filename: 'other.pdf',
      mediaType: 'application/pdf',
      bytes: new Uint8Array([40]),
    })).rejects.toThrow('already exists');
  });

  test('before, replace attachment, expected result: name and id remain stable', async () => {
    const document = createDocument();
    await storeUserFileAttachment(document, {
      id: 'file:guide',
      name: 'Guide',
      filename: 'guide.txt',
      mediaType: 'text/plain',
      bytes: new Uint8Array([1]),
    });

    const expectedResult = await replaceUserFileAttachment(document, 'file:guide', {
      filename: 'guide.pdf',
      mediaType: 'application/pdf',
      bytes: new Uint8Array([2, 3]),
    });

    expect(expectedResult).toMatchObject({
      id: 'file:guide',
      name: 'Guide',
      filename: 'guide.pdf',
      mediaType: 'application/pdf',
      length: 2,
    });
    expect(Array.from(getAttachment(document, 'file:guide')?.bytes ?? [])).toEqual([2, 3]);
  });

  test('before, enforce configured limits, expected result: rejected files do not alter stored bytes', async () => {
    const document = createDocument();
    await storeUserFileAttachment(document, {
      id: 'file:guide',
      name: 'Guide',
      filename: 'guide.txt',
      mediaType: 'text/plain',
      bytes: new Uint8Array([1, 2, 3]),
    }, null, { maxFileBytes: 4, maxTotalBytes: 4 });

    await expect(storeUserFileAttachment(document, {
      id: 'file:extra',
      name: 'Extra',
      filename: 'extra.txt',
      mediaType: 'text/plain',
      bytes: new Uint8Array([4, 5]),
    }, null, { maxFileBytes: 4, maxTotalBytes: 4 })).rejects.toThrow('document limit is 4 bytes');
    await expect(replaceUserFileAttachment(document, 'file:guide', {
      filename: 'larger.txt',
      mediaType: 'text/plain',
      bytes: new Uint8Array([5, 6, 7, 8, 9]),
    }, null, { maxFileBytes: 4, maxTotalBytes: 8 })).rejects.toThrow('per-file limit is 4 bytes');

    expect(Array.from(getAttachment(document, 'file:guide')?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(listUserFileAttachments(document)).toHaveLength(1);
  });

  test('before, rename attachment, expected result: nested Markdown references update atomically', async () => {
    const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"files"}-->
#! Files

<!--hvy:container {}-->

  <!--hvy:text {}-->
   [Handbook](@attachment:employee%20handbook)

<!--hvy:table {"tableColumns":["[Guide](@attachment:Employee%20Handbook)"],"tableRows":[{"cells":["[Open](@attachment:Employee%20Handbook)"]}]}-->
`, '.hvy');
    await storeUserFileAttachment(document, {
      id: 'file:handbook',
      name: 'Employee Handbook',
      filename: 'employee-handbook.pdf',
      mediaType: 'application/pdf',
      bytes: new Uint8Array([1, 2]),
    });

    expect(countUserFileAttachmentReferences(document, 'Employee Handbook')).toBe(3);

    const expectedResult = await renameUserFileAttachment(document, 'file:handbook', 'Staff Handbook');

    expect(expectedResult.referencesUpdated).toBe(3);
    expect(expectedResult.attachment).toMatchObject({ id: 'file:handbook', name: 'Staff Handbook' });
    expect(countUserFileAttachmentReferences(document, 'Employee Handbook')).toBe(0);
    expect(countUserFileAttachmentReferences(document, 'Staff Handbook')).toBe(3);
    expect(getAttachment(document, 'file:handbook')?.meta.name).toBe('Staff Handbook');
  });

  test('before, rename attachment, expected result: reusable component and section definitions update', async () => {
    const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: resource-card
    baseType: container
    schema:
      containerBlocks:
        - text: "[Component guide](@attachment:Shared%20Guide)"
          schema:
            component: text
    flavors:
      - name: compact
        schema:
          containerBlocks:
            - text: "[Compact guide](@attachment:Shared%20Guide)"
              schema:
                component: text
section_defs:
  - name: Resources
    key: resources
    template:
      title: Resources
      level: 1
      blocks:
        - text: "[Section guide](@attachment:Shared%20Guide)"
          schema:
            component: text
      children: []
    flavors:
      - name: brief
        template:
          title: Brief resources
          level: 1
          blocks:
            - text: "[Brief guide](@attachment:Shared%20Guide)"
              schema:
                component: text
          children: []
---
`, '.hvy');
    await storeUserFileAttachment(document, {
      id: 'file:shared-guide',
      name: 'Shared Guide',
      filename: 'shared-guide.pdf',
      mediaType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });

    expect(countUserFileAttachmentReferences(document, 'Shared Guide')).toBe(4);
    const expectedResult = await renameUserFileAttachment(document, 'file:shared-guide', 'Team Guide');

    expect(expectedResult.referencesUpdated).toBe(4);
    expect(countUserFileAttachmentReferences(document, 'Shared Guide')).toBe(0);
    expect(countUserFileAttachmentReferences(document, 'Team Guide')).toBe(4);
  });

  test('before, remove attachment, expected result: user file bytes and descriptor are removed', async () => {
    const document = createDocument();
    await storeUserFileAttachment(document, {
      id: 'file:temporary',
      name: 'Temporary',
      filename: 'temporary.txt',
      mediaType: 'text/plain',
      bytes: new Uint8Array([1]),
    });

    await removeUserFileAttachment(document, 'file:temporary');

    expect(getAttachment(document, 'file:temporary')).toBeNull();
    expect(listUserFileAttachments(document)).toEqual([]);
  });

  test('before, serialize bytes, expected result: named file metadata and payload round-trip', async () => {
    const document = createDocument();
    await storeUserFileAttachment(document, {
      id: 'file:handbook',
      name: 'Employee Handbook',
      filename: 'employee-handbook.pdf',
      mediaType: 'application/pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
    });

    const expectedResult = deserializeDocumentBytes(serializeDocumentBytes(document), '.hvy');

    expect(listUserFileAttachments(expectedResult)).toMatchObject([{
      id: 'file:handbook',
      name: 'Employee Handbook',
      filename: 'employee-handbook.pdf',
      mediaType: 'application/pdf',
      length: 4,
    }]);
    expect(Array.from(getAttachment(expectedResult, 'file:handbook')?.bytes ?? [])).toEqual([37, 80, 68, 70]);
  });

  test('before, render attachment links, expected result: resolved names become attachment actions', async () => {
    const document = createDocument();
    await storeUserFileAttachment(document, {
      id: 'file:opaque-storage-id',
      name: 'Employee Handbook',
      filename: 'employee-handbook.pdf',
      mediaType: 'application/pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
    });

    const expectedResult = renderUserFileAttachmentLinksInHtml(
      '<p><a href="@attachment:Employee%20Handbook">Read it</a></p>',
      document,
    );

    expect(expectedResult).toContain('href="@attachment:Employee%20Handbook"');
    expect(expectedResult).toContain('data-hvy-link-kind="attachment"');
    expect(expectedResult).toContain('data-hvy-attachment-id="file:opaque-storage-id"');
    expect(expectedResult).toContain('data-hvy-attachment-action="preview"');
  });

  test('before, render a missing attachment link, expected result: it is visibly disabled', () => {
    const expectedResult = renderUserFileAttachmentLinksInHtml(
      '<p><a href="@attachment:Missing">Missing file</a></p>',
      createDocument(),
    );

    expect(expectedResult).not.toContain('href=');
    expect(expectedResult).toContain('aria-disabled="true"');
    expect(expectedResult).toContain('hvy-attachment-link-missing');
    expect(expectedResult).toContain('data-hvy-attachment-target="@attachment:Missing"');
  });
});
