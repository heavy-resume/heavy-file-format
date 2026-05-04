import { requestAiComponentEdit } from './ai-component-edit';
import { parseAiBlockEditResponse } from './ai-component-edit-common';
import { getPluginAiHelp } from './ai-plugin-hints';
import { getHvyComponentHelp } from './component-help';
import { createEmptySection } from './document-factory';
import { deserializeDocumentWithDiagnostics, serializeBlockFragment, serializeSectionFragment } from './serialization';
import { findBlockContainerById, findSectionByKey, findSectionContainer, getSectionId, moveSectionRelative, moveSectionToSiblingIndex } from './section-ops';
import { formatQueryResultTable, getDbTableRenderedText } from './plugins/db-table';
import type { VisualBlock, VisualSection } from './editor/types';
import type { ChatSettings, VisualDocument } from './types';
import { buildDocumentEditToolHelp } from './ai-document-edit-instructions';
import { DB_TABLE_PLUGIN_ID } from './plugins/registry';
import { collectNestedBlocks, findBlockByInternalId, formatComponentLocation, formatNestedTargetRefs, resolveComponentRef, summarizeDocumentStructure, truncatePreview } from './ai-document-structure';
import { applyComponentPatchEdits, buildDocumentNumberedLines, buildGrepRegex, buildToolRegex, clampLineRange, formatNumberedFragment, formatPatchContextFragment } from './ai-document-line-tools';
import { hasNestedSlotDiagnostics } from './ai-document-loop-state';
import { DEFAULT_VIEW_END_LINE, DEFAULT_VIEW_START_LINE, HvyRepairToolError, type ComponentRefEntry, type DocumentEditToolRequest, type DocumentStructureSnapshot, type HeaderEditToolRequest } from './ai-document-edit-types';
import { executeGrepHeaderTool, executePatchHeaderTool, executeViewHeaderTool } from './ai-header-edit-tools';

export function executeViewComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'view_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument
): string {
  const component = resolveComponentRef(snapshot, request.component_ref);
  if (!component) {
    const sectionResult = executeViewSectionRefAsComponentTool(request, snapshot, document);
    if (sectionResult) {
      return sectionResult;
    }
    throw new Error(`Unknown component ref "${request.component_ref}". Request the structure again if needed.`);
  }
  const section = findSectionByKey(document.sections, component.sectionKey);
  const block = findBlockByInternalId(document.sections, component.blockId);
  if (!section || !block) {
    throw new Error(`Component "${request.component_ref}" could not be found.`);
  }
  const fragment = serializeBlockFragment(block, document.meta);
  const clampRange = clampLineRange(fragment.split('\n').length, request.start_line, request.end_line);

  return [
    `Section title: ${section.title}`,
    `Section id: ${getSectionId(section)}`,
    `Component type: ${block.schema.component}`,
    `Component id: ${block.schema.id.trim() || '(none)'}`,
    `Component location: ${formatComponentLocation(component)}`,
    formatNestedTargetRefs(snapshot, component),
    `Showing lines ${clampRange.startLine}-${clampRange.endLine} (default range is ${DEFAULT_VIEW_START_LINE}-${DEFAULT_VIEW_END_LINE})`,
    '',
    'Component HVY with 1-based line numbers:',
    formatNumberedFragment(fragment, clampRange.startLine, clampRange.endLine),
  ].filter(Boolean).join('\n');
}

export function executeViewSectionRefAsComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'view_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument
): string | null {
  const sectionEntry = snapshot.sectionRefs.get(request.component_ref.trim());
  if (!sectionEntry) {
    return null;
  }
  const section = findSectionByKey(document.sections, sectionEntry.key);
  if (!section) {
    return null;
  }
  const fragment = serializeSectionFragment(section, document.meta);
  const clampRange = clampLineRange(fragment.split('\n').length, request.start_line, request.end_line);

  return [
    `Section title: ${section.title}`,
    `Section id: ${getSectionId(section)}`,
    'Matched a section ref, not a component ref.',
    'Use section tools for section-level changes, or use one of the component ids shown below for component edits.',
    `Showing lines ${clampRange.startLine}-${clampRange.endLine} (default range is ${DEFAULT_VIEW_START_LINE}-${DEFAULT_VIEW_END_LINE})`,
    '',
    'Section HVY with 1-based line numbers:',
    formatNumberedFragment(fragment, clampRange.startLine, clampRange.endLine),
  ].join('\n');
}

