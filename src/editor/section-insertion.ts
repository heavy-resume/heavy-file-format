import type { SectionInsertionBoundary } from '../section-ops';

export function readSectionInsertionBoundary(element: HTMLElement): SectionInsertionBoundary | null {
  if (element.dataset.sectionInsertion !== 'true') return null;
  const beforeKind = element.dataset.sectionBeforeKind;
  if (beforeKind === 'end') return { beforeKind: 'end', beforeId: '' };
  const beforeId = element.dataset.sectionBeforeId ?? '';
  if (!beforeId || (beforeKind !== 'block' && beforeKind !== 'child')) return null;
  return { beforeKind, beforeId };
}
