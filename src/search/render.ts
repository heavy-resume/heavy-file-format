import './search.css';
import type { ReaderRenderer } from '../reader/render';
import type { VisualDocument } from '../types';
import type { HvySearchResult, SearchCategory, SearchState } from './types';
import { highlightPlainText } from './highlight';
import { findSectionByKey } from '../section-ops';
import { findBlockByIds } from '../block-ops';
import { closeIcon, funnelIcon, magnifyingGlassIcon } from '../icons';

interface SearchRenderDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  readerRenderer: ReaderRenderer;
}

const CATEGORY_LABELS: Record<SearchCategory, string> = {
  tags: 'Tags',
  contents: 'Contents',
  description: 'Description',
};

export function renderSearchLauncher(search: SearchState): string {
  const filtering = search.filterEnabled && search.submittedQuery.trim().length > 0;
  return `<button
    type="button"
    class="search-launcher${search.open ? ' is-active' : ''}${filtering ? ' is-filtering' : ''}"
    data-action="open-search"
    aria-expanded="${search.open ? 'true' : 'false'}"
    aria-label="${filtering ? 'Open filter' : 'Open search'}"
    title="${filtering ? 'Filter' : 'Search'}"
  >${filtering ? funnelIcon() : magnifyingGlassIcon()}</button>`;
}

export function renderSearchPalette(search: SearchState, document: VisualDocument, deps: SearchRenderDeps): string {
  if (!search.open) {
    return '';
  }
  if (search.resultsCollapsed) {
    return '';
  }
  const categories: SearchCategory[] = ['contents', 'tags', 'description'];
  const count = search.results.length;
  const status = search.isLoading
    ? 'Searching...'
    : search.error
    ? search.error
    : search.submittedQuery.trim().length === 0
    ? 'Press Enter to search'
    : `${count} result${count === 1 ? '' : 's'}`;
  const isFilterTab = search.activeTab === 'filter';
  return `<section class="search-overlay" aria-label="Document search">
    <div class="search-backdrop" data-action="close-search"></div>
    <form id="searchComposer" class="search-palette" role="dialog" aria-modal="true" aria-label="Search document">
      <div class="search-tabbar" role="tablist" aria-label="Search mode">
        <button
          type="button"
          class="search-tab${isFilterTab ? '' : ' is-active'}"
          data-action="set-search-tab"
          data-search-tab="search"
          role="tab"
          aria-selected="${isFilterTab ? 'false' : 'true'}"
        >${magnifyingGlassIcon()}<span>Search</span></button>
        <button
          type="button"
          class="search-tab${isFilterTab ? ' is-active' : ''}"
          data-action="set-search-tab"
          data-search-tab="filter"
          role="tab"
          aria-selected="${isFilterTab ? 'true' : 'false'}"
        >${funnelIcon()}<span>Filter</span></button>
        <button type="button" class="search-close-button ghost remove-x" data-action="close-search" aria-label="Close search panel">${closeIcon()}</button>
      </div>
      ${
        isFilterTab
          ? renderFilterTab(search, deps)
          : `${renderSearchInput(search, deps, { icon: magnifyingGlassIcon(), label: 'Search', placeholder: 'Find in document...' })}
      <div class="search-options">
        <div class="search-category-group" role="group" aria-label="Search categories">
          ${categories.map((category) => renderCategoryToggle(category, search, deps)).join('')}
        </div>
        <label class="search-switch">
          <input type="checkbox" data-field="search-case-sensitive" ${search.caseSensitive ? 'checked' : ''} />
          <span>Match Case</span>
        </label>
      </div>
      <div class="search-status${search.error ? ' is-error' : ''}" role="status">${deps.escapeHtml(status)}</div>
      ${renderSearchResults(search, document, deps)}`
      }
    </form>
  </section>`;
}

