import { HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS, buildChatDocumentContext, requestProxyCompletion } from './chat/chat';
import { executeDbTableQueryTool, getDocumentDbTableObjectNames } from './plugins/db-table';
import type { ChatMessage, ChatSettings, VisualDocument } from './types';

export const QA_TOOL_LOOP_MAX_STEPS = 4;

type QaToolRequest =
  | { tool: 'answer'; answer: string }
  | { tool: 'query_db_table'; table_name?: string; query?: string; limit?: number; reason?: string };

export function buildQaToolLoopFormatInstructions(dbTableNames: string[]): string {
  return [
    'You are answering a question about the current HVY document.',
    'You have read-only access to the attached DB via the `query_db_table` tool. Do not issue write statements.',
    `Available SQLite tables/views: ${dbTableNames.join(', ')}.`,
    '',
    'Reply with exactly one JSON object and nothing else. Do not wrap it in Markdown.',
    'Choose one tool at a time.',
    'Valid tools are: `query_db_table`, `answer`.',
    'Use `query_db_table` when you need live row data before answering. Provide `table_name` when more than one table exists, or provide a full SQL `query` (SELECT only). `limit` is optional and is capped for concise tool output.',
    'Use `answer` to return the final HVY-formatted response to the user. The `answer` value must follow the HVY response formatting rules below.',
    '',
    'Tool shapes:',
    '{"tool":"query_db_table","table_name":"work_items","limit":10,"reason":"optional"}',
    '{"tool":"query_db_table","query":"SELECT company, status FROM work_items WHERE status != \\"Rejected\\" ORDER BY company","limit":10,"reason":"optional"}',
    '{"tool":"answer","answer":"<HVY-formatted response as a JSON string>"}',
    '',
    '--- HVY response formatting rules (apply to the `answer` field) ---',
    HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS,
  ].join('\n');
}

export function parseQaToolRequest(source: string): { ok: true; value: QaToolRequest } | { ok: false; message: string } {
  const cleaned = source.trim().replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'Return a single JSON object.' };
    }
    const tool = parsed.tool;
    if (tool === 'answer' && typeof parsed.answer === 'string') {
      return { ok: true, value: { tool: 'answer', answer: parsed.answer } };
    }
    if (tool === 'query_db_table') {
      return {
        ok: true,
        value: {
          tool: 'query_db_table',
          table_name: typeof parsed.table_name === 'string' ? parsed.table_name : undefined,
          query: typeof parsed.query === 'string' ? parsed.query : undefined,
          limit: Number.isInteger(parsed.limit) ? Number(parsed.limit) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    return { ok: false, message: 'Tool must be `query_db_table` or `answer`.' };
  } catch {
    return { ok: false, message: 'Response was not valid JSON.' };
  }
}

export function assertReadOnlyQuery(query: string | undefined): void {
  if (!query) {
    return;
  }
  const stripped = stripSqlLeadingWhitespaceAndComments(query);
  const leadingToken = stripped.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
  if (leadingToken !== 'SELECT' && leadingToken !== 'WITH') {
    throw new Error('query_db_table only accepts read-only SELECT statements in QA mode.');
  }
}

function stripSqlLeadingWhitespaceAndComments(source: string): string {
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      cursor += 1;
      continue;
    }
    if (source.startsWith('--', cursor)) {
      const newlineIndex = source.indexOf('\n', cursor);
      cursor = newlineIndex === -1 ? source.length : newlineIndex + 1;
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      const closeIndex = source.indexOf('*/', cursor + 2);
      cursor = closeIndex === -1 ? source.length : closeIndex + 2;
      continue;
    }
    break;
  }
  return source.slice(cursor);
}

export async function runQaToolLoop(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
  question: string;
  signal?: AbortSignal;
}): Promise<string> {
  const dbTableNames = await getDocumentDbTableObjectNames(params.document);
  if (dbTableNames.length === 0) {
    throw new Error('runQaToolLoop requires at least one SQLite table or view. Use requestChatCompletion for non-DB documents.');
  }

  const context = buildChatDocumentContext(params.document);
  if (context.trim().length === 0) {
    throw new Error('The document body is empty after removing front matter and comments.');
  }

  const formatInstructions = buildQaToolLoopFormatInstructions(dbTableNames);
  let conversation: ChatMessage[] = [...params.messages];

  for (let iteration = 0; iteration < QA_TOOL_LOOP_MAX_STEPS; iteration += 1) {
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: conversation,
      context,
      formatInstructions,
      mode: 'qa',
      debugLabel: `ai-qa:${iteration + 1}`,
      signal: params.signal,
    });

    const parsed = parseQaToolRequest(response);
    if (parsed.ok === false) {
      conversation = [
        ...conversation,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: `Return a single valid JSON tool object. ${parsed.message}`,
        },
      ];
      continue;
    }

    if (parsed.value.tool === 'answer') {
      return parsed.value.answer.trim();
    }

    let toolResult: string;
    try {
      assertReadOnlyQuery(parsed.value.query);
      toolResult = await executeDbTableQueryTool(params.document, {
        tableName: parsed.value.table_name,
        query: parsed.value.query,
        limit: parsed.value.limit,
      });
    } catch (error) {
      toolResult = error instanceof Error ? error.message : 'query_db_table failed.';
    }

    conversation = [
      ...conversation,
      { id: crypto.randomUUID(), role: 'assistant', content: response },
      { id: crypto.randomUUID(), role: 'user', content: `Tool result for query_db_table:\n\n${toolResult}` },
    ];
  }

  throw new Error(`QA tool loop stopped after ${QA_TOOL_LOOP_MAX_STEPS} steps without an answer.`);
}
