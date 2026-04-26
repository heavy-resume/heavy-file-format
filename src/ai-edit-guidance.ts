import { HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS } from './chat/chat';
import { resolveBaseComponent } from './component-defs';
import type { VisualBlock } from './editor/types';
import type { RawEditorDiagnostic, VisualDocument } from './types';
import { buildChatDocumentContext } from './chat/chat';

export function buildAiEditContext(params: {
  document: VisualDocument;
  sectionTitle: string;
  block: VisualBlock;
  fragment: string;
}): string {
  const componentGuidance = getAiEditComponentGuidance(params.block);
  return [
    'Current HVY document context:',
    buildChatDocumentContext(params.document),
    '',
    'Selected component details:',
    `Section: ${params.sectionTitle}`,
    `Component: ${params.block.schema.component}`,
    `Base component: ${resolveBaseComponent(params.block.schema.component)}`,
    `Schema ID: ${params.block.schema.id || '(none)'}`,
    '',
    'Preserve the selected component shape and property names unless the request explicitly changes them.',
    componentGuidance ? `Component-specific guidance:\n${componentGuidance}` : '',
    '',
    'Selected component HVY:',
    params.fragment,
  ].filter((part) => part.length > 0).join('\n');
}

export function buildAiEditPrompt(request: string): string {
  return [
    'Update the selected HVY component to satisfy this request:',
    request,
    '',
    'Start from the selected component HVY and make the smallest valid change that satisfies the request.',
    'Preserve the meaning and types of existing HVY fields.',
    'If the request does not fit the selected component naturally, replace it with a more appropriate HVY component instead of inventing unsupported fields or overloading existing ones.',
    'Return only the updated HVY for that single component.',
    'Do not return front matter, section directives, headings, code fences, or explanations.',
    'Preserve existing IDs and unchanged fields unless the request explicitly changes them.',
  ].join('\n');
}

export function buildAiEditFormatInstructions(): string {
  return [
    HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS,
    '',
    'You are revising a single HVY component, not a whole document.',
    'Return exactly one HVY component fragment.',
    'Do not include YAML front matter, section comments, section headings, code fences, or prose outside the component.',
    'Every HVY directive payload must be strict JSON with double-quoted keys and strings.',
    'Keep HVY field value types correct. Booleans must stay booleans, strings must stay strings, and arrays/objects must keep the documented shape.',
    'If the request implies a different interaction or structure than the selected component supports, return a replacement component that fits the request cleanly.',
    'Keep the output valid HVY.',
  ].join('\n\n');
}

export function buildAiEditRepairPrompt(issues: RawEditorDiagnostic[]): string {
  const uniqueIssues = issues
    .filter(
      (issue, index, all) =>
        all.findIndex((candidate) => candidate.message === issue.message && candidate.hint === issue.hint) === index
    )
    .slice(0, 6);

  return [
    'Revise your previous HVY component so it is valid and contains exactly one component.',
    '',
    'Issues:',
    ...uniqueIssues.map((issue) => `- ${issue.message}\n  Hint: ${issue.hint}`),
    '',
    'Return only the corrected single-component HVY fragment.',
  ].join('\n');
}

export function formatAiEditIssueSummary(issues: RawEditorDiagnostic[]): string {
  if (issues.length === 0) {
    return '';
  }
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.message} ${issue.hint}`.trim())
    .join(' ');
}

export function getAiEditComponentGuidance(block: VisualBlock): string {
  const base = resolveBaseComponent(block.schema.component);
  if (base === 'table') {
    return [
      '- Use `tableColumns` as a comma-separated string, for example `"Foo, Bar"`.',
      '- Use `tableRows` as an array of rows with `cells` arrays.',
      '- Each table row only contains `cells`, which is an array of strings.',
      '- Do not invent row-level interaction or detail fields for tables.',
      '- Do not invent `columns` or `rows` keys.',
      '- Tables are non-interactive. If the user asks for reveal/hide behavior, extra narrative detail, or expandable content, replace the table with an `expandable` or another better-fitting component instead of forcing the table schema.',
      '- Do not use GitHub-flavored Markdown table syntax or pipe-delimited pseudo-tables as a shortcut.',
      '- If converting a table to nested expandables, keep the column header in the outer expandable stub only.',
      '- Put one expandable per data row inside the outer expandable content, and do not wrap the header as its own row expandable.',
    ].join('\n');
  }
  if (base === 'xref-card') {
    return [
      '- Use `xrefTitle`, optional `xrefDetail`, and `xrefTarget`.',
      '- Do not replace an xref-card with a plain markdown link.',
    ].join('\n');
  }
  if (base === 'expandable') {
    return [
      '- Keep one `expandable:stub` slot and one `expandable:content` slot.',
      '- Put nested components under those slots rather than inline in schema JSON.',
    ].join('\n');
  }
  if (base === 'grid') {
    return [
      '- Keep `gridColumns` as a number.',
      '- Keep items as nested `<!--hvy:grid:N {...}-->` slots, not schema inline arrays.',
    ].join('\n');
  }
  return '';
}
