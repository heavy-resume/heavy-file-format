/**
 * How sections and components appear as CLI files: their JSON, body text, table data, form scripts, and about text,
 * read from and written back to the live node. Used by the directory listings in `virtual-file-system.ts`.
 */
import { cliBlockMetadata } from './block-metadata-fields';
import { templatePathSegment } from './template-directories';
import type { BlockSchema, BuiltinComponentName, VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import { getSectionId } from '../section-ops';
import { FORM_PLUGIN_ID, SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { parseFormSpec, serializeFormSpec } from '../plugins/form-spec/form-spec';
import { getTableColumnProperties, getTableColumns, setTableColumns } from '../table-ops';
import { getHvyComponentHelpLines, getHvySectionHelpLines } from '../component-help';
import { getComponentDefsFromMeta, resolveBaseComponentFromMeta } from '../component-defs';
import { assertCssValueIsDeclarationString } from '../css-value-validation';
import { coerceGridColumns, coerceGridStackWidth } from '../grid-ops';
import { normalizeTextCaption } from '../caption';
import { defaultBlockSchema, parseTableColumnProperties } from '../document-factory';
import { sanitizePathSegment, uniqueName } from './virtual-path-names';
import type { HvyVirtualEntry } from './virtual-file-system';

export function sectionToCliJson(section: VisualSection): JsonObject {
  return {
    id: getSectionId(section),
    title: section.title,
    lock: section.lock,
    editorOnly: section.editorOnly,
    expanded: section.expanded,
    highlight: section.highlight,
    contained: section.contained,
    css: section.css,
    tags: section.tags,
    description: section.description,
    location: section.location,
    hideIfUnmodified: section.hideIfUnmodified === true,
    exclude_from_import: section.exclude_from_import === true,
    templateKey: section.templateKey ?? '',
  };
}

export function formatSectionInfo(section: VisualSection): string {
  return [
    formatSectionAbout(section).trimEnd(),
    '',
    'This section',
    `id: ${getSectionId(section) || '(none)'}`,
    `name: ${section.title || '(untitled)'}`,
    ...(section.description?.trim() ? [`description: ${section.description.trim()}`] : []),
    ...(section.tags?.trim() ? [`tags: ${section.tags.trim()}`] : []),
    ...(section.location ? [`location: ${section.location}`] : []),
    '',
  ].join('\n');
}

export function formatSectionAbout(section: VisualSection): string {
  const helpLines = getHvySectionHelpLines();
  return `${[
    ...(helpLines.length > 0 ? [helpLines[0] ?? ''] : ['# Sections #']),
    ...(section.description?.trim() ? ['', 'Section description:', section.description.trim()] : []),
    '',
    ...(helpLines.length > 1 ? helpLines.slice(1) : helpLines.length === 0 ? ['No section documentation is registered yet.'] : []),
    '',
  ].join('\n')}`;
}

export function applySectionJson(section: VisualSection, value: JsonObject): void {
  if (typeof value.id === 'string') {
    section.customId = value.id;
    section.customIdGenerated = false;
  }
  if (typeof value.title === 'string') section.title = value.title;
  if (typeof value.lock === 'boolean') section.lock = value.lock;
  if (typeof value.editorOnly === 'boolean') section.editorOnly = value.editorOnly;
  if (typeof value.expanded === 'boolean') section.expanded = value.expanded;
  if (typeof value.highlight === 'boolean') section.highlight = value.highlight;
  if (typeof value.contained === 'boolean') section.contained = value.contained;
  if (typeof value.css === 'string') {
    assertCssValueIsDeclarationString(value.css, 'section.json css');
    section.css = value.css;
  }
  if (typeof value.tags === 'string') section.tags = validateTags(value.tags, 'section.json tags');
  if (typeof value.description === 'string') section.description = value.description;
  if (value.location === 'sidebar' || value.location === 'main') section.location = value.location;
  if (typeof value.hideIfUnmodified === 'boolean') section.hideIfUnmodified = value.hideIfUnmodified;
  if (typeof value.exclude_from_import === 'boolean') section.exclude_from_import = value.exclude_from_import;
}

export function blockSchemaToCliJson(schema: BlockSchema, meta: JsonObject): JsonObject {
  return cliBlockMetadata(schema, resolveBaseComponentFromMeta(schema.component, meta) as BuiltinComponentName);
}

export function formatComponentAbout(meta: JsonObject, component: string): string {
  const definition = getComponentDefsFromMeta(meta).find((candidate) => candidate.name === component);
  const baseComponent = resolveBaseComponentFromMeta(component, meta);
  const helpLines = getHvyComponentHelpLines(baseComponent);
  const isReusableComponent = !!definition && definition.name !== baseComponent;
  if (!isReusableComponent) {
    return `${(helpLines.length > 0 ? helpLines : [`# ${component} Components #`, 'No component documentation is registered yet.']).join('\n').trimEnd()}\n`;
  }
  const lines = [
    `About ${component}`,
    `component template: ${definition.name}`,
    definition.baseType ? `base component: ${definition.baseType}` : '',
    'Edit this reusable definition under /templates/components. Use ls to discover its directory, then edit definition.json or the nested schema files.',
    `Definition metadata: /templates/components/${templatePathSegment(definition.name)}/definition.json`,
    `Definition contents: /templates/components/${templatePathSegment(definition.name)}/schema/`,
    definition.description ? `Description: ${definition.description}` : '',
    '',
    'Virtual directory mapping:',
    ...formatComponentDirectoryMapping(component, baseComponent),
    '',
    ...(helpLines.length > 0 ? helpLines : [`${component} component: no component documentation is registered yet.`]),
    '',
  ].filter((line, index, all) => line || all[index - 1] !== '');
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatComponentDirectoryMapping(component: string, baseComponent: string): string[] {
  const configFile = `${component}.json`;
  const bodyFile = `${component}.txt`;
  const lines = [
    `- /${sanitizePathSegment(component) || 'component'} contains one ${component} component instance.`,
    `- ${configFile} is writable instance configuration for this component.`,
    `- ${component}.css is writable instance CSS mirrored from ${configFile}.`,
    `- ${bodyFile} is the body/preview file for this component when the base type exposes text content.`,
  ];
  if (baseComponent === 'expandable') {
    lines.push('- expandable-stub/ contains the always-visible summary children.');
    lines.push('- expandable-content/ contains the revealed detail children.');
    lines.push("- expandable-stub/children-order.json reorders components inside the expandable's stub.");
    lines.push("- expandable-content/children-order.json reorders components inside the expandable's content.");
  } else if (baseComponent === 'container') {
    lines.push('- container/ contains the ordered child components.');
    lines.push('- container/children-order.json reorders container children.');
  } else if (baseComponent === 'component-list') {
    lines.push('- repeated child item components appear directly as sibling directories in this component-list directory.');
    lines.push('- children-order.json reorders list items.');
  } else if (baseComponent === 'grid') {
    lines.push('- grid/ contains the grid item components.');
    lines.push('- grid/children-order.json reorders grid items.');
  } else if (baseComponent === 'table') {
    lines.push('- tableColumns.json and tableRows.json are writable static table data files.');
    lines.push('- tableColumnProperties.json is a writable sparse presentation map keyed by exact column name.');
  } else if (baseComponent === 'plugin') {
    lines.push('- plugin.txt is plugin-owned body text; plugin.json contains plugin id and config.');
  }
  return lines;
}

export function applyBlockSchemaJson(
  schema: BlockSchema,
  component: string,
  baseComponent: BuiltinComponentName,
  value: JsonObject
): void {
  const defaults = defaultBlockSchema(component, baseComponent);
  for (const field of ['expandableStubCss', 'expandableContentCss'] as const) {
    if (baseComponent === 'expandable' && typeof value[field] === 'string') {
      assertCssValueIsDeclarationString(value[field], `${component}.json ${field}`);
    }
  }
  if (baseComponent === 'button' && typeof value.buttonCss === 'string') {
    assertCssValueIsDeclarationString(value.buttonCss, `${component}.json buttonCss`);
  }
  schema.component = component;
  Object.assign(schema, cliBlockMetadata(defaults, baseComponent));
  if (typeof value.id === 'string') schema.id = value.id;
  if (typeof value.css === 'string') {
    assertCssValueIsDeclarationString(value.css, `${component}.json css`);
    schema.css = value.css;
  }
  if (value.sortKeys && typeof value.sortKeys === 'object' && !Array.isArray(value.sortKeys)) {
    schema.sortKeys = parseSortKeys(value.sortKeys);
  }
  if (Array.isArray(value.derivedSortKeyNames)) {
    schema.derivedSortKeyNames = parseStringList(value.derivedSortKeyNames);
  }
  if (Array.isArray(value.derivedGroupKeyNames)) {
    schema.derivedGroupKeyNames = parseStringList(value.derivedGroupKeyNames);
  }
  if (value.groupKeys && typeof value.groupKeys === 'object' && !Array.isArray(value.groupKeys)) {
    schema.groupKeys = parseGroupKeys(value.groupKeys);
  }
  if (typeof value.editorOnly === 'boolean') schema.editorOnly = value.editorOnly;
  if (typeof value.visibleScript === 'string') schema.visibleScript = value.visibleScript;
  if (typeof value.lock === 'boolean') schema.lock = value.lock;
  if (value.align === 'left' || value.align === 'center' || value.align === 'right') schema.align = value.align;
  if (value.slot === 'left' || value.slot === 'center' || value.slot === 'right') schema.slot = value.slot;
  if (typeof value.tags === 'string') schema.tags = validateTags(value.tags, `${component}.json tags`);
  if (typeof value.description === 'string') schema.description = value.description;
  if (typeof value.hideIfYes === 'string') schema.hideIfYes = value.hideIfYes;
  if (typeof value.placeholder === 'string') schema.placeholder = value.placeholder;
  if (typeof value.fillIn === 'boolean') schema.fillIn = value.fillIn;
  if (baseComponent === 'text' && typeof value.showCopy === 'boolean') schema.showCopy = value.showCopy;
  if (baseComponent === 'code' && typeof value.codeLanguage === 'string') schema.codeLanguage = value.codeLanguage;
  if (baseComponent === 'button') {
    for (const field of ['buttonLabel', 'buttonVisibleScript', 'buttonSourceScript', 'buttonPrompt', 'buttonTargetScript', 'buttonPositionTargetId', 'buttonCss'] as const) {
      if (typeof value[field] === 'string') schema[field] = value[field];
    }
    if (value.buttonAction === 'ai-generate') schema.buttonAction = value.buttonAction;
    for (const field of ['buttonInputCharLimit', 'buttonOutputCharLimit'] as const) {
      if (typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] > 0) schema[field] = value[field];
    }
  }
  if (typeof value.containerTitle === 'string') schema.containerTitle = value.containerTitle;
  if (typeof value.containerExpanded === 'boolean') schema.containerExpanded = value.containerExpanded;
  if (typeof value.noSave === 'boolean') schema.noSave = value.noSave;
  if (typeof value.containerCollapsedPreviewRem === 'number' && Number.isFinite(value.containerCollapsedPreviewRem) && value.containerCollapsedPreviewRem > 0) {
    schema.containerCollapsedPreviewRem = value.containerCollapsedPreviewRem;
  }
  if (typeof value.componentListComponent === 'string') schema.componentListComponent = value.componentListComponent;
  if (typeof value.componentListItemLabel === 'string') schema.componentListItemLabel = value.componentListItemLabel;
  if (typeof value.componentListDefaultSortKey === 'string') schema.componentListDefaultSortKey = value.componentListDefaultSortKey;
  if (value.componentListDefaultSortDirection === 'asc' || value.componentListDefaultSortDirection === 'desc') {
    schema.componentListDefaultSortDirection = value.componentListDefaultSortDirection;
  }
  if (typeof value.componentListDefaultGroupKey === 'string') schema.componentListDefaultGroupKey = value.componentListDefaultGroupKey;
  if (typeof value.componentListGroupsExpanded === 'boolean') schema.componentListGroupsExpanded = value.componentListGroupsExpanded;
  if (typeof value.componentListGroupCollapsedPreviewRem === 'number' && Number.isFinite(value.componentListGroupCollapsedPreviewRem) && value.componentListGroupCollapsedPreviewRem > 0) {
    schema.componentListGroupCollapsedPreviewRem = value.componentListGroupCollapsedPreviewRem;
  }
  if (typeof value.gridColumns === 'number' || typeof value.gridColumns === 'string') {
    schema.gridColumns = coerceGridColumns(value.gridColumns);
  }
  if (typeof value.gridStackWidth === 'string') {
    schema.gridStackWidth = coerceGridStackWidth(value.gridStackWidth);
  }
  if (typeof value.xrefTitle === 'string') schema.xrefTitle = value.xrefTitle;
  if (typeof value.xrefDetail === 'string') schema.xrefDetail = value.xrefDetail;
  if (typeof value.xrefTarget === 'string') schema.xrefTarget = value.xrefTarget;
  if (typeof value.xrefTargetTagFilter === 'string') schema.xrefTargetTagFilter = value.xrefTargetTagFilter;
  if (Array.isArray(value.tableColumns)) setTableColumns(schema, parseStringList(value.tableColumns));
  if (typeof value.tableShowHeader === 'boolean') schema.tableShowHeader = value.tableShowHeader;
  if (Array.isArray(value.tableRows)) schema.tableRows = value.tableRows as unknown as BlockSchema['tableRows'];
  if (typeof value.imageFile === 'string') schema.imageFile = value.imageFile;
  if (typeof value.imageAlt === 'string') schema.imageAlt = value.imageAlt;
  if (typeof value.allowDocumentImageReuse === 'boolean') schema.allowDocumentImageReuse = value.allowDocumentImageReuse;
  if ('caption' in value) schema.caption = normalizeTextCaption(value.caption);
  if (Array.isArray(value.carouselImages)) schema.carouselImages = value.carouselImages
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const candidate = item as JsonObject;
      const imageFile = typeof candidate.imageFile === 'string' ? candidate.imageFile.trim() : '';
      if (!imageFile) return null;
      return {
        imageFile,
        imageAlt: typeof candidate.imageAlt === 'string' ? candidate.imageAlt : '',
        caption: typeof candidate.caption === 'string' ? candidate.caption : '',
      };
    })
    .filter((item): item is BlockSchema['carouselImages'][number] => item !== null);
  if (typeof value.carouselDurationMs === 'number' && Number.isFinite(value.carouselDurationMs) && value.carouselDurationMs > 0) {
    schema.carouselDurationMs = value.carouselDurationMs;
  }
  if (typeof value.carouselPauseOnHover === 'boolean') schema.carouselPauseOnHover = value.carouselPauseOnHover;
  if (typeof value.carouselShowControls === 'boolean') schema.carouselShowControls = value.carouselShowControls;
  if (typeof value.carouselShowIndicators === 'boolean') schema.carouselShowIndicators = value.carouselShowIndicators;
  if (typeof value.carouselShowFrame === 'boolean') schema.carouselShowFrame = value.carouselShowFrame;
  if (typeof value.plugin === 'string') schema.plugin = value.plugin;
  if (value.pluginConfig && typeof value.pluginConfig === 'object' && !Array.isArray(value.pluginConfig)) {
    schema.pluginConfig = value.pluginConfig as JsonObject;
  }
  if (value.pluginSortValues && typeof value.pluginSortValues === 'object' && !Array.isArray(value.pluginSortValues)) {
    schema.pluginSortValues = parseSortKeys(value.pluginSortValues);
  }
  if (value.pluginGroupValues && typeof value.pluginGroupValues === 'object' && !Array.isArray(value.pluginGroupValues)) {
    schema.pluginGroupValues = parseGroupKeys(value.pluginGroupValues);
  }
  if (baseComponent === 'expandable') {
    if (typeof value.expandableAlwaysShowStub === 'boolean') schema.expandableAlwaysShowStub = value.expandableAlwaysShowStub;
    if (typeof value.expandableExpanded === 'boolean') schema.expandableExpanded = value.expandableExpanded;
    if (value.expandablePresentation === 'inline' || value.expandablePresentation === 'modal') schema.expandablePresentation = value.expandablePresentation;
    if (typeof value.expandableStubCss === 'string') schema.expandableStubCss = value.expandableStubCss;
    if (typeof value.expandableContentCss === 'string') schema.expandableContentCss = value.expandableContentCss;
    if (typeof value.expandableStubDescription === 'string') schema.expandableStubDescription = value.expandableStubDescription;
    if (typeof value.expandableContentDescription === 'string') schema.expandableContentDescription = value.expandableContentDescription;
  }
}

