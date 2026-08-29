/// <reference types="vite/client" />

declare module 'virtual:hvy-brython-minimal-vfs' {
  const source: string;
  export default source;
}

declare module 'virtual:hvy-brython-plugin-vfs' {
  const pythonLibraryVfsByName: Record<string, Record<string, unknown>>;
  export default pythonLibraryVfsByName;
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
    graph?: HvyPlugin;
    diagram?: HvyPlugin;
    qrCode?: HvyPlugin;
    video?: HvyPlugin;
    editableText?: HvyPlugin;
    canvas?: HvyPlugin;
    powerScripting?: HvyPlugin;
  }>;
  export const builtInPluginById: Readonly<Record<string, HvyPlugin | undefined>>;
}

interface ImportMetaEnv {
  readonly VITE_HVY_CHAT_PROVIDER?: 'openai' | 'anthropic' | 'qwen';
  readonly VITE_HVY_CHAT_MODEL?: string;
  readonly VITE_HVY_CHAT_COMPACTION_PROVIDER?: 'openai' | 'anthropic';
  readonly VITE_HVY_CHAT_COMPACTION_MODEL?: string;
  readonly VITE_HVY_CHAT_TOOL_LOOP_COMPACT_AFTER_MESSAGES?: string;
  readonly VITE_HVY_CHAT_TOOL_LOOP_KEEP_RECENT_MESSAGES?: string;
  readonly VITE_HVY_CHAT_TOOL_LOOP_LATEST_TOOL_RESULT_CONTEXT_CHARS?: string;
  readonly VITE_HVY_CHAT_TOOL_LOOP_TOOL_RESULT_CHAT_CHARS?: string;
  readonly VITE_HVY_ENABLE_CHAT_MODEL_PICKER?: string;
  readonly VITE_HVY_ENABLE_CHAT_PROXY_DEBUG_LOGS?: string;
  readonly VITE_HVY_ENABLE_PDF_IMPORT_STEPPER?: string;
  readonly VITE_OPENAI_MODEL?: string;
  readonly VITE_ANTHROPIC_MODEL?: string;
  readonly VITE_QWEN_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
