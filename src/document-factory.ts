import type { Align, BaseBlockSchema, BlockSchema, BuiltinComponentName, CarouselImage, ExpandablePart, Slot, SortKeyValue, TableRow, VisualBlock, VisualSection } from './editor/types';
import type { JsonObject } from './hvy/types';
import type { ComponentDefinition, VisualDocument } from './types';
import { makeId, sanitizeOptionalId } from './utils';
import { getComponentDefs, getComponentDefsFromMeta, getSectionDefs, getSectionTemplateKey, isBuiltinComponentName, resolveBaseComponent, resolveBaseComponentFromMeta } from './component-defs';
import { coerceGridColumns, coerceGridStackWidth, DEFAULT_GRID_STACK_WIDTH, parseGridItems as _parseGridItems } from './grid-ops';
import { applyReusableSectionTemplateValues, extractReusableTemplateVariablesFromSectionDefinition, extractReusableTemplateVariablesFromSectionFlavor } from './reusable-template-values';
import { getTableColumns } from './table-ops';
import { REUSABLE_SECTION_DEF_PREFIX } from './state';
import { normalizeTextCaption } from './caption';
import { normalizeSortValueDefs } from './sort-values';

export const DEFAULT_READER_MAX_WIDTH = '60rem';
export const DEFAULT_SECTION_CSS = 'margin: 0 0 0.5rem;';
export const DEFAULT_SECTION_CONTAINED = true;
export const DEFAULT_BLOCK_CSS = 'margin: 0.5rem 0;';
export const DEFAULT_IMAGE_BLOCK_CSS = 'margin: 0.5rem auto; display: block;';

export function defaultBlockSchema(component = 'text', baseComponent: BuiltinComponentName = normalizeBuiltinComponent(component)): BlockSchema {
  const base: BaseBlockSchema = {
    kind: baseComponent,
    id: '',
    component,
    editorOnly: false,
    lock: false,
    align: 'left',
    slot: 'center',
    css: DEFAULT_BLOCK_CSS,
    sortKeys: {},
    derivedSortKeyNames: [],
    groupKeys: {},
    tags: '',
    description: '',
    hideIfYes: '',
    visibleScript: '',
    placeholder: '',
    fillIn: false,
    showCopy: false,
    metaOpen: false,
    xrefTitle: '',
    xrefDetail: '',
  };
  switch (baseComponent) {
    case 'text':
      return { ...base, kind: 'text', showCopy: false } as unknown as BlockSchema;
    case 'code':
      return { ...base, kind: 'code', codeLanguage: 'ts' } as unknown as BlockSchema;
    case 'container':
      return {
        ...base,
        kind: 'container',
        containerBlocks: [],
        containerTitle: '',
        containerExpanded: true,
        containerCollapsedPreviewRem: 3,
      } as unknown as BlockSchema;
    case 'component-list':
      return {
        ...base,
        kind: 'component-list',
        componentListComponent: 'text',
        componentListItemLabel: '',
        componentListBlocks: [],
        componentListDefaultSortKey: '',
        componentListDefaultSortDirection: 'asc',
        componentListDefaultGroupKey: '',
        componentListGroupsExpanded: false,
        componentListGroupCollapsedPreviewRem: 5,
      } as unknown as BlockSchema;
    case 'grid':
      return { ...base, kind: 'grid', gridColumns: 2, gridStackWidth: DEFAULT_GRID_STACK_WIDTH, gridItems: [] } as unknown as BlockSchema;
    case 'expandable':
      return {
        ...base,
        kind: 'expandable',
        expandableStubComponent: 'container',
        expandableContentComponent: 'container',
        expandableStub: '',
        expandableStubCss: '',
        expandableStubDescription: '',
        expandableStubBlocks: { lock: false, children: [] },
        expandableAlwaysShowStub: true,
        expandableExpanded: false,
        expandableContentCss: '',
        expandableContentDescription: '',
        expandableContentBlocks: { lock: false, children: [] },
      } as unknown as BlockSchema;
    case 'table':
      return { ...base, kind: 'table', tableColumns: ['Column 1', 'Column 2'], tableShowHeader: true, tableRows: [] } as unknown as BlockSchema;
    case 'image':
      return { ...base, kind: 'image', css: DEFAULT_IMAGE_BLOCK_CSS, imageFile: '', imageAlt: '', caption: null } as unknown as BlockSchema;
    case 'carousel':
      return {
        ...base,
        kind: 'carousel',
        carouselImages: [],
        carouselDurationMs: 3000,
        carouselPauseOnHover: true,
        carouselShowControls: true,
        carouselShowIndicators: true,
        carouselShowFrame: true,
      } as unknown as BlockSchema;
    case 'button':
      return {
        ...base,
        kind: 'button',
        buttonLabel: 'Generate',
        buttonAction: 'ai-generate',
        buttonVisibleScript: '',
        buttonSourceScript: '',
        buttonPrompt: '',
        buttonTargetScript: '',
        buttonInputCharLimit: 4000,
        buttonOutputCharLimit: 1000,
        buttonPositionTargetId: '',
        buttonCss: '',
      } as unknown as BlockSchema;
    case 'encrypted':
      return {
        ...base,
        kind: 'encrypted',
        keyId: '',
        encryptedAttachmentId: '',
        encryptedBlock: null,
        encryptedDirty: false,
        encryptedError: '',
      } as unknown as BlockSchema;
    case 'plugin':
      return { ...base, kind: 'plugin', plugin: '', pluginConfig: {}, pluginSortValues: {} } as unknown as BlockSchema;
    case 'xref-card':
      return { ...base, kind: 'xref-card', xrefTarget: '', xrefTargetTagFilter: '' } as unknown as BlockSchema;
    default:
      return { ...base, kind: 'text', showCopy: false } as unknown as BlockSchema;
  }
}

