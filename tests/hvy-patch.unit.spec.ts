import { expect, test } from 'vitest';

import { applyHvyPatch } from '../src/chat-cli/hvy-patch';
import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument } from '../src/serialization';

function createPatchDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"delivery"}-->
Alpha speed claim.

<!--hvy:text {"id":"mentoring"}-->
Beta mentoring claim.
`, '.hvy');
}

test('expected result: one patch updates several virtual files atomically per file', async () => {
  const document = createPatchDocument();
  const session = createHvyCliSession();

  const expectedResult = applyHvyPatch(document, session, `*** Begin Patch
*** Update File: /body/summary/delivery/text.txt
@@
-Alpha speed claim.
+Alpha delivery claim.
*** Update File: /body/summary/mentoring/text.txt
@@
-Beta mentoring claim.
+Beta coaching claim.
*** End Patch`);

  expect(expectedResult).toEqual(expect.objectContaining({
    appliedFileCount: 2,
    failedFileCount: 0,
    mutatedPaths: [
      '/body/summary/delivery/text.txt',
      '/body/summary/mentoring/text.txt',
    ],
  }));
  expect(await executeHvyCliCommand(document, session, 'cat /body/summary/delivery/text.txt')).toEqual(expect.objectContaining({
    output: 'Alpha delivery claim.',
  }));
  expect(await executeHvyCliCommand(document, session, 'cat /body/summary/mentoring/text.txt')).toEqual(expect.objectContaining({
    output: 'Beta coaching claim.',
  }));
});

test('expected result: a failed file remains unchanged while later files still apply', async () => {
  const document = createPatchDocument();
  const session = createHvyCliSession();

  const expectedResult = applyHvyPatch(document, session, `*** Begin Patch
*** Update File: /body/summary/delivery/text.txt
@@
-Missing speed claim.
+Replacement.
*** Update File: /body/summary/mentoring/text.txt
@@
-Beta mentoring claim.
+Beta coaching claim.
*** End Patch`);

  expect(expectedResult.appliedFileCount).toBe(1);
  expect(expectedResult.failedFileCount).toBe(1);
  expect(expectedResult.files[0]).toEqual(expect.objectContaining({
    status: 'failed',
    path: '/body/summary/delivery/text.txt',
    error: 'Hunk 1 did not match the current file.',
  }));
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/delivery/text.txt')).output).toBe('Alpha speed claim.');
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/mentoring/text.txt')).output).toBe('Beta coaching claim.');
});

test('expected result: ambiguous hunks fail instead of guessing', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"repeated"}-->
Same
Middle
Same
`, '.hvy');

  const expectedResult = applyHvyPatch(document, createHvyCliSession(), `*** Begin Patch
*** Update File: /body/summary/repeated/text.txt
@@
-Same
+Changed
*** End Patch`);

  expect(expectedResult).toEqual(expect.objectContaining({
    appliedFileCount: 0,
    failedFileCount: 1,
  }));
  expect(expectedResult.files[0]).toEqual(expect.objectContaining({
    error: 'Hunk 1 matched 2 locations; add more context.',
  }));
});

test('expected result: malformed patches are rejected before mutation', () => {
  const document = createPatchDocument();

  expect(() => applyHvyPatch(document, createHvyCliSession(), `*** Begin Patch
*** Delete File: /body/summary/delivery/text.txt
*** End Patch`)).toThrow('Unsupported patch directive');
});

test('expected result: invalid structured files preserve the failed draft and do not block later files', async () => {
  const document = createPatchDocument();
  const session = createHvyCliSession();

  const expectedResult = applyHvyPatch(document, session, `*** Begin Patch
*** Update File: /body/summary/delivery/text.json
@@
-{
+{ invalid
*** Update File: /body/summary/mentoring/text.txt
@@
-Beta mentoring claim.
+Beta coaching claim.
*** End Patch`);

  expect(expectedResult.appliedFileCount).toBe(1);
  expect(expectedResult.failedFileCount).toBe(1);
  expect(expectedResult.files[0]).toEqual(expect.objectContaining({
    status: 'failed',
    path: '/body/summary/delivery/text.json',
    error: expect.stringContaining('text.modified.json now contains the failed draft'),
  }));
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/delivery/text.modified.json')).output).toContain('{ invalid');
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/mentoring/text.txt')).output).toBe('Beta coaching claim.');
});

test('expected result: one patch coordinates ordering, CSS configuration, and table data', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"delivery","css":"color: red;"}-->
Delivery claim.

<!--hvy:table {"id":"facts","tableColumns":["Trait"],"tableRows":[{"cells":["Fast"]}]}-->

<!--hvy: {"id":"details"}-->
#! Details

<!--hvy:text {"id":"note"}-->
Details.
`, '.hvy');
  const session = createHvyCliSession();

  const expectedResult = applyHvyPatch(document, session, `*** Begin Patch
*** Update File: /body/children-order.json
@@
-  "summary",
-  "details"
+  "details",
+  "summary"
*** Update File: /body/summary/delivery/text.json
@@
-  "css": "color: red;",
+  "css": "color: blue;",
*** Update File: /body/summary/facts/tableRows.json
@@
-      "Fast"
+      "Deliberate"
*** End Patch`);

  expect(expectedResult).toEqual(expect.objectContaining({
    appliedFileCount: 3,
    failedFileCount: 0,
  }));
  expect(JSON.parse((await executeHvyCliCommand(document, session, 'cat /body/children-order.json')).output)).toEqual(['details', 'summary']);
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/delivery/text.json')).output).toContain('"css": "color: blue;"');
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/facts/tableRows.json')).output).toContain('"Deliberate"');
});
