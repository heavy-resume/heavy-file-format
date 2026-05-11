export function applyThemeModalFilter(root: ParentNode, query: string): void {
  const terms = normalizeFilterTerms(query);
  const rows = [...root.querySelectorAll<HTMLElement>('.theme-color-row')];
  const variableTerms = terms.filter((term) => term.startsWith('--hvy-'));
  let visibleCount = 0;
  for (const row of rows) {
    const haystack = (row.dataset.themeSearch ?? row.textContent ?? '').toLowerCase();
    const colorName = (row.dataset.themeColorName ?? '').toLowerCase();
    const visible = terms.length === 0
      || (variableTerms.length > 0
        ? variableTerms.includes(colorName)
        : terms.every((term) => haystack.includes(term)));
    row.classList.toggle('is-filter-hidden', !visible);
    if (visible) {
      visibleCount += 1;
    }
  }
  const empty = root.querySelector<HTMLElement>('.theme-filter-empty');
  if (empty) {
    empty.hidden = visibleCount > 0;
  }
}

export function setThemeModalFilter(root: ParentNode, query: string): void {
  const input = root.querySelector<HTMLInputElement>('[data-field="theme-color-filter"]');
  if (input) {
    input.value = query;
    input.focus();
    input.select();
  }
  applyThemeModalFilter(root, query);
}

function normalizeFilterTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}
