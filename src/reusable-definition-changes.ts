import { parse as parseYaml } from 'yaml';
import { serializeDocumentHeaderYaml } from './serialization';
import type { ReusableDefinitionEditModalState, VisualDocument } from './types';

export function hasReusableDefinitionChanges(
  document: VisualDocument,
  modal: ReusableDefinitionEditModalState
): boolean {
  const key = modal.kind === 'component' ? 'component_defs' : 'section_defs';
  const definitions = document.meta[key] as Array<{ name: string }>;
  const definition = definitions[modal.index];
  if (modal.draftName !== undefined && modal.draftName.trim() !== definition.name) return true;

  // Compare persisted content, excluding editor-only state and the schema
  // normalization that occurs when a template is opened or focused.
  return serializeDocumentHeaderYaml(document) !== serializeDocumentHeaderYaml({
    ...document,
    meta: {
      ...document.meta,
      [key]: definitions.map((item, index) => index === modal.index ? parseYaml(modal.originalRaw!) : item),
    },
  });
}
