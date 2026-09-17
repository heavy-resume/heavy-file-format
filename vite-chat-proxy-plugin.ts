import { runnerImport, type Plugin, type ViteDevServer } from 'vite';

type ChatProxyMiddleware = ReturnType<
  typeof import('./proxy/chat-proxy')['buildChatProxyMiddleware']
>;

export function createViteChatProxyPlugin(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'hvy-chat-proxy',
    configureServer(server) {
      server.middlewares.use(createLazyChatProxyMiddleware(server, env));
    },
    async configurePreviewServer(server) {
      const result = await runnerImport<typeof import('./proxy/chat-proxy')>('/proxy/chat-proxy.ts', {
        root: server.config.root,
      });
      server.middlewares.use(result.module.buildChatProxyMiddleware(env));
    },
  };
}

function createLazyChatProxyMiddleware(
  server: ViteDevServer,
  env: Record<string, string | undefined>
): ChatProxyMiddleware {
  let middlewarePromise: Promise<ChatProxyMiddleware> | null = null;
  return async (req, res, next) => {
    if (
      !req.url?.startsWith('/api/chat')
      && !req.url?.startsWith('/api/embeddings')
      && !req.url?.startsWith('/api/agent-trace')
    ) {
      next();
      return;
    }
    middlewarePromise ??= server.ssrLoadModule('/proxy/chat-proxy.ts')
      .then((module) => module.buildChatProxyMiddleware(env) as ChatProxyMiddleware);
    return (await middlewarePromise)(req, res, next);
  };
}
