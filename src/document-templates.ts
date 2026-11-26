import { instantiateReusableBlockFromMeta } from './document-factory';
import type { VisualBlock } from './editor/types';
import type { VisualDocument } from './types';

export function instantiateReusableBlockFromDocument(
  document: Pick<VisualDocument, 'meta'>,
  componentName: string,
  templateValues: Record<string, string> = {}
): VisualBlock | null {
  return instantiateReusableBlockFromMeta(componentName, document.meta, templateValues);
}
