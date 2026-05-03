import type { ChatMessage } from './types';

export const MAX_TEXT_PREVIEW_LENGTH = 72;
export const SENT_STRUCTURE_CONTEXT = 'Reduced outline context was already provided earlier in this edit session. Request the relevant outline tool if you need a fresh copy.';
export const DEFAULT_VIEW_START_LINE = 1;
export const DEFAULT_VIEW_END_LINE = 200;
export const MAX_GREP_LINE_WIDTH = 400;
export const MAX_WORK_LEDGER_ITEMS = 35;
export const TOOL_FAILURE_WINDOW_SIZE = 5;
export const MAX_TOOL_FAILURES_IN_WINDOW = 2;

export interface NumberedLine {
  lineNumber: number;
  text: string;
  ownerId: string | null;
}

export interface SectionRefEntry {
  key: string;
  id: string;
  title: string;
}

export interface ComponentRefEntry {
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

export interface DocumentStructureSnapshot {
  summary: string;
  sectionRefs: Map<string, SectionRefEntry>;
  componentRefs: Map<string, ComponentRefEntry>;
  deepComponentRefs: Map<string, ComponentRefEntry>;
}

export interface WorkLedgerItem {
  action: string;
  intent: string;
  summary: string;
  result: string;
}

export interface WorkNoteState {
  goal: string;
  done: string[];
  currentFocus: string;
  nextTask: string;
  cautions: string[];
}

export interface HvyRepairToolContext {
  tool: 'patch_component' | 'create_component' | 'create_section';
  syntaxProblem: string;
  before?: string;
  after?: string;
  reference: string;
  nextAction: string;
}

export class HvyRepairToolError extends Error {
  readonly repair: HvyRepairToolContext;

  constructor(message: string, repair: HvyRepairToolContext) {
    super(message);
    this.name = 'HvyRepairToolError';
    this.repair = repair;
  }
}

export interface HeaderStructureSnapshot {
  summary: string;
}

export type ComponentPatchEdit =
  | { op: 'replace'; start_line: number; end_line: number; text: string }
  | { op: 'delete'; start_line: number; end_line: number }
  | { op: 'insert_before'; line: number; text: string }
  | { op: 'insert_after'; line: number; text: string };

export type CssPropertyMap = Record<string, string | null>;

export type DocumentEditSingleToolRequest =
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
      position: 'append-root' | 'append-child' | 'before' | 'after';
      new_position_index_from_0?: number;
      target_section_ref?: string;
      parent_section_ref?: string;
      hvy?: string;
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
  | { tool: 'query_db_table'; table_name?: string; query?: string; limit?: number; reason?: string }
  | { tool: 'execute_sql'; sql: string; reason?: string };

export type DocumentEditBatchToolRequest = Exclude<
  DocumentEditSingleToolRequest,
  { tool: 'done' | 'answer' | 'plan' | 'mark_step_done' }
>;

export type DocumentEditToolRequest =
  | DocumentEditSingleToolRequest
  | { tool: 'batch'; calls: DocumentEditBatchToolRequest[]; reason?: string };

export type EditPathSelection = 'document' | 'header';

export type HeaderEditToolRequest =
  | { tool: 'done'; summary?: string }
  | { tool: 'answer'; answer: string }
  | { tool: 'plan'; steps: string[]; reason?: string }
  | { tool: 'mark_step_done'; step: number; summary?: string; reason?: string }
  | { tool: 'request_header'; reason?: string }
  | { tool: 'grep_header'; query: string; flags?: string; before?: number; after?: number; max_count?: number; reason?: string }
  | { tool: 'view_header'; start_line?: number; end_line?: number; reason?: string }
  | { tool: 'patch_header'; edits: ComponentPatchEdit[]; reason?: string };

export interface ChatTurnResult {
  messages: ChatMessage[];
  error: string | null;
}

export interface EditPlanState {
  steps: Array<{
    text: string;
    done: boolean;
    summary?: string;
  }>;
}

export interface LoopHealthState {
  stallScore: number;
  invalidResponses: number;
  consecutiveSameAction: number;
  lastActionKey: string | null;
  recoveryCount: number;
  seenActionKeys: Set<string>;
  toolFailureWindow: boolean[];
}
