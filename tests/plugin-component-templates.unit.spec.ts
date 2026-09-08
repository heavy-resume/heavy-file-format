import { describe, expect, test } from 'vitest';

import { createBlankDocument, defaultBlockSchema } from '../src/document-factory';
import { createPluginComponentTemplatesApi, listComponentTemplates, materializeComponentTemplate } from '../src/plugins/component-templates';
import type { ComponentDefinition } from '../src/types';

function createTemplateDocument() {
  const document = createBlankDocument();
  const definition: ComponentDefinition = {
    name: 'fake-card',
    baseType: 'container',
    description: 'Fake reusable card',
    tags: 'fake, card',
    templateVariables: {
      title: { label: 'Card title' },
      details: { label: 'Details' },
    },
    template: {
      id: 'template-root',
      text: '',
      schemaMode: false,
      schema: {
        ...defaultBlockSchema('container'),
        component: 'fake-card',
        containerTitle: '{% title %}',
        containerBlocks: [{
          id: 'template-details',
          text: '{% details | block %}',
          schema: defaultBlockSchema('text'),
          schemaMode: false,
        }],
      },
    },
    flavors: [{
      name: 'compact',
      description: 'Short fake card',
      templateVariables: { title: { label: 'Short title' } },
      template: {
        id: 'compact-root',
        text: '{% title %}',
        schema: { ...defaultBlockSchema('text'), component: 'fake-card' },
        schemaMode: false,
      },
    }],
  };
  document.meta.component_defs = [definition];
  return { document, definition };
}

describe('plugin component template helpers', () => {
  test('lists document component templates and flavors', () => {
    const { document } = createTemplateDocument();

    expect(listComponentTemplates(document)).toEqual([{
      name: 'fake-card',
      baseType: 'container',
      description: 'Fake reusable card',
      tags: 'fake, card',
      flavors: [{ name: 'compact', description: 'Short fake card' }],
    }]);
  });

  test('materializes a filled clone without changing the definition', () => {
    const { document, definition } = createTemplateDocument();

    const result = materializeComponentTemplate(document, {
      template: 'fake-card',
      values: { title: 'Expected title', details: 'Line one\nLine two' },
    });

    expect(result.id).not.toBe('template-root');
    expect(result.schema.containerTitle).toBe('Expected title');
    expect(result.schema.containerBlocks[0]?.id).not.toBe('template-details');
    expect(result.schema.containerBlocks[0]?.text).toBe('Line one\nLine two');
    expect(definition.template?.schema.containerTitle).toBe('{% title %}');
    expect(definition.template?.schema.containerBlocks[0]?.text).toBe('{% details | block %}');

    const repeatedResult = materializeComponentTemplate(document, {
      template: 'fake-card',
      values: { title: 'Expected title', details: 'Line one\nLine two' },
    });
    expect(repeatedResult.id).not.toBe(result.id);
    expect(repeatedResult.schema.containerBlocks[0]?.id).not.toBe(result.schema.containerBlocks[0]?.id);
  });

  test('uses flavor variables and validates exact value keys', () => {
    const { document } = createTemplateDocument();

    expect(materializeComponentTemplate(document, {
      template: 'fake-card',
      flavor: 'compact',
      values: { title: 'Expected compact title' },
    }).text).toBe('Expected compact title');

    expect(() => materializeComponentTemplate(document, {
      template: 'fake-card',
      flavor: 'compact',
      values: { title: 'Expected', details: 'Unexpected' },
    })).toThrow('Template values must exactly match expected keys');
  });

  test('flavors inherit variable labels from the main template unless overridden', () => {
    const { document, definition } = createTemplateDocument();
    definition.flavors![0]!.templateVariables = undefined;

    const api = createPluginComponentTemplatesApi({
      document,
      section: {} as never,
      sectionKey: 'fake-section',
      helpers: {} as never,
      observeLinks: () => {},
      resolveGenerator: async () => '',
    });

    expect(listComponentTemplates(document)[0]?.flavors).toEqual([{
      name: 'compact',
      description: 'Short fake card',
    }]);
    expect(api.variables({ template: 'fake-card', flavor: 'compact' })).toEqual([{
      name: 'title',
      type: 'text',
      label: 'Card title',
    }]);
    expect(materializeComponentTemplate(document, {
      template: 'fake-card',
      flavor: 'compact',
      values: { title: '' },
    }).text).toBe('');
  });
});
