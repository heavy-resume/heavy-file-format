import { wrapHvyFragmentAsDocument } from '../serialization';
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