export function renderCollapsedSearchBar(search: SearchState, deps: Pick<SearchRenderDeps, 'escapeHtml'>): string {
  if (!search.open || !search.resultsCollapsed) {
    return '';
  }
  const position = getCollapsedSearchPosition(search);
  return `<div class="search-inline-row">
    <div class="search-collapsed-bar">
      <button type="button" class="search-collapsed-main" data-action="expand-search-results" aria-label="Show search results">
        ${magnifyingGlassIcon()}
        <span>${deps.escapeHtml(search.submittedQuery || search.queryDraft || 'Search')}</span>
        <span class="search-collapsed-count">${deps.escapeHtml(position)}</span>
      </button>
      <div class="search-nav-buttons" aria-label="Search result navigation">
        <button type="button" class="tiny" data-action="previous-search-result" ${search.results.length ? '' : 'disabled'}>Prev</button>
        <button type="button" class="tiny" data-action="next-search-result" ${search.results.length ? '' : 'disabled'}>Next</button>
      </div>
    </div>
  </div>`;
}

function getCollapsedSearchPosition(search: SearchState): string {
  if (search.results.length === 0) {
    return '0 results';
  }
  const orderedResults = getSearchNavigationResults(search);
  const activeIndex = search.activeResultId
    ? orderedResults.findIndex((result) => result.id === search.activeResultId)
    : -1;
  if (activeIndex >= 0) {
    return `${activeIndex + 1} of ${orderedResults.length}`;
  }
  return `${orderedResults.length} result${orderedResults.length === 1 ? '' : 's'}`;
}

function getSearchNavigationResults(search: SearchState): HvySearchResult[] {
  const byId = new Map(search.results.map((result) => [result.id, result]));
  const ordered = search.navigationResultIds.map((id) => byId.get(id)).filter((result): result is HvySearchResult => Boolean(result));
  if (ordered.length === search.results.length) {
    return ordered;
  }
  return [...search.results].sort((left, right) => (left.documentOrder ?? 0) - (right.documentOrder ?? 0));
}

