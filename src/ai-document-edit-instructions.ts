export const DOCUMENT_EDIT_MAX_TOOL_STEPS = 50;

export interface DocumentEditPluginHint {
  id: string;
  displayName: string;
  hint?: string;
}

export function buildDocumentEditFormatInstructions(options?: {
  dbTableNames?: string[];
  pluginHints?: DocumentEditPluginHint[];
  planActive?: boolean;
  request?: string;
}): string {
  const dbTableNames = options?.dbTableNames ?? [];
  const pluginHints = options?.pluginHints ?? [];
  const planActive = options?.planActive ?? false;
  const request = options?.request ?? '';
  const dbRelevant = isDatabaseRelevantRequest(request);
  const hasDbTables = dbRelevant && dbTableNames.length > 0;
  const hasDbTablePlugin = dbRelevant && pluginHints.some((plugin) => plugin.id === 'dev.heavy.db-table');
  const planTools = planActive ? '`mark_step_done`' : '`plan`, `mark_step_done`';
  const databaseTools = [
    ...(hasDbTables ? ['`query_db_table`'] : []),
    ...(hasDbTablePlugin ? ['`execute_sql`'] : []),
  ].join(', ');
  const validTools = `\`answer\`, ${planTools}, \`batch\`, \`grep\`, \`search_components\`, \`get_help\`, \`get_css\`, \`get_properties\`, \`set_properties\`, \`view_component\`, \`view_rendered_component\`, \`edit_component\`, \`patch_component\`, \`create_component\`, \`remove_component\`, \`create_section\`, \`remove_section\`, \`reorder_section\`${databaseTools ? `, ${databaseTools}` : ''}, \`request_structure\`, \`request_rendered_structure\`, \`done\``;
  return [
    'Reply with exactly one JSON object and nothing else.',
    'The document has already been walked section-by-section in the context notes. Do not start by inspecting the whole document again.',
    'Use the notes to create one linear plan or run the next concrete tool call.',
    'Prefer `batch` for a known ordered sequence of concrete tool calls.',
    'Plan at tool-action granularity: one plan step should be completable by one normal tool call or one batch.',
    'If several edits will be executed together in one batch, describe that whole batch outcome as one plan step instead of making one step per batched call.',
    `Valid tools are: ${validTools}.`,
    ...(planActive ? [] : ['Plan shape: `{"tool":"plan","steps":["Modify component X to remove Y","Verify no Y remains"]}`.']),
    'Batch shape: `{"tool":"batch","calls":[{"tool":"remove_component","component_ref":"id"}]}`.',
    'Use `get_help` only when exact syntax is missing from the notes or recent tool help. Its topic may name one tool or several, such as `patch_component, edit_component, batch`.',
    'Do not put `answer`, `done`, `plan`, `mark_step_done`, or another `batch` inside a batch.',
    ...(pluginHints.length > 0 ? [`Registered plugin ids: ${pluginHints.map((plugin) => plugin.id).join(', ')}.`] : []),
    planActive
      ? 'A plan already exists; continue from the next unfinished step.'
      : 'For larger work, create one plan after reviewing the notes. Plan steps must be document changes or final verification, not discovery.',
    'Use existing section/component refs from the notes. Do not invent ids.',
    'Return HVY only inside create/patch payload fields; never HTML/JSX/DOM.',
    ...(hasDbTables
      ? [
          `SQLite tables/views available: ${dbTableNames.join(', ')}.`,
          'Query DB columns before writing SQL that depends on unknown columns.',
        ]
      : []),
    ...(hasDbTablePlugin
      ? [
          'For relational displays, prefer shared tables plus joins/views over one table per display column.',
          'Treat pluginConfig.source as storage selection, not a schema fix.',
        ]
      : []),
    'When an edit request is fully satisfied, return `{"tool":"done","summary":"..."}`.',
  ].join('\n');
}

function isDatabaseRelevantRequest(request: string): boolean {
  return /\b(db|database|sqlite|sql|query|queries|table|tables|view|views|schema|row|rows|column|columns|db-table)\b/i.test(request);
}

