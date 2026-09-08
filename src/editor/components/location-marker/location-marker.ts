import './location-marker.css';
import type { ComponentEditorRenderer, ComponentRenderHelpers } from '../../component-helpers';
import type { VisualBlock } from '../../types';
import { componentLocationIcon } from '../../../icons';

function renderMarkerName(block: VisualBlock, helpers: ComponentRenderHelpers): string {
  return helpers.escapeHtml(block.schema.locationMarkerName.trim() || 'Unnamed marker');
}

export const renderLocationMarkerEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => `
  <div class="modal-field-stack">
    <label class="block-meta-field">
      <span>Marker name</span>
      <input
        class="hvy-editor-field-control"
        type="text"
        value="${helpers.escapeAttr(block.schema.locationMarkerName)}"
        autocomplete="off"
        spellcheck="false"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-location-marker-name"
      />
    </label>
    <span class="muted">Plugins use this name to replace the marker with a component when rendering the template.</span>
  </div>
`;

export function renderLocationMarkerPreview(block: VisualBlock, helpers: ComponentRenderHelpers): string {
  return `<div class="hvy-location-marker-preview" data-location-marker-name="${helpers.escapeAttr(block.schema.locationMarkerName.trim())}">
    ${componentLocationIcon()}
    <span><strong>Component location</strong><span>${renderMarkerName(block, helpers)}</span></span>
  </div>`;
}
