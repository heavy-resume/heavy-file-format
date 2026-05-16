import type { Align, BlockSchema, ExpandablePart, Slot, SortKeyValue, TableRow, VisualBlock, VisualSection } from './editor/types';
import type { JsonObject } from './hvy/types';
import type { ComponentDefinition, VisualDocument } from './types';
import { makeId, sanitizeOptionalId } from './utils';
import { getComponentDefs, getComponentDefsFromMeta, getSectionDefs, getSectionTemplateKey, resolveBaseComponent, resolveBaseComponentFromMeta } from './component-defs';
import { coerceGridColumns, parseGridItems as _parseGridItems } from './grid-ops';
import { applyReusableSectionTemplateValues, extractReusableTemplateVariablesFromSectionDefinition, extractReusableTemplateVariablesFromSectionFlavor } from './reusable-template-values';
import { getTableColumns } from './table-ops';
import { REUSABLE_SECTION_DEF_PREFIX } from './state';

export const DEFAULT_READER_MAX_WIDTH = '60rem';
export const DEFAULT_SECTION_CSS = 'margin: 0 0 0.5rem;';
export const DEFAULT_BLOCK_CSS = 'margin: 0.5rem 0;';

export function defaultBlockSchema(component = 'text'): BlockSchema {
  return {
    id: '',
    component,
    editorOnly: false,
    lock: false,
    align: 'left',
    slot: 'center',
    css: DEFAULT_BLOCK_CSS,
    codeLanguage: 'ts',
    containerBlocks: [],
    containerTitle: '',
    containerExpanded: true,
    containerCollapsedPreviewRem: 3,
    componentListComponent: 'text',
    componentListItemLabel: '',
    componentListBlocks: [],
    componentListDefaultSortKey: '',
    componentListDefaultSortDirection: 'asc',
    componentListDefaultGroupKey: '',
    componentListGroupCollapsedPreviewRem: 5,
    gridColumns: 2,
    gridItems: [],
    sortKeys: {},
    groupKeys: {},
    tags: '',
    description: '',
    visibleScript: '',
    placeholder: '',
    fillIn: false,
    metaOpen: false,
    xrefTitle: '',
    xrefDetail: '',
    xrefTarget: '',
    xrefTargetTagFilter: '',
    plugin: '',
    pluginConfig: {},
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
    tableColumns: ['Column 1', 'Column 2'],
    tableShowHeader: true,
    tableRows: [],
    imageFile: '',
    imageAlt: '',
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
  };
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
    contained: raw.contained !== false,
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
  const defaults = defaultBlockSchema(component);
  const rows = Array.isArray(candidate.tableRows) ? candidate.tableRows : [];
  const gridColumns = coerceGridColumns(candidate.gridColumns ?? candidate.gridTemplateColumns);
  const parseNestedVisualBlock = (raw: unknown): VisualBlock => parseVisualBlock(raw, seen, documentMeta);
  const parsedGridItems = _parseGridItems(candidate, gridColumns, component, _createBlockSkip, parseNestedVisualBlock);
  return {
    component,
    id: typeof candidate.id === 'string' ? candidate.id : defaults.id,
    editorOnly: candidate.editorOnly === true,
    lock: candidate.lock === true,
    align: coerceAlign(typeof candidate.align === 'string' ? candidate.align : 'left'),
    slot: coerceSlot(typeof candidate.slot === 'string' ? candidate.slot : 'center'),
    css: typeof candidate.css === 'string' ? candidate.css : defaults.css,
    codeLanguage: typeof candidate.codeLanguage === 'string' ? candidate.codeLanguage : defaults.codeLanguage,
    containerBlocks: Array.isArray(candidate.containerBlocks)
      ? candidate.containerBlocks.map((block) => parseVisualBlock(block, seen, documentMeta))
      : [],
    containerTitle: typeof candidate.containerTitle === 'string' ? candidate.containerTitle : defaults.containerTitle,
    containerExpanded: candidate.containerExpanded !== false,
    containerCollapsedPreviewRem: parsePositiveNumber(candidate.containerCollapsedPreviewRem, defaults.containerCollapsedPreviewRem),
    componentListComponent:
      typeof candidate.componentListComponent === 'string' ? candidate.componentListComponent : defaults.componentListComponent,
    componentListItemLabel:
      typeof candidate.componentListItemLabel === 'string' ? candidate.componentListItemLabel : defaults.componentListItemLabel,
    componentListBlocks: Array.isArray(candidate.componentListBlocks)
      ? candidate.componentListBlocks.map((block) => parseVisualBlock(block, seen, documentMeta))
      : [],
    componentListDefaultSortKey: typeof candidate.componentListDefaultSortKey === 'string' ? candidate.componentListDefaultSortKey : defaults.componentListDefaultSortKey,
    componentListDefaultSortDirection: candidate.componentListDefaultSortDirection === 'desc' ? 'desc' : 'asc',
    componentListDefaultGroupKey: typeof candidate.componentListDefaultGroupKey === 'string' ? candidate.componentListDefaultGroupKey : defaults.componentListDefaultGroupKey,
    componentListGroupCollapsedPreviewRem: parsePositiveNumber(candidate.componentListGroupCollapsedPreviewRem, defaults.componentListGroupCollapsedPreviewRem),
    gridColumns,
    gridItems: parsedGridItems,
    sortKeys: parseSortKeys(candidate.sortKeys),
    groupKeys: parseGroupKeys(candidate.groupKeys),
    tags: typeof candidate.tags === 'string' ? candidate.tags : defaults.tags,
    description: typeof candidate.description === 'string' ? candidate.description : defaults.description,
    visibleScript: typeof candidate.visibleScript === 'string' ? candidate.visibleScript : defaults.visibleScript,
    placeholder: typeof candidate.placeholder === 'string' ? candidate.placeholder : defaults.placeholder,
    fillIn: candidate.fillIn === true,
    metaOpen: candidate.metaOpen === true,
    xrefTitle: typeof candidate.xrefTitle === 'string' ? candidate.xrefTitle : defaults.xrefTitle,
    xrefDetail: typeof candidate.xrefDetail === 'string' ? candidate.xrefDetail : defaults.xrefDetail,
    xrefTarget: typeof candidate.xrefTarget === 'string' ? candidate.xrefTarget : defaults.xrefTarget,
    xrefTargetTagFilter:
      typeof candidate.xrefTargetTagFilter === 'string' ? candidate.xrefTargetTagFilter : defaults.xrefTargetTagFilter,
    plugin: typeof candidate.plugin === 'string' ? candidate.plugin : defaults.plugin,
    pluginConfig:
      candidate.pluginConfig && typeof candidate.pluginConfig === 'object' && !Array.isArray(candidate.pluginConfig)
        ? (candidate.pluginConfig as JsonObject)
        : defaults.pluginConfig,
    expandableStubComponent:
      typeof candidate.expandableStubComponent === 'string' ? candidate.expandableStubComponent : defaults.expandableStubComponent,
    expandableContentComponent:
      typeof candidate.expandableContentComponent === 'string' ? candidate.expandableContentComponent : defaults.expandableContentComponent,
    expandableStub: typeof candidate.expandableStub === 'string' ? candidate.expandableStub : defaults.expandableStub,
    expandableStubCss:
      typeof candidate.expandableStubCss === 'string'
        ? candidate.expandableStubCss
        : readExpandablePartCss(candidate.expandableStubBlocks) || defaults.expandableStubCss,
    expandableStubDescription:
      typeof candidate.expandableStubDescription === 'string'
        ? candidate.expandableStubDescription
        : readExpandablePartDescription(candidate.expandableStubBlocks) || defaults.expandableStubDescription,
    expandableStubBlocks: parseExpandablePart(candidate.expandableStubBlocks, seen, documentMeta),
    expandableAlwaysShowStub: candidate.expandableAlwaysShowStub !== false,
    expandableExpanded: candidate.expandableExpanded === true,
    expandableContentCss:
      typeof candidate.expandableContentCss === 'string'
        ? candidate.expandableContentCss
        : readExpandablePartCss(candidate.expandableContentBlocks) || defaults.expandableContentCss,
    expandableContentDescription:
      typeof candidate.expandableContentDescription === 'string'
        ? candidate.expandableContentDescription
        : readExpandablePartDescription(candidate.expandableContentBlocks) || defaults.expandableContentDescription,
    expandableContentBlocks: parseExpandablePart(candidate.expandableContentBlocks, seen, documentMeta),
    tableColumns: parseTableColumns(candidate.tableColumns, defaults.tableColumns),
    tableShowHeader: candidate.tableShowHeader !== false,
    tableRows: rows.map((row) => {
      const mapped = row as JsonObject;
      return {
        cells: Array.isArray(mapped.cells) ? mapped.cells.map((cell) => String(cell ?? '')) : createDefaultTableRow(2).cells,
      };
    }),
    imageFile: typeof candidate.imageFile === 'string' ? candidate.imageFile : defaults.imageFile,
    imageAlt: typeof candidate.imageAlt === 'string' ? candidate.imageAlt : defaults.imageAlt,
    buttonLabel: typeof candidate.buttonLabel === 'string' ? candidate.buttonLabel : defaults.buttonLabel,
    buttonAction: 'ai-generate',
    buttonVisibleScript: typeof candidate.buttonVisibleScript === 'string' ? candidate.buttonVisibleScript : defaults.buttonVisibleScript,
    buttonSourceScript: typeof candidate.buttonSourceScript === 'string' ? candidate.buttonSourceScript : defaults.buttonSourceScript,
    buttonPrompt: typeof candidate.buttonPrompt === 'string' ? candidate.buttonPrompt : defaults.buttonPrompt,
    buttonTargetScript: typeof candidate.buttonTargetScript === 'string' ? candidate.buttonTargetScript : defaults.buttonTargetScript,
    buttonInputCharLimit: parsePositiveNumber(candidate.buttonInputCharLimit, defaults.buttonInputCharLimit),
    buttonOutputCharLimit: parsePositiveNumber(candidate.buttonOutputCharLimit, defaults.buttonOutputCharLimit),
    buttonPositionTargetId: typeof candidate.buttonPositionTargetId === 'string' ? candidate.buttonPositionTargetId : defaults.buttonPositionTargetId,
    buttonCss: typeof candidate.buttonCss === 'string' ? candidate.buttonCss : defaults.buttonCss,
  };
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
  return {
    key: makeId('section'),
    customId: '',
    contained: true,
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
    templateKey: undefined,
    blocks: component ? [createEmptyBlock(component)] : [],
    children: [],
  };
}

