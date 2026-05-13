/// <reference types="vite/client" />

declare module 'virtual:hvy-brython-minimal-vfs' {
  const source: string;
  export default source;
}

declare module 'virtual:hvy-built-in-plugins' {
  import type { JsonObject } from './hvy/types';
  import type { HvyPluginRegistration } from './plugins/types';
  import type { VisualDocument } from './types';

  export const builtInPluginIds: string[];
  export function isBuiltInPluginEnabled(pluginId: string): boolean;
  export function registerBuiltInPlugins(register: (registration: HvyPluginRegistration) => void): void;
  export function runBuiltInScriptingPlugin(params: {
    document: VisualDocument;
    source: string;
    componentId?: string;
    pluginVersion?: string;
  }): Promise<unknown | null>;
  export function setBuiltInScriptingResult(element: HTMLElement, result: unknown, source: string): void | Promise<void>;
  export function getBuiltInScriptingPluginVersion(config: JsonObject | unknown): string;
}

interface ImportMetaEnv {
  readonly VITE_HVY_CHAT_PROVIDER?: 'openai' | 'anthropic' | 'qwen';
  readonly VITE_HVY_CHAT_MODEL?: string;
  readonly VITE_HVY_ENABLE_CHAT_MODEL_PICKER?: string;
  readonly VITE_OPENAI_MODEL?: string;
  readonly VITE_ANTHROPIC_MODEL?: string;
  readonly VITE_QWEN_MODEL?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_QWEN_API_KEY?: string;
  readonly VITE_DASHSCOPE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
