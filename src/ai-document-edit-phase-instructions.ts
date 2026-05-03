import { getDocumentEditPhaseTools, type DocumentEditPhase, type DocumentEditToolName } from './ai-document-edit-phases';

export interface DocumentEditPhaseInstructionOptions {
  phase: DocumentEditPhase;
  optionalTools?: readonly DocumentEditToolName[];
}

const TOOL_LABELS: Record<DocumentEditToolName, string> = {
  answer: '`answer`',
  plan: '`plan`',
  mark_step_done: '`mark_step_done`',
  request_structure: '`request_structure`',
  request_rendered_structure: '`request_rendered_structure`',
  get_help: '`get_help`',
  search_components: '`search_components`',
  view_component: '`view_component`',
  view_rendered_component: '`view_rendered_component`',
  grep: '`grep`',
  get_css: '`get_css`',
  get_properties: '`get_properties`',
  set_properties: '`set_properties`',
  edit_component: '`edit_component`',
  patch_component: '`patch_component`',
  remove_section: '`remove_section`',
  remove_component: '`remove_component`',
  create_component: '`create_component`',
  create_section: '`create_section`',
  reorder_section: '`reorder_section`',
  query_db_table: '`query_db_table`',
  execute_sql: '`execute_sql`',
  done: '`done`',
  batch: '`batch`',
};

export function buildDocumentEditPhaseInstructions(options: DocumentEditPhaseInstructionOptions): string[] {
  const tools = getDocumentEditPhaseTools(options.phase, {
    optionalTools: options.optionalTools,
  });
  return [
    `Current edit phase: ${options.phase}.`,
    `Valid tools for this phase are: ${formatToolList(tools)}.`,
    getPhaseGuidance(options.phase),
  ];
}

function formatToolList(tools: DocumentEditToolName[]): string {
  return tools.map((tool) => TOOL_LABELS[tool]).join(', ');
}

function getPhaseGuidance(phase: DocumentEditPhase): string {
  switch (phase) {
    case 'planning':
      return 'Create one concrete plan from the notes, or run one targeted search/view if targets are still unclear. Do not mutate in this phase.';
    case 'database':
      return 'Use DB inspection or schema/write tools only when needed for the reported DB task; prefer shared tables plus joins/views over one table per display column.';
    case 'repair':
      return 'Recover from the latest failure with the narrowest target and the latest exact tool result; do not restart broad discovery.';
    case 'verification':
      return 'Verify the active task with a focused search/render check, then mark the step done or finish.';
    case 'removal':
      return 'Remove only the targeted component/section refs. Use batch when several removals belong to one planned step.';
    case 'creation':
      return 'Create the requested component or section at the known target location. Use batch only for one planned creation outcome.';
    case 'style':
      return 'Inspect or set only CSS/properties for known refs. Keep style changes narrowly scoped.';
    case 'reorder':
      return 'Move only known section/component targets; refresh structure if the ordering target is unclear.';
    case 'mutation':
      return 'Modify one known target or one planned batch of related targets. View first only when exact lines or nested refs are unclear.';
  }
}
