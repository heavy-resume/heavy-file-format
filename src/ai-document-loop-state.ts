import type { ChatMessage, VisualDocument } from './types';
import { summarizeDocumentStructure, summarizeHeaderStructure, truncatePreview } from './ai-document-structure';
import { visitBlocks } from './section-ops';
import { getDocumentDbTableNames } from './plugins/db-table';
import {
  HvyRepairToolError,
  MAX_TOOL_FAILURES_IN_WINDOW,
  MAX_WORK_LEDGER_ITEMS,
  TOOL_FAILURE_WINDOW_SIZE,
  type DocumentEditToolRequest,
  type DocumentStructureSnapshot,
  type EditPathSelection,
  type EditPlanState,
  type ComponentRefEntry,
  type HeaderEditToolRequest,
  type HeaderStructureSnapshot,
  type LoopHealthState,
  type WorkLedgerItem,
  type WorkNoteState,
} from './ai-document-edit-types';

export function recordWorkLedgerItem(
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

export function createInitialWorkNote(goal: string): WorkNoteState {
  return {
    goal: truncatePreview(goal.replace(/\n/g, ' '), 180),
    done: [],
    currentFocus: 'Start by choosing the next useful document edit tool.',
    nextTask: 'Derive the next task from the request and current context.',
    cautions: [],
  };
}

export function normalizePlanSteps(steps: string[]): string[] {
  const filtered = steps.filter((step) => !isBookkeepingPlanStep(step));
  return filtered.length > 0 ? filtered : steps;
}

export function isBookkeepingPlanStep(step: string): boolean {
  return /\b(mark\b.*\bdone|finish\b.*\bsummary|summar(?:y|ize)\b.*\bchanges)\b/i.test(step);
}

export function formatWorkNote(note: WorkNoteState): string {
  return [
    'Work note (private scratchpad; update mentally as work progresses):',
    `Goal: ${note.goal}`,
    `Done: ${note.done.length > 0 ? note.done.slice(-6).join('; ') : '(nothing yet)'}`,
    `Current task: ${note.currentFocus || '(none)'}`,
    `Next task: ${note.nextTask || '(derive from plan/request)'}`,
    `Cautions: ${note.cautions.length > 0 ? note.cautions.slice(-4).join('; ') : '(none)'}`,
  ].join('\n');
}

export function updateWorkNoteRemaining(note: WorkNoteState, plan: EditPlanState | null): WorkNoteState {
  if (!plan) {
    return note;
  }
  const pendingSteps = plan.steps.filter((step) => !step.done);
  return {
    ...note,
    currentFocus: pendingSteps[0]?.text ?? 'Verify the request is fully satisfied and finish.',
    nextTask: pendingSteps[1]?.text ?? (pendingSteps.length === 0 ? 'Finish with a concise summary.' : 'Verify progress before choosing another task.'),
  };
}

export function recordWorkNoteDone(note: WorkNoteState, summary: string): WorkNoteState {
  const entry = truncatePreview(summary.replace(/\n/g, ' '), 140);
  if (!entry || note.done.includes(entry)) {
    return note;
  }
  return {
    ...note,
    done: [...note.done, entry].slice(-12),
  };
}

export function recordWorkNoteCaution(note: WorkNoteState, caution: string): WorkNoteState {
  const entry = truncatePreview(caution.replace(/\n/g, ' '), 160);
  if (!entry || note.cautions.includes(entry)) {
    return note;
  }
  return {
    ...note,
    cautions: [...note.cautions, entry].slice(-6),
  };
}

export function autoUpdatePlanAndWorkNote(
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

export function isToolResultFailure(toolResult: string): boolean {
  return /\b(Tool failed|Query failed|SQL failed|error|invalid|unknown|missing|no such column)\b/i.test(toolResult);
}

export function findAutoCompletedPlanStep(plan: EditPlanState, toolCall: DocumentEditToolRequest, toolResult: string): number {
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

export function isToolCallCompatibleWithPlanStep(
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

export function isToolCompatibleWithPlanStep(
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
  return tool !== 'search_components';
}

export function summarizeSuccessfulToolAction(toolCall: DocumentEditToolRequest, toolResult: string): string {
  const plainResult = toolResult.replace(/^Tool result for [^:]+:\s*/i, '').trim();
  if (toolCall.tool === 'answer' || toolCall.tool === 'done') {
    return '';
  }
  if (plainResult.length > 0 && plainResult.length <= 180 && !/^Plan progress:/i.test(plainResult)) {
    return plainResult;
  }
  return summarizeWorkLedgerAction(toolCall, toolResult).replace(/\.$/, '');
}

export function tokenizeForMatching(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9_#.+-]+/g)
      ?.map(normalizeMatchToken)
      .filter((token) => token.length >= 2 && !PLAN_MATCH_STOP_WORDS.has(token)) ?? []
  );
}

export function normalizeMatchToken(value: string): string {
  return value.toLowerCase().replace(/^['"`]+|['"`.,:;()]+$/g, '');
}

export function extractRefsFromText(value: string): Set<string> {
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

export function describeLedgerAction(toolCall: DocumentEditToolRequest): string {
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

export function summarizeWorkLedgerAction(toolCall: DocumentEditToolRequest, toolResult: string): string {
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

export function formatListForSentence(values: string[]): string {
  if (values.length === 0) {
    return '(none)';
  }
  if (values.length <= 3) {
    return values.join(', ');
  }
  return `${values.slice(0, 3).join(', ')}, and ${values.length - 3} more`;
}

export function getDocumentToolIntent(toolCall: DocumentEditToolRequest): string {
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

const COMPACT_LOOP_MESSAGES_AFTER = 8;
const KEEP_RECENT_LOOP_MESSAGES = 4;
const MAX_LATEST_TOOL_RESULT_CONTEXT_CHARS = 6000;
const MAX_TOOL_RESULT_CHAT_CHARS = 700;

export function formatLatestToolResultForContext(toolResult: string): string {
  return [
    'Latest tool result (exact recent observation; use this for the immediate next decision):',
    truncatePreservingWhitespace(toolResult, MAX_LATEST_TOOL_RESULT_CONTEXT_CHARS),
    'End latest tool result.',
  ].join('\n');
}

export function summarizeToolResultForConversation(toolResult: string): string {
  const lines = toolResult.split('\n');
  const heading = lines[0]?.trim() || 'Tool result';
  const actionableLines = lines
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (/^(Section title|Section id|Component type|Component id|Component location|Showing lines|Tool failed|Query failed|SQL failed|Plan progress|Rendered component text\/diagnostics|No matches|Matched)/i.test(line)) {
        return true;
      }
      return /^(Created|Updated|Removed|Patched|Reordered|Executed|New section ref|New component ref|Rows|Columns|Call \d+:)/i.test(line);
    })
    .slice(0, 8);
  const fallback = truncatePreview(toolResult.replace(/\s+/g, ' '), MAX_TOOL_RESULT_CHAT_CHARS);
  const summary = actionableLines.length > 0
    ? [heading, ...actionableLines].join('\n')
    : fallback;
  return [
    'Tool observation summary:',
    truncatePreview(summary, MAX_TOOL_RESULT_CHAT_CHARS),
    '',
    'The full latest tool result is in context, not repeated in chat history.',
  ].join('\n');
}

function truncatePreservingWhitespace(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

export function compactToolLoopConversation(params: {
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

export function buildToolLoopOperationalSummary(params: {
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
    `- Document state: ${summarizeDocumentTaskState(params.document, params.path)}`,
    `- Current task: ${summarizeCurrentPlanTask(params.plan)}`,
    `- Next task: ${summarizeNextPlanTask(params.plan)}`,
    `- Important refs/ids: ${snapshot ? summarizeImportantDocumentRefs(snapshot) : summarizeImportantHeaderRefs(headerSnapshot)}`,
    `- Unresolved errors: ${summarizeCompactedErrors(params.compactedMessages)}`,
    `- Next valid actions: ${params.path === 'header' ? 'inspect header, patch header, mark plan step done, or finish' : 'inspect structure/rendered output, patch/create/remove/reorder components or sections, query DB tables, mark plan step done, or finish'}`,
    '- Important constraints: do not invent ids or DB columns; use existing refs from the current outline; inspect before patching when uncertain.',
  ].join('\n');
}

export function summarizeCompactedActions(messages: ChatMessage[]): string {
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

export function summarizeDocumentTaskState(document: VisualDocument, path: EditPathSelection): string {
  const sectionCount = document.sections.filter((section) => !section.isGhost).length;
  let componentCount = 0;
  visitBlocks(document.sections, () => {
    componentCount += 1;
  });
  const configuredDbTables = getDocumentDbTableNames(document);
  return path === 'header'
    ? `${Object.keys(document.meta).length} header keys; ${sectionCount} visible sections`
    : `${sectionCount} visible sections; ${componentCount} components; db-table component targets: ${configuredDbTables.join(', ') || '(none)'}`;
}

export function summarizeCurrentPlanTask(plan: EditPlanState | null): string {
  if (!plan) {
    return 'No active plan; choose the next useful action from the request and context.';
  }
  return plan.steps.find((step) => !step.done)?.text ?? 'All plan steps are complete; verify and finish.';
}

export function summarizeNextPlanTask(plan: EditPlanState | null): string {
  if (!plan) {
    return 'Create a plan only if the request needs multiple document changes.';
  }
  const pending = plan.steps.filter((step) => !step.done);
  return pending[1]?.text ?? (pending.length === 0 ? 'Finish with a concise summary.' : 'Verify progress before choosing another task.');
}

export function summarizeImportantDocumentRefs(snapshot: DocumentStructureSnapshot): string {
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

function getUniqueComponentEntries(snapshot: DocumentStructureSnapshot): ComponentRefEntry[] {
  const seenBlockIds = new Set<string>();
  const entries: ComponentRefEntry[] = [];
  for (const entry of snapshot.componentRefs.values()) {
    if (seenBlockIds.has(entry.blockId)) {
      continue;
    }
    seenBlockIds.add(entry.blockId);
    entries.push(entry);
  }
  return entries;
}

export function summarizeImportantHeaderRefs(snapshot: HeaderStructureSnapshot | null): string {
  if (!snapshot) {
    return '(none)';
  }
  return truncatePreview(snapshot.summary.replace(/\n/g, '; '), 320);
}

export function summarizeCompactedErrors(messages: ChatMessage[]): string {
  const errors = messages
    .map((message) => message.content)
    .filter((content) => /\b(error|failed|invalid|unknown|stuck|missing|no such column)\b/i.test(content))
    .map((content) => truncatePreview(content.replace(/\n/g, ' '), 180));
  return errors.length > 0 ? errors.slice(-4).join(' | ') : '(none recorded)';
}

export function formatDocumentToolFailure(error: unknown): string {
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

export function formatDocumentToolFailureForProgress(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown document tool failure.';
  return `Tool failed: ${summarizeToolFailureMessage(message)}`;
}

export function formatHvyRepairToolFailure(error: HvyRepairToolError): string {
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

export function summarizeToolFailureMessage(message: string): string {
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

export function hasNestedSlotDiagnostics(message: string): boolean {
  return /\b(expandable|component-list|grid|container) (stub\/content|slot|block)|without an enclosing|missing stub content|missing expanded content/i.test(message);
}

export function truncateMultiline(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}\n... truncated ...`;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Chat request stopped.', 'AbortError');
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function describeDocumentToolProgress(toolCall: DocumentEditToolRequest): string {
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

export function describeHeaderToolProgress(toolCall: HeaderEditToolRequest): string {
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

export function formatPlanState(plan: EditPlanState): string {
  if (plan.steps.length === 0) {
    return 'Plan progress:\n- (no steps)';
  }
  return [
    'Plan progress:',
    ...plan.steps.map((step, index) => `${index + 1}. ${step.done ? '[x]' : '[ ]'} ${step.text}${step.summary ? ` — ${step.summary}` : ''}`),
  ].join('\n');
}

export function markPlanStepDone(plan: EditPlanState | null, stepNumber: number, summary?: string): { message: string; changed: boolean; summary: string } {
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

export function isPlanComplete(plan: EditPlanState | null): boolean {
  return Boolean(plan && plan.steps.length > 0 && plan.steps.every((step) => step.done));
}

export function createLoopHealthState(): LoopHealthState {
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

export function recordToolExecutionOutcome(health: LoopHealthState, failed: boolean): 'continue' | 'stop' {
  health.toolFailureWindow.push(failed);
  while (health.toolFailureWindow.length > TOOL_FAILURE_WINDOW_SIZE) {
    health.toolFailureWindow.shift();
  }
  const recentFailures = health.toolFailureWindow.filter(Boolean).length;
  return recentFailures > MAX_TOOL_FAILURES_IN_WINDOW ? 'stop' : 'continue';
}

export function getLoopStallThreshold(request: string, plan: EditPlanState | null): number {
  const requestSize = Math.floor(request.length / 180);
  if (!plan) {
    return Math.min(14, 8 + requestSize);
  }
  const unfinishedSteps = plan.steps.filter((step) => !step.done).length;
  return Math.min(34, 16 + requestSize + plan.steps.length * 2 + unfinishedSteps);
}

export function updateLoopHealthForInvalid(health: LoopHealthState, threshold: number): 'continue' | 'recover' | 'stop' {
  health.invalidResponses += 1;
  health.stallScore += 3;
  return consumeLoopHealthThreshold(health, threshold);
}

export function updateLoopHealthForAction(
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

export function rewardLoopHealthForPlanCreated(health: LoopHealthState, plan: EditPlanState): void {
  health.stallScore = Math.max(0, health.stallScore - Math.max(3, plan.steps.length));
}

export function rewardLoopHealthForPlanStepDone(health: LoopHealthState): void {
  health.stallScore = Math.max(0, health.stallScore - 5);
}

export function consumeLoopHealthThreshold(health: LoopHealthState, threshold: number): 'continue' | 'recover' | 'stop' {
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

export function buildLoopRecoveryChatMessage(): ChatMessage {
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

export function getToolActionKey(toolCall: DocumentEditToolRequest | HeaderEditToolRequest): string {
  return stableStringify(stripActionKeyNoise(toolCall));
}

export function stripActionKeyNoise(value: unknown): unknown {
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

export function stableStringify(value: unknown): string {
  return JSON.stringify(stripActionKeyNoise(value));
}

export function summarizeDocumentLoopProgress(document: VisualDocument, plan: EditPlanState | null): string {
  return stableStringify({
    meta: document.meta,
    sections: document.sections,
    plan,
  });
}

export function summarizeHeaderLoopProgress(document: VisualDocument, plan: EditPlanState | null): string {
  return stableStringify({
    meta: document.meta,
    plan,
  });
}

export function isDocumentInformationTool(tool: DocumentEditToolRequest['tool']): boolean {
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

export function isHeaderInformationTool(tool: HeaderEditToolRequest['tool']): boolean {
  return tool === 'request_header' || tool === 'grep_header' || tool === 'view_header';
}
