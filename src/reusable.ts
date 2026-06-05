import type { VisualBlock } from './editor/types';
import { state, incrementSyncReusableCount, getRenderApp, getRefreshReaderPanels } from './state';
import { getComponentDefs, getReusableNameFromSectionKey, isBuiltinComponent, resolveBaseComponent, getSectionDefs } from './component-defs';
import { findSectionByKey, visitBlocks } from './section-ops';
import { cloneReusableBlock, cloneReusableSchema, getReusableTemplate, getReusableTemplateByName, cloneReusableSection } from './document-factory';
import type { ComponentDefinition } from './types';

export function findReusableOwner(sectionKey: string, blockId: string): VisualBlock | null {
  const reusableName = getReusableNameFromSectionKey(sectionKey);
  if (reusableName) {
    const template = getReusableTemplateByName(reusableName);
    if (!template) {
      return null;
    }
    return findReusableOwnerInList([template], blockId, null);
  }
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section) {
    return null;
  }
  return findReusableOwnerInList(section.blocks, blockId, null);
}

export function findReusableOwnerInList(blocks: VisualBlock[], blockId: string, currentOwner: VisualBlock | null): VisualBlock | null {
  for (const block of blocks) {
    const nextOwner = isBuiltinComponent(block.schema.component) ? currentOwner : block;
    if (block.id === blockId) {
      return nextOwner;
    }
    const nested = findReusableOwnerInList(block.schema.containerBlocks ?? [], blockId, nextOwner)
      ?? findReusableOwnerInList(block.schema.componentListBlocks ?? [], blockId, nextOwner)
      ?? findReusableOwnerInList((block.schema.gridItems ?? []).map((item) => item.block), blockId, nextOwner)
      ?? findReusableOwnerInList(block.schema.expandableStubBlocks?.children ?? [], blockId, nextOwner)
      ?? findReusableOwnerInList(block.schema.expandableContentBlocks?.children ?? [], blockId, nextOwner);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function syncReusableTemplateForBlock(sectionKey: string, blockId: string): void {
  const syncId = incrementSyncReusableCount();
  const startedAt = performance.now();
  let ownerMs = 0;
  let cloneMs = 0;
  let applyMs = 0;
  let skipped: string | null = null;
  const log = (): void => {
    console.debug('[hvy:perf] syncReusableTemplateForBlock', {
      syncId,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      ownerMs: Number(ownerMs.toFixed(2)),
      cloneMs: Number(cloneMs.toFixed(2)),
      applyMs: Number(applyMs.toFixed(2)),
      sectionKey,
      blockId,
      skipped,
      advanced: state.showAdvancedEditor,
    });
  };
  if (!state.showAdvancedEditor) {
    skipped = 'basic-editor';
    log();
    return;
  }
  const reusableName = getReusableNameFromSectionKey(sectionKey);
  if (!reusableName) {
    skipped = 'document-instance';
    log();
    return;
  }
  let stepStartedAt = performance.now();
  const owner = findReusableOwner(sectionKey, blockId);
  ownerMs = performance.now() - stepStartedAt;
  if (!owner || isBuiltinComponent(owner.schema.component)) {
    skipped = owner ? 'builtin-component' : 'no-owner';
    log();
    return;
  }
  const defs = getComponentDefs();
  const def = defs.find((item) => item.name === owner.schema.component);
  if (!def) {
    skipped = 'missing-def';
    log();
    return;
  }
  stepStartedAt = performance.now();
  if (reusableName === def.name) {
    def.template = owner;
  } else {
    def.template = cloneReusableBlock(owner);
  }
  def.baseType = resolveBaseComponent(def.name);
  def.tags = owner.schema.tags;
  def.description = owner.schema.description;
  def.schema = cloneReusableSchema(def.template.schema, def.name);
  state.document.meta.component_defs = defs;
  cloneMs = performance.now() - stepStartedAt;
  stepStartedAt = performance.now();
  applyReusableTemplateToDocument(def.name, def.template, null);
  applyMs = performance.now() - stepStartedAt;
  log();
}

export function applyReusableTemplateToDocument(name: string, template: VisualBlock, excludeBlockId: string | null): void {
  visitBlocks(state.document.sections, (block) => {
    if (block.schema.component !== name || block.id === excludeBlockId) {
      return;
    }
    const next = cloneReusableBlock(template);
    block.text = next.text;
    block.schema = next.schema;
    block.schema.component = name;
  });
}

export function revertReusableComponent(def: ComponentDefinition): void {
  const template = getReusableTemplate(def);
  visitBlocks(state.document.sections, (block) => {
    if (block.schema.component !== def.name) {
      return;
    }
    const next = cloneReusableBlock(template);
    block.text = next.text;
    block.schema = next.schema;
    block.schema.component = def.baseType;
  });
}

export function saveReusableFromModal(
  app: HTMLElement,
  deps: {
    findBlockByIds: (sectionKey: string, blockId: string) => VisualBlock | null;
    recordHistory: (group?: string) => void;
    closeModal: () => void;
  },
  options: { mode?: 'save-as-new' | 'update-existing' | 'add-flavor' } = {}
): void {
  const modal = state.reusableSaveModal;
  if (!modal) {
    return;
  }
  const updateExisting = options.mode === 'update-existing' && !!modal.existingName;
  const input = app.querySelector<HTMLInputElement>('#reusableNameInput');
  const draftName = (updateExisting ? modal.existingName ?? '' : input?.value ?? modal.draftName).trim();
  if (!draftName) {
    input?.focus();
    return;
  }

  if (modal.kind === 'component' && modal.blockId) {
    if (options.mode === 'add-flavor' && modal.existingName) {
      saveReusableComponentFlavor(modal.sectionKey, modal.blockId, modal.existingName, draftName, app, deps);
      return;
    }
    saveReusableComponent(modal.sectionKey, modal.blockId, draftName, deps);
    return;
  }

  if (options.mode === 'add-flavor' && modal.existingName) {
    saveReusableSectionFlavor(modal.sectionKey, modal.existingName, draftName, app, deps);
    return;
  }
  saveReusableSection(modal.sectionKey, draftName, deps);
}

function saveReusableComponentFlavor(
  sectionKey: string,
  blockId: string,
  componentName: string,
  flavorName: string,
  app: HTMLElement,
  deps: {
    findBlockByIds: (sectionKey: string, blockId: string) => VisualBlock | null;
    recordHistory: (group?: string) => void;
    closeModal: () => void;
  }
): void {
  const block = deps.findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  if (!flavorName.trim()) {
    app.querySelector<HTMLInputElement>('#reusableNameInput')?.focus();
    return;
  }
  const description = app.querySelector<HTMLTextAreaElement>('#reusableFlavorDescriptionInput')?.value ?? block.schema.description ?? '';
  deps.recordHistory(`save-def-flavor:${blockId}`);
  const defs = getComponentDefs();
  const def = defs.find((item) => item.name === componentName);
  if (!def) {
    return;
  }
  const flavors = Array.isArray(def.flavors) ? def.flavors : [];
  const nextFlavor = {
    name: flavorName,
    description,
    templateVariables: def.templateVariables,
    schema: cloneReusableSchema(block.schema, componentName),
  };
  const existing = flavors.find((item) => item.name === flavorName);
  if (existing) {
    existing.description = nextFlavor.description;
    existing.templateVariables = nextFlavor.templateVariables;
    existing.schema = nextFlavor.schema;
    delete existing.template;
  } else {
    flavors.push(nextFlavor);
  }
  def.flavors = flavors;
  state.document.meta.component_defs = defs;
  deps.closeModal();
  getRenderApp()();
  getRefreshReaderPanels()();
}

function saveReusableComponent(
  sectionKey: string,
  blockId: string,
  name: string,
  deps: {
    findBlockByIds: (sectionKey: string, blockId: string) => VisualBlock | null;
    recordHistory: (group?: string) => void;
    closeModal: () => void;
  }
): void {
  const block = deps.findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  deps.recordHistory(`save-def:${blockId}`);
  const defs = getComponentDefs();
  const existing = defs.find((def) => def.name === name);
  const baseType = resolveBaseComponent(block.schema.component);
  const schema = cloneReusableSchema(block.schema, baseType);
  const templateSchema = cloneReusableSchema(block.schema, baseType);
  templateSchema.component = name;
  const nextDef = {
    name,
    baseType,
    tags: block.schema.tags,
    description: block.schema.description,
    schema,
    template: cloneReusableBlock({
      ...block,
      schema: templateSchema,
    }),
  };
  if (existing) {
    existing.baseType = nextDef.baseType;
    existing.tags = nextDef.tags;
    existing.description = nextDef.description;
    existing.schema = nextDef.schema;
    existing.template = nextDef.template;
  } else {
    defs.push(nextDef);
  }
  state.document.meta.component_defs = defs;
  state.selectedReusableComponentName = name;
  block.schema.component = name;
  deps.closeModal();
  getRenderApp()();
  getRefreshReaderPanels()();
}

function saveReusableSection(
  sectionKey: string,
  name: string,
  deps: {
    recordHistory: (group?: string) => void;
    closeModal: () => void;
  }
): void {
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section) {
    return;
  }
  deps.recordHistory(`save-section:${sectionKey}`);
  const defs = getSectionDefs();
  const existing = defs.find((def) => def.name === name);
  const template = cloneReusableSection(section);
  if (existing) {
    existing.template = template;
  } else {
    defs.push({ name, template });
  }
  state.document.meta.section_defs = defs;
  deps.closeModal();
  getRenderApp()();
}

function saveReusableSectionFlavor(
  sectionKey: string,
  sectionTemplateName: string,
  flavorName: string,
  app: HTMLElement,
  deps: {
    recordHistory: (group?: string) => void;
    closeModal: () => void;
  }
): void {
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section) {
    return;
  }
  const descriptionInput = app.querySelector<HTMLTextAreaElement>('#reusableFlavorDescriptionInput');
  deps.recordHistory(`save-section-flavor:${sectionTemplateName}:${flavorName}`);
  const defs = getSectionDefs();
  const def = defs.find((candidate) => candidate.name === sectionTemplateName);
  if (!def) {
    return;
  }
  const flavors = Array.isArray(def.flavors) ? def.flavors : [];
  const template = cloneReusableSection(section);
  const existing = flavors.find((candidate) => candidate.name === flavorName);
  const nextFlavor = {
    name: flavorName,
    description: descriptionInput?.value.trim() || undefined,
    templateVariables: def.templateVariables,
    template,
  };
  if (existing) {
    existing.description = nextFlavor.description;
    existing.templateVariables = nextFlavor.templateVariables;
    existing.template = nextFlavor.template;
  } else {
    flavors.push(nextFlavor);
  }
  def.flavors = flavors;
  state.document.meta.section_defs = defs;
  deps.closeModal();
  getRenderApp()();
}