export async function executeRequestRenderedStructureTool(snapshot: DocumentStructureSnapshot, document: VisualDocument): Promise<string> {
  const entries = getUniqueComponentEntries(snapshot);
  if (entries.length === 0) {
    return '[empty] rendered document has no visible components.';
  }

  const lines: string[] = ['Rendered document component output:'];
  for (const entry of entries.slice(0, 60)) {
    const block = findBlockByInternalId(document.sections, entry.blockId);
    if (!block) {
      continue;
    }
    const renderedText = await renderComponentText(document, block, { maxDepth: 1 });
    const firstLine = renderedText.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '(empty)';
    const problem = /\b(error|missing|unknown|invalid|failed)\b/i.test(renderedText) ? ' problem=possible' : '';
    lines.push(`- ${entry.target || entry.ref} (${entry.component})${problem}: ${truncatePreview(firstLine, 160)}`);
  }
  if (entries.length > 60) {
    lines.push(`... ${entries.length - 60} more components omitted. Use view_rendered_component with a component ref for details.`);
  }
  return lines.join('\n');
}

export async function executeViewRenderedComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'view_rendered_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument
): Promise<string> {
  const component = resolveComponentRef(snapshot, request.component_ref);
  if (!component) {
    throw new Error(`Unknown component ref "${request.component_ref}". Request the structure again if needed.`);
  }
  const section = findSectionByKey(document.sections, component.sectionKey);
  const block = findBlockByInternalId(document.sections, component.blockId);
  if (!section || !block) {
    throw new Error(`Component "${request.component_ref}" could not be found.`);
  }

  return [
    `Section title: ${section.title}`,
    `Section id: ${getSectionId(section)}`,
    `Component type: ${block.schema.component}`,
    `Component id: ${block.schema.id.trim() || '(none)'}`,
    `Component location: ${formatComponentLocation(component)}`,
    '',
    'Rendered component text/diagnostics:',
    await renderComponentText(document, block, { maxDepth: 4 }),
  ].join('\n');
}

export function executeGetHelpTool(request: Extract<DocumentEditToolRequest, { tool: 'get_help' }>): string {
  const topic = request.topic.trim();
  const toolHelp = buildDocumentEditToolHelp(topic);
  if (toolHelp) {
    return toolHelp;
  }
  const pluginMatch = topic.match(/^plugin:(.+)$/i);
  if (pluginMatch?.[1]) {
    return getPluginAiHelp(pluginMatch[1].trim());
  }
  const componentMatch = topic.match(/^component:(.+)$/i);
  const component = (componentMatch?.[1] ?? topic).trim().toLowerCase();
  const componentHelp = getHvyComponentHelp(component);
  return componentHelp || `No detailed help registered for "${topic}". Try "plugin:PLUGIN_ID" or "component:text".`;
}

function getUniqueComponentEntries(snapshot: DocumentStructureSnapshot, includeDeep = false): ComponentRefEntry[] {
  const seenBlockIds = new Set<string>();
  const entries: ComponentRefEntry[] = [];
  const sourceEntries = includeDeep
    ? [...snapshot.componentRefs.values(), ...snapshot.deepComponentRefs.values()]
    : [...snapshot.componentRefs.values()];
  for (const entry of sourceEntries) {
    if (seenBlockIds.has(entry.blockId)) {
      continue;
    }
    seenBlockIds.add(entry.blockId);
    entries.push(entry);
  }
  return entries;
}

