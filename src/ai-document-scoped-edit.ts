import { parse as parseYaml } from 'yaml';
import { requestProxyCompletion, traceAgentLoopEvent } from './chat/chat';
import { requestAiComponentEdit } from './ai-component-edit';
import { parseAiBlockEditResponse } from './ai-component-edit-common';
import { getPluginAiHelp, getRegisteredPluginAiHints } from './ai-plugin-hints';
import { createEmptySection } from './document-factory';
import { deserializeDocumentWithDiagnostics, serializeBlockFragment, serializeDocument, serializeDocumentHeaderYaml, serializeSectionFragment } from './serialization';
import {
  findBlockContainerById,
  findSectionByKey,
  findSectionContainer,
  getSectionId,
  moveSectionRelative,
  moveSectionToSiblingIndex,
  visitBlocks,
} from './section-ops';
import {
  executeDbTableQueryTool,
  executeDbTableWriteSql,
  formatQueryResultTable,
  getDbTableRenderedText,
  getDocumentDbTableObjectNames,
  getDocumentDbTableNames,
} from './plugins/db-table';
import type { VisualBlock, VisualSection } from './editor/types';
import type { ChatMessage, ChatSettings, VisualDocument } from './types';
import {
  buildDocumentEditFormatInstructions,
  buildDocumentEditToolHelp,
  buildHeaderEditFormatInstructions,
  buildInitialDocumentEditPrompt,
  buildInitialHeaderEditPrompt,
  buildToolResult,
  DOCUMENT_EDIT_MAX_TOOL_STEPS,
} from './ai-document-edit-instructions';
import type { JsonObject } from './hvy/types';
import { getThemeColorLabel, THEME_COLOR_NAMES } from './theme';
import { DB_TABLE_PLUGIN_ID, getHostPlugin } from './plugins/registry';

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
const MAX_WORK_LEDGER_ITEMS = 35;
const TOOL_FAILURE_WINDOW_SIZE = 5;
const MAX_TOOL_FAILURES_IN_WINDOW = 2;

function buildDocumentEditContextSummary(
  summary: string,
  dbObjectNames: string[],
  configuredDbTableNames: string[]
): string {
  const parts = [summary];
  if (dbObjectNames.length > 0) {
    parts.push('', `SQLite tables/views available for query_db_table: ${dbObjectNames.join(', ')}`);
  }
  if (configuredDbTableNames.length > 0) {
    parts.push('', `Configured db-table component targets: ${configuredDbTableNames.join(', ')}`);
    const missingTargets = configuredDbTableNames.filter((name) => !dbObjectNames.includes(name));
    if (missingTargets.length > 0) {
      parts.push(
        `Missing SQLite tables/views targeted by db-table components: ${missingTargets.join(', ')}.`,
        'If a rendered db-table reports a missing table/view, first decide whether the component should target a base table, a derived view, or an existing SQLite object. Create the missing object with `execute_sql` or retarget pluginConfig.table only when an existing object matches the component intent.'
      );
    }
  }
  return parts.join('\n');
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
  parentChain: string[];
  hiddenFromSummary: boolean;
  generated: boolean;
}

interface DocumentStructureSnapshot {
  summary: string;
  sectionRefs: Map<string, SectionRefEntry>;
  componentRefs: Map<string, ComponentRefEntry>;
  deepComponentRefs: Map<string, ComponentRefEntry>;
}

interface WorkLedgerItem {
  action: string;
  intent: string;
  summary: string;
  result: string;
}

interface WorkNoteState {
  goal: string;
  done: string[];
  currentFocus: string;
  remaining: string[];
  cautions: string[];
}

interface HvyRepairToolContext {
  tool: 'patch_component' | 'create_component' | 'create_section';
  syntaxProblem: string;
  before?: string;
  after?: string;
  reference: string;
  nextAction: string;
}

class HvyRepairToolError extends Error {
  readonly repair: HvyRepairToolContext;

  constructor(message: string, repair: HvyRepairToolContext) {
    super(message);
    this.name = 'HvyRepairToolError';
    this.repair = repair;
  }
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

type DocumentEditSingleToolRequest =
  | { tool: 'done'; summary?: string }
  | { tool: 'answer'; answer: string }
  | { tool: 'plan'; steps: string[]; reason?: string }
  | { tool: 'mark_step_done'; step: number; summary?: string; reason?: string }
  | { tool: 'request_structure'; reason?: string }
  | { tool: 'request_rendered_structure'; reason?: string }
  | { tool: 'get_help'; topic: string; reason?: string }
  | { tool: 'search_components'; query: string; max_count?: number; reason?: string }
  | { tool: 'view_component'; component_ref: string; start_line?: number; end_line?: number; reason?: string }
  | { tool: 'view_rendered_component'; component_ref: string; reason?: string }
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
    }
  | {
      tool: 'execute_sql';
      sql: string;
      reason?: string;
    };

type DocumentEditBatchToolRequest = Exclude<
  DocumentEditSingleToolRequest,
  { tool: 'done' | 'answer' | 'plan' | 'mark_step_done' }
>;

type DocumentEditToolRequest =
  | DocumentEditSingleToolRequest
  | {
      tool: 'batch';
      calls: DocumentEditBatchToolRequest[];
      reason?: string;
    };

type EditPathSelection = 'document' | 'header';

type HeaderEditToolRequest =
  | { tool: 'done'; summary?: string }
  | { tool: 'answer'; answer: string }
  | { tool: 'plan'; steps: string[]; reason?: string }
  | { tool: 'mark_step_done'; step: number; summary?: string; reason?: string }
  | { tool: 'request_header'; reason?: string }
  | { tool: 'grep_header'; query: string; flags?: string; before?: number; after?: number; max_count?: number; reason?: string }
  | { tool: 'view_header'; start_line?: number; end_line?: number; reason?: string }
  | { tool: 'patch_header'; edits: ComponentPatchEdit[]; reason?: string };

interface ChatTurnResult {
  messages: ChatMessage[];
  error: string | null;
}

interface EditPlanState {
  steps: Array<{
    text: string;
    done: boolean;
    summary?: string;
  }>;
}

interface LoopHealthState {
  stallScore: number;
  invalidResponses: number;
  consecutiveSameAction: number;
  lastActionKey: string | null;
  recoveryCount: number;
  seenActionKeys: Set<string>;
  toolFailureWindow: boolean[];
}

export async function requestAiDocumentEditTurn(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
  request: string;
  onMutation?: (group?: string) => void;
  onProgress?: (message: ChatMessage) => void;
  signal?: AbortSignal;
}): Promise<ChatTurnResult> {
  const nextMessages = appendChatMessage(params.messages, params.request);
  const progressMessages: ChatMessage[] = [];
  const traceRunId = crypto.randomUUID();
  const emitProgress = (content: string): void => {
    console.debug('[hvy:ai-document-edit] progress', { content });
    traceAgentLoopEvent({
      runId: traceRunId,
      phase: 'document-edit',
      type: 'progress',
      payload: { content },
      signal: params.signal,
    });
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      progress: true,
    };
    progressMessages.push(message);
    params.onProgress?.(message);
  };

  try {
    console.debug('[hvy:ai-document-edit] turn started', {
      requestLength: params.request.length,
      sections: params.document.sections.length,
      currentMessages: params.messages.length,
      aborted: params.signal?.aborted ?? false,
    });
    emitProgress('Starting document edit loop.');
    const result = await runDocumentEditLoop({
      settings: params.settings,
      document: params.document,
      request: params.request,
      onMutation: params.onMutation,
      onProgress: emitProgress,
      traceRunId,
      signal: params.signal,
    });
    throwIfAborted(params.signal);
    console.debug('[hvy:ai-document-edit] turn completed', {
      summary: result.summary,
      progressMessages: progressMessages.length,
    });
    return {
      messages: [
        ...nextMessages,
        ...progressMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.summary,
        },
      ],
      error: null,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        messages: [
          ...nextMessages,
          ...progressMessages,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Stopped.',
            progress: true,
          },
        ],
        error: null,
      };
    }
    console.error('[hvy:ai-document-edit] request failed', {
      request: params.request,
      settings: params.settings,
      error,
    });
    const message = error instanceof Error ? error.message : 'AI document edit failed.';
    return {
      messages: [
        ...nextMessages,
        ...progressMessages,
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
  onProgress?: (content: string) => void;
  traceRunId?: string;
  signal?: AbortSignal;
}): Promise<{ summary: string }> {
  const path = inferEditPathFromRequest(params.request);
  console.debug('[hvy:ai-document-edit] selected edit path', {
    likelyInformational: isLikelyInformationalAnswerRequest(params.request),
    path,
  });
  if (path === 'header') {
    params.onProgress?.('Using header edit tools.');
    return runHeaderEditToolLoop(params);
  }
  params.onProgress?.('Using document edit tools.');
  return runDocumentEditToolLoop(params);
}

