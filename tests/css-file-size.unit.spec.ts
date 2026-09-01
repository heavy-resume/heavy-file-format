import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { expect, test } from 'vitest';

function listCssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listCssFiles(path);
    }
    return extname(entry.name) === '.css' ? [path] : [];
  });
}

test('expected result: source stylesheets stay at or below 1,000 lines', () => {
  const oversizedStylesheets = listCssFiles(new URL('../src', import.meta.url).pathname)
    .map((file) => ({
      file,
      lines: readFileSync(file, 'utf8').split(/\r?\n/).length - 1,
    }))
    .filter(({ lines }) => lines > 1000);

  expect(oversizedStylesheets).toEqual([]);
});
