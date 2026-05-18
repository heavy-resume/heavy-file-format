import { findBlockByIds } from '../block-ops';
import { state } from '../state';

export function expandSingletonVirtualGroupChild(container: HTMLElement): void {
  const sectionKey = container.dataset.singletonExpandableSectionKey ?? '';
  const blockId = container.dataset.singletonExpandableBlockId ?? '';
  if (!sectionKey || !blockId) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.component !== 'expandable') {
    return;
  }
  const expandableStateKey = `${sectionKey}:${blockId}`;
  const expanded = state.readerExpandableState[expandableStateKey] ?? block.schema.expandableExpanded;
  if (!expanded) {
    state.readerExpandableState[expandableStateKey] = true;
  }
}
