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
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
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
