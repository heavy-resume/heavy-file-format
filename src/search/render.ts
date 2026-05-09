import './search.css';
import type { ReaderRenderer } from '../reader/render';
import type { VisualDocument } from '../types';
import type { HvySearchResult, SearchCategory, SearchState } from './types';
import { highlightPlainText, highlightSearchHtml } from './highlight';
import { findSectionByKey } from '../section-ops';
import { findBlockByIds } from '../block-ops';
import { closeIcon, magnifyingGlassIcon } from '../icons';

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
  return `<button
    type="button"
    class="search-launcher${search.open ? ' is-active' : ''}"
    data-action="open-search"
    aria-expanded="${search.open ? 'true' : 'false'}"
    aria-label="Open search"
    title="Search"
  >${magnifyingGlassIcon()}</button>`;
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
  return `<section class="search-overlay" aria-label="Document search">
    <div class="search-backdrop" data-action="close-search"></div>
    <form id="searchComposer" class="search-palette" role="dialog" aria-modal="true" aria-label="Search document">
      <div class="search-head">
        <div class="search-input-shell">
          ${magnifyingGlassIcon()}
          <input
            class="search-input"
            data-field="search-query"
            value="${deps.escapeAttr(search.queryDraft)}"
            placeholder="Find in document..."
            autocomplete="off"
            spellcheck="false"
            autofocus
          />
        </div>
        <button type="button" class="search-close-button danger" data-action="close-search" aria-label="Close search">${closeIcon()}</button>
      </div>
      <div class="search-options">
        <div class="search-toggle-group" role="group" aria-label="Search categories">
          ${categories.map((category) => renderCategoryToggle(category, search, deps)).join('')}
        </div>
        <label class="search-switch">
          <input type="checkbox" data-field="search-case-sensitive" ${search.caseSensitive ? 'checked' : ''} />
          <span>Match Case</span>
        </label>
        <label class="search-switch">
          <input type="checkbox" data-field="search-filter" ${search.filterEnabled ? 'checked' : ''} />
          <span>Filter</span>
        </label>
        <button type="submit" class="secondary search-submit-button">Search</button>
      </div>
      <div class="search-status${search.error ? ' is-error' : ''}" role="status">${deps.escapeHtml(status)}</div>
      ${renderSearchResults(search, document, deps)}
    </form>
  </section>`;
}

export function renderCollapsedSearchBar(search: SearchState, deps: Pick<SearchRenderDeps, 'escapeHtml'>): string {
  if (!search.open || !search.resultsCollapsed) {
    return '';
  }
  return `<div class="search-inline-row">
    <button type="button" class="search-collapsed-bar" data-action="expand-search-results" aria-label="Show search results">
      ${magnifyingGlassIcon()}
      <span>${deps.escapeHtml(search.submittedQuery || search.queryDraft || 'Search')}</span>
      <span class="search-collapsed-count">${deps.escapeHtml(`${search.results.length} result${search.results.length === 1 ? '' : 's'}`)}</span>
    </button>
  </div>`;
}

export function focusSearchInput(app: ParentNode): void {
  window.setTimeout(() => {
    app.querySelector<HTMLInputElement>('[data-field="search-query"]')?.focus();
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
  return `<label class="search-category-toggle${search.categories[category] ? ' is-active' : ''}">
    <input type="checkbox" data-field="search-category" data-search-category="${deps.escapeAttr(category)}" ${search.categories[category] ? 'checked' : ''} />
    <span>${deps.escapeHtml(CATEGORY_LABELS[category])}</span>
  </label>`;
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
  const target = resolveResultTarget(result, document);
  const preview = target
    ? renderLensPreview(result, search, target, deps)
    : `<div class="search-result-text-preview">${highlightPlainText(result.preview, search.submittedQuery, search.caseSensitive, deps.escapeHtml)}</div>`;
  const active = search.activeResultId === result.id;
  return `<button
    type="button"
    class="search-result${active ? ' is-active' : ''}"
    data-action="select-search-result"
    data-search-result-id="${deps.escapeAttr(result.id)}"
  >
    <span class="search-result-main">
      <span class="search-result-title">${deps.escapeHtml(result.label)}</span>
      <span class="search-result-meta">${deps.escapeHtml(result.sourceFile ? `${result.sourceField} · ${result.sourceFile}` : result.sourceField)}</span>
      ${result.category === 'contents' ? '' : `<span class="search-result-chip">${highlightPlainText(result.preview, search.submittedQuery, search.caseSensitive, deps.escapeHtml)}</span>`}
    </span>
    ${preview}
  </button>`;
}

function renderLensPreview(
  _result: HvySearchResult,
  search: SearchState,
  target: { section: NonNullable<ReturnType<typeof findSectionByKey>>; block?: NonNullable<ReturnType<typeof findBlockByIds>> },
  deps: SearchRenderDeps
): string {
  const raw = target.block
    ? deps.readerRenderer.renderReaderBlock(target.section, target.block)
    : deps.readerRenderer.renderReaderSection(target.section);
  return `<span class="search-result-lens" data-search-lens="true">
    <span class="search-result-lens-surface">${highlightSearchHtml(raw, search.submittedQuery, search.caseSensitive)}</span>
  </span>`;
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
