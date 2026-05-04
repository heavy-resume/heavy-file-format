import { buildDocumentEditToolHelp } from '../ai-document-edit-instructions';
import type { JsonObject } from '../hvy/types';
import { getDocumentDbTableObjectNames } from '../plugins/db-table';
import { parseFormSpec } from '../plugins/form';
import { DB_TABLE_PLUGIN_ID, FORM_PLUGIN_ID, SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import type { VisualDocument } from '../types';

export interface HvyCliHelpCommand {
  command: string;
  description: string;
}

export interface HvyCliPluginCommandRegistration {
  name: string;
  pluginId: string;
  helpTopic: string;
  componentHints: string[];
  addCommands: HvyCliHelpCommand[];
  operationCommands: HvyCliHelpCommand[];
  helpCommands?: HvyCliHelpCommand[];
  lintChecks?: HvyCliPluginLintCheck[];
}

export interface HvyCliPluginLintContext {
  document: VisualDocument;
  path: string;
  textPath: string;
  jsonPath: string;
  config: JsonObject;
  body: string;
}

export interface HvyCliPluginLintIssue {
  message: string;
}

export type HvyCliPluginLintCheck = (context: HvyCliPluginLintContext) => HvyCliPluginLintIssue[] | Promise<HvyCliPluginLintIssue[]>;

const pluginCommandRegistrations: HvyCliPluginCommandRegistration[] = [];
const SCRIPTING_DOC_TOOL_NAMES = [
  'request_structure',
  'grep',
  'view_component',
  'get_css',
  'get_properties',
  'set_properties',
  'patch_component',
  'create_component',
  'remove_component',
  'create_section',
  'remove_section',
  'reorder_section',
  'view_header',
  'grep_header',
  'patch_header',
];

const SCRIPTING_HEADER_TOOL_HELP: Record<string, string> = {
  view_header: '{"tool":"view_header","start_line":1,"end_line":120,"reason":"optional"}',
  grep_header: '{"tool":"grep_header","query":"component_defs|skill-card","flags":"i","before":2,"after":8,"max_count":3,"reason":"optional"}',
  patch_header: '{"tool":"patch_header","edits":[{"op":"replace","start_line":2,"end_line":2,"text":"title: New title"}],"reason":"optional"}',
};

export function registerHvyCliPluginCommands(registration: HvyCliPluginCommandRegistration): void {
  const existingIndex = pluginCommandRegistrations.findIndex((entry) => entry.name === registration.name);
  if (existingIndex >= 0) {
    pluginCommandRegistrations[existingIndex] = copyRegistration(registration);
  } else {
    pluginCommandRegistrations.push(copyRegistration(registration));
  }
}

export function getHvyCliPluginCommandRegistrations(): HvyCliPluginCommandRegistration[] {
  return pluginCommandRegistrations.map(copyRegistration);
}

export function getHvyCliPluginCommandRegistration(name: string): HvyCliPluginCommandRegistration | null {
  return getHvyCliPluginCommandRegistrations().find((registration) => registration.name === name) ?? null;
}

export function getHvyCliPluginCommandRegistrationByPluginId(pluginId: string): HvyCliPluginCommandRegistration | null {
  return getHvyCliPluginCommandRegistrations().find((registration) => registration.pluginId === pluginId) ?? null;
}

export function getHvyCliScriptingToolNames(): string[] {
  return [...SCRIPTING_DOC_TOOL_NAMES];
}

export function getHvyCliScriptingToolHelp(toolName: string): string | null {
  const normalized = toolName.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (SCRIPTING_HEADER_TOOL_HELP[normalized]) {
    return SCRIPTING_HEADER_TOOL_HELP[normalized];
  }
  const lookupTopic = ['get_css', 'get_properties', 'set_properties'].includes(normalized)
    ? 'tool:css'
    : `tool:${normalized}`;
  return buildDocumentEditToolHelp(lookupTopic);
}

function copyRegistration(registration: HvyCliPluginCommandRegistration): HvyCliPluginCommandRegistration {
  return {
    ...registration,
    componentHints: [...registration.componentHints],
    addCommands: [...registration.addCommands],
    operationCommands: [...registration.operationCommands],
    helpCommands: [...(registration.helpCommands ?? [])],
    lintChecks: [...(registration.lintChecks ?? [])],
  };
}

registerHvyCliPluginCommands({
  name: 'form',
  pluginId: FORM_PLUGIN_ID,
  helpTopic: 'hvy plugin form',
  componentHints: [
    'This plugin is a form. The form fields, submit label, scripts, and on-submit behavior live in plugin.txt as form YAML/body text.',
    'Use plugin.txt for form content and plugin.json for plugin id/config metadata.',
    'Form scripts are top-level Python/Brython snippets under scripts.NAME and run through the sandboxed scripting runtime.',
    'Form scripts receive doc plus doc.form. Use doc.form.get_value/get_values/set_value/set_options/set_error/clear_error for form state.',
    'doc.tool(name, args) can call the synchronous document-edit tool subset; args are a Python dict matching the AI tool schema.',
    'When changing submit behavior, look for named scripts and on-submit script settings before editing fields.',
    'For form submit code examples, run: hvy cheatsheet scripting, hvy recipe scripting, or man hvy plugin scripting tool TOOL_NAME.',
  ],
  addCommands: [
    {
      command: 'hvy add plugin form SECTION_PATH ID SUBMIT_BUTTON_LABEL FIELD... [--script NAME PYTHON] [--on-submit-script NAME]',
      description: 'Create a Form plugin component.',
    },
  ],
  operationCommands: [],
  lintChecks: [
    (context) => {
      if (context.body.trim().length === 0) {
        return [{ message: 'form plugin body is empty; expected form YAML with fields and submit behavior.' }];
      }
      const parsed = parseFormSpec(context.body);
      if (parsed.error) {
        return [];
      }
      const script = parsed.spec.submitScript.trim();
      if (!parsed.spec.showSubmit || script.length > 0) {
        return [];
      }
      return [{ message: 'form has a submit button but no submitScript.' }];
    },
  ],
  helpCommands: [
    {
      command: '--script NAME PYTHON',
      description: 'Store a named Python script in the form YAML.',
    },
    {
      command: '--on-submit-script NAME',
      description: 'Run that named script when the submit button is pressed. Alias: --submit.',
    },
    {
      command: `Example: hvy add plugin form /chores add-chore "Add chore" "description:Description:textarea:required" --script submit "title = doc.form.get_value('description')\\ndoc.db.execute('INSERT INTO chores (title) VALUES (\\'' + title + '\\')')" --on-submit-script submit`,
      description: 'Creates a form whose submit button says "Add chore" and runs the script named submit.',
    },
    {
      command: 'See also: hvy cheatsheet scripting; hvy recipe scripting; man hvy plugin scripting tool TOOL_NAME',
      description: 'Use scripting help for doc, doc.form, doc.db, and doc.tool examples.',
    },
  ],
});

registerHvyCliPluginCommands({
  name: 'scripting',
  pluginId: SCRIPTING_PLUGIN_ID,
  helpTopic: 'hvy plugin scripting',
  componentHints: [
    'Scripting runs once when the document loads. Use it to generate, mutate, or rearrange document content programmatically.',
    'The component body is top-level Python/Brython source with one injected global: doc.',
    'Sandbox limits: imports, network, and DOM access are not allowed. Mutate the document through doc instead.',
    'Execution model: top-level return is a syntax error; return works inside helper functions. Loops count against a 100,000-line budget.',
    'doc.tool(name, args) calls a synchronous subset of document-edit tools. args is a Python dict matching the AI tool schema.',
    'Document tools: request_structure, grep, view_component, get_css, get_properties, set_properties, patch_component, create_component, remove_component, create_section, remove_section, reorder_section.',
    'Header tools: view_header, grep_header, patch_header.',
    'Not exposed through doc.tool: edit_component, view_rendered_component, query_db_table, execute_sql, and other async tools.',
    'doc.header.get/set/remove/keys reads and writes front matter.',
    'doc.attachments.list/read/write/remove works with document attachments.',
    'doc.db.query(sql, params) and doc.db.execute(sql, params) access the attached SQLite database when available.',
    'doc.cli.run(command) runs one synchronous virtual CLI command and returns stdout; use doc.db for SQL.',
    'doc.form exists only while running form plugin scripts. Use form plugin help for doc.form methods.',
    'doc.rerender() flushes pending rendering work, but scripts usually do not need it because the host rerenders after the script finishes.',
    'Example: summary = doc.tool("request_structure"); doc.header.set("script_summary", summary[:200])',
    'Example: hits = doc.tool("grep", {"query": "TODO", "flags": "i"}); doc.header.set("todo_hits", hits)',
    'For a specific doc.tool shape, run: man hvy plugin scripting tool TOOL_NAME',
  ],
  addCommands: [
    {
      command: 'hvy add plugin SECTION_PATH ID dev.heavy.scripting --config {"version":"0.1"} --body PYTHON',
      description: 'Create a scripting plugin block.',
    },
  ],
  operationCommands: [],
  lintChecks: [
    (context) => context.body.trim().length === 0
      ? [{ message: 'scripting plugin body is empty; expected Brython/Python source.' }]
      : [],
  ],
  helpCommands: [
    {
      command: 'hvy plugin scripting tool TOOL_NAME',
      description: 'Show doc.tool call shape for one scripting tool.',
    },
  ],
});

registerHvyCliPluginCommands({
  name: 'db-table',
  pluginId: DB_TABLE_PLUGIN_ID,
  helpTopic: 'hvy plugin db-table',
  componentHints: [
    'This plugin displays a SQLite table or query result.',
    'Use hvy plugin db-table tables/schema/query/exec to inspect or change the backing database.',
    'Use plugin.json when changing which table/query this component displays.',
  ],
  addCommands: [
    {
      command: 'hvy add plugin db-table SECTION_PATH ID TABLE [QUERY]',
      description: 'Create a DB Table plugin that shows a SQLite table/view with an optional SQL query. Legacy alias: db-table show/add.',
    },
  ],
  operationCommands: [
    {
      command: 'hvy plugin db-table query [SELECT/WITH SQL]',
      description: 'Run read-only SQL and print result rows.',
    },
    {
      command: 'hvy plugin db-table exec [CREATE / INSERT / UPDATE / DELETE / DROP SQL]',
      description: 'Run modifying SQL and persist the database.',
    },
    {
      command: 'hvy plugin db-table tables',
      description: 'List SQLite tables and views.',
    },
    {
      command: 'hvy plugin db-table schema [TABLE_OR_VIEW]',
      description: 'Show schema details.',
    },
  ],
  lintChecks: [
    async (context) => {
      const table = typeof context.config.table === 'string' ? context.config.table.trim() : '';
      if (table.length === 0) {
        return [{ message: 'db-table plugin is missing pluginConfig.table.' }];
      }
      const names = await getDocumentDbTableObjectNames(context.document);
      return names.includes(table)
        ? []
        : [{ message: `db-table pluginConfig.table references missing SQLite table/view "${table}".` }];
    },
  ],
});
