import chatCliPersistentInstructions from './chat-cli-persistent-instructions.txt?raw';

export function buildChatCliPersistentInstructions(): string {
  return chatCliPersistentInstructions.trim();
}
