import { state, openLinkInlineModal } from './_imports';
import { getAiEditorDoubleClickDelayMs } from '../../reference-config';

const AI_DOUBLE_TAP_DISTANCE_PX = 28;
const AI_LONG_PRESS_MS = 560;

let lastAiTap: { sectionKey: string; blockId: string; x: number; y: number; time: number } | null = null;
let suppressNextAiContextClick = false;
let aiLongPress: { pointerId: number; x: number; y: number; timer: number } | null = null;

export function bindContextmenu(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    if (!suppressNextAiContextClick) {
      return;
    }
    suppressNextAiContextClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  app.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.hvy-context-popover-backdrop')) {
      event.preventDefault();
      closeReaderContextPopover(app);
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>('.rich-editor a[href]');
    if (anchor) {
      const editable = anchor.closest<HTMLElement>('.rich-editor');
      if (!editable) {
        return;
      }
      event.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(anchor);
      openLinkInlineModal(app, editable, anchor.getAttribute('href') ?? '', range, anchor);
      return;
    }

    const filtering = state.search.filterEnabled && state.search.submittedQuery.trim().length > 0;
    if (state.currentView !== 'viewer' && state.currentView !== 'ai') {
      return;
    }

    openReaderContextPopover(app, event, filtering);
    if (state.contextMenu?.kind === 'ai') {
      dismissAiModeTip(app);
    }
  });

  app.addEventListener('dblclick', (event) => {
    if (state.currentView !== 'ai') {
      return;
    }
    const target = event.target as HTMLElement;
    if (shouldIgnoreAiContextGestureTarget(target)) {
      return;
    }
    window.getSelection()?.removeAllRanges();
    openReaderContextPopover(app, event, false);
    if (state.contextMenu?.kind === 'ai') {
      dismissAiModeTip(app);
    }
  });

  app.addEventListener('pointerdown', (event) => {
    if (state.currentView !== 'ai' || event.pointerType === 'mouse') {
      return;
    }
    const target = event.target as HTMLElement;
    if (shouldIgnoreAiContextGestureTarget(target)) {
      clearAiLongPress();
      return;
    }
    const blockElement = target.closest<HTMLElement>('.reader-block[data-section-key][data-block-id]');
    if (!blockElement?.dataset.sectionKey || !blockElement.dataset.blockId) {
      clearAiLongPress();
      return;
    }
    clearAiLongPress();
    aiLongPress = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        const active = aiLongPress;
        aiLongPress = null;
        if (!active) {
          return;
        }
        window.getSelection()?.removeAllRanges();
        openReaderContextPopover(app, event, false);
        if (state.contextMenu?.kind === 'ai') {
          dismissAiModeTip(app);
          suppressNextAiContextClick = true;
        }
      }, AI_LONG_PRESS_MS),
    };
  });

  app.addEventListener('pointermove', (event) => {
    if (!aiLongPress || aiLongPress.pointerId !== event.pointerId) {
      return;
    }
    if (Math.hypot(event.clientX - aiLongPress.x, event.clientY - aiLongPress.y) > AI_DOUBLE_TAP_DISTANCE_PX) {
      clearAiLongPress();
    }
  });

  app.addEventListener('pointercancel', (event) => {
    clearAiLongPress(event.pointerId);
  });

  app.addEventListener('pointerup', (event) => {
    clearAiLongPress(event.pointerId);
    if (state.currentView !== 'ai' || event.pointerType === 'mouse') {
      return;
    }
    const target = event.target as HTMLElement;
    if (shouldIgnoreAiContextGestureTarget(target)) {
      lastAiTap = null;
      return;
    }
    const blockElement = target.closest<HTMLElement>('.reader-block[data-section-key][data-block-id]');
    const sectionKey = blockElement?.dataset.sectionKey ?? '';
    const blockId = blockElement?.dataset.blockId ?? '';
    if (!sectionKey || !blockId) {
      lastAiTap = null;
      return;
    }

    const time = event.timeStamp || window.performance.now();
    const previous = lastAiTap;
    lastAiTap = { sectionKey, blockId, x: event.clientX, y: event.clientY, time };
    if (
      !previous ||
      previous.sectionKey !== sectionKey ||
      previous.blockId !== blockId ||
      time - previous.time > getAiEditorDoubleClickDelayMs() ||
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > AI_DOUBLE_TAP_DISTANCE_PX
    ) {
      return;
    }

    lastAiTap = null;
    window.getSelection()?.removeAllRanges();
    openReaderContextPopover(app, event, false);
    if (state.contextMenu?.kind === 'ai') {
      dismissAiModeTip(app);
      suppressNextAiContextClick = true;
    }
  });
}