function normalizeBuiltinComponent(component: string): BuiltinComponentName {
  return isBuiltinComponentName(component) ? component as BuiltinComponentName : 'text';
}

export function parseExpandablePart(raw: unknown, seen = new WeakSet<object>(), documentMeta?: JsonObject | null): ExpandablePart {
  // New format: { lock: boolean, children: VisualBlock[] }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (seen.has(raw)) {
      return { lock: false, children: [] };
    }
    seen.add(raw);
    const obj = raw as JsonObject;
    return {
      lock: obj.lock === true,
      children: Array.isArray(obj.children) ? obj.children.map((b) => parseVisualBlock(b, seen, documentMeta)) : [],
    };
  }
  // Backward compat: old flat array format
  if (Array.isArray(raw)) {
    return { lock: false, children: raw.map((b) => parseVisualBlock(b, seen, documentMeta)) };
  }
  return { lock: false, children: [] };
}

function readExpandablePartCss(raw: unknown): string {
  return readExpandablePartString(raw, 'css');
}

function readExpandablePartDescription(raw: unknown): string {
  return readExpandablePartString(raw, 'description');
}

function readExpandablePartString(raw: unknown, key: string): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return '';
  }
  const obj = raw as JsonObject;
  return typeof obj[key] === 'string' ? obj[key] : '';
}

export function coerceAlign(value: string): Align {
  if (value === 'center' || value === 'right') {
    return value;
  }
  return 'left';
}

export function coerceSlot(value: string): Slot {
  if (value === 'left' || value === 'right') {
    return value;
  }
  return 'center';
}

export function parseVisualBlock(candidate: unknown, seen = new WeakSet<object>(), documentMeta?: JsonObject | null): VisualBlock {
  if (!candidate || typeof candidate !== 'object') {
    return createEmptyBlock('container', true, documentMeta);
  }
  if (seen.has(candidate)) {
    return createEmptyBlock('container', true, documentMeta);
  }
  seen.add(candidate);
  const raw = candidate as JsonObject;
  // Shorthand: { component: 'name' } without a 'schema' wrapper.
  // Instantiate from the component def template so all nested content (titles, blocks, etc.) is populated.
  if (!raw.schema && typeof raw.component === 'string') {
    return createEmptyBlock(raw.component, false, documentMeta);
  }
  const schema = schemaFromUnknown(raw.schema, seen, documentMeta);
  return {
    id: typeof raw.id === 'string' ? raw.id : makeId('block'),
    text: typeof raw.text === 'string' ? raw.text : '',
    schema,
    schemaMode: raw.schemaMode === true,
  };
}

export function parseVisualSection(candidate: unknown, level = 1, seen = new WeakSet<object>(), documentMeta?: JsonObject | null): VisualSection {
  if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) {
    return createEmptySection(level, '', false);
  }
  seen.add(candidate);
  const raw = candidate as JsonObject;
  const title = typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title : 'Untitled Section';
  const rawLevel = typeof raw.level === 'number' && Number.isFinite(raw.level) ? raw.level : level;
  return {
    key: makeId('section'),
    customId: sanitizeOptionalId(typeof raw.customId === 'string' ? raw.customId : typeof raw.id === 'string' ? raw.id : ''),
    customIdGenerated: raw.customIdGenerated === true,
    contained: typeof raw.contained === 'boolean' ? raw.contained : getDefaultSectionContained(documentMeta),
    editorOnly: raw.editorOnly === true,
    lock: raw.lock === true,
    idEditorOpen: false,
    isGhost: false,
    title,
    level: Math.max(1, Math.min(6, Math.floor(rawLevel))),
    expanded: raw.expanded === false ? false : true,
    highlight: raw.highlight === true,
    priority: raw.priority === true,
    css: typeof raw.css === 'string' ? raw.css : '',
    tags: typeof raw.tags === 'string' ? raw.tags : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    location: raw.location === 'sidebar' ? 'sidebar' : 'main',
    hideIfUnmodified: raw.hideIfUnmodified === true,
    exclude_from_import: raw.exclude_from_import === true,
    protect_from_import: raw.protect_from_import === true,
    templateKey: typeof raw.templateKey === 'string' ? raw.templateKey : undefined,
    blocks: Array.isArray(raw.blocks) ? raw.blocks.map((block) => parseVisualBlock(block, seen, documentMeta)) : [],
    children: Array.isArray(raw.children)
      ? raw.children.map((child) => parseVisualSection(child, Math.min(Math.max(1, Math.floor(rawLevel)) + 1, 6), seen, documentMeta))
      : [],
  };
}