export function focusSearchInput(app: ParentNode): void {
  window.setTimeout(() => {
    const input = app.querySelector<HTMLInputElement>('[data-field="search-query"]');
    if (!input) {
      return;
    }
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, 0);
}

export function centerSearchResultLenses(app: ParentNode): void {
  window.setTimeout(() => {
    app.querySelectorAll<HTMLElement>('[data-search-lens="true"]').forEach((lens) => {
      const marker = lens.querySelector<HTMLElement>('.search-match-marker');
      const surface = lens.querySelector<HTMLElement>('.search-result-lens-surface');
      if (!marker || !surface) {
        return;
      }
      const markerTop = marker.offsetTop * 0.82;
      const markerLeft = marker.offsetLeft * 0.82;
      lens.scrollTop = Math.max(0, markerTop - lens.clientHeight / 2);
      lens.scrollLeft = Math.max(0, markerLeft - lens.clientWidth / 2);
    });
  }, 0);
}

function renderCategoryToggle(category: SearchCategory, search: SearchState, deps: SearchRenderDeps): string {
  const active = search.categories[category];
  return `<button
    type="button"
    class="search-category-toggle${active ? ' is-active' : ''}"
    data-action="toggle-search-category"
    data-search-category="${deps.escapeAttr(category)}"
    aria-pressed="${active ? 'true' : 'false'}"
  >${deps.escapeHtml(CATEGORY_LABELS[category])}</button>`;
}

function renderSearchInput(search: SearchState, deps: SearchRenderDeps, options: { icon: string; label: string; placeholder: string }): string {
  return `<div class="search-head">
    <div class="search-input-shell">
      <button type="submit" class="search-input-icon-button" aria-label="${deps.escapeAttr(options.label)}">${options.icon}</button>
      <input
        class="search-input"
        data-field="search-query"
        value="${deps.escapeAttr(search.queryDraft)}"
        placeholder="${deps.escapeAttr(options.placeholder)}"
        autocomplete="off"
        spellcheck="false"
        autofocus
      />
    </div>
  </div>`;
}

function renderFilterTab(search: SearchState, deps: SearchRenderDeps): string {
  const applied = search.filterEnabled && search.queryDraft.trim() === search.submittedQuery.trim();
  const status = search.isLoading
    ? 'Searching...'
    : search.error
    ? search.error
    : search.submittedQuery.trim().length > 0 && search.results.length === 0
    ? 'No matches. Try another term.'
    : '';
  return `<section class="search-filter-panel" role="tabpanel" aria-label="Filter search results">
    ${renderSearchInput(search, deps, { icon: funnelIcon(), label: 'Filter document', placeholder: 'Filter document' })}
    ${status ? `<div class="search-status${search.error ? ' is-error' : ''}" role="status">${deps.escapeHtml(status)}</div>` : ''}
    <div class="search-filter-box">
      <div class="search-filter-box-head">
        ${funnelIcon()}
        <span>Filter Technique</span>
      </div>
      <div class="search-filter-mode-group" role="group" aria-label="Filter behavior">
        ${renderFilterModeButton('deprioritize', 'Shade', search, deps)}
        ${renderFilterModeButton('hide', 'Hide', search, deps)}
      </div>
    </div>
    <button
      type="button"
      class="secondary search-apply-filter-button${applied ? ' is-active' : ''}"
      data-action="apply-search-filter"
      aria-pressed="${applied ? 'true' : 'false'}"
    >${applied ? 'Turn off filter' : 'Filter'}</button>
  </section>`;
}

function renderFilterModeButton(mode: SearchState['filterMode'], label: string, search: SearchState, deps: SearchRenderDeps): string {
  const active = search.filterMode === mode;
  return `<button
    type="button"
    class="search-filter-mode${active ? ' is-active' : ''}"
    data-action="set-search-filter-mode"
    data-search-filter-mode="${deps.escapeAttr(mode)}"
    aria-pressed="${active ? 'true' : 'false'}"
  >${deps.escapeHtml(label)}</button>`;
}

function renderSearchResults(search: SearchState, document: VisualDocument, deps: SearchRenderDeps): string {
  if (search.isLoading) {
    return '<div class="search-results search-results-empty">Searching the document...</div>';
  }
  if (search.results.length === 0) {
    const message = search.submittedQuery.trim().length > 0 ? 'No matches. Try another term or category.' : 'Search results will appear here.';
    return `<div class="search-results search-results-empty">${deps.escapeHtml(message)}</div>`;
  }
  const groups = groupResults(search.results);
  return `<div class="search-results">
    ${groups.map(([category, results]) => `<section class="search-result-group">
      <div class="search-result-group-title">${deps.escapeHtml(CATEGORY_LABELS[category])}</div>
      ${results.map((result) => renderSearchResult(result, search, document, deps)).join('')}
    </section>`).join('')}
  </div>`;
}

function renderSearchResult(result: HvySearchResult, search: SearchState, document: VisualDocument, deps: SearchRenderDeps): string {
  const active = search.activeResultId === result.id;
  const target = result.locationLabel?.trim() ? null : resolveResultTarget(result, document);
  const locationLabel = getResultLocationLabel(result, target);
  const context = result.contextLabel || result.sourceFile || '';
  const fields = getResultFields(result);
  return `<button
    type="button"
    class="search-result${active ? ' is-active' : ''}"
    data-action="select-search-result"
    data-search-result-id="${deps.escapeAttr(result.id)}"
  >
    <span class="search-result-main">
      <span class="search-result-title">${highlightPlainText(locationLabel, search.submittedQuery, search.caseSensitive, deps.escapeHtml)}</span>
      ${context ? `<span class="search-result-context">${deps.escapeHtml(context)}</span>` : ''}
      ${fields.length ? `<span class="search-result-fields">${fields.map((field) => `<span>${deps.escapeHtml(field)}</span>`).join('')}</span>` : ''}
      ${renderResultMatchSnippets(result, search, deps, locationLabel)}
    </span>
  </button>`;
}

function getResultFields(result: HvySearchResult): string[] {
  const fields = result.matches?.length
    ? result.matches.map((match) => match.label).filter((label, index, labels) => labels.indexOf(label) === index)
    : [result.sourceField].filter(Boolean);
  return fields.filter((field) => !isLowValueContentField(result, field));
}

function shouldUseDescriptionAsLocation(description: string, result: HvySearchResult): boolean {
  const normalizedDescription = normalizeResultText(description);
  if (!normalizedDescription) {
    return false;
  }
  const normalizedLabel = normalizeResultText(result.label);
  const normalizedPreview = normalizeResultText(result.preview);
  if (normalizedDescription === normalizedLabel || normalizedDescription === normalizedPreview) {
    return false;
  }
  if (normalizedDescription.length <= normalizedLabel.length + 4 && normalizedDescription.includes(normalizedLabel)) {
    return false;
  }
  return true;
}

function normalizeResultText(value: string): string {
  return value
    .replace(/[#*_`~>\-[\](){}:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function renderResultMatchSnippets(result: HvySearchResult, search: SearchState, deps: SearchRenderDeps, locationLabel: string): string {
  const matches = result.matches?.length
    ? result.matches
    : [{ label: result.sourceField, preview: result.preview, matchedText: result.matchedText, field: result.sourceField }];
  const visibleMatches = matches
    .filter((match) => normalizeResultText(match.preview) !== normalizeResultText(locationLabel))
    .slice(0, 3);
  if (visibleMatches.length === 0) {
    return '';
  }
  return `<span class="search-result-snippets">
    ${visibleMatches.map((match) => `
      <span class="search-result-snippet">
        ${isLowValueContentField(result, match.label) ? '' : `<span class="search-result-snippet-label">${deps.escapeHtml(match.label)}</span>`}
        <span>${highlightPlainText(match.preview, search.submittedQuery, search.caseSensitive, deps.escapeHtml)}</span>
      </span>
    `).join('')}
  </span>`;
}

function isLowValueContentField(result: HvySearchResult, field: string): boolean {
  return result.category === 'contents' && (field === 'Text' || field === 'Title');
}

function getResultLocationLabel(
  result: HvySearchResult,
  target: { section: NonNullable<ReturnType<typeof findSectionByKey>>; block?: NonNullable<ReturnType<typeof findBlockByIds>> } | null
): string {
  if (result.locationLabel?.trim()) {
    return result.locationLabel.trim();
  }
  const description = getTargetDescription(result, target);
  if (shouldUseDescriptionAsLocation(description, result)) {
    return description;
  }
  return result.label || result.preview || 'Search result';
}

function getTargetDescription(
  result: HvySearchResult,
  target: { section: NonNullable<ReturnType<typeof findSectionByKey>>; block?: NonNullable<ReturnType<typeof findBlockByIds>> } | null
): string {
  if (!target) {
    return '';
  }
  if (!target.block) {
    return target.section.description.trim();
  }
  const block = target.block;
  if (result.sourceField.includes('Stub')) {
    return block.schema.expandableStubDescription.trim() || block.schema.description.trim();
  }
  if (result.sourceField.includes('Expanded')) {
    return block.schema.expandableContentDescription.trim() || block.schema.description.trim();
  }
  return block.schema.description.trim();
}

function resolveResultTarget(result: HvySearchResult, document: VisualDocument): { section: NonNullable<ReturnType<typeof findSectionByKey>>; block?: NonNullable<ReturnType<typeof findBlockByIds>> } | null {
  const section = findSectionByKey(document.sections, result.sectionKey);
  if (!section) {
    return null;
  }
  if (result.targetKind === 'block' && result.blockId) {
    const block = findBlockByIds(result.sectionKey, result.blockId);
    return block ? { section, block } : { section };
  }
  return { section };
}

function groupResults(results: HvySearchResult[]): Array<[SearchCategory, HvySearchResult[]]> {
  const order: SearchCategory[] = ['tags', 'contents', 'description'];
  return order
    .map((category) => [category, results.filter((result) => result.category === category)] as [SearchCategory, HvySearchResult[]])
    .filter(([, categoryResults]) => categoryResults.length > 0);
}
