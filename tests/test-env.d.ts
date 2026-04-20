declare module 'node:fs/promises' {
  export interface FileReadOptions {
    encoding?: string | null;
    flag?: string;
  }

  export function readFile(
    path: string | URL,
    options?: FileReadOptions | string
  ): Promise<string>;
}
