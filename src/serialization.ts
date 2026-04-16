import { stringify as stringifyYaml } from 'yaml';
import type { BlockSchema, GridItem, TableRow, VisualBlock, VisualSection } from './editor/types';
import type { HvySection, JsonObject } from './hvy/types';
import { parseHvy } from './hvy/parser';
import type { VisualDocument } from './types';
import { makeId, sanitizeOptionalId } from './utils';
import { getSectionId } from './section-ops';
import { resolveBaseComponent, isBuiltinComponentName } from './component-defs';
import {
  defaultBlockSchema,
  schemaFromUnknown,
  parseVisualBlock,
  createEmptyBlock,
  coerceAlign,
  coerceSlot,
} from './document-factory';
import { coerceGridColumn, coerceGridColumns } from './grid-ops';

export function deserializeDocument(text: string, extension: VisualDocument['extension']): VisualDocument {
  const parsed = parseHvy(text, extension);
  const meta = { ...parsed.meta };
  if (typeof meta.hvy_version === 'undefined') {
    meta.hvy_version = 0.1;
  }

  return {
    extension,
    meta,
    sections: parsed.sections.map((section) => mapParsedSection(section, meta)),
  };
}

function mapParsedSection(section: HvySection, documentMeta: JsonObject): VisualSection {
  const sectionMeta = section.meta as JsonObject;
  const customId = sanitizeOptionalId(typeof sectionMeta.id === 'string' ? sectionMeta.id : section.id);
  const blocks = parseBlocks(section.contentMarkdown, sectionMeta, documentMeta);

  return {
    key: makeId('section'),
    customId,
    lock: sectionMeta.lock === true,
    idEditorOpen: false,
    isGhost: false,
    title: section.title || 'Untitled Section',
    level: section.level,
    expanded: sectionMeta.expanded === false ? false : true,
    highlight: sectionMeta.highlight === true,
    customCss: typeof sectionMeta.custom_css === 'string' ? sectionMeta.custom_css : '',
    blocks,
    children: section.children.map((child) => mapParsedSection(child, documentMeta)),
  };
}

