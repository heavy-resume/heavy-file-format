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
  buildDocumentNoteFormatInstructions,
  buildDocumentNotePrompt,
  buildHeaderEditFormatInstructions,
  buildInitialDocumentEditPrompt,
  buildInitialHeaderEditPrompt,
  buildToolResult,
  DOCUMENT_EDIT_MAX_TOOL_STEPS,
} from './ai-document-edit-instructions';
import type { JsonObject } from './hvy/types';
import { DB_TABLE_PLUGIN_ID } from './plugins/registry';
import { inferEditPathFromRequest, isLikelyInformationalAnswerRequest, parseDocumentEditToolRequest, parseHeaderEditToolRequest } from './ai-document-tool-parsing';
import { collectNestedBlocks, escapeInline, findBlockByInternalId, formatComponentLocation, formatNestedTargetRefs, resolveComponentRef, summarizeDocumentStructure, summarizeHeaderStructure, truncatePreview } from './ai-document-structure';
import { applyComponentPatchEdits, buildDocumentNumberedLines, buildGrepRegex, buildToolRegex, clampLineRange, formatNumberedFragment, formatPatchContextFragment } from './ai-document-line-tools';
import { autoUpdatePlanAndWorkNote, buildLoopRecoveryChatMessage, compactToolLoopConversation, createInitialWorkNote, createLoopHealthState, describeDocumentToolProgress, describeHeaderToolProgress, describeLedgerAction, formatDocumentToolFailure, formatDocumentToolFailureForProgress, formatPlanState, formatWorkNote, getDocumentToolIntent, getLoopStallThreshold, getToolActionKey, hasNestedSlotDiagnostics, isAbortError, isDocumentInformationTool, isHeaderInformationTool, isPlanComplete, isToolResultFailure, markPlanStepDone, normalizePlanSteps, recordToolExecutionOutcome, recordWorkLedgerItem, recordWorkNoteCaution, recordWorkNoteDone, rewardLoopHealthForPlanCreated, rewardLoopHealthForPlanStepDone, summarizeDocumentLoopProgress, summarizeHeaderLoopProgress, summarizeToolFailureMessage, throwIfAborted, truncateMultiline, updateLoopHealthForAction, updateLoopHealthForInvalid, updateWorkNoteRemaining } from './ai-document-loop-state';
export { summarizeDocumentStructure, summarizeHeaderStructure } from './ai-document-structure';
import {
  DEFAULT_VIEW_END_LINE,
  DEFAULT_VIEW_START_LINE,
  DocumentEditToolRequest,
  HvyRepairToolError,
  MAX_TOOL_FAILURES_IN_WINDOW,
  MAX_WORK_LEDGER_ITEMS,
  SENT_STRUCTURE_CONTEXT,
  TOOL_FAILURE_WINDOW_SIZE,
  type ChatTurnResult,
  type ComponentRefEntry,
  type CssPropertyMap,
  type DocumentEditBatchToolRequest,
  type DocumentEditSingleToolRequest,
  type DocumentStructureSnapshot,
  type EditPathSelection,
  type EditPlanState,
  type HeaderEditToolRequest,
  type HeaderStructureSnapshot,
  type LoopHealthState,
  type WorkLedgerItem,
  type WorkNoteState,
} from './ai-document-edit-types';

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
  params.onProgress?.('Preparing document chunks for note-taking.');
  const documentChunks = buildDocumentWalkChunks(params.document, snapshot);
  logDocumentWalkChunks(documentChunks, params.traceRunId, params.signal);
  const aiDocumentNotes = isLikelyInformationalAnswerRequest(params.request)
    ? 'Skipped note-taking because the request appears informational.'
    : await requestAiDocumentNotes({
        settings: params.settings,
        request: params.request,
        chunks: documentChunks,
        onProgress: params.onProgress,
        traceRunId: params.traceRunId,
        signal: params.signal,
      });
  let contextSummary = buildDocumentEditContextSummary(
    [
      'AI-generated document notes:',
      aiDocumentNotes,
      '',
      'Reduced component/section index:',
      snapshot.summary,
    ].join('\n'),
    dbObjectNames,
    configuredDbTableNames
  );
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

interface DocumentWalkChunks {
  text: string;
  chunkCount: number;
}

async function requestAiDocumentNotes(params: {
  settings: ChatSettings;
  request: string;
  chunks: DocumentWalkChunks;
  onProgress?: (content: string) => void;
  traceRunId?: string;
  signal?: AbortSignal;
}): Promise<string> {
  params.onProgress?.('Reviewing document chunks and taking section notes.');
  const notes = await requestProxyCompletion({
    settings: params.settings,
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: buildDocumentNotePrompt(params.request),
      },
    ],
    context: params.chunks.text,
    formatInstructions: buildDocumentNoteFormatInstructions(),
    mode: 'document-edit',
    debugLabel: 'ai-document-notes',
    traceRunId: params.traceRunId,
    signal: params.signal,
  });
  const trimmed = notes.trim();
  console.debug('[hvy:ai-document-edit] AI document notes', {
    chunks: params.chunks.chunkCount,
    notes: trimmed,
  });
  if (params.traceRunId) {
    traceAgentLoopEvent({
      runId: params.traceRunId,
      phase: 'document-edit',
      type: 'client_event',
      payload: {
        event: 'ai_document_notes',
        chunks: params.chunks.chunkCount,
        notes: trimmed,
      },
      signal: params.signal,
    });
  }
  return trimmed || 'No AI notes were returned.';
}

function buildDocumentWalkChunks(document: VisualDocument, snapshot: DocumentStructureSnapshot): DocumentWalkChunks {
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

  const text = [
    'Serialized document chunks for AI note-taking (section-by-section, up to 100 serialized lines per chunk):',
    ...chunks.slice(0, 80),
    ...(chunks.length > 80 ? [`... ${chunks.length - 80} more serialized chunks omitted.`] : []),
    '',
    'Reduced component/section index:',
    snapshot.summary,
  ].join('\n');
  return {
    text,
    chunkCount: chunks.length,
  };
}

function logDocumentWalkChunks(chunks: DocumentWalkChunks, traceRunId: string | undefined, signal: AbortSignal | undefined): void {
  console.debug('[hvy:ai-document-edit] serialized document chunks', {
    chunks: chunks.chunkCount,
    context: chunks.text,
  });
  if (!traceRunId) {
    return;
  }
  traceAgentLoopEvent({
    runId: traceRunId,
    phase: 'document-edit',
    type: 'client_event',
    payload: {
      event: 'document_walk_chunks',
      chunks: chunks.chunkCount,
      context: chunks.text,
    },
    signal,
  });
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