export function readBlockBodyText(block: VisualBlock, meta: JsonObject): string {
  const baseComponent = getBlockBaseComponent(meta, block);
  if (baseComponent === 'table') {
    return formatTableBodyText(block.schema);
  }
  if (baseComponent === 'xref-card') {
    return formatXrefCardBodyText(block.schema);
  }
  if (block.text) {
    return block.text;
  }
  return collectNestedTextBlocks(block).map((child) => child.text).join('\n');
}

export function addTableDataFiles(entries: Map<string, HvyVirtualEntry>, meta: JsonObject, block: VisualBlock, blockPath: string): void {
  if (getBlockBaseComponent(meta, block) !== 'table') {
    return;
  }
  entries.set(`${blockPath}/tableColumns.json`, {
    kind: 'file',
    path: `${blockPath}/tableColumns.json`,
    read: () => `${JSON.stringify(getTableColumns(block.schema), null, 2)}\n`,
    write: (content) => {
      setTableColumns(block.schema, parseJsonStringArray(content, `${blockPath}/tableColumns.json`));
    },
  });
  entries.set(`${blockPath}/tableColumnProperties.json`, {
    kind: 'file',
    path: `${blockPath}/tableColumnProperties.json`,
    read: () => `${JSON.stringify(Object.fromEntries(
      [...new Set([
        ...getTableColumns(block.schema),
        ...Object.keys(block.schema.tableColumnProperties ?? {}),
      ])].map((column) => [column, getTableColumnProperties(block.schema, column)])
    ), null, 2)}\n`,
    write: (content) => {
      block.schema.tableColumnProperties = parseTableColumnProperties(
        parseJsonObject(content, `${blockPath}/tableColumnProperties.json`)
      );
    },
  });
  entries.set(`${blockPath}/tableRows.json`, {
    kind: 'file',
    path: `${blockPath}/tableRows.json`,
    read: () => `${JSON.stringify(block.schema.tableRows, null, 2)}\n`,
    write: (content) => {
      block.schema.tableRows = parseJsonTableRows(content, `${blockPath}/tableRows.json`);
    },
  });
}

