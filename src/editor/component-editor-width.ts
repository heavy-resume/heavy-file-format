import type { VisualBlock } from './types';
import { getHostPlugin } from '../plugins/registry';
import { resolveBaseComponent } from '../component-defs';
import { XREF_CARD_EDITOR_MINIMUM_WIDTH, XREF_CARD_EDITOR_PREFERRED_WIDTH } from './components/xref-card/xref-card';
import { normalizeComponentEditorMinimumWidth, normalizeComponentEditorPreferredWidth } from './component-editor-width-value';

export {
  DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH,
  DEFAULT_COMPONENT_EDITOR_PREFERRED_WIDTH,
  normalizeComponentEditorMinimumWidth,
  normalizeComponentEditorPreferredWidth,
} from './component-editor-width-value';

interface ComponentEditorWidths {
  /** Narrowest width the editor stays usable at, below which the modal is offered instead. */
  minimumWidth?: string;
  /** Width the modal opens at, for editors that are intrinsically sized rather than fill-width. */
  preferredWidth?: string;
}

/** Built-in components declare their editor widths the same way plugins do through `minimumEditorWidth`. */
const BUILTIN_COMPONENT_EDITOR_WIDTHS: Record<string, ComponentEditorWidths> = {
  'xref-card': { minimumWidth: XREF_CARD_EDITOR_MINIMUM_WIDTH, preferredWidth: XREF_CARD_EDITOR_PREFERRED_WIDTH },
};

export function getComponentEditorMinimumWidth(block: VisualBlock): string {
  if (block.schema.kind === 'plugin') {
    return normalizeComponentEditorMinimumWidth(getHostPlugin((block.schema.plugin || '').trim())?.minimumEditorWidth);
  }
  return normalizeComponentEditorMinimumWidth(getBuiltinComponentEditorWidths(block).minimumWidth);
}

export function getComponentEditorPreferredWidth(block: VisualBlock): string {
  if (block.schema.kind === 'plugin') {
    return normalizeComponentEditorPreferredWidth(getHostPlugin((block.schema.plugin || '').trim())?.preferredEditorWidth);
  }
  return normalizeComponentEditorPreferredWidth(getBuiltinComponentEditorWidths(block).preferredWidth);
}

function getBuiltinComponentEditorWidths(block: VisualBlock): ComponentEditorWidths {
  return BUILTIN_COMPONENT_EDITOR_WIDTHS[resolveBaseComponent(block.schema.component || 'text')] ?? {};
}
