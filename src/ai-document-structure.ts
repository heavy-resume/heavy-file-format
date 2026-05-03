import { getHostPlugin } from './plugins/registry';
import type { VisualBlock, VisualSection } from './editor/types';
import type { VisualDocument } from './types';
import type { JsonObject } from './hvy/types';
import { getThemeColorLabel, THEME_COLOR_NAMES } from './theme';
import { getSectionId, visitBlocks } from './section-ops';
import {
  MAX_TEXT_PREVIEW_LENGTH,
  type ComponentRefEntry,
  type DocumentStructureSnapshot,
  type HeaderStructureSnapshot,
  type SectionRefEntry,
} from './ai-document-edit-types';

const MAX_SECTION_PREVIEW_LINES = 10;
const MAX_SUMMARY_NESTING = 2;
const HIDDEN_CONTENTS_MARKER = '... contents hidden ...';

export function summarizeHeaderStructure(document: VisualDocument): HeaderStructureSnapshot {
  const lines: string[] = [];
  const meta = document.meta;
  const visibleKeys = Object.keys(meta).filter((key) => !key.startsWith('_')).sort();
  lines.push('Header outline and properties');
  lines.push(`properties: ${visibleKeys.length > 0 ? visibleKeys.join(', ') : '(none)'}`);
  lines.push(`title: ${stringifyHeaderPreview(meta.title)}`);
  lines.push(`hvy_version: ${stringifyHeaderPreview(meta.hvy_version ?? 0.1)}`);
  lines.push(`reader_max_width: ${stringifyHeaderPreview(meta.reader_max_width)}`);
  lines.push(`sidebar_label: ${stringifyHeaderPreview(meta.sidebar_label)}`);
  lines.push(`template: ${stringifyHeaderPreview(meta.template)}`);
  lines.push(`theme.colors set: ${describeHeaderObjectKeys((meta.theme as JsonObject | undefined)?.colors)}`);
  lines.push(`component_defaults: ${describeHeaderObjectKeys(meta.component_defaults as JsonObject | undefined)}`);
  lines.push(`section_defaults: ${describeHeaderObjectKeys(meta.section_defaults as JsonObject | undefined)}`);
  lines.push(`plugins: ${Array.isArray(meta.plugins) ? meta.plugins.length : 0}`);
  lines.push(`schema: ${meta.schema && typeof meta.schema === 'object' ? 'present' : '(none)'}`);
  lines.push('');
  lines.push('known theme color variables:');
  lines.push(...describeKnownThemeColors(meta));
  lines.push('');
  lines.push('component_defs:');
  const componentDefs = Array.isArray(meta.component_defs) ? meta.component_defs : [];
  if (componentDefs.length === 0) {
    lines.push('- (none)');
  } else {
    componentDefs.forEach((def, index) => {
      const entry = def && typeof def === 'object' ? (def as JsonObject) : {};
      const keys = Object.keys(entry).sort().join(', ');
      lines.push(
        `- [${index}] name="${stringifyHeaderPreview(entry.name)}" baseType="${stringifyHeaderPreview(entry.baseType)}" description="${stringifyHeaderPreview(entry.description)}" properties="${keys || '(none)'}"`
      );
    });
  }
  lines.push('');
  lines.push('section_defs:');
  const sectionDefs = Array.isArray(meta.section_defs) ? meta.section_defs : [];
  if (sectionDefs.length === 0) {
    lines.push('- (none)');
  } else {
    sectionDefs.forEach((def, index) => {
      const entry = def && typeof def === 'object' ? (def as JsonObject) : {};
      lines.push(`- [${index}] name="${stringifyHeaderPreview(entry.name)}" title="${stringifyHeaderPreview(entry.title)}"`);
    });
  }
  lines.push('');
  lines.push('Reusable definition outlines show first-level metadata only. Use `grep_header` or `view_header` for exact YAML before patching definitions.');
  return {
    summary: lines.join('\n'),
  };
}

