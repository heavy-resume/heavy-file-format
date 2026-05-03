import {
  deserializeDocumentWithDiagnostics,
  getHvyDiagnosticUsageHint,
  serializeBlockFragment,
  wrapHvyFragmentAsDocument,
} from './serialization';
import type { VisualBlock } from './editor/types';
import type { JsonObject } from './hvy/types';
import type { RawEditorDiagnostic } from './types';

export interface AiEditParsedResponse {
  block: VisualBlock | null;
  issues: RawEditorDiagnostic[];
  needsRepair: boolean;
  hasErrors: boolean;
  canonicalFragment: string;
}

export interface AiEditRequestResult {
  block: VisualBlock;
  originalFragment: string;
  canonicalFragment: string;
}

export function sanitizeAiEditOutput(source: string): string {
  const trimmed = source.trim();
  const fencedMatch = trimmed.match(/^```(?:hvy|markdown)?\s*\n([\s\S]*?)\n```$/i);
  const cleaned = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return unwrapFencedFormPluginYaml(cleaned);
}

function unwrapFencedFormPluginYaml(source: string): string {
  const lines = source.split('\n');
  const directive = lines[0]?.trim() ?? '';
  if (!/^<!--\s*hvy:plugin\b/i.test(directive) || !/"plugin"\s*:\s*"dev\.heavy\.form"/.test(directive)) {
    return source;
  }

  const body = lines.slice(1);
  const firstContentIndex = body.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex === -1) {
    return source;
  }
  const lastContentIndex = findLastNonBlankLineIndex(body);
  const firstContent = body[firstContentIndex]?.trim() ?? '';
  const lastContent = body[lastContentIndex]?.trim() ?? '';
  if (!/^```ya?ml\s*$/i.test(firstContent) || lastContent !== '```' || firstContentIndex >= lastContentIndex) {
    return source;
  }

  const yamlLines = stripCommonIndent(body.slice(firstContentIndex + 1, lastContentIndex));
  return [lines[0], ...yamlLines].join('\n').trimEnd();
}

function findLastNonBlankLineIndex(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if ((lines[index] ?? '').trim().length > 0) {
      return index;
    }
  }
  return -1;
}

function stripCommonIndent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return commonIndent > 0 ? lines.map((line) => line.slice(Math.min(commonIndent, line.length))) : lines;
}

export function parseAiBlockEditResponse(source: string, meta?: JsonObject): AiEditParsedResponse {
  const cleaned = sanitizeAiEditOutput(source);
  const earlyIssues: RawEditorDiagnostic[] = [];
  if (/^\s*<!--\s*hvy:form\b/i.test(cleaned)) {
    earlyIssues.push({
      severity: 'error',
      message: '`hvy:form` is not a supported component directive.',
      hint: 'Use a registered plugin id from the prompt with `<!--hvy:plugin {"plugin":"PLUGIN_ID","pluginConfig":{}}-->`, or answer that the requested plugin is unavailable.',
    });
  }
  const { document, diagnostics } = deserializeDocumentWithDiagnostics(
    wrapHvyFragmentAsDocument(cleaned, { sectionId: 'ai-response', title: 'AI Response', meta }),
    '.hvy'
  );
  const [section] = document.sections;
  const issues = [
    ...earlyIssues,
    ...diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      message: diagnostic.message,
      hint: getHvyDiagnosticUsageHint(diagnostic),
    })),
  ];

  if (!section) {
    issues.push({
      severity: 'error',
      message: 'No component was returned.',
      hint: 'Return exactly one HVY component directive and its content.',
    });
    return {
      block: null,
      issues,
      needsRepair: true,
      hasErrors: true,
      canonicalFragment: '',
    };
  }

  if (document.sections.length !== 1 || section.children.length > 0 || section.blocks.length !== 1) {
    issues.push({
      severity: 'error',
      message: 'The response must contain exactly one top-level component.',
      hint: 'Return one component only, without subsection directives or sibling components.',
    });
  }

  const candidateBlock = section.blocks[0] ?? null;
  const canonicalFragment = candidateBlock ? serializeBlockFragment(candidateBlock) : '';
  return {
    block: candidateBlock,
    issues,
    needsRepair: issues.length > 0,
    hasErrors: issues.some((issue) => issue.severity === 'error'),
    canonicalFragment,
  };
}
