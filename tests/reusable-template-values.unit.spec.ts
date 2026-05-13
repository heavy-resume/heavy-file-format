import { expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import {
  applyReusableTemplateValues,
  extractReusableTemplateVariables,
  extractReusableTemplateVariablesFromDefinition,
  validateReusableTemplateValues,
} from '../src/reusable-template-values';
import type { ComponentDefinition } from '../src/types';

test('extracts reusable template variables in first-seen order with text as the default type', () => {
  const schema = {
    ...defaultBlockSchema('expandable'),
    id: '{% stable_id | text %}',
    expandableStubBlocks: {
      lock: false,
      children: [
        {
          text: '{% title %}',
          schema: {
            ...defaultBlockSchema('text'),
            placeholder: '{% placeholder | text %}',
          },
        },
      ],
    },
    expandableContentBlocks: {
      lock: false,
      children: [
        {
          text: '{% details | block %}',
          schema: defaultBlockSchema('text'),
        },
      ],
    },
  };

  expect(extractReusableTemplateVariables(schema)).toEqual([
    { name: 'stable_id', type: 'text', label: 'Stable Id' },
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'placeholder', type: 'text', label: 'Placeholder' },
    { name: 'details', type: 'block', label: 'Details' },
  ]);
});

test('uses configured labels and humanizes snake and kebab variable names', () => {
  const definition: ComponentDefinition = {
    name: 'history-record',
    baseType: 'container',
    templateVariables: {
      date_range: { label: 'Dates' },
    },
    schema: {
      ...defaultBlockSchema('container'),
      containerBlocks: [
        {
          id: 'field-row',
          text: '{% date_range %}\n{% project-link %}',
          schema: defaultBlockSchema('text'),
          schemaMode: false,
        },
      ],
    },
  };

  expect(extractReusableTemplateVariablesFromDefinition(definition)).toEqual([
    { name: 'date_range', type: 'text', label: 'Dates' },
    { name: 'project-link', type: 'text', label: 'Project Link' },
  ]);
});

test('detects conflicting reusable template variable types', () => {
  expect(() => extractReusableTemplateVariables('{% title | text %}\n{% title | block %}')).toThrow(
    'Template variable "title" uses conflicting types: text and block.'
  );
});

test('substitutes reusable template values recursively and preserves placeholders when values are blank', () => {
  const block = {
    id: 'block-1',
    text: 'Heading: {% title %}',
    schema: {
      ...defaultBlockSchema('table'),
      id: 'item-{% title %}',
      placeholder: 'Title placeholder',
      tableColumns: ['Name', '{% column %}'],
      tableRows: [{ cells: ['{% title %}', '{% details | block %}'] }],
    },
    schemaMode: false,
  };

  applyReusableTemplateValues(block, {
    title: '',
    column: 'Notes',
    details: 'Line one\nLine two',
  });

  expect(block.text).toBe('Heading: ');
  expect(block.schema.id).toBe('item-');
  expect(block.schema.placeholder).toBe('Title placeholder');
  expect(block.schema.tableColumns).toEqual(['Name', 'Notes']);
  expect(block.schema.tableRows).toEqual([{ cells: ['', 'Line one\nLine two'] }]);
});

test('blank template values clear empty markdown scaffolds so placeholders render', () => {
  const block = {
    id: 'block-1',
    text: '',
    schema: {
      ...defaultBlockSchema('expandable'),
      expandableStubBlocks: {
        lock: false,
        children: [
          {
            id: 'stub-title',
            text: '### {% skill %}',
            schema: {
              ...defaultBlockSchema('text'),
              css: 'margin: 0;',
              placeholder: '### Skill name',
            },
            schemaMode: false,
          },
        ],
      },
    },
    schemaMode: false,
  };

  applyReusableTemplateValues(block, { skill: '' });

  expect(block.schema.expandableStubBlocks.children[0]?.text).toBe('');
  expect(block.schema.expandableStubBlocks.children[0]?.schema.placeholder).toBe('### Skill name');
});

test('validates exact template value keys and text newlines', () => {
  const variables = [
    { name: 'title', type: 'text' as const, label: 'Title' },
    { name: 'details', type: 'block' as const, label: 'Details' },
  ];

  expect(() => validateReusableTemplateValues(variables, { title: 'Title' })).toThrow('Missing keys: details');
  expect(() => validateReusableTemplateValues(variables, { title: 'Title', details: '', extra: '' })).toThrow('Extra keys: extra');
  expect(() => validateReusableTemplateValues(variables, { title: 'One\nTwo', details: '' })).toThrow(
    'Template value "title" is type text and cannot contain newlines.'
  );
  expect(() => validateReusableTemplateValues(variables, { title: 'One', details: 'Two\nThree' })).not.toThrow();
});

test('extracts reusable template variables from persisted schema definitions', () => {
  const definition: ComponentDefinition = {
    name: 'skill-record',
    baseType: 'expandable',
    schema: {
      ...defaultBlockSchema('expandable'),
      description: '{% description | block %}',
    },
  };

  expect(extractReusableTemplateVariablesFromDefinition(definition)).toEqual([{ name: 'description', type: 'block', label: 'Description' }]);
});