function parseBlocks(contentMarkdown: string, sectionMeta: JsonObject, documentMeta: JsonObject): VisualBlock[] {
  const schemas = Array.isArray(sectionMeta.blocks) ? (sectionMeta.blocks as JsonObject[]) : [];
  const lines = contentMarkdown.split(/\r?\n/);
  const directivePattern = /^<!--hvy:([a-z][a-z0-9-]*(?::\d+)*)\s*(\{.*\})\s*-->$/i;

  type BlockAttach =
    | { kind: 'top' }
    | { kind: 'expandable'; parent: VisualBlock; part: 0 | 1 }
    | { kind: 'grid'; parent: VisualBlock; meta: JsonObject }
    | { kind: 'component-list'; parent: VisualBlock }
    | { kind: 'container'; parent: VisualBlock }
    | { kind: 'table-details'; parent: VisualBlock; rowIndex: number };
  type StructuredFrame = {
    block: VisualBlock;
    attach: BlockAttach;
  };

  const blocks: VisualBlock[] = [];
  const frames: StructuredFrame[] = [];
  let currentText: string[] = [];
  let currentSchema: BlockSchema = defaultBlockSchema();
  let currentAttach: BlockAttach = { kind: 'top' };
  let currentHasDirective = false;

  const resolveParsedBase = (componentName: string): string => {
    if (isBuiltinComponentName(componentName)) {
      return componentName;
    }
    const defs = Array.isArray(documentMeta.component_defs) ? (documentMeta.component_defs as JsonObject[]) : [];
    const def = defs.find((item) => item && typeof item.name === 'string' && item.name === componentName);
    return typeof def?.baseType === 'string' ? def.baseType : 'text';
  };

  const flush = (): void => {
    if (!currentHasDirective && currentText.length === 0) {
      return;
    }
    if (!currentHasDirective && currentText.join('\n').trim().length === 0) {
      currentText = [];
      return;
    }
    const block: VisualBlock = {
      id: makeId('block'),
      text: currentText.join('\n').trim(),
      schema: currentSchema,
      schemaMode: false,
    };
    attachBlock(block, currentAttach);
    currentText = [];
    currentSchema = defaultBlockSchema();
    currentAttach = { kind: 'top' };
    currentHasDirective = false;
  };

  const closeFrame = (): void => {
    flush();
    const frame = frames.pop();
    if (frame) {
      attachBlock(frame.block, frame.attach);
    }
  };

  const closeFramesUntil = (parentBase: string | null): VisualBlock | undefined => {
    flush();
    if (!parentBase) {
      while (frames.length > 0) {
        closeFrame();
      }
      return undefined;
    }
    while (frames.length > 0 && resolveParsedBase(frames[frames.length - 1].block.schema.component) !== parentBase) {
      closeFrame();
    }
    return frames[frames.length - 1]?.block;
  };

  const findOrCreateParentFrame = (parentBase: 'expandable' | 'grid' | 'component-list' | 'container' | 'table'): VisualBlock => {
    const parent = closeFramesUntil(parentBase);
    if (parent) {
      return parent;
    }
    const fallback = createEmptyBlock(parentBase, true);
    frames.push({
      block: fallback,
      attach: { kind: 'top' },
    });
    return fallback;
  };

  const attachBlock = (block: VisualBlock, attach: BlockAttach): void => {
    if (attach.kind === 'expandable') {
      if (attach.part === 0) {
        attach.parent.schema.expandableStubBlocks.push(block);
      } else {
        attach.parent.schema.expandableContentBlocks.push(block);
      }
      return;
    }
    if (attach.kind === 'grid') {
      const index = attach.parent.schema.gridItems.length;
      attach.parent.schema.gridItems.push({
        id: typeof attach.meta.id === 'string' ? attach.meta.id : makeId('griditem'),
        column: coerceGridColumn(attach.meta.column ?? index, attach.parent.schema.gridColumns),
        block,
      });
      return;
    }
    if (attach.kind === 'component-list') {
      attach.parent.schema.componentListBlocks.push(block);
      return;
    }
    if (attach.kind === 'container') {
      attach.parent.schema.containerBlocks.push(block);
      return;
    }
    if (attach.kind === 'table-details') {
      const row = attach.parent.schema.tableRows[attach.rowIndex];
      if (row) {
        row.detailsBlocks.push(block);
      }
      return;
    }
    blocks.push(block);
  };

  const openOrQueueBlock = (schema: BlockSchema, attach: BlockAttach): void => {
    const base = resolveParsedBase(schema.component);
    if (base === 'expandable') {
      schema.expandableStubBlocks = [];
      schema.expandableContentBlocks = [];
    } else if (base === 'grid') {
      schema.gridItems = [];
    } else if (base === 'component-list') {
      schema.componentListBlocks = [];
    } else if (base === 'container') {
      schema.containerBlocks = [];
    } else if (base === 'table') {
      schema.tableRows.forEach((row) => {
        row.detailsBlocks = [];
      });
    } else {
      currentSchema = schema;
      currentAttach = attach;
      currentHasDirective = true;
      return;
    }

    frames.push({
      block: {
        id: makeId('block'),
        text: '',
        schema,
        schemaMode: false,
      },
      attach,
    });
  };

  lines.forEach((line) => {
    const match = line.trim().match(directivePattern);
    if (!match) {
      currentText.push(line);
      return;
    }

    const directive = (match[1] ?? 'block').toLowerCase();
    const [name, ...rawParts] = directive.split(':');
    const indexes = rawParts.map((part) => Number.parseInt(part, 10));
    const allIndexesValid = indexes.every((index) => Number.isFinite(index));

    try {
      const parsed = JSON.parse(match[2] ?? '{}') as JsonObject;
      if (rawParts.length > 0 && !allIndexesValid) {
        return;
      }

      if (name === 'expandable' && indexes.length === 1) {
        const parent = findOrCreateParentFrame('expandable');
        const part = indexes[0] === 0 ? 0 : 1;
        const schema = schemaFromUnknown(parsed);
        openOrQueueBlock(schema, { kind: 'expandable', parent, part });
      } else if (name === 'grid' && indexes.length === 1) {
        const parent = findOrCreateParentFrame('grid');
        const schema = schemaFromUnknown({
          ...parsed,
          component: typeof parsed.component === 'string' ? parsed.component : typeof parsed.type === 'string' ? parsed.type : 'text',
        });
        openOrQueueBlock(schema, { kind: 'grid', parent, meta: parsed });
      } else if (name === 'component-list' && indexes.length === 1) {
        const parent = findOrCreateParentFrame('component-list');
        const schema = schemaFromUnknown({
          ...parsed,
          component: typeof parsed.component === 'string' ? parsed.component : typeof parsed.type === 'string' ? parsed.type : parent.schema.componentListComponent,
        });
        openOrQueueBlock(schema, { kind: 'component-list', parent });
      } else if (name === 'container' && indexes.length === 1) {
        const parent = findOrCreateParentFrame('container');
        const schema = schemaFromUnknown({
          ...parsed,
          component: typeof parsed.component === 'string' ? parsed.component : typeof parsed.type === 'string' ? parsed.type : 'text',
        });
        openOrQueueBlock(schema, { kind: 'container', parent });
      } else if (name === 'table' && indexes.length === 2) {
        const parent = findOrCreateParentFrame('table');
        const schema = schemaFromUnknown({
          ...parsed,
          component: typeof parsed.component === 'string' ? parsed.component : typeof parsed.type === 'string' ? parsed.type : 'container',
        });
        openOrQueueBlock(schema, { kind: 'table-details', parent, rowIndex: indexes[0] });
      } else {
        closeFramesUntil(null);
        if (directive === 'block') {
          openOrQueueBlock(schemaFromUnknown(parsed), { kind: 'top' });
        } else {
          openOrQueueBlock(schemaFromUnknown({ ...parsed, component: directive }), { kind: 'top' });
        }
      }
    } catch {
      currentSchema = defaultBlockSchema();
      currentAttach = { kind: 'top' };
      currentHasDirective = false;
    }
  });

  flush();
  while (frames.length > 0) {
    closeFrame();
  }

  if (blocks.length === 0) {
    return [];
  }

  return blocks.map((block, index) => ({
    ...block,
    schema: schemaFromUnknown(schemas[index] ?? block.schema),
  }));
}

