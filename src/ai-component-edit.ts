import './ai-edit.css';
import { requestProxyCompletion, type HostChatClient } from './chat/chat';
import { serializeBlockFragment } from './serialization';
import type { VisualBlock } from './editor/types';
import type { ChatMessage, ChatSettings, VisualDocument } from './types';
import {
  buildAiEditContext,
  buildAiEditFormatInstructions,
  buildAiEditPrompt,
  buildAiEditRepairPrompt,
  formatAiEditIssueSummary,
} from './ai-edit-guidance';
import { parseAiBlockEditResponse, type AiEditRequestResult } from './ai-component-edit-common';

export async function requestAiComponentEdit(params: {
  settings: ChatSettings;
  document: VisualDocument;
  sectionTitle: string;
  block: VisualBlock;
  request: string;
  onBeforeMutation?: () => void;
  client?: HostChatClient | null;
  beforeLlmCall?: (debugLabel: string) => Promise<void> | void;
}): Promise<AiEditRequestResult> {
  const { isDbTablePluginBlock, requestAiDbTableEdit } = await import('./ai-db-table-edit');
  if (isDbTablePluginBlock(params.block)) {
    return requestAiDbTableEdit({
      settings: params.settings,
      document: params.document,
      block: params.block,
      request: params.request,
      onBeforeMutation: params.onBeforeMutation,
      client: params.client,
      beforeLlmCall: params.beforeLlmCall,
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
    responseInstructions: buildAiEditFormatInstructions(),
    mode: 'component-edit',
    debugLabel: 'ai-edit',
    client: params.client,
    beforeRequest: params.beforeLlmCall,
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
      responseInstructions: buildAiEditFormatInstructions(),
      mode: 'component-edit',
      debugLabel: 'ai-edit-repair',
      client: params.client,
      beforeRequest: params.beforeLlmCall,
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

export { parseAiBlockEditResponse, sanitizeAiEditOutput } from './ai-component-edit-common';
export type { AiEditParsedResponse, AiEditRequestResult } from './ai-component-edit-common';
