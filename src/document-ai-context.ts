import type { VisualDocument } from './types';

export const DOCUMENT_AI_CONTEXT_KEY = 'ai-context';
export const DOCUMENT_AI_IMPORT_GUIDANCE_KEY = 'ai-import-guidance';

export function getDocumentAiContext(document: VisualDocument): string {
  const value = document.meta[DOCUMENT_AI_CONTEXT_KEY];
  return typeof value === 'string' ? value.trim() : '';
}

export function getDocumentAiImportGuidance(document: VisualDocument): string {
  const value = document.meta[DOCUMENT_AI_IMPORT_GUIDANCE_KEY];
  return typeof value === 'string' ? value.trim() : '';
}
