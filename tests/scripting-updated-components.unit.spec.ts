import { expect, test, vi } from 'vitest';

import { createScriptingRuntime } from '../src/plugins/scripting/runtime';
import { captureScriptingComponentFingerprints, markScriptingSortValuesSynced } from '../src/plugins/scripting/updated-components';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import type { VisualDocument } from '../src/types';

const fakeSource = `---
hvy_version: 0.1
component_defs:
  - name: fake-card
    baseType: container
    description: Fake card
    schema:
      css: "margin: 0;"
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:text {"id":"fake-picks"}-->
none

<!--hvy:container {"id":"fake-parent"}-->
 <!--hvy:text {"id":"fake-child"}-->
  Fake child

<!--hvy:fake-card {"id":"fake-card-a"}-->
 <!--hvy:text {"id":"fake-card-text"}-->
  Fake card text

<!--hvy:text {"id":"fake-untouched"}-->
Fake untouched
`;

interface ExpectedHandle { id: string; removed: boolean }

function findText(document: VisualDocument, id: string) {
  const visit = (blocks: VisualDocument['sections'][number]['blocks']): VisualDocument['sections'][number]['blocks'][number] | null => {
    for (const block of blocks) {
      if (block.schema.id === id) return block;
      const nested = visit(block.schema.containerBlocks ?? []);
      if (nested) return nested;
    }
    return null;
  };
  return visit(document.sections[0]!.blocks)!;
}

// Runs the comparison both ways from the same before and after, returning each result.
function compareBothWays(edit: (document: VisualDocument) => void, component = '') {
  const document = deserializeDocument(fakeSource, '.hvy');
  const snapshot = serializeDocument(document);
  markScriptingSortValuesSynced(document);
  const fingerprints = captureScriptingComponentFingerprints(document);
  edit(document);
  const read = (runtime: ReturnType<typeof createScriptingRuntime>) => (runtime.doc.tool('get_updated_components', { component }) as ExpectedHandle[])
    .map((handle) => ({ id: handle.id, removed: handle.removed }));
  const loadDocument = vi.fn(() => deserializeDocument(snapshot, '.hvy'));
  const fromFingerprints = read(createScriptingRuntime({ document, changeReason: 'script-edit', previousComponents: { fingerprints, loadDocument } }));
  const fromFullComparison = read(createScriptingRuntime({
    document,
    changeReason: 'script-edit',
    previousComponents: { fingerprints: null, loadDocument: () => deserializeDocument(snapshot, '.hvy') },
  }));
  return { fromFingerprints, fromFullComparison, loadDocument };
}

test('no change reports nothing, without loading the previous document', () => {
  const { fromFingerprints, fromFullComparison, loadDocument } = compareBothWays(() => {});

  expect(fromFingerprints).toEqual([]);
  expect(fromFingerprints).toEqual(fromFullComparison);
  expect(loadDocument).not.toHaveBeenCalled();
});

test('a text edit reports only that component, without loading the previous document', () => {
  const { fromFingerprints, fromFullComparison, loadDocument } = compareBothWays((document) => {
    findText(document, 'fake-picks').text = 'changed';
  });

  expect(fromFingerprints).toEqual([{ id: 'fake-picks', removed: false }]);
  expect(fromFingerprints).toEqual(fromFullComparison);
  expect(loadDocument).not.toHaveBeenCalled();
});

test('a nested edit also reports its parent', () => {
  const { fromFingerprints, fromFullComparison } = compareBothWays((document) => {
    findText(document, 'fake-child').text = 'changed';
  });

  expect(fromFingerprints).toEqual([{ id: 'fake-parent', removed: false }, { id: 'fake-child', removed: false }]);
  expect(fromFingerprints).toEqual(fromFullComparison);
});

test('setting the same value reports nothing', () => {
  const { fromFingerprints, fromFullComparison } = compareBothWays((document) => {
    const block = findText(document, 'fake-picks');
    block.text = `${block.text}`;
  });

  expect(fromFingerprints).toEqual([]);
  expect(fromFingerprints).toEqual(fromFullComparison);
});

test('a schema edit is reported', () => {
  const { fromFingerprints, fromFullComparison } = compareBothWays((document) => {
    findText(document, 'fake-untouched').schema.css = 'color: red;';
  });

  expect(fromFingerprints).toEqual([{ id: 'fake-untouched', removed: false }]);
  expect(fromFingerprints).toEqual(fromFullComparison);
});

test('a removed component is reported as removed, loading the previous document only then', () => {
  const { fromFingerprints, fromFullComparison, loadDocument } = compareBothWays((document) => {
    const blocks = document.sections[0]!.blocks;
    blocks.splice(blocks.findIndex((block) => block.schema.id === 'fake-untouched'), 1);
  });

  expect(fromFingerprints).toEqual([{ id: 'fake-untouched', removed: true }]);
  expect(fromFingerprints).toEqual(fromFullComparison);
  expect(loadDocument).toHaveBeenCalledOnce();
});

test('an added component is reported', () => {
  const { fromFingerprints, fromFullComparison } = compareBothWays((document) => {
    const added = deserializeDocument(fakeSource, '.hvy').sections[0]!.blocks.at(-1)!;
    added.schema.id = 'fake-added';
    document.sections[0]!.blocks.push(added);
  });

  expect(fromFingerprints).toEqual([{ id: 'fake-added', removed: false }]);
  expect(fromFingerprints).toEqual(fromFullComparison);
});

test('a component filter applies to changed and removed components, including template base types', () => {
  const edit = (document: VisualDocument) => {
    findText(document, 'fake-picks').text = 'changed';
    findText(document, 'fake-card-text').text = 'changed';
    const blocks = document.sections[0]!.blocks;
    blocks.splice(blocks.findIndex((block) => block.schema.id === 'fake-parent'), 1);
  };

  const filteredByBase = compareBothWays(edit, 'container');
  const filteredByTemplate = compareBothWays(edit, 'fake-card');

  expect(filteredByBase.fromFingerprints).toEqual([{ id: 'fake-card-a', removed: false }, { id: 'fake-parent', removed: true }]);
  expect(filteredByBase.fromFingerprints).toEqual(filteredByBase.fromFullComparison);
  expect(filteredByTemplate.fromFingerprints).toEqual([{ id: 'fake-card-a', removed: false }]);
  expect(filteredByTemplate.fromFingerprints).toEqual(filteredByTemplate.fromFullComparison);
});

test('fingerprints are not captured before the document has been through a sort value sync', () => {
  const document = deserializeDocument(fakeSource, '.hvy');

  expect(captureScriptingComponentFingerprints(document)).toBeNull();

  markScriptingSortValuesSynced(document);
  expect(captureScriptingComponentFingerprints(document)).not.toBeNull();
});

test('without a previous state every matching component is reported', () => {
  const document = deserializeDocument(fakeSource, '.hvy');

  const expectedResult = createScriptingRuntime({ document, changeReason: 'script-edit' }).doc.tool('get_updated_components', { component: 'text' }) as ExpectedHandle[];

  expect(expectedResult.map((handle) => handle.id)).toEqual(['fake-picks', 'fake-child', 'fake-card-text', 'fake-untouched']);
});
