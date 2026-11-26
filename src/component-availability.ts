import type { VisualBlock, VisualSection } from './editor/types';
import type { JsonObject } from './hvy/types';
import { isReusableDefinitionSectionKey, resolveBaseComponentFromMeta } from './component-defs';
import { getPluginAuthorizationMode } from './plugins/authorization/plugin-authorization-policy';
import { getHostPlugin, isAdvancedComponentPlugin } from './plugins/registry';
import { isPdfAllowedComponentInstance } from './pdf-document-capabilities';
import { isPdfDocument } from './pdf-document-rules';
import { state } from './state';

// Single source for "can this component type appear here?". The add-component
// picker and the editor/AI renderers both ask this module so a type is never
// offered somewhere it would not render.

export type ComponentTypeAvailability =
  | { kind: 'available' }
  // Addable only while the advanced editor is on; the picker shows an "Advanced" badge.
  | { kind: 'advanced' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'not-offered' };

export interface ComponentSurface {
  advancedEditor: boolean;
  templateEditing: boolean;
  pdfDocument: boolean;
  documentMeta: JsonObject | null;
}

/** The advanced flag for the surface being edited; a DB row component modal can set its own mode. */
export function isAdvancedEditorActive(): boolean {
  const rowModal = state.dbTableRowComponentModal;
  if (rowModal && !rowModal.readOnly) {
    if (rowModal.mode === 'advanced') {
      return true;
    }
    if (rowModal.mode === 'basic' || rowModal.mode === 'raw') {
      return false;
    }
  }
  return state.showAdvancedEditor;
}

export function getCurrentComponentSurface(sectionKey: string): ComponentSurface {
  return {
    advancedEditor: isAdvancedEditorActive(),
    templateEditing: isReusableDefinitionSectionKey(sectionKey),
    pdfDocument: isPdfDocument(state.document),
    documentMeta: state.document.meta,
  };
}

export function getComponentTypeAvailability(
  componentName: string,
  pluginId: string | undefined,
  surface: ComponentSurface
): ComponentTypeAvailability {
  if (componentName === 'location-marker' && !surface.templateEditing) {
    return { kind: 'not-offered' };
  }
  if (componentName === 'plugin' && !!pluginId && isHostHiddenPlugin(pluginId)) {
    return { kind: 'not-offered' };
  }
  if (surface.pdfDocument && !isPdfAllowedComponentInstance(componentName, surface.documentMeta, pluginId)) {
    return { kind: 'unavailable', reason: 'Not supported in PHVY' };
  }
  if (!surface.advancedEditor && isAdvancedComponentType(componentName, pluginId)) {
    return { kind: 'advanced' };
  }
  return { kind: 'available' };
}

function isAdvancedComponentType(componentName: string, pluginId: string | undefined): boolean {
  return componentName === 'plugin' && !!pluginId && isAdvancedComponentPlugin(pluginId);
}

export function isAdvancedComponentBlock(block: VisualBlock, documentMeta: JsonObject | null): boolean {
  return resolveBaseComponentFromMeta(block.schema.component, documentMeta) === 'plugin'
    && (isAdvancedComponentType('plugin', block.schema.plugin) || isHostHiddenPlugin(block.schema.plugin));
}

/** A plugin block the host's authorization policy says must not be offered; it never loads. */
export function isHostHiddenPluginBlock(block: VisualBlock, documentMeta: JsonObject | null): boolean {
  return resolveBaseComponentFromMeta(block.schema.component, documentMeta) === 'plugin'
    && isHostHiddenPlugin(block.schema.plugin);
}

function isHostHiddenPlugin(pluginId: string): boolean {
  const registration = getHostPlugin(pluginId);
  return registration?.authorization === 'required'
    && getPluginAuthorizationMode(state.document, registration) === 'hidden';
}

/** A section whose every top-level block is an advanced component. */
export function isAdvancedOnlySection(section: VisualSection, documentMeta: JsonObject | null): boolean {
  return section.blocks.length > 0
    && section.blocks.every((block) => isAdvancedComponentBlock(block, documentMeta));
}
