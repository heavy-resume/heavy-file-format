import { defineConfig, loadEnv } from 'vite';
import { createChatProxyPlugin } from './proxy/chat-proxy';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [createChatProxyPlugin(env)],
    server: {
      host: true,
      port: 5173,
    },
  };
});
