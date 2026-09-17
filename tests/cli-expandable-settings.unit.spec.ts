import { expect, test } from 'vitest';
import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument, serializeDocument } from '../src/serialization';

function expandableDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-record
    baseType: expandable
    schema:
      expandableAlwaysShowStub: true
    flavors:
      - name: fake-flavor
        schema:
          expandableAlwaysShowStub: true
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:expandable {"id":"fake-builtin"}-->

<!--hvy:fake-record {"id":"fake-custom"}-->
`, '.thvy');
}

test.each([
  ['/body/fake-section/fake-builtin', 'expandable'],
  ['/body/fake-section/fake-custom', 'fake-record'],
  ['/templates/components/fake-record/schema', 'expandable'],
  ['/templates/components/fake-record/flavors/fake-flavor/schema', 'expandable'],
])('expected result: expandable settings round-trip through %s', async (path, component) => {
  const document = expandableDocument();
  const session = createHvyCliSession();
  expect(JSON.parse((await executeHvyCliCommand(document, session, `cat ${path}/${component}.json`)).output)).toMatchObject({
    expandableAlwaysShowStub: true,
    expandableExpanded: false,
  });
  await executeHvyCliCommand(document, session, `hvy insert -1 text ${path}/expandable-stub --id fake-stub`);
  await executeHvyCliCommand(document, session, `hvy insert -1 text ${path}/expandable-content --id fake-content`);

  expect((await executeHvyCliCommand(document, session, `echo '{"id":"${path.split('/').pop()}","expandableAlwaysShowStub":false,"expandableExpanded":true,"expandableStubCss":"padding: 1rem;","expandableContentCss":"padding: 2rem;","expandableStubDescription":"Fake stub","expandableContentDescription":"Fake content"}' > ${path}/${component}.json`)).output).toContain(': written');

  const expectedResult = {
    expandableAlwaysShowStub: false,
    expandableExpanded: true,
    expandableStubCss: 'padding: 1rem;',
    expandableContentCss: 'padding: 2rem;',
    expandableStubDescription: 'Fake stub',
    expandableContentDescription: 'Fake content',
  };
  expect(JSON.parse((await executeHvyCliCommand(document, session, `cat ${path}/${component}.json`)).output)).toMatchObject(expectedResult);
  expect((await executeHvyCliCommand(document, session, `hvy preview ${path}`)).output).toContain('"expandableAlwaysShowStub":false');
  const reopened = deserializeDocument(serializeDocument(document), '.thvy');
  expect(JSON.parse((await executeHvyCliCommand(reopened, createHvyCliSession(), `cat ${path}/${component}.json`)).output)).toMatchObject(expectedResult);
  expect((await executeHvyCliCommand(reopened, createHvyCliSession(), `ls ${path}/expandable-stub`)).output).toContain('fake-stub');
  expect((await executeHvyCliCommand(reopened, createHvyCliSession(), `ls ${path}/expandable-content`)).output).toContain('fake-content');

  await executeHvyCliCommand(document, session, `echo '{"id":"${path.split('/').pop()}"}' > ${path}/${component}.json`);

  expect(JSON.parse((await executeHvyCliCommand(document, session, `cat ${path}/${component}.json`)).output)).toMatchObject({
    expandableAlwaysShowStub: true,
    expandableExpanded: false,
    expandableStubCss: '',
    expandableContentCss: '',
    expandableStubDescription: '',
    expandableContentDescription: '',
  });
  expect((await executeHvyCliCommand(document, session, `ls ${path}/expandable-stub`)).output).toContain('fake-stub');
  expect((await executeHvyCliCommand(document, session, `ls ${path}/expandable-content`)).output).toContain('fake-content');
});
