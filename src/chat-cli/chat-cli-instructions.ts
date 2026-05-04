const CHAT_CLI_STARTER_INSTRUCTIONS = [
  'You are editing an HVY document through a virtual filesystem.',
  'The filesystem is the workspace that will become one .hvy file.',
  '/scratchpad.txt contains your ephemeral task notes.',
  'Use shell commands and `help` or `man` to discover the interface.',
];

export function buildChatCliInstructions(): string {
  return CHAT_CLI_STARTER_INSTRUCTIONS.join('\n');
}