export function writeBlockBodyText(block: VisualBlock, meta: JsonObject, content: string): void {
  const baseComponent = getBlockBaseComponent(meta, block);
  if (baseComponent === 'table') {
    throw new Error(
      'table.txt is a read-only preview for static table components. Edit tableColumns.json, tableColumnProperties.json, and tableRows.json instead.'
    );
  }

  const nestedTextBlocks = collectNestedTextBlocks(block);
  if (baseComponent === 'component-list' && nestedTextBlocks.length === 0) {
    throw new Error(
      'component-list.txt is a read-only preview until list items exist. component-list.json defines the item type and children-order.json controls item order.'
    );
  }

  if (block.text || nestedTextBlocks.length === 0) {
    block.text = content;
    return;
  }

  const lines = content.split('\n');
  if (lines.length !== nestedTextBlocks.length) {
    throw new Error(
      `Nested body edits must preserve one line per nested text block: expected ${nestedTextBlocks.length} line${nestedTextBlocks.length === 1 ? '' : 's'}, got ${lines.length}. Use hvy request_structure COMPONENT_ID --describe to find leaf files, then edit those leaf body/config files instead of replacing the aggregate body.`
    );
  }
  nestedTextBlocks.forEach((child, index) => {
    child.text = lines[index] ?? '';
  });
}

