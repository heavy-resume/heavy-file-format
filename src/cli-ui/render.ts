import './cli-view.css';
import { getHvyCliCommandSummary } from '../cli-core/commands';
import type { HvyCliHistoryEntry } from '../types';

export function renderCliView(params: {
  cwd: string;
  draft: string;
  history: HvyCliHistoryEntry[];
  escapeHtml: (value: string) => string;
  escapeAttr: (value: string) => string;
}): string {
  const history = params.history.length > 0
    ? params.history
        .map((entry) => {
          const outputClass = entry.error ? ' cli-error' : '';
          return `<div class="cli-line"><span class="cli-prompt">${params.escapeHtml(entry.cwd)} $</span> ${params.escapeHtml(entry.command)}${
            entry.output ? `\n<span class="${outputClass.trim()}">${params.escapeHtml(entry.output)}</span>` : ''
          }</div>`;
        })
        .join('')
    : `<div class="cli-line"><span class="cli-prompt">/ $</span> man ls</div>`;
  const commandSummary = getHvyCliCommandSummary();
  return `
    <div class="cli-shell">
      <aside class="cli-command-summary" aria-label="Allowed CLI commands">${params.escapeHtml(commandSummary)}</aside>
      <div id="cliOutput" class="cli-output" aria-live="polite">${history}</div>
      <form id="cliComposer" class="cli-form">
        <code>${params.escapeHtml(params.cwd)} $</code>
        <input id="cliInput" class="cli-input" name="cli-command" data-field="cli-command" value="${params.escapeAttr(params.draft)}" autocomplete="off" spellcheck="false" aria-label="CLI command" autofocus />
        <button type="submit" class="secondary">Run</button>
      </form>
    </div>
  `;
}
