import { expect, test } from 'vitest';
import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument, serializeDocument } from '../src/serialization';

const commonFields = {
  editorOnly: true,
  visibleScript: 'return true',
  xrefTitle: 'Fake title',
  xrefDetail: 'Fake detail',
};

const cases = [
  { component: 'text', settings: { showCopy: true } },
  { component: 'code', settings: { codeLanguage: 'python' } },
  { component: 'expandable', settings: { expandableAlwaysShowStub: false } },
  { component: 'container', settings: { containerTitle: 'Fake container' } },
  { component: 'grid', settings: { gridColumns: 3 } },
  { component: 'component-list', settings: { componentListComponent: 'text' } },
  { component: 'xref-card', settings: { xrefTarget: 'fake-target' } },
  { component: 'table', settings: { tableShowHeader: false } },
  { component: 'image', settings: { imageAlt: 'Fake image' } },
  { component: 'carousel', settings: { carouselDurationMs: 1234 } },
  { component: 'plugin', settings: { plugin: 'fake-plugin' } },
  { component: 'button', settings: {
    buttonLabel: 'Fake action', buttonAction: 'ai-generate',
    buttonVisibleScript: 'return true', buttonSourceScript: 'return "fake source"',
    buttonPrompt: 'Fake prompt', buttonTargetScript: 'return "fake-target"',
    buttonInputCharLimit: 123, buttonOutputCharLimit: 456,
    buttonPositionTargetId: 'fake-target', buttonCss: 'padding: 1rem;',
  } },
];

test.each(cases)('expected result: $component JSON edits preserve all existing block metadata', async ({ component, settings }) => {
  const document = deserializeDocument(`---\nhvy_version: 0.1\n---\n<!--hvy: {"id":"fake-section"}-->\n#! Fake Section\n\n<!--hvy:${component} ${JSON.stringify({ id: 'fake-block', ...commonFields, ...settings })}-->\n`, '.hvy');
  const session = createHvyCliSession();
  const before = structuredClone(document.sections[0].blocks[0].schema);
  expect(JSON.parse((await executeHvyCliCommand(document, session, `cat /body/fake-section/fake-block/${component}.json`)).output)).toMatchObject({ ...commonFields, ...settings });

  await executeHvyCliCommand(document, session, `sed -i 's/"align": "left"/"align": "right"/' /body/fake-section/fake-block/${component}.json`);

  expect(document.sections[0].blocks[0].schema).toEqual({ ...before, align: 'right' });
  expect(JSON.parse((await executeHvyCliCommand(deserializeDocument(serializeDocument(document), '.hvy'), createHvyCliSession(), `cat /body/fake-section/fake-block/${component}.json`)).output)).toMatchObject({ ...commonFields, ...settings, align: 'right' });
});

test.each(cases)('expected result: $component metadata can be written and explicitly cleared', async ({ component, settings }) => {
  const document = deserializeDocument(`---\nhvy_version: 0.1\n---\n<!--hvy: {"id":"fake-section"}-->\n#! Fake Section\n\n<!--hvy:${component} {"id":"fake-block"}-->\n`, '.hvy');
  const session = createHvyCliSession();
  const before = structuredClone(document.sections[0].blocks[0].schema);
  expect(before.xrefTitle).toBe('');

  await executeHvyCliCommand(document, session, `echo '${JSON.stringify({ id: 'fake-block', ...commonFields, ...settings })}' > /body/fake-section/fake-block/${component}.json`);

  expect(document.sections[0].blocks[0].schema).toMatchObject({ ...commonFields, ...settings });
  expect(deserializeDocument(serializeDocument(document), '.hvy').sections[0].blocks[0].schema).toMatchObject({ ...commonFields, ...settings });

  await executeHvyCliCommand(document, session, `echo '{"id":"fake-block","xrefTitle":"","xrefDetail":""}' > /body/fake-section/fake-block/${component}.json`);

  expect(document.sections[0].blocks[0].schema).toEqual(before);
});

test.each(['schema', 'flavors/fake-flavor/schema'])('expected result: template %s styling preserves reference template variables', async (suffix) => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-record
    baseType: expandable
    schema:
      xrefTitle: "{% fake_title %}"
      xrefDetail: "{% fake_detail %}"
    flavors:
      - name: fake-flavor
        schema:
          xrefTitle: "{% fake_title %}"
          xrefDetail: "{% fake_detail %}"
---
`, '.thvy');
  const session = createHvyCliSession();
  expect((await executeHvyCliCommand(document, session, `hvy preview /templates/components/fake-record/${suffix}`)).output).toContain('"xrefTitle":"{% fake_title %}"');

  await executeHvyCliCommand(document, session, `sed -i 's/"expandableAlwaysShowStub": true/"expandableAlwaysShowStub": false/' /templates/components/fake-record/${suffix}/expandable.json`);

  expect(JSON.parse((await executeHvyCliCommand(deserializeDocument(serializeDocument(document), '.thvy'), createHvyCliSession(), `cat /templates/components/fake-record/${suffix}/expandable.json`)).output)).toMatchObject({
    expandableAlwaysShowStub: false,
    xrefTitle: '{% fake_title %}',
    xrefDetail: '{% fake_detail %}',
  });
});
