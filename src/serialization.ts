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
  createEmptyBlock,
} from './document-factory';
import { coerceGridColumn } from './grid-ops';

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
    tags: typeof sectionMeta.tags === 'string' ? sectionMeta.tags : '',
    description: typeof sectionMeta.description === 'string' ? sectionMeta.description : '',
    location: sectionMeta.location === 'sidebar' ? 'sidebar' : 'main',
    blocks,
    children: section.children.map((child) => mapParsedSection(child, documentMeta)),
  };
}

function parseBlocks(contentMarkdown: string, sectionMeta: JsonObject, documentMeta: JsonObject): VisualBlock[] {
  const schemas = Array.isArray(sectionMeta.blocks) ? (sectionMeta.blocks as JsonObject[]) : [];
  const lines = contentMarkdown.split(/\r?\n/);
  const directivePattern = /^<!--hvy:([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)\s*(\{.*\})\s*-->$/i;

  type BlockAttach =
    | { kind: 'top' }
    | { kind: 'expandable'; parent: VisualBlock; part: 0 | 1 }
    | { kind: 'grid'; parent: VisualBlock; meta: JsonObject }
    | { kind: 'component-list'; parent: VisualBlock }
    | { kind: 'container'; parent: VisualBlock }
    | { kind: 'table-details'; parent: VisualBlock; rowIndex: number };
  type StructuredFrame =
    | { kind: 'component'; block: VisualBlock; attach: BlockAttach; indent: number }
    | { kind: 'slot-expandable'; parent: VisualBlock; part: 0 | 1; indent: number }
    | { kind: 'slot-grid'; parent: VisualBlock; meta: JsonObject; indent: number }
    | { kind: 'slot-component-list'; parent: VisualBlock; indent: number }
    | { kind: 'slot-container'; parent: VisualBlock; indent: number }
    | { kind: 'slot-table-details'; parent: VisualBlock; rowIndex: number; indent: number };

  const blocks: VisualBlock[] = [];
  const frames: StructuredFrame[] = [];
  let currentText: string[] = [];
  let currentSchema: BlockSchema = defaultBlockSchema();
  let currentAttach: BlockAttach = { kind: 'top' };
  let currentHasDirective = false;
  let currentIndent = 0;

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
    // When plain text appears inside an open container frame (no explicit directive
    // set the attach), implicitly route it into that container rather than top level.
    let effectiveAttach = currentAttach;
    if (!currentHasDirective && effectiveAttach.kind === 'top') {
      effectiveAttach = getCurrentAttach();
    }
    const block: VisualBlock = {
      id: makeId('block'),
      text: currentText.join('\n').trim(),
      schema: currentSchema,
      schemaMode: false,
    };
    attachBlock(block, effectiveAttach);
    currentText = [];
    currentSchema = defaultBlockSchema();
    currentAttach = { kind: 'top' };
    currentHasDirective = false;
  };

  const closeFrame = (): void => {
    flush();
    const frame = frames.pop();
    if (frame?.kind === 'component') {
      attachBlock(frame.block, frame.attach);
    }
  };

  const closeFramesUntil = (parentBase: string | null): VisualBlock | undefined => {
    flush();
    if (parentBase === null) {
      while (frames.length > 0) {
        closeFrame();
      }
      return undefined;
    }
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.kind === 'component' && resolveParsedBase(frame.block.schema.component) === parentBase) {
        break;
      }
      closeFrame();
    }
    const frame = frames[frames.length - 1];
    return frame?.kind === 'component' ? frame.block : undefined;
  };

  const closeFramesAtOrAboveIndent = (indent: number): void => {
    flush();
    while (frames.length > 0 && frames[frames.length - 1].indent >= indent) {
      closeFrame();
    }
  };

  const getCurrentAttach = (): BlockAttach => {
    const frame = frames[frames.length - 1];
    if (!frame) {
      return { kind: 'top' };
    }
    if (frame.kind === 'slot-expandable') {
      return { kind: 'expandable', parent: frame.parent, part: frame.part };
    }
    if (frame.kind === 'slot-grid') {
      return { kind: 'grid', parent: frame.parent, meta: frame.meta };
    }
    if (frame.kind === 'slot-component-list') {
      return { kind: 'component-list', parent: frame.parent };
    }
    if (frame.kind === 'slot-container') {
      return { kind: 'container', parent: frame.parent };
    }
    if (frame.kind === 'slot-table-details') {
      return { kind: 'table-details', parent: frame.parent, rowIndex: frame.rowIndex };
    }
    const base = resolveParsedBase(frame.block.schema.component);
    if (base === 'component-list') {
      return { kind: 'component-list', parent: frame.block };
    }
    if (base === 'container') {
      return { kind: 'container', parent: frame.block };
    }
    return { kind: 'top' };
  };

  const findOrCreateParentFrame = (parentBase: 'expandable' | 'grid' | 'component-list' | 'container' | 'table'): VisualBlock => {
    const parent = closeFramesUntil(parentBase);
    if (parent) {
      return parent;
    }
    const fallback = createEmptyBlock(parentBase, true);
    frames.push({
      kind: 'component',
      block: fallback,
      attach: { kind: 'top' },
      indent: Math.max(0, currentIndent - 1),
    });
    return fallback;
  };

  const attachBlock = (block: VisualBlock, attach: BlockAttach): void => {
    if (attach.kind === 'expandable') {
      if (attach.part === 0) {
        attach.parent.schema.expandableStubBlocks.children.push(block);
      } else {
        attach.parent.schema.expandableContentBlocks.children.push(block);
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
      schema.expandableStubBlocks = { lock: false, children: [] };
      schema.expandableContentBlocks = { lock: false, children: [] };
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
      kind: 'component',
      block: {
        id: makeId('block'),
        text: '',
        schema,
        schemaMode: false,
      },
      attach,
      indent: currentIndent,
    });
  };

  lines.forEach((line) => {
    const match = line.trim().match(directivePattern);
    if (!match) {
      currentText.push(line);
      return;
    }

    currentIndent = (line.match(/^( *)/) ?? ['', ''])[1].length;
    closeFramesAtOrAboveIndent(currentIndent);

    const directive = (match[1] ?? 'block').toLowerCase();
    const [name, ...rawParts] = directive.split(':');
    const indexes = rawParts.map((part) => Number.parseInt(part, 10));
    const allIndexesValid = indexes.every((index) => Number.isFinite(index));

    try {
      const parsed = JSON.parse(match[2] ?? '{}') as JsonObject;

      if (name === 'expandable' && rawParts.length === 1 && (rawParts[0] === 'stub' || rawParts[0] === 'content')) {
        const parent = findOrCreateParentFrame('expandable');
        const part: 0 | 1 = rawParts[0] === 'stub' ? 0 : 1;
        const keys = Object.keys(parsed);
        const lockOnly = keys.every((key) => key === 'lock');
        if (!lockOnly) {
          return;
        }
        if (parsed.lock === true) {
          if (part === 0) {
            parent.schema.expandableStubBlocks.lock = true;
          } else {
            parent.schema.expandableContentBlocks.lock = true;
          }
        }
        frames.push({
          kind: 'slot-expandable',
          parent,
          part,
          indent: currentIndent,
        });
        return;
      }

      if (rawParts.length > 0 && !allIndexesValid) {
        return;
      }

      if (name === 'grid' && indexes.length === 1) {
        if (typeof parsed.component === 'string' || typeof parsed.type === 'string') {
          return;
        }
        const parent = findOrCreateParentFrame('grid');
        frames.push({
          kind: 'slot-grid',
          parent,
          meta: parsed,
          indent: currentIndent,
        });
      } else if (name === 'component-list' && indexes.length === 1) {
        if (typeof parsed.component === 'string' || typeof parsed.type === 'string') {
          return;
        }
        const parent = findOrCreateParentFrame('component-list');
        frames.push({
          kind: 'slot-component-list',
          parent,
          indent: currentIndent,
        });
      } else if (name === 'container' && indexes.length === 1) {
        if (typeof parsed.component === 'string' || typeof parsed.type === 'string') {
          return;
        }
        const parent = findOrCreateParentFrame('container');
        frames.push({
          kind: 'slot-container',
          parent,
          indent: currentIndent,
        });
      } else if (name === 'table' && indexes.length === 2) {
        if (typeof parsed.component === 'string' || typeof parsed.type === 'string') {
          return;
        }
        const parent = findOrCreateParentFrame('table');
        frames.push({
          kind: 'slot-table-details',
          parent,
          rowIndex: indexes[0],
          indent: currentIndent,
        });
      } else {
        if (directive === 'block') {
          openOrQueueBlock(schemaFromUnknown(parsed), getCurrentAttach());
        } else {
          openOrQueueBlock(schemaFromUnknown({ ...parsed, component: directive }), getCurrentAttach());
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

const BLOCK_ARRAY_KEYS = ['containerBlocks', 'componentListBlocks'];
const EXPANDABLE_PART_KEYS = ['expandableStubBlocks', 'expandableContentBlocks'];

// Serialize a component def to clean YAML format:
// - strips `component` from schema (redundant with `baseType`)
// - strips `template` (runtime-only)
// - uses { component: name } shorthand for custom component blocks in nested lists
function serializeComponentDef(raw: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'template') continue; // runtime-only; derived from schema
    if (key === 'schema') {
      if (value && typeof value === 'object') {
        result.schema = cleanComponentDefSchema(value as JsonObject);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

function cleanComponentDefSchema(schema: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'component') continue; // redundant with baseType
    if (key === 'schemaMode') continue; // editor state
    if (key === 'id' && (value === '' || value === null || value === undefined)) continue;
    if (BLOCK_ARRAY_KEYS.includes(key) && Array.isArray(value)) {
      result[key] = value.map((block) => cleanComponentDefBlock(block as JsonObject));
    } else if (EXPANDABLE_PART_KEYS.includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      const part = value as { lock?: boolean; children?: JsonObject[] };
      result[key] = {
        lock: part.lock ?? false,
        children: Array.isArray(part.children) ? part.children.map((block) => cleanComponentDefBlock(block)) : [],
      };
    } else if (key === 'gridItems' && Array.isArray(value)) {
      result[key] = value.map((item) => {
        const obj = item as JsonObject;
        return obj.block ? { ...obj, block: cleanComponentDefBlock(obj.block as JsonObject) } : obj;
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}

function cleanComponentDefBlock(block: JsonObject): JsonObject {
  // Determine component from either the shorthand { component } or { schema: { component } } format
  const component = (() => {
    if (block.schema && typeof block.schema === 'object') {
      const s = block.schema as JsonObject;
      if (typeof s.component === 'string') return s.component;
    }
    if (typeof block.component === 'string') return block.component;
    return undefined;
  })();

  if (component && !isBuiltinComponentName(component)) {
    // Custom component: use shorthand — the template defines everything else
    return { component };
  }

  // Builtin component: keep text + recursively clean schema
  const result: JsonObject = {};
  if (typeof block.text === 'string') result.text = block.text;
  if (block.schema && typeof block.schema === 'object') {
    result.schema = cleanComponentDefSchema(block.schema as JsonObject);
  }
  return result;
}

export function serializeDocument(document: VisualDocument): string {
  const rawMeta = stripEditorStateFromSerializedValue(document.meta) as JsonObject;
  const serializedMeta: JsonObject = { ...rawMeta };
  if (Array.isArray(serializedMeta.component_defs)) {
    serializedMeta.component_defs = (serializedMeta.component_defs as unknown[])
      .filter((def): def is JsonObject => !!def && typeof def === 'object')
      .map((def) => serializeComponentDef(def));
  }
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
  if (section.tags.trim().length > 0) {
    meta.tags = section.tags;
  }
  if (section.description.trim().length > 0) {
    meta.description = section.description;
  }
  if (section.location === 'sidebar') {
    meta.location = 'sidebar';
  }

  const directive = `<!--hvy: ${JSON.stringify(meta)}-->`;

  const blockText = section.blocks
    .map((block) => serializeBlock(block, 1))
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
  addIfChanged(payload, 'placeholder', schema.placeholder, defaults.placeholder);

  if (component === 'xref-card') {
    addIfChanged(payload, 'xrefTitle', schema.xrefTitle, defaults.xrefTitle);
    addIfChanged(payload, 'xrefDetail', schema.xrefDetail, defaults.xrefDetail);
    addIfChanged(payload, 'xrefTarget', schema.xrefTarget, defaults.xrefTarget);
  }
  if (component === 'code') {
    addIfChanged(payload, 'codeLanguage', schema.codeLanguage, defaults.codeLanguage);
  }
  if (component === 'container') {
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
    // Stub/content blocks are serialized as nested block directives, not inline in schema JSON.
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
  indent: number,
  override?: { name: string; schema?: JsonObject }
): string {
  const blockDirective = override ?? serializeBlockDirective(block.schema);
  const schemaDirective = `${' '.repeat(indent)}<!--hvy:${blockDirective.name} ${JSON.stringify(blockDirective.schema)}-->`;
  const nested = serializeNestedBlocks(block, indent + 1);
  const text = indentMultiline(block.text.trim(), indent + 1);
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

function indentMultiline(text: string, indent: number): string {
  if (text.length === 0) {
    return '';
  }
  const prefix = ' '.repeat(indent);
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function serializeSlotDirective(name: string, schema: JsonObject, indent: number): string {
  return `${' '.repeat(indent)}<!--hvy:${name} ${JSON.stringify(schema)}-->`;
}

function serializeSlotWithChild(name: string, schema: JsonObject, child: VisualBlock, indent: number): string {
  return [serializeSlotDirective(name, schema, indent), serializeBlock(child, indent + 1)].join('\n\n');
}

function serializeExpandablePartBlock(block: VisualBlock, part: 0 | 1, lock: boolean, indent: number): string {
  return serializeSlotWithChild(
    `expandable:${part === 0 ? 'stub' : 'content'}`,
    lock ? { lock: true } : {},
    block,
    indent
  );
}

function serializeGridItemBlock(item: GridItem, index: number, indent: number): string {
  return serializeSlotWithChild(
    `grid:${index}`,
    {
      id: item.id,
      column: item.column,
    },
    item.block,
    indent
  );
}

function serializeComponentListItemBlock(block: VisualBlock, index: number, indent: number): string {
  return serializeSlotWithChild(`component-list:${index}`, {}, block, indent);
}

function serializeContainerItemBlock(block: VisualBlock, index: number, indent: number): string {
  return serializeSlotWithChild(`container:${index}`, {}, block, indent);
}

function serializeTableDetailBlock(block: VisualBlock, rowIndex: number, detailIndex: number, indent: number): string {
  return serializeSlotWithChild(`table:${rowIndex}:${detailIndex}`, {}, block, indent);
}

function serializeNestedBlocks(block: VisualBlock, indent: number): string {
  const component = resolveBaseComponent(block.schema.component);
  if (component === 'expandable') {
    const stub = block.schema.expandableStubBlocks;
    const content = block.schema.expandableContentBlocks;
    const stubBlocks = stub.children.map((innerBlock) => serializeExpandablePartBlock(innerBlock, 0, stub.lock, indent));
    const contentBlocks = content.children.map((innerBlock) => serializeExpandablePartBlock(innerBlock, 1, content.lock, indent));
    const stubPart = stub.children.length === 0 && stub.lock ? [serializeSlotDirective('expandable:stub', { lock: true }, indent)] : stubBlocks;
    const contentPart =
      content.children.length === 0 && content.lock ? [serializeSlotDirective('expandable:content', { lock: true }, indent)] : contentBlocks;
    return [...stubPart, ...contentPart].join('\n\n');
  }
  if (component === 'grid') {
    return block.schema.gridItems.map((item, index) => serializeGridItemBlock(item, index, indent)).join('\n\n');
  }
  if (component === 'component-list') {
    return block.schema.componentListBlocks
      .map((innerBlock, index) => serializeComponentListItemBlock(innerBlock, index, indent))
      .join('\n\n');
  }
  if (component === 'container') {
    return block.schema.containerBlocks.map((innerBlock, index) => serializeContainerItemBlock(innerBlock, index, indent)).join('\n\n');
  }
  if (component === 'table') {
    return block.schema.tableRows
      .flatMap((row, rowIndex) =>
        (row.detailsBlocks ?? []).map((innerBlock, detailIndex) => serializeTableDetailBlock(innerBlock, rowIndex, detailIndex, indent))
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
