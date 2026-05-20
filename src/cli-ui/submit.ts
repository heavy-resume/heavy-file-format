import { executeHvyCliCommand } from '../cli-core/commands';
import type { AppState } from '../types';

export async function submitCliCommand(params: {
  state: AppState;
  command: string;
  recordHistory: (label: string) => void;
  refreshReaderPanels: () => void;
}): Promise<void> {
  const command = params.command.trim();
  if (!command) {
    return;
  }
  try {
    if (isMutatingCliCommand(command)) {
      params.recordHistory(`cli:${command}`);
    }
    const result = await executeHvyCliCommand(params.state.document, params.state.cliSession, command);
    if (result.mutated) {
      params.refreshReaderPanels();
    }
    params.state.cliSession.cwd = result.cwd;
    params.state.cliHistory.push({ cwd: params.state.cliSession.cwd, command, output: result.output, error: false });
  } catch (error) {
    params.state.cliHistory.push({
      cwd: params.state.cliSession.cwd,
      command,
      output: error instanceof Error ? error.message : 'Command failed.',
      error: true,
    });
  }
  params.state.cliDraft = '';
  params.state.cliHistory = params.state.cliHistory.slice(-80);
}

function isMutatingCliCommand(command: string): boolean {
  return /^\s*(?:sed|db-table\s+exec)(?:\s|$)/.test(command);
}
