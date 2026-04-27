import { sectionActions } from './section';
import { blockActions } from './block';
import { containerActions } from './container';
import { gridActions } from './grid';
import { tableActions } from './table';
import { dbTableActions } from './db-table';
import { pluginActions } from './plugin';
import type { ActionHandler } from './types';

export const actionRegistry: Record<string, ActionHandler> = {
  ...sectionActions,
  ...blockActions,
  ...containerActions,
  ...gridActions,
  ...tableActions,
  ...dbTableActions,
  ...pluginActions,
};
