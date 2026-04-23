export const DOCUMENT_EDIT_MAX_TOOL_STEPS = 6;

export function buildDocumentEditFormatInstructions(): string {
  return [
    'Reply with exactly one JSON object and nothing else.',
    'Choose one tool at a time.',
    'Valid tools are: `grep`, `view_component`, `edit_component`, `patch_component`, `create_component`, `remove_component`, `create_section`, `remove_section`, `reorder_section`, `request_structure`, `done`.',
    'Use real section ids when a section has an id.',
    'Use component ids when they exist. If a component has no id, use its fallback component ref like `C3`.',
    'Do not invent ids or refs.',
    'Use `grep` to search the whole serialized document with a regex pattern. It returns post-wrap line numbers, nearby context lines, and the nearest component id for each match clump.',
    'For grep regexes, you may use alternation like `Python|TypeScript` and flags like `i` for case-insensitive matches.',
    'When you need exact HVY for a component before editing it, use `view_component` first. It returns 1-based component line numbers and defaults to lines 1-200.',
    'Use `edit_component` only for one existing component. It may revise that component in place or fully replace it, but only for that single referenced component.',
    'Use `patch_component` for small, local changes after you have seen the numbered component lines.',
    'Use `create_component` to add a fully defined new component near an existing one or at the end of a section.',
    'Use `remove_component` and `remove_section` when the request requires deletion.',
    'Use `create_section.hvy` to add one complete serialized HVY section, including its directive, `#!` title, blocks, and nested subsections.',
    'For `create_section`, use `new_position_index_from_0` with `append-root` or `append-child` when the new section should be inserted at a specific sibling index instead of the end.',
    'For `reorder_section`, use `new_position_index_from_0` to move a section to a specific index among its current siblings, or use `target_section_ref` plus `position` for relative moves.',
    'When the request is fully satisfied, return `{"tool":"done","summary":"..."}`.',
    'JSON must use double-quoted keys and string values.',
    'For `create_component.hvy`, return one complete HVY component fragment as a JSON string value with escaped newlines.',
    'For `create_section.hvy`, return one complete HVY section fragment as a JSON string value with escaped newlines.',
    '',
    'Tool shapes:',
    '{"tool":"grep","query":"Python|TypeScript","flags":"i","before":2,"after":2,"max_count":3,"reason":"optional"}',
    '{"tool":"grep","query":"/Python|TypeScript/i","before":2,"after":2,"max_count":3,"reason":"optional"}',
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
    '{"tool":"request_structure","reason":"optional"}',
    '{"tool":"done","summary":"Short summary of what changed."}',
  ].join('\n');
}

export function buildInitialDocumentEditPrompt(request: string): string {
  return [
    'Edit the HVY document to satisfy this request:',
    request,
    '',
    'Step 1: examine the reduced document structure provided in context.',
    'Step 2: request the single best next tool.',
    'After each tool result, decide the next step or finish.',
    `You have at most ${DOCUMENT_EDIT_MAX_TOOL_STEPS} tool steps.`,
  ].join('\n');
}

export function buildToolResult(tool: string, result: string): string {
  return [`Tool result for ${tool}:`, result].join('\n\n');
}