export function createDefaultTableRow(columnCount: number): TableRow {
  return {
    cells: new Array(Math.max(columnCount, 1)).fill(''),
  };
}

export function createBlankDocument(): VisualDocument {
  return {
    meta: {
      hvy_version: 0.1,
      reader_max_width: DEFAULT_READER_MAX_WIDTH,
      section_defaults: {
        css: DEFAULT_SECTION_CSS,
      },
    },
    extension: '.hvy',
    sections: [],
    attachments: [],
  };
}

// Clone/reusable functions (mutually recursive with schemaFromUnknown)

export function cloneReusableSchema(schema: BlockSchema, componentName = schema.component): BlockSchema {
  const cloned = schemaFromUnknown(JSON.parse(JSON.stringify(schema)) as JsonObject);
  cloned.component = componentName;
  cloned.containerBlocks = cloned.containerBlocks.map((block) => cloneReusableBlock(block));
  cloned.componentListBlocks = cloned.componentListBlocks.map((block) => cloneReusableBlock(block));
  cloned.gridItems = cloned.gridItems.map((item) => ({
    ...item,
    block: cloneReusableBlock(item.block),
  }));
  cloned.expandableStubBlocks.children = cloned.expandableStubBlocks.children.map((block) => cloneReusableBlock(block));
  cloned.expandableContentBlocks.children = cloned.expandableContentBlocks.children.map((block) => cloneReusableBlock(block));
  return cloned;
}