export function serializeDocument(document: VisualDocument): string {
  const serializedMeta = stripEditorStateFromSerializedValue(document.meta) as JsonObject;
  const headerMeta = {
    ...serializedMeta,
    hvy_version: document.meta.hvy_version ?? 0.1,
  };
  const frontMatter = `---\n${stringifyYaml(headerMeta).trim()}\n---\n`;
  const body = document.sections
    .filter((section) => !section.isGhost)
    .map((section) => serializeSection(section, 1))
    .join('\n')
    .trim();
  return `${frontMatter}\n${body}\n`;
}

function stripEditorStateFromSerializedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripEditorStateFromSerializedValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const cleaned: JsonObject = {};
  Object.entries(value as JsonObject).forEach(([key, item]) => {
    if (key === 'schemaMode') {
      return;
    }
    cleaned[key] = stripEditorStateFromSerializedValue(item) as JsonObject[keyof JsonObject];
  });
  return cleaned;
}

function serializeSection(section: VisualSection, level: number): string {
  const heading = `${'#'.repeat(Math.max(1, Math.min(level, 6)))} ${section.title}`;
  const meta: JsonObject = {
    id: getSectionId(section),
    lock: section.lock,
    expanded: section.expanded,
    highlight: section.highlight,
  };
  if (section.customCss.trim().length > 0) {
    meta.custom_css = section.customCss;
  }

  const directive = `<!--hvy: ${JSON.stringify(meta)}-->`;

  const blockText = section.blocks
    .map((block) => serializeBlock(block))
    .join('\n\n');

  const children = section.children
    .filter((child) => !child.isGhost)
    .map((child) => serializeSection(child, level + 1))
    .join('\n\n');

  return `${heading}\n${directive}\n\n${blockText}${children ? `\n\n${children}` : ''}`;
}

