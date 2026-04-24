import { requestProxyCompletion } from './chat';
import {
  DbTableAiSummary,
  executeDbTableQueryTool,
  executeDbTableWriteSql,
  getDbTableAiSummary,
} from './plugins/db-table';
import { DB_TABLE_PLUGIN_ID } from './plugins/registry';
import { serializeBlockFragment } from './serialization';
import type { ChatMessage, ChatSettings, VisualDocument } from './types';
import type { VisualBlock } from './editor/types';
import type { AiEditRequestResult } from './ai-edit';
import { parseAiBlockEditResponse } from './ai-edit';

export const AI_DB_TABLE_EDIT_MAX_STEPS = 6;

type DbTableEditTool =
  | { tool: 'query_db_table'; query?: string; limit?: number; reason?: string }
  | { tool: 'execute_sql'; sql: string; reason?: string }
  | { tool: 'edit_fragment'; hvy: string; summary?: string }
  | { tool: 'done'; summary?: string };

export function isDbTablePluginBlock(block: VisualBlock): boolean {
  return block.schema.component === 'plugin' && block.schema.plugin === DB_TABLE_PLUGIN_ID;
}

export function buildDbTableEditFormatInstructions(tableName: string): string {
  return [
    'You are revising a `db-table` plugin component. The component renders rows from a SQLite table attached to the HVY document.',
    'Editing *data* in the table means running SQL against the attached database, not changing the HVY fragment.',
    'Editing the component\'s *configuration* (the stored SQL query, queryLimit, queryDynamicWindow, etc.) means returning a new HVY fragment.',
    '',
    'Reply with exactly one JSON object and nothing else. Do not wrap it in Markdown.',
    'Choose one tool at a time.',
    `Valid tools are: \`query_db_table\`, \`execute_sql\`, \`edit_fragment\`, \`done\`.`,
    `The target table is \`${tableName}\`.`,
    '',
    '- `query_db_table` runs a read-only SELECT (or table_name-only fetch) so you can inspect live rows before acting. Capped at 25 rows.',
    '- `execute_sql` runs a write statement (INSERT / UPDATE / DELETE / ALTER / CREATE / REPLACE / etc.) against the attached DB. Use it to change data or schema. SELECT is rejected here.',
    '- `edit_fragment` finishes the turn by returning a replacement HVY fragment for the component (use this when the user asked to change the stored query, limits, or other plugin config). The `hvy` value must be a single HVY `plugin` directive fragment matching the existing component shape.',
    '- `done` finishes the turn without changing the HVY fragment. Use this when you only mutated data via SQL.',
    '',
    'Tool shapes:',
    '{"tool":"query_db_table","query":"SELECT * FROM ' + tableName + ' WHERE status = \\"Open\\"","limit":10,"reason":"optional"}',
    '{"tool":"execute_sql","sql":"UPDATE ' + tableName + ' SET status = \'Done\' WHERE id = 3","reason":"optional"}',
    '{"tool":"edit_fragment","hvy":"<!--hvy:plugin {\\"plugin\\":\\"dev.heavy.db-table\\",\\"pluginConfig\\":{...}}-->","summary":"Updated stored query"}',
    '{"tool":"done","summary":"Short summary of what changed."}',
  ].join('\n');
}

export function buildDbTableEditContext(params: {
  document: VisualDocument;
  fragment: string;
  summary: DbTableAiSummary;
}): string {
  const { summary } = params;
  const schemaLines = summary.schema.length === 0
    ? '(schema unavailable — the table may not exist yet)'
    : summary.schema
        .map((column) => `- ${column.name} ${column.type || 'TEXT'}${column.pk ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}`)
        .join('\n');
  const sampleHeader = summary.schema.map((column) => column.name).join(' | ') || '(no columns)';
  const sampleBody = summary.sampleRows.length === 0
    ? '(no rows)'
    : summary.sampleRows.map((row) => row.map((cell) => cell.replaceAll('\n', '\\n')).join(' | ')).join('\n');
  return [
    'Selected db-table plugin component.',
    `Table name: ${summary.tableName}`,
    `Total rows: ${summary.totalRows}${summary.activeQuery ? ' (filtered by the component\'s stored query)' : ''}`,
    summary.activeQuery ? `Active stored query: ${summary.activeQuery}` : 'Active stored query: (none — rendering all rows)',
    '',
    'Column schema:',
    schemaLines,
    '',
    `Sample rows (first ${summary.sampleRows.length} shown):`,
    sampleHeader,
    sampleBody,
    '',
    'Current component HVY (plugin fragment):',
    params.fragment,
  ].join('\n');
}

