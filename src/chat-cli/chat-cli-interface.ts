import {
  createHvyCliSession,
  executeHvyCliCommand,
  getHvyCliCommandSummary,
  type HvyCliExecution,
  type HvyCliSession,
} from '../cli-core/commands';
import type { VisualDocument } from '../types';
import { buildChatCliPersistentInstructions } from './chat-cli-instructions';

export interface ChatCliCommandResult extends HvyCliExecution {
  command: string;
}

export interface ChatCliSnapshot {
  cwd: string;
  commandSummary: string;
  persistentInstructions: string;
  scratchpad: string;
}

export interface ChatCliInterface {
  readonly persistentInstructions: string;
  readonly session: HvyCliSession;
  run(command: string): Promise<ChatCliCommandResult>;
  snapshot(): ChatCliSnapshot;
}

export function createChatCliInterface(document: VisualDocument, session: HvyCliSession = createHvyCliSession()): ChatCliInterface {
  const persistentInstructions = buildChatCliPersistentInstructions();
  return {
    persistentInstructions,
    session,
    async run(command: string): Promise<ChatCliCommandResult> {
      const result = await executeHvyCliCommand(document, session, command);
      return { command, ...result };
    },
    snapshot(): ChatCliSnapshot {
      return {
        cwd: session.cwd,
        commandSummary: getHvyCliCommandSummary(),
        persistentInstructions,
        scratchpad: session.scratchpadContent ?? '',
      };
    },
  };
}
