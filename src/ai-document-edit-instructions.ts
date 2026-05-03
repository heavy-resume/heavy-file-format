export const DOCUMENT_EDIT_MAX_TOOL_STEPS = 50;

export function buildEditPathSelectionInstructions(): string {
  return [
    'Reply with exactly one word: `document` or `header`.',
    'Choose whether this request should edit the HVY header or the document body.',
    'Use `document` for visible content: sections, subsections, text, cards, tables, grids, layout CSS on existing sections/components, ordering, additions, and deletions.',
    'Use `header` for front matter metadata: document title, reader settings, theme, component defaults, section defaults, reusable component definitions in `component_defs`, reusable section definitions in `section_defs`, template schema, and plugin metadata.',
    'Use `document` for requests to change visible spacing, margins, or layout between existing sections. Use `header` section defaults only when the user asks for document defaults, template defaults, or future inserted sections.',
    'If the request touches both header and document, choose the path needed for the primary requested change.',
  ].join('\n');
}

export function buildEditPathSelectionPrompt(request: string): string {
  return [
    'Decide which HVY edit path should handle this request:',
    request,
    '',
    'Choose `document` for visible section/component content.',
    'Choose `header` for document metadata and reusable definitions.',
  ].join('\n');
}

export interface DocumentEditPluginHint {
  id: string;
  displayName: string;
  hint?: string;
}

function formatPluginHintLines(pluginHints: DocumentEditPluginHint[]): string[] {
  if (pluginHints.length === 0) {
    return [
      'No plugins are currently registered. Do not create plugin blocks or invent plugin component directives unless a registered plugin is available in context.',
    ];
  }
  return [
    'Available plugins for `<!--hvy:plugin ...-->` blocks:',
    ...pluginHints.map((plugin) => {
      const hint = plugin.hint?.trim();
      return `- ${plugin.displayName} (${plugin.id})${hint ? `: ${hint}` : ''}`;
    }),
    'Only use registered plugin ids from this list. Use `get_help` for exact plugin/component syntax instead of guessing.',
  ];
}