async function runDocumentEditToolLoop(params: {
  settings: ChatSettings;
  document: VisualDocument;
  request: string;
  onMutation?: (group?: string) => void;
  onProgress?: (content: string) => void;
  traceRunId?: string;
  signal?: AbortSignal;
}): Promise<{ summary: string }> {
  let snapshot = summarizeDocumentStructure(params.document);
  let configuredDbTableNames = getDocumentDbTableNames(params.document);
  let dbObjectNames = await getDocumentDbTableObjectNames(params.document);
  const pluginHints = getRegisteredPluginAiHints();
  const refreshDbContext = async (summary: string): Promise<string> => {
    configuredDbTableNames = getDocumentDbTableNames(params.document);
    dbObjectNames = await getDocumentDbTableObjectNames(params.document);
    return buildDocumentEditContextSummary(summary, dbObjectNames, configuredDbTableNames);
  };
  params.onProgress?.('Walking the document and collecting section notes.');
  const documentWalkNotes = buildDocumentWalkNotes(params.document, snapshot);
  logDocumentWalkNotes(documentWalkNotes, params.traceRunId, params.signal);
  let contextSummary = buildDocumentEditContextSummary(documentWalkNotes, dbObjectNames, configuredDbTableNames);
  let recentToolHelp: string | null = null;
  const workLedger: WorkLedgerItem[] = [];
  let latestIntent = params.request;
  let workNote: WorkNoteState = createInitialWorkNote(params.request);
  let plan: EditPlanState | null = null;
  const health = createLoopHealthState();
  let conversation: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: buildInitialDocumentEditPrompt(params.request),
    },
  ];

  for (let iteration = 0; iteration < DOCUMENT_EDIT_MAX_TOOL_STEPS; iteration += 1) {
    throwIfAborted(params.signal);
    conversation = compactToolLoopConversation({
      conversation,
      goal: params.request,
      document: params.document,
      plan,
      path: 'document',
    });
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: conversation,
      context: buildLoopContext(contextSummary, plan, recentToolHelp, workLedger, buildIntentRecall(latestIntent, snapshot, params.document), workNote),
      formatInstructions: buildDocumentEditFormatInstructions({
        dbTableNames: dbObjectNames,
        pluginHints,
        planActive: plan !== null,
        request: params.request,
      }),
      mode: 'document-edit',
      debugLabel: `ai-document-edit:${iteration + 1}`,
      traceRunId: params.traceRunId,
      signal: params.signal,
    });

    const parsed = parseDocumentEditToolRequest(response);
    if (parsed.ok === false) {
      const recovery = updateLoopHealthForInvalid(health, getLoopStallThreshold(params.request, plan));
      if (health.invalidResponses >= 10 || recovery === 'stop') {
        return { summary: 'Stopped because the AI edit loop was not producing valid tool calls. Try a narrower request or ask it to continue from the current document.' };
      }
      const invalidMessage = parsed.message;
      conversation = [
        ...conversation.filter((message) => message.role !== 'assistant' || !message.content.includes('The result of this action was:')),
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: `Return one valid tool JSON object using the documented shapes. ${invalidMessage}`,
        },
        ...(recovery === 'recover' ? [buildLoopRecoveryChatMessage()] : []),
      ];
      continue;
    }

    if (parsed.value.tool === 'done') {
      params.onProgress?.('Finished edit loop.');
      return {
        summary: parsed.value.summary?.trim() || `Finished after ${iteration + 1} step${iteration === 0 ? '' : 's'}.`,
      };
    }
    if (parsed.value.tool === 'answer') {
      params.onProgress?.('Answered without changing the document.');
      return {
        summary: parsed.value.answer.trim(),
      };
    }

    const actionKey = getToolActionKey(parsed.value);
    latestIntent = getDocumentToolIntent(parsed.value) || latestIntent;
    const beforeProgress = summarizeDocumentLoopProgress(params.document, plan);
    const newInformationProgress = isDocumentInformationTool(parsed.value.tool) && !health.seenActionKeys.has(actionKey);
    let toolResult = '';
    let toolHadExecutionFailure = false;
    try {
    if (parsed.value.tool === 'batch') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      const batchResults: string[] = [];
      let batchShouldAbort = false;
      for (const [callIndex, call] of parsed.value.calls.entries()) {
        params.onProgress?.(describeDocumentToolProgress(call));
        latestIntent = getDocumentToolIntent(call) || latestIntent;
        let callHadExecutionFailure = false;
        try {
          let callResult = '';
          if (call.tool === 'request_structure') {
            snapshot = summarizeDocumentStructure(params.document);
            callResult = snapshot.summary;
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'request_rendered_structure') {
            snapshot = summarizeDocumentStructure(params.document);
            callResult = await executeRequestRenderedStructureTool(snapshot, params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'get_help') {
            recentToolHelp = executeGetHelpTool(call);
            callResult = recentToolHelp;
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'search_components') {
            callResult = executeSearchComponentsTool(call, snapshot, params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'grep') {
            callResult = executeGrepTool(call, params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'get_css') {
            callResult = executeGetCssTool(call, snapshot, params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'get_properties') {
            callResult = executeGetPropertiesTool(call, snapshot, params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'set_properties') {
            callResult = executeSetPropertiesTool(call, snapshot, params.document, params.onMutation);
            snapshot = summarizeDocumentStructure(params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'view_component') {
            callResult = executeViewComponentTool(call, snapshot, params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'view_rendered_component') {
            callResult = await executeViewRenderedComponentTool(call, snapshot, params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'edit_component') {
            callResult = await executeEditComponentTool(call, snapshot, params.document, params.settings, params.onMutation);
            snapshot = summarizeDocumentStructure(params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'patch_component') {
            callResult = executePatchComponentTool(call, snapshot, params.document, params.onMutation);
            snapshot = summarizeDocumentStructure(params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'remove_section') {
            callResult = executeRemoveSectionTool(call, snapshot, params.document, params.onMutation);
            snapshot = summarizeDocumentStructure(params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'remove_component') {
            callResult = executeRemoveComponentTool(call, snapshot, params.document, params.onMutation);
            snapshot = summarizeDocumentStructure(params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'create_component') {
            callResult = executeCreateComponentTool(call, snapshot, params.document, params.onMutation);
            snapshot = summarizeDocumentStructure(params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'create_section') {
            callResult = executeCreateSectionTool(call, snapshot, params.document, params.onMutation);
            snapshot = summarizeDocumentStructure(params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'reorder_section') {
            callResult = executeReorderSectionTool(call, snapshot, params.document, params.onMutation);
            snapshot = summarizeDocumentStructure(params.document);
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'query_db_table') {
            try {
              callResult = await executeDbTableQueryTool(params.document, {
                tableName: call.table_name,
                query: call.query,
                limit: call.limit,
              });
            } catch (error) {
              callHadExecutionFailure = true;
              const message = error instanceof Error ? error.message : 'Unknown database query error.';
              callResult = [
                `Query failed: ${message}`,
                'Inspect the table with query_db_table using only table_name, then retry with columns that actually exist.',
              ].join('\n');
            }
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          } else if (call.tool === 'execute_sql') {
            try {
              params.onMutation?.('execute-sql');
              callResult = await executeDbTableWriteSql(call.sql);
            } catch (error) {
              callHadExecutionFailure = true;
              const message = error instanceof Error ? error.message : 'Unknown database write error.';
              callResult = `SQL failed: ${message}`;
            }
            contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          }
          batchResults.push(`Call ${callIndex + 1}: ${describeLedgerAction(call)}\n${buildToolResult(call.tool, callResult)}`);
          if (recordToolExecutionOutcome(health, callHadExecutionFailure) === 'stop') {
            batchShouldAbort = true;
            break;
          }
          if (isToolResultFailure(callResult)) {
            break;
          }
        } catch (error) {
          callHadExecutionFailure = true;
          if (params.traceRunId) {
            traceAgentLoopEvent({
              runId: params.traceRunId,
              phase: 'document-edit',
              type: 'client_event',
              payload: {
                event: 'tool_failure',
                tool: call.tool,
                action: getToolActionKey(call),
                message: error instanceof Error ? error.message : String(error),
              },
              signal: params.signal,
            });
          }
          params.onProgress?.(formatDocumentToolFailureForProgress(error));
          const failure = formatDocumentToolFailure(error);
          batchResults.push(`Call ${callIndex + 1}: ${describeLedgerAction(call)}\n${buildToolResult(call.tool, failure)}`);
          workNote = recordWorkNoteCaution(workNote, summarizeToolFailureMessage(error instanceof Error ? error.message : String(error)));
          contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
          if (recordToolExecutionOutcome(health, callHadExecutionFailure) === 'stop') {
            batchShouldAbort = true;
          }
          break;
        }
      }
      toolResult = buildToolResult('batch', batchResults.join('\n\n'));
      toolHadExecutionFailure = batchResults.some((result) => /\b(Tool failed|Query failed|SQL failed)\b/i.test(result));
      if (batchShouldAbort) {
        params.onProgress?.('Stopped after repeated tool failures.');
        return { summary: 'Stopped after repeated tool failures. The AI can continue if you send another request.' };
      }
    } else if (parsed.value.tool === 'plan') {
      if (plan) {
        toolResult = buildToolResult('plan', [
          'A plan already exists and the `plan` tool is no longer available for this request.',
          'Continue by executing the next unfinished step and use `mark_step_done` when it is complete.',
          '',
          formatPlanState(plan),
        ].join('\n'));
      } else {
        plan = { steps: normalizePlanSteps(parsed.value.steps).map((step) => ({ text: step, done: false })) };
        workNote = updateWorkNoteRemaining(workNote, plan);
        rewardLoopHealthForPlanCreated(health, plan);
        toolResult = buildToolResult('plan', formatPlanState(plan));
        params.onProgress?.(formatPlanState(plan));
      }
    } else if (parsed.value.tool === 'mark_step_done') {
      const result = markPlanStepDone(plan, parsed.value.step, parsed.value.summary);
      if (result.changed) {
        workNote = recordWorkNoteDone(workNote, result.summary || parsed.value.summary || `Plan step ${parsed.value.step}`);
        workNote = updateWorkNoteRemaining(workNote, plan);
        if (plan) {
          params.onProgress?.(formatPlanState(plan));
        }
        rewardLoopHealthForPlanStepDone(health);
      }
      toolResult = buildToolResult('mark_step_done', result.message);
      if (result.changed && isPlanComplete(plan)) {
        params.onProgress?.('Completed all plan steps.');
        return {
          summary: result.summary || 'Completed all plan steps.',
        };
      }
    } else if (parsed.value.tool === 'request_structure') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      snapshot = summarizeDocumentStructure(params.document);
      toolResult = buildToolResult('request_structure', snapshot.summary);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'request_rendered_structure') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      snapshot = summarizeDocumentStructure(params.document);
      toolResult = buildToolResult('request_rendered_structure', await executeRequestRenderedStructureTool(snapshot, params.document));
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'get_help') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      recentToolHelp = executeGetHelpTool(parsed.value);
      toolResult = buildToolResult('get_help', recentToolHelp);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'search_components') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('search_components', executeSearchComponentsTool(parsed.value, snapshot, params.document));
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'grep') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('grep', executeGrepTool(parsed.value, params.document));
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'get_css') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('get_css', executeGetCssTool(parsed.value, snapshot, params.document));
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'get_properties') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('get_properties', executeGetPropertiesTool(parsed.value, snapshot, params.document));
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'set_properties') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('set_properties', executeSetPropertiesTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'view_component') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('view_component', executeViewComponentTool(parsed.value, snapshot, params.document));
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'view_rendered_component') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('view_rendered_component', await executeViewRenderedComponentTool(parsed.value, snapshot, params.document));
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'edit_component') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult(
        'edit_component',
        await executeEditComponentTool(parsed.value, snapshot, params.document, params.settings, params.onMutation)
      );
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'patch_component') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('patch_component', executePatchComponentTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'remove_section') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('remove_section', executeRemoveSectionTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'remove_component') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('remove_component', executeRemoveComponentTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'create_component') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      try {
        toolResult = buildToolResult(
          'create_component',
          executeCreateComponentTool(parsed.value, snapshot, params.document, params.onMutation)
        );
        snapshot = summarizeDocumentStructure(params.document);
        contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
      } catch (error) {
        toolHadExecutionFailure = true;
        const failure = formatDocumentToolFailure(error);
        params.onProgress?.(formatDocumentToolFailureForProgress(error));
        toolResult = buildToolResult('create_component', failure);
      }
    } else if (parsed.value.tool === 'create_section') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      try {
        toolResult = buildToolResult('create_section', executeCreateSectionTool(parsed.value, snapshot, params.document, params.onMutation));
        snapshot = summarizeDocumentStructure(params.document);
        contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
      } catch (error) {
        toolHadExecutionFailure = true;
        const failure = formatDocumentToolFailure(error);
        params.onProgress?.(formatDocumentToolFailureForProgress(error));
        toolResult = buildToolResult('create_section', failure);
      }
    } else if (parsed.value.tool === 'reorder_section') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      toolResult = buildToolResult('reorder_section', executeReorderSectionTool(parsed.value, snapshot, params.document, params.onMutation));
      snapshot = summarizeDocumentStructure(params.document);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'query_db_table') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      let queryResult: string;
      try {
        queryResult = await executeDbTableQueryTool(params.document, {
          tableName: parsed.value.table_name,
          query: parsed.value.query,
          limit: parsed.value.limit,
        });
      } catch (error) {
        toolHadExecutionFailure = true;
        const message = error instanceof Error ? error.message : 'Unknown database query error.';
        queryResult = [
          `Query failed: ${message}`,
          'Inspect the table with query_db_table using only table_name, then retry with columns that actually exist.',
        ].join('\n');
      }
      toolResult = buildToolResult('query_db_table', queryResult);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    } else if (parsed.value.tool === 'execute_sql') {
      params.onProgress?.(describeDocumentToolProgress(parsed.value));
      let sqlResult: string;
      try {
        params.onMutation?.('execute-sql');
        sqlResult = await executeDbTableWriteSql(parsed.value.sql);
      } catch (error) {
        toolHadExecutionFailure = true;
        const message = error instanceof Error ? error.message : 'Unknown database write error.';
        sqlResult = `SQL failed: ${message}`;
      }
      toolResult = buildToolResult('execute_sql', sqlResult);
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    }
    } catch (error) {
      if (params.traceRunId) {
        traceAgentLoopEvent({
          runId: params.traceRunId,
          phase: 'document-edit',
          type: 'client_event',
          payload: {
            event: 'tool_failure',
            tool: parsed.value.tool,
            action: getToolActionKey(parsed.value),
            message: error instanceof Error ? error.message : String(error),
          },
          signal: params.signal,
        });
      }
      params.onProgress?.(formatDocumentToolFailureForProgress(error));
      toolResult = buildToolResult(parsed.value.tool, formatDocumentToolFailure(error));
      toolHadExecutionFailure = true;
      workNote = recordWorkNoteCaution(workNote, summarizeToolFailureMessage(error instanceof Error ? error.message : String(error)));
      contextSummary = await refreshDbContext(SENT_STRUCTURE_CONTEXT);
    }

    if (parsed.value.tool !== 'batch' && recordToolExecutionOutcome(health, toolHadExecutionFailure) === 'stop') {
      params.onProgress?.('Stopped after repeated tool failures.');
      return { summary: 'Stopped after repeated tool failures. The AI can continue if you send another request.' };
    }

    const autoCompletion = autoUpdatePlanAndWorkNote(plan, workNote, parsed.value, toolResult);
    workNote = autoCompletion.workNote;
    if (autoCompletion.changed) {
      rewardLoopHealthForPlanStepDone(health);
      params.onProgress?.(formatPlanState(plan!));
      if (isPlanComplete(plan)) {
        params.onProgress?.('Completed all plan steps.');
        return {
          summary: autoCompletion.summary || 'Completed all plan steps.',
        };
      }
    }

    const afterProgress = summarizeDocumentLoopProgress(params.document, plan);
    const recovery = updateLoopHealthForAction(
      health,
      actionKey,
      beforeProgress !== afterProgress || newInformationProgress,
      getLoopStallThreshold(params.request, plan)
    );
    if (recovery === 'stop') {
      return { summary: 'Stopped because the AI edit loop appeared stuck repeating actions without making progress. The AI can continue if you send another request.' };
    }

    const ledgerItem = recordWorkLedgerItem(workLedger, parsed.value, latestIntent, toolResult);
    if (ledgerItem && params.traceRunId) {
      traceAgentLoopEvent({
        runId: params.traceRunId,
        phase: 'document-edit',
        type: 'work_ledger',
        payload: { ...ledgerItem },
        signal: params.signal,
      });
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
      ...(recovery === 'recover' ? [buildLoopRecoveryChatMessage()] : []),
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
  onProgress?: (content: string) => void;
  traceRunId?: string;
  signal?: AbortSignal;
}): Promise<{ summary: string }> {
  let snapshot = summarizeHeaderStructure(params.document);
  let contextSummary = snapshot.summary;
  let plan: EditPlanState | null = null;
  const health = createLoopHealthState();
  let conversation: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: buildInitialHeaderEditPrompt(params.request),
    },
  ];

  for (let iteration = 0; iteration < DOCUMENT_EDIT_MAX_TOOL_STEPS; iteration += 1) {
    throwIfAborted(params.signal);
    conversation = compactToolLoopConversation({
      conversation,
      goal: params.request,
      document: params.document,
      plan,
      path: 'header',
    });
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: conversation,
      context: buildLoopContext(contextSummary, plan),
      formatInstructions: buildHeaderEditFormatInstructions({ planActive: plan !== null }),
      mode: 'document-edit',
      debugLabel: `ai-header-edit:${iteration + 1}`,
      traceRunId: params.traceRunId,
      signal: params.signal,
    });

    const parsed = parseHeaderEditToolRequest(response);
    if (parsed.ok === false) {
      const recovery = updateLoopHealthForInvalid(health, getLoopStallThreshold(params.request, plan));
      if (health.invalidResponses >= 10 || recovery === 'stop') {
        return { summary: 'Stopped because the AI header edit loop was not producing valid tool calls. Try a narrower request or ask it to continue from the current document.' };
      }
      conversation = [
        ...conversation.filter((message) => message.role !== 'assistant' || !message.content.includes('The result of this action was:')),
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: `Return one valid header tool JSON object using the documented shapes. ${parsed.message}`,
        },
        ...(recovery === 'recover' ? [buildLoopRecoveryChatMessage()] : []),
      ];
      continue;
    }

    if (parsed.value.tool === 'done') {
      params.onProgress?.('Finished header edit loop.');
      return {
        summary: parsed.value.summary?.trim() || `Finished header edit after ${iteration + 1} step${iteration === 0 ? '' : 's'}.`,
      };
    }
    if (parsed.value.tool === 'answer') {
      params.onProgress?.('Answered without changing the header.');
      return {
        summary: parsed.value.answer.trim(),
      };
    }

    if (parsed.value.tool !== 'plan' && parsed.value.tool !== 'mark_step_done') {
      params.onProgress?.(describeHeaderToolProgress(parsed.value));
    }
    const actionKey = getToolActionKey(parsed.value);
    const beforeProgress = summarizeHeaderLoopProgress(params.document, plan);
    const newInformationProgress = isHeaderInformationTool(parsed.value.tool) && !health.seenActionKeys.has(actionKey);
    let toolResult = '';
    if (parsed.value.tool === 'plan') {
      if (plan) {
        toolResult = buildToolResult('plan', [
          'A plan already exists and the `plan` tool is no longer available for this request.',
          'Continue by executing the next unfinished step and use `mark_step_done` when it is complete.',
          '',
          formatPlanState(plan),
        ].join('\n'));
      } else {
        plan = { steps: parsed.value.steps.map((step) => ({ text: step, done: false })) };
        rewardLoopHealthForPlanCreated(health, plan);
        toolResult = buildToolResult('plan', formatPlanState(plan));
        params.onProgress?.(formatPlanState(plan));
      }
    } else if (parsed.value.tool === 'mark_step_done') {
      const result = markPlanStepDone(plan, parsed.value.step, parsed.value.summary);
      if (result.changed) {
        if (plan) {
          params.onProgress?.(formatPlanState(plan));
        }
        rewardLoopHealthForPlanStepDone(health);
      }
      toolResult = buildToolResult('mark_step_done', result.message);
      if (result.changed && isPlanComplete(plan)) {
        params.onProgress?.('Completed all header plan steps.');
        return {
          summary: result.summary || 'Completed all header plan steps.',
        };
      }
    } else if (parsed.value.tool === 'request_header') {
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

    const afterProgress = summarizeHeaderLoopProgress(params.document, plan);
    const recovery = updateLoopHealthForAction(
      health,
      actionKey,
      beforeProgress !== afterProgress || newInformationProgress,
      getLoopStallThreshold(params.request, plan)
    );
    if (recovery === 'stop') {
      return { summary: 'Stopped because the AI header edit loop appeared stuck repeating actions without making progress. The AI can continue if you send another request.' };
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
      ...(recovery === 'recover' ? [buildLoopRecoveryChatMessage()] : []),
    ];
  }

  return {
    summary: `Stopped after ${DOCUMENT_EDIT_MAX_TOOL_STEPS} header steps. The AI can continue if you send another request.`,
  };
}

