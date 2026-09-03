import './delete-control.css';

import { closeIcon } from '../../../icons';
import { escapeAttr } from '../../../utils';

interface DeleteControlOptions {
  label: string;
  title: string;
  className?: string;
  attributes?: Record<`data-${string}`, string>;
}

export function renderDeleteControl(options: DeleteControlOptions): string {
  const classes = ['danger', 'hvy-delete-control', options.className].filter(Boolean).join(' ');
  const attributes = Object.entries(options.attributes ?? {}).map(([name, value]) => {
    if (!/^data-[a-z0-9-]+$/.test(name)) {
      throw new Error(`Invalid delete control attribute: ${name}`);
    }
    return `${name}="${escapeAttr(value)}"`;
  }).join(' ');
  return `<button type="button" class="${escapeAttr(classes)}" ${attributes} aria-label="${escapeAttr(options.label)}" title="${escapeAttr(options.title)}">${closeIcon()}</button>`;
}