function formatTableBodyText(schema: BlockSchema): string {
  const columns = getTableColumns(schema);
  const rows = schema.tableRows.map((row) => row.cells);
  const lines = [columns, ...rows].map((cells) => cells.map((cell) => cell.trim()).join(' | '));
  return `${lines.join('\n')}\n`;
}

function formatXrefCardBodyText(schema: BlockSchema): string {
  const title = schema.xrefTitle.trim();
  const detail = schema.xrefDetail.trim();
  const target = schema.xrefTarget.trim();
  if (!title && !detail && !target) {
    return '';
  }
  const label = [title, detail].filter(Boolean).join(' - ') || title || target;
  return target ? `${label} -> ${target}\n` : `${label}\n`;
}

function parseJsonStringArray(content: string, filename: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`${filename} must be a JSON array of strings.`);
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${filename} must be a JSON array of strings.`);
  }
  return value;
}

function parseJsonTableRows(content: string, filename: string): BlockSchema['tableRows'] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`${filename} must be a JSON array of row objects with cells arrays.`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${filename} must be a JSON array of row objects with cells arrays.`);
  }
  return value.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Array.isArray((row as JsonObject).cells)) {
      throw new Error(`${filename} row ${index + 1} must be an object with a cells array.`);
    }
    return { cells: parseStringList((row as JsonObject).cells as unknown[]) };
  });
}

