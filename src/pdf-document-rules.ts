import { resolveBaseComponentFromMeta } from './component-definition-helpers';
import type { VisualDocument } from './types';

type PdfComponentInstanceValidator = (
  componentName: string,
  meta: Record<string, unknown> | null | undefined,
  pluginId?: string
) => boolean;

let applicationValidator: PdfComponentInstanceValidator | null = null;

export function isPdfDocument(document: Pick<VisualDocument, 'extension'>): boolean {
  return document.extension === '.phvy';
}

export function setPdfComponentInstanceValidator(validator: PdfComponentInstanceValidator): void {
  applicationValidator = validator;
}

export function isPdfAllowedDocumentComponentInstance(
  componentName: string,
  meta: Record<string, unknown> | null | undefined,
  pluginId?: string
): boolean {
  if (applicationValidator) {
    return applicationValidator(componentName, meta, pluginId);
  }
  const baseComponent = resolveBaseComponentFromMeta(componentName, meta);
  return baseComponent === 'text'
    || baseComponent === 'container'
    || baseComponent === 'component-list'
    || baseComponent === 'grid'
    || baseComponent === 'table'
    || baseComponent === 'image';
}
