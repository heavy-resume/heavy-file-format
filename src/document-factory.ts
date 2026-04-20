import type { Align, BlockSchema, ExpandablePart, Slot, TableRow, VisualBlock, VisualSection } from './editor/types';
import type { JsonObject } from './hvy/types';
import type { ComponentDefinition, VisualDocument } from './types';
import { makeId } from './utils';
import { getComponentDefs, getSectionDefs, resolveBaseComponent } from './component-defs';
import { coerceGridColumn, coerceGridColumns, createGridItem as _createGridItem, parseGridItems as _parseGridItems } from './grid-ops';
import { getTableColumns } from './table-ops';
import { REUSABLE_SECTION_DEF_PREFIX } from './state';

export function defaultBlockSchema(component = 'text'): BlockSchema {
  return {
    id: '',
    component,
    lock: false,
    align: 'left',
    slot: 'center',
    customCss: 'margin: 0.5rem 0;',
    codeLanguage: 'ts',
    containerBlocks: [],
    componentListComponent: 'text',
    componentListBlocks: [],
    gridColumns: 2,
    gridItems: [],
    tags: '',
    description: '',
    placeholder: '',
    metaOpen: false,
    xrefTitle: '',
    xrefDetail: '',
    xrefTarget: '',
    pluginUrl: '',
    expandableStubComponent: 'container',
    expandableContentComponent: 'container',
    expandableStub: '',
    expandableStubCss: '',
    expandableStubBlocks: { lock: false, children: [] },
    expandableAlwaysShowStub: true,
    expandableExpanded: false,
    expandableContentCss: '',
    expandableContentBlocks: { lock: false, children: [] },
    tableColumns: 'Column 1, Column 2',
    tableShowHeader: true,
    tableRows: [],
  };
}

export function parseExpandablePart(raw: unknown): ExpandablePart {
  // New format: { lock: boolean, children: VisualBlock[] }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as JsonObject;
    return {
      lock: obj.lock === true,
      children: Array.isArray(obj.children) ? obj.children.map((b) => parseVisualBlock(b)) : [],
    };
  }
  // Backward compat: old flat array format
  if (Array.isArray(raw)) {
    return { lock: false, children: raw.map((b) => parseVisualBlock(b)) };
  }
  return { lock: false, children: [] };
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

export function parseVisualBlock(candidate: unknown): VisualBlock {
  if (!candidate || typeof candidate !== 'object') {
    return createEmptyBlock('container', true);
  }
  const raw = candidate as JsonObject;
  // Shorthand: { component: 'name' } without a 'schema' wrapper.
  // Instantiate from the component def template so all nested content (titles, blocks, etc.) is populated.
  if (!raw.schema && typeof raw.component === 'string') {
    return createEmptyBlock(raw.component);
  }
  const schema = schemaFromUnknown(raw.schema);
  return {
    id: typeof raw.id === 'string' ? raw.id : makeId('block'),
    text: typeof raw.text === 'string' ? raw.text : '',
    schema,
    schemaMode: raw.schemaMode === true,
  };
}

