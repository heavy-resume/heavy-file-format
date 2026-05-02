import { parse as parseYaml } from 'yaml';
import { requestProxyCompletion } from './chat/chat';
import { parseAiBlockEditResponse, requestAiComponentEdit } from './ai-edit';
import { createEmptySection } from './document-factory';
import { deserializeDocumentWithDiagnostics, serializeBlockFragment, serializeDocument, serializeDocumentHeaderYaml } from './serialization';
import {
  findBlockContainerById,
  findSectionByKey,
  findSectionContainer,
  getSectionId,
  moveSectionRelative,
  moveSectionToSiblingIndex,
  visitBlocks,
} from './section-ops';
import { executeDbTableQueryTool, getDocumentDbTableNames } from './plugins/db-table';
import type { VisualBlock, VisualSection } from './editor/types';
import type { ChatMessage, ChatSettings, VisualDocument } from './types';
import {
  buildEditPathSelectionInstructions,
  buildEditPathSelectionPrompt,
  buildDocumentEditFormatInstructions,
  buildHeaderEditFormatInstructions,
  buildInitialDocumentEditPrompt,
  buildInitialHeaderEditPrompt,
  buildToolResult,
  DOCUMENT_EDIT_MAX_TOOL_STEPS,
} from './ai-document-edit-instructions';
import type { JsonObject } from './hvy/types';
import { getThemeColorLabel, THEME_COLOR_NAMES } from './theme';

const MAX_SECTION_PREVIEW_LINES = 10;
const MAX_TEXT_PREVIEW_LENGTH = 72;
// Two block levels under a section yields three visible levels overall:
// section -> child -> grandchild. Anything deeper is collapsed.
const MAX_SUMMARY_NESTING = 2;
const HIDDEN_CONTENTS_MARKER = '... contents hidden ...';
const SENT_STRUCTURE_CONTEXT = 'Reduced outline context was already provided earlier in this edit session. Request the relevant outline tool if you need a fresh copy.';
const DEFAULT_VIEW_START_LINE = 1;
const DEFAULT_VIEW_END_LINE = 200;
const MAX_GREP_LINE_WIDTH = 400;

function buildDocumentEditContextSummary(summary: string, dbTableNames: string[]): string {
  if (dbTableNames.length === 0) {
    return summary;
  }
  return [
    summary,
    '',
    `DB tables available for query_db_table: ${dbTableNames.join(', ')}`,
  ].join('\n');
}

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

interface HeaderStructureSnapshot {
  summary: string;
}

type ComponentPatchEdit =
  | { op: 'replace'; start_line: number; end_line: number; text: string }
  | { op: 'delete'; start_line: number; end_line: number }
  | { op: 'insert_before'; line: number; text: string }
  | { op: 'insert_after'; line: number; text: string };

type CssPropertyMap = Record<string, string | null>;

type DocumentEditToolRequest =
  | { tool: 'done'; summary?: string }
  | { tool: 'answer'; answer: string }
  | { tool: 'request_structure'; reason?: string }
  | { tool: 'view_component'; component_ref: string; start_line?: number; end_line?: number; reason?: string }
  | { tool: 'grep'; query: string; flags?: string; before?: number; after?: number; max_count?: number; reason?: string }
  | { tool: 'get_css'; ids: string[]; regex?: string; flags?: string; reason?: string }
  | { tool: 'get_properties'; ids: string[]; properties?: string[]; regex?: string; flags?: string; reason?: string }
  | { tool: 'set_properties'; ids: string[]; properties: CssPropertyMap; reason?: string }
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
      hvy?: string;
      position: 'append-root' | 'append-child' | 'before' | 'after';
      new_position_index_from_0?: number;
      target_section_ref?: string;
      parent_section_ref?: string;
      reason?: string;
    }
  | {
      tool: 'reorder_section';
      section_ref: string;
      target_section_ref?: string;
      position?: 'before' | 'after';
      new_position_index_from_0?: number;
      reason?: string;
    }
  | {
      tool: 'query_db_table';
      table_name?: string;
      query?: string;
      limit?: number;
      reason?: string;
    };

type EditPathSelection = 'document' | 'header';

