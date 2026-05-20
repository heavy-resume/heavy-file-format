import type { VisualSection } from './editor/types';

export function isSectionHiddenByTemplateMarker(section: VisualSection): boolean {
  return section.hideIfUnmodified === true;
}

export function filterTemplateVisibleSections(sections: VisualSection[]): VisualSection[] {
  return sections
    .filter((section) => !isSectionHiddenByTemplateMarker(section))
    .map((section) => ({
      ...section,
      children: filterTemplateVisibleSections(section.children),
    }));
}

export function clearHideIfUnmodifiedForSectionPath(sections: VisualSection[], sectionKey: string): boolean {
  const path = findSectionPath(sections, sectionKey);
  if (!path) {
    return false;
  }
  return clearHideIfUnmodifiedForSections(path);
}

export function clearHideIfUnmodifiedForSections(sections: VisualSection[]): boolean {
  let changed = false;
  for (const section of sections) {
    if (section.hideIfUnmodified === true) {
      section.hideIfUnmodified = false;
      changed = true;
    }
    if (!section.expanded) {
      section.expanded = true;
      changed = true;
    }
  }
  return changed;
}

export function findSectionPath(sections: VisualSection[], sectionKey: string, ancestors: VisualSection[] = []): VisualSection[] | null {
  for (const section of sections) {
    const path = [...ancestors, section];
    if (section.key === sectionKey) {
      return path;
    }
    const childPath = findSectionPath(section.children, sectionKey, path);
    if (childPath) {
      return childPath;
    }
  }
  return null;
}
