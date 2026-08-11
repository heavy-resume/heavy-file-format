const CURRENT_SEARCH_MATCH_CLASS = 'is-current-search-match';

export function setCurrentSearchMatch(root: ParentNode, marker: HTMLElement | null): void {
  root.querySelectorAll<HTMLElement>(`.search-match-marker.${CURRENT_SEARCH_MATCH_CLASS}`).forEach((current) => {
    current.classList.remove(CURRENT_SEARCH_MATCH_CLASS);
  });
  marker?.classList.add(CURRENT_SEARCH_MATCH_CLASS);
}
