import { requestProxyCompletion, traceAgentLoopEvent } from './chat/chat';
import { getRegisteredPluginAiHints } from './ai-plugin-hints';
import {
  executeDbTableQueryTool,
  executeDbTableWriteSql,
  getDocumentDbTableObjectNames,
  getDocumentDbTableNames,
} from './plugins/db-table';
import type { ChatMessage, ChatSettings, VisualDocument } from './types';
import {
  buildDocumentEditFormatInstructions,
  buildHeaderEditFormatInstructions,
  buildInitialDocumentEditPrompt,
  buildInitialHeaderEditPrompt,
  buildToolResult,
  DOCUMENT_EDIT_MAX_TOOL_STEPS,
} from './ai-document-edit-instructions';
import { inferEditPathFromRequest, isLikelyInformationalAnswerRequest, parseDocumentEditToolRequest, parseHeaderEditToolRequest } from './ai-document-tool-parsing';
import { summarizeDocumentStructure, summarizeHeaderStructure } from './ai-document-structure';
import { autoUpdatePlanAndWorkNote, buildLoopRecoveryChatMessage, compactToolLoopConversation, createInitialWorkNote, createLoopHealthState, describeDocumentToolProgress, describeHeaderToolProgress, describeLedgerAction, formatDocumentToolFailure, formatDocumentToolFailureForProgress, formatLatestToolResultForContext, formatPlanState, formatWorkNote, getDocumentToolIntent, getLoopStallThreshold, getToolActionKey, isAbortError, isDocumentInformationTool, isHeaderInformationTool, isPlanComplete, isToolResultFailure, markPlanStepDone, normalizePlanSteps, recordToolExecutionOutcome, recordWorkLedgerItem, recordWorkNoteCaution, recordWorkNoteDone, rewardLoopHealthForPlanCreated, rewardLoopHealthForPlanStepDone, summarizeDocumentLoopProgress, summarizeHeaderLoopProgress, summarizeToolFailureMessage, summarizeToolResultForConversation, throwIfAborted, updateLoopHealthForAction, updateLoopHealthForInvalid, updateWorkNoteRemaining } from './ai-document-loop-state';
export { summarizeDocumentStructure, summarizeHeaderStructure } from './ai-document-structure';
import { buildDocumentWalkChunks, logDocumentWalkChunks, requestAiDocumentNotes } from './ai-document-notes';
import { executeGrepHeaderTool, executePatchHeaderTool, executeViewHeaderTool } from './ai-header-edit-tools';
import {
  buildIntentRecall,
  executeCreateComponentTool,
  executeCreateSectionTool,
  executeEditComponentTool,
  executeGetCssTool,
  executeGetHelpTool,
  executeGetPropertiesTool,
  executeGrepTool,
  executePatchComponentTool,
  executeRemoveComponentTool,
  executeRemoveSectionTool,
  executeReorderSectionTool,
  executeRequestRenderedStructureTool,
  executeSearchComponentsTool,
  executeSetPropertiesTool,
  executeViewComponentTool,
  executeViewRenderedComponentTool,
} from './ai-document-tool-executors';
export { executeDocumentEditToolByName } from './ai-document-tool-executors';
import {
  MAX_WORK_LEDGER_ITEMS,
  SENT_STRUCTURE_CONTEXT,
  type ChatTurnResult,
  type DocumentEditBatchToolRequest,
  type EditPlanState,
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
  console.debug('[hvy:ai-document-edit] preparing document chunks for note-taking');
  const documentChunks = buildDocumentWalkChunks(params.document, snapshot);
  logDocumentWalkChunks(documentChunks, params.traceRunId, params.signal);
  const aiDocumentNotes = isLikelyInformationalAnswerRequest(params.request)
    ? 'Skipped note-taking because the request appears informational.'
    : await requestAiDocumentNotes({
        settings: params.settings,
        request: params.request,
        chunks: documentChunks,
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
  let latestToolResult: string | null = null;
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
      context: buildLoopContext(contextSummary, plan, recentToolHelp, workLedger, buildIntentRecall(latestIntent, snapshot, params.document), workNote, latestToolResult),
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
        ...pruneTransientRecoveryMessages(conversation),
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
      const batchCalls = orderBatchCallsForSafeExecution(parsed.value.calls);
      for (const [callIndex, call] of batchCalls.entries()) {
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
        content: summarizeToolResultForConversation(toolResult),
      },
      ...(recovery === 'recover' ? [buildLoopRecoveryChatMessage()] : []),
    ];
    latestToolResult = toolResult;
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
  let latestToolResult: string | null = null;
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
      context: buildLoopContext(contextSummary, plan, null, undefined, undefined, undefined, latestToolResult),
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
        ...pruneTransientRecoveryMessages(conversation),
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
        content: summarizeToolResultForConversation(toolResult),
      },
      ...(recovery === 'recover' ? [buildLoopRecoveryChatMessage()] : []),
    ];
    latestToolResult = toolResult;
  }

  return {
    summary: `Stopped after ${DOCUMENT_EDIT_MAX_TOOL_STEPS} header steps. The AI can continue if you send another request.`,
  };
}

function pruneTransientRecoveryMessages(conversation: ChatMessage[]): ChatMessage[] {
  return conversation.filter((message) => {
    if (message.role === 'assistant' && message.content.includes('The result of this action was:')) {
      return false;
    }
    if (message.role !== 'user') {
      return true;
    }
    return !isTransientRecoveryPrompt(message.content);
  });
}

function orderBatchCallsForSafeExecution(calls: DocumentEditBatchToolRequest[]): DocumentEditBatchToolRequest[] {
  if (
    calls.length < 2
    || !calls.every((call) => call.tool === 'remove_component' && parseDirectListComponentRef(call.component_ref))
  ) {
    return calls;
  }
  return [...calls].sort((left, right) => {
    const leftRef = parseDirectListComponentRef(left.component_ref);
    const rightRef = parseDirectListComponentRef(right.component_ref);
    if (!leftRef || !rightRef || leftRef.prefix !== rightRef.prefix) {
      return 0;
    }
    return rightRef.index - leftRef.index;
  });
}

function parseDirectListComponentRef(ref: string): { prefix: string; index: number } | null {
  const match = ref.match(/^(.*\.list\[)(\d+)(\])$/);
  if (!match) {
    return null;
  }
  return {
    prefix: match[1],
    index: Number(match[2]),
  };
}

function isTransientRecoveryPrompt(content: string): boolean {
  return content.startsWith('Return one valid tool JSON object using the documented shapes.')
    || content.startsWith('Return one valid header tool JSON object using the documented shapes.')
    || content.startsWith('You appear to be stuck. Do not repeat the previous action.');
}

function buildLoopContext(
  baseContext: string,
  plan: EditPlanState | null,
  recentToolHelp?: string | null,
  workLedger?: WorkLedgerItem[],
  intentRecall?: string,
  workNote?: WorkNoteState,
  latestToolResult?: string | null
): string {
  const parts = [baseContext];
  if (latestToolResult) {
    parts.push('', formatLatestToolResultForContext(latestToolResult));
  }
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
