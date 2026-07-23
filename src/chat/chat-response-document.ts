import { buildDocumentRichTextCopyPayload, type RichTextCopyPayload } from '../rich-text-copy';
import { deserializeDocumentWithDiagnostics, wrapHvyFragmentAsDocument } from '../serialization';
import type { JsonObject } from '../hvy/types';

export const CHAT_RESPONSE_DOCUMENT_META: JsonObject = {
  component_defaults: {
    'xref-card': {
      css: 'margin-top: 0.25rem; margin-bottom: 0.25rem;',
    },
  },
};

export function wrapChatResponseAsDocument(source: string): string {
  return wrapHvyFragmentAsDocument(source, {
    sectionId: 'rsp',
    title: 'Response',
    meta: CHAT_RESPONSE_DOCUMENT_META,
  });
}

export function buildChatResponseRichTextCopyPayload(source: string): RichTextCopyPayload | null {
  const parsed = deserializeDocumentWithDiagnostics(wrapChatResponseAsDocument(source), '.hvy');
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return null;
  }
  const payload = buildDocumentRichTextCopyPayload(parsed.document);
  return payload.plainText || payload.html ? payload : null;
}
