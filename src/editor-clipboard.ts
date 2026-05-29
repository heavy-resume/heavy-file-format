import { cloneReusableBlock, cloneReusableSection, createEmptyBlock } from './document-factory';
import { getImageAttachmentId, setAttachment } from './attachments';
import { isBuiltinComponentName, resolveBaseComponentFromMeta } from './component-defs';
import { isPdfAllowedComponent, isPdfAllowedComponentInstance, isPdfDocument } from './pdf-document-capabilities';
import { applyReusableTemplateValues, extractReusableTemplateVariablesFromDefinition } from './reusable-template-values';
import type { BlockSchema, VisualBlock, VisualSection } from './editor/types';
import type { ComponentDefinition, DocumentAttachment, HvyEditorClipboardHost, HvyEditorClipboardPayload, VisualDocument } from './types';

let editorClipboard: HvyEditorClipboardPayload | null = null;
let editorClipboardHost: HvyEditorClipboardHost | null = null;

export function setEditorClipboardHost(host: HvyEditorClipboardHost | null): void {
  editorClipboardHost = host;
}

export function copyComponentToEditorClipboard(
  block: VisualBlock,
  attachments: DocumentAttachment[] = [],
  options: { unwrapIntoEmptyContainer?: boolean; sourceDocument?: VisualDocument } = {}
): void {
  writeEditorClipboard({
    kind: 'component',
    block: cloneReusableBlock(block),
    attachments: cloneAttachments(attachments),
    componentDefs: options.sourceDocument ? collectReferencedComponentDefinitions(options.sourceDocument, [block]) : [],
    ...(options.unwrapIntoEmptyContainer ? { pasteBehavior: { unwrapIntoEmptyContainer: true } } : {}),
  });
}

export function copySectionToEditorClipboard(section: VisualSection, attachments: DocumentAttachment[] = [], sourceDocument?: VisualDocument): void {
  writeEditorClipboard({
    kind: 'section',
    section: cloneReusableSection(section),
    attachments: cloneAttachments(attachments),
    componentDefs: sourceDocument ? collectReferencedComponentDefinitions(sourceDocument, section.blocks) : [],
  });
}

export function hasComponentInEditorClipboard(): boolean {
  return readEditorClipboard()?.kind === 'component';
}

export function hasSectionInEditorClipboard(): boolean {
  return readEditorClipboard()?.kind === 'section';
}

export function cloneComponentFromEditorClipboard(): VisualBlock | null {
  return cloneComponentClipboardEntry()?.block ?? null;
}

export function cloneComponentClipboardEntry(): { block: VisualBlock; unwrapIntoEmptyContainer: boolean } | null {
  const clipboard = readEditorClipboard();
  return clipboard?.kind === 'component'
    ? {
        block: cloneReusableBlock(clipboard.block),
        unwrapIntoEmptyContainer: clipboard.pasteBehavior?.unwrapIntoEmptyContainer === true,
      }
    : null;
}

export function cloneAttachmentsFromEditorClipboard(): DocumentAttachment[] {
  return cloneAttachments(readEditorClipboard()?.attachments ?? []);
}

export function collectBlockAttachments(document: VisualDocument, block: VisualBlock): DocumentAttachment[] {
  const attachmentIds = new Set<string>();
  collectBlockAttachmentIds(block, attachmentIds);
  return document.attachments.filter((attachment) => attachmentIds.has(attachment.id));
}

export function collectSectionAttachments(document: VisualDocument, section: VisualSection): DocumentAttachment[] {
  const attachmentIds = new Set<string>();
  collectSectionAttachmentIds(section, attachmentIds);
  return document.attachments.filter((attachment) => attachmentIds.has(attachment.id));
}

export function installEditorClipboardAttachments(document: VisualDocument): void {
  cloneAttachmentsFromEditorClipboard().forEach((attachment) => {
    setAttachment(document, attachment.id, attachment.meta, attachment.bytes);
  });
}

export function installEditorClipboardComponentDefinitions(document: VisualDocument): void {
  const clipboardDefs = readEditorClipboard()?.componentDefs ?? [];
  if (clipboardDefs.length === 0) {
    return;
  }
  const existingDefs = Array.isArray(document.meta.component_defs) ? document.meta.component_defs : [];
  const existingNames = new Set(existingDefs.map((def) => def.name));
  const mergedMeta = buildClipboardMergedMeta(document);
  const defsToInstall = clipboardDefs
    .filter((def) => !existingNames.has(def.name))
    .map((def) => cloneComponentDefinitionForDocument(def, document, mergedMeta))
    .filter((def): def is ComponentDefinition => def !== null);
  if (defsToInstall.length === 0) {
    return;
  }
  document.meta.component_defs = [...existingDefs, ...defsToInstall];
}

