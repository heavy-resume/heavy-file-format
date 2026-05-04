import {
  createHvyCliSession,
  executeHvyCliCommand,
  getHvyCliCommandSummary,
  type HvyCliExecution,
  type HvyCliSession,
} from '../cli-core/commands';
import type { VisualDocument } from '../types';

export interface ChatCliCommandResult extends HvyCliExecution {
  command: string;
}

export interface ChatCliSnapshot {
  cwd: string;
  commandSummary: string;
  scratchpad: string;
  scratchpadCommandsSinceEdit: string[];
}

export interface ChatCliInterface {
  readonly session: HvyCliSession;
  run(command: string): Promise<ChatCliCommandResult>;
  snapshot(): ChatCliSnapshot;
}

export function createChatCliInterface(document: VisualDocument, session: HvyCliSession = createHvyCliSession()): ChatCliInterface {
  return {
    session,
    async run(command: string): Promise<ChatCliCommandResult> {
      const result = await executeHvyCliCommand(document, session, command);
      return { command, ...result };
    },
    snapshot(): ChatCliSnapshot {
      return {
        cwd: session.cwd,
        commandSummary: getHvyCliCommandSummary(),
        scratchpad: session.scratchpadContent ?? '',
        scratchpadCommandsSinceEdit: session.scratchpadCommandsSinceEdit ?? [],
      };
    },
  };
}
