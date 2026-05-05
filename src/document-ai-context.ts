import type { VisualDocument } from './types';

export const DOCUMENT_AI_CONTEXT_KEY = 'ai-context';

export function getDocumentAiContext(document: VisualDocument): string {
  const value = document.meta[DOCUMENT_AI_CONTEXT_KEY];
  return typeof value === 'string' ? value.trim() : '';
}