type HeaderEditToolRequest =
  | { tool: 'done'; summary?: string }
  | { tool: 'answer'; answer: string }
  | { tool: 'request_header'; reason?: string }
  | { tool: 'grep_header'; query: string; flags?: string; before?: number; after?: number; max_count?: number; reason?: string }
  | { tool: 'view_header'; start_line?: number; end_line?: number; reason?: string }
  | { tool: 'patch_header'; edits: ComponentPatchEdit[]; reason?: string };

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
  if (isLikelyInformationalAnswerRequest(params.request)) {
    return inferEditPathFromRequest(params.request) === 'header' ? runHeaderEditToolLoop(params) : runDocumentEditToolLoop(params);
  }

  const path = await selectEditPath(params);
  if (path === 'header') {
    return runHeaderEditToolLoop(params);
  }
  return runDocumentEditToolLoop(params);
}

async function selectEditPath(params: {
  settings: ChatSettings;
  document: VisualDocument;
  request: string;
}): Promise<EditPathSelection> {
  const response = await requestProxyCompletion({
    settings: params.settings,
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: buildEditPathSelectionPrompt(params.request),
      },
    ],
    context: buildEditPathSelectionContext(params.document),
    formatInstructions: buildEditPathSelectionInstructions(),
    mode: 'document-edit',
    debugLabel: 'ai-document-edit:path',
  });
  const parsed = parseEditPathSelection(response);
  if (parsed.ok === true) {
    return parsed.value;
  }

  return inferEditPathFromRequest(params.request);
}