function cloneReusableSchemaFromMeta(schema: BlockSchema, componentName: string, documentMeta: JsonObject): BlockSchema {
  const cloned = schemaFromUnknown(JSON.parse(JSON.stringify(schema)) as JsonObject, new WeakSet<object>(), documentMeta);
  cloned.component = componentName;
  cloned.containerBlocks = cloned.containerBlocks.map((block) => cloneReusableBlockFromMeta(block, documentMeta));
  cloned.componentListBlocks = cloned.componentListBlocks.map((block) => cloneReusableBlockFromMeta(block, documentMeta));
  cloned.gridItems = cloned.gridItems.map((item) => ({
    ...item,
    block: cloneReusableBlockFromMeta(item.block, documentMeta),
  }));
  cloned.expandableStubBlocks.children = cloned.expandableStubBlocks.children.map((block) => cloneReusableBlockFromMeta(block, documentMeta));
  cloned.expandableContentBlocks.children = cloned.expandableContentBlocks.children.map((block) => cloneReusableBlockFromMeta(block, documentMeta));
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

function cloneReusableBlockFromMeta(block: VisualBlock, documentMeta: JsonObject): VisualBlock {
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
    templateKey: section.templateKey,
    blocks: section.blocks.map((block) => cloneReusableBlock(block)),
    children: section.children.map((child) => cloneReusableSectionWithDelta(child, levelDelta)),
  };
}

export function getReusableTemplate(def: ComponentDefinition): VisualBlock {
  if (def.template) {
    return def.template;
  }
  const fallbackSchema = def.schema ? cloneReusableSchema(def.schema, def.name) : defaultBlockSchema(def.name);
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
    : defaultBlockSchema(componentName);
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
  schema.gridItems = schema.gridItems.map((item) => ({
    id: item.id || makeId('griditem'),
    block: item.block && typeof item.block === 'object' && 'id' in item.block && 'schema' in item.block
      ? item.block
      : item.block ? _parseBlock(item.block) : _createBlock('text', true),
  }));
}
