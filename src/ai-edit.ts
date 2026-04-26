import './ai-edit.css';
import { requestProxyCompletion } from './chat/chat';
import {
  deserializeDocumentWithDiagnostics,
  getHvyDiagnosticUsageHint,
  serializeBlockFragment,
  wrapHvyFragmentAsDocument,
} from './serialization';
import type { VisualBlock } from './editor/types';
import type { ChatMessage, ChatSettings, RawEditorDiagnostic, VisualDocument } from './types';
import {
  buildAiEditContext,
  buildAiEditFormatInstructions,
  buildAiEditPrompt,
  buildAiEditRepairPrompt,
  formatAiEditIssueSummary,
} from './ai-edit-guidance';

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

export async function requestAiComponentEdit(params: {
  settings: ChatSettings;
  document: VisualDocument;
  sectionTitle: string;
  block: VisualBlock;
  request: string;
  onBeforeMutation?: () => void;
}): Promise<AiEditRequestResult> {
  const { isDbTablePluginBlock, requestAiDbTableEdit } = await import('./ai-db-table-edit');
  if (isDbTablePluginBlock(params.block)) {
    return requestAiDbTableEdit({
      settings: params.settings,
      document: params.document,
      block: params.block,
      request: params.request,
      onBeforeMutation: params.onBeforeMutation,
    });
  }

  const originalFragment = serializeBlockFragment(params.block);
  const context = buildAiEditContext({
    document: params.document,
    sectionTitle: params.sectionTitle,
    block: params.block,
    fragment: originalFragment,
  });
  const conversation: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: buildAiEditPrompt(params.request),
    },
  ];

  let response = await requestProxyCompletion({
    settings: params.settings,
    messages: conversation,
    context,
    formatInstructions: buildAiEditFormatInstructions(),
    mode: 'component-edit',
    debugLabel: 'ai-edit',
  });

  let parsed = parseAiBlockEditResponse(response);
  if (!parsed.hasErrors && parsed.canonicalFragment.trim() === originalFragment.trim()) {
    parsed.issues.push({
      severity: 'error',
      message: 'The response parsed back to the same HVY component, so the requested change was not applied.',
      hint: 'Keep the same HVY schema keys from the original component and modify the actual fields that should change.',
    });
    parsed.needsRepair = true;
    parsed.hasErrors = true;
  }

  if (parsed.needsRepair) {
    const repairConversation: ChatMessage[] = [
      ...conversation,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response,
      },
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: buildAiEditRepairPrompt(parsed.issues),
      },
    ];
    response = await requestProxyCompletion({
      settings: params.settings,
      messages: repairConversation,
      context,
      formatInstructions: buildAiEditFormatInstructions(),
      mode: 'component-edit',
      debugLabel: 'ai-edit-repair',
    });
    parsed = parseAiBlockEditResponse(response);
    if (!parsed.hasErrors && parsed.canonicalFragment.trim() === originalFragment.trim()) {
      parsed.issues.push({
        severity: 'error',
        message: 'The repaired response still parsed back to the same HVY component.',
        hint: 'Use the exact HVY schema from the original component and change the specific values requested.',
      });
      parsed.hasErrors = true;
    }
  }

  if (!parsed.block || parsed.hasErrors) {
    throw new Error(formatAiEditIssueSummary(parsed.issues) || 'The AI returned an invalid component update.');
  }

  return {
    block: parsed.block,
    originalFragment,
    canonicalFragment: parsed.canonicalFragment,
  };
}

export function sanitizeAiEditOutput(source: string): string {
  const trimmed = source.trim();
  const fencedMatch = trimmed.match(/^```(?:hvy|markdown)?\s*\n([\s\S]*?)\n```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

export function parseAiBlockEditResponse(source: string): AiEditParsedResponse {
  const cleaned = sanitizeAiEditOutput(source);
  const { document, diagnostics } = deserializeDocumentWithDiagnostics(
    wrapHvyFragmentAsDocument(cleaned, { sectionId: 'ai-response', title: 'AI Response' }),
    '.hvy'
  );
  const [section] = document.sections;
  const issues = diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    message: diagnostic.message,
    hint: getHvyDiagnosticUsageHint(diagnostic),
  }));

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