async function runDocumentEditToolLoop(params: {
  settings: ChatSettings;
  document: VisualDocument;
  request: string;
  onMutation?: (group?: string) => void;
}): Promise<{ summary: string }> {
  let snapshot = summarizeDocumentStructure(params.document);
  const dbTableNames = getDocumentDbTableNames(params.document);
  let contextSummary = buildDocumentEditContextSummary(snapshot.summary, dbTableNames);
  let conversation: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: buildInitialDocumentEditPrompt(params.request),
    },
  ];

  for (let iteration = 0; iteration < DOCUMENT_EDIT_MAX_TOOL_STEPS; iteration += 1) {
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: conversation,
      context: contextSummary,
      formatInstructions: buildDocumentEditFormatInstructions({ dbTableNames }),
      mode: 'document-edit',
      debugLabel: `ai-document-edit:${iteration + 1}`,
    });

    const parsed = parseDocumentEditToolRequest(response);
    if (parsed.ok === false) {
      const invalidMessage = parsed.message;
      conversation = [
        ...conversation.filter((message) => message.role !== 'assistant' || !message.content.includes('The result of this action was:')),
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: `The previous response was invalid and no tools were executed. Ignore any tool results or summaries it claimed. ${invalidMessage}`,
        },
      ];
      continue;
    }

    if (parsed.value.tool === 'done') {
      return {
        summary: parsed.value.summary?.trim() || `Finished after ${iteration + 1} step${iteration === 0 ? '' : 's'}.`,
      };
    }
    if (parsed.value.tool === 'answer') {
      return {
        summary: parsed.value.answer.trim(),
      };
    }

    let toolResult = '';
    if (parsed.value.tool === 'request_structure') {
      snapshot = summarizeDocumentStructure(params.document);
      toolResult = buildToolResult('request_structure', snapshot.summary);
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'grep') {
      toolResult = buildToolResult('grep', executeGrepTool(parsed.value, params.document));
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'get_css') {
      toolResult = buildToolResult('get_css', executeGetCssTool(parsed.value, snapshot, params.document));
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'get_properties') {
      toolResult = buildToolResult('get_properties', executeGetPropertiesTool(parsed.value, snapshot, params.document));
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'set_properties') {
      toolResult = buildToolResult('set_properties', executeSetPropertiesTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'view_component') {
      toolResult = buildToolResult('view_component', executeViewComponentTool(parsed.value, snapshot, params.document));
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'edit_component') {
      toolResult = buildToolResult(
        'edit_component',
        await executeEditComponentTool(parsed.value, snapshot, params.document, params.settings, params.onMutation)
      );
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'patch_component') {
      toolResult = buildToolResult('patch_component', executePatchComponentTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'remove_section') {
      toolResult = buildToolResult('remove_section', executeRemoveSectionTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'remove_component') {
      toolResult = buildToolResult('remove_component', executeRemoveComponentTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'create_component') {
      toolResult = buildToolResult(
        'create_component',
        executeCreateComponentTool(parsed.value, snapshot, params.document, params.onMutation)
      );
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'create_section') {
      toolResult = buildToolResult('create_section', executeCreateSectionTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'reorder_section') {
      toolResult = buildToolResult('reorder_section', executeReorderSectionTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
    } else if (parsed.value.tool === 'query_db_table') {
      toolResult = buildToolResult(
        'query_db_table',
        await executeDbTableQueryTool(params.document, {
          tableName: parsed.value.table_name,
          query: parsed.value.query,
          limit: parsed.value.limit,
        })
      );
      contextSummary = buildDocumentEditContextSummary(SENT_STRUCTURE_CONTEXT, dbTableNames);
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
    summary: `Stopped after ${DOCUMENT_EDIT_MAX_TOOL_STEPS} steps. The AI can continue if you send another request.`,
  };
}

async function runHeaderEditToolLoop(params: {
  settings: ChatSettings;
  document: VisualDocument;
  request: string;
  onMutation?: (group?: string) => void;
}): Promise<{ summary: string }> {
  let snapshot = summarizeHeaderStructure(params.document);
  let contextSummary = snapshot.summary;
  let conversation: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: buildInitialHeaderEditPrompt(params.request),
    },
  ];

  for (let iteration = 0; iteration < DOCUMENT_EDIT_MAX_TOOL_STEPS; iteration += 1) {
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: conversation,
      context: contextSummary,
      formatInstructions: buildHeaderEditFormatInstructions(),
      mode: 'document-edit',
      debugLabel: `ai-header-edit:${iteration + 1}`,
    });

    const parsed = parseHeaderEditToolRequest(response);
    if (parsed.ok === false) {
      conversation = [
        ...conversation.filter((message) => message.role !== 'assistant' || !message.content.includes('The result of this action was:')),
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: `The previous response was invalid and no tools were executed. Ignore any tool results or summaries it claimed. ${parsed.message}`,
        },
      ];
      continue;
    }

    if (parsed.value.tool === 'done') {
      return {
        summary: parsed.value.summary?.trim() || `Finished header edit after ${iteration + 1} step${iteration === 0 ? '' : 's'}.`,
      };
    }
    if (parsed.value.tool === 'answer') {
      return {
        summary: parsed.value.answer.trim(),
      };
    }

    let toolResult = '';
    if (parsed.value.tool === 'request_header') {
      snapshot = summarizeHeaderStructure(params.document);
      toolResult = buildToolResult('request_header', snapshot.summary);
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'grep_header') {
      toolResult = buildToolResult('grep_header', executeGrepHeaderTool(parsed.value, params.document));
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'view_header') {
      toolResult = buildToolResult('view_header', executeViewHeaderTool(parsed.value, params.document));
      contextSummary = SENT_STRUCTURE_CONTEXT;
    } else if (parsed.value.tool === 'patch_header') {
      toolResult = buildToolResult('patch_header', executePatchHeaderTool(parsed.value, params.document, params.onMutation));
      snapshot = summarizeHeaderStructure(params.document);
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
    summary: `Stopped after ${DOCUMENT_EDIT_MAX_TOOL_STEPS} header steps. The AI can continue if you send another request.`,
  };
}

function buildEditPathSelectionContext(document: VisualDocument): string {
  const visibleSections = document.sections.filter((section) => !section.isGhost);
  const componentDefs = Array.isArray(document.meta.component_defs) ? document.meta.component_defs.length : 0;
  const sectionDefs = Array.isArray(document.meta.section_defs) ? document.meta.section_defs.length : 0;
  const metaKeys = Object.keys(document.meta).filter((key) => !key.startsWith('_')).sort();
  return [
    'HVY edit paths:',
    '- document: visible body content, sections, components, component/section CSS, ordering, additions, deletions.',
    '- header: YAML front matter metadata and reusable definitions (`component_defs`, `section_defs`, defaults, theme, schema, plugins).',
    '',
    'Current document at a glance:',
    `- visible sections: ${visibleSections.length}`,
    `- header properties: ${metaKeys.length > 0 ? metaKeys.join(', ') : '(none)'}`,
    `- component_defs: ${componentDefs}`,
    `- section_defs: ${sectionDefs}`,
  ].join('\n');
}

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

function executeGrepHeaderTool(
  request: Extract<HeaderEditToolRequest, { tool: 'grep_header' }>,
  document: VisualDocument
): string {
  const query = request.query.trim();
  if (query.length === 0) {
    throw new Error('grep_header.query must be a non-empty string.');
  }

  const before = Math.max(0, request.before ?? 0);
  const after = Math.max(0, request.after ?? 0);
  const maxCount = Math.max(1, request.max_count ?? 5);
  const matcher = buildGrepRegex(query, request.flags);
  const lines = serializeDocumentHeaderYaml(document).split('\n');
  const matchIndexes = lines
    .map((line, index) => ({ index, matches: matcher.test(line) }))
    .filter((entry) => entry.matches)
    .slice(0, maxCount)
    .map((entry) => entry.index);

  if (matchIndexes.length === 0) {
    return `No header matches for "${query}".`;
  }

  return matchIndexes
    .map((matchIndex, idx) => {
      const start = Math.max(0, matchIndex - before);
      const end = Math.min(lines.length - 1, matchIndex + after);
      return [
        `Header match ${idx + 1} of ${matchIndexes.length}`,
        ...lines.slice(start, end + 1).map((line, index) => `${String(start + index + 1).padStart(4, ' ')} | ${line}`),
      ].join('\n');
    })
    .join('\n\n');
}

function executeViewHeaderTool(
  request: Extract<HeaderEditToolRequest, { tool: 'view_header' }>,
  document: VisualDocument
): string {
  const yaml = serializeDocumentHeaderYaml(document);
  const clampRange = clampLineRange(yaml.split('\n').length, request.start_line, request.end_line);
  return [
    `Showing YAML header lines ${clampRange.startLine}-${clampRange.endLine} (without --- delimiters; default range is ${DEFAULT_VIEW_START_LINE}-${DEFAULT_VIEW_END_LINE})`,
    '',
    'Header YAML with 1-based line numbers:',
    formatNumberedFragment(yaml, clampRange.startLine, clampRange.endLine),
  ].join('\n');
}

function executePatchHeaderTool(
  request: Extract<HeaderEditToolRequest, { tool: 'patch_header' }>,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const originalYaml = serializeDocumentHeaderYaml(document);
  const patchedYaml = applyComponentPatchEdits(originalYaml, request.edits);
  const parsed = parseYaml(patchedYaml) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('patch_header produced invalid YAML. Header YAML must parse to an object.');
  }
  validateHeaderDefaults(parsed as JsonObject);

  onMutation?.('ai-edit:header');
  Object.keys(document.meta).forEach((key) => {
    delete document.meta[key];
  });
  Object.assign(document.meta, parsed as JsonObject);
  if (typeof document.meta.hvy_version === 'undefined') {
    document.meta.hvy_version = 0.1;
  }

  return `Patched header with ${request.edits.length} edit${request.edits.length === 1 ? '' : 's'}.`;
}