function dismissAiModeTip(app: HTMLElement): void {
  state.aiModeTipDismissed = true;
  app.querySelector('.ai-view-hint')?.remove();
}

function clearAiLongPress(pointerId?: number): void {
  if (!aiLongPress || (pointerId !== undefined && aiLongPress.pointerId !== pointerId)) {
    return;
  }
  window.clearTimeout(aiLongPress.timer);
  aiLongPress = null;
}

function shouldIgnoreAiContextGestureTarget(target: HTMLElement): boolean {
  const anchor = target.closest<HTMLAnchorElement>('a');
  const readerAction = target.closest<HTMLElement>('[data-reader-action]');
  if (target.closest('[contenteditable="true"]')) {
    return true;
  }
  return Boolean(
    (target.closest('button, input, textarea, select, .hvy-context-popover, .ai-edit-popover') && !readerAction) ||
    (anchor && !anchor.classList.contains('reader-xref-card'))
  );
}

function openReaderContextPopover(app: HTMLElement, event: MouseEvent | PointerEvent, filtering: boolean): void {
  const target = event.target as HTMLElement;
  const blockElement = target.closest<HTMLElement>('.reader-block[data-section-key][data-block-id]');
  const sectionElement = target.closest<HTMLElement>('.reader-section[data-section-key]');
  if (!blockElement && !sectionElement) {
    return;
  }

  const sectionKey = blockElement?.dataset.sectionKey ?? sectionElement?.dataset.sectionKey ?? '';
  const blockId = blockElement?.dataset.blockId ?? '';
  if (!sectionKey) {
    return;
  }

  if (state.currentView === 'viewer' && !filtering) {
    return;
  }
  if (state.currentView === 'ai' && !blockId) {
    return;
  }
  event.preventDefault();
  const fallbackRect = (blockElement ?? sectionElement)?.getBoundingClientRect();
  const shellRect = (app.querySelector<HTMLElement>('.viewer-shell') ?? app).getBoundingClientRect();
  const targetRect = fallbackRect
    ? {
        left: Math.max(0, fallbackRect.left - shellRect.left),
        top: Math.max(0, fallbackRect.top - shellRect.top),
        width: fallbackRect.width,
        height: fallbackRect.height,
      }
    : undefined;
  const x = Number.isFinite(event.clientX) ? event.clientX - shellRect.left : fallbackRect ? fallbackRect.left - shellRect.left + 16 : 16;
  const y = Number.isFinite(event.clientY) ? event.clientY - shellRect.top : fallbackRect ? fallbackRect.top - shellRect.top + 16 : 16;
  state.contextMenu = {
    kind: state.currentView === 'ai' ? 'ai' : 'filter',
    sectionKey,
    ...(blockId ? { blockId } : {}),
    x,
    y,
    ...(targetRect ? { targetRect } : {}),
  };
  renderContextMenuElement(app);
}

