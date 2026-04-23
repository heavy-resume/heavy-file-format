import { requestProxyCompletion } from './chat';
import { parseAiBlockEditResponse, requestAiComponentEdit } from './ai-edit';
import { createEmptySection } from './document-factory';
import { serializeBlockFragment, serializeDocument } from './serialization';
import { findBlockContainerById, findSectionByKey, findSectionContainer, getSectionId, moveSectionRelative, visitBlocks } from './section-ops';
import type { VisualBlock, VisualSection } from './editor/types';
import type { ChatMessage, ChatSettings, VisualDocument } from './types';

const MAX_DOCUMENT_EDIT_ITERATIONS = 6;
const MAX_SECTION_PREVIEW_LINES = 10;
const MAX_TEXT_PREVIEW_LENGTH = 72;
// Two block levels under a section yields three visible levels overall:
// section -> child -> grandchild. Anything deeper is collapsed.
const MAX_SUMMARY_NESTING = 2;
const HIDDEN_CONTENTS_MARKER = '... contents hidden ...';
const SENT_STRUCTURE_CONTEXT = 'Reduced document structure was already provided earlier in this edit session. Request `request_structure` if you need a fresh copy.';
const DEFAULT_VIEW_START_LINE = 1;
const DEFAULT_VIEW_END_LINE = 200;
const MAX_GREP_LINE_WIDTH = 400;

interface NumberedLine {
  lineNumber: number;
  text: string;
  ownerId: string | null;
}

interface SectionRefEntry {
  key: string;
  id: string;
  title: string;
}

interface ComponentRefEntry {
  ref: string;
  blockId: string;
  sectionKey: string;
  componentId: string;
  component: string;
  target: string;
}

interface DocumentStructureSnapshot {
  summary: string;
  sectionRefs: Map<string, SectionRefEntry>;
  componentRefs: Map<string, ComponentRefEntry>;
}

type ComponentPatchEdit =
  | { op: 'replace'; start_line: number; end_line: number; text: string }
  | { op: 'delete'; start_line: number; end_line: number }
  | { op: 'insert_before'; line: number; text: string }
  | { op: 'insert_after'; line: number; text: string };

type DocumentEditToolRequest =
  | { tool: 'done'; summary?: string }
  | { tool: 'request_structure'; reason?: string }
  | { tool: 'view_component'; component_ref: string; start_line?: number; end_line?: number; reason?: string }
  | { tool: 'grep'; query: string; flags?: string; before?: number; after?: number; max_count?: number; reason?: string }
  | { tool: 'edit_component'; component_ref: string; request: string; reason?: string }
  | { tool: 'patch_component'; component_ref: string; edits: ComponentPatchEdit[]; reason?: string }
  | { tool: 'remove_section'; section_ref: string; reason?: string }
  | { tool: 'remove_component'; component_ref: string; reason?: string }
  | {
      tool: 'create_component';
      position: 'append-to-section' | 'before' | 'after';
      section_ref?: string;
      target_component_ref?: string;
      hvy: string;
      reason?: string;
    }
  | {
      tool: 'create_section';
      title?: string;
      position: 'append-root' | 'append-child' | 'before' | 'after';
      target_section_ref?: string;
      parent_section_ref?: string;
      reason?: string;
    }
  | {
      tool: 'reorder_section';
      section_ref: string;
      target_section_ref: string;
      position: 'before' | 'after';
      reason?: string;
    };

interface ChatTurnResult {
  messages: ChatMessage[];
  error: string | null;
}

export async function requestAiDocumentEditTurn(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
  request: string;
  onMutation?: (group?: string) => void;
}): Promise<ChatTurnResult> {
  const nextMessages = appendChatMessage(params.messages, params.request);

  try {
    const result = await runDocumentEditLoop({
      settings: params.settings,
      document: params.document,
      request: params.request,
      onMutation: params.onMutation,
    });
    return {
      messages: [
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.summary,
        },
      ],
      error: null,
    };
  } catch (error) {
    console.error('[hvy:ai-document-edit] request failed', {
      request: params.request,
      settings: params.settings,
      error,
    });
    const message = error instanceof Error ? error.message : 'AI document edit failed.';
    return {
      messages: [
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: message,
          error: true,
        },
      ],
      error: message,
    };
  }
}