export function normalizeReusableSectionDefinitions(meta: JsonObject): void {
  const defs = meta.section_defs;
  if (!Array.isArray(defs)) {
    return;
  }
  meta.section_defs = defs
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const raw = item as JsonObject;
      return {
        ...raw,
        name: typeof raw.name === 'string' ? raw.name : '',
        key: typeof raw.key === 'string' ? raw.key : undefined,
        repeatable: raw.repeatable === true,
        template: parseVisualSection(raw.template, 1, new WeakSet<object>(), meta),
        flavors: Array.isArray(raw.flavors)
          ? raw.flavors
            .filter((flavor) => flavor && typeof flavor === 'object')
            .map((flavor) => {
              const rawFlavor = flavor as JsonObject;
              return {
                ...rawFlavor,
                name: typeof rawFlavor.name === 'string' ? rawFlavor.name : '',
                description: typeof rawFlavor.description === 'string' ? rawFlavor.description : undefined,
                template: parseVisualSection(rawFlavor.template, 1, new WeakSet<object>(), meta),
              };
            })
            .filter((flavor) => flavor.name.trim().length > 0)
          : undefined,
      };
    })
    .filter((item) => item.name.trim().length > 0);
}

export function normalizeReusableComponentDefinitions(meta: JsonObject): void {
  const defs = meta.component_defs;
  if (!Array.isArray(defs)) {
    return;
  }
  meta.component_defs = defs
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const raw = item as JsonObject;
      const name = typeof raw.name === 'string' ? raw.name : '';
      const baseType = typeof raw.baseType === 'string' ? raw.baseType : 'text';
      const normalized: JsonObject = {
        ...raw,
        name,
        baseType,
      };
      const sortValueDefs = normalizeSortValueDefs(raw.sortValueDefs);
      if (Object.keys(sortValueDefs).length > 0) {
        normalized.sortValueDefs = sortValueDefs;
      } else {
        delete normalized.sortValueDefs;
      }
      if (raw.schema && typeof raw.schema === 'object' && !Array.isArray(raw.schema)) {
        normalized.schema = schemaFromUnknown({ ...(raw.schema as JsonObject), component: name || baseType }, new WeakSet<object>(), meta);
      }
      if (Array.isArray(raw.flavors)) {
        normalized.flavors = raw.flavors
          .filter((flavor) => flavor && typeof flavor === 'object')
          .map((flavor) => {
            const rawFlavor = flavor as JsonObject;
            const flavorName = typeof rawFlavor.name === 'string' ? rawFlavor.name : '';
            const normalizedFlavor: JsonObject = {
              ...rawFlavor,
              name: flavorName,
            };
            if (rawFlavor.schema && typeof rawFlavor.schema === 'object' && !Array.isArray(rawFlavor.schema)) {
              normalizedFlavor.schema = schemaFromUnknown({ ...(rawFlavor.schema as JsonObject), component: name || baseType }, new WeakSet<object>(), meta);
            }
            return normalizedFlavor;
          })
          .filter((flavor) => typeof flavor.name === 'string' && flavor.name.trim().length > 0);
      }
      return normalized;
    })
    .filter((item) => typeof item.name === 'string' && item.name.trim().length > 0);
}

