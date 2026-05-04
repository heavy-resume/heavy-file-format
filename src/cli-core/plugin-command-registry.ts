export interface HvyCliHelpCommand {
  command: string;
  description: string;
}

export interface HvyCliPluginCommandRegistration {
  name: string;
  helpTopic: string;
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

function copyRegistration(registration: HvyCliPluginCommandRegistration): HvyCliPluginCommandRegistration {
  return {
    ...registration,
    addCommands: [...registration.addCommands],
    operationCommands: [...registration.operationCommands],
  };
}

registerHvyCliPluginCommands({
  name: 'form',
  helpTopic: 'hvy plugin form',
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
  helpTopic: 'hvy plugin db-table',
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
