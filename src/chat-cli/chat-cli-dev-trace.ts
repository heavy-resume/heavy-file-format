export function createChatCliTraceRunId(): string {
  return `chat-cli-${crypto.randomUUID()}`;
}

export async function writeChatCliUserQueryTrace(runId: string, query: string, signal?: AbortSignal): Promise<void> {
  await writeChatCliTraceEvent(runId, { event: 'ai_cli_user_query', query }, signal);
}

export async function writeChatCliCommandTrace(runId: string, command: string, output: string, signal?: AbortSignal): Promise<void> {
  await writeChatCliTraceEvent(runId, { event: 'ai_cli_command', command, output }, signal);
}

async function writeChatCliTraceEvent(runId: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return;
  }
  try {
    await fetch('/api/agent-trace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        runId,
        phase: 'document-edit',
        type: 'client_event',
        payload,
      }),
      signal,
    });
  } catch {
    // Developer trace logging is best-effort and must never block editing.
  }
}
