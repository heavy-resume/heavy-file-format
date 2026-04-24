export const DOCUMENT_EDIT_MAX_TOOL_STEPS = 6;

export function buildEditPathSelectionInstructions(): string {
  return [
    'Reply with exactly one word: `document` or `header`.',
    'Choose whether this request should edit the HVY header or the document body.',
    'Use `document` for visible content: sections, subsections, text, cards, tables, grids, layout CSS on existing sections/components, ordering, additions, and deletions.',
    'Use `header` for front matter metadata: document title, reader settings, theme, component defaults, section defaults, reusable component definitions in `component_defs`, reusable section definitions in `section_defs`, template schema, and plugin metadata.',
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

export function buildDocumentEditFormatInstructions(options?: { dbTableNames?: string[] }): string {
  const dbTableNames = options?.dbTableNames ?? [];
  const hasDbTables = dbTableNames.length > 0;
  const validTools = hasDbTables
    ? '`grep`, `get_css`, `get_properties`, `set_properties`, `view_component`, `edit_component`, `patch_component`, `create_component`, `remove_component`, `create_section`, `remove_section`, `reorder_section`, `query_db_table`, `request_structure`, `done`'
    : '`grep`, `get_css`, `get_properties`, `set_properties`, `view_component`, `edit_component`, `patch_component`, `create_component`, `remove_component`, `create_section`, `remove_section`, `reorder_section`, `request_structure`, `done`';
  return [
    'Reply with exactly one JSON object and nothing else.',
    'Choose one tool at a time.',
    `Valid tools are: ${validTools}.`,
    'Use real section ids when a section has an id.',
    'Use component ids when they exist. If a component has no id, use its fallback component ref like `C3`.',
    'Do not invent ids or refs.',
    'Use `grep` to search the whole serialized document with a regex pattern. It returns post-wrap line numbers, nearby context lines, and the nearest component id for each match clump.',
    'For grep regexes, you may use alternation like `Python|TypeScript` and flags like `i` for case-insensitive matches.',
    'Use `get_css` to read inline CSS for section ids, component ids, or fallback component refs. Optional `regex` filters returned CSS by matching the full CSS string.',
    'Use `get_properties` to read CSS declarations by property name from a list of ids. Optional `properties` limits exact property names; optional `regex` matches property names, values, or full declarations.',
    'Use `set_properties` to set CSS declaration properties on a list of ids. Use `null` as a property value to remove that property.',
    'When you need exact HVY for a component before editing it, use `view_component` first. It returns 1-based component line numbers and defaults to lines 1-200.',
    'Use `edit_component` only for one existing component. It may revise that component in place or fully replace it, but only for that single referenced component.',
    'Use `patch_component` for small, local changes after you have seen the numbered component lines.',
    'Use `create_component` to add a fully defined new component near an existing one or at the end of a section.',
    'Use `remove_component` and `remove_section` when the request requires deletion.',
    'Use `create_section.hvy` to add one complete serialized HVY section, including its directive, `#!` title, blocks, and nested subsections.',
    'For `create_section`, use `new_position_index_from_0` with `append-root` or `append-child` when the new section should be inserted at a specific sibling index instead of the end.',
    'For `reorder_section`, use `new_position_index_from_0` to move a section to a specific index among its current siblings, or use `target_section_ref` plus `position` for relative moves.',
    ...(hasDbTables
      ? [
          `Use \`query_db_table\` to inspect live rows from the attached DB when needed. Available tables: ${dbTableNames.join(', ')}.`,
          'For `query_db_table`, provide `table_name` when more than one table exists, or provide a full SQL `query`. `limit` is optional and is capped for concise tool output.',
        ]
      : []),
    'When the request is fully satisfied, return `{"tool":"done","summary":"..."}`.',
    'JSON must use double-quoted keys and string values.',
    'For `create_component.hvy`, return one complete HVY component fragment as a JSON string value with escaped newlines.',
    'For `create_section.hvy`, return one complete HVY section fragment as a JSON string value with escaped newlines.',
    '',
    'Tool shapes:',
    '{"tool":"grep","query":"Python|TypeScript","flags":"i","before":2,"after":2,"max_count":3,"reason":"optional"}',
    '{"tool":"grep","query":"/Python|TypeScript/i","before":2,"after":2,"max_count":3,"reason":"optional"}',
    '{"tool":"get_css","ids":["summary","C3"],"regex":"margin|padding","flags":"i","reason":"optional"}',
    '{"tool":"get_properties","ids":["summary","skill-python-card"],"properties":["margin","padding"],"reason":"optional"}',
    '{"tool":"get_properties","ids":["summary","C3"],"regex":"^margin","flags":"i","reason":"optional"}',
    '{"tool":"set_properties","ids":["summary","C3"],"properties":{"margin":"0.5rem 0","padding":"0.25rem","background":null},"reason":"optional"}',
    '{"tool":"view_component","component_ref":"C3","reason":"optional"}',
    '{"tool":"view_component","component_ref":"skill-python-card","start_line":1,"end_line":40,"reason":"optional"}',
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
    '{"tool":"request_structure","reason":"optional"}',
    '{"tool":"done","summary":"Short summary of what changed."}',
  ].join('\n');
}

export function buildInitialDocumentEditPrompt(request: string): string {
  return [
    'Edit the HVY document to satisfy this request:',
    request,
    '',
    'This request has been routed to the document body edit path.',
    'Use this path for visible content: sections, subsections, text, cards, tables, grids, component/section CSS, ordering, additions, and deletions.',
    'Step 1: examine the reduced document outline provided in context.',
    'Step 2: request the single best next tool.',
    'After each tool result, decide the next step or finish.',
    `You have at most ${DOCUMENT_EDIT_MAX_TOOL_STEPS} tool steps.`,
  ].join('\n');
}

export function buildHeaderEditFormatInstructions(): string {
  return [
    'Reply with exactly one JSON object and nothing else.',
    'Choose one header tool at a time.',
    'Valid header tools are: `grep_header`, `view_header`, `patch_header`, `request_header`, `done`.',
    'The header is YAML front matter only. It contains document metadata and reusable definitions such as `component_defs` and `section_defs`.',
    'Use the header path for document-level metadata, theme colors, component defaults, section defaults, template schema, plugins, and reusable component/section definitions.',
    'When changing a theme palette, consider all known `theme.colors` variables listed in the header outline, including table colors: `--hvy-table-header`, `--hvy-table-row-bg-1`, and `--hvy-table-row-bg-2`.',
    'Do not use this path for visible document body content; that belongs to the document path.',
    'Use `request_header` when you need a refreshed header outline and properties.',
    'Use `grep_header` to search the YAML header with a regex pattern before viewing or patching a specific reusable definition.',
    'Use `view_header` before patching when you need exact YAML line numbers. It returns 1-based YAML header line numbers and defaults to lines 1-200.',
    'Use `patch_header` to edit metadata or reusable definitions after you have enough numbered header context. Patch the YAML header content without `---` delimiters.',
    'After `patch_header`, the full YAML header must parse to an object. Preserve unrelated metadata.',
    'When the request is fully satisfied, return `{"tool":"done","summary":"..."}`.',
    'JSON must use double-quoted keys and string values.',
    '',
    'Tool shapes:',
    '{"tool":"request_header","reason":"optional"}',
    '{"tool":"grep_header","query":"component_defs|skill-card","flags":"i","before":2,"after":8,"max_count":3,"reason":"optional"}',
    '{"tool":"view_header","start_line":1,"end_line":120,"reason":"optional"}',
    '{"tool":"patch_header","edits":[{"op":"replace","start_line":2,"end_line":2,"text":"title: New title"}],"reason":"optional"}',
    '{"tool":"patch_header","edits":[{"op":"insert_after","line":10,"text":"component_defs:\\n  - name: card-list\\n    baseType: component-list\\n    description: Reusable card list"}],"reason":"optional"}',
    '{"tool":"done","summary":"Short summary of what changed."}',
  ].join('\n');
}

export function buildInitialHeaderEditPrompt(request: string): string {
  return [
    'Edit the HVY header to satisfy this request:',
    request,
    '',
    'This request has been routed to the header edit path.',
    'Use this path for document metadata and reusable definitions: title, reader settings, theme, defaults, template schema, plugins, `component_defs`, and `section_defs`.',
    'Step 1: examine the reduced header outline and properties provided in context.',
    'Step 2: request the single best next header tool.',
    'After each tool result, decide the next step or finish.',
    `You have at most ${DOCUMENT_EDIT_MAX_TOOL_STEPS} tool steps.`,
  ].join('\n');
}

export function buildToolResult(tool: string, result: string): string {
  return [`Tool result for ${tool}:`, result].join('\n\n');
}