export function schemaFromUnknown(value: unknown, seen = new WeakSet<object>(), documentMeta?: JsonObject | null): BlockSchema {
  if (!value || typeof value !== 'object') {
    return defaultBlockSchema('text');
  }
  if (seen.has(value)) {
    return defaultBlockSchema('container');
  }
  seen.add(value);
  const candidate = value as JsonObject;
  const component = typeof candidate.component === 'string' ? candidate.component : 'text';
  const baseComponent = resolveBaseComponentFromMeta(component, documentMeta) as BuiltinComponentName;
  const defaults = defaultBlockSchema(component, normalizeBuiltinComponent(baseComponent));
  const rows = Array.isArray(candidate.tableRows) ? candidate.tableRows : [];
  const parseNestedVisualBlock = (raw: unknown): VisualBlock => parseVisualBlock(raw, seen, documentMeta);
  const schema: BlockSchema = {
    ...defaults,
    component,
    id: typeof candidate.id === 'string' ? candidate.id : defaults.id,
    editorOnly: candidate.editorOnly === true,
    lock: candidate.lock === true,
    align: coerceAlign(typeof candidate.align === 'string' ? candidate.align : 'left'),
    slot: coerceSlot(typeof candidate.slot === 'string' ? candidate.slot : 'center'),
    css: typeof candidate.css === 'string' ? candidate.css : defaults.css,
    sortKeys: parseSortKeys(candidate.sortKeys),
    derivedSortKeyNames: parseStringList(candidate.derivedSortKeyNames),
    groupKeys: parseGroupKeys(candidate.groupKeys),
    tags: typeof candidate.tags === 'string' ? candidate.tags : defaults.tags,
    description: typeof candidate.description === 'string' ? candidate.description : defaults.description,
    hideIfYes: typeof candidate.hideIfYes === 'string' ? candidate.hideIfYes : defaults.hideIfYes,
    visibleScript: typeof candidate.visibleScript === 'string' ? candidate.visibleScript : defaults.visibleScript,
    placeholder: typeof candidate.placeholder === 'string' ? candidate.placeholder : defaults.placeholder,
    fillIn: candidate.fillIn === true,
    metaOpen: candidate.metaOpen === true,
    xrefTitle: typeof candidate.xrefTitle === 'string' ? candidate.xrefTitle : defaults.xrefTitle,
    xrefDetail: typeof candidate.xrefDetail === 'string' ? candidate.xrefDetail : defaults.xrefDetail,
  };

  if (schema.kind === 'text') {
    schema.showCopy = candidate.showCopy === true;
  }

  if (schema.kind === 'code') {
    schema.codeLanguage = typeof candidate.codeLanguage === 'string' ? candidate.codeLanguage : schema.codeLanguage;
  }
  if (schema.kind === 'container') {
    schema.containerBlocks = Array.isArray(candidate.containerBlocks)
      ? candidate.containerBlocks.map((block) => parseVisualBlock(block, seen, documentMeta))
      : [];
    schema.containerTitle = typeof candidate.containerTitle === 'string' ? candidate.containerTitle : schema.containerTitle;
    schema.containerExpanded = candidate.containerExpanded !== false;
    schema.containerCollapsedPreviewRem = parsePositiveNumber(candidate.containerCollapsedPreviewRem, schema.containerCollapsedPreviewRem);
  }
  if (schema.kind === 'component-list') {
    schema.componentListComponent =
      typeof candidate.componentListComponent === 'string' ? candidate.componentListComponent : schema.componentListComponent;
    schema.componentListItemLabel =
      typeof candidate.componentListItemLabel === 'string' ? candidate.componentListItemLabel : schema.componentListItemLabel;
    schema.componentListBlocks = Array.isArray(candidate.componentListBlocks)
      ? candidate.componentListBlocks.map((block) => parseVisualBlock(block, seen, documentMeta))
      : [];
    schema.componentListDefaultSortKey = typeof candidate.componentListDefaultSortKey === 'string' ? candidate.componentListDefaultSortKey : schema.componentListDefaultSortKey;
    schema.componentListDefaultSortDirection = candidate.componentListDefaultSortDirection === 'desc' ? 'desc' : 'asc';
    schema.componentListDefaultGroupKey = typeof candidate.componentListDefaultGroupKey === 'string' ? candidate.componentListDefaultGroupKey : schema.componentListDefaultGroupKey;
    schema.componentListGroupsExpanded = candidate.componentListGroupsExpanded === true;
    schema.componentListGroupCollapsedPreviewRem = parsePositiveNumber(candidate.componentListGroupCollapsedPreviewRem, schema.componentListGroupCollapsedPreviewRem);
  }
  if (schema.kind === 'grid') {
    schema.gridColumns = coerceGridColumns(candidate.gridColumns ?? candidate.gridTemplateColumns);
    schema.gridStackWidth = coerceGridStackWidth(candidate.gridStackWidth);
    schema.gridItems = _parseGridItems(candidate, schema.gridColumns, component, _createBlockSkip, parseNestedVisualBlock);
  }
  if (schema.kind === 'plugin') {
    schema.plugin = typeof candidate.plugin === 'string' ? candidate.plugin : schema.plugin;
    schema.pluginConfig =
      candidate.pluginConfig && typeof candidate.pluginConfig === 'object' && !Array.isArray(candidate.pluginConfig)
        ? (candidate.pluginConfig as JsonObject)
        : schema.pluginConfig;
    schema.pluginSortValues = parseSortKeys(candidate.pluginSortValues);
  }
  if (schema.kind === 'expandable') {
    schema.expandableStubComponent =
      typeof candidate.expandableStubComponent === 'string' ? candidate.expandableStubComponent : schema.expandableStubComponent;
    schema.expandableContentComponent =
      typeof candidate.expandableContentComponent === 'string' ? candidate.expandableContentComponent : schema.expandableContentComponent;
    schema.expandableStub = typeof candidate.expandableStub === 'string' ? candidate.expandableStub : schema.expandableStub;
    schema.expandableStubCss =
      typeof candidate.expandableStubCss === 'string'
        ? candidate.expandableStubCss
        : readExpandablePartCss(candidate.expandableStubBlocks) || schema.expandableStubCss;
    schema.expandableStubDescription =
      typeof candidate.expandableStubDescription === 'string'
        ? candidate.expandableStubDescription
        : readExpandablePartDescription(candidate.expandableStubBlocks) || schema.expandableStubDescription;
    schema.expandableStubBlocks = parseExpandablePart(candidate.expandableStubBlocks, seen, documentMeta);
    schema.expandableAlwaysShowStub = candidate.expandableAlwaysShowStub !== false;
    schema.expandableExpanded = candidate.expandableExpanded === true;
    schema.expandableContentCss =
      typeof candidate.expandableContentCss === 'string'
        ? candidate.expandableContentCss
        : readExpandablePartCss(candidate.expandableContentBlocks) || schema.expandableContentCss;
    schema.expandableContentDescription =
      typeof candidate.expandableContentDescription === 'string'
        ? candidate.expandableContentDescription
        : readExpandablePartDescription(candidate.expandableContentBlocks) || schema.expandableContentDescription;
    schema.expandableContentBlocks = parseExpandablePart(candidate.expandableContentBlocks, seen, documentMeta);
  }
  if (schema.kind === 'table') {
    schema.tableColumns = parseTableColumns(candidate.tableColumns, schema.tableColumns);
    schema.tableShowHeader = candidate.tableShowHeader !== false;
    schema.tableRows = rows.map((row) => {
      const mapped = row as JsonObject;
      return {
        cells: Array.isArray(mapped.cells) ? mapped.cells.map((cell) => String(cell ?? '')) : createDefaultTableRow(2).cells,
      };
    });
  }
  if (schema.kind === 'image') {
    schema.imageFile = typeof candidate.imageFile === 'string' ? candidate.imageFile : schema.imageFile;
    schema.imageAlt = typeof candidate.imageAlt === 'string' ? candidate.imageAlt : schema.imageAlt;
    schema.caption = normalizeTextCaption(candidate.caption);
    schema.css = typeof candidate.css === 'string' ? candidate.css : schema.css;
  }
  if (schema.kind === 'carousel') {
    schema.carouselImages = parseCarouselImages(candidate.carouselImages);
    schema.carouselDurationMs = parsePositiveNumber(candidate.carouselDurationMs, schema.carouselDurationMs);
    schema.carouselPauseOnHover = candidate.carouselPauseOnHover !== false;
    schema.carouselShowControls = candidate.carouselShowControls !== false;
    schema.carouselShowIndicators = candidate.carouselShowIndicators !== false;
    schema.carouselShowFrame = candidate.carouselShowFrame !== false;
  }
  if (schema.kind === 'button') {
    schema.buttonLabel = typeof candidate.buttonLabel === 'string' ? candidate.buttonLabel : schema.buttonLabel;
    schema.buttonAction = 'ai-generate';
    schema.buttonVisibleScript = typeof candidate.buttonVisibleScript === 'string' ? candidate.buttonVisibleScript : schema.buttonVisibleScript;
    schema.buttonSourceScript = typeof candidate.buttonSourceScript === 'string' ? candidate.buttonSourceScript : schema.buttonSourceScript;
    schema.buttonPrompt = typeof candidate.buttonPrompt === 'string' ? candidate.buttonPrompt : schema.buttonPrompt;
    schema.buttonTargetScript = typeof candidate.buttonTargetScript === 'string' ? candidate.buttonTargetScript : schema.buttonTargetScript;
    schema.buttonInputCharLimit = parsePositiveNumber(candidate.buttonInputCharLimit, schema.buttonInputCharLimit);
    schema.buttonOutputCharLimit = parsePositiveNumber(candidate.buttonOutputCharLimit, schema.buttonOutputCharLimit);
    schema.buttonPositionTargetId = typeof candidate.buttonPositionTargetId === 'string' ? candidate.buttonPositionTargetId : schema.buttonPositionTargetId;
    schema.buttonCss = typeof candidate.buttonCss === 'string' ? candidate.buttonCss : schema.buttonCss;
  }
  if (schema.kind === 'encrypted') {
    schema.keyId = typeof candidate.keyId === 'string' ? candidate.keyId : schema.keyId;
    schema.encryptedAttachmentId =
      typeof candidate.encryptedAttachmentId === 'string' && candidate.encryptedAttachmentId.trim().length > 0
        ? candidate.encryptedAttachmentId
        : schema.keyId.trim().length > 0
        ? `encrypted:${schema.keyId.trim()}`
        : '';
    schema.encryptedBlock = null;
    schema.encryptedDirty = false;
    schema.encryptedError = '';
  }
  if (schema.kind === 'xref-card') {
    schema.xrefTarget = typeof candidate.xrefTarget === 'string' ? candidate.xrefTarget : schema.xrefTarget;
    schema.xrefTargetTagFilter =
      typeof candidate.xrefTargetTagFilter === 'string' ? candidate.xrefTargetTagFilter : schema.xrefTargetTagFilter;
  }
  return schema;
}