function shouldKeepExistingComponentRef(existing: ComponentRefEntry, next: ComponentRefEntry): boolean {
  if (!existing.hiddenFromSummary) {
    return true;
  }
  if (!next.hiddenFromSummary) {
    return false;
  }
  return componentRefChainScore(existing) <= componentRefChainScore(next);
}

function componentRefChainScore(entry: ComponentRefEntry): number {
  return entry.parentChain.reduce((score, label) => score + (/\bnested\.block\[\d+\]/.test(label) ? 1 : 0), 0);
}

export function summarizeDocumentStructure(document: VisualDocument): DocumentStructureSnapshot {
  const lines: string[] = [];
  const sectionRefs = new Map<string, SectionRefEntry>();
  const componentRefs = new Map<string, ComponentRefEntry>();
  const deepComponentRefs = new Map<string, ComponentRefEntry>();
  let componentCounter = 0;

  const registerComponentRef = (entry: ComponentRefEntry, refs: string[], visible: boolean): void => {
    for (const rawRef of refs) {
      const ref = rawRef.trim();
      if (!ref) {
        continue;
      }
      const existing = deepComponentRefs.get(ref);
      if (existing && shouldKeepExistingComponentRef(existing, entry)) {
        continue;
      }
      const refEntry = { ...entry, ref, target: ref };
      deepComponentRefs.set(ref, refEntry);
      if (visible) {
        componentRefs.set(ref, refEntry);
      }
    }
  };

  const addDeepComponentRef = (
    block: VisualBlock,
    sectionKey: string,
    parentChain: string[],
    hiddenFromSummary: boolean,
    fallbackRef?: string,
    slotAliases: string[] = []
  ): ComponentRefEntry => {
    const componentId = block.schema.id.trim();
    const entry: ComponentRefEntry = {
      ref: componentId || fallbackRef || '',
      blockId: block.id,
      sectionKey,
      componentId,
      component: block.schema.component,
      target: componentId || fallbackRef || '',
      parentChain,
      hiddenFromSummary,
      generated: componentId.length === 0,
    };
    registerComponentRef(entry, [componentId, fallbackRef ?? '', ...slotAliases], false);
    return entry;
  };

  const collectDeepRefs = (
    blocks: VisualBlock[],
    sectionKey: string,
    parentChain: string[],
    hiddenFromSummary: boolean,
    pathRef = 'nested'
  ): void => {
    blocks.forEach((block, index) => {
      const ref = `${pathRef}.block[${index}]`;
      const entry = addDeepComponentRef(block, sectionKey, parentChain, hiddenFromSummary, ref);
      collectNestedPathRefs(block, sectionKey, ref, [...parentChain, formatComponentChainLabel(block, entry.target || entry.ref)], hiddenFromSummary);
    });
  };

  const collectNestedPathRefs = (
    block: VisualBlock,
    sectionKey: string,
    baseRef: string,
    parentChain: string[],
    hiddenFromSummary: boolean
  ): void => {
    block.schema.containerBlocks?.forEach((child, index) => {
      const ref = `${baseRef}.container[${index}]`;
      const entry = addDeepComponentRef(child, sectionKey, [...parentChain, `container slot ${index}`], hiddenFromSummary, ref);
      collectNestedPathRefs(child, sectionKey, ref, [...parentChain, formatComponentChainLabel(child, entry.target || entry.ref)], hiddenFromSummary);
    });
    block.schema.componentListBlocks?.forEach((child, index) => {
      const ref = `${baseRef}.list[${index}]`;
      const entry = addDeepComponentRef(child, sectionKey, [...parentChain, `component-list item ${index}`], hiddenFromSummary, ref);
      collectNestedPathRefs(child, sectionKey, ref, [...parentChain, formatComponentChainLabel(child, entry.target || entry.ref)], hiddenFromSummary);
    });
    block.schema.gridItems?.forEach((item, index) => {
      const ref = `${baseRef}.grid[${index}]`;
      const aliases = [item.id];
      const entry = addDeepComponentRef(item.block, sectionKey, [...parentChain, `grid cell ${index}${item.id ? ` (${item.id})` : ''}`], hiddenFromSummary, ref, aliases);
      collectNestedPathRefs(item.block, sectionKey, ref, [...parentChain, formatComponentChainLabel(item.block, entry.target || entry.ref)], hiddenFromSummary);
      if (item.id.trim().length > 0) {
        collectNestedPathRefs(item.block, sectionKey, item.id.trim(), [...parentChain, formatComponentChainLabel(item.block, item.id.trim())], hiddenFromSummary);
      }
    });
    block.schema.expandableStubBlocks?.children?.forEach((child, index) => {
      const ref = `${baseRef}.stub[${index}]`;
      const entry = addDeepComponentRef(child, sectionKey, [...parentChain, `expandable stub ${index}`], hiddenFromSummary, ref);
      collectNestedPathRefs(child, sectionKey, ref, [...parentChain, formatComponentChainLabel(child, entry.target || entry.ref)], hiddenFromSummary);
    });
    block.schema.expandableContentBlocks?.children?.forEach((child, index) => {
      const ref = `${baseRef}.content[${index}]`;
      const entry = addDeepComponentRef(child, sectionKey, [...parentChain, `expandable content ${index}`], hiddenFromSummary, ref);
      collectNestedPathRefs(child, sectionKey, ref, [...parentChain, formatComponentChainLabel(child, entry.target || entry.ref)], hiddenFromSummary);
    });
  };

  const collectVisibleNestedPathRefs = (block: VisualBlock, sectionKey: string, visibleRef: string, parentChain: string[]): void => {
    const entry = addDeepComponentRef(block, sectionKey, parentChain, false, visibleRef);
    registerComponentRef(entry, [visibleRef, block.schema.id.trim()], true);
    collectNestedPathRefs(block, sectionKey, visibleRef, [...parentChain, formatComponentChainLabel(block, entry.target || entry.ref)], true);
  };

  const indexAllSectionBlocks = (sections: VisualSection[]): void => {
    for (const section of sections) {
      const displayTitle = section.title.trim() || 'Untitled Section';
      collectDeepRefs(section.blocks, section.key, [`section "${displayTitle}" (${getSectionId(section)})`], true);
      indexAllSectionBlocks(section.children);
    }
  };

  const walkBlocks = (
    blocks: VisualBlock[],
    indent: number,
    nesting: number,
    sectionKey: string,
    lineBudget: { remaining: number },
    parentChain: string[]
  ): void => {
    for (const block of blocks) {
      if (lineBudget.remaining <= 0) {
        return;
      }
      componentCounter += 1;
      const ref = `C${componentCounter}`;
      const componentId = block.schema.id.trim();
      const target = componentId || ref;
      componentRefs.set(ref, {
        ref,
        blockId: block.id,
        sectionKey,
        componentId,
        component: block.schema.component,
        target,
        parentChain,
        hiddenFromSummary: false,
        generated: componentId.length === 0,
      });
      if (componentId.length > 0) {
        componentRefs.set(componentId, componentRefs.get(ref)!);
        deepComponentRefs.set(componentId, componentRefs.get(ref)!);
      }
      collectVisibleNestedPathRefs(block, sectionKey, ref, parentChain);
      const pluginHint = getPluginAiHint(block);
      lines.push(`${'  '.repeat(indent)}${describeStructureLine(block, target, ref)}${pluginHint ? ` AI hint: ${pluginHint}` : ''}`);
      lineBudget.remaining -= 1;
      const nestedBlocks = collectNestedBlocks(block);
      if (nestedBlocks.length === 0) {
        continue;
      }
      if (nesting >= MAX_SUMMARY_NESTING) {
        if (lineBudget.remaining <= 0) {
          return;
        }
        const hiddenIds = collectNestedComponentIds(nestedBlocks);
        lines.push(`${'  '.repeat(indent + 1)}${HIDDEN_CONTENTS_MARKER}${hiddenIds.length > 0 ? ` ids: ${hiddenIds.slice(0, 12).join(', ')}${hiddenIds.length > 12 ? ', ...' : ''}` : ''}`);
        lineBudget.remaining -= 1;
        collectDeepRefs(nestedBlocks, sectionKey, [...parentChain, formatComponentChainLabel(block, target)], true);
        continue;
      }
      walkBlocks(nestedBlocks, indent + 1, nesting + 1, sectionKey, lineBudget, [...parentChain, formatComponentChainLabel(block, target)]);
    }
  };

  const walkSections = (sections: VisualSection[], depth: number, nesting: number): void => {
    for (const section of sections) {
      const sectionId = getSectionId(section);
      sectionRefs.set(sectionId, {
        key: section.key,
        id: sectionId,
        title: section.title,
      });
      const displayTitle = section.title.trim() || 'Untitled Section';
      lines.push(`${'  '.repeat(depth)}<!-- section id="${escapeInline(sectionId)}" title="${escapeInline(displayTitle)}" location="${section.location}" -->`);
      lines.push(`${'  '.repeat(depth)}${'#'.repeat(Math.min(section.level, 6))} ${displayTitle}`);
      const lineBudget = { remaining: MAX_SECTION_PREVIEW_LINES };
      const sectionChain = [`section "${displayTitle}" (${sectionId})`];
      walkBlocks(section.blocks, depth + 1, nesting + 1, section.key, lineBudget, sectionChain);
      if (lineBudget.remaining <= 0 && section.blocks.length > 0) {
        lines.push(`${'  '.repeat(depth + 1)}...`);
        const hiddenIds = collectNestedComponentIds(section.blocks);
        if (hiddenIds.length > 0) {
          lines.push(`${'  '.repeat(depth + 1)}indexed hidden ids: ${hiddenIds.slice(0, 12).join(', ')}${hiddenIds.length > 12 ? ', ...' : ''}`);
        }
      }
      if (section.children.length === 0) {
        continue;
      }
      if (nesting >= MAX_SUMMARY_NESTING) {
        lines.push(`${'  '.repeat(depth + 1)}${HIDDEN_CONTENTS_MARKER}`);
        for (const child of section.children) {
          collectDeepRefs(child.blocks, child.key, [`section "${child.title.trim() || 'Untitled Section'}" (${getSectionId(child)})`], true);
        }
        continue;
      }
      walkSections(section.children, depth + 1, nesting + 1);
    }
  };

  indexAllSectionBlocks(document.sections.filter((section) => !section.isGhost));
  walkSections(document.sections.filter((section) => !section.isGhost), 0, 1);

  return {
    summary: lines.length > 0 ? lines.join('\n') : '[empty] document has no sections',
    sectionRefs,
    componentRefs,
    deepComponentRefs,
  };
}