export function prepareComponentDefinitionForDocumentPasteWithResult(
  document: VisualDocument,
  definition: ComponentDefinition,
  mergedMeta: VisualDocument['meta']
): { definition: ComponentDefinition | null; removedCount: number } {
  if (!isPdfDocument(document)) {
    return { definition: cloneComponentDefinition(definition), removedCount: 0 };
  }
  const prepared = cloneComponentDefinitionForDocument(definition, document, mergedMeta);
  return {
    definition: prepared,
    removedCount: isPdfAllowedComponent(definition.name, mergedMeta) ? 0 : 1,
  };
}

export function prepareSectionForDocumentPaste(document: VisualDocument, section: VisualSection): VisualSection {
  if (!isPdfDocument(document)) {
    return section;
  }
  const meta = buildClipboardMergedMeta(document);
  const prepared = prepareSectionForPdfPaste(document, section, meta);
  return prepared.section;
}

export function prepareSectionForDocumentPasteWithResult(
  document: VisualDocument,
  section: VisualSection
): { section: VisualSection; removedCount: number } {
  if (!isPdfDocument(document)) {
    return { section, removedCount: 0 };
  }
  return prepareSectionForPdfPaste(document, section, buildClipboardMergedMeta(document));
}

function prepareSectionForPdfPaste(
  document: VisualDocument,
  section: VisualSection,
  meta: VisualDocument['meta']
): { section: VisualSection; removedCount: number } {
  const preparedBlocks = pruneBlocksForPdfPaste(section.blocks, meta);
  section.blocks = preparedBlocks.blocks;
  let removedCount = preparedBlocks.removedCount;
  section.children = section.children.map((child) => {
    const prepared = prepareSectionForPdfPaste(document, child, meta);
    removedCount += prepared.removedCount;
    return prepared.section;
  });
  if (isPdfDocument(document)) {
    section.children = section.children.filter((child) => child.blocks.length > 0 || child.children.length > 0);
  }
  return { section, removedCount };
}

export function prepareBlockForDocumentPaste(document: VisualDocument, block: VisualBlock): VisualBlock | null {
  if (!isPdfDocument(document)) {
    return block;
  }
  return prepareBlockForDocumentPasteWithResult(document, block).block;
}

export function prepareBlockForDocumentPasteWithResult(
  document: VisualDocument,
  block: VisualBlock
): { block: VisualBlock | null; removedCount: number } {
  if (!isPdfDocument(document)) {
    return { block, removedCount: 0 };
  }
  const prepared = pruneBlockForPdfPaste(block, buildClipboardMergedMeta(document));
  return { block: wrapMultipleBlocksForSingleBlockPaste(prepared.blocks), removedCount: prepared.removedCount };
}

export function cloneSectionFromEditorClipboard(targetLevel?: number): VisualSection | null {
  const clipboard = readEditorClipboard();
  return clipboard?.kind === 'section'
    ? cloneReusableSection(clipboard.section, targetLevel ?? clipboard.section.level)
    : null;
}

function readEditorClipboard(): HvyEditorClipboardPayload | null {
  return editorClipboardHost?.read() ?? editorClipboard;
}

function writeEditorClipboard(payload: HvyEditorClipboardPayload): void {
  if (editorClipboardHost) {
    editorClipboardHost.write(payload);
    return;
  }
  editorClipboard = payload;
}

function cloneAttachments(attachments: DocumentAttachment[]): DocumentAttachment[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    meta: { ...attachment.meta },
    bytes: Uint8Array.from(attachment.bytes),
  }));
}

function collectSectionAttachmentIds(section: VisualSection, attachmentIds: Set<string>): void {
  section.blocks.forEach((block) => collectBlockAttachmentIds(block, attachmentIds));
  section.children.forEach((child) => collectSectionAttachmentIds(child, attachmentIds));
}