function buildLoopContext(
  baseContext: string,
  plan: EditPlanState | null,
  recentToolHelp?: string | null,
  workLedger?: WorkLedgerItem[],
  intentRecall?: string,
  workNote?: WorkNoteState
): string {
  const parts = [baseContext];
  if (workNote) {
    parts.push('', formatWorkNote(workNote));
  }
  if (workLedger && workLedger.length > 0) {
    parts.push(
      '',
      'Work ledger (recent completed/attempted tool actions; use this to avoid duplicating components/sections):',
      ...workLedger.slice(-MAX_WORK_LEDGER_ITEMS).map((item, index) => `${index + 1}. ${item.summary} — action: ${item.action} — intent: ${item.intent} — result: ${item.result}`)
    );
  }
  if (intentRecall?.trim()) {
    parts.push('', intentRecall.trim());
  }
  if (recentToolHelp) {
    parts.push(
      '',
      'Recent tool help already fetched; reuse this before calling `get_help` again for the same syntax:',
      recentToolHelp
    );
  }
  if (plan) {
    parts.push('', formatPlanState(plan));
  }
  return parts.join('\n');
}

function buildDocumentWalkNotes(document: VisualDocument, snapshot: DocumentStructureSnapshot): string {
  const serializedLines = serializeDocument(document).split('\n');
  const bodyStartIndex = findSerializedBodyStartIndex(serializedLines);
  const bodyLines = serializedLines.slice(bodyStartIndex);
  const chunks: string[] = [];
  let currentSection = '(before first section)';
  let chunkStart = 0;
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index] ?? '';
    if (/^\s*<!--hvy:(?:subsection\s*)?\s*\{/.test(line)) {
      if (index > chunkStart) {
        chunks.push(formatDocumentWalkChunk(bodyLines, chunkStart, index - 1, currentSection));
      }
      currentSection = findNextSectionTitle(bodyLines, index) ?? currentSection;
      chunkStart = index;
      continue;
    }
    if (index - chunkStart + 1 >= 100) {
      chunks.push(formatDocumentWalkChunk(bodyLines, chunkStart, index, currentSection));
      chunkStart = index + 1;
    }
  }
  if (chunkStart < bodyLines.length) {
    chunks.push(formatDocumentWalkChunk(bodyLines, chunkStart, bodyLines.length - 1, currentSection));
  }

  return [
    'Document walk notes (section-by-section, up to 100 serialized lines per note):',
    ...chunks.slice(0, 80),
    ...(chunks.length > 80 ? [`... ${chunks.length - 80} more walk note chunks omitted.`] : []),
    '',
    'Reduced component/section index:',
    snapshot.summary,
  ].join('\n');
}