export function resolveComponentRef(snapshot: DocumentStructureSnapshot, componentRef: string): ComponentRefEntry | undefined {
  const ref = componentRef.trim();
  return snapshot.componentRefs.get(ref) ?? snapshot.deepComponentRefs.get(ref);
}

export function formatComponentLocation(entry: ComponentRefEntry): string {
  return entry.parentChain.length > 0 ? entry.parentChain.join(' > ') : 'document';
}

export function formatNestedTargetRefs(snapshot: DocumentStructureSnapshot, entry: ComponentRefEntry): string {
  const prefix = `${entry.ref}.`;
  const refs = [...snapshot.deepComponentRefs.values()]
    .filter((candidate) => candidate.blockId !== entry.blockId && candidate.ref.startsWith(prefix))
    .map((candidate) => candidate.ref)
    .filter((ref, index, all) => all.indexOf(ref) === index)
    .slice(0, 24);
  if (refs.length === 0) {
    return '';
  }
  return `Nested target refs: ${refs.join(', ')}${refs.length >= 24 ? ', ...' : ''}`;
}

function formatComponentChainLabel(block: VisualBlock, target: string): string {
  return `${block.schema.component}${target ? ` "${target}"` : ''}`;
}

function collectNestedComponentIds(blocks: VisualBlock[]): string[] {
  const ids: string[] = [];
  const visit = (items: VisualBlock[]): void => {
    for (const block of items) {
      const id = block.schema.id.trim();
      if (id.length > 0) {
        ids.push(id);
      }
      visit(collectNestedBlocks(block));
    }
  };
  visit(blocks);
  return [...new Set(ids)];
}