function collectBlockAttachmentIds(block: VisualBlock, attachmentIds: Set<string>): void {
  const imageFile = typeof block.schema.imageFile === 'string' ? block.schema.imageFile.trim() : '';
  if (imageFile) {
    attachmentIds.add(getImageAttachmentId(imageFile));
  }
  (block.schema.carouselImages ?? []).forEach((image) => {
    if (image.imageFile.trim()) {
      attachmentIds.add(getImageAttachmentId(image.imageFile.trim()));
    }
  });
  (block.schema.containerBlocks ?? []).forEach((child) => collectBlockAttachmentIds(child, attachmentIds));
  (block.schema.componentListBlocks ?? []).forEach((child) => collectBlockAttachmentIds(child, attachmentIds));
  (block.schema.expandableStubBlocks?.children ?? []).forEach((child) => collectBlockAttachmentIds(child, attachmentIds));
  (block.schema.expandableContentBlocks?.children ?? []).forEach((child) => collectBlockAttachmentIds(child, attachmentIds));
  (block.schema.gridItems ?? []).forEach((item) => collectBlockAttachmentIds(item.block, attachmentIds));
}

function collectReferencedComponentDefinitions(document: VisualDocument, blocks: VisualBlock[]): ComponentDefinition[] {
  const definitions = Array.isArray(document.meta.component_defs) ? document.meta.component_defs : [];
  const defsByName = new Map(definitions.map((def) => [def.name, def]));
  const selected = new Map<string, ComponentDefinition>();
  const visitComponentName = (componentName: string): void => {
    if (!componentName.trim() || isBuiltinComponentName(componentName) || selected.has(componentName)) {
      return;
    }
    const definition = defsByName.get(componentName);
    if (!definition) {
      return;
    }
    selected.set(componentName, definition);
    visitDefinition(definition);
  };
  const visitBlock = (block: VisualBlock): void => {
    visitSchema(block.schema);
  };
  const visitSchema = (schema: VisualBlock['schema']): void => {
    visitComponentName(schema.component);
    if (typeof schema.componentListComponent === 'string') {
      visitComponentName(schema.componentListComponent);
    }
    (schema.containerBlocks ?? []).forEach(visitBlock);
    (schema.componentListBlocks ?? []).forEach(visitBlock);
    (schema.expandableStubBlocks?.children ?? []).forEach(visitBlock);
    (schema.expandableContentBlocks?.children ?? []).forEach(visitBlock);
    (schema.gridItems ?? []).forEach((item) => visitBlock(item.block));
  };
  const visitDefinition = (definition: ComponentDefinition): void => {
    if (definition.schema) {
      visitSchema(definition.schema);
    }
    if (definition.template) {
      visitBlock(definition.template);
    }
    (definition.flavors ?? []).forEach((flavor) => {
      if (flavor.schema) {
        visitSchema(flavor.schema);
      }
      if (flavor.template) {
        visitBlock(flavor.template);
      }
    });
  };

  blocks.forEach(visitBlock);
  return Array.from(selected.values()).map(cloneComponentDefinition);
}

function buildClipboardMergedMeta(document: VisualDocument): VisualDocument['meta'] {
  const clipboardDefs = readEditorClipboard()?.componentDefs ?? [];
  if (clipboardDefs.length === 0) {
    return document.meta;
  }
  const existingDefs = Array.isArray(document.meta.component_defs) ? document.meta.component_defs : [];
  const byName = new Map(existingDefs.map((def) => [def.name, def]));
  clipboardDefs.forEach((def) => {
    if (!byName.has(def.name)) {
      const compatibleDef = cloneComponentDefinitionForDocument(def, document, {
        ...document.meta,
        component_defs: [...existingDefs, ...clipboardDefs],
      });
      if (compatibleDef) {
        byName.set(def.name, compatibleDef);
      }
    }
  });
  return {
    ...document.meta,
    component_defs: Array.from(byName.values()),
  };
}

function pruneBlocksForPdfPaste(blocks: VisualBlock[], meta: VisualDocument['meta']): { blocks: VisualBlock[]; removedCount: number } {
  let removedCount = 0;
  const nextBlocks: VisualBlock[] = [];
  blocks.forEach((block) => {
    const prepared = pruneBlockForPdfPaste(block, meta);
    removedCount += prepared.removedCount;
    nextBlocks.push(...prepared.blocks);
  });
  return { blocks: nextBlocks, removedCount };
}

