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

  test('discovers named locations and substitutes fresh component clones', () => {
    const { document, definition } = createTemplateDocument();
    const firstMarker = {
      id: 'template-actions-one',
      text: '',
      schema: { ...defaultBlockSchema('location-marker'), locationMarkerName: 'actions' },
      schemaMode: false,
    };
    const secondMarker = {
      id: 'template-actions-two',
      text: '',
      schema: { ...defaultBlockSchema('location-marker'), locationMarkerName: 'actions' },
      schemaMode: false,
    };
    definition.template!.schema.containerBlocks.push(firstMarker, secondMarker);
    const replacement = {
      id: 'plugin-action',
      text: 'Run action',
      schema: defaultBlockSchema('text'),
      schemaMode: false,
    };
    const api = createPluginComponentTemplatesApi({
      document,
      section: {} as never,
      sectionKey: 'fake-section',
      helpers: {} as never,
      observeLinks: () => {},
      resolveGenerator: async () => '',
    });

    expect(api.locations({ template: 'fake-card' })).toEqual(['actions']);
    const result = api.materialize({
      template: 'fake-card',
      values: { title: 'Expected title', details: 'Expected details' },
      locations: { actions: replacement },
    });
    const inserted = result.schema.containerBlocks.slice(-2);
    expect(inserted.map((block) => block.text)).toEqual(['Run action', 'Run action']);
    expect(inserted[0]?.id).not.toBe('plugin-action');
    expect(inserted[1]?.id).not.toBe('plugin-action');
    expect(inserted[0]?.id).not.toBe(inserted[1]?.id);
    expect(definition.template!.schema.containerBlocks.slice(-2)).toEqual([firstMarker, secondMarker]);
  });

  test('uses flavor-specific location markers', () => {
    const { document, definition } = createTemplateDocument();
    definition.flavors![0]!.template = {
      id: 'compact-root',
      text: '',
      schema: {
        ...defaultBlockSchema('container'),
        component: 'fake-card',
        containerBlocks: [{
          id: 'compact-footer',
          text: '',
          schema: { ...defaultBlockSchema('location-marker'), locationMarkerName: 'footer' },
          schemaMode: false,
        }],
      },
      schemaMode: false,
    };
    const api = createPluginComponentTemplatesApi({
      document,
      section: {} as never,
      sectionKey: 'fake-section',
      helpers: {} as never,
      observeLinks: () => {},
      resolveGenerator: async () => '',
    });

    expect(api.locations({ template: 'fake-card' })).toEqual([]);
    expect(api.locations({ template: 'fake-card', flavor: 'compact' })).toEqual(['footer']);
  });
});
