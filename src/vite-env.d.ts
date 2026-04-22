/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HVY_CHAT_PROVIDER?: 'openai' | 'anthropic';
  readonly VITE_HVY_CHAT_MODEL?: string;
  readonly VITE_OPENAI_MODEL?: string;
  readonly VITE_ANTHROPIC_MODEL?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