function appendChatMessage(messages: ChatMessage[], content: string): ChatMessage[] {
  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: 'user',
      content,
    },
  ];
}

async function runDocumentEditLoop(params: {
  settings: ChatSettings;
  document: VisualDocument;
  request: string;
  onMutation?: (group?: string) => void;
}): Promise<{ summary: string }> {
  let snapshot = summarizeDocumentStructure(params.document);
  let contextSummary = snapshot.summary;
  let conversation: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: buildInitialDocumentEditPrompt(params.request),
    },
  ];

  for (let iteration = 0; iteration < MAX_DOCUMENT_EDIT_ITERATIONS; iteration += 1) {
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: conversation,
      context: contextSummary,
      formatInstructions: buildDocumentEditFormatInstructions(),
      mode: 'document-edit',
      debugLabel: `ai-document-edit:${iteration + 1}`,
    });

    const parsed = parseDocumentEditToolRequest(response);
    if (parsed.ok === false) {
      const invalidMessage = parsed.message;
      conversation = [
        ...conversation,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response,
        },
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: `The previous response was invalid. ${invalidMessage}`,
        },
      ];
      continue;
    }

    if (parsed.value.tool === 'done') {
      return {
        summary: parsed.value.summary?.trim() || `Finished after ${iteration + 1} step${iteration === 0 ? '' : 's'}.`,
      };
    }

    let toolResult = '';
    if (parsed.value.tool === 'request_structure') {
      snapshot = summarizeDocumentStructure(params.document);
      toolResult = buildToolResult('request_structure', snapshot.summary);
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'grep') {
      toolResult = buildToolResult('grep', executeGrepTool(parsed.value, params.document));
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'view_component') {
      toolResult = buildToolResult('view_component', executeViewComponentTool(parsed.value, snapshot, params.document));
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'edit_component') {
      toolResult = buildToolResult(
        'edit_component',
        await executeEditComponentTool(parsed.value, snapshot, params.document, params.settings, params.onMutation)
      );
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'patch_component') {
      toolResult = buildToolResult('patch_component', executePatchComponentTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'remove_section') {
      toolResult = buildToolResult('remove_section', executeRemoveSectionTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'remove_component') {
      toolResult = buildToolResult('remove_component', executeRemoveComponentTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'create_component') {
      toolResult = buildToolResult(
        'create_component',
        executeCreateComponentTool(parsed.value, snapshot, params.document, params.onMutation)
      );
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'create_section') {
      toolResult = buildToolResult('create_section', executeCreateSectionTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'reorder_section') {
      toolResult = buildToolResult('reorder_section', executeReorderSectionTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = SENT_STRUCTURE_CONTEXT;
    }

    conversation = [
      ...conversation,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response,
      },
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: toolResult,
      },
    ];
  }

  return {
    summary: `Stopped after ${MAX_DOCUMENT_EDIT_ITERATIONS} steps. The AI can continue if you send another request.`,
  };
}

export function summarizeDocumentStructure(document: VisualDocument): DocumentStructureSnapshot {
  const lines: string[] = [];
  const sectionRefs = new Map<string, SectionRefEntry>();
  const componentRefs = new Map<string, ComponentRefEntry>();
  let componentCounter = 0;

  const walkBlocks = (
    blocks: VisualBlock[],
    indent: number,
    nesting: number,
    sectionKey: string,
    lineBudget: { remaining: number }
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
      });
      if (componentId.length > 0) {
        componentRefs.set(componentId, componentRefs.get(ref)!);
      }
      lines.push(`${'  '.repeat(indent)}${describeStructureLine(block, target, ref)}`);
      lineBudget.remaining -= 1;
      const nestedBlocks = collectNestedBlocks(block);
      if (nestedBlocks.length === 0) {
        continue;
      }
      if (nesting >= MAX_SUMMARY_NESTING) {
        if (lineBudget.remaining <= 0) {
          return;
        }
        lines.push(`${'  '.repeat(indent + 1)}${HIDDEN_CONTENTS_MARKER}`);
        lineBudget.remaining -= 1;
        continue;
      }
      walkBlocks(nestedBlocks, indent + 1, nesting + 1, sectionKey, lineBudget);
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
      walkBlocks(section.blocks, depth + 1, nesting + 1, section.key, lineBudget);
      if (lineBudget.remaining <= 0 && section.blocks.length > 0) {
        lines.push(`${'  '.repeat(depth + 1)}...`);
      }
      if (section.children.length === 0) {
        continue;
      }
      if (nesting >= MAX_SUMMARY_NESTING) {
        lines.push(`${'  '.repeat(depth + 1)}${HIDDEN_CONTENTS_MARKER}`);
        continue;
      }
      walkSections(section.children, depth + 1, nesting + 1);
    }
  };

  walkSections(document.sections.filter((section) => !section.isGhost), 0, 1);

  return {
    summary: lines.length > 0 ? lines.join('\n') : '[empty] document has no sections',
    sectionRefs,
    componentRefs,
  };
}

function executeViewComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'view_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument
): string {
  const component = snapshot.componentRefs.get(request.component_ref);
  if (!component) {
    throw new Error(`Unknown component ref "${request.component_ref}". Request the structure again if needed.`);
  }
  const section = findSectionByKey(document.sections, component.sectionKey);
  const block = findBlockByInternalId(document.sections, component.blockId);
  if (!section || !block) {
    throw new Error(`Component "${request.component_ref}" could not be found.`);
  }
  const fragment = serializeBlockFragment(block);
  const clampRange = clampLineRange(fragment.split('\n').length, request.start_line, request.end_line);

  return [
    `Section title: ${section.title}`,
    `Section id: ${getSectionId(section)}`,
    `Component type: ${block.schema.component}`,
    `Component id: ${block.schema.id.trim() || '(none)'}`,
    `Showing lines ${clampRange.startLine}-${clampRange.endLine} (default range is ${DEFAULT_VIEW_START_LINE}-${DEFAULT_VIEW_END_LINE})`,
    '',
    'Component HVY with 1-based line numbers:',
    formatNumberedFragment(fragment, clampRange.startLine, clampRange.endLine),
  ].join('\n');
}

function executeGrepTool(
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

async function executeEditComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'edit_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  settings: ChatSettings,
  onMutation?: (group?: string) => void
): Promise<string> {
  const component = snapshot.componentRefs.get(request.component_ref);
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

function executePatchComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'patch_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const component = snapshot.componentRefs.get(request.component_ref);
  if (!component) {
    throw new Error(`Unknown component ref "${request.component_ref}". Request the structure again if needed.`);
  }
  const block = findBlockByInternalId(document.sections, component.blockId);
  if (!block) {
    throw new Error(`Component "${request.component_ref}" could not be found.`);
  }

  const originalFragment = serializeBlockFragment(block);
  const patchedFragment = applyComponentPatchEdits(originalFragment, request.edits);
  console.debug('[hvy:ai-document-edit] patch_component', {
    componentRef: request.component_ref,
    edits: request.edits,
    originalFragment,
    patchedFragment,
  });

  const parsed = parseAiBlockEditResponse(patchedFragment);
  if (!parsed.block || parsed.hasErrors) {
    const details = parsed.issues.map((issue) => `${issue.message} ${issue.hint}`.trim()).join(' ');
    throw new Error(`patch_component produced invalid HVY. ${details}`.trim());
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

function executeRemoveSectionTool(
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

function executeRemoveComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'remove_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const componentEntry = snapshot.componentRefs.get(request.component_ref);
  if (!componentEntry) {
    throw new Error(`Unknown component ref "${request.component_ref}".`);
  }
  const location = findBlockContainerById(document.sections, componentEntry.sectionKey, componentEntry.blockId);
  if (!location) {
    throw new Error(`Component "${request.component_ref}" could not be found.`);
  }

  onMutation?.('ai-edit:block');
  location.container.splice(location.index, 1);
  return `Removed component ${request.component_ref} (${componentEntry.component}${componentEntry.componentId ? ` id="${componentEntry.componentId}"` : ''}).`;
}

function executeCreateComponentTool(
  request: Extract<DocumentEditToolRequest, { tool: 'create_component' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const parsed = parseAiBlockEditResponse(request.hvy);
  if (!parsed.block || parsed.hasErrors) {
    const details = parsed.issues.map((issue) => issue.message).join(' ');
    throw new Error(`create_component.hvy must contain exactly one valid HVY component. ${details}`.trim());
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
  const componentEntry = snapshot.componentRefs.get(targetRef);
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

function executeCreateSectionTool(
  request: Extract<DocumentEditToolRequest, { tool: 'create_section' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const title = request.title?.trim() || 'Untitled Section';
  const newSection = createEmptySection(resolveNewSectionLevel(request, snapshot, document), '', false);
  newSection.title = title;

  if (request.position === 'append-root') {
    onMutation?.('ai-edit:section');
    document.sections.push(newSection);
    return `Created root section "${title}".`;
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
    parent.children.push(newSection);
    return `Created subsection "${title}" inside "${parent.title}".`;
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
  return `Created section "${title}" ${request.position} "${targetSection.title}".`;
}

function executeReorderSectionTool(
  request: Extract<DocumentEditToolRequest, { tool: 'reorder_section' }>,
  snapshot: DocumentStructureSnapshot,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const sectionEntry = snapshot.sectionRefs.get(request.section_ref);
  const targetEntry = snapshot.sectionRefs.get(request.target_section_ref);
  if (!sectionEntry) {
    throw new Error(`Unknown section ref "${request.section_ref}".`);
  }
  if (!targetEntry) {
    throw new Error(`Unknown target section ref "${request.target_section_ref}".`);
  }

  onMutation?.('ai-edit:section-order');
  const moved = moveSectionRelative(document.sections, sectionEntry.key, targetEntry.key, request.position);
  if (!moved) {
    throw new Error(`Could not move section "${request.section_ref}" ${request.position} "${request.target_section_ref}".`);
  }
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

export function buildDocumentEditFormatInstructions(): string {
  return [
    'Reply with exactly one JSON object and nothing else.',
    'Choose one tool at a time.',
    'Valid tools are: `grep`, `view_component`, `edit_component`, `patch_component`, `create_component`, `remove_component`, `create_section`, `remove_section`, `reorder_section`, `request_structure`, `done`.',
    'Use real section ids when a section has an id.',
    'Use component ids when they exist. If a component has no id, use its fallback component ref like `C3`.',
    'Do not invent ids or refs.',
    'Use `grep` to search the whole serialized document with a regex pattern. It returns post-wrap line numbers, nearby context lines, and the nearest component id for each match clump.',
    'For grep regexes, you may use alternation like `Python|TypeScript` and flags like `i` for case-insensitive matches.',
    'When you need exact HVY for a component before editing it, use `view_component` first. It returns 1-based component line numbers and defaults to lines 1-200.',
    'Use `edit_component` only for one existing component. It may revise that component in place or fully replace it, but only for that single referenced component.',
    'Use `patch_component` for small, local changes after you have seen the numbered component lines.',
    'Use `create_component` to add a fully defined new component near an existing one or at the end of a section.',
    'Use `remove_component` and `remove_section` when the request requires deletion.',
    'Use section tools for section-level structural changes.',
    'When the request is fully satisfied, return `{"tool":"done","summary":"..."}`.',
    'JSON must use double-quoted keys and string values.',
    'For `create_component.hvy`, return one complete HVY component fragment as a JSON string value with escaped newlines.',
    '',
    'Tool shapes:',
    '{"tool":"grep","query":"Python|TypeScript","flags":"i","before":2,"after":2,"max_count":3,"reason":"optional"}',
    '{"tool":"grep","query":"/Python|TypeScript/i","before":2,"after":2,"max_count":3,"reason":"optional"}',
    '{"tool":"view_component","component_ref":"C3","reason":"optional"}',
    '{"tool":"view_component","component_ref":"skill-python-card","start_line":1,"end_line":40,"reason":"optional"}',
    '{"tool":"edit_component","component_ref":"C3","request":"Change the label to Foo","reason":"optional"}',
    '{"tool":"patch_component","component_ref":"C3","edits":[{"op":"replace","start_line":2,"end_line":2,"text":" New content"}],"reason":"optional"}',
    '{"tool":"patch_component","component_ref":"C3","edits":[{"op":"insert_after","line":1,"text":"\\n <!--hvy:text {}-->\\n Added line"},{"op":"delete","start_line":4,"end_line":5}],"reason":"optional"}',
    '{"tool":"create_component","position":"append-to-section","section_ref":"skills","hvy":"<!--hvy:text {}-->\\n New content","reason":"optional"}',
    '{"tool":"create_component","position":"after","target_component_ref":"C3","hvy":"<!--hvy:xref-card {\\"xrefTitle\\":\\"Heavy Stack\\",\\"xrefDetail\\":\\"Project\\",\\"xrefTarget\\":\\"heavy-stack\\"}-->","reason":"optional"}',
    '{"tool":"remove_component","component_ref":"C3","reason":"optional"}',
    '{"tool":"create_section","position":"append-root","title":"New section","reason":"optional"}',
    '{"tool":"create_section","position":"append-child","parent_section_ref":"skills","title":"Details","reason":"optional"}',
    '{"tool":"remove_section","section_ref":"skills","reason":"optional"}',
    '{"tool":"create_section","position":"before","target_section_ref":"skills","title":"Overview","reason":"optional"}',
    '{"tool":"reorder_section","section_ref":"history","target_section_ref":"skills","position":"after","reason":"optional"}',
    '{"tool":"request_structure","reason":"optional"}',
    '{"tool":"done","summary":"Short summary of what changed."}',
  ].join('\n');
}

function buildInitialDocumentEditPrompt(request: string): string {
  return [
    'Edit the HVY document to satisfy this request:',
    request,
    '',
    'Step 1: examine the reduced document structure provided in context.',
    'Step 2: request the single best next tool.',
    'After each tool result, decide the next step or finish.',
    `You have at most ${MAX_DOCUMENT_EDIT_ITERATIONS} tool steps.`,
  ].join('\n');
}

function buildToolResult(tool: string, result: string): string {
  return [`Tool result for ${tool}:`, result].join('\n\n');
}

function parseDocumentEditToolRequest(source: string): { ok: true; value: DocumentEditToolRequest } | { ok: false; message: string } {
  const cleaned = source.trim().replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'Return a single JSON object.' };
    }
    const tool = parsed.tool;
    if (tool === 'done') {
      return { ok: true, value: { tool, summary: typeof parsed.summary === 'string' ? parsed.summary : undefined } };
    }
    if (tool === 'request_structure') {
      return { ok: true, value: { tool, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined } };
    }
    if (tool === 'grep' && typeof parsed.query === 'string' && parsed.query.trim().length > 0) {
      const flags = typeof parsed.flags === 'string' ? parsed.flags : undefined;
      try {
        buildGrepRegex(parsed.query, flags);
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'grep query must be a valid regex pattern.',
        };
      }
      return {
        ok: true,
        value: {
          tool,
          query: parsed.query,
          flags,
          before: Number.isInteger(parsed.before) ? Number(parsed.before) : undefined,
          after: Number.isInteger(parsed.after) ? Number(parsed.after) : undefined,
          max_count: Number.isInteger(parsed.max_count) ? Number(parsed.max_count) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'view_component' && typeof parsed.component_ref === 'string') {
      return {
        ok: true,
        value: {
          tool,
          component_ref: parsed.component_ref,
          start_line: Number.isInteger(parsed.start_line) ? Number(parsed.start_line) : undefined,
          end_line: Number.isInteger(parsed.end_line) ? Number(parsed.end_line) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'edit_component' && typeof parsed.component_ref === 'string' && typeof parsed.request === 'string' && parsed.request.trim().length > 0) {
      return {
        ok: true,
        value: { tool, component_ref: parsed.component_ref, request: parsed.request, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined },
      };
    }
    if (tool === 'patch_component' && typeof parsed.component_ref === 'string' && Array.isArray(parsed.edits) && parsed.edits.length > 0) {
      const edits: ComponentPatchEdit[] = [];
      for (const candidate of parsed.edits) {
        if (!candidate || typeof candidate !== 'object') {
          return { ok: false, message: 'patch_component.edits must be an array of patch operations.' };
        }
        const edit = candidate as Record<string, unknown>;
        if (edit.op === 'replace' && Number.isInteger(edit.start_line) && Number.isInteger(edit.end_line) && typeof edit.text === 'string') {
          edits.push({ op: 'replace', start_line: Number(edit.start_line), end_line: Number(edit.end_line), text: edit.text });
          continue;
        }
        if (edit.op === 'delete' && Number.isInteger(edit.start_line) && Number.isInteger(edit.end_line)) {
          edits.push({ op: 'delete', start_line: Number(edit.start_line), end_line: Number(edit.end_line) });
          continue;
        }
        if (edit.op === 'insert_before' && Number.isInteger(edit.line) && typeof edit.text === 'string') {
          edits.push({ op: 'insert_before', line: Number(edit.line), text: edit.text });
          continue;
        }
        if (edit.op === 'insert_after' && Number.isInteger(edit.line) && typeof edit.text === 'string') {
          edits.push({ op: 'insert_after', line: Number(edit.line), text: edit.text });
          continue;
        }
        return { ok: false, message: 'patch_component edits must use replace, delete, insert_before, or insert_after with valid line numbers.' };
      }
      return {
        ok: true,
        value: {
          tool,
          component_ref: parsed.component_ref,
          edits,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'remove_section' && typeof parsed.section_ref === 'string') {
      return {
        ok: true,
        value: { tool, section_ref: parsed.section_ref, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined },
      };
    }
    if (tool === 'remove_component' && typeof parsed.component_ref === 'string') {
      return {
        ok: true,
        value: { tool, component_ref: parsed.component_ref, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined },
      };
    }
    if (tool === 'create_component' && typeof parsed.position === 'string' && typeof parsed.hvy === 'string' && parsed.hvy.trim().length > 0) {
      if (parsed.position !== 'append-to-section' && parsed.position !== 'before' && parsed.position !== 'after') {
        return { ok: false, message: 'create_component.position must be append-to-section, before, or after.' };
      }
      return {
        ok: true,
        value: {
          tool,
          position: parsed.position,
          section_ref: typeof parsed.section_ref === 'string' ? parsed.section_ref : undefined,
          target_component_ref: typeof parsed.target_component_ref === 'string' ? parsed.target_component_ref : undefined,
          hvy: parsed.hvy,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'create_section' && typeof parsed.position === 'string') {
      if (parsed.position !== 'append-root' && parsed.position !== 'append-child' && parsed.position !== 'before' && parsed.position !== 'after') {
        return { ok: false, message: 'create_section.position must be append-root, append-child, before, or after.' };
      }
      return {
        ok: true,
        value: {
          tool,
          position: parsed.position,
          title: typeof parsed.title === 'string' ? parsed.title : undefined,
          target_section_ref: typeof parsed.target_section_ref === 'string' ? parsed.target_section_ref : undefined,
          parent_section_ref: typeof parsed.parent_section_ref === 'string' ? parsed.parent_section_ref : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (
      tool === 'reorder_section' &&
      typeof parsed.section_ref === 'string' &&
      typeof parsed.target_section_ref === 'string' &&
      (parsed.position === 'before' || parsed.position === 'after')
    ) {
      return {
        ok: true,
        value: {
          tool,
          section_ref: parsed.section_ref,
          target_section_ref: parsed.target_section_ref,
          position: parsed.position,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    return { ok: false, message: 'Return one valid tool JSON object using the documented shapes.' };
  } catch {
    return { ok: false, message: 'Return valid JSON only, with no surrounding prose.' };
  }
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

function formatNumberedFragment(fragment: string, startLine = DEFAULT_VIEW_START_LINE, endLine = DEFAULT_VIEW_END_LINE): string {
  const lines = fragment.split('\n');
  const range = clampLineRange(lines.length, startLine, endLine);
  return lines
    .slice(range.startLine - 1, range.endLine)
    .map((line, index) => `${String(range.startLine + index).padStart(3, ' ')} | ${line}`)
    .join('\n');
}

function applyComponentPatchEdits(fragment: string, edits: ComponentPatchEdit[]): string {
  let lines = fragment.split('\n');
  for (const edit of edits) {
    if (edit.op === 'replace') {
      assertValidLineRange(lines, edit.start_line, edit.end_line, 'replace');
      lines.splice(edit.start_line - 1, edit.end_line - edit.start_line + 1, ...edit.text.split('\n'));
      continue;
    }
    if (edit.op === 'delete') {
      assertValidLineRange(lines, edit.start_line, edit.end_line, 'delete');
      lines.splice(edit.start_line - 1, edit.end_line - edit.start_line + 1);
      continue;
    }
    if (edit.op === 'insert_before') {
      assertValidLineNumberForInsert(lines, edit.line, 'insert_before');
      lines.splice(edit.line - 1, 0, ...edit.text.split('\n'));
      continue;
    }
    assertValidLineNumberForInsert(lines, edit.line, 'insert_after');
    lines.splice(edit.line, 0, ...edit.text.split('\n'));
  }
  return lines.join('\n').trim();
}

function assertValidLineRange(lines: string[], startLine: number, endLine: number, op: string): void {
  if (startLine < 1 || endLine < startLine || endLine > lines.length) {
    throw new Error(`${op} line range ${startLine}-${endLine} is out of bounds for a ${lines.length}-line component.`);
  }
}

function assertValidLineNumberForInsert(lines: string[], line: number, op: string): void {
  if (line < 1 || line > lines.length) {
    throw new Error(`${op} line ${line} is out of bounds for a ${lines.length}-line component.`);
  }
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

function collectNestedBlocks(block: VisualBlock): VisualBlock[] {
  return [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
  ];
}

function findBlockByInternalId(sections: VisualSection[], blockId: string): VisualBlock | null {
  let found: VisualBlock | null = null;
  visitBlocks(sections, (block) => {
    if (!found && block.id === blockId) {
      found = block;
    }
  });
  return found;
}

function escapeInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function truncatePreview(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_TEXT_PREVIEW_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_TEXT_PREVIEW_LENGTH - 1)}...`;
}

function clampLineRange(totalLines: number, startLine = DEFAULT_VIEW_START_LINE, endLine = DEFAULT_VIEW_END_LINE): {
  startLine: number;
  endLine: number;
} {
  const safeTotal = Math.max(1, totalLines);
  const safeStart = Math.min(Math.max(1, startLine), safeTotal);
  const safeEnd = Math.min(Math.max(safeStart, endLine), safeTotal);
  return { startLine: safeStart, endLine: safeEnd };
}

function buildDocumentNumberedLines(document: VisualDocument): NumberedLine[] {
  const physicalLines = serializeDocument(document).split('\n');
  const numberedLines: NumberedLine[] = [];
  let nextLineNumber = 1;
  let currentOwnerId: string | null = null;

  for (const physicalLine of physicalLines) {
    currentOwnerId = detectLineOwnerId(physicalLine, currentOwnerId);
    const wrappedLines = splitLongLine(physicalLine, MAX_GREP_LINE_WIDTH);
    for (const wrappedLine of wrappedLines) {
      numberedLines.push({
        lineNumber: nextLineNumber,
        text: wrappedLine,
        ownerId: currentOwnerId,
      });
      nextLineNumber += 1;
    }
  }

  return numberedLines;
}

function detectLineOwnerId(line: string, currentOwnerId: string | null): string | null {
  const directiveMatch = line.match(/^\s*<!--hvy:(?:([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)\s*)?(\{.*\})\s*-->$/i);
  if (!directiveMatch) {
    return currentOwnerId;
  }

  try {
    const directivePath = directiveMatch[1] ?? '';
    const payloadRaw = directiveMatch[2] ?? '{}';
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    if (typeof payload.id === 'string' && payload.id.trim().length > 0) {
      return payload.id.trim();
    }
    if (directivePath === '' || directivePath === 'subsection') {
      return currentOwnerId;
    }
    return currentOwnerId;
  } catch {
    return currentOwnerId;
  }
}

function splitLongLine(line: string, maxWidth: number): string[] {
  if (line.length <= maxWidth) {
    return [line];
  }
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxWidth) {
    chunks.push(line.slice(index, index + maxWidth));
  }
  return chunks;
}

function buildGrepRegex(query: string, explicitFlags?: string): RegExp {
  const slashRegexMatch = query.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
  const source = slashRegexMatch ? slashRegexMatch[1] ?? '' : query;
  const flags = explicitFlags ?? (slashRegexMatch ? slashRegexMatch[2] : 'i') ?? 'i';

  try {
    return new RegExp(source, flags);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown regex error.';
    throw new Error(`grep query must be a valid regex. ${details}`);
  }
}
