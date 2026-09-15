import { expect, test } from 'vitest';
import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import { getComponentDefsFromMeta, getSectionDefsFromMeta } from '../src/component-defs';

function templateDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-card
    baseType: grid
    schema:
      css: "gap: 1rem;"
      gridColumns: 2
      gridItems:
        - block:
            text: Fake original
            schema:
              component: text
              id: fake-label
    flavors:
      - name: fake-flavor
        schema:
          gridColumns: 3
section_defs:
  - name: Fake Section
    key: fake-section
    repeatable: true
    template:
      title: Fake Title
      blocks: []
---
<!--hvy: {"id":"fake-body"}-->
#! Fake Body

<!--hvy:fake-card {"id":"fake-instance"}-->

 <!--hvy:grid:0 {}-->

  <!--hvy:text {"id":"fake-label"}-->
   Fake original
`, '.thvy');
}

test('expected result: definitions are discoverable without expanding their contents or changing the document', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  const before = serializeDocument(document);

  expect((await executeHvyCliCommand(document, session, 'ls /templates')).output).toContain('components');
  expect((await executeHvyCliCommand(document, session, 'ls /templates/components')).output).toContain('fake-card');
  expect((await executeHvyCliCommand(document, session, 'cat /templates/components/fake-card/definition.json')).output).not.toContain('gridItems');
  expect((await executeHvyCliCommand(document, session, 'cat /header.yaml')).output).not.toMatch(/component_defs|section_defs/);
  expect(serializeDocument(document)).toBe(before);
});

test('expected result: nested definition edits survive serialization and do not rewrite body instances', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect(getComponentDefsFromMeta(document.meta)[0].schema?.gridItems[0].block.text).toBe('Fake original');
  expect(document.sections[0].blocks[0].schema.gridItems[0].block.text).toBe('Fake original');

  await executeHvyCliCommand(document, session, 'echo "Fake revised" > /templates/components/fake-card/schema/grid/fake-label/text.txt');

  const expectedResult = deserializeDocument(serializeDocument(document), '.thvy');
  expect(getComponentDefsFromMeta(expectedResult.meta)[0].schema?.gridItems[0].block.text.trim()).toBe('Fake revised');
  expect(expectedResult.sections[0].blocks[0].schema.gridItems[0].block.text).toBe('Fake original');
  expect((await executeHvyCliCommand(document, session, 'cat /templates/components/fake-card/schema/grid/fake-label/text.txt')).output).toContain('Fake revised');
});

test('expected result: create, populate, instantiate, and remove definitions through CLI commands', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const session = createHvyCliSession();
  expect(getComponentDefsFromMeta(document.meta)).toEqual([]);

  await executeHvyCliCommand(document, session, 'hvy insert -1 grid /templates/components --id fake-grid');
  expect((await executeHvyCliCommand(document, session, 'hvy insert -1 text /templates/components/fake-grid/schema/grid --id fake-child')).output).toContain('/templates/components/fake-grid/schema/grid/fake-child: created');
  await executeHvyCliCommand(document, session, 'echo "Fake child" > /templates/components/fake-grid/schema/grid/fake-child/text.txt');
  await executeHvyCliCommand(document, session, 'hvy insert -1 section /templates/sections --id fake-section');
  await executeHvyCliCommand(document, session, 'hvy insert -1 fake-grid /templates/sections/fake-section/template --id fake-grid-instance');
  await executeHvyCliCommand(document, session, 'hvy insert -1 section /body --from-template fake-section');

  const expectedResult = deserializeDocument(serializeDocument(document), '.hvy');
  expect(getComponentDefsFromMeta(expectedResult.meta)[0].schema?.gridItems[0].block.text.trim()).toBe('Fake child');
  expect(getSectionDefsFromMeta(expectedResult.meta)[0].template.blocks[0].schema.component).toBe('fake-grid');
  expect(expectedResult.sections[0].blocks[0].schema.gridItems[0].block.text.trim()).toBe('Fake child');

  await executeHvyCliCommand(document, session, 'hvy remove /templates/components/fake-grid/schema/grid/fake-child');
  expect(getComponentDefsFromMeta(document.meta)[0].schema?.gridItems).toHaveLength(0);
  await executeHvyCliCommand(document, session, 'hvy remove /templates/components/fake-grid');
  expect(getComponentDefsFromMeta(document.meta)).toEqual([]);
  expect(document.sections[0].blocks[0].schema.gridItems).toHaveLength(1);
});

test('expected result: flavor edits and metadata edits preserve other trees and survive reload', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect(getComponentDefsFromMeta(document.meta)[0].flavors?.[0].schema?.gridColumns).toBe(3);

  await executeHvyCliCommand(document, session, `sed -i 's/"gridColumns": 3/"gridColumns": 4/' /templates/components/fake-card/flavors/fake-flavor/schema/grid.json`);
  await executeHvyCliCommand(document, session, `echo '{"name":"fake-card","baseType":"grid","description":"Fake description","templateVariables":{"fake_label":{"label":"Fake Label"}}}' > /templates/components/fake-card/definition.json`);
  await executeHvyCliCommand(document, session, 'hvy insert -1 grid /templates/components/fake-card/flavors --id fake-second');

  const expectedResult = getComponentDefsFromMeta(deserializeDocument(serializeDocument(document), '.thvy').meta)[0];
  expect(expectedResult.schema?.gridColumns).toBe(2);
  expect(expectedResult.flavors?.[0].schema?.gridColumns).toBe(4);
  expect(expectedResult.flavors?.[1].name).toBe('fake-second');
  expect(expectedResult.description).toBe('Fake description');
  expect(expectedResult.templateVariables?.fake_label.label).toBe('Fake Label');
});

test('expected result: copying body components and sections creates independent reusable definitions', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect(getComponentDefsFromMeta(document.meta)).toHaveLength(1);

  await executeHvyCliCommand(document, session, 'cp -r /body/fake-body/fake-instance /templates/components/fake-copy');
  await executeHvyCliCommand(document, session, 'cp -r /body/fake-body /templates/sections/fake-copy-section');
  await executeHvyCliCommand(document, session, 'echo "Copied edit" > /templates/components/fake-copy/schema/grid/fake-label/text.txt');

  const expectedResult = deserializeDocument(serializeDocument(document), '.thvy');
  expect(getComponentDefsFromMeta(expectedResult.meta)[1].schema?.gridItems[0].block.text.trim()).toBe('Copied edit');
  expect(getSectionDefsFromMeta(expectedResult.meta)[1].template.blocks).toHaveLength(1);
  expect(expectedResult.sections[0].blocks[0].schema.gridItems[0].block.text).toBe('Fake original');
});

test('expected result: invalid definition operations fail without changing the document', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  const before = serializeDocument(document);

  await expect(executeHvyCliCommand(document, session, 'hvy insert -1 text /templates/components --id fake-card')).rejects.toThrow('already exists');
  await expect(executeHvyCliCommand(document, session, 'hvy insert -1 text /templates/components')).rejects.toThrow('require');
  await expect(executeHvyCliCommand(document, session, 'hvy insert 99 text /templates/components --id fake-new')).rejects.toThrow('out of range');
  await expect(executeHvyCliCommand(document, session, `echo '{"name":"fake-renamed","baseType":"grid"}' > /templates/components/fake-card/definition.json`)).rejects.toThrow('unchanged');
  await expect(executeHvyCliCommand(document, session, 'hvy remove /templates/components/fake-card/schema')).rejects.toThrow('definition directory');
  await expect(executeHvyCliCommand(document, session, 'echo "component_defs: []" > /header.yaml')).rejects.toThrow('/templates');

  expect(serializeDocument(document)).toBe(before);
});

test('expected result: header writes preserve both definition collections', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect(getSectionDefsFromMeta(document.meta)).toHaveLength(1);

  await executeHvyCliCommand(document, session, 'echo "title: Fake changed title" > /header.yaml');

  expect(document.meta.title).toBe('Fake changed title');
  expect(getComponentDefsFromMeta(document.meta)).toHaveLength(1);
  expect(getSectionDefsFromMeta(document.meta)).toHaveLength(1);
});

test('expected result: root text and template tokens persist and instantiate after reopening', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect(getComponentDefsFromMeta(document.meta)).toHaveLength(1);

  await executeHvyCliCommand(document, session, 'hvy insert -1 text /templates/components --id fake-text');
  await executeHvyCliCommand(document, session, `printf 'Hello {% fake_label %}' > /templates/components/fake-text/schema/text.txt`);

  const reopened = deserializeDocument(serializeDocument(document), '.thvy');
  expect(getComponentDefsFromMeta(reopened.meta)[1].text).toBe('Hello {% fake_label %}');
  await executeHvyCliCommand(reopened, createHvyCliSession(), `hvy insert -1 fake-text /body/fake-body --id fake-filled --using-template '{"fake_label":"Fake User"}'`);
  expect(reopened.sections[0].blocks.at(-1)?.text).toBe('Hello Fake User');
  expect(getComponentDefsFromMeta(reopened.meta)[1].text).toBe('Hello {% fake_label %}');
});

test('expected result: section contents and flavors support nested insertion and removal', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect(getSectionDefsFromMeta(document.meta)[0].template.children).toEqual([]);

  await executeHvyCliCommand(document, session, 'hvy insert -1 section /templates/sections/fake-section/template fake-subsection "Fake Subsection"');
  await executeHvyCliCommand(document, session, 'hvy insert -1 text /templates/sections/fake-section/template/fake-subsection --id fake-leaf');
  await executeHvyCliCommand(document, session, 'hvy insert -1 section /templates/sections/fake-section/flavors --id fake-alternate');
  await executeHvyCliCommand(document, session, 'hvy insert -1 text /templates/sections/fake-section/flavors/fake-alternate/template --id fake-leaf');
  await executeHvyCliCommand(document, session, 'hvy remove /templates/sections/fake-section/template/fake-subsection');

  const expectedResult = getSectionDefsFromMeta(deserializeDocument(serializeDocument(document), '.thvy').meta)[0];
  expect(expectedResult.template.children).toEqual([]);
  expect(expectedResult.flavors?.[0].template.blocks[0].schema.id).toBe('fake-leaf');
});

test('expected result: nested copy, move, order, and structure work in template directories', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect(getComponentDefsFromMeta(document.meta)[0].schema?.gridItems).toHaveLength(1);

  await executeHvyCliCommand(document, session, 'cp -r /templates/components/fake-card/schema/grid/fake-label /templates/components/fake-card/schema/grid/fake-copy');
  await executeHvyCliCommand(document, session, 'mv /templates/components/fake-card/schema/grid/fake-copy /templates/components/fake-card/schema/grid/fake-moved');
  await executeHvyCliCommand(document, session, `echo '["fake-moved","fake-label"]' > /templates/components/fake-card/schema/grid/children-order.json`);

  expect((await executeHvyCliCommand(document, session, 'hvy request_structure /templates/components/fake-card/schema')).output).toContain('fake-moved');
  expect(getComponentDefsFromMeta(deserializeDocument(serializeDocument(document), '.thvy').meta)[0].schema?.gridItems.map((item) => item.block.schema.id)).toEqual(['fake-moved', 'fake-label']);
});

test('expected result: distinct names with punctuation get distinct usable directory paths', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();

  await executeHvyCliCommand(document, session, 'hvy insert -1 text /templates/components --id "Fake / Card"');
  await executeHvyCliCommand(document, session, 'hvy insert -1 text /templates/components --id "Fake . Card"');

  expect((await executeHvyCliCommand(document, session, 'ls /templates/components')).output).toContain('Fake%20%2F%20Card');
  expect((await executeHvyCliCommand(document, session, 'cat /templates/components/Fake%20%2E%20Card/definition.json')).output).toContain('Fake . Card');
});

test('expected result: concrete custom components inside definitions retain their ids and edited contents after saving', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect(getSectionDefsFromMeta(document.meta)).toHaveLength(1);

  await executeHvyCliCommand(document, session, 'cp -r /body/fake-body /templates/sections/fake-snapshot');
  await executeHvyCliCommand(document, session, 'printf "Fake snapshot edit" > /templates/sections/fake-snapshot/template/fake-instance/grid/fake-label/text.txt');
  await executeHvyCliCommand(document, session, 'printf "gap: 3rem;" > /templates/sections/fake-snapshot/template/fake-instance/fake-card.css');
  await executeHvyCliCommand(document, session, `echo '{"name":"fake-snapshot","key":"fake-snapshot","repeatable":true,"templateVariables":{"fake_label":{"label":"Fake label"}}}' > /templates/sections/fake-snapshot/definition.json`);

  const expectedResult = getSectionDefsFromMeta(deserializeDocument(serializeDocument(document), '.thvy').meta)[1];
  expect(expectedResult.template.blocks[0].schema.id).toBe('fake-instance');
  expect(expectedResult.template.blocks[0].schema.css).toBe('gap: 3rem;');
  expect(expectedResult.template.blocks[0].schema.gridItems[0].block.text).toBe('Fake snapshot edit');
  expect(expectedResult.templateVariables?.fake_label.label).toBe('Fake label');
  expect(getComponentDefsFromMeta(document.meta)[0].schema?.gridItems[0].block.text).toBe('Fake original');
});

test('expected result: cached template files reflect in-place edits from the owning document', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect((await executeHvyCliCommand(document, session, 'cat /templates/components/fake-card/schema/grid.css')).output).toBe('gap: 1rem;');
  getComponentDefsFromMeta(document.meta)[0].schema!.css = 'gap: 4rem;';

  const expectedResult = await executeHvyCliCommand(document, session, 'cat /templates/components/fake-card/schema/grid.css');

  expect(expectedResult.output).toBe('gap: 4rem;');
});

test('expected result: copying a definition preserves its metadata and independent flavors', async () => {
  const document = templateDocument();
  const session = createHvyCliSession();
  expect(getComponentDefsFromMeta(document.meta)).toHaveLength(1);

  await executeHvyCliCommand(document, session, 'cp -r /templates/components/fake-card /templates/components/fake-definition-copy');
  await executeHvyCliCommand(document, session, `sed -i 's/"gridColumns": 3/"gridColumns": 5/' /templates/components/fake-definition-copy/flavors/fake-flavor/schema/grid.json`);

  const expectedResult = getComponentDefsFromMeta(deserializeDocument(serializeDocument(document), '.thvy').meta);
  expect(expectedResult[0].flavors?.[0].schema?.gridColumns).toBe(3);
  expect(expectedResult[1].flavors?.[0].schema?.gridColumns).toBe(5);
});

test('expected result: URL variable metadata survives serialization and CLI insertion uses text-editor link conversion', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-link
    baseType: text
    templateVariables:
      fake_url:
        label: Fake URL
        type: url
    template:
      text: "[Fake link]({% fake_url %})"
      schema:
        component: text
---
<!--hvy: {"id":"fake-body"}-->
#! Fake Body
`, '.thvy');
  const reopened = deserializeDocument(serializeDocument(document), '.thvy');
  expect(getComponentDefsFromMeta(reopened.meta)[0].templateVariables?.fake_url).toEqual({ label: 'Fake URL', type: 'url' });

  await executeHvyCliCommand(reopened, createHvyCliSession(), `hvy insert -1 fake-link /body/fake-body --id fake-filled --using-template '{"fake_url":"Pub URL"}'`);

  expect(reopened.sections[0].blocks[0].text).toBe('[Fake link](Pub%20URL)');
  expect(deserializeDocument(serializeDocument(reopened), '.hvy').sections[0].blocks[0].text).toBe('[Fake link](Pub%20URL)');
});