function parseCarouselImages(raw: unknown): CarouselImage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item): CarouselImage | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const candidate = item as JsonObject;
      const imageFile = typeof candidate.imageFile === 'string' ? candidate.imageFile.trim() : '';
      if (!imageFile) {
        return null;
      }
      return {
        imageFile,
        imageAlt: typeof candidate.imageAlt === 'string' ? candidate.imageAlt : '',
        caption: typeof candidate.caption === 'string' ? candidate.caption : '',
      };
    })
    .filter((item): item is CarouselImage => item !== null);
}

function parseSortKeys(raw: unknown): Record<string, SortKeyValue> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const parsed: Record<string, SortKeyValue> = {};
  for (const [key, value] of Object.entries(raw as JsonObject)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed[key] = value;
    } else if (typeof value === 'string') {
      parsed[key] = value;
    }
  }
  return parsed;
}

function parseStringList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function parseGroupKeys(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const parsed: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as JsonObject)) {
    if (typeof value === 'string') {
      parsed[key] = value;
    }
  }
  return parsed;
}

function parsePositiveNumber(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return raw;
}

function parseTableColumns(raw: unknown, fallback: string[]): string[] {
  if (Array.isArray(raw)) {
    return raw.map((column) => String(column ?? ''));
  }
  return [...fallback];
}

