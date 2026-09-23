import type { TextPlaceholderDefinition } from './editor/component-helpers';

export const EXPANDABLE_CHEVRON_PLACEHOLDER: TextPlaceholderDefinition = {
  name: 'expandable-chevron',
  label: 'Expandable chevron',
  title: 'Insert expandable chevron',
  render: () => '<span class="hvy-expandable-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="m5.75 3.5 4.5 4.5-4.5 4.5"/></svg></span>',
};
