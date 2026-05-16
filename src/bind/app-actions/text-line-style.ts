import { recordHistory } from '../../history';
import { state, getRenderApp, getRefreshReaderPanels } from '../../state';
import { getTextLineStylesFromMeta, writeTextLineStylesToMeta } from '../../text-line-styles';
import type { AppActionHandler } from './types';

const textLineStyleAdd: AppActionHandler = () => {
  recordHistory('meta:text-line-style:add');
  const styles = getTextLineStylesFromMeta(state.document.meta);
  let index = 0;
  let name = 'indented';
  while (styles[name]) {
    index += 1;
    name = `indented-${index + 1}`;
  }
  styles[name] = {
    label: index === 0 ? 'Indented' : `Indented ${index + 1}`,
    css: 'margin: 0.25rem 0; padding-left: 1rem;',
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