function pruneBlockForPdfPaste(block: VisualBlock, meta: VisualDocument['meta']): { blocks: VisualBlock[]; removedCount: number } {
  if (block.schema.kind === 'expandable') {
    if (!isBuiltinComponentName(block.schema.component) && isPdfAllowedComponentForPaste(block.schema.component, meta)) {
      block.schema = convertExpandableSchemaToPdfContainerSchema(block.schema);
      applyAdaptedComponentDefinitionBlocksIfEmpty(block, meta);
      const prepared = pruneBlocksForPdfPaste(block.schema.containerBlocks, meta);
      block.schema.containerBlocks = prepared.blocks;
      return { blocks: [block], removedCount: prepared.removedCount + 1 };
    }
    const converted = convertExpandableBlockToPdfContainers(block);
    const prepared = pruneBlocksForPdfPaste(converted, meta);
    return { blocks: prepared.blocks, removedCount: prepared.removedCount + 1 };
  }
  if (resolveBaseComponentFromMeta(block.schema.component, meta) === 'expandable') {
    const converted = convertExpandableBlockToPdfContainers(block);
    const prepared = pruneBlocksForPdfPaste(converted, meta);
    return { blocks: prepared.blocks, removedCount: prepared.removedCount + 1 };
  }
  if (!isPdfAllowedComponentForPaste(block.schema.component, meta, block.schema.plugin)) {
    return { blocks: [], removedCount: 1 };
  }
  if (
    block.schema.component === 'component-list'
    && block.schema.componentListComponent.trim().length > 0
    && !isPdfAllowedComponentForPaste(block.schema.componentListComponent, meta)
  ) {
    return { blocks: [], removedCount: 1 };
  }
  let removedCount = 0;
  if (Array.isArray(block.schema.containerBlocks)) {
    applyAdaptedComponentDefinitionBlocksIfEmpty(block, meta);
    const prepared = pruneBlocksForPdfPaste(block.schema.containerBlocks, meta);
    block.schema.containerBlocks = prepared.blocks;
    removedCount += prepared.removedCount;
  }
  if (Array.isArray(block.schema.componentListBlocks)) {
    const prepared = pruneBlocksForPdfPaste(block.schema.componentListBlocks, meta);
    block.schema.componentListBlocks = prepared.blocks;
    removedCount += prepared.removedCount;
  }
  if (block.schema.expandableStubBlocks) {
    const prepared = pruneBlocksForPdfPaste(block.schema.expandableStubBlocks.children, meta);
    block.schema.expandableStubBlocks.children = prepared.blocks;
    removedCount += prepared.removedCount;
  }
  if (block.schema.expandableContentBlocks) {
    const prepared = pruneBlocksForPdfPaste(block.schema.expandableContentBlocks.children, meta);
    block.schema.expandableContentBlocks.children = prepared.blocks;
    removedCount += prepared.removedCount;
  }
  if (Array.isArray(block.schema.gridItems)) {
    const nextItems: typeof block.schema.gridItems = [];
    block.schema.gridItems.forEach((item) => {
      const prepared = pruneBlockForPdfPaste(item.block, meta);
      removedCount += prepared.removedCount;
      const child = wrapMultipleBlocksForSingleBlockPaste(prepared.blocks);
      if (child) {
        nextItems.push({ ...item, block: child });
      }
    });
    block.schema.gridItems = nextItems;
  }
  return { blocks: [block], removedCount };
}

function cloneComponentDefinition(definition: ComponentDefinition): ComponentDefinition {
  return JSON.parse(JSON.stringify(definition)) as ComponentDefinition;
}

function isPdfAllowedComponentForPaste(
  componentName: string,
  meta: VisualDocument['meta'],
  pluginId?: string
): boolean {
  if (isBuiltinComponentName(componentName)) {
    return isPdfAllowedComponentInstance(componentName, meta, pluginId);
  }
  return hasComponentDefinitionInMeta(componentName, meta) && isPdfAllowedComponent(componentName, meta);
}

function hasComponentDefinitionInMeta(componentName: string, meta: VisualDocument['meta']): boolean {
  const defs = meta.component_defs;
  return Array.isArray(defs) && defs.some((def) => def.name === componentName);
}

function getComponentDefinitionFromMeta(componentName: string, meta: VisualDocument['meta']): ComponentDefinition | null {
  const defs = meta.component_defs;
  if (!Array.isArray(defs)) {
    return null;
  }
  return defs.find((def) => def.name === componentName) ?? null;
}