function serializeBlockSchema(
  schema: BlockSchema,
  options: {
    omitComponent?: boolean;
    omitContainerBlocks?: boolean;
    omitComponentListBlocks?: boolean;
    omitExpandableBlocks?: boolean;
    omitGridItems?: boolean;
    omitTableDetailsBlocks?: boolean;
  } = {}
): JsonObject {
  const component = resolveBaseComponent(schema.component);
  const defaults = defaultBlockSchema(component);
  const payload: JsonObject = {};

  addIfChanged(payload, 'id', schema.id, defaults.id);
  if (!options.omitComponent) {
    payload.component = schema.component;
  }
  addIfChanged(payload, 'lock', schema.lock, defaults.lock);
  addIfChanged(payload, 'align', schema.align, defaults.align);
  addIfChanged(payload, 'slot', schema.slot, defaults.slot);
  addIfChanged(payload, 'css', schema.customCss, defaults.customCss);
  addIfChanged(payload, 'tags', schema.tags, defaults.tags);
  addIfChanged(payload, 'description', schema.description, defaults.description);

  if (component === 'xref-card') {
    addIfChanged(payload, 'xrefTitle', schema.xrefTitle, defaults.xrefTitle);
    addIfChanged(payload, 'xrefDetail', schema.xrefDetail, defaults.xrefDetail);
    addIfChanged(payload, 'xrefTarget', schema.xrefTarget, defaults.xrefTarget);
  }
  if (component === 'code') {
    addIfChanged(payload, 'codeLanguage', schema.codeLanguage, defaults.codeLanguage);
  }
  if (component === 'container') {
    addIfChanged(payload, 'containerTitle', schema.containerTitle, defaults.containerTitle);
    if (!options.omitContainerBlocks) {
      addBlockArrayIfPresent(payload, 'containerBlocks', schema.containerBlocks);
    }
  }
  if (component === 'component-list') {
    addIfChanged(payload, 'componentListComponent', schema.componentListComponent, defaults.componentListComponent);
    if (!options.omitComponentListBlocks) {
      addBlockArrayIfPresent(payload, 'componentListBlocks', schema.componentListBlocks);
    }
  }
  if (component === 'grid') {
    addIfChanged(payload, 'gridColumns', schema.gridColumns, defaults.gridColumns);
    if (!options.omitGridItems && schema.gridItems.length > 0) {
      payload.gridItems = schema.gridItems.map((item) => ({
        id: item.id,
        column: item.column,
        block: serializeVisualBlock(item.block),
      }));
    }
  }
  if (component === 'plugin') {
    addIfChanged(payload, 'pluginUrl', schema.pluginUrl, defaults.pluginUrl);
  }
  if (component === 'expandable') {
    addIfChanged(payload, 'expandableAlwaysShowStub', schema.expandableAlwaysShowStub, defaults.expandableAlwaysShowStub);
    addIfChanged(payload, 'expandableExpanded', schema.expandableExpanded, defaults.expandableExpanded);
    if (!options.omitExpandableBlocks) {
      addBlockArrayIfPresent(payload, 'expandableStubBlocks', schema.expandableStubBlocks);
      addBlockArrayIfPresent(payload, 'expandableContentBlocks', schema.expandableContentBlocks);
    }
  }
  if (component === 'table') {
    addIfChanged(payload, 'tableColumns', schema.tableColumns, defaults.tableColumns);
    addIfChanged(payload, 'tableShowHeader', schema.tableShowHeader, defaults.tableShowHeader);
    if (schema.tableRows.length > 0) {
      payload.tableRows = schema.tableRows.map((row) => serializeTableRow(row, options));
    }
  }

  return payload;
}

function serializeBlock(
  block: VisualBlock,
  override?: { name: string; schema?: JsonObject }
): string {
  const blockDirective = override ?? serializeBlockDirective(block.schema);
  const schemaDirective = `<!--hvy:${blockDirective.name} ${JSON.stringify(blockDirective.schema)}-->`;
  const nested = serializeNestedBlocks(block);
  const text = block.text.trim();
  return [schemaDirective, text, nested].filter((part) => part.length > 0).join('\n');
}

function serializeBlockDirective(schema: BlockSchema): { name: string; schema: JsonObject } {
  const component = schema.component.trim();
  if (/^[a-z][a-z0-9-]*$/i.test(component) && !['block', 'doc', 'css', 'subsection'].includes(component)) {
    return {
      name: component,
      schema: serializeBlockSchema(schema, { omitComponent: true, ...nestedBlockOmitOptions(schema) }),
    };
  }
  return {
    name: 'block',
    schema: serializeBlockSchema(schema, nestedBlockOmitOptions(schema)),
  };
}

function serializeExpandablePartBlock(block: VisualBlock, part: 0 | 1): string {
  return serializeBlock(block, {
    name: `expandable:${part}`,
    schema: serializeBlockSchema(block.schema, nestedBlockOmitOptions(block.schema)),
  });
}

