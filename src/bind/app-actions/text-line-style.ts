import { recordHistory } from '../../history';
import { state, getRenderApp, getRefreshReaderPanels } from '../../state';
import { getTextLineStylesFromMeta, writeTextLineStylesToMeta } from '../../text-line-styles';
import type { AppActionHandler } from './types';

const textLineStyleAdd: AppActionHandler = () => {
  recordHistory('meta:text-line-style:add');
  const styles = getTextLineStylesFromMeta(state.document.meta);
  let index = 1;
  let name = `style-${index}`;
  while (styles[name]) {
    index += 1;
    name = `style-${index}`;
  }
  styles[name] = {
    label: `Style ${index}`,
    css: 'margin: 0.25rem 0;',
  };
  writeTextLineStylesToMeta(state.document.meta, styles);
  getRenderApp()();
};

const textLineStyleRemove: AppActionHandler = ({ actionButton }) => {
  const name = actionButton.dataset.styleName ?? '';
  if (!name) return;
  recordHistory(`meta:text-line-style:remove:${name}`);
  const styles = getTextLineStylesFromMeta(state.document.meta);
  delete styles[name];
  writeTextLineStylesToMeta(state.document.meta, styles);
  getRefreshReaderPanels()();
  getRenderApp()();
};

export const textLineStyleActions: Record<string, AppActionHandler> = {
  'add-text-line-style': textLineStyleAdd,
  'remove-text-line-style': textLineStyleRemove,
};

