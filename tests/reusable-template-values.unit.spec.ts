import { expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import {
  applyReusableSectionTemplateValues,
  applyReusableTemplateValues,
  extractReusableTemplateVariables,
  extractReusableTemplateVariablesFromSectionDefinition,
  extractReusableTemplateVariablesFromDefinition,
  validateReusableTemplateValues,
} from '../src/reusable-template-values';
import type { ComponentDefinition, SectionDefinition } from '../src/types';

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

test('preserves reusable template variable output generator metadata', () => {
  const definition: ComponentDefinition = {
    name: 'skill-record',
    baseType: 'expandable',
    templateVariables: {
      skill: { label: 'Skill' },
      description: {
        label: 'Description',
        generator: 'dev.hvy.resume.skill-description',
        generatorLabel: 'Suggest',
      },
    },
    schema: {
      ...defaultBlockSchema('expandable'),
      xrefTitle: '{% skill %}',
      expandableContentBlocks: {
        lock: false,
        children: [
          {
            id: 'description',
            text: '{% description | block %}',
            schema: defaultBlockSchema('text'),
            schemaMode: false,
          },
        ],
      },
    },
  };

  expect(extractReusableTemplateVariablesFromDefinition(definition)).toEqual([
    { name: 'skill', type: 'text', label: 'Skill' },
    {
      name: 'description',
      type: 'block',
      label: 'Description',
      generator: 'dev.hvy.resume.skill-description',
      generatorLabel: 'Suggest',
    },
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

test('substitutes reusable section template values through section fields and nested rows', () => {
  const definition: SectionDefinition = {
    name: 'Resume Section',
    key: 'resume-section',
    repeatable: true,
    templateVariables: {
      section_title: { label: 'Section title' },
      row_label: { label: 'Row label' },
      row_summary: { label: 'Row summary' },
      row_details: { label: 'Row details' },
    },
    template: {
      key: 'section-1',
      customId: '',
      contained: true,
      editorOnly: false,
      lock: true,
      idEditorOpen: false,
      isGhost: false,
      title: 'Resume Section',
      level: 1,
      expanded: true,
      highlight: false,
      priority: false,
      css: '',
      tags: '',
      description: '',
      location: 'main',
      hideIfUnmodified: true,
      templateKey: undefined,
      blocks: [
        {
          id: 'section-title',
          text: '# {% section_title %}',
          schema: defaultBlockSchema('text'),
          schemaMode: false,
        },
        {
          id: 'rows',
          text: '',
          schema: {
            ...defaultBlockSchema('component-list'),
            componentListBlocks: [
              {
                id: 'row',
                text: '',
                schema: {
                  ...defaultBlockSchema('expandable'),
                  expandableStubBlocks: {
                    lock: false,
                    children: [
                      {
                        id: 'stub',
                        text: '',
                        schema: {
                          ...defaultBlockSchema('table'),
                          tableRows: [{ cells: ['{% row_label %}', '{% row_summary %}'] }],
                        },
                        schemaMode: false,
                      },
                    ],
                  },
                  expandableContentBlocks: {
                    lock: false,
                    children: [
                      {
                        id: 'details',
                        text: '{% row_details | block %}',
                        schema: defaultBlockSchema('text'),
                        schemaMode: false,
                      },
                    ],
                  },
                },
                schemaMode: false,
              },
            ],
          },
          schemaMode: false,
        },
      ],
      children: [],
    },
  };

  const variables = extractReusableTemplateVariablesFromSectionDefinition(definition);
  const section = applyReusableSectionTemplateValues(definition.template, {
    section_title: 'Awards',
    row_label: 'Best Paper',
    row_summary: '2024',
    row_details: 'Presented at the annual conference.',
  }, variables);

  expect(variables.map((variable) => variable.name)).toEqual(['section_title', 'row_label', 'row_summary', 'row_details']);
  expect(section.blocks[0]?.text).toBe('# Awards');
  expect(section.blocks[1]?.schema.componentListBlocks[0]?.schema.expandableStubBlocks.children[0]?.schema.tableRows[0]?.cells).toEqual(['Best Paper', '2024']);
  expect(section.blocks[1]?.schema.componentListBlocks[0]?.schema.expandableContentBlocks.children[0]?.text).toBe('Presented at the annual conference.');
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

  expect(block.schema.expandableStubBlocks.children[0]?.text).toBe('### <!-- value {"placeholder":"Skill"} -->');
  expect(block.schema.expandableStubBlocks.children[0]?.schema.fillIn).toBe(true);
  expect(block.schema.expandableStubBlocks.children[0]?.schema.placeholder).toBe('');
});

test('blank template values become fill-ins only in text block bodies', () => {
  const block = {
    id: 'block-1',
    text: '',
    schema: {
      ...defaultBlockSchema('container'),
      containerBlocks: [
        {
          id: 'title-block',
          text: '{% title %}',
          schema: {
            ...defaultBlockSchema('text'),
            id: 'title-{% title %}',
            placeholder: 'Title placeholder',
          },
          schemaMode: false,
        },
        {
          id: 'table-block',
          text: '',
          schema: {
            ...defaultBlockSchema('table'),
            tableRows: [{ cells: ['{% title %}'] }],
          },
          schemaMode: false,
        },
      ],
    },
    schemaMode: false,
  };

  applyReusableTemplateValues(block, { title: '' });

  expect(block.schema.containerBlocks[0]?.text).toBe('<!-- value {"placeholder":"Title"} -->');
  expect(block.schema.containerBlocks[0]?.schema.fillIn).toBe(true);
  expect(block.schema.containerBlocks[0]?.schema.placeholder).toBe('');
  expect(block.schema.containerBlocks[0]?.schema.id).toBe('title-');
  expect(block.schema.containerBlocks[1]?.schema.tableRows).toEqual([{ cells: [''] }]);
});

test('blank template value fill-ins preserve the labels shown to the user', () => {
  const block = {
    id: 'block-1',
    text: '',
    schema: {
      ...defaultBlockSchema('expandable'),
      expandableContentBlocks: {
        lock: false,
        children: [
          {
            id: 'details-block',
            text: [
              '^detail-heading^ #### Description',
              '^detail-body^ {% description | block %}',
              '^detail-heading^ #### Notes',
              '^detail-body^ {% notes | block %}',
            ].join('\n'),
            schema: {
              ...defaultBlockSchema('text'),
              placeholder: 'Description and notes',
            },
            schemaMode: false,
          },
        ],
      },
    },
    schemaMode: false,
  };

  applyReusableTemplateValues(
    block,
    { description: '', notes: '' },
    [
      { name: 'description', type: 'block', label: 'Description' },
      { name: 'notes', type: 'block', label: 'Notes' },
    ]
  );

  const detailsBlock = block.schema.expandableContentBlocks.children[0];
  expect(detailsBlock?.text).toContain('^detail-body^ <!-- value {"placeholder":"Description"} -->');
  expect(detailsBlock?.text).toContain('^detail-body^ <!-- value {"placeholder":"Notes"} -->');
  expect(detailsBlock?.schema.fillIn).toBe(true);
  expect(detailsBlock?.schema.placeholder).toBe('');
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
