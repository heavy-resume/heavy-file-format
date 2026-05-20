import { deserializeDocumentWithDiagnostics, wrapHvyFragmentAsDocument } from '../serialization';
import type { VisualBlock } from '../editor/types';

export function validateAttachedComponentHvy(hvy: string): void {
  const parsed = deserializeDocumentWithDiagnostics(wrapHvyFragmentAsDocument(hvy), '.hvy');
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((diagnostic) => diagnostic.message).join(' '));
  }

  if (parsed.document.sections.length !== 1) {
    throw new Error('Attached row HVY must contain exactly one section wrapper after parsing.');
  }

  const section = parsed.document.sections[0];
  if (!section || section.children.length > 0 || section.blocks.length === 0) {
    throw new Error('Attached row HVY must contain one or more HVY component fragments.');
  }
}

export function parseAttachedComponentBlocks(hvy: string): VisualBlock[] {
  const trimmed = hvy.trim();
  if (trimmed.length === 0) {
    return [];
  }

  validateAttachedComponentHvy(trimmed);
  const parsed = deserializeDocumentWithDiagnostics(wrapHvyFragmentAsDocument(trimmed), '.hvy');
  return parsed.document.sections[0]?.blocks ?? [];
}
