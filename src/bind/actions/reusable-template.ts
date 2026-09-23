import { getComponentDefs } from '../../component-defs';
import { createEmptyBlock } from '../../document-factory';
import type { VisualBlock } from '../../editor/types';
import { extractReusableTemplateVariablesFromDefinition, validateReusableTemplateValues } from '../../reusable-template-values';
import { state, getRenderApp } from '../../state';
import type { ReusableTemplateModalState } from '../../types';

export function openReusableTemplateModalIfNeeded(component: string, target: ReusableTemplateModalState['target'], onComplete?: ReusableTemplateModalState['onComplete']): boolean {
  const definition = getComponentDefs().find((item) => item.name === component);
  const variables = extractReusableTemplateVariablesFromDefinition(definition);
  if (variables.length === 0) {
    return false;
  }
  state.reusableTemplateModal?.onComplete?.({ status: 'cancelled' });
  state.reusableTemplateModal = { component, target, onComplete };
  getRenderApp()();
  return true;
}

export function createBlockFromReusableTemplateValues(component: string, values: Record<string, string>): VisualBlock {
  const definition = getComponentDefs().find((item) => item.name === component);
  const variables = extractReusableTemplateVariablesFromDefinition(definition);
  validateReusableTemplateValues(variables, values);
  return createEmptyBlock(component, false, undefined, values);
}