function logDocumentWalkNotes(notes: string, traceRunId: string | undefined, signal: AbortSignal | undefined): void {
  const walkNoteCount = countDocumentWalkNoteChunks(notes);
  console.debug('[hvy:ai-document-edit] document walk notes', {
    chunks: walkNoteCount,
    notes,
  });
  if (!traceRunId) {
    return;
  }
  traceAgentLoopEvent({
    runId: traceRunId,
    phase: 'document-edit',
    type: 'client_event',
    payload: {
      event: 'document_walk_notes',
      chunks: walkNoteCount,
      notes,
    },
    signal,
  });
}

function countDocumentWalkNoteChunks(notes: string): number {
  return notes.match(/^Walk note:/gm)?.length ?? 0;
}

function findSerializedBodyStartIndex(lines: string[]): number {
  if (lines[0] !== '---') {
    return 0;
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  return closingIndex >= 0 ? closingIndex + 1 : 0;
}

function findNextSectionTitle(lines: string[], directiveIndex: number): string | null {
  for (let index = directiveIndex + 1; index < Math.min(lines.length, directiveIndex + 8); index += 1) {
    const match = (lines[index] ?? '').match(/^\s*#!+\s*(.+?)\s*$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function formatDocumentWalkChunk(lines: string[], startIndex: number, endIndex: number, sectionTitle: string): string {
  const chunkLines = lines.slice(startIndex, endIndex + 1);
  const refs = extractWalkChunkRefs(chunkLines);
  const preview = chunkLines
    .map((line, index) => `${String(startIndex + index + 1).padStart(4, ' ')} | ${line}`)
    .join('\n');
  return [
    `Walk note: section="${sectionTitle}" lines=${startIndex + 1}-${endIndex + 1}${refs ? ` refs=${refs}` : ''}`,
    truncateMultiline(preview, 3000),
  ].join('\n');
}

function extractWalkChunkRefs(lines: string[]): string {
  const refs = new Set<string>();
  for (const line of lines) {
    const directiveMatch = line.match(/<!--hvy:[^>]*?(\{.*\})\s*-->/);
    if (!directiveMatch?.[1]) {
      continue;
    }
    try {
      const payload = JSON.parse(directiveMatch[1]) as Record<string, unknown>;
      if (typeof payload.id === 'string' && payload.id.trim()) {
        refs.add(payload.id.trim());
      }
      if (typeof payload.xrefTarget === 'string' && payload.xrefTarget.trim()) {
        refs.add(payload.xrefTarget.trim());
      }
    } catch {
      // Ignore malformed directive previews; parser diagnostics handle validity elsewhere.
    }
  }
  return [...refs].slice(0, 20).join(', ');
}

function recordWorkLedgerItem(
  ledger: WorkLedgerItem[],
  toolCall: DocumentEditToolRequest,
  intent: string,
  toolResult: string
): WorkLedgerItem | null {
  if (toolCall.tool === 'answer' || toolCall.tool === 'done') {
    return null;
  }
  const item: WorkLedgerItem = {
    action: describeLedgerAction(toolCall),
    intent: truncatePreview(intent.replace(/\n/g, ' '), 120),
    summary: summarizeWorkLedgerAction(toolCall, toolResult),
    result: truncatePreview(toolResult.replace(/\n/g, ' '), 160),
  };
  ledger.push(item);
  while (ledger.length > MAX_WORK_LEDGER_ITEMS) {
    ledger.shift();
  }
  return item;
}

function createInitialWorkNote(goal: string): WorkNoteState {
  return {
    goal: truncatePreview(goal.replace(/\n/g, ' '), 180),
    done: [],
    currentFocus: 'Start by choosing the next useful document edit tool.',
    remaining: [],
    cautions: [],
  };
}

function normalizePlanSteps(steps: string[]): string[] {
  const filtered = steps.filter((step) => !isBookkeepingPlanStep(step));
  return filtered.length > 0 ? filtered : steps;
}

function isBookkeepingPlanStep(step: string): boolean {
  return /\b(mark\b.*\bdone|finish\b.*\bsummary|summar(?:y|ize)\b.*\bchanges)\b/i.test(step);
}

function formatWorkNote(note: WorkNoteState): string {
  return [
    'Work note (private scratchpad; update mentally as work progresses):',
    `Goal: ${note.goal}`,
    `Done: ${note.done.length > 0 ? note.done.slice(-6).join('; ') : '(nothing yet)'}`,
    `Current focus: ${note.currentFocus || '(none)'}`,
    `Remaining: ${note.remaining.length > 0 ? note.remaining.slice(0, 8).join('; ') : '(derive from plan/request)'}`,
    `Cautions: ${note.cautions.length > 0 ? note.cautions.slice(-4).join('; ') : '(none)'}`,
  ].join('\n');
}

function updateWorkNoteRemaining(note: WorkNoteState, plan: EditPlanState | null): WorkNoteState {
  if (!plan) {
    return note;
  }
  return {
    ...note,
    currentFocus: plan.steps.find((step) => !step.done)?.text ?? 'Verify the request is fully satisfied and finish.',
    remaining: plan.steps.filter((step) => !step.done).map((step) => step.text),
  };
}

function recordWorkNoteDone(note: WorkNoteState, summary: string): WorkNoteState {
  const entry = truncatePreview(summary.replace(/\n/g, ' '), 140);
  if (!entry || note.done.includes(entry)) {
    return note;
  }
  return {
    ...note,
    done: [...note.done, entry].slice(-12),
  };
}

function recordWorkNoteCaution(note: WorkNoteState, caution: string): WorkNoteState {
  const entry = truncatePreview(caution.replace(/\n/g, ' '), 160);
  if (!entry || note.cautions.includes(entry)) {
    return note;
  }
  return {
    ...note,
    cautions: [...note.cautions, entry].slice(-6),
  };
}

function autoUpdatePlanAndWorkNote(
  plan: EditPlanState | null,
  note: WorkNoteState,
  toolCall: DocumentEditToolRequest,
  toolResult: string
): { changed: boolean; summary: string; workNote: WorkNoteState } {
  if (!plan || toolCall.tool === 'plan' || toolCall.tool === 'mark_step_done' || isToolResultFailure(toolResult)) {
    return { changed: false, summary: '', workNote: updateWorkNoteRemaining(note, plan) };
  }
  const pendingIndex = findAutoCompletedPlanStep(plan, toolCall, toolResult);
  const actionSummary = summarizeSuccessfulToolAction(toolCall, toolResult);
  let nextNote = actionSummary ? recordWorkNoteDone(note, actionSummary) : note;
  if (pendingIndex < 0) {
    return { changed: false, summary: actionSummary, workNote: updateWorkNoteRemaining(nextNote, plan) };
  }

  const step = plan.steps[pendingIndex]!;
  step.done = true;
  step.summary = actionSummary || step.summary || summarizeWorkLedgerAction(toolCall, toolResult);
  nextNote = recordWorkNoteDone(nextNote, step.summary);
  nextNote = updateWorkNoteRemaining(nextNote, plan);
  return { changed: true, summary: step.summary, workNote: nextNote };
}

function isToolResultFailure(toolResult: string): boolean {
  return /\b(Tool failed|Query failed|SQL failed|error|invalid|unknown|missing|no such column)\b/i.test(toolResult);
}

function findAutoCompletedPlanStep(plan: EditPlanState, toolCall: DocumentEditToolRequest, toolResult: string): number {
  const actionText = [
    describeLedgerAction(toolCall),
    getDocumentToolIntent(toolCall),
    summarizeSuccessfulToolAction(toolCall, toolResult),
    toolResult,
  ].join(' ');
  const actionTokens = tokenizeForMatching(actionText);
  if (actionTokens.size === 0) {
    return -1;
  }
  let bestIndex = -1;
  let bestScore = 0;
  plan.steps.forEach((step, index) => {
    if (step.done) {
      return;
    }
    if (!isToolCallCompatibleWithPlanStep(toolCall, step.text, index, plan)) {
      return;
    }
    const stepTokens = tokenizeForMatching(step.text);
    const score = [...stepTokens].filter((token) => actionTokens.has(token)).length;
    const directRef = [...extractRefsFromText(step.text)].some((ref) => actionTokens.has(normalizeMatchToken(ref)));
    const threshold = directRef ? 1 : Math.min(4, Math.max(2, Math.ceil(stepTokens.size * 0.28)));
    if (score >= threshold && score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function isToolCallCompatibleWithPlanStep(
  toolCall: DocumentEditToolRequest,
  step: string,
  index: number,
  plan: EditPlanState
): boolean {
  if (toolCall.tool === 'batch') {
    return toolCall.calls.some((call) => isToolCompatibleWithPlanStep(call.tool, step, index, plan));
  }
  return isToolCompatibleWithPlanStep(toolCall.tool, step, index, plan);
}

function isToolCompatibleWithPlanStep(
  tool: DocumentEditToolRequest['tool'],
  step: string,
  index: number,
  plan: EditPlanState
): boolean {
  const normalized = step.toLowerCase();
  if (tool === 'get_help') {
    return /\b(get|fetch|read|inspect)\b.*\bhelp\b|\bhelp\b.*\b(tool|plugin|component|syntax)\b/.test(normalized);
  }
  if (/\b(re-?run|rerun|verify|confirm|check)\b.*\bgrep\b|\bgrep\b.*\b(verify|confirm|remaining|no remaining)\b/.test(normalized)) {
    return tool === 'grep' && plan.steps.slice(0, index).some((candidate) => candidate.done && /\b(edit|patch|remove|create|update|replace|delete)\b/i.test(candidate.text));
  }
  if (/\bgrep\b|\bsearch\b.*\bserialized document\b/.test(normalized)) {
    return tool === 'grep';
  }
  if (/\bview\b.*\bcomponent\b|\binspect\b.*\bcomponent\b/.test(normalized)) {
    return tool === 'view_component' || tool === 'view_rendered_component';
  }
  if (/\b(search|find)\b.*\b(existing )?components?\b/.test(normalized)) {
    return tool === 'search_components';
  }
  if (/\bpatch\b|\bedit\b|\bmodify\b|\bupdate\b|\breplace\b/.test(normalized)) {
    return tool === 'patch_component' || tool === 'edit_component' || tool === 'set_properties';
  }
  if (/\bremove\b|\bdelete\b/.test(normalized)) {
    return tool === 'remove_component' || tool === 'remove_section' || tool === 'patch_component' || tool === 'edit_component';
  }
  if (/\bcreate\b|\badd\b/.test(normalized)) {
    return tool === 'create_component' || tool === 'create_section' || tool === 'edit_component';
  }
  if (/\b(rendered|render)\b/.test(normalized)) {
    return tool === 'request_rendered_structure' || tool === 'view_rendered_component';
  }
  if (/\bstructure\b|\boutline\b/.test(normalized)) {
    return tool === 'request_structure';
  }
  return tool !== 'get_help' && tool !== 'search_components';
}

function summarizeSuccessfulToolAction(toolCall: DocumentEditToolRequest, toolResult: string): string {
  const plainResult = toolResult.replace(/^Tool result for [^:]+:\s*/i, '').trim();
  if (toolCall.tool === 'answer' || toolCall.tool === 'done') {
    return '';
  }
  if (plainResult.length > 0 && plainResult.length <= 180 && !/^Plan progress:/i.test(plainResult)) {
    return plainResult;
  }
  return summarizeWorkLedgerAction(toolCall, toolResult).replace(/\.$/, '');
}

function tokenizeForMatching(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9_#.+-]+/g)
      ?.map(normalizeMatchToken)
      .filter((token) => token.length >= 2 && !PLAN_MATCH_STOP_WORDS.has(token)) ?? []
  );
}

function normalizeMatchToken(value: string): string {
  return value.toLowerCase().replace(/^['"`]+|['"`.,:;()]+$/g, '');
}

function extractRefsFromText(value: string): Set<string> {
  return new Set(value.match(/[A-Za-z][A-Za-z0-9_-]*(?:\[[0-9]+\]|\.[A-Za-z-]+\[[0-9]+\])*/g) ?? []);
}

const PLAN_MATCH_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'then',
  'when',
  'step',
  'component',
  'section',
  'view',
  'remove',
  'patch',
  'create',
  'update',
  'inspect',
]);

function describeLedgerAction(toolCall: DocumentEditToolRequest): string {
  switch (toolCall.tool) {
    case 'batch':
      return `batch(${toolCall.calls.map((call) => describeLedgerAction(call)).join(', ')})`;
    case 'create_component':
      return `create_component(${toolCall.section_ref ?? toolCall.target_component_ref ?? toolCall.position})`;
    case 'edit_component':
    case 'patch_component':
    case 'remove_component':
    case 'view_component':
    case 'view_rendered_component':
      return `${toolCall.tool}(${toolCall.component_ref})`;
    case 'create_section':
      return `create_section(${toolCall.title ?? toolCall.position})`;
    case 'remove_section':
    case 'reorder_section':
      return `${toolCall.tool}(${toolCall.section_ref})`;
    case 'search_components':
      return `search_components(${toolCall.query})`;
    case 'get_help':
      return `get_help(${toolCall.topic})`;
    case 'grep':
      return `grep(${toolCall.query})`;
    case 'query_db_table':
      return `query_db_table(${toolCall.table_name ?? toolCall.query ?? 'default'})`;
    case 'execute_sql':
      return 'execute_sql';
    default:
      return toolCall.tool;
  }
}

function summarizeWorkLedgerAction(toolCall: DocumentEditToolRequest, toolResult: string): string {
  const failed = /\b(failed|error|invalid|unknown|missing|no such column)\b/i.test(toolResult);
  const suffix = failed ? ' and got an error' : '';
  switch (toolCall.tool) {
    case 'batch':
      return `Ran ${toolCall.calls.length} document tool calls${suffix}.`;
    case 'plan':
      return `Created a ${toolCall.steps.length}-step plan${suffix}.`;
    case 'mark_step_done':
      return `Marked plan step ${toolCall.step} done${suffix}.`;
    case 'request_structure':
      return `Refreshed the document structure${suffix}.`;
    case 'request_rendered_structure':
      return `Inspected the rendered document structure${suffix}.`;
    case 'get_help':
      return `Fetched help for ${toolCall.topic}${suffix}.`;
    case 'search_components':
      return `Searched existing components for "${truncatePreview(toolCall.query, 80)}"${suffix}.`;
    case 'grep':
      return `Searched the serialized document for "${truncatePreview(toolCall.query, 80)}"${suffix}.`;
    case 'get_css':
      return `Read CSS for ${formatListForSentence(toolCall.ids)}${suffix}.`;
    case 'get_properties':
      return `Read style properties for ${formatListForSentence(toolCall.ids)}${suffix}.`;
    case 'set_properties':
      return `Updated style properties for ${formatListForSentence(toolCall.ids)}${suffix}.`;
    case 'view_component':
      return `Viewed component ${toolCall.component_ref}${suffix}.`;
    case 'view_rendered_component':
      return `Viewed rendered output for ${toolCall.component_ref}${suffix}.`;
    case 'edit_component':
      return `Edited component ${toolCall.component_ref}${suffix}.`;
    case 'patch_component':
      return `Patched component ${toolCall.component_ref}${suffix}.`;
    case 'remove_component':
      return `Removed component ${toolCall.component_ref}${suffix}.`;
    case 'create_component':
      return `Created a component at ${toolCall.section_ref ?? toolCall.target_component_ref ?? toolCall.position}${suffix}.`;
    case 'remove_section':
      return `Removed section ${toolCall.section_ref}${suffix}.`;
    case 'create_section':
      return `Created a section at ${toolCall.target_section_ref ?? toolCall.parent_section_ref ?? toolCall.position}${suffix}.`;
    case 'reorder_section':
      return `Moved section ${toolCall.section_ref}${suffix}.`;
    case 'query_db_table':
      return `Read database ${toolCall.table_name ? `table/view ${toolCall.table_name}` : 'query result'}${suffix}.`;
    case 'execute_sql':
      return `Executed a SQLite write statement${suffix}.`;
    default:
      return `Ran ${toolCall.tool}${suffix}.`;
  }
}

function formatListForSentence(values: string[]): string {
  if (values.length === 0) {
    return '(none)';
  }
  if (values.length <= 3) {
    return values.join(', ');
  }
  return `${values.slice(0, 3).join(', ')}, and ${values.length - 3} more`;
}

function getDocumentToolIntent(toolCall: DocumentEditToolRequest): string {
  if ('reason' in toolCall && typeof toolCall.reason === 'string' && toolCall.reason.trim().length > 0) {
    return toolCall.reason.trim();
  }
  switch (toolCall.tool) {
    case 'batch':
      return toolCall.calls.map(getDocumentToolIntent).filter(Boolean).join(' ');
    case 'plan':
      return toolCall.steps.join(' ');
    case 'mark_step_done':
      return toolCall.summary ?? `Plan step ${toolCall.step}`;
    case 'edit_component':
      return toolCall.request;
    case 'create_component':
      return toolCall.hvy;
    case 'create_section':
      return toolCall.hvy ?? toolCall.title ?? '';
    case 'search_components':
      return toolCall.query;
    case 'grep':
      return toolCall.query;
    case 'get_help':
      return toolCall.topic;
    default:
      return '';
  }
}

const COMPACT_LOOP_MESSAGES_AFTER = 32;
const KEEP_RECENT_LOOP_MESSAGES = 20;

function compactToolLoopConversation(params: {
  conversation: ChatMessage[];
  goal: string;
  document: VisualDocument;
  plan: EditPlanState | null;
  path: EditPathSelection;
}): ChatMessage[] {
  const hasPriorSummary = params.conversation.some((message) => message.content.includes('Context summary for pruned older tool-loop history'));
  if (
    params.conversation.length <= COMPACT_LOOP_MESSAGES_AFTER &&
    (!hasPriorSummary || params.conversation.length <= KEEP_RECENT_LOOP_MESSAGES + 2)
  ) {
    return params.conversation;
  }

  const [initialMessage, ...rest] = params.conversation;
  if (!initialMessage) {
    return params.conversation;
  }
  const recentMessages = rest.slice(-KEEP_RECENT_LOOP_MESSAGES);
  const compactedMessages = rest.slice(0, Math.max(0, rest.length - KEEP_RECENT_LOOP_MESSAGES));
  return [
    initialMessage,
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: buildToolLoopOperationalSummary({
        goal: params.goal,
        document: params.document,
        plan: params.plan,
        path: params.path,
        compactedMessages,
      }),
    },
    ...recentMessages,
  ];
}

function buildToolLoopOperationalSummary(params: {
  goal: string;
  document: VisualDocument;
  plan: EditPlanState | null;
  path: EditPathSelection;
  compactedMessages: ChatMessage[];
}): string {
  const snapshot = params.path === 'header' ? null : summarizeDocumentStructure(params.document);
  const headerSnapshot = params.path === 'header' ? summarizeHeaderStructure(params.document) : null;
  return [
    'Context summary for pruned older tool-loop history:',
    `- Goal: ${truncatePreview(params.goal, 220)}`,
    `- Edit path: ${params.path}`,
    `- Completed actions: ${summarizeCompactedActions(params.compactedMessages)}`,
    `- Current task state: ${summarizeCurrentTaskState(params.document, params.plan, params.path)}`,
    `- Important refs/ids: ${snapshot ? summarizeImportantDocumentRefs(snapshot) : summarizeImportantHeaderRefs(headerSnapshot)}`,
    `- Unresolved errors: ${summarizeCompactedErrors(params.compactedMessages)}`,
    `- Next valid actions: ${params.path === 'header' ? 'inspect header, patch header, mark plan step done, or finish' : 'inspect structure/rendered output, patch/create/remove/reorder components or sections, query DB tables, mark plan step done, or finish'}`,
    '- Important constraints: do not invent ids or DB columns; use existing refs from the current outline; inspect before patching when uncertain.',
  ].join('\n');
}

function summarizeCompactedActions(messages: ChatMessage[]): string {
  const actions = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => {
      try {
        const parsed = JSON.parse(message.content.trim()) as Record<string, unknown>;
        if (typeof parsed.tool !== 'string') {
          return null;
        }
        const target = typeof parsed.component_ref === 'string'
          ? parsed.component_ref
          : typeof parsed.section_ref === 'string'
            ? parsed.section_ref
            : typeof parsed.table_name === 'string'
              ? parsed.table_name
              : '';
        return target ? `${parsed.tool}(${target})` : parsed.tool;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value));
  return actions.length > 0 ? actions.slice(-10).join(', ') : '(none recorded)';
}

function summarizeCurrentTaskState(document: VisualDocument, plan: EditPlanState | null, path: EditPathSelection): string {
  const sectionCount = document.sections.filter((section) => !section.isGhost).length;
  let componentCount = 0;
  visitBlocks(document.sections, () => {
    componentCount += 1;
  });
  const configuredDbTables = getDocumentDbTableNames(document);
  const planSummary = plan ? formatPlanState(plan).split('\n').slice(1).join('; ') : 'no active plan';
  return path === 'header'
    ? `${Object.keys(document.meta).length} header keys; ${sectionCount} visible sections; ${planSummary}`
    : `${sectionCount} visible sections; ${componentCount} components; db-table component targets: ${configuredDbTables.join(', ') || '(none)'}; ${planSummary}`;
}

function summarizeImportantDocumentRefs(snapshot: DocumentStructureSnapshot): string {
  const sectionIds = [...snapshot.sectionRefs.keys()].slice(0, 8);
  const componentIds = getUniqueComponentEntries(snapshot)
    .map((entry) => entry.componentId || entry.ref)
    .filter(Boolean)
    .slice(0, 12);
  return [
    `sections=${sectionIds.join(', ') || '(none)'}`,
    `components=${componentIds.join(', ') || '(none)'}`,
  ].join('; ');
}

function summarizeImportantHeaderRefs(snapshot: HeaderStructureSnapshot | null): string {
  if (!snapshot) {
    return '(none)';
  }
  return truncatePreview(snapshot.summary.replace(/\n/g, '; '), 320);
}

function summarizeCompactedErrors(messages: ChatMessage[]): string {
  const errors = messages
    .map((message) => message.content)
    .filter((content) => /\b(error|failed|invalid|unknown|stuck|missing|no such column)\b/i.test(content))
    .map((content) => truncatePreview(content.replace(/\n/g, ' '), 180));
  return errors.length > 0 ? errors.slice(-4).join(' | ') : '(none recorded)';
}

function formatDocumentToolFailure(error: unknown): string {
  if (error instanceof HvyRepairToolError) {
    return formatHvyRepairToolFailure(error);
  }
  const message = error instanceof Error ? error.message : 'Unknown document tool failure.';
  const concise = summarizeToolFailureMessage(message);
  return [
    `Tool failed: ${concise}`,
    ...(message.length > concise.length ? [`Details: ${truncatePreview(message, 800)}`] : []),
    'Retry with serialized HVY only. Do not return HTML, JSX, DOM markup, JavaScript, or CSS files.',
    'For sections, use `<!--hvy: {"id":"..."}-->`, `#! Title`, and HVY components. For components, start with an HVY component directive like `<!--hvy:text {}-->`.',
  ].join('\n');
}

function formatDocumentToolFailureForProgress(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown document tool failure.';
  return `Tool failed: ${summarizeToolFailureMessage(message)}`;
}

function formatHvyRepairToolFailure(error: HvyRepairToolError): string {
  const repair = error.repair;
  return [
    `Tool failed: ${summarizeToolFailureMessage(error.message)}`,
    'Repair only this malformed HVY payload. Do not reread the whole document.',
    '',
    'Syntax problem:',
    truncateMultiline(repair.syntaxProblem, 900),
    ...(repair.before ? ['', 'Before:', '```hvy', truncateMultiline(repair.before, 1800), '```'] : []),
    ...(repair.after ? ['', 'Attempted after:', '```hvy', truncateMultiline(repair.after, 2200), '```'] : []),
    '',
    'Reference example:',
    '```json',
    truncateMultiline(repair.reference, 1400),
    '```',
    '',
    `Next action: ${repair.nextAction}`,
  ].join('\n');
}

function summarizeToolFailureMessage(message: string): string {
  if (/patch_component produced invalid HVY/i.test(message) && hasNestedSlotDiagnostics(message)) {
    return 'Patch failed because the HVY fragment was invalid; retrying with a smaller edit.';
  }
  if (/create_component\.hvy must contain exactly one valid HVY component/i.test(message)) {
    return 'Create component failed because the HVY fragment was invalid; retrying with corrected HVY.';
  }
  if (/create_section\.hvy must be a valid HVY section|create_section\.hvy must contain exactly one top-level HVY section/i.test(message)) {
    return 'Create section failed because the HVY fragment was invalid; retrying with corrected HVY.';
  }
  return truncatePreview(message.replace(/\s+/g, ' '), 220);
}

function hasNestedSlotDiagnostics(message: string): boolean {
  return /\b(expandable|component-list|grid|container) (stub\/content|slot|block)|without an enclosing|missing stub content|missing expanded content/i.test(message);
}

function truncateMultiline(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}\n... truncated ...`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Chat request stopped.', 'AbortError');
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function describeDocumentToolProgress(toolCall: DocumentEditToolRequest): string {
  switch (toolCall.tool) {
    case 'batch':
      return `Running ${toolCall.calls.length} document tool calls.`;
    case 'plan':
      return `Created a ${toolCall.steps.length}-step plan.`;
    case 'mark_step_done':
      return `Marked plan step ${toolCall.step} done.`;
    case 'request_structure':
      return 'Refreshing the document outline.';
    case 'request_rendered_structure':
      return 'Inspecting rendered document output.';
    case 'get_help':
      return `Getting help for ${toolCall.topic}.`;
    case 'search_components':
      return `Searching existing components for \`${toolCall.query}\`.`;
    case 'grep':
      return `Searching the document for \`${toolCall.query}\`.`;
    case 'get_css':
      return `Reading CSS for ${toolCall.ids.join(', ')}.`;
    case 'get_properties':
      return `Reading style properties for ${toolCall.ids.join(', ')}.`;
    case 'set_properties':
      return `Updating style properties for ${toolCall.ids.join(', ')}.`;
    case 'view_component':
      return `Viewing component ${toolCall.component_ref}.`;
    case 'view_rendered_component':
      return `Viewing rendered output for ${toolCall.component_ref}.`;
    case 'edit_component':
      return `Editing component ${toolCall.component_ref}.`;
    case 'patch_component':
      return `Patching component ${toolCall.component_ref}.`;
    case 'remove_section':
      return `Removing section ${toolCall.section_ref}.`;
    case 'remove_component':
      return `Removing component ${toolCall.component_ref}.`;
    case 'create_component':
      return 'Creating a new component.';
    case 'create_section':
      return 'Creating a new section.';
    case 'reorder_section':
      return `Reordering section ${toolCall.section_ref}.`;
    case 'query_db_table':
      return toolCall.query
        ? `Querying the database: \`${toolCall.query}\`.`
        : `Reading database table ${toolCall.table_name ?? '(default)'}.`;
    case 'execute_sql':
      return 'Executing SQL against the attached database.';
    case 'answer':
    case 'done':
      return 'Finishing.';
  }
}

function describeHeaderToolProgress(toolCall: HeaderEditToolRequest): string {
  switch (toolCall.tool) {
    case 'plan':
      return `Created a ${toolCall.steps.length}-step header plan.`;
    case 'mark_step_done':
      return `Marked header plan step ${toolCall.step} done.`;
    case 'request_header':
      return 'Refreshing the header outline.';
    case 'grep_header':
      return `Searching the header for \`${toolCall.query}\`.`;
    case 'view_header':
      return 'Viewing header YAML.';
    case 'patch_header':
      return 'Patching header YAML.';
    case 'answer':
    case 'done':
      return 'Finishing.';
  }
}

function formatPlanState(plan: EditPlanState): string {
  if (plan.steps.length === 0) {
    return 'Plan progress:\n- (no steps)';
  }
  return [
    'Plan progress:',
    ...plan.steps.map((step, index) => `${index + 1}. ${step.done ? '[x]' : '[ ]'} ${step.text}${step.summary ? ` — ${step.summary}` : ''}`),
  ].join('\n');
}

function markPlanStepDone(plan: EditPlanState | null, stepNumber: number, summary?: string): { message: string; changed: boolean; summary: string } {
  if (!plan) {
    return {
      message: 'No active plan exists. If the request needs multiple steps, create one with the `plan` tool first.',
      changed: false,
      summary: '',
    };
  }
  const step = plan.steps[stepNumber - 1];
  if (!step) {
    return {
      message: `Plan step ${stepNumber} does not exist. Current plan has ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}.`,
      changed: false,
      summary: '',
    };
  }
  const changed = !step.done;
  if (!changed) {
    return {
      message: [`Plan step ${stepNumber} is already marked done.`, '', formatPlanState(plan)].join('\n'),
      changed: false,
      summary: step.summary ?? step.text,
    };
  }
  step.done = true;
  step.summary = summary?.trim() || step.summary;
  return { message: formatPlanState(plan), changed, summary: step.summary ?? step.text };
}

function isPlanComplete(plan: EditPlanState | null): boolean {
  return Boolean(plan && plan.steps.length > 0 && plan.steps.every((step) => step.done));
}

function createLoopHealthState(): LoopHealthState {
  return {
    stallScore: 0,
    invalidResponses: 0,
    consecutiveSameAction: 0,
    lastActionKey: null,
    recoveryCount: 0,
    seenActionKeys: new Set<string>(),
    toolFailureWindow: [],
  };
}

function recordToolExecutionOutcome(health: LoopHealthState, failed: boolean): 'continue' | 'stop' {
  health.toolFailureWindow.push(failed);
  while (health.toolFailureWindow.length > TOOL_FAILURE_WINDOW_SIZE) {
    health.toolFailureWindow.shift();
  }
  const recentFailures = health.toolFailureWindow.filter(Boolean).length;
  return recentFailures > MAX_TOOL_FAILURES_IN_WINDOW ? 'stop' : 'continue';
}

function getLoopStallThreshold(request: string, plan: EditPlanState | null): number {
  const requestSize = Math.floor(request.length / 180);
  if (!plan) {
    return Math.min(14, 8 + requestSize);
  }
  const unfinishedSteps = plan.steps.filter((step) => !step.done).length;
  return Math.min(34, 16 + requestSize + plan.steps.length * 2 + unfinishedSteps);
}

function updateLoopHealthForInvalid(health: LoopHealthState, threshold: number): 'continue' | 'recover' | 'stop' {
  health.invalidResponses += 1;
  health.stallScore += 3;
  return consumeLoopHealthThreshold(health, threshold);
}

function updateLoopHealthForAction(
  health: LoopHealthState,
  actionKey: string,
  madeProgress: boolean,
  threshold: number
): 'continue' | 'recover' | 'stop' {
  if (health.lastActionKey === actionKey) {
    health.consecutiveSameAction += 1;
    health.stallScore += health.consecutiveSameAction >= 3 ? 4 : 1;
  } else {
    health.consecutiveSameAction = 1;
  }

  health.lastActionKey = actionKey;
  if (madeProgress) {
    health.stallScore = Math.max(0, health.stallScore - 2);
  } else {
    health.stallScore += 2;
  }
  health.seenActionKeys.add(actionKey);
  if (health.consecutiveSameAction >= 5) {
    return 'stop';
  }
  return consumeLoopHealthThreshold(health, threshold);
}

function rewardLoopHealthForPlanCreated(health: LoopHealthState, plan: EditPlanState): void {
  health.stallScore = Math.max(0, health.stallScore - Math.max(3, plan.steps.length));
}

function rewardLoopHealthForPlanStepDone(health: LoopHealthState): void {
  health.stallScore = Math.max(0, health.stallScore - 5);
}

function consumeLoopHealthThreshold(health: LoopHealthState, threshold: number): 'continue' | 'recover' | 'stop' {
  if (health.stallScore < threshold) {
    return 'continue';
  }
  if (health.recoveryCount > 0) {
    return 'stop';
  }
  health.recoveryCount += 1;
  health.stallScore = Math.floor(health.stallScore / 2);
  return 'recover';
}

function buildLoopRecoveryChatMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [
      'You appear to be stuck. Do not repeat the previous action.',
      'Choose a different valid action that advances the task, ask for missing information by using an inspection tool, or finish with the best valid result if the task is already complete.',
      'If a plan exists, use the plan progress in context to choose the next unfinished step.',
    ].join('\n'),
  };
}

function getToolActionKey(toolCall: DocumentEditToolRequest | HeaderEditToolRequest): string {
  return stableStringify(stripActionKeyNoise(toolCall));
}

function stripActionKeyNoise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripActionKeyNoise);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'reason' && key !== 'summary')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stripActionKeyNoise(entry)])
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stripActionKeyNoise(value));
}