function serializeGridItemBlock(item: GridItem, index: number): string {
  const schema = serializeBlockSchema(item.block.schema, nestedBlockOmitOptions(item.block.schema));
  schema.id = item.id;
  schema.column = item.column;
  return serializeBlock(item.block, {
    name: `grid:${index}`,
    schema,
  });
}

function serializeComponentListItemBlock(block: VisualBlock, index: number): string {
  return serializeBlock(block, {
    name: `component-list:${index}`,
    schema: serializeBlockSchema(block.schema, nestedBlockOmitOptions(block.schema)),
  });
}

function serializeContainerItemBlock(block: VisualBlock, index: number): string {
  return serializeBlock(block, {
    name: `container:${index}`,
    schema: serializeBlockSchema(block.schema, nestedBlockOmitOptions(block.schema)),
  });
}

function serializeTableDetailBlock(block: VisualBlock, rowIndex: number, detailIndex: number): string {
  return serializeBlock(block, {
    name: `table:${rowIndex}:${detailIndex}`,
    schema: serializeBlockSchema(block.schema, nestedBlockOmitOptions(block.schema)),
  });
}

function serializeNestedBlocks(block: VisualBlock): string {
  const component = resolveBaseComponent(block.schema.component);
  if (component === 'expandable') {
    const stubText = block.schema.expandableStubBlocks
      .map((innerBlock) => serializeExpandablePartBlock(innerBlock, 0))
      .join('\n\n');
    const contentText = block.schema.expandableContentBlocks
      .map((innerBlock) => serializeExpandablePartBlock(innerBlock, 1))
      .join('\n\n');
    return [stubText, contentText].filter((part) => part.length > 0).join('\n\n');
  }
  if (component === 'grid') {
    return block.schema.gridItems.map((item, index) => serializeGridItemBlock(item, index)).join('\n\n');
  }
  if (component === 'component-list') {
    return block.schema.componentListBlocks
      .map((innerBlock, index) => serializeComponentListItemBlock(innerBlock, index))
      .join('\n\n');
  }
  if (component === 'container') {
    return block.schema.containerBlocks.map((innerBlock, index) => serializeContainerItemBlock(innerBlock, index)).join('\n\n');
  }
  if (component === 'table') {
    return block.schema.tableRows
      .flatMap((row, rowIndex) =>
        (row.detailsBlocks ?? []).map((innerBlock, detailIndex) => serializeTableDetailBlock(innerBlock, rowIndex, detailIndex))
      )
      .join('\n\n');
  }
  return '';
}

function nestedBlockOmitOptions(schema: BlockSchema): Parameters<typeof serializeBlockSchema>[1] {
  const component = resolveBaseComponent(schema.component);
  return {
    omitContainerBlocks: component === 'container',
    omitComponentListBlocks: component === 'component-list',
    omitExpandableBlocks: component === 'expandable',
    omitGridItems: component === 'grid',
    omitTableDetailsBlocks: component === 'table',
  };
}

function serializeVisualBlock(block: VisualBlock): JsonObject {
  return {
    text: block.text,
    schema: serializeBlockSchema(block.schema),
  };
}

function serializeTableRow(row: TableRow, options: { omitTableDetailsBlocks?: boolean } = {}): JsonObject {
  const serialized: JsonObject = { cells: row.cells };
  addIfChanged(serialized, 'expanded', row.expanded, false);
  addIfChanged(serialized, 'clickable', row.clickable, true);
  addIfChanged(serialized, 'detailsTitle', row.detailsTitle, '');
  addIfChanged(serialized, 'detailsContent', row.detailsContent, '');
  if (!options.omitTableDetailsBlocks) {
    addBlockArrayIfPresent(serialized, 'detailsBlocks', row.detailsBlocks);
  }
  return serialized;
}

function addBlockArrayIfPresent(payload: JsonObject, key: string, blocks: VisualBlock[]): void {
  if (blocks.length === 0) {
    return;
  }
  payload[key] = blocks.map((block) => serializeVisualBlock(block));
}

function addIfChanged(payload: JsonObject, key: string, value: unknown, defaultValue: unknown): void {
  if (value === defaultValue) {
    return;
  }
  if (typeof value === 'string' && value.length === 0) {
    return;
  }
  payload[key] = value as JsonObject[keyof JsonObject];
}
