import type { HvyEmbeddingProvider, HvyEmbeddingProviderRequest } from '../types';

export interface HvyProxyEmbeddingProviderOptions {
  endpoint?: string;
}

interface ProxyEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  embeddings?: number[][];
}

export function createProxyEmbeddingProvider(options: HvyProxyEmbeddingProviderOptions = {}): HvyEmbeddingProvider {
  const endpoint = options.endpoint ?? '/api/embeddings';
  return async (request) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createProxyEmbeddingRequest(request)),
      signal: request.signal,
    });
    const payload = await response.json() as ProxyEmbeddingResponse & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || 'Embedding request failed.');
    }
    const vectors = Array.isArray(payload.embeddings)
      ? payload.embeddings
      : Array.isArray(payload.data)
      ? payload.data.map((entry) => entry.embedding ?? [])
      : [];
    if (vectors.length !== request.inputs.length) {
      throw new Error('Embedding response did not include one vector per input.');
    }
    return request.inputs.map((input, index) => ({
      id: input.id,
      vector: vectors[index] ?? [],
    }));
  };
}

function createProxyEmbeddingRequest(request: HvyEmbeddingProviderRequest): Record<string, unknown> {
  return {
    model: request.model,
    input: request.inputs.map((input) => input.text),
    ...(request.dimensions !== undefined ? { dimensions: request.dimensions } : {}),
  };
}