function parseStringList(value: unknown[]): string[] {
  return value.map((item) => String(item ?? ''));
}

function parseSortKeys(value: object): BlockSchema['sortKeys'] {
  const sortKeys: BlockSchema['sortKeys'] = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      sortKeys[key] = raw;
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      sortKeys[key] = raw;
    }
  }
  return sortKeys;
}

function parseGroupKeys(value: object): BlockSchema['groupKeys'] {
  const groupKeys: BlockSchema['groupKeys'] = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (typeof raw === 'string') {
      groupKeys[key] = raw;
    }
  });
  return groupKeys;
}

export function addFormScriptFiles(entries: Map<string, HvyVirtualEntry>, block: VisualBlock, blockPath: string): void {
  if (block.schema.component !== 'plugin' || block.schema.plugin !== FORM_PLUGIN_ID) {
    return;
  }
  const parsed = parseFormSpec(block.text, block.schema.pluginConfig);
  if (parsed.error) {
    return;
  }
  for (const scriptName of Object.keys(parsed.spec.scripts)) {
    const filename = uniqueName(`${sanitizePathSegment(scriptName) || 'script'}.py`, entries, blockPath);
    entries.set(`${blockPath}/${filename}`, {
      kind: 'file',
      path: `${blockPath}/${filename}`,
      read: () => parseFormSpec(block.text, block.schema.pluginConfig).spec.scripts[scriptName] ?? '',
      write: (content) => {
        const current = parseFormSpec(block.text, block.schema.pluginConfig);
        if (current.error) {
          throw new Error(`${blockPath}/plugin.txt has invalid form YAML; fix plugin.txt before editing ${filename}.`);
        }
        current.spec.scripts[scriptName] = content;
        block.text = serializeFormSpec(current.spec);
      },
    });
  }
}