export function buildDocumentEditFormatInstructions(options?: {
  dbTableNames?: string[];
  pluginHints?: DocumentEditPluginHint[];
  planActive?: boolean;
}): string {
  const dbTableNames = options?.dbTableNames ?? [];
  const pluginHints = options?.pluginHints ?? [];
  const planActive = options?.planActive ?? false;
  const hasDbTables = dbTableNames.length > 0;
  const hasDbTablePlugin = pluginHints.some((plugin) => plugin.id === 'dev.heavy.db-table');
  const planTools = planActive ? '`mark_step_done`' : '`plan`, `mark_step_done`';
  const databaseTools = [
    ...(hasDbTables ? ['`query_db_table`'] : []),
    ...(hasDbTablePlugin ? ['`execute_sql`'] : []),
  ].join(', ');
  const validTools = `\`answer\`, ${planTools}, \`grep\`, \`search_components\`, \`get_help\`, \`get_css\`, \`get_properties\`, \`set_properties\`, \`view_component\`, \`view_rendered_component\`, \`edit_component\`, \`patch_component\`, \`create_component\`, \`remove_component\`, \`create_section\`, \`remove_section\`, \`reorder_section\`${databaseTools ? `, ${databaseTools}` : ''}, \`request_structure\`, \`request_rendered_structure\`, \`done\``;
  return [
    'Reply with exactly one JSON object and nothing else.',
    'Choose one tool at a time.',
    `Valid tools are: ${validTools}.`,
    'This is an HVY document editing tool loop, not an HTML generator. Do not return HTML, JSX, DOM markup, JavaScript, or CSS files as document content.',
    'All new visible content must be encoded as HVY sections and components using `<!--hvy:...-->` directives plus Markdown-like text content. Use `get_help` when you need exact component or plugin syntax.',
    ...formatPluginHintLines(pluginHints),
    'Use `answer` for informational questions, explanations, or requests that do not require changing the HVY document. `answer` is final and does not mutate the document.',
    planActive
      ? 'A plan already exists for this request. The `plan` tool is unavailable now; execute the current plan and use `mark_step_done` when steps are complete.'
      : 'For larger or ambiguous edit requests, first use `plan` with explicit component/section work steps: create, modify, delete, reorder, inspect, or verify a component/section. Avoid vague task steps like "implement feature"; name the component or section outcome.',
    'Each plan step should be small enough to complete with one focused tool action or one verification pass. Do not combine unrelated component, section, and schema changes into a single plan step.',
    'Create at most one plan for the current request. Once a plan exists, execute it and mark steps done instead of replacing it.',
    'When a planned step is complete, use `mark_step_done` before moving on or finishing. The current plan progress is kept in context.',
    'If the user reports an error rendered by a component or plugin, inspect rendered output, find the owning component, then fix that serialized component.',
    'Use real section ids when a section has an id.',
    'Use component ids when they exist. If a component has no id, use its fallback component ref like `C3`.',
    'Do not invent ids or refs.',
    'Before creating a component that may already exist, use `search_components` with the intended label/purpose and modify the existing component when the search finds a close match.',
    'Use `grep` to search the serialized document. Use `get_help` with topics like `plugin:dev.heavy.form`, `plugin:dev.heavy.db-table`, or `component:grid` for exact syntax.',
    'Use `search_components` to search the current component/section index by intended purpose, label, plugin, text, or table name. This is local lexical search, not an external embedding API.',
    'Use `get_css`, `get_properties`, and `set_properties` for inline CSS on section/component ids. Use `null` as a property value to remove it.',
    'When you need exact HVY for a component before editing it, use `view_component` first. It returns 1-based component line numbers and defaults to lines 1-200.',
    'Use `request_rendered_structure` to inspect what visible components render, especially when the user reports a visible output problem.',
    'Use `view_rendered_component` to inspect one component rendered as user-facing text plus plugin diagnostics. For db-table plugins this can reveal rendered SQL/table errors.',
    'Use `edit_component` only for one existing component. It may revise that component in place or fully replace it, but only for that single referenced component.',
    'Use `patch_component` for small, local changes after you have seen the numbered component lines.',
    'Use `create_component` to add a fully defined new component near an existing one or at the end of a section.',
    'Use `remove_component` and `remove_section` when the request requires deletion.',
    'Use `create_section.hvy` to add one complete serialized HVY section, including its directive, `#!` title, blocks, and nested subsections.',
    'For `create_section`, use `new_position_index_from_0` with `append-root` or `append-child` when the new section should be inserted at a specific sibling index instead of the end.',
    'For `reorder_section`, use `new_position_index_from_0` to move a section to a specific index among its current siblings, or use `target_section_ref` plus `position` for relative moves.',
    ...(hasDbTables
      ? [
          `Use \`query_db_table\` to inspect live rows from the attached DB when needed. Available SQLite tables/views: ${dbTableNames.join(', ')}.`,
          'For `query_db_table`, provide `table_name` when more than one table exists, or provide a full SQL `query`. `limit` is optional.',
          'Do not invent DB column names in SQL filters. First inspect the table with `query_db_table` and only use columns returned by that table result.',
        ]
      : []),
    ...(hasDbTablePlugin
      ? [
          'Use `execute_sql` to create or update attached SQLite schema/data before adding db-table components that depend on it. SELECT/WITH statements are rejected; use `query_db_table` for reads when tables are already represented in the document.',
          'For relational requests, model real entities as shared tables and use joins or SQL views for derived displays. For example, a chore chart should usually use chores/people/assignments/completions tables plus a pivot query or view, not one table per person or display column.',
          'If a db-table component reports a missing table/view, first diagnose whether the intended object should be a base table, a derived view, or an existing table/view target. Then create the missing SQLite object with `execute_sql` or retarget pluginConfig.table to an existing object that matches the component intent. Treat pluginConfig.source as storage selection, not a schema fix.',
          'When adding a component that should display live DB rows, use a registered db-table plugin block. Use `get_help` with `plugin:dev.heavy.db-table` for exact syntax.',
        ]
      : []),
    'When an edit request is fully satisfied, return `{"tool":"done","summary":"..."}`.',
    'JSON must use double-quoted keys and string values.',
    'For `create_component.hvy`, return one complete HVY component fragment as a JSON string value with escaped newlines. It must start with an HVY component directive such as `<!--hvy:text {}-->`, `<!--hvy:table {...}-->`, `<!--hvy:container {...}-->`, or `<!--hvy:plugin {...}-->`.',
    'For `create_section.hvy`, return one complete HVY section fragment as a JSON string value with escaped newlines. It must start with an HVY section directive such as `<!--hvy: {"id":"new-section"}-->`, followed by a `#!` title and HVY blocks.',
    '',
    'Tool shapes:',
    '{"tool":"answer","answer":"Direct answer to the user."}',
    ...(planActive ? [] : ['{"tool":"plan","steps":["Find the relevant section","Patch the component","Verify the updated structure"],"reason":"optional"}']),
    '{"tool":"mark_step_done","step":1,"summary":"Found the relevant section.","reason":"optional"}',
    '{"tool":"get_help","topic":"plugin:dev.heavy.form","reason":"optional"}',
    '{"tool":"get_help","topic":"component:grid","reason":"optional"}',
    '{"tool":"grep","query":"Python|TypeScript","flags":"i","before":2,"after":2,"max_count":3,"reason":"optional"}',
    '{"tool":"grep","query":"/Python|TypeScript/i","before":2,"after":2,"max_count":3,"reason":"optional"}',
    '{"tool":"search_components","query":"Add Chore form","max_count":3,"reason":"Check for an existing add chore form before creating another one."}',
    '{"tool":"get_css","ids":["summary","C3"],"regex":"margin|padding","flags":"i","reason":"optional"}',
    '{"tool":"get_properties","ids":["summary","skill-python-card"],"properties":["margin","padding"],"reason":"optional"}',
    '{"tool":"get_properties","ids":["summary","C3"],"regex":"^margin","flags":"i","reason":"optional"}',
    '{"tool":"set_properties","ids":["summary","C3"],"properties":{"margin":"0.5rem 0","padding":"0.25rem","background":null},"reason":"optional"}',
    '{"tool":"view_component","component_ref":"C3","reason":"optional"}',
    '{"tool":"view_component","component_ref":"skill-python-card","start_line":1,"end_line":40,"reason":"optional"}',
    '{"tool":"request_rendered_structure","reason":"optional"}',
    '{"tool":"view_rendered_component","component_ref":"chores-table","reason":"optional"}',
    '{"tool":"edit_component","component_ref":"C3","request":"Change the label to Foo","reason":"optional"}',
    '{"tool":"patch_component","component_ref":"C3","edits":[{"op":"replace","start_line":2,"end_line":2,"text":" New content"}],"reason":"optional"}',
    '{"tool":"patch_component","component_ref":"C3","edits":[{"op":"insert_after","line":1,"text":"\\n <!--hvy:text {}-->\\n Added line"},{"op":"delete","start_line":4,"end_line":5}],"reason":"optional"}',
    '{"tool":"create_component","position":"append-to-section","section_ref":"skills","hvy":"<!--hvy:text {}-->\\n New content","reason":"optional"}',
    '{"tool":"create_component","position":"after","target_component_ref":"C3","hvy":"<!--hvy:xref-card {\\"xrefTitle\\":\\"Heavy Stack\\",\\"xrefDetail\\":\\"Project\\",\\"xrefTarget\\":\\"heavy-stack\\"}-->","reason":"optional"}',
    '{"tool":"remove_component","component_ref":"C3","reason":"optional"}',
    '{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"new-section\\"}-->\\n#! New section\\n\\n <!--hvy:text {}-->\\n  New content","reason":"optional"}',
    '{"tool":"create_section","position":"append-root","new_position_index_from_0":1,"hvy":"<!--hvy: {\\"id\\":\\"new-section\\"}-->\\n#! New section\\n\\n <!--hvy:text {}-->\\n  New content","reason":"optional"}',
    '{"tool":"create_section","position":"append-child","parent_section_ref":"skills","hvy":"<!--hvy:subsection {\\"id\\":\\"details\\"}-->\\n#! Details\\n\\n <!--hvy:text {}-->\\n  Detail content","reason":"optional"}',
    '{"tool":"create_section","position":"append-child","parent_section_ref":"skills","new_position_index_from_0":0,"hvy":"<!--hvy:subsection {\\"id\\":\\"details\\"}-->\\n#! Details\\n\\n <!--hvy:text {}-->\\n  Detail content","reason":"optional"}',
    '{"tool":"remove_section","section_ref":"skills","reason":"optional"}',
    '{"tool":"create_section","position":"before","target_section_ref":"skills","hvy":"<!--hvy: {\\"id\\":\\"overview\\"}-->\\n#! Overview\\n\\n <!--hvy:text {}-->\\n  Overview content","reason":"optional"}',
    '{"tool":"reorder_section","section_ref":"history","target_section_ref":"skills","position":"after","reason":"optional"}',
    '{"tool":"reorder_section","section_ref":"history","new_position_index_from_0":0,"reason":"optional"}',
    ...(hasDbTables
      ? [
          '{"tool":"query_db_table","table_name":"work_items","limit":10,"reason":"optional"}',
          '{"tool":"query_db_table","query":"SELECT company, status FROM work_items WHERE status != \\"Rejected\\" ORDER BY company","limit":10,"reason":"optional"}',
        ]
      : []),
    ...(hasDbTablePlugin
      ? [
          '{"tool":"execute_sql","sql":"CREATE TABLE IF NOT EXISTS chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, active INTEGER DEFAULT 1)","reason":"Set up DB schema before adding db-table components"}',
          `{"tool":"create_component","position":"append-to-section","section_ref":"my-section","hvy":"<!--hvy:plugin {\\"plugin\\":\\"dev.heavy.db-table\\",\\"pluginConfig\\":{\\"source\\":\\"with-file\\",\\"table\\":\\"${dbTableNames[0] ?? 'TABLE_NAME'}\\"}}-->","reason":"Add a live db-table component showing all rows"}`,
        ]
      : []),
    '{"tool":"request_structure","reason":"optional"}',
    '{"tool":"done","summary":"Short summary of what changed."}',
  ].join('\n');
}

export function buildInitialDocumentEditPrompt(request: string): string {
  return [
    'Handle this HVY document chat request:',
    request,
    '',
    'This request has been routed to the document body edit path.',
    'Use this path for visible content: sections, subsections, text, cards, tables, grids, component/section CSS, ordering, additions, and deletions.',
    'If the user is asking an informational question or does not ask for a document change, answer directly with the `answer` tool.',
    'Step 1: examine the reduced document outline provided in context.',
    'Step 2: decide whether a plan is needed. Use `plan` for larger multi-step work; otherwise request the single best next tool.',
    'After each tool result, decide the next step or finish.',
    'If you created a plan, mark each completed step with `mark_step_done` as work progresses.',
    `You have at most ${DOCUMENT_EDIT_MAX_TOOL_STEPS} tool steps.`,
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
