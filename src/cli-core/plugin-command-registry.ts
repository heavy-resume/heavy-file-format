import { DB_TABLE_PLUGIN_ID, FORM_PLUGIN_ID } from '../plugins/registry';

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
}

const pluginCommandRegistrations: HvyCliPluginCommandRegistration[] = [];

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

function copyRegistration(registration: HvyCliPluginCommandRegistration): HvyCliPluginCommandRegistration {
  return {
    ...registration,
    componentHints: [...registration.componentHints],
    addCommands: [...registration.addCommands],
    operationCommands: [...registration.operationCommands],
  };
}

registerHvyCliPluginCommands({
  name: 'form',
  pluginId: FORM_PLUGIN_ID,
  helpTopic: 'hvy plugin form',
  componentHints: [
    'This plugin is a form. The form fields, submit label, scripts, and on-submit behavior live in plugin.txt as form YAML/body text.',
    'Use plugin.txt for form content and plugin.json for plugin id/config metadata.',
    'When changing submit behavior, look for named scripts and on-submit script settings before editing fields.',
  ],
  addCommands: [
    {
      command: 'hvy add plugin form SECTION_PATH ID SUBMIT_BUTTON_LABEL FIELD... [--script NAME PYTHON] [--on-submit-script NAME]',
      description: 'Create a Form plugin component.',
    },
  ],
  operationCommands: [],
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
      description: 'Create a DB Table plugin component.',
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
});
