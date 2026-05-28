import { expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { exportDocumentSourceMarkdown } from '../src/document-source-markdown';

test('PDF template source markdown keeps viewer information and strips HVY authoring data', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
title: Source
theme:
  colors:
    accent: red
---

<!--hvy: {"id":"summary","css":"color:red","description":"authoring note"}-->
#! Summary

<!--hvy:text {"id":"intro","css":"font-weight:bold"}-->
 Hello <!--hvy:alt {"compact":"Team"}-->Team Members<!--/hvy:alt-->

<!--hvy:code {"id":"setup-script","codeLanguage":"ts"}-->
 const setup = "not source content";

<!--hvy:button {"id":"generate","editorOnly":true,"buttonLabel":"Generate"}-->

<!--hvy:table {"id":"history-table","tableColumns":["TITLE","<!--hvy:alt {\\"compact\\":\\"ORG\\"}-->ORGANIZATION<!--/hvy:alt-->"],"tableRows":[{"cells":["Engineer","Example Co"]}]}-->

<!--hvy:xref-card {"id":"skill-card","xrefTitle":"TypeScript","xrefDetail":"Primary tool","xrefTarget":"skill-typescript"}-->

<!--hvy: {"id":"maintenance","editorOnly":true}-->
#! Maintenance

<!--hvy:text {}-->
 Hidden instructions
`, '.hvy');

  const expectedResult = exportDocumentSourceMarkdown(document);

  expect(expectedResult).toBe(`# Summary

Hello Team Members

| TITLE | ORGANIZATION |
| --- | --- |
| Engineer | Example Co |

TypeScript - Primary tool`);
  expect(expectedResult).not.toContain('hvy_version');
  expect(expectedResult).not.toContain('<!--hvy');
  expect(expectedResult).not.toContain('authoring note');
  expect(expectedResult).not.toContain('setup');
  expect(expectedResult).not.toContain('Hidden instructions');
});

test('PDF template source markdown omits unfilled placeholder-only text', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"education"}-->
#! Education

<!--hvy:text {"css":"margin: 0;","fillIn":true}-->
 ^section-heading^ #### <!-- value {"placeholder":"Classes Or '' if no classes"} -->

<!--hvy:text {"css":"margin: 0;","placeholder":"classes"}-->
`, '.phvy');

  const expectedResult = exportDocumentSourceMarkdown(document);

  expect(expectedResult).toBe('# Education');
  expect(expectedResult).not.toContain('####');
  expect(expectedResult).not.toContain('classes');
  expect(expectedResult).not.toContain('<!-- value');
});