function summarizeDocumentLoopProgress(document: VisualDocument, plan: EditPlanState | null): string {
  return stableStringify({
    meta: document.meta,
    sections: document.sections,
    plan,
  });
}

function summarizeHeaderLoopProgress(document: VisualDocument, plan: EditPlanState | null): string {
  return stableStringify({
    meta: document.meta,
    plan,
  });
}

function isDocumentInformationTool(tool: DocumentEditToolRequest['tool']): boolean {
  return tool === 'batch'
    || tool === 'request_structure'
    || tool === 'request_rendered_structure'
    || tool === 'get_help'
    || tool === 'search_components'
    || tool === 'grep'
    || tool === 'get_css'
    || tool === 'get_properties'
    || tool === 'view_component'
    || tool === 'view_rendered_component'
    || tool === 'query_db_table';
}

function isHeaderInformationTool(tool: HeaderEditToolRequest['tool']): boolean {
  return tool === 'request_header' || tool === 'grep_header' || tool === 'view_header';
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

function resolveComponentRef(snapshot: DocumentStructureSnapshot, componentRef: string): ComponentRefEntry | undefined {
  const ref = componentRef.trim();
  return snapshot.componentRefs.get(ref) ?? snapshot.deepComponentRefs.get(ref);
}

function formatComponentLocation(entry: ComponentRefEntry): string {
  return entry.parentChain.length > 0 ? entry.parentChain.join(' > ') : 'document';
}

function formatNestedTargetRefs(snapshot: DocumentStructureSnapshot, entry: ComponentRefEntry): string {
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

function executeViewComponentTool(
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
  const fragment = serializeBlockFragment(block);
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

function executeViewSectionRefAsComponentTool(
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
  const fragment = serializeSectionFragment(section);
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

async function executeRequestRenderedStructureTool(snapshot: DocumentStructureSnapshot, document: VisualDocument): Promise<string> {
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

async function executeViewRenderedComponentTool(
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

function executeGetHelpTool(request: Extract<DocumentEditToolRequest, { tool: 'get_help' }>): string {
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
  const helpByComponent: Record<string, string> = {
    text: 'Text component: `<!--hvy:text {}-->` followed by Markdown-like text body.',
    table: 'Table component: `<!--hvy:table {"tableColumns":"Name, Status","tableRows":[{"cells":["Example","Open"]}]}-->`. Use db-table plugins for live SQLite rows.',
    container: 'Container component: `<!--hvy:container {}-->` with nested HVY components indented underneath.',
    grid: 'Grid component: `<!--hvy:grid {"gridColumns":2}-->` with `<!--hvy:grid:1 {}-->`, `<!--hvy:grid:2 {}-->` slots containing nested components.',
    expandable: 'Expandable component: use `<!--hvy:expandable {...}-->` with `<!--hvy:expandable:stub {}-->` and `<!--hvy:expandable:content {}-->` child slots.',
    plugin: 'Plugin component: `<!--hvy:plugin {"plugin":"registered.plugin.id","pluginConfig":{}}-->` followed by plugin-owned body text. Use `get_help` with `plugin:PLUGIN_ID` for plugin-specific details.',
    'xref-card': 'xref-card component: `<!--hvy:xref-card {"xrefTitle":"Title","xrefDetail":"Detail","xrefTarget":"target-id"}-->`.',
  };
  return helpByComponent[component] ?? `No detailed help registered for "${topic}". Try "plugin:PLUGIN_ID" or "component:text".`;
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

function executeSearchComponentsTool(
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

function buildIntentRecall(intent: string, snapshot: DocumentStructureSnapshot, document: VisualDocument): string {
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

function executePatchComponentTool(
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

  const originalFragment = serializeBlockFragment(block);
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

function executeCreateComponentTool(
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
    if (tool === 'batch') {
      if (!Array.isArray(parsed.calls) || parsed.calls.length === 0) {
        return { ok: false, message: 'batch.calls must be a non-empty array of tool JSON objects.' };
      }
      if (parsed.calls.length > 12) {
        return { ok: false, message: 'batch.calls supports at most 12 tool calls at a time.' };
      }
      const calls: DocumentEditBatchToolRequest[] = [];
      for (const [index, candidate] of parsed.calls.entries()) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          return { ok: false, message: `batch.calls[${index}] must be a tool JSON object.` };
        }
        const parsedCall = parseDocumentEditToolRequest(JSON.stringify(candidate));
        if (parsedCall.ok === false) {
          return { ok: false, message: `batch.calls[${index}] is invalid: ${parsedCall.message}` };
        }
        if (isDocumentBatchControlTool(parsedCall.value.tool)) {
          return { ok: false, message: `batch.calls[${index}] cannot use control tool "${parsedCall.value.tool}".` };
        }
        calls.push(parsedCall.value as DocumentEditBatchToolRequest);
      }
      return {
        ok: true,
        value: {
          tool,
          calls,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'done') {
      return { ok: true, value: { tool, summary: typeof parsed.summary === 'string' ? parsed.summary : undefined } };
    }
    if (tool === 'answer' && typeof parsed.answer === 'string' && parsed.answer.trim().length > 0) {
      return { ok: true, value: { tool, answer: parsed.answer } };
    }
    if (tool === 'plan' && Array.isArray(parsed.steps) && parsed.steps.every((step) => typeof step === 'string' && step.trim().length > 0)) {
      return {
        ok: true,
        value: {
          tool,
          steps: parsed.steps.map((step) => step.trim()),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'plan') {
      return {
        ok: false,
        message: 'plan must use `steps` as an array of short document-change strings, for example `{"tool":"plan","steps":["Modify component X","Verify the result"]}`.',
      };
    }
    if (tool === 'mark_step_done' && Number.isInteger(parsed.step)) {
      return {
        ok: true,
        value: {
          tool,
          step: Number(parsed.step),
          summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'request_structure') {
      return { ok: true, value: { tool, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined } };
    }
    if (tool === 'request_rendered_structure') {
      return { ok: true, value: { tool, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined } };
    }
    if (tool === 'get_help' && typeof parsed.topic === 'string' && parsed.topic.trim().length > 0) {
      return {
        ok: true,
        value: {
          tool,
          topic: parsed.topic.trim(),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'search_components' && typeof parsed.query === 'string' && parsed.query.trim().length > 0) {
      return {
        ok: true,
        value: {
          tool,
          query: parsed.query.trim(),
          max_count: Number.isInteger(parsed.max_count) ? Number(parsed.max_count) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
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
    const parsedComponentRef = typeof parsed.component_ref === 'string'
      ? parsed.component_ref
      : typeof parsed.component_id === 'string'
        ? parsed.component_id
        : undefined;
    const parsedTargetComponentRef = typeof parsed.target_component_ref === 'string'
      ? parsed.target_component_ref
      : typeof parsed.target_component_id === 'string'
        ? parsed.target_component_id
        : undefined;
    if (tool === 'view_component' && typeof parsedComponentRef === 'string') {
      return {
        ok: true,
        value: {
          tool,
          component_ref: parsedComponentRef,
          start_line: Number.isInteger(parsed.start_line) ? Number(parsed.start_line) : undefined,
          end_line: Number.isInteger(parsed.end_line) ? Number(parsed.end_line) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'view_rendered_component' && typeof parsedComponentRef === 'string') {
      return {
        ok: true,
        value: {
          tool,
          component_ref: parsedComponentRef,
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
	    if (tool === 'edit_component' && typeof parsedComponentRef === 'string' && typeof parsed.request === 'string' && parsed.request.trim().length > 0) {
      return {
        ok: true,
        value: { tool, component_ref: parsedComponentRef, request: parsed.request, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined },
      };
    }
    if (tool === 'patch_component' && typeof parsedComponentRef === 'string' && Array.isArray(parsed.edits) && parsed.edits.length > 0) {
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
          component_ref: parsedComponentRef,
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
    if (tool === 'remove_component' && typeof parsedComponentRef === 'string') {
      return {
        ok: true,
        value: { tool, component_ref: parsedComponentRef, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined },
      };
    }
    if (tool === 'create_component' && typeof parsed.position === 'string' && typeof parsed.hvy === 'string' && parsed.hvy.trim().length > 0) {
      if (parsed.position !== 'append-to-section' && parsed.position !== 'before' && parsed.position !== 'after') {
        return { ok: false, message: 'create_component.position must be append-to-section, before, or after.' };
      }
      const htmlMessage = validateHvyToolPayload(parsed.hvy, 'create_component.hvy', 'component');
      if (htmlMessage) {
        return { ok: false, message: htmlMessage };
      }
      return {
        ok: true,
        value: {
          tool,
          position: parsed.position,
          section_ref: typeof parsed.section_ref === 'string' ? parsed.section_ref : undefined,
          target_component_ref: parsedTargetComponentRef,
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
      if (hvy) {
        const htmlMessage = validateHvyToolPayload(hvy, 'create_section.hvy', 'section');
        if (htmlMessage) {
          return { ok: false, message: htmlMessage };
        }
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
    if (tool === 'execute_sql' && typeof parsed.sql === 'string' && parsed.sql.trim().length > 0) {
      return {
        ok: true,
        value: {
          tool,
          sql: parsed.sql.trim(),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    return { ok: false, message: 'Return one valid tool JSON object using the documented shapes.' };
  } catch {
    return { ok: false, message: 'Return valid JSON only, with no surrounding prose.' };
  }
}

function isDocumentBatchControlTool(tool: DocumentEditToolRequest['tool']): boolean {
  return tool === 'answer' || tool === 'done' || tool === 'plan' || tool === 'mark_step_done' || tool === 'batch';
}

function validateHvyToolPayload(hvy: string, fieldName: string, kind: 'component' | 'section'): string | null {
  const trimmed = hvy.trim();
  if (/^\s*<!--\s*hvy:form\b/i.test(trimmed)) {
    return [
      `${fieldName} uses unsupported \`hvy:form\` syntax.`,
      'Use a registered plugin id from the prompt with `<!--hvy:plugin {"plugin":"PLUGIN_ID","pluginConfig":{}}-->`, or answer that the requested plugin is unavailable.',
    ].join(' ');
  }
  const withoutHvyComments = trimmed.replace(/<!--\s*hvy:[\s\S]*?-->/gi, '');
  if (/<\/?(?:html|body|main|div|section|article|header|footer|nav|table|thead|tbody|tr|td|th|form|input|button|select|option|script|style|h[1-6]|p|ul|ol|li|span|label)\b/i.test(withoutHvyComments)) {
    return [
      `${fieldName} contains HTML/DOM markup, but document edit tools only accept serialized HVY.`,
      kind === 'section'
        ? 'Retry with an HVY section fragment that starts with `<!--hvy: {"id":"..."}-->`, then `#! Title`, then HVY components like `<!--hvy:text {}-->` or `<!--hvy:plugin {...}-->`.'
        : 'Retry with one HVY component fragment that starts with an HVY directive like `<!--hvy:text {}-->`, `<!--hvy:table {...}-->`, `<!--hvy:container {...}-->`, or `<!--hvy:plugin {...}-->`.',
      'Do not use HTML tags such as `<div>`, `<table>`, `<form>`, `<input>`, or `<button>`.',
    ].join(' ');
  }
  if (kind === 'component' && !/^\s*<!--\s*hvy:[a-z][a-z0-9-]*(?::[a-z0-9-]+)*\s*\{/i.test(trimmed)) {
    return `${fieldName} must start with one HVY component directive, for example \`<!--hvy:text {}-->\`.`;
  }
  if (kind === 'section' && !/^\s*<!--\s*hvy:(?:subsection\s*)?\s*\{/i.test(trimmed)) {
    return `${fieldName} must start with one HVY section directive, for example \`<!--hvy: {"id":"new-section"}-->\`.`;
  }
  return null;
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
    if (tool === 'plan' && Array.isArray(parsed.steps) && parsed.steps.every((step) => typeof step === 'string' && step.trim().length > 0)) {
      return {
        ok: true,
        value: {
          tool,
          steps: parsed.steps.map((step) => step.trim()),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'mark_step_done' && Number.isInteger(parsed.step)) {
      return {
        ok: true,
        value: {
          tool,
          step: Number(parsed.step),
          summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
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

function formatNumberedFragment(fragment: string, startLine = DEFAULT_VIEW_START_LINE, endLine = DEFAULT_VIEW_END_LINE): string {
  const lines = fragment.split('\n');
  const range = clampLineRange(lines.length, startLine, endLine);
  return lines
    .slice(range.startLine - 1, range.endLine)
    .map((line, index) => `${String(range.startLine + index).padStart(3, ' ')} | ${line}`)
    .join('\n');
}

function formatPatchContextFragment(fragment: string, edits: ComponentPatchEdit[], radius = 6): string {
  const lines = fragment.split('\n');
  if (lines.length <= 80) {
    return formatNumberedFragment(fragment, 1, lines.length);
  }
  const touched = edits.flatMap((edit) => {
    if (edit.op === 'replace' || edit.op === 'delete') {
      return [edit.start_line, edit.end_line];
    }
    return [edit.line];
  });
  const minLine = Math.max(1, Math.min(...touched) - radius);
  const maxLine = Math.min(lines.length, Math.max(...touched) + radius);
  return [
    ...(minLine > 1 ? ['...'] : []),
    formatNumberedFragment(fragment, minLine, maxLine),
    ...(maxLine < lines.length ? ['...'] : []),
  ].join('\n');
}

function applyComponentPatchEdits(fragment: string, edits: ComponentPatchEdit[]): string {
  let lines = fragment.split('\n');
  for (const edit of edits) {
    if (edit.op === 'replace') {
      assertValidLineRange(lines, edit.start_line, edit.end_line, 'replace');
      lines.splice(
        edit.start_line - 1,
        edit.end_line - edit.start_line + 1,
        ...normalizeReplacementLines(lines.slice(edit.start_line - 1, edit.end_line), edit.text)
      );
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

function normalizeReplacementLines(originalLines: string[], replacementText: string): string[] {
  const replacementLines = replacementText.split('\n');
  if (replacementLines.length === 0 || originalLines.length === 0) {
    return replacementLines;
  }
  const originalIndent = originalLines[0]?.match(/^\s*/)?.[0] ?? '';
  if (!originalIndent) {
    return replacementLines;
  }
  const nonBlankReplacementLines = replacementLines.filter((line) => line.trim().length > 0);
  if (nonBlankReplacementLines.length === 0) {
    return replacementLines;
  }
  const replacementAlreadyIndented = nonBlankReplacementLines.some((line) => /^\s/.test(line));
  if (replacementAlreadyIndented) {
    return replacementLines;
  }
  return replacementLines.map((line) => (line.trim().length > 0 ? `${originalIndent}${line}` : line));
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

function truncatePreview(value: string, maxLength = MAX_TEXT_PREVIEW_LENGTH): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 1)}...`;
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