export function buildDocumentEditToolHelp(topic: string): string | null {
  const normalized = topic.trim().toLowerCase();
  const helpByTopic: Record<string, string> = {
    'tool:answer': '{"tool":"answer","answer":"Direct answer to the user."}',
    'tool:done': '{"tool":"done","summary":"Short summary of what changed."}',
    'tool:plan': '{"tool":"plan","steps":["Find the relevant component","Modify the component","Verify the result"],"reason":"optional"}',
    'tool:mark_step_done': '{"tool":"mark_step_done","step":1,"summary":"Found the relevant component.","reason":"optional"}',
    'tool:batch': [
      '{"tool":"batch","calls":[{"tool":"grep","query":"Python|TypeScript","flags":"i","max_count":5},{"tool":"view_component","component_ref":"tool-typescript"}],"reason":"Inspect multiple targets before planning."}',
      '{"tool":"batch","calls":[{"tool":"patch_component","component_ref":"skill-library-development","edits":[{"op":"replace","start_line":12,"end_line":12,"text":" Text with removed tokens"}]},{"tool":"remove_component","component_ref":"tool-typescript"}],"reason":"Apply one planned cleanup step."}',
      'Use batch for related inspection or a short sequence of concrete edits that should run in order. Do not include answer, done, plan, mark_step_done, or nested batch.',
      'A batch counts as one plan step. If a batch removes or edits several targets, the active plan should have one step describing the whole batch outcome.',
    ].join('\n'),
    'tool:grep': [
      '{"tool":"grep","query":"Python|TypeScript","flags":"i","before":2,"after":2,"max_count":3,"reason":"optional"}',
      '{"tool":"grep","query":"/Python|TypeScript/i","before":2,"after":2,"max_count":3,"reason":"optional"}',
    ].join('\n'),
    'tool:search_components': '{"tool":"search_components","query":"Add Chore form","max_count":3,"reason":"Check for an existing component before creating another one."}',
    'tool:view_component': '{"tool":"view_component","component_ref":"skill-python-card","start_line":1,"end_line":40,"reason":"optional"}',
    'tool:view_rendered_component': '{"tool":"view_rendered_component","component_ref":"chores-table","reason":"optional"}',
    'tool:edit_component': '{"tool":"edit_component","component_ref":"C3","request":"Change the label to Foo","reason":"optional"}',
    'tool:patch_component': [
      '{"tool":"patch_component","component_ref":"C3","edits":[{"op":"replace","start_line":2,"end_line":2,"text":" New content"}],"reason":"optional"}',
      '{"tool":"patch_component","component_ref":"C3","edits":[{"op":"delete","start_line":4,"end_line":5}],"reason":"optional"}',
      '{"tool":"patch_component","component_ref":"skill-library-development","edits":[{"op":"replace","start_line":24,"end_line":24,"text":" Built shared platform packages that reduced duplicated code."}],"reason":"Remove TypeScript with no replacement."}',
      'Use patch_component for small local line edits after view_component. Replace the whole affected line with the final desired text when removing tokens.',
      'Nested refs such as `C10.list[2].content[1]` may be used as component_ref when they appear in view_component output or document notes.',
      'If the target contains nested slots and deletion is the goal, prefer remove_component with the nested component id.',
    ].join('\n'),
    'tool:remove_component': '{"tool":"remove_component","component_ref":"tool-typescript","reason":"Remove the nested programming language item."}',
    'tool:create_component': [
      '{"tool":"create_component","position":"append-to-section","section_ref":"skills","hvy":"<!--hvy:text {}-->\\n New content","reason":"optional"}',
      '{"tool":"create_component","position":"after","target_component_ref":"C3","hvy":"<!--hvy:xref-card {\\"xrefTitle\\":\\"Heavy Stack\\",\\"xrefDetail\\":\\"Project\\",\\"xrefTarget\\":\\"heavy-stack\\"}-->","reason":"optional"}',
    ].join('\n'),
    'tool:create_section': '{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"new-section\\"}-->\\n#! New section\\n\\n <!--hvy:text {}-->\\n  New content","reason":"optional"}',
    'tool:remove_section': '{"tool":"remove_section","section_ref":"skills","reason":"optional"}',
    'tool:reorder_section': '{"tool":"reorder_section","section_ref":"history","target_section_ref":"skills","position":"after","reason":"optional"}',
    'tool:css': [
      '{"tool":"get_css","ids":["summary","C3"],"regex":"margin|padding","flags":"i","reason":"optional"}',
      '{"tool":"get_properties","ids":["summary","skill-python-card"],"properties":["margin","padding"],"reason":"optional"}',
      '{"tool":"set_properties","ids":["summary","C3"],"properties":{"margin":"0.5rem 0","padding":"0.25rem","background":null},"reason":"optional"}',
    ].join('\n'),
    'tool:request_structure': '{"tool":"request_structure","reason":"optional"}',
    'tool:request_rendered_structure': '{"tool":"request_rendered_structure","reason":"optional"}',
    'tool:query_db_table': '{"tool":"query_db_table","table_name":"work_items","limit":10,"reason":"optional"}',
    'tool:execute_sql': '{"tool":"execute_sql","sql":"CREATE TABLE IF NOT EXISTS chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, active INTEGER DEFAULT 1)","reason":"Set up DB schema before adding db-table components"}',
  };
  if (helpByTopic[normalized]) {
    return helpByTopic[normalized];
  }

  const requestedTopics = Object.keys(helpByTopic).filter((key) => {
    const bareTool = key.replace(/^tool:/, '');
    return normalized.includes(key) || normalized.includes(bareTool);
  });
  const uniqueTopics = [...new Set(requestedTopics)].filter((key) => key.startsWith('tool:'));
  if (uniqueTopics.length > 0) {
    return uniqueTopics
      .map((key) => [`Help for ${key}:`, helpByTopic[key]].join('\n'))
      .join('\n\n');
  }

  return null;
}