// Internal helper for grid/table callbacks that always skip component defaults
function _createBlockSkip(component: string, _skip: boolean): VisualBlock {
  const schema = defaultBlockSchema(component);
  return {
    id: makeId('block'),
    text: '',
    schema,
    schemaMode: false,
  };
}

export function createEmptyBlock(component = 'text', skipComponentDefaults = false, documentMeta?: JsonObject | null): VisualBlock {
  const reusableInstance = documentMeta
    ? instantiateReusableBlockFromMeta(component, documentMeta)
    : instantiateReusableBlock(component);
  if (reusableInstance) {
    return reusableInstance;
  }
  const schema = defaultBlockSchema(component);
  if (!skipComponentDefaults) {
    applyComponentDefaults(schema, component, documentMeta);
  }
  return {
    id: makeId('block'),
    text: '',
    schema,
    schemaMode: false,
  };
}

export function createEmptySection(level: number, component = 'container', isGhost = false): VisualSection {
  return createEmptySectionWithMeta(level, component, isGhost, null);
}

export function createEmptySectionWithMeta(level: number, component = 'container', isGhost = false, documentMeta?: JsonObject | null): VisualSection {
  return {
    key: makeId('section'),
    customId: '',
    customIdGenerated: false,
    contained: getDefaultSectionContained(documentMeta),
    editorOnly: false,
    lock: false,
    idEditorOpen: false,
    isGhost,
    title: isGhost ? 'New Component' : 'Unnamed Section',
    level,
    expanded: true,
    highlight: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    hideIfUnmodified: false,
    exclude_from_import: false,
    protect_from_import: false,
    templateKey: undefined,
    blocks: component ? [createEmptyBlock(component, false, documentMeta)] : [],
    children: [],
  };
}

export function getDefaultSectionContained(documentMeta?: JsonObject | null): boolean {
  const sectionDefaults = documentMeta?.section_defaults;
  if (!sectionDefaults || typeof sectionDefaults !== 'object' || Array.isArray(sectionDefaults)) {
    return DEFAULT_SECTION_CONTAINED;
  }
  return (sectionDefaults as JsonObject).contained === false ? false : DEFAULT_SECTION_CONTAINED;
}

export function createDefaultTableRow(columnCount: number): TableRow {
  return {
    cells: new Array(Math.max(columnCount, 1)).fill(''),
  };
}

export function createBlankDocument(extension: VisualDocument['extension'] = '.hvy'): VisualDocument {
  return {
    meta: {
      hvy_version: 0.1,
      reader_max_width: DEFAULT_READER_MAX_WIDTH,
      section_defaults: {
        css: DEFAULT_SECTION_CSS,
        contained: DEFAULT_SECTION_CONTAINED,
      },
    },
    extension,
    sections: [],
    attachments: [],
  };
}

// Clone/reusable functions (mutually recursive with schemaFromUnknown)

export function cloneReusableSchema(schema: BlockSchema, componentName = schema.component): BlockSchema {
  const cloned = schemaFromUnknown(
    { ...(JSON.parse(JSON.stringify(schema)) as JsonObject), component: componentName },
    new WeakSet<object>(),
    { component_defs: getComponentDefs() as unknown as JsonObject[] }
  );
  cloned.component = componentName;
  if (cloned.kind === 'container') {
    cloned.containerBlocks = (cloned.containerBlocks ?? []).map((block) => cloneReusableBlock(block));
  }
  if (cloned.kind === 'component-list') {
    cloned.componentListBlocks = (cloned.componentListBlocks ?? []).map((block) => cloneReusableBlock(block));
  }
  if (cloned.kind === 'grid') {
    cloned.gridItems = (cloned.gridItems ?? []).map((item) => ({
      ...item,
      block: cloneReusableBlock(item.block),
    }));
  }
  if (cloned.kind === 'expandable') {
    cloned.expandableStubBlocks = cloned.expandableStubBlocks ?? { lock: false, children: [] };
    cloned.expandableContentBlocks = cloned.expandableContentBlocks ?? { lock: false, children: [] };
    cloned.expandableStubBlocks.children = cloned.expandableStubBlocks.children.map((block) => cloneReusableBlock(block));
    cloned.expandableContentBlocks.children = cloned.expandableContentBlocks.children.map((block) => cloneReusableBlock(block));
  }
  return cloned;
}

