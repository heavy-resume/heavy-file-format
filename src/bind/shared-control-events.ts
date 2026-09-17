import { bindInputBlock } from './handlers/input-block';
import { bindInputMisc } from './handlers/input-misc';
import { bindChangeControls } from './handlers/change-controls';
import { bindSubmit } from './handlers/submit';
import { bindKeydown } from './handlers/keydown';
import { bindScrollHandler } from './handlers/scroll';

const boundControlRoots = new WeakSet<HTMLElement>();

/** Reader and editor surfaces share a root when the host changes document views. */
export function bindSharedControlEvents(app: HTMLElement): void {
  if (boundControlRoots.has(app)) return;
  boundControlRoots.add(app);
  bindInputBlock(app);
  bindInputMisc(app);
  bindChangeControls(app);
  bindSubmit(app);
  bindKeydown(app);
  bindScrollHandler(app);
}
