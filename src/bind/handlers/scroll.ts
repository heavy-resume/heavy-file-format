import { getRenderApp, handleDbTableFrameScroll } from './_imports';
import { handleResponsiveSidebarTabScroll, revealHiddenSidebarTabFromCorner } from '../../responsive-sidebar-tab';

export function bindScrollHandler(app: HTMLElement): void {
  app.addEventListener('pointerdown', (event) => {
    revealHiddenSidebarTabFromCorner(event.target as HTMLElement | null, event);
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