function cloneReusableSchemaFromMeta(schema: BlockSchema, componentName: string, documentMeta: JsonObject): BlockSchema {
  const cloned = schemaFromUnknown(JSON.parse(JSON.stringify(schema)) as JsonObject, new WeakSet<object>(), documentMeta);
  cloned.component = componentName;
  if (cloned.kind === 'container') {
    cloned.containerBlocks = (cloned.containerBlocks ?? []).map((block) => cloneReusableBlockFromMeta(block, documentMeta));
  }
  if (cloned.kind === 'component-list') {
    cloned.componentListBlocks = (cloned.componentListBlocks ?? []).map((block) => cloneReusableBlockFromMeta(block, documentMeta));
  }
  if (cloned.kind === 'grid') {
    cloned.gridItems = (cloned.gridItems ?? []).map((item) => ({
      ...item,
      block: cloneReusableBlockFromMeta(item.block, documentMeta),
    }));
  }
  if (cloned.kind === 'expandable') {
    cloned.expandableStubBlocks = cloned.expandableStubBlocks ?? { lock: false, children: [] };
    cloned.expandableContentBlocks = cloned.expandableContentBlocks ?? { lock: false, children: [] };
    cloned.expandableStubBlocks.children = cloned.expandableStubBlocks.children.map((block) => cloneReusableBlockFromMeta(block, documentMeta));
    cloned.expandableContentBlocks.children = cloned.expandableContentBlocks.children.map((block) => cloneReusableBlockFromMeta(block, documentMeta));
  }
  return cloned;
}

export function cloneReusableBlock(block: VisualBlock): VisualBlock {
  return {
    id: makeId('block'),
    text: block.text,
    schema: cloneReusableSchema(block.schema, block.schema.component),
    schemaMode: false,
  };
}

export function cloneReusableBlockFromMeta(block: VisualBlock, documentMeta: JsonObject): VisualBlock {
  return {
    id: makeId('block'),
    text: block.text,
    schema: cloneReusableSchemaFromMeta(block.schema, block.schema.component, documentMeta),
    schemaMode: false,
  };
}

export function cloneReusableSection(section: VisualSection, targetLevel = section.level): VisualSection {
  const levelDelta = targetLevel - section.level;
  return cloneReusableSectionWithDelta(section, levelDelta);
}

function cloneReusableSectionWithDelta(section: VisualSection, levelDelta: number): VisualSection {
  return {
    key: makeId('section'),
    customId: '',
    contained: section.contained !== false,
    editorOnly: section.editorOnly === true,
    idEditorOpen: false,
    isGhost: false,
    title: section.title,
    level: Math.max(1, Math.min(6, section.level + levelDelta)),
    lock: section.lock,
    expanded: section.expanded,
    highlight: section.highlight,
    css: section.css,
    tags: section.tags,
    description: section.description,
    location: section.location ?? 'main',
    hideIfUnmodified: section.hideIfUnmodified === true,
    exclude_from_import: section.exclude_from_import === true,
    protect_from_import: section.protect_from_import === true,
    templateKey: section.templateKey,
    blocks: section.blocks.map((block) => cloneReusableBlock(block)),
    children: section.children.map((child) => cloneReusableSectionWithDelta(child, levelDelta)),
  };
}

export function getReusableTemplate(def: ComponentDefinition): VisualBlock {
  if (def.template) {
    return def.template;
  }
  const fallbackSchema = def.schema ? cloneReusableSchema(def.schema, def.name) : defaultBlockSchema(def.name, normalizeBuiltinComponent(resolveBaseComponent(def.name)));
  def.template = {
    id: makeId('block'),
    text: '',
    schema: fallbackSchema,
    schemaMode: true,
  };
  return def.template;
}

export function getReusableTemplateByName(name: string): VisualBlock | null {
  const def = getComponentDefs().find((item) => item.name === name);
  return def ? getReusableTemplate(def) : null;
}

export function instantiateReusableBlock(componentName: string): VisualBlock | null {
  const def = getComponentDefs().find((item) => item.name === componentName);
  if (!def) {
    return null;
  }
  const template = getReusableTemplate(def);
  const instance = cloneReusableBlock(template);
  instance.schema.component = componentName;
  instance.schemaMode = false;
  return instance;
}

function instantiateReusableBlockFromMeta(componentName: string, documentMeta: JsonObject): VisualBlock | null {
  const def = getComponentDefsFromMeta(documentMeta).find((item) => item.name === componentName);
  if (!def) {
    return null;
  }
  const fallbackSchema = def.schema
    ? cloneReusableSchemaFromMeta(schemaFromUnknown({ ...(def.schema as unknown as JsonObject), component: componentName }, new WeakSet<object>(), documentMeta), componentName, documentMeta)
    : defaultBlockSchema(componentName, normalizeBuiltinComponent(resolveBaseComponentFromMeta(componentName, documentMeta)));
  const template = def.template ?? {
    id: makeId('block'),
    text: '',
    schema: fallbackSchema,
    schemaMode: true,
  };
  const instance = cloneReusableBlockFromMeta(template, documentMeta);
  instance.schema.component = componentName;
  instance.schemaMode = false;
  return instance;
}

export function instantiateReusableSection(name: string, level: number, flavorName?: string): VisualSection | null {
  const normalizedName = name.startsWith(REUSABLE_SECTION_DEF_PREFIX) ? name.slice(REUSABLE_SECTION_DEF_PREFIX.length) : name;
  const def = getSectionDefs().find((item) => item.name === normalizedName || getSectionTemplateKey(item) === normalizedName);
  if (!def) {
    return null;
  }
  const flavor = flavorName
    ? (def.flavors ?? []).find((item) => item.name.trim() === flavorName.trim() && !!item.template)
    : null;
  const section = cloneReusableSection(flavor?.template ?? def.template, level);
  const variables = flavor
    ? extractReusableTemplateVariablesFromSectionFlavor(flavor)
    : extractReusableTemplateVariablesFromSectionDefinition(def);
  if (variables.length > 0) {
    applyReusableSectionTemplateValues(section, Object.fromEntries(variables.map((variable) => [variable.name, ''])), variables);
  }
  section.templateKey = getSectionTemplateKey(def);
  return section;
}

