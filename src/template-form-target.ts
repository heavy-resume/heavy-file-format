import type { HvyTemplateFormOptions } from './embed';
import type { VisualBlock } from './editor/types';
import type { VisualDocument } from './types';
import { getComponentDefsFromMeta, resolveBaseComponentFromMeta } from './component-defs';
import { visitBlocksInList } from './section-ops';
import { extractReusableTemplateVariablesFromDefinition } from './reusable-template-values';
import { isPdfAllowedComponentInstance, isPdfDocument } from './pdf-document-capabilities';

/** Resolve against document data, including hidden and locked lists, before validating availability. */
export function resolveTemplateFormTarget(document: VisualDocument, options: HvyTemplateFormOptions) {
  const targetId = options.targetId?.trim();
  const targetType = options.targetType?.trim();
  if (!targetId && !targetType) throw new Error('openTemplateForm requires targetId or targetType.');
  const matches: Array<{ sectionKey: string; block: VisualBlock }> = [];
  for (const section of document.sections) {
    visitBlocksInList(section.blocks, (block) => {
      if (targetId
        ? block.schema.id === targetId
        : resolveBaseComponentFromMeta(block.schema.component, document.meta) === 'component-list'
          && block.schema.componentListComponent === targetType) {
        matches.push({ sectionKey: section.key, block });
      }
    });
  }
  if (!matches.length) throw new Error('No component list matches the requested template form target.');
  if (matches.length > 1) {
    throw new Error(targetId ? 'The targetId is not unique in this document.' : 'Multiple component lists match targetType; provide targetId.');
  }
  const target = matches[0]!;
  if (resolveBaseComponentFromMeta(target.block.schema.component, document.meta) !== 'component-list') {
    throw new Error('The template form target must be a component list.');
  }
  const component = target.block.schema.componentListComponent;
  if (targetType && component !== targetType) throw new Error('targetType does not match the target list’s item type.');
  if (target.block.schema.lock) throw new Error('The target component list is locked.');
  if (isPdfDocument(document) && !isPdfAllowedComponentInstance(component, document.meta)) {
    throw new Error('This item type cannot be added to a PDF document.');
  }
  const definition = getComponentDefsFromMeta(document.meta).find((item) => item.name === component);
  if (!extractReusableTemplateVariablesFromDefinition(definition).length) {
    throw new Error('The target list’s item template has no form fields.');
  }
  return { ...target, component };
}