export function parseDbTableEditToolRequest(source: string): { ok: true; value: DbTableEditTool } | { ok: false; message: string } {
  const cleaned = source.trim().replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'Return a single JSON object.' };
    }
    const tool = parsed.tool;
    if (tool === 'query_db_table') {
      return {
        ok: true,
        value: {
          tool: 'query_db_table',
          query: typeof parsed.query === 'string' ? parsed.query : undefined,
          limit: Number.isInteger(parsed.limit) ? Number(parsed.limit) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'execute_sql' && typeof parsed.sql === 'string' && parsed.sql.trim().length > 0) {
      return {
        ok: true,
        value: {
          tool: 'execute_sql',
          sql: parsed.sql,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'edit_fragment' && typeof parsed.hvy === 'string' && parsed.hvy.trim().length > 0) {
      return {
        ok: true,
        value: {
          tool: 'edit_fragment',
          hvy: parsed.hvy,
          summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
        },
      };
    }
    if (tool === 'done') {
      return {
        ok: true,
        value: { tool: 'done', summary: typeof parsed.summary === 'string' ? parsed.summary : undefined },
      };
    }
    return { ok: false, message: 'Tool must be `query_db_table`, `execute_sql`, `edit_fragment`, or `done`.' };
  } catch {
    return { ok: false, message: 'Response was not valid JSON.' };
  }
}

export async function requestAiDbTableEdit(params: {
  settings: ChatSettings;
  document: VisualDocument;
  block: VisualBlock;
  request: string;
  onBeforeMutation?: () => void;
}): Promise<AiEditRequestResult> {
  const tableName = typeof params.block.schema.pluginConfig.table === 'string'
    ? params.block.schema.pluginConfig.table.trim()
    : '';
  if (tableName.length === 0) {
    throw new Error('This db-table component has no configured table name yet. Set a table before using AI edits.');
  }

  const storedQuery = typeof params.block.schema.pluginConfig.query === 'string'
    ? params.block.schema.pluginConfig.query
    : '';
  const summary = await getDbTableAiSummary(params.document, tableName, { activeQuery: storedQuery || undefined });
  const originalFragment = serializeBlockFragment(params.block);
  const context = buildDbTableEditContext({
    document: params.document,
    fragment: originalFragment,
    summary,
  });
  const formatInstructions = buildDbTableEditFormatInstructions(tableName);

  let mutationRecorded = false;
  const recordMutationOnce = (): void => {
    if (mutationRecorded) {
      return;
    }
    mutationRecorded = true;
    params.onBeforeMutation?.();
  };

  let conversation: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: [
        `Update the selected db-table component to satisfy this request: ${params.request}`,
        '',
        'Inspect live rows with `query_db_table` first when the request implies data awareness.',
        'Use `execute_sql` to change data or the table schema. Use `edit_fragment` only when the plugin configuration itself must change. Finish with `done` if the HVY is unchanged.',
        `You have at most ${AI_DB_TABLE_EDIT_MAX_STEPS} tool steps.`,
      ].join('\n'),
    },
  ];

  for (let iteration = 0; iteration < AI_DB_TABLE_EDIT_MAX_STEPS; iteration += 1) {
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: conversation,
      context,
      formatInstructions,
      mode: 'component-edit',
      debugLabel: `ai-db-table-edit:${iteration + 1}`,
    });

    const parsed = parseDbTableEditToolRequest(response);
    if (parsed.ok === false) {
      conversation = [
        ...conversation,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: `The previous response was invalid and no tool was executed. ${parsed.message} Reply with a single JSON tool object.`,
        },
      ];
      continue;
    }

    if (parsed.value.tool === 'done') {
      return { block: params.block, originalFragment, canonicalFragment: originalFragment };
    }

    if (parsed.value.tool === 'edit_fragment') {
      const parsedFragment = parseAiBlockEditResponse(parsed.value.hvy);
      if (!parsedFragment.block || parsedFragment.hasErrors) {
        const issueSummary = parsedFragment.issues.map((issue) => issue.message).join(' ') || 'Invalid HVY.';
        conversation = [
          ...conversation,
          { id: crypto.randomUUID(), role: 'assistant', content: response },
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: `edit_fragment produced invalid HVY: ${issueSummary} Try again.`,
          },
        ];
        continue;
      }
      recordMutationOnce();
      return {
        block: parsedFragment.block,
        originalFragment,
        canonicalFragment: parsedFragment.canonicalFragment,
      };
    }

    let toolResult: string;
    try {
      if (parsed.value.tool === 'query_db_table') {
        toolResult = await executeDbTableQueryTool(params.document, {
          tableName,
          query: parsed.value.query,
          limit: parsed.value.limit,
        });
      } else {
        recordMutationOnce();
        toolResult = await executeDbTableWriteSql(parsed.value.sql);
      }
    } catch (error) {
      toolResult = error instanceof Error ? error.message : 'Tool failed.';
    }

    conversation = [
      ...conversation,
      { id: crypto.randomUUID(), role: 'assistant', content: response },
      { id: crypto.randomUUID(), role: 'user', content: `Tool result for ${parsed.value.tool}:\n\n${toolResult}` },
    ];
  }

  throw new Error(`AI db-table edit stopped after ${AI_DB_TABLE_EDIT_MAX_STEPS} steps without finishing.`);
}

// Re-export for callers that only want this module.
export type { AiEditRequestResult };
