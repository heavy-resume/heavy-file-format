import { setAppEventsBound } from '../state';
import { bindScrollHandler } from './handlers/scroll';
import { bindInputBlock } from './handlers/input-block';
import { bindChangeControls } from './handlers/change-controls';
import { bindClickActions } from './handlers/click-actions';
import { bindChangeRaw } from './handlers/change-raw';
import { bindSubmit } from './handlers/submit';
import { bindShortcuts } from './handlers/shortcuts';
import { bindClickDispatch } from './handlers/click-dispatch';
import { bindKeydown } from './handlers/keydown';
import { bindBeforeinput } from './handlers/beforeinput';
import { bindContextmenu } from './handlers/contextmenu';
import { bindInputMisc } from './handlers/input-misc';
import { bindFocus } from './handlers/focus';
import { bindDnd } from './handlers/dnd';
import { bindClickMisc } from './handlers/click-misc';
import { bindResize } from './handlers/resize';

const boundAppRoots = new WeakSet<HTMLElement>();

export function bindAppEvents(app: HTMLElement): void {
  if (boundAppRoots.has(app)) {
    bindShortcuts(app);
    return;
  }

  bindScrollHandler(app);
  bindInputBlock(app);
  bindChangeControls(app);
  bindClickActions(app);
  bindChangeRaw(app);
  bindSubmit(app);
  bindShortcuts(app);
  bindClickDispatch(app);
  bindKeydown(app);
  bindBeforeinput(app);
  bindContextmenu(app);
  bindInputMisc(app);
  bindFocus(app);
  bindDnd(app);
  bindClickMisc(app);
  bindResize(app);

  boundAppRoots.add(app);
  setAppEventsBound(true);
}