function describeStructureLine(block: VisualBlock, target: string, fallbackRef: string): string {
  const preview = getBlockPreview(block);
  const label = block.schema.id.trim().length > 0 ? block.schema.id.trim() : fallbackRef;
  if (!preview) {
    return `[${block.schema.component} id="${escapeInline(label)}"]`;
  }
  if (block.schema.component === 'text' && /^#{1,6}\s/.test(preview)) {
    return `${preview} <!-- ${block.schema.component} id="${escapeInline(label)}" -->`;
  }
  return `${preview} <!-- ${block.schema.component} id="${escapeInline(target)}" -->`;
}

function getPluginAiHint(block: VisualBlock): string {
  if (block.schema.component !== 'plugin' || !block.schema.plugin) {
    return '';
  }
  const hint = getHostPlugin(block.schema.plugin)?.aiHint;
  if (!hint) {
    return '';
  }
  return (typeof hint === 'function' ? hint(block) : hint).replace(/\s+/g, ' ').trim().slice(0, 360);
}


function getBlockPreview(block: VisualBlock): string {
  const component = block.schema.component;
  if (component === 'xref-card') {
    return truncatePreview([block.schema.xrefTitle, block.schema.xrefDetail].filter((value) => value.trim().length > 0).join(' - '));
  }
  if (component === 'table') {
    return truncatePreview(`columns: ${block.schema.tableColumns}`);
  }
  if (component === 'expandable') {
    const stubText = flattenBlockText(block.schema.expandableStubBlocks?.children ?? []);
    return stubText || '[expandable]';
  }
  const text = block.text.trim();
  if (text.length > 0) {
    return truncatePreview(text);
  }
  if (component === 'component-list') {
    return `${block.schema.componentListBlocks.length} items`;
  }
  if (component === 'container') {
    return `${block.schema.containerBlocks.length} children`;
  }
  if (component === 'grid') {
    return `${block.schema.gridItems.length} cells`;
  }
  return '';
}

