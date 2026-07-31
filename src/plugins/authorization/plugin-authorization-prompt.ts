import './plugin-authorization-prompt.css';
import type { VisualDocument } from '../../types';
import type { HvyPlugin, HvyPluginInstance } from '../types';
import {
  getPluginAuthorizationMode,
  setPluginAuthorized,
} from './plugin-authorization-policy';

export interface PluginAuthorizationPromptOptions {
  document: VisualDocument;
  plugin: HvyPlugin;
  loadAndMount(): Promise<HvyPluginInstance>;
}

export function createPluginAuthorizationPrompt(options: PluginAuthorizationPromptOptions): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = 'hvy-plugin-authorization';
  const title = document.createElement('strong');
  title.className = 'hvy-plugin-authorization-title';
  title.textContent = `${options.plugin.displayName} is blocked`;
  const detail = document.createElement('p');
  detail.className = 'hvy-plugin-authorization-detail';
  detail.textContent = 'This plugin can run code. Allow it only if you trust this file and the plugin.';
  const status = document.createElement('p');
  status.className = 'hvy-plugin-authorization-status';
  const actions = document.createElement('div');
  actions.className = 'hvy-plugin-authorization-actions';
  const allow = document.createElement('button');
  allow.type = 'button';
  allow.className = 'primary';
  allow.textContent = `Allow ${options.plugin.displayName}`;
  actions.append(allow);
  root.append(title, detail, actions, status);

  let mounted: HvyPluginInstance | null = null;
  let disposed = false;
  const enable = async (): Promise<void> => {
    allow.disabled = true;
    status.textContent = 'Loading plugin…';
    try {
      mounted = await options.loadAndMount();
      if (disposed) {
        mounted.unmount?.();
        return;
      }
      root.replaceChildren(mounted.element);
    } catch (error) {
      allow.disabled = false;
      status.textContent = error instanceof Error ? error.message : 'Plugin failed to load.';
    }
  };
  allow.addEventListener('click', () => {
    setPluginAuthorized(options.document, options.plugin, true);
    void enable();
  });

  if (getPluginAuthorizationMode(options.document, options.plugin) === 'enabled') {
    void enable();
  }

  return {
    element: root,
    refresh: () => mounted?.refresh?.(),
    unmount: () => {
      disposed = true;
      mounted?.unmount?.();
    },
  };
}