function applyAdaptedComponentDefinitionBlocksIfEmpty(block: VisualBlock, meta: VisualDocument['meta']): void {
  if (block.schema.kind !== 'container' || block.schema.containerBlocks.length > 0) {
    return;
  }
  const definition = getComponentDefinitionFromMeta(block.schema.component, meta);
  const definitionBlocks = definition?.schema?.containerBlocks ?? [];
  block.schema.containerBlocks = definitionBlocks.map((child) => cloneReusableBlock(child)).filter(hasMeaningfulPdfPasteContent);
  if (definition) {
    const variables = extractReusableTemplateVariablesFromDefinition(definition);
    applyReusableTemplateValues(block, inferTemplateValuesFromInstance(block, definition, variables.map((variable) => variable.name)), variables);
  }
}

function inferTemplateValuesFromInstance(
  block: VisualBlock,
  definition: ComponentDefinition,
  variableNames: string[]
): Record<string, string> {
  const values = Object.fromEntries(variableNames.map((name) => [name, '']));
  inferTemplateValuesFromStrings(definition.schema?.xrefTitle, block.schema.xrefTitle, values);
  inferTemplateValuesFromStrings(definition.schema?.xrefDetail, block.schema.xrefDetail, values);
  inferTemplateValuesFromStrings(definition.schema?.id, block.schema.id, values);
  inferTemplateValuesFromStrings(definition.schema?.description, block.schema.description, values);
  return values;
}

function inferTemplateValuesFromStrings(template: unknown, actual: unknown, values: Record<string, string>): void {
  if (typeof template !== 'string' || typeof actual !== 'string' || actual.trim().length === 0) {
    return;
  }
  const match = template.match(/^\s*{%\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\|\s*(?:text|block)\s*)?%}\s*$/);
  const name = match?.[1] ?? '';
  if (name && Object.prototype.hasOwnProperty.call(values, name)) {
    values[name] = actual;
  }
}

function cloneComponentDefinitionForDocument(
  definition: ComponentDefinition,
  document: VisualDocument,
  mergedMeta: VisualDocument['meta']
): ComponentDefinition | null {
  if (!isPdfDocument(document)) {
    return cloneComponentDefinition(definition);
  }
  const sourceBaseType = definition.baseType || resolveBaseComponentFromMeta(definition.name, {
    ...mergedMeta,
    component_defs: [definition],
  });
  if (sourceBaseType !== 'expandable') {
    if (isPdfAllowedComponent(definition.name, {
      ...mergedMeta,
      component_defs: [definition],
    })) {
      return cloneComponentDefinition(definition);
    }
    return null;
  }
  const converted = cloneComponentDefinition(definition);
  converted.baseType = 'container';
  if (definition.schema) {
    converted.schema = convertExpandableSchemaToPdfContainerSchema(definition.schema);
  }
  if (definition.template) {
    converted.template = convertExpandableTemplateToPdfContainer(definition.template);
  }
  converted.flavors = converted.flavors?.map((flavor) => ({
    ...flavor,
    schema: flavor.schema ? convertExpandableSchemaToPdfContainerSchema(flavor.schema) : flavor.schema,
    template: flavor.template ? convertExpandableTemplateToPdfContainer(flavor.template) : flavor.template,
  }));
  if (!componentDefinitionHasPdfContainerContent(converted)) {
    return null;
  }
  return converted;
}

function componentDefinitionHasPdfContainerContent(definition: ComponentDefinition): boolean {
  return Boolean(
    (definition.schema?.containerBlocks?.length ?? 0) > 0
      || (definition.template?.schema.containerBlocks?.length ?? 0) > 0
      || definition.flavors?.some(
        (flavor) => (flavor.schema?.containerBlocks?.length ?? 0) > 0 || (flavor.template?.schema.containerBlocks?.length ?? 0) > 0
      )
  );
}

function convertExpandableTemplateToPdfContainer(template: VisualBlock): VisualBlock {
  const converted = createEmptyBlock('container');
  converted.text = template.text;
  converted.schema = convertExpandableSchemaToPdfContainerSchema(template.schema);
  converted.schema.component = template.schema.component;
  return converted;
}

function convertExpandableSchemaToPdfContainerSchema(schema: BlockSchema): BlockSchema {
  const container = createEmptyBlock('container').schema;
  container.component = schema.component;
  copyReusableSchemaFields(schema, container);
  container.containerBlocks = convertExpandableSchemaToPdfContainerBlocks(schema);
  return container;
}