function validateHeaderDefaults(meta: JsonObject): void {
  assertOnlyCssDefaultFields(meta.section_defaults, 'section_defaults');

  const componentDefaults = meta.component_defaults;
  if (!componentDefaults || typeof componentDefaults !== 'object' || Array.isArray(componentDefaults)) {
    return;
  }

  for (const [componentName, defaults] of Object.entries(componentDefaults)) {
    assertOnlyCssDefaultFields(defaults, `component_defaults.${componentName}`);
  }
}

function assertOnlyCssDefaultFields(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  const unsupportedKeys = Object.keys(value).filter((key) => key !== 'css');
  if (unsupportedKeys.length > 0) {
    throw new Error(`${label} only supports the "css" field. Unsupported field${unsupportedKeys.length === 1 ? '' : 's'}: ${unsupportedKeys.join(', ')}.`);
  }
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

type CssTarget =
  | { kind: 'section'; ref: string; label: string; section: VisualSection }
  | { kind: 'component'; ref: string; label: string; block: VisualBlock };

function executeGetCssTool(
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

function executeGetPropertiesTool(
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

function executeSetPropertiesTool(
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
    throw new Error(`create_section.hvy must be a valid HVY section. ${errors.map((diagnostic) => diagnostic.message).join(' ')}`);
  }
  if (parsed.document.sections.length !== 1) {
    throw new Error('create_section.hvy must contain exactly one top-level HVY section.');
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

function executeReorderSectionTool(
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
    if (tool === 'answer' && typeof parsed.answer === 'string' && parsed.answer.trim().length > 0) {
      return { ok: true, value: { tool, answer: parsed.answer } };
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
    if ((tool === 'get_css' || tool === 'get_properties') && Array.isArray(parsed.ids) && parsed.ids.every((id) => typeof id === 'string')) {
      const regex = typeof parsed.regex === 'string' ? parsed.regex : undefined;
      const flags = typeof parsed.flags === 'string' ? parsed.flags : undefined;
      if (regex) {
        try {
          buildToolRegex(regex, flags, `${tool}.regex`);
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : `${tool}.regex must be valid.` };
        }
      }
      return {
        ok: true,
        value:
          tool === 'get_css'
            ? {
                tool,
                ids: parsed.ids,
                regex,
                flags,
                reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
              }
            : {
                tool,
                ids: parsed.ids,
                properties: Array.isArray(parsed.properties) && parsed.properties.every((property) => typeof property === 'string') ? parsed.properties : undefined,
                regex,
                flags,
                reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
              },
      };
    }
    if (tool === 'set_properties' && Array.isArray(parsed.ids) && parsed.ids.every((id) => typeof id === 'string') && parsed.properties && typeof parsed.properties === 'object' && !Array.isArray(parsed.properties)) {
      const properties: CssPropertyMap = {};
      for (const [property, value] of Object.entries(parsed.properties as Record<string, unknown>)) {
        if (typeof value !== 'string' && value !== null) {
          return { ok: false, message: 'set_properties.properties values must be strings or null.' };
        }
        properties[property] = value === null ? null : (value as string);
      }
      return {
        ok: true,
        value: {
          tool,
          ids: parsed.ids,
          properties,
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
      const title = typeof parsed.title === 'string' ? parsed.title : undefined;
      const hvy = typeof parsed.hvy === 'string' ? parsed.hvy : undefined;
      if (!hvy && !title) {
        return { ok: false, message: 'create_section requires hvy or title.' };
      }
      return {
        ok: true,
        value: {
          tool,
          position: parsed.position,
          title,
          hvy,
          new_position_index_from_0: Number.isInteger(parsed.new_position_index_from_0) ? Number(parsed.new_position_index_from_0) : undefined,
          target_section_ref: typeof parsed.target_section_ref === 'string' ? parsed.target_section_ref : undefined,
          parent_section_ref: typeof parsed.parent_section_ref === 'string' ? parsed.parent_section_ref : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (
      tool === 'reorder_section' &&
      typeof parsed.section_ref === 'string' &&
      (Number.isInteger(parsed.new_position_index_from_0) ||
        (typeof parsed.target_section_ref === 'string' && (parsed.position === 'before' || parsed.position === 'after')))
    ) {
      return {
        ok: true,
        value: {
          tool,
          section_ref: parsed.section_ref,
          target_section_ref: typeof parsed.target_section_ref === 'string' ? parsed.target_section_ref : undefined,
          position: parsed.position === 'before' || parsed.position === 'after' ? parsed.position : undefined,
          new_position_index_from_0: Number.isInteger(parsed.new_position_index_from_0) ? Number(parsed.new_position_index_from_0) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (
      tool === 'query_db_table' &&
      (
        typeof parsed.table_name === 'string'
        || typeof parsed.query === 'string'
      )
    ) {
      if (typeof parsed.query === 'string' && parsed.query.trim().length === 0 && typeof parsed.table_name !== 'string') {
        return { ok: false, message: 'query_db_table requires table_name or a non-empty query.' };
      }
      return {
        ok: true,
        value: {
          tool,
          table_name: typeof parsed.table_name === 'string' ? parsed.table_name : undefined,
          query: typeof parsed.query === 'string' ? parsed.query : undefined,
          limit: Number.isInteger(parsed.limit) ? Number(parsed.limit) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    return { ok: false, message: 'Return one valid tool JSON object using the documented shapes.' };
  } catch {
    return { ok: false, message: 'Return valid JSON only, with no surrounding prose.' };
  }
}

function parseEditPathSelection(source: string): { ok: true; value: EditPathSelection } | { ok: false; message: string } {
  const cleaned = source.trim().replace(/^`+|`+$/g, '').trim().toLowerCase();
  if (cleaned === 'document' || cleaned === 'header') {
    return { ok: true, value: cleaned };
  }
  return { ok: false, message: 'Path selection must be exactly "document" or "header".' };
}

function parseHeaderEditToolRequest(source: string): { ok: true; value: HeaderEditToolRequest } | { ok: false; message: string } {
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
    if (tool === 'answer' && typeof parsed.answer === 'string' && parsed.answer.trim().length > 0) {
      return { ok: true, value: { tool, answer: parsed.answer } };
    }
    if (tool === 'request_header') {
      return { ok: true, value: { tool, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined } };
    }
    if (tool === 'grep_header' && typeof parsed.query === 'string' && parsed.query.trim().length > 0) {
      const flags = typeof parsed.flags === 'string' ? parsed.flags : undefined;
      try {
        buildGrepRegex(parsed.query, flags);
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'grep_header query must be a valid regex pattern.',
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
    if (tool === 'view_header') {
      return {
        ok: true,
        value: {
          tool,
          start_line: Number.isInteger(parsed.start_line) ? Number(parsed.start_line) : undefined,
          end_line: Number.isInteger(parsed.end_line) ? Number(parsed.end_line) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'patch_header' && Array.isArray(parsed.edits) && parsed.edits.length > 0) {
      const edits = parsePatchEdits(parsed.edits);
      if (edits.ok === false) {
        return { ok: false, message: edits.message };
      }
      return {
        ok: true,
        value: {
          tool,
          edits: edits.value,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    return { ok: false, message: 'Return one valid header tool JSON object using the documented shapes.' };
  } catch {
    return { ok: false, message: 'Return valid JSON only, with no surrounding prose.' };
  }
}

function parsePatchEdits(source: unknown[]): { ok: true; value: ComponentPatchEdit[] } | { ok: false; message: string } {
  const edits: ComponentPatchEdit[] = [];
  for (const candidate of source) {
    if (!candidate || typeof candidate !== 'object') {
      return { ok: false, message: 'patch edits must be an array of patch operations.' };
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
    return { ok: false, message: 'patch edits must use replace, delete, insert_before, or insert_after with valid line numbers.' };
  }
  return { ok: true, value: edits };
}

function inferEditPathFromRequest(request: string): EditPathSelection {
  return /\b(header|front matter|frontmatter|metadata|meta|component_defs|component defs|section_defs|section defs|reusable|theme|reader_max_width|sidebar_label|template|schema|plugin)\b/i.test(
    request
  )
    ? 'header'
    : 'document';
}

function isLikelyInformationalAnswerRequest(request: string): boolean {
  const normalized = request.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    /\b(add|append|change|convert|create|delete|edit|fix|format|insert|make|move|patch|remove|rename|replace|reorder|set|style|update|write)\b/i.test(
      normalized
    )
  ) {
    return false;
  }
  return (
    /\?$/.test(normalized) ||
    /^(can|could|did|do|does|how|is|should|what|when|where|which|who|why)\b/i.test(normalized) ||
    /^(can|could) you (explain|tell me|answer|clarify)\b/i.test(normalized)
  );
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

function buildToolRegex(query: string, explicitFlags: string | undefined, label: string): RegExp {
  try {
    return buildGrepRegex(query, explicitFlags);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown regex error.';
    throw new Error(`${label} must be a valid regex. ${details}`);
  }
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
    const componentEntry = snapshot.componentRefs.get(id);
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
  return target.kind === 'section' ? target.section.customCss : target.block.schema.customCss;
}

function setTargetCss(target: CssTarget, css: string): void {
  if (target.kind === 'section') {
    target.section.customCss = css;
    return;
  }
  target.block.schema.customCss = css;
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