export function buildInitialDocumentEditPrompt(request: string): string {
  return [
    'Handle this HVY document edit request:',
    request,
    '',
    'AI-generated section/chunk notes are in context.',
    'First review those notes. Then create one linear plan or run the next concrete tool call.',
    'Do not begin by re-reading the whole document.',
  ].join('\n');
}

export function buildDocumentNotePrompt(request: string): string {
  return [
    'Take notes for this HVY document edit request:',
    request,
    '',
    'Read the serialized section/chunk context.',
    'For each chunk, write a short note saying whether it is relevant, why, and which exact component/section refs matter.',
    'Do not plan edits yet and do not call tools.',
  ].join('\n');
}

export function buildDocumentNoteFormatInstructions(): string {
  return [
    'Return concise Markdown notes only.',
    'Group notes by chunk or section.',
    'Use exact component/section ids from the context when relevant.',
    'Say "not relevant" for chunks that do not matter to the request.',
    'End with a short "Targets to review" list of the most likely refs.',
    'Do not return JSON, tool calls, HTML, JSX, JavaScript, or CSS files.',
  ].join('\n');
}

export function buildHeaderEditFormatInstructions(options?: { planActive?: boolean }): string {
  const planActive = options?.planActive ?? false;
  const planTools = planActive ? '`mark_step_done`' : '`plan`, `mark_step_done`';
  return [
    'Reply with exactly one JSON object and nothing else.',
    'Choose one header tool at a time.',
    `Valid header tools are: \`answer\`, ${planTools}, \`grep_header\`, \`view_header\`, \`patch_header\`, \`request_header\`, \`done\`.`,
    'Use `answer` for informational questions, explanations, or requests that do not require changing the HVY header. `answer` is final and does not mutate the document.',
    planActive
      ? 'A plan already exists for this request. The `plan` tool is unavailable now; execute the current plan and use `mark_step_done` when steps are complete.'
      : 'For larger or ambiguous header edit requests, first use `plan` with explicit steps. Create at most one plan, then execute it and mark steps done instead of replacing it.',
    'The header is YAML front matter only. It contains document metadata and reusable definitions such as `component_defs` and `section_defs`.',
    'Use the header path for document-level metadata, theme colors, component defaults, section defaults, template schema, plugins, and reusable component/section definitions.',
    'Do not invent metadata fields. For `section_defaults`, the only supported field is `css`, for example `section_defaults:\\n  css: "margin: 0.5rem 0;"`.',
    'For `component_defaults`, each component name may contain only `css`, for example `component_defaults:\\n  xref-card:\\n    css: "margin: 0.5rem 0;"`.',
    'Do not use `section_defaults` to satisfy requests about visible spacing between existing sections; edit the existing section CSS through the document path instead.',
    'When changing a theme palette, consider all known `theme.colors` variables listed in the header outline, including table colors: `--hvy-table-header`, `--hvy-table-row-bg-1`, and `--hvy-table-row-bg-2`.',
    'Do not use this path for visible document body content; that belongs to the document path.',
    'Use `request_header` when you need a refreshed header outline and properties.',
    'Use `grep_header` to search the YAML header with a regex pattern before viewing or patching a specific reusable definition.',
    'Use `view_header` before patching when you need exact YAML line numbers. It returns 1-based YAML header line numbers and defaults to lines 1-200.',
    'Use `patch_header` to edit metadata or reusable definitions after you have enough numbered header context. Patch the YAML header content without `---` delimiters.',
    'After `patch_header`, the full YAML header must parse to an object. Preserve unrelated metadata.',
    'When an edit request is fully satisfied, return `{"tool":"done","summary":"..."}`.',
    'JSON must use double-quoted keys and string values.',
    '',
    'Tool shapes:',
    '{"tool":"answer","answer":"Direct answer to the user."}',
    ...(planActive ? [] : ['{"tool":"plan","steps":["Find the reusable definition","Patch the YAML","Verify the header"],"reason":"optional"}']),
    '{"tool":"mark_step_done","step":1,"summary":"Found the reusable definition.","reason":"optional"}',
    '{"tool":"request_header","reason":"optional"}',
    '{"tool":"grep_header","query":"component_defs|skill-card","flags":"i","before":2,"after":8,"max_count":3,"reason":"optional"}',
    '{"tool":"view_header","start_line":1,"end_line":120,"reason":"optional"}',
    '{"tool":"patch_header","edits":[{"op":"replace","start_line":2,"end_line":2,"text":"title: New title"}],"reason":"optional"}',
    '{"tool":"patch_header","edits":[{"op":"insert_after","line":2,"text":"section_defaults:\\n  css: \\"margin: 0.5rem 0;\\""}],"reason":"optional"}',
    '{"tool":"patch_header","edits":[{"op":"insert_after","line":10,"text":"component_defs:\\n  - name: card-list\\n    baseType: component-list\\n    description: Reusable card list"}],"reason":"optional"}',
    '{"tool":"done","summary":"Short summary of what changed."}',
  ].join('\n');
}

export function buildInitialHeaderEditPrompt(request: string): string {
  return [
    'Handle this HVY header chat request:',
    request,
    '',
    'This request has been routed to the header edit path.',
    'Use this path for document metadata and reusable definitions: title, reader settings, theme, defaults, template schema, plugins, `component_defs`, and `section_defs`.',
    'If the user is asking an informational question or does not ask for a header change, answer directly with the `answer` tool.',
    'Step 1: examine the reduced header outline and properties provided in context.',
    'Step 2: decide whether a plan is needed. Use `plan` for larger multi-step work; otherwise request the single best next header tool.',
    'After each tool result, decide the next step or finish.',
    'If you created a plan, mark each completed step with `mark_step_done` as work progresses.',
    `You have at most ${DOCUMENT_EDIT_MAX_TOOL_STEPS} tool steps.`,
  ].join('\n');
}

export function buildToolResult(tool: string, result: string): string {
  return [`Tool result for ${tool}:`, result].join('\n\n');
}
