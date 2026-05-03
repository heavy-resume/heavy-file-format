import { parse as parseYaml } from 'yaml';
import { serializeDocumentHeaderYaml } from './serialization';
import type { VisualDocument } from './types';
import type { JsonObject } from './hvy/types';
import type { HeaderEditToolRequest } from './ai-document-edit-types';
import { DEFAULT_VIEW_END_LINE, DEFAULT_VIEW_START_LINE } from './ai-document-edit-types';
import { applyComponentPatchEdits, buildGrepRegex, clampLineRange, formatNumberedFragment } from './ai-document-line-tools';

export function executeGrepHeaderTool(
  request: Extract<HeaderEditToolRequest, { tool: 'grep_header' }>,
  document: VisualDocument
): string {
  const query = request.query.trim();
  if (query.length === 0) {
    throw new Error('grep_header.query must be a non-empty string.');
  }

  const before = Math.max(0, request.before ?? 0);
  const after = Math.max(0, request.after ?? 0);
  const maxCount = Math.max(1, request.max_count ?? 5);
  const matcher = buildGrepRegex(query, request.flags);
  const lines = serializeDocumentHeaderYaml(document).split('\n');
  const matchIndexes = lines
    .map((line, index) => ({ index, matches: matcher.test(line) }))
    .filter((entry) => entry.matches)
    .slice(0, maxCount)
    .map((entry) => entry.index);

  if (matchIndexes.length === 0) {
    return `No header matches for "${query}".`;
  }

  return matchIndexes
    .map((matchIndex, idx) => {
      const start = Math.max(0, matchIndex - before);
      const end = Math.min(lines.length - 1, matchIndex + after);
      return [
        `Header match ${idx + 1} of ${matchIndexes.length}`,
        ...lines.slice(start, end + 1).map((line, index) => `${String(start + index + 1).padStart(4, ' ')} | ${line}`),
      ].join('\n');
    })
    .join('\n\n');
}

export function executeViewHeaderTool(
  request: Extract<HeaderEditToolRequest, { tool: 'view_header' }>,
  document: VisualDocument
): string {
  const yaml = serializeDocumentHeaderYaml(document);
  const clampRange = clampLineRange(yaml.split('\n').length, request.start_line, request.end_line);
  return [
    `Showing YAML header lines ${clampRange.startLine}-${clampRange.endLine} (without --- delimiters; default range is ${DEFAULT_VIEW_START_LINE}-${DEFAULT_VIEW_END_LINE})`,
    '',
    'Header YAML with 1-based line numbers:',
    formatNumberedFragment(yaml, clampRange.startLine, clampRange.endLine),
  ].join('\n');
}

export function executePatchHeaderTool(
  request: Extract<HeaderEditToolRequest, { tool: 'patch_header' }>,
  document: VisualDocument,
  onMutation?: (group?: string) => void
): string {
  const originalYaml = serializeDocumentHeaderYaml(document);
  const patchedYaml = applyComponentPatchEdits(originalYaml, request.edits);
  const parsed = parseYaml(patchedYaml) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('patch_header produced invalid YAML. Header YAML must parse to an object.');
  }
  validateHeaderDefaults(parsed as JsonObject);

  onMutation?.('ai-edit:header');
  Object.keys(document.meta).forEach((key) => {
    delete document.meta[key];
  });
  Object.assign(document.meta, parsed as JsonObject);
  if (typeof document.meta.hvy_version === 'undefined') {
    document.meta.hvy_version = 0.1;
  }

  return `Patched header with ${request.edits.length} edit${request.edits.length === 1 ? '' : 's'}.`;
}

function validateHeaderDefaults(meta: JsonObject): void {
  assertOnlyCssDefaultFields(meta.section_defaults, 'section_defaults');

  const componentDefaults = meta.component_defaults;
  if (!componentDefaults || typeof componentDefaults !== 'object' || Array.isArray(componentDefaults)) {
    return;
  }

  for (const [componentName, defaults] of Object.entries(componentDefaults)) {
    assertOnlyCssDefaultFields(defaults, `component_defaults.${componentName}`);
  }
}

function assertOnlyCssDefaultFields(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  const unsupportedKeys = Object.keys(value).filter((key) => key !== 'css');
  if (unsupportedKeys.length > 0) {
    throw new Error(`${label} only supports the "css" field. Unsupported field${unsupportedKeys.length === 1 ? '' : 's'}: ${unsupportedKeys.join(', ')}.`);
  }
}