export function applyComponentDefaults(schema: BlockSchema, componentName: string, documentMeta?: JsonObject | null): void {
  const def = documentMeta
    ? getComponentDefsFromMeta(documentMeta).find((item) => item.name === componentName)
    : getComponentDefs().find((item) => item.name === componentName);
  const base = documentMeta ? resolveBaseComponentFromMeta(componentName, documentMeta) : resolveBaseComponent(componentName);
  if (def?.template) {
    const next = documentMeta
      ? cloneReusableSchemaFromMeta(def.template.schema, componentName, documentMeta)
      : cloneReusableSchema(def.template.schema, componentName);
    Object.assign(schema, next);
    return;
  }
  if (def?.schema) {
    Object.assign(schema, documentMeta
      ? cloneReusableSchemaFromMeta(schemaFromUnknown({ ...(def.schema as unknown as JsonObject), component: componentName }, new WeakSet<object>(), documentMeta), componentName, documentMeta)
      : cloneReusableSchema(def.schema, componentName)
    );
    return;
  }
  if (base === 'table' && schema.tableRows.length === 0) {
    schema.tableRows.push(createDefaultTableRow(getTableColumns(schema).length));
  }
  if (base === 'grid') {
    ensureGridItems(schema);
  }
  if (base === 'image' && schema.css === DEFAULT_BLOCK_CSS) {
    schema.css = DEFAULT_IMAGE_BLOCK_CSS;
  }
  if (base === 'component-list') {
    schema.componentListComponent = 'text';
    ensureComponentListBlocks({ id: '', text: '', schema, schemaMode: false });
  }
  if (!def) {
    return;
  }
  if (!schema.tags) {
    schema.tags = def.tags ?? '';
  }
  if (!schema.description) {
    schema.description = def.description ?? '';
  }
}

// Ensure functions (depend on createEmptyBlock, so they live here)

export function ensureContainerBlocks(block: VisualBlock): void {
  if (!Array.isArray(block.schema.containerBlocks)) {
    block.schema.containerBlocks = [];
  }
  if (block.schema.containerBlocks.length === 0 && block.text.trim().length > 0) {
    const migrated = createEmptyBlock('text', true);
    migrated.text = block.text;
    block.schema.containerBlocks.push(migrated);
    block.text = '';
  }
}

export function ensureComponentListBlocks(block: VisualBlock): void {
  if (!Array.isArray(block.schema.componentListBlocks)) {
    block.schema.componentListBlocks = [];
  }
  if (!block.schema.componentListComponent) {
    block.schema.componentListComponent = 'text';
  }
}

export function ensureExpandableBlocks(block: VisualBlock): void {
  // Migrate old flat-array format or missing values
  if (!block.schema.expandableStubBlocks || Array.isArray(block.schema.expandableStubBlocks)) {
    block.schema.expandableStubBlocks = {
      lock: false,
      children: Array.isArray(block.schema.expandableStubBlocks) ? block.schema.expandableStubBlocks : [],
    };
  }
  if (!block.schema.expandableContentBlocks || Array.isArray(block.schema.expandableContentBlocks)) {
    block.schema.expandableContentBlocks = {
      lock: false,
      children: Array.isArray(block.schema.expandableContentBlocks) ? block.schema.expandableContentBlocks : [],
    };
  }
  // Migrate legacy expandableStub text field
  if (block.schema.expandableStubBlocks.children.length === 0 && block.schema.expandableStub.trim().length > 0) {
    const migrated = createEmptyBlock(resolveBaseComponent(block.schema.expandableStubComponent || 'text'), true);
    migrated.text = block.schema.expandableStub;
    block.schema.expandableStubBlocks.children.push(migrated);
    block.schema.expandableStub = '';
  }
  if (block.schema.expandableContentBlocks.children.length === 0 && block.text.trim().length > 0) {
    const migrated = createEmptyBlock(resolveBaseComponent(block.schema.expandableContentComponent || 'text'), true);
    migrated.text = block.text;
    block.schema.expandableContentBlocks.children.push(migrated);
    block.text = '';
  }
}

export function ensureGridItems(schema: BlockSchema): void {
  const _createBlock = (component: string, _skip: boolean): VisualBlock => createEmptyBlock(component, true);
  const _parseBlock = (raw: unknown): VisualBlock => parseVisualBlock(raw);

  if (!Array.isArray(schema.gridItems)) {
    schema.gridItems = [];
    return;
  }
  schema.gridItems = schema.gridItems.map((item) => {
    const generated = !item.id;
    return {
      id: item.id || makeId('griditem'),
      idGenerated: item.idGenerated === true || generated,
      block: item.block && typeof item.block === 'object' && 'id' in item.block && 'schema' in item.block
        ? item.block
        : item.block ? _parseBlock(item.block) : _createBlock('text', true),
    };
  });
}