export function executeSearchComponentsTool(
  request: Extract<DocumentEditToolRequest, { tool: 'search_components' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument
): string {
  const matches = searchComponentIndex(request.query, snapshot, document, request.max_count ?? 5);
  if (matches.length === 0) {
    return `No close component/section matches found for "${request.query}".`;
  }
  return [
    `Best component/section matches for "${request.query}":`,
    ...matches.map((match, index) => `${index + 1}. ${match.label} score=${match.score} — ${match.preview}`),
    'If one of these already satisfies the intended purpose, modify/reuse it instead of creating a duplicate.',
  ].join('\n');
}

export function buildIntentRecall(intent: string, snapshot: DocumentStructureSnapshot, document: VisualDocument): string {
  const matches = searchComponentIndex(intent, snapshot, document, 3);
  if (matches.length === 0) {
    return '';
  }
  return [
    `Related existing components for current intent "${truncatePreview(intent.replace(/\n/g, ' '), 100)}":`,
    ...matches.map((match) => `- ${match.label} score=${match.score}: ${match.preview}`),
    'Check these before creating another component with the same purpose.',
  ].join('\n');
}

function searchComponentIndex(
  query: string,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  maxCount: number
): Array<{ label: string; preview: string; score: number }> {
  const queryTokens = tokenizeSearchText(query);
  if (queryTokens.length === 0) {
    return [];
  }
  const entries = getUniqueComponentEntries(snapshot, true)
    .map((entry) => {
      const section = findSectionByKey(document.sections, entry.sectionKey);
      const block = findBlockByInternalId(document.sections, entry.blockId);
      if (!block) {
        return null;
      }
      const searchable = [
        section?.title,
        section ? getSectionId(section) : '',
        entry.target,
        entry.component,
        block.schema.component,
        block.schema.plugin,
        block.schema.xrefTitle,
        block.schema.xrefDetail,
        block.schema.tableColumns,
        JSON.stringify(block.schema.pluginConfig ?? {}),
        block.text,
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ');
      const score = scoreSearchMatch(queryTokens, searchable);
      if (score <= 0) {
        return null;
      }
      const sectionLabel = section ? ` in section "${section.title || getSectionId(section)}"` : '';
      return {
        label: `${entry.target || entry.ref} (${entry.component})${sectionLabel}${entry.hiddenFromSummary ? ' [nested/hidden]' : ''}`,
        preview: truncatePreview(searchable.replace(/\s+/g, ' '), 180),
        score,
      };
    })
    .filter((value): value is { label: string; preview: string; score: number } => value !== null)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return entries.slice(0, Math.max(1, Math.min(10, maxCount)));
}

function tokenizeSearchText(value: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'with', 'this', 'that', 'component', 'section']);
  return [...new Set(value.toLowerCase().match(/[a-z0-9_]+/g) ?? [])]
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function scoreSearchMatch(queryTokens: string[], searchable: string): number {
  const normalized = searchable.toLowerCase();
  const targetTokens = new Set(tokenizeSearchText(normalized));
  return queryTokens.reduce((score, token) => {
    if (targetTokens.has(token)) {
      return score + 3;
    }
    if (normalized.includes(token)) {
      return score + 1;
    }
    return score;
  }, 0);
}

async function renderComponentText(document: VisualDocument, block: VisualBlock, options: { maxDepth: number }): Promise<string> {
  if (block.schema.component === 'plugin' && block.schema.plugin === DB_TABLE_PLUGIN_ID) {
    return getDbTableRenderedText(document, block);
  }

  const localLines = getLocalRenderedComponentLines(block);
  if (options.maxDepth <= 0) {
    return localLines.length > 0 ? localLines.join('\n') : '(empty)';
  }

  const nestedBlocks = collectNestedBlocks(block);
  const nestedLines: string[] = [];
  for (const child of nestedBlocks) {
    const childText = await renderComponentText(document, child, { maxDepth: options.maxDepth - 1 });
    if (childText.trim().length > 0 && childText.trim() !== '(empty)') {
      nestedLines.push(`- ${child.schema.component}${child.schema.id ? ` id="${child.schema.id}"` : ''}: ${truncatePreview(childText.replace(/\s+/g, ' '), 240)}`);
    }
  }

  const lines = [
    ...localLines,
    ...(nestedLines.length > 0 ? ['Nested rendered content:', ...nestedLines] : []),
  ];
  return lines.length > 0 ? lines.join('\n') : '(empty)';
}

function getLocalRenderedComponentLines(block: VisualBlock): string[] {
  const component = block.schema.component;
  if (component === 'text') {
    return block.text.trim().length > 0 ? [block.text.trim()] : [block.schema.placeholder.trim() || '(empty text)'];
  }
  if (component === 'xref-card') {
    return [
      `Title: ${block.schema.xrefTitle || '(empty)'}`,
      ...(block.schema.xrefDetail ? [`Detail: ${block.schema.xrefDetail}`] : []),
      ...(block.schema.xrefTarget ? [`Target: ${block.schema.xrefTarget}`] : []),
    ];
  }
  if (component === 'table') {
    const columns = block.schema.tableColumns.split(',').map((column) => column.trim()).filter(Boolean);
    return [
      `Columns: ${columns.join(', ') || '(none)'}`,
      `Rows: ${block.schema.tableRows.length}`,
      ...(block.schema.tableRows.length > 0 ? [formatQueryResultTable(columns, block.schema.tableRows.map((row) => row.cells))] : []),
    ];
  }
  if (component === 'image') {
    return [`Image: ${block.schema.imageFile || '(none)'}`, `Alt: ${block.schema.imageAlt || '(none)'}`];
  }
  if (component === 'plugin') {
    return [
      `Plugin: ${block.schema.plugin || '(none)'}`,
      `Config: ${JSON.stringify(block.schema.pluginConfig)}`,
      ...(block.text.trim() ? [`Text/query: ${block.text.trim()}`] : []),
    ];
  }
  const text = block.text.trim();
  return text.length > 0 ? [text] : [];
}

export function executeGrepTool(
  request: Extract<DocumentEditToolRequest, { tool: 'grep' }>,
  document: VisualDocument
): string {
  const query = request.query.trim();
  if (query.length === 0) {
    throw new Error('grep.query must be a non-empty string.');
  }

  const before = Math.max(0, request.before ?? 0);
  const after = Math.max(0, request.after ?? 0);
  const maxCount = Math.max(1, request.max_count ?? 5);
  const lines = buildDocumentNumberedLines(document);
  const matcher = buildGrepRegex(query, request.flags);
  const matchIndexes = lines
    .map((line, index) => ({ index, matches: matcher.test(line.text) }))
    .filter((entry) => entry.matches)
    .slice(0, maxCount)
    .map((entry) => entry.index);

  if (matchIndexes.length === 0) {
    return `No matches for "${query}".`;
  }

  return matchIndexes
    .map((matchIndex, idx) => {
      const start = Math.max(0, matchIndex - before);
      const end = Math.min(lines.length - 1, matchIndex + after);
      const clump = lines.slice(start, end + 1);
      const ownerId = lines[matchIndex]?.ownerId ?? '(none)';
      return [
        `Match ${idx + 1} of ${matchIndexes.length} (component_id="${ownerId}")`,
        ...clump.map((line) => `${String(line.lineNumber).padStart(4, ' ')} | ${line.text}`),
      ].join('\n');
    })
    .join('\n\n');
}

type CssTarget =
  | { kind: 'section'; ref: string; label: string; section: VisualSection }
  | { kind: 'component'; ref: string; label: string; block: VisualBlock };

export function executeGetCssTool(
  request: Extract<DocumentEditToolRequest, { tool: 'get_css' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument
): string {
  const matcher = request.regex ? buildToolRegex(request.regex, request.flags, 'get_css.regex') : null;
  const targets = resolveCssTargets(request.ids, snapshot, document);
  const lines = targets.flatMap((target) => {
    const css = getTargetCss(target);
    if (matcher && !matcher.test(css)) {
      return [];
    }
    return [`${target.kind} ${target.label} (${target.ref})`, css.trim().length > 0 ? css : '(empty)'];
  });
  return lines.length > 0 ? lines.join('\n') : 'No CSS matched.';
}

export function executeGetPropertiesTool(
  request: Extract<DocumentEditToolRequest, { tool: 'get_properties' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument
): string {
  const propertyFilter = new Set((request.properties ?? []).map((property) => property.trim().toLowerCase()).filter(Boolean));
  const matcher = request.regex ? buildToolRegex(request.regex, request.flags, 'get_properties.regex') : null;
  const targets = resolveCssTargets(request.ids, snapshot, document);
  const lines: string[] = [];
  for (const target of targets) {
    const declarations = parseCssDeclarations(getTargetCss(target)).filter((declaration) => {
      if (propertyFilter.size > 0 && !propertyFilter.has(declaration.property.toLowerCase())) {
        return false;
      }
      return !matcher || matcher.test(declaration.property) || matcher.test(declaration.value) || matcher.test(`${declaration.property}: ${declaration.value}`);
    });
    lines.push(`${target.kind} ${target.label} (${target.ref})`);
    lines.push(declarations.length > 0 ? declarations.map((declaration) => `${declaration.property}: ${declaration.value}`).join('\n') : '(empty)');
  }
  return lines.join('\n');
}

export function executeSetPropertiesTool(
  request: Extract<DocumentEditToolRequest, { tool: 'set_properties' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const targets = resolveCssTargets(request.ids, snapshot, document);
  const properties = Object.entries(request.properties)
    .map(([property, value]) => ({ property: property.trim(), value }))
    .filter((entry) => entry.property.length > 0);
  if (properties.length === 0) {
    throw new Error('set_properties.properties must include at least one property name.');
  }

  for (const target of targets) {
    const declarations = parseCssDeclarations(getTargetCss(target));
    for (const { property, value } of properties) {
      setCssDeclaration(declarations, property, value);
    }
    setTargetCss(target, serializeCssDeclarations(declarations));
  }
  onMutation?.('ai-edit:css');
  return `Updated ${properties.length} CSS propert${properties.length === 1 ? 'y' : 'ies'} on ${targets.length} target${targets.length === 1 ? '' : 's'}.`;
}

export async function executeEditComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'edit_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  settings: ChatSettings,
  onMutation?: (group?: string) => void
): Promise<string> {
  const component = resolveComponentRef(snapshot, request.component_ref);
  if (!component) {
    throw new Error(`Unknown component ref "${request.component_ref}". Request the structure again if needed.`);
  }
  const section = findSectionByKey(document.sections, component.sectionKey);
  const block = findBlockByInternalId(document.sections, component.blockId);
  if (!section || !block) {
    throw new Error(`Component "${request.component_ref}" could not be found.`);
  }

  const result = await requestAiComponentEdit({
    settings,
    document,
    sectionTitle: section.title,
    block,
    request: request.request,
  });

  onMutation?.('ai-edit:block');
  const originalSchemaId = block.schema.id;
  block.text = result.block.text;
  block.schema = result.block.schema;
  block.schemaMode = result.block.schemaMode;
  if (originalSchemaId.trim().length > 0 && block.schema.id.trim().length === 0) {
    block.schema.id = originalSchemaId;
  }

  return `Updated component ${request.component_ref} (${block.schema.component}${block.schema.id.trim() ? ` id="${block.schema.id.trim()}"` : ''}).`;
}

export function executePatchComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'patch_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const component = resolveComponentRef(snapshot, request.component_ref);
  if (!component) {
    throw new Error(`Unknown component ref "${request.component_ref}". Request the structure again if needed.`);
  }
  const block = findBlockByInternalId(document.sections, component.blockId);
  if (!block) {
    throw new Error(`Component "${request.component_ref}" could not be found.`);
  }

  const originalFragment = serializeBlockFragment(block, document.meta);
  const patchedFragment = applyComponentPatchEdits(originalFragment, request.edits);
  console.debug('[hvy:ai-document-edit] patch_component', {
    componentRef: request.component_ref,
    edits: request.edits,
    originalFragment,
    patchedFragment,
  });

  const parsed = parseAiBlockEditResponse(patchedFragment, document.meta);
  if (!parsed.block || parsed.hasErrors) {
    const details = parsed.issues.map((issue) => `${issue.message} ${issue.hint}`.trim()).join(' ');
    const nestedAdvice = hasNestedSlotDiagnostics(details)
      ? ' This target appears to contain nested slot directives; prefer a narrower explicit component id or remove_component for deleting nested items.'
      : '';
    throw new HvyRepairToolError(`patch_component produced invalid HVY.${nestedAdvice} ${details}`.trim(), {
      tool: 'patch_component',
      syntaxProblem: details,
      before: formatPatchContextFragment(originalFragment, request.edits),
      after: formatPatchContextFragment(patchedFragment, request.edits),
      reference: buildDocumentEditToolHelp('tool:patch_component') ?? '{"tool":"patch_component","component_ref":"C3","edits":[]}',
      nextAction: hasNestedSlotDiagnostics(details)
        ? 'Retry with a narrower explicit component id or use remove_component for deleting nested items.'
        : 'Retry patch_component with a valid single-component HVY fragment.',
    });
  }

  onMutation?.('ai-edit:block');
  const originalSchemaId = block.schema.id;
  block.text = parsed.block.text;
  block.schema = parsed.block.schema;
  block.schemaMode = parsed.block.schemaMode;
  if (originalSchemaId.trim().length > 0 && block.schema.id.trim().length === 0) {
    block.schema.id = originalSchemaId;
  }

  return `Patched component ${request.component_ref} with ${request.edits.length} edit${request.edits.length === 1 ? '' : 's'}.`;
}

export function executeRemoveSectionTool(
  request: Extract<DocumentEditToolRequest, { tool: 'remove_section' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const sectionEntry = snapshot.sectionRefs.get(request.section_ref);
  if (!sectionEntry) {
    throw new Error(`Unknown section ref "${request.section_ref}".`);
  }
  const location = findSectionContainer(document.sections, sectionEntry.key);
  if (!location) {
    throw new Error(`Section "${request.section_ref}" could not be found.`);
  }

  onMutation?.('ai-edit:section');
  location.container.splice(location.index, 1);
  return `Removed section "${sectionEntry.title}" (${request.section_ref}).`;
}

export function executeRemoveComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'remove_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const componentEntry = resolveComponentRef(snapshot, request.component_ref);
  if (!componentEntry) {
    throw new Error(`Unknown component ref "${request.component_ref}".`);
  }
  const location = findBlockContainerById(document.sections, componentEntry.sectionKey, componentEntry.blockId);
  if (!location) {
    throw new Error(`Component "${request.component_ref}" could not be found.`);
  }

  onMutation?.('ai-edit:block');
  location.container.splice(location.index, 1);
  return `Removed component ${request.component_ref} (${componentEntry.component}${componentEntry.componentId ? ` id="${componentEntry.componentId}"` : ''}) from ${formatComponentLocation(componentEntry)}.`;
}

export function executeCreateComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'create_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const parsed = parseAiBlockEditResponse(request.hvy, document.meta);
  if (!parsed.block || parsed.hasErrors) {
    const details = parsed.issues.map((issue) => `${issue.message} ${issue.hint}`.trim()).join(' ');
    throw new HvyRepairToolError(`create_component.hvy must contain exactly one valid HVY component. ${details}`.trim(), {
      tool: 'create_component',
      syntaxProblem: details,
      after: formatNumberedFragment(request.hvy, 1, Math.min(80, Math.max(1, request.hvy.split('\n').length))),
      reference: buildDocumentEditToolHelp('tool:create_component') ?? '{"tool":"create_component","position":"append-to-section","section_ref":"skills","hvy":"<!--hvy:text {}-->\\n New content"}',
      nextAction: 'Retry create_component with exactly one complete top-level HVY component.',
    });
  }
  const newBlock = parsed.block;

  if (request.position === 'append-to-section') {
    const sectionRef = request.section_ref?.trim();
    if (!sectionRef) {
      throw new Error('create_component with append-to-section requires section_ref.');
    }
    const sectionEntry = snapshot.sectionRefs.get(sectionRef);
    const section = sectionEntry ? findSectionByKey(document.sections, sectionEntry.key) : null;
    if (!section) {
      throw new Error(`Unknown section ref "${sectionRef}".`);
    }

    onMutation?.('ai-edit:block');
    section.blocks.push(newBlock);
    return `Created ${newBlock.schema.component} component at the end of section "${section.title}" (${sectionRef}).`;
  }

  const targetRef = request.target_component_ref?.trim();
  if (!targetRef) {
    throw new Error(`create_component with position "${request.position}" requires target_component_ref.`);
  }
  const componentEntry = resolveComponentRef(snapshot, targetRef);
  if (!componentEntry) {
    throw new Error(`Unknown target component ref "${targetRef}".`);
  }
  const location = findBlockContainerById(document.sections, componentEntry.sectionKey, componentEntry.blockId);
  if (!location) {
    throw new Error(`Target component "${targetRef}" could not be found.`);
  }

  onMutation?.('ai-edit:block');
  const insertIndex = request.position === 'before' ? location.index : location.index + 1;
  location.container.splice(insertIndex, 0, newBlock);
  return `Created ${newBlock.schema.component} component ${request.position} ${targetRef}.`;
}

export function executeCreateSectionTool(
  request: Extract<DocumentEditToolRequest, { tool: 'create_section' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const targetLevel = resolveNewSectionLevel(request, snapshot, document);
  const newSection = buildCreatedSection(request, targetLevel);
  const title = newSection.title;

  if (request.position === 'append-root') {
    onMutation?.('ai-edit:section');
    insertSectionAtOptionalIndex(document.sections, newSection, request.new_position_index_from_0, 'root sections');
    return `Created root section "${title}" (${getSectionId(newSection)}).`;
  }

  if (request.position === 'append-child') {
    const parentRef = request.parent_section_ref?.trim();
    if (!parentRef) {
      throw new Error('append-child requires parent_section_ref.');
    }
    const parentEntry = snapshot.sectionRefs.get(parentRef);
    const parent = parentEntry ? findSectionByKey(document.sections, parentEntry.key) : null;
    if (!parent) {
      throw new Error(`Unknown parent section ref "${parentRef}".`);
    }
    onMutation?.('ai-edit:section');
    insertSectionAtOptionalIndex(parent.children, newSection, request.new_position_index_from_0, `children of "${parent.title}"`);
    return `Created subsection "${title}" (${getSectionId(newSection)}) inside "${parent.title}".`;
  }

  const targetRef = request.target_section_ref?.trim();
  if (!targetRef) {
    throw new Error(`${request.position} requires target_section_ref.`);
  }
  const targetEntry = snapshot.sectionRefs.get(targetRef);
  if (!targetEntry) {
    throw new Error(`Unknown target section ref "${targetRef}".`);
  }
  const targetLocation = findSectionContainer(document.sections, targetEntry.key);
  const targetSection = findSectionByKey(document.sections, targetEntry.key);
  if (!targetLocation || !targetSection) {
    throw new Error(`Target section "${targetRef}" could not be found.`);
  }
  newSection.level = targetSection.level;
  onMutation?.('ai-edit:section');
  const insertIndex = request.position === 'before' ? targetLocation.index : targetLocation.index + 1;
  targetLocation.container.splice(insertIndex, 0, newSection);
  return `Created section "${title}" (${getSectionId(newSection)}) ${request.position} "${targetSection.title}".`;
}

function insertSectionAtOptionalIndex(container: VisualSection[], section: VisualSection, index: number | undefined, label: string): void {
  if (index === undefined) {
    container.push(section);
    return;
  }
  if (index < 0 || index > container.length) {
    throw new Error(`new_position_index_from_0 ${index} is out of bounds for ${label} with ${container.length} existing section(s).`);
  }
  container.splice(index, 0, section);
}

function buildCreatedSection(request: Extract<DocumentEditToolRequest, { tool: 'create_section' }>, targetLevel: number): VisualSection {
  const hvy = request.hvy?.trim();
  if (!hvy) {
    const title = request.title?.trim() || 'Untitled Section';
    const section = createEmptySection(targetLevel, '', false);
    section.title = title;
    return section;
  }

  const parsed = deserializeDocumentWithDiagnostics(`${hvy}\n`, '.hvy');
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    const details = errors.map((diagnostic) => diagnostic.message).join(' ');
    throw new HvyRepairToolError(`create_section.hvy must be a valid HVY section. ${details}`, {
      tool: 'create_section',
      syntaxProblem: details,
      after: formatNumberedFragment(hvy, 1, Math.min(120, Math.max(1, hvy.split('\n').length))),
      reference: buildDocumentEditToolHelp('tool:create_section') ?? '{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"new-section\\"}-->\\n#! New section\\n\\n <!--hvy:text {}-->\\n  New content"}',
      nextAction: 'Retry create_section with exactly one complete HVY section directive, title, and valid child components.',
    });
  }
  if (parsed.document.sections.length !== 1) {
    throw new HvyRepairToolError('create_section.hvy must contain exactly one top-level HVY section.', {
      tool: 'create_section',
      syntaxProblem: 'The payload parsed, but it did not contain exactly one top-level HVY section.',
      after: formatNumberedFragment(hvy, 1, Math.min(120, Math.max(1, hvy.split('\n').length))),
      reference: buildDocumentEditToolHelp('tool:create_section') ?? '{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"new-section\\"}-->\\n#! New section\\n\\n <!--hvy:text {}-->\\n  New content"}',
      nextAction: 'Retry create_section with one top-level section only.',
    });
  }

  const section = parsed.document.sections[0]!;
  adjustSectionLevel(section, targetLevel);
  return section;
}

function adjustSectionLevel(section: VisualSection, targetLevel: number): void {
  const delta = targetLevel - section.level;
  visitSectionTree(section, (candidate) => {
    candidate.level = Math.min(Math.max(candidate.level + delta, 1), 6);
  });
}

function visitSectionTree(section: VisualSection, visitor: (section: VisualSection) => void): void {
  visitor(section);
  for (const child of section.children) {
    visitSectionTree(child, visitor);
  }
}

export function executeReorderSectionTool(
  request: Extract<DocumentEditToolRequest, { tool: 'reorder_section' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const sectionEntry = snapshot.sectionRefs.get(request.section_ref);
  if (!sectionEntry) {
    throw new Error(`Unknown section ref "${request.section_ref}".`);
  }

  if (request.new_position_index_from_0 !== undefined) {
    const moved = moveSectionToSiblingIndex(document.sections, sectionEntry.key, request.new_position_index_from_0);
    if (!moved) {
      throw new Error(`Could not move section "${request.section_ref}" to sibling index ${request.new_position_index_from_0}.`);
    }
    onMutation?.('ai-edit:section-order');
    return `Moved section "${sectionEntry.title}" to sibling index ${request.new_position_index_from_0}.`;
  }

  const targetRef = request.target_section_ref?.trim();
  const targetEntry = targetRef ? snapshot.sectionRefs.get(targetRef) : null;
  if (!targetEntry) {
    throw new Error('reorder_section requires target_section_ref for before/after moves.');
  }
  if (!request.position) {
    throw new Error('reorder_section requires position for target_section_ref moves.');
  }
  const moved = moveSectionRelative(document.sections, sectionEntry.key, targetEntry.key, request.position);
  if (!moved) {
    throw new Error(`Could not move section "${request.section_ref}" ${request.position} "${targetRef}".`);
  }
  onMutation?.('ai-edit:section-order');
  return `Moved section "${sectionEntry.title}" ${request.position} "${targetEntry.title}".`;
}

function resolveNewSectionLevel(
  request: Extract<DocumentEditToolRequest, { tool: 'create_section' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument
): number {
  if (request.position === 'append-child') {
    const parentRef = request.parent_section_ref?.trim();
    const parentEntry = parentRef ? snapshot.sectionRefs.get(parentRef) : null;
    const parent = parentEntry ? findSectionByKey(document.sections, parentEntry.key) : null;
    return parent ? Math.min(parent.level + 1, 6) : 2;
  }

  if (request.position === 'before' || request.position === 'after') {
    const targetRef = request.target_section_ref?.trim();
    const targetEntry = targetRef ? snapshot.sectionRefs.get(targetRef) : null;
    const target = targetEntry ? findSectionByKey(document.sections, targetEntry.key) : null;
    return target?.level ?? 1;
  }

  return 1;
}

function resolveCssTargets(ids: string[], snapshot: DocumentStructureSnapshot, document: VisualDocument): CssTarget[] {
  const targets: CssTarget[] = [];
  const seen = new Set<string>();
  for (const id of ids.map((item) => item.trim()).filter(Boolean)) {
    const sectionEntry = snapshot.sectionRefs.get(id);
    if (sectionEntry) {
      const section = findSectionByKey(document.sections, sectionEntry.key);
      const key = `section:${sectionEntry.key}`;
      if (section && !seen.has(key)) {
        seen.add(key);
        targets.push({ kind: 'section', ref: id, label: section.title, section });
      }
      continue;
    }
    const componentEntry = resolveComponentRef(snapshot, id);
    if (componentEntry) {
      const block = findBlockByInternalId(document.sections, componentEntry.blockId);
      const key = `component:${componentEntry.blockId}`;
      if (block && !seen.has(key)) {
        seen.add(key);
        targets.push({ kind: 'component', ref: id, label: componentEntry.component, block });
      }
      continue;
    }
    throw new Error(`Unknown CSS target id "${id}". Use section ids, component ids, or fallback component refs like C3.`);
  }
  if (targets.length === 0) {
    throw new Error('CSS tools require at least one id.');
  }
  return targets;
}

function getTargetCss(target: CssTarget): string {
  return target.kind === 'section' ? target.section.css : target.block.schema.css;
}

function setTargetCss(target: CssTarget, css: string): void {
  if (target.kind === 'section') {
    target.section.css = css;
    return;
  }
  target.block.schema.css = css;
}

function parseCssDeclarations(css: string): Array<{ property: string; value: string }> {
  return css
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf(':');
      if (separator < 0) {
        return { property: part, value: '' };
      }
      return {
        property: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim(),
      };
    })
    .filter((declaration) => declaration.property.length > 0);
}

function setCssDeclaration(declarations: Array<{ property: string; value: string }>, property: string, value: string | null): void {
  const index = declarations.findIndex((declaration) => declaration.property.toLowerCase() === property.toLowerCase());
  if (value === null) {
    if (index >= 0) {
      declarations.splice(index, 1);
    }
    return;
  }
  if (index >= 0) {
    declarations[index] = { property, value };
    return;
  }
  declarations.push({ property, value });
}

function serializeCssDeclarations(declarations: Array<{ property: string; value: string }>): string {
  return declarations.map((declaration) => `${declaration.property}: ${declaration.value};`).join(' ');
}

// Programmatic tool dispatch — used by the scripting plugin to call the same
// tool surface the AI agent uses, but synchronously and without the LLM
// conversation loop. Returns the tool's textual result (matching what the AI
// would see). Async tools like edit_component (which themselves invoke the
// LLM) are not exposed through this entry point.
export function executeDocumentEditToolByName(
  toolName: string,
  args: unknown,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const argsObject = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const snapshot = summarizeDocumentStructure(document);

  const request = { tool: toolName, ...argsObject } as Record<string, unknown> & { tool: string };

  switch (toolName) {
    case 'request_structure':
      return snapshot.summary;
    case 'grep':
      return executeGrepTool(request as Extract<DocumentEditToolRequest, { tool: 'grep' }>, document);
    case 'get_css':
      return executeGetCssTool(request as Extract<DocumentEditToolRequest, { tool: 'get_css' }>, snapshot, document);
    case 'get_properties':
      return executeGetPropertiesTool(
        request as Extract<DocumentEditToolRequest, { tool: 'get_properties' }>,
        snapshot,
        document
      );
    case 'set_properties':
      return executeSetPropertiesTool(
        request as Extract<DocumentEditToolRequest, { tool: 'set_properties' }>,
        snapshot,
        document,
        onMutation
      );
    case 'view_component':
      return executeViewComponentTool(
        request as Extract<DocumentEditToolRequest, { tool: 'view_component' }>,
        snapshot,
        document
      );
    case 'patch_component':
      return executePatchComponentTool(
        request as Extract<DocumentEditToolRequest, { tool: 'patch_component' }>,
        snapshot,
        document,
        onMutation
      );
    case 'remove_section':
      return executeRemoveSectionTool(
        request as Extract<DocumentEditToolRequest, { tool: 'remove_section' }>,
        snapshot,
        document,
        onMutation
      );
    case 'remove_component':
      return executeRemoveComponentTool(
        request as Extract<DocumentEditToolRequest, { tool: 'remove_component' }>,
        snapshot,
        document,
        onMutation
      );
    case 'create_component':
      return executeCreateComponentTool(
        request as Extract<DocumentEditToolRequest, { tool: 'create_component' }>,
        snapshot,
        document,
        onMutation
      );
    case 'create_section':
      return executeCreateSectionTool(
        request as Extract<DocumentEditToolRequest, { tool: 'create_section' }>,
        snapshot,
        document,
        onMutation
      );
    case 'reorder_section':
      return executeReorderSectionTool(
        request as Extract<DocumentEditToolRequest, { tool: 'reorder_section' }>,
        snapshot,
        document,
        onMutation
      );
    case 'view_header':
      return executeViewHeaderTool(request as Extract<HeaderEditToolRequest, { tool: 'view_header' }>, document);
    case 'grep_header':
      return executeGrepHeaderTool(request as Extract<HeaderEditToolRequest, { tool: 'grep_header' }>, document);
    case 'patch_header':
      return executePatchHeaderTool(
        request as Extract<HeaderEditToolRequest, { tool: 'patch_header' }>,
        document,
        onMutation
      );
    default:
      throw new Error(`Unknown scripting tool "${toolName}".`);
  }
}