export function getBlockBaseComponent(meta: JsonObject, block: VisualBlock): string {
  return resolveBaseComponentFromMeta(block.schema.component, meta);
}

export function bodyFileNameForBlock(block: VisualBlock, meta: JsonObject): string {
  if (getBlockBaseComponent(meta, block) === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID) {
    return 'script.py';
  }
  return `${sanitizePathSegment(block.schema.component) || 'component'}.txt`;
}

function collectNestedTextBlocks(block: VisualBlock): VisualBlock[] {
  return [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ].flatMap((child) => (child.text ? [child] : collectNestedTextBlocks(child)));
}

export function parseJsonObject(content: string, path: string): JsonObject {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed as JsonObject;
}

export function omitTemplateDefinitions(meta: JsonObject): JsonObject {
  const { component_defs: _componentDefs, section_defs: _sectionDefs, ...rest } = meta;
  return rest;
}




export function componentNameFromPath(path: string): string {
  const name = path.split('/').pop() ?? 'text.json';
  return name.replace(/\.json$/i, '') || 'text';
}

function validateTags(value: string, fieldName: string): string {
  if (/[\[\]]/.test(value)) {
    throw new Error(`${fieldName} cannot contain [ or ]. Tags are displayed as tags=[...] by the CLI.`);
  }
  return value;
}


