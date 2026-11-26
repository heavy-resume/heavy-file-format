import { state } from '../state';
import { recordHistory } from '../history';
import { visitBlocks } from '../section-ops';
import {
  getTextLineStyleLabel,
  getTextLineStylesFromMeta,
  replaceTextLineStyleMarkerName,
  TEXT_LINE_STYLE_NAME_PATTERN,
  writeTextLineStylesToMeta,
} from '../text-line-styles';

/** Rename references without replacing an active metadata input or rich editor. */
export function renameTextLineStyleFromInput(root: HTMLElement, input: HTMLInputElement): void {
  const oldName = input.dataset.styleName ?? '';
  const newName = input.value.trim();
  if (!oldName || !newName || oldName === newName || !TEXT_LINE_STYLE_NAME_PATTERN.test(newName)) return;
  const styles = getTextLineStylesFromMeta(state.document.meta);
  if (styles[newName]) return;
  recordHistory(`meta:text-line-style:rename:${oldName}`);
  styles[newName] = styles[oldName] ?? { label: '', css: '' };
  delete styles[oldName];
  writeTextLineStylesToMeta(state.document.meta, styles);
  visitBlocks(state.document.sections, (block) => {
    block.text = replaceTextLineStyleMarkerName(block.text, oldName, newName);
  });
  state.openTextLineStyleName = newName;
  state.paragraphStyleRecentNames = state.paragraphStyleRecentNames.map((name) => name === oldName ? newName : name);
  const label = getTextLineStyleLabel(newName, styles[newName]);
  for (const attribute of ['data-style-name', 'data-text-line-style-name', 'data-edit-style-name', 'data-hvy-text-line-style']) {
    root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((node) => {
      if (node.getAttribute(attribute) !== oldName) return;
      node.setAttribute(attribute, newName);
      if (node.matches('[data-field="text-line-style-name"]') && node !== input) {
        (node as HTMLInputElement).value = newName;
      }
      if (node.matches('[data-action="remove-text-line-style"]')) node.setAttribute('aria-label', `Remove ${newName}`);
      if (node.matches('[data-field="text-line-style-label"]')) node.setAttribute('placeholder', newName);
      if (node.matches('[data-rich-action="text-line-style"]')) node.title = `Apply ${label}`;
      node.querySelectorAll<HTMLElement>('[data-text-line-style-sample-label], .text-line-style-pill-sample').forEach((sample) => {
        sample.textContent = label;
      });
      if (node.matches('.text-line-style-row')) {
        const summaryName = node.querySelector(':scope > summary .template-def-summary-text > span');
        if (summaryName) summaryName.textContent = newName;
      }
      if (node.matches('[data-edit-style-name]')) {
        const titleLabel = node.querySelector('.paragraph-style-edit-title > span');
        const titleName = node.querySelector('.paragraph-style-edit-title > code');
        if (titleLabel) titleLabel.textContent = label;
        if (titleName) titleName.textContent = newName;
      }
      if (node.matches('[data-hvy-text-line-style]')) {
        node.dataset.hvyTextLineStyleLabel = label;
        const marker = node.querySelector(':scope > .hvy-text-line-style-marker');
        if (marker) marker.textContent = `^${newName}^`;
      }
    });
  }
}
