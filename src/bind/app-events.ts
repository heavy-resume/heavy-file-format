import { bindSharedControlEvents } from './shared-control-events';
import { setAppEventsBound } from '../state';
import { bindClickActions } from './handlers/click-actions';
import { bindChangeRaw } from './handlers/change-raw';
import { bindShortcuts } from './handlers/shortcuts';
import { bindClickDispatch } from './handlers/click-dispatch';
import { bindBeforeinput } from './handlers/beforeinput';
import { bindContextmenu } from './handlers/contextmenu';
import { bindFocus } from './handlers/focus';
import { bindDnd } from './handlers/dnd';
import { bindClickMisc } from './handlers/click-misc';
import { bindResize } from './handlers/resize';
import { bindComponentEditorModal } from '../editor/component-editor-modal';
import { bindTableGrabberInsertMenus } from '../editor/components/table/table-grabber-insert-menu';

const boundAppRoots = new WeakSet<HTMLElement>();

export function bindAppEvents(app: HTMLElement): void {
  bindComponentEditorModal(app);
  if (boundAppRoots.has(app)) {
    bindShortcuts(app);
    return;
  }

  bindClickActions(app);
  bindSharedControlEvents(app);
  bindChangeRaw(app);
  bindShortcuts(app);
  bindClickDispatch(app);
  bindBeforeinput(app);
  bindContextmenu(app);
  bindFocus(app);
  bindDnd(app);
  bindClickMisc(app);
  bindResize(app);
  bindTableGrabberInsertMenus(app);

  boundAppRoots.add(app);
  setAppEventsBound(true);
}
