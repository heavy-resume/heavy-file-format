import { getRenderApp, handleDbTableFrameScroll, state } from './_imports';
import { handleResponsiveSidebarTabScroll, peekHiddenSidebarTabFromCorner, revealHiddenSidebarTabFromCorner } from '../../responsive-sidebar-tab';

export function bindScrollHandler(app: HTMLElement): void {
  let touchY: number | null = null;

  app.addEventListener('wheel', (event) => {
    markActiveEditorScrollDirection(event.target, event.deltaY);
  }, { capture: true, passive: true });

  app.addEventListener('touchstart', (event) => {
    touchY = event.touches[0]?.clientY ?? null;
  }, { capture: true, passive: true });

  app.addEventListener('touchmove', (event) => {
    const nextY = event.touches[0]?.clientY ?? null;
    if (touchY !== null && nextY !== null) {
      markActiveEditorScrollDirection(event.target, touchY - nextY);
    }
    touchY = nextY;
  }, { capture: true, passive: true });

  app.addEventListener('touchend', () => {
    touchY = null;
  }, { capture: true, passive: true });

  app.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'End' || (event.key === ' ' && !event.shiftKey)) {
      markActiveEditorScrollDirection(event.target, 1);
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home' || (event.key === ' ' && event.shiftKey)) {
      markActiveEditorScrollDirection(event.target, -1);
    }
  }, true);

  app.addEventListener('pointerdown', (event) => {
    revealHiddenSidebarTabFromCorner(event.target as HTMLElement | null, event);
  });

  app.addEventListener('pointermove', (event) => {
    peekHiddenSidebarTabFromCorner(event.target as HTMLElement | null, event);
  });

  app.addEventListener('scroll', (event) => {
    const target = event.target as HTMLElement | null;
    handleResponsiveSidebarTabScroll(target);
    const frame = target?.closest<HTMLElement>('[data-db-table-frame="true"]');
    if (!frame) {
      return;
    }
    if (!handleDbTableFrameScroll(frame)) {
      return;
    }
    getRenderApp()();
  }, true);
}

function markActiveEditorScrollDirection(target: EventTarget | null, deltaY: number): void {
  if (!state.activeEditorBlock || deltaY === 0 || !(target instanceof Element)) {
    return;
  }
  const scrollContainer = target.closest<HTMLElement>(
    '.editor-shell .editor-tree, .editor-sidebar-panel, .reader-document, .viewer-sidebar-panel'
  );
  if (!scrollContainer) {
    return;
  }
  if (deltaY > 0 && scrollContainer.dataset.activeEditorUserScrollDirection !== 'down') {
    scrollContainer.dataset.activeEditorUserScrollStartTop = String(scrollContainer.scrollTop);
  } else if (deltaY < 0) {
    delete scrollContainer.dataset.activeEditorUserScrollStartTop;
  }
  scrollContainer.dataset.activeEditorUserScrollDirection = deltaY > 0 ? 'down' : 'up';
}
