import type { DocumentEditSingleToolRequest, EditPlanState } from './ai-document-edit-types';

export type DocumentEditPhase =
  | 'planning'
  | 'database'
  | 'mutation'
  | 'removal'
  | 'creation'
  | 'style'
  | 'reorder'
  | 'verification'
  | 'repair';

export type DocumentEditToolName = DocumentEditSingleToolRequest['tool'] | 'batch';

export interface DocumentEditPhaseInput {
  request: string;
  plan: EditPlanState | null;
  latestToolResult?: string | null;
}

export function selectDocumentEditPhase(input: DocumentEditPhaseInput): DocumentEditPhase {
  if (input.latestToolResult && /\b(Tool failed|Query failed|SQL failed|invalid|unknown|missing|no such column)\b/i.test(input.latestToolResult)) {
    return 'repair';
  }
  if (isDatabaseRelevantText(input.request)) {
    return 'database';
  }
  const currentTask = input.plan?.steps.find((step) => !step.done)?.text ?? '';
  if (!input.plan || !currentTask) {
    return 'planning';
  }
  if (/\b(verify|confirm|check|re-?run|rerun|rendered|diagnostic|no remaining)\b/i.test(currentTask)) {
    return 'verification';
  }
  if (/\b(remove|delete|drop)\b/i.test(currentTask)) {
    return 'removal';
  }
  if (/\b(create|add|insert|new)\b/i.test(currentTask)) {
    return 'creation';
  }
  if (/\b(move|reorder|order|sort)\b/i.test(currentTask)) {
    return 'reorder';
  }
  if (/\b(style|css|margin|padding|color|background|font|spacing|property|properties)\b/i.test(currentTask)) {
    return 'style';
  }
  return 'mutation';
}

export function getDocumentEditPhaseTools(phase: DocumentEditPhase, options?: { optionalTools?: readonly DocumentEditToolName[] }): DocumentEditToolName[] {
  const optionalTools = new Set(options?.optionalTools ?? []);
  switch (phase) {
    case 'planning':
      return ['answer', 'plan', 'grep', 'search_components', 'view_component', 'done'];
    case 'database': {
      const tools: DocumentEditToolName[] = [
        'answer',
        'plan',
        optionalTools.has('query_db_table') ? 'query_db_table' : 'view_component',
        optionalTools.has('execute_sql') ? 'execute_sql' : 'grep',
        'view_component',
        'done',
      ];
      return tools.filter((tool, index) => tools.indexOf(tool) === index);
    }
    case 'repair': {
      const tools: DocumentEditToolName[] = [
        optionalTools.has('query_db_table') ? 'query_db_table' : 'view_component',
        'view_component',
        'patch_component',
        'edit_component',
        'remove_component',
        'get_help',
        'done',
      ];
      return tools.filter((tool, index) => tools.indexOf(tool) === index);
    }
    case 'verification':
      return ['grep', 'view_component', 'view_rendered_component', 'request_rendered_structure', 'mark_step_done', 'done'];
    case 'removal':
      return ['batch', 'remove_component', 'remove_section', 'view_component', 'mark_step_done', 'done'];
    case 'creation':
      return ['batch', 'create_component', 'create_section', 'view_component', 'mark_step_done', 'done'];
    case 'style':
      return ['batch', 'get_css', 'get_properties', 'set_properties', 'mark_step_done', 'done'];
    case 'reorder':
      return ['batch', 'reorder_section', 'request_structure', 'view_component', 'mark_step_done', 'done'];
    case 'mutation':
      return ['batch', 'edit_component', 'patch_component', 'view_component', 'mark_step_done', 'done'];
  }
}

function isDatabaseRelevantText(value: string): boolean {
  return /\b(db|database|sqlite|sql|query|queries|table|tables|view|views|schema|row|rows|column|columns|db-table)\b/i.test(value);
}