function renderContextMenuElement(app: HTMLElement): void {
  closeReaderContextPopover(app, false);
  const menu = state.contextMenu;
  if (!menu) {
    return;
  }
  const filtering = state.search.filterEnabled && state.search.submittedQuery.trim().length > 0;
  const root = app.querySelector<HTMLElement>('.viewer-shell') ?? app;
  root.classList.add('is-context-menu-open');
  if (menu.kind === 'ai' && menu.blockId) {
    const target = root
      .querySelector<HTMLElement>(`.reader-block[data-section-key="${cssEscape(menu.sectionKey)}"][data-block-id="${cssEscape(menu.blockId)}"]`)
    target?.classList.add('is-context-menu-target');
  }
  const backdrop = document.createElement('div');
  backdrop.className = 'hvy-context-popover-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  if (menu.targetRect) {
    applyBackdropTargetRect(backdrop, menu.targetRect);
    ['top', 'left', 'right', 'bottom', 'target'].forEach((part) => {
      const panel = document.createElement('div');
      panel.className = `hvy-context-popover-backdrop-${part}`;
      backdrop.append(panel);
    });
  }
  const target = menu.blockId
    ? root.querySelector<HTMLElement>(`.reader-block[data-section-key="${cssEscape(menu.sectionKey)}"][data-block-id="${cssEscape(menu.blockId)}"]`)
    : null;
  const clone = menu.kind === 'ai' && target && menu.targetRect ? cloneContextMenuTarget(target, menu.targetRect) : null;
  const popover = document.createElement('section');
  popover.className = 'hvy-context-popover';
  popover.setAttribute('aria-label', menu.kind === 'ai' ? 'Component options' : 'Filter options');
  popover.style.left = `${menu.x}px`;
  popover.style.top = `${menu.y}px`;

  const addButton = (label: string, action: string): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    popover.append(button);
  };

  if (menu.kind === 'ai') {
    addButton('Edit component', 'edit-context-component');
    addButton('Request changes', 'request-context-component-changes');
    if (filtering) {
      addButton('Clear filtering', 'clear-target-filtering');
    }
  } else {
    addButton('Clear filtering', 'clear-target-filtering');
  }
  root.append(backdrop, ...(clone ? [clone] : []), popover);
  const position = placeContextMenuPopover(root, popover, menu.x, menu.y);
  menu.x = position.x;
  menu.y = position.y;
}

export function closeReaderContextPopover(app: HTMLElement, clearState = true): void {
  if (clearState) {
    state.contextMenu = null;
  }
  app.querySelector('.viewer-shell')?.classList.remove('is-context-menu-open');
  app.querySelectorAll('.reader-block.is-context-menu-target').forEach((element) => {
    element.classList.remove('is-context-menu-target');
  });
  app.querySelector('.hvy-context-popover-clone')?.remove();
  app.querySelector('.hvy-context-popover')?.remove();
  app.querySelector('.hvy-context-popover-backdrop')?.remove();
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function applyBackdropTargetRect(backdrop: HTMLElement, rect: NonNullable<typeof state.contextMenu>['targetRect']): void {
  if (!rect) {
    return;
  }
  backdrop.style.setProperty('--hvy-context-target-left', `${rect.left}px`);
  backdrop.style.setProperty('--hvy-context-target-top', `${rect.top}px`);
  backdrop.style.setProperty('--hvy-context-target-width', `${rect.width}px`);
  backdrop.style.setProperty('--hvy-context-target-height', `${rect.height}px`);
}

function placeContextMenuPopover(root: HTMLElement, popover: HTMLElement, x: number, y: number): { x: number; y: number } {
  const margin = 8;
  const rootRect = root.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const rootWidth = root.clientWidth || rootRect.width;
  const rootHeight = root.clientHeight || rootRect.height;
  const popoverWidth = popoverRect.width;
  const popoverHeight = popoverRect.height;
  const tightHorizontalSpace = rootWidth <= 520 || popoverWidth + margin * 2 > rootWidth;
  const maxX = Math.max(margin, rootWidth - popoverWidth - margin);
  const maxY = Math.max(margin, rootHeight - popoverHeight - margin);
  const nextX = tightHorizontalSpace ? Math.max(margin, (rootWidth - popoverWidth) / 2) : Math.min(Math.max(x, margin), maxX);
  const nextY = popoverHeight + margin * 2 > rootHeight ? Math.max(margin, (rootHeight - popoverHeight) / 2) : Math.min(Math.max(y, margin), maxY);
  popover.style.left = `${Math.round(nextX)}px`;
  popover.style.top = `${Math.round(nextY)}px`;
  return { x: Math.round(nextX), y: Math.round(nextY) };
}

function cloneContextMenuTarget(target: HTMLElement, rect: NonNullable<typeof state.contextMenu>['targetRect']): HTMLElement | null {
  if (!rect) {
    return null;
  }
  const clone = target.cloneNode(true) as HTMLElement;
  clone.classList.add('hvy-context-popover-clone');
  clone.classList.add('hvy-surface');
  clone.classList.remove('is-context-menu-target');
  clone.setAttribute('aria-hidden', 'true');
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((element) => {
    element.removeAttribute('id');
  });
  clone.querySelectorAll('input, textarea, select, button, a, [tabindex]').forEach((element) => {
    element.setAttribute('tabindex', '-1');
  });
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.margin = '0';
  return clone;
}
