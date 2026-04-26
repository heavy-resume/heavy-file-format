import { state } from './_imports';

export function bindResize(app: HTMLElement): void {
  app.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const head = target?.closest<HTMLElement>('.ai-edit-popover-head');
    if (!head) {
      return;
    }
    if (target?.closest('button, input, select, textarea, a')) {
      return;
    }
    const popover = head.closest<HTMLElement>('.ai-edit-popover');
    if (!popover) {
      return;
    }

    event.preventDefault();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startPopupX = state.aiEdit.popupX;
    const startPopupY = state.aiEdit.popupY;

    const clamp = (x: number, y: number): { x: number; y: number } => {
      const maxX = Math.max(0, window.innerWidth - popover.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - popover.offsetHeight);
      return {
        x: Math.min(Math.max(x, 0), maxX),
        y: Math.min(Math.max(y, 0), maxY),
      };
    };

    const onMove = (moveEvent: MouseEvent): void => {
      const next = clamp(
        startPopupX + (moveEvent.clientX - startClientX),
        startPopupY + (moveEvent.clientY - startClientY)
      );
      popover.style.left = `${next.x}px`;
      popover.style.top = `${next.y}px`;
    };

    const onUp = (upEvent: MouseEvent): void => {
      const next = clamp(
        startPopupX + (upEvent.clientX - startClientX),
        startPopupY + (upEvent.clientY - startClientY)
      );
      state.aiEdit.popupX = next.x;
      state.aiEdit.popupY = next.y;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
