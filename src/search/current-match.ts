const CURRENT_SEARCH_MATCH_CLASS = 'is-current-search-match';

export function setCurrentSearchMatch(root: ParentNode, marker: HTMLElement | null): void {
  root.querySelectorAll<HTMLElement>(`.search-match-marker.${CURRENT_SEARCH_MATCH_CLASS}`).forEach((current) => {
    current.classList.remove(CURRENT_SEARCH_MATCH_CLASS);
  });
  marker?.classList.add(CURRENT_SEARCH_MATCH_CLASS);
}

export function clearRenderedSearchMatches(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.search-match-marker').forEach((marker) => {
    const parent = marker.parentNode;
    marker.replaceWith(...Array.from(marker.childNodes));
    parent?.normalize();
  });
}