export function schemaFromUnknown(value: unknown): BlockSchema {
  if (!value || typeof value !== 'object') {
    return defaultBlockSchema('text');
  }
  const candidate = value as JsonObject;
  const component = typeof candidate.component === 'string' ? candidate.component : 'text';
  const defaults = defaultBlockSchema(component);
  const rows = Array.isArray(candidate.tableRows) ? candidate.tableRows : [];
  const gridColumns = coerceGridColumns(candidate.gridColumns ?? candidate.gridTemplateColumns);
  const parsedGridItems = _parseGridItems(candidate, gridColumns, component, _createBlockSkip, parseVisualBlock);
  return {
    component,
    id: typeof candidate.id === 'string' ? candidate.id : defaults.id,
    lock: candidate.lock === true,
    align: coerceAlign(typeof candidate.align === 'string' ? candidate.align : 'left'),
    slot: coerceSlot(typeof candidate.slot === 'string' ? candidate.slot : 'center'),
    customCss:
      typeof candidate.css === 'string'
        ? candidate.css
        : typeof candidate.customCss === 'string'
        ? candidate.customCss
        : typeof candidate.custom_css === 'string'
        ? candidate.custom_css
        : defaults.customCss,
    codeLanguage: typeof candidate.codeLanguage === 'string' ? candidate.codeLanguage : defaults.codeLanguage,
    containerBlocks: Array.isArray(candidate.containerBlocks)
      ? candidate.containerBlocks.map((block) => parseVisualBlock(block))
      : [],
    componentListComponent:
      typeof candidate.componentListComponent === 'string' ? candidate.componentListComponent : defaults.componentListComponent,
    componentListBlocks: Array.isArray(candidate.componentListBlocks)
      ? candidate.componentListBlocks.map((block) => parseVisualBlock(block))
      : [],
    gridColumns,
    gridItems: parsedGridItems,
    tags: typeof candidate.tags === 'string' ? candidate.tags : defaults.tags,
    description: typeof candidate.description === 'string' ? candidate.description : defaults.description,
    placeholder: typeof candidate.placeholder === 'string' ? candidate.placeholder : defaults.placeholder,
    metaOpen: candidate.metaOpen === true,
    xrefTitle: typeof candidate.xrefTitle === 'string' ? candidate.xrefTitle : defaults.xrefTitle,
    xrefDetail: typeof candidate.xrefDetail === 'string' ? candidate.xrefDetail : defaults.xrefDetail,
    xrefTarget: typeof candidate.xrefTarget === 'string' ? candidate.xrefTarget : defaults.xrefTarget,
    pluginUrl: typeof candidate.pluginUrl === 'string' ? candidate.pluginUrl : defaults.pluginUrl,
    expandableStubComponent:
      typeof candidate.expandableStubComponent === 'string' ? candidate.expandableStubComponent : defaults.expandableStubComponent,
    expandableContentComponent:
      typeof candidate.expandableContentComponent === 'string' ? candidate.expandableContentComponent : defaults.expandableContentComponent,
    expandableStub: typeof candidate.expandableStub === 'string' ? candidate.expandableStub : defaults.expandableStub,
    expandableStubCss: typeof candidate.expandableStubCss === 'string' ? candidate.expandableStubCss : defaults.expandableStubCss,
    expandableStubBlocks: parseExpandablePart(candidate.expandableStubBlocks),
    expandableAlwaysShowStub: candidate.expandableAlwaysShowStub !== false,
    expandableExpanded: candidate.expandableExpanded === true,
    expandableContentCss: typeof candidate.expandableContentCss === 'string' ? candidate.expandableContentCss : defaults.expandableContentCss,
    expandableContentBlocks: parseExpandablePart(candidate.expandableContentBlocks),
    tableColumns: typeof candidate.tableColumns === 'string' ? candidate.tableColumns : defaults.tableColumns,
    tableShowHeader: candidate.tableShowHeader !== false,
    tableRows: rows.map((row) => {
      const mapped = row as JsonObject;
      return {
        cells: Array.isArray(mapped.cells) ? mapped.cells.map((cell) => String(cell ?? '')) : createDefaultTableRow(2).cells,
        expanded: mapped.expanded === true,
        clickable: mapped.clickable !== false,
        detailsTitle: typeof mapped.detailsTitle === 'string' ? mapped.detailsTitle : '',
        detailsContent:
          typeof mapped.detailsContent === 'string' ? mapped.detailsContent : typeof mapped.details === 'string' ? mapped.details : '',
        detailsComponent: 'container',
        detailsBlocks: Array.isArray(mapped.detailsBlocks)
          ? mapped.detailsBlocks.map((block) => parseVisualBlock(block))
          : createDefaultTableRow(2).detailsBlocks,
      };
    }),
  };
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

export function createEmptyBlock(component = 'text', skipComponentDefaults = false): VisualBlock {
  const reusableInstance = instantiateReusableBlock(component);
  if (reusableInstance) {
    return reusableInstance;
  }
  const schema = defaultBlockSchema(component);
  if (!skipComponentDefaults) {
    applyComponentDefaults(schema, component);
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
    lock: false,
    idEditorOpen: false,
    isGhost,
    title: isGhost ? 'New Component' : 'Unnamed Section',
    level,
    expanded: true,
    highlight: false,
    customCss: '',
    tags: '',
    description: '',
    location: 'main',
    blocks: component ? [createEmptyBlock(component)] : [],
    children: [],
  };
}

export function createDefaultTableRow(columnCount: number): TableRow {
  return {
    cells: new Array(Math.max(columnCount, 1)).fill(''),
    expanded: false,
    clickable: true,
    detailsTitle: '',
    detailsContent: '',
    detailsComponent: 'container',
    detailsBlocks: [createEmptyBlock('container', true)],
  };
}

export function createBlankDocument(): VisualDocument {
  return {
    meta: {
      hvy_version: 0.1,
    },
    extension: '.hvy',
    sections: [],
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
  cloned.tableRows = cloned.tableRows.map((row) => ({
    ...row,
    detailsBlocks: (row.detailsBlocks ?? []).map((block) => cloneReusableBlock(block)),
  }));
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

export function cloneReusableSection(section: VisualSection, targetLevel = section.level): VisualSection {
  const levelDelta = targetLevel - section.level;
  return cloneReusableSectionWithDelta(section, levelDelta);
}

function cloneReusableSectionWithDelta(section: VisualSection, levelDelta: number): VisualSection {
  return {
    key: makeId('section'),
    customId: '',
    contained: section.contained !== false,
    idEditorOpen: false,
    isGhost: false,
    title: section.title,
    level: Math.max(1, Math.min(6, section.level + levelDelta)),
    lock: section.lock,
    expanded: section.expanded,
    highlight: section.highlight,
    customCss: section.customCss,
    tags: section.tags,
    description: section.description,
    location: section.location ?? 'main',
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

export function instantiateReusableSection(name: string, level: number): VisualSection | null {
  const normalizedName = name.startsWith(REUSABLE_SECTION_DEF_PREFIX) ? name.slice(REUSABLE_SECTION_DEF_PREFIX.length) : name;
  const def = getSectionDefs().find((item) => item.name === normalizedName);
  if (!def) {
    return null;
  }
  return cloneReusableSection(def.template, level);
}

export function applyComponentDefaults(schema: BlockSchema, componentName: string): void {
  const def = getComponentDefs().find((item) => item.name === componentName);
  const base = resolveBaseComponent(componentName);
  if (def?.template) {
    const next = cloneReusableSchema(def.template.schema, componentName);
    Object.assign(schema, next);
    return;
  }
  if (def?.schema) {
    Object.assign(schema, cloneReusableSchema(def.schema, componentName));
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
    schema.gridItems = [_createGridItem(0, schema.gridColumns, _createBlock), _createGridItem(1, schema.gridColumns, _createBlock)];
    return;
  }
  if (schema.gridItems.length === 0) {
    schema.gridItems.push(_createGridItem(0, schema.gridColumns, _createBlock));
  }
  schema.gridItems = schema.gridItems.map((item) => ({
    id: item.id || makeId('griditem'),
    column: coerceGridColumn(item.column, schema.gridColumns),
    block: item.block && typeof item.block === 'object' && 'id' in item.block && 'schema' in item.block
      ? item.block
      : item.block ? _parseBlock(item.block) : _createBlock('text', true),
  }));
}