function copyReusableSchemaFields(source: BlockSchema, target: BlockSchema): void {
  if (typeof source.id === 'string') target.id = source.id;
  if (typeof source.editorOnly === 'boolean') target.editorOnly = source.editorOnly;
  if (typeof source.lock === 'boolean') target.lock = source.lock;
  if (source.align === 'left' || source.align === 'center' || source.align === 'right') target.align = source.align;
  if (source.slot === 'left' || source.slot === 'center' || source.slot === 'right') target.slot = source.slot;
  if (typeof source.css === 'string') target.css = source.css;
  if (source.sortKeys && typeof source.sortKeys === 'object') target.sortKeys = { ...source.sortKeys };
  if (source.groupKeys && typeof source.groupKeys === 'object') target.groupKeys = { ...source.groupKeys };
  if (typeof source.tags === 'string') target.tags = source.tags;
  if (typeof source.description === 'string') target.description = source.description;
  if (typeof source.hideIfYes === 'string') target.hideIfYes = source.hideIfYes;
  if (typeof source.visibleScript === 'string') target.visibleScript = source.visibleScript;
  if (typeof source.placeholder === 'string') target.placeholder = source.placeholder;
  if (typeof source.fillIn === 'boolean') target.fillIn = source.fillIn;
  if (typeof source.metaOpen === 'boolean') target.metaOpen = source.metaOpen;
  if (typeof source.xrefTitle === 'string') target.xrefTitle = source.xrefTitle;
  if (typeof source.xrefDetail === 'string') target.xrefDetail = source.xrefDetail;
}

function convertExpandableBlockToPdfContainers(block: VisualBlock): VisualBlock[] {
  return convertExpandableSchemaToPdfContainerBlocks(block.schema).map((container, index) => {
    if (index === 0) {
      container.id = block.id;
      container.schema.id = block.schema.id;
      container.schema.tags = block.schema.tags;
      container.schema.description = block.schema.description;
      container.schema.xrefTitle = block.schema.xrefTitle;
      container.schema.xrefDetail = block.schema.xrefDetail;
    }
    return container;
  });
}

function convertExpandableSchemaToPdfContainerBlocks(schema: BlockSchema): VisualBlock[] {
  const blocks: VisualBlock[] = [];
  const stubChildren = schema.expandableStubBlocks?.children ?? [];
  const contentChildren = schema.expandableContentBlocks?.children ?? [];
  const stub = makePdfContainerFromExpandablePart(stubChildren, schema.expandableStubCss ?? '');
  const content = makePdfContainerFromExpandablePart(contentChildren, schema.expandableContentCss ?? '');
  if (stub) {
    blocks.push(stub);
  }
  if (content) {
    blocks.push(content);
  }
  return blocks;
}

function makePdfContainerFromExpandablePart(children: VisualBlock[], css: string): VisualBlock | null {
  const containerBlocks = children.map((child) => cloneReusableBlock(child)).filter(hasMeaningfulPdfPasteContent);
  if (containerBlocks.length === 0) {
    return null;
  }
  const container = createEmptyBlock('container');
  container.schema.css = css.trim() || 'margin: 0.35rem 0;';
  container.schema.containerBlocks = containerBlocks;
  return container;
}

function hasMeaningfulPdfPasteContent(block: VisualBlock): boolean {
  const baseComponent = block.schema.kind;
  if (baseComponent === 'container') {
    return block.schema.containerBlocks.some(hasMeaningfulPdfPasteContent);
  }
  if (baseComponent === 'text' || baseComponent === 'code') {
    return block.text.trim().length > 0 || block.schema.placeholder.trim().length > 0 || block.schema.fillIn === true;
  }
  if (baseComponent === 'component-list') {
    return block.schema.componentListComponent.trim().length > 0 || block.schema.componentListBlocks.some(hasMeaningfulPdfPasteContent);
  }
  if (baseComponent === 'grid') {
    return block.schema.gridItems.some((item) => hasMeaningfulPdfPasteContent(item.block));
  }
  if (baseComponent === 'image') {
    return block.schema.imageFile.trim().length > 0;
  }
  if (baseComponent === 'expandable') {
    return block.schema.expandableStubBlocks.children.some(hasMeaningfulPdfPasteContent)
      || block.schema.expandableContentBlocks.children.some(hasMeaningfulPdfPasteContent);
  }
  return true;
}

function wrapMultipleBlocksForSingleBlockPaste(blocks: VisualBlock[]): VisualBlock | null {
  if (blocks.length === 0) {
    return null;
  }
  if (blocks.length === 1) {
    return blocks[0] ?? null;
  }
  const wrapper = createEmptyBlock('container');
  wrapper.schema.containerBlocks = blocks;
  return wrapper;
}
