/// <reference types="vite/client" />

declare module 'virtual:hvy-brython-minimal-vfs' {
  const source: string;
  export default source;
}

declare module 'virtual:hvy-built-in-plugins' {
  import type { HvyPlugin } from './plugins/types';

  export const builtInPluginIds: string[];
  export const builtInPlugins: HvyPlugin[];
  export const builtInPluginMap: Readonly<{
    dbTable?: HvyPlugin;
    form?: HvyPlugin;
    progressBar?: HvyPlugin;
    scripting?: HvyPlugin;
  }>;
  export const builtInPluginById: Readonly<Record<string, HvyPlugin | undefined>>;
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