function flattenBlockText(blocks: VisualBlock[]): string {
  return truncatePreview(
    blocks
    .flatMap((block) => {
      const local = block.text.trim();
      if (local.length > 0) {
        return [local];
      }
      return flattenBlockText(block.schema.containerBlocks ?? [])
        .split('\n')
        .filter((value) => value.trim().length > 0);
    })
    .join(' ')
    .trim()
  );
}

export function collectNestedBlocks(block: VisualBlock): VisualBlock[] {
  return [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
  ];
}

export function findBlockByInternalId(sections: VisualSection[], blockId: string): VisualBlock | null {
  let found: VisualBlock | null = null;
  visitBlocks(sections, (block) => {
    if (!found && block.id === blockId) {
      found = block;
    }
  });
  return found;
}

export function escapeInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function stringifyHeaderPreview(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '(none)';
  }
  if (typeof value === 'string') {
    return escapeInline(value);
  }
  return escapeInline(JSON.stringify(value));
}

function describeHeaderObjectKeys(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '(none)';
  }
  const keys = Object.keys(value as JsonObject).sort();
  return keys.length > 0 ? keys.join(', ') : '(empty)';
}

function describeKnownThemeColors(meta: JsonObject): string[] {
  const theme = meta.theme && typeof meta.theme === 'object' && !Array.isArray(meta.theme) ? (meta.theme as JsonObject) : {};
  const colors = theme.colors && typeof theme.colors === 'object' && !Array.isArray(theme.colors) ? (theme.colors as JsonObject) : {};
  return THEME_COLOR_NAMES.map((name) => {
    const value = typeof colors[name] === 'string' && colors[name].trim().length > 0 ? colors[name] : '(not set; viewer default applies)';
    return `- ${name} (${getThemeColorLabel(name)}): ${value}`;
  });
}

export function truncatePreview(value: string, maxLength = MAX_TEXT_PREVIEW_LENGTH): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 1)}...`;
}

