import { STRIPPED_IMPORT_MESSAGE } from './python-source';

export function summarizeScriptingError(rawError: string): string {
  const trimmed = rawError.trim();
  if (trimmed.length === 0) {
    return 'Script failed.';
  }

  const lineMatch = trimmed.match(/File "<[^"]+>", line (\d+)/);
  const lineSuffix = lineMatch ? ` (line ${lineMatch[1]})` : '';
  const lines = trimmed.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const lastLine = lines.at(-1) ?? 'Script failed.';

  if (lastLine.includes(STRIPPED_IMPORT_MESSAGE)) {
    return `${STRIPPED_IMPORT_MESSAGE}${lineSuffix}`;
  }

  const exceptionMatch = lastLine.match(/^([A-Za-z_][A-Za-z0-9_.]*):\s*(.+)$/);
  if (exceptionMatch) {
    return `${exceptionMatch[1]}: ${exceptionMatch[2]}${lineSuffix}`;
  }

  return `${lastLine}${lineSuffix}`;
}

export function cleanScriptingErrorDetail(rawError: string): string {
  const trimmed = rawError.trim();
  if (trimmed.length === 0) {
    return 'Script failed.';
  }

  const lines = trimmed.split('\n');
  const userFrameIndex = lines.findIndex((line) => /^\s*File "<[^"<>]+>", line \d+/.test(line));
  if (userFrameIndex >= 0) {
    const tracebackHeader = lines.find((line) => line.startsWith('Traceback '));
    return [tracebackHeader, ...lines.slice(userFrameIndex)].filter((line): line is string => line !== undefined).join('\n').trim();
  }

  const cleaned = lines.filter((line, index) => {
    const nextLine = lines[index + 1] ?? '';
    if (line.includes('File "#hvy_script_')) {
      return false;
    }
    if (line.trim() === 'exec(__hvy_code__, __hvy_user_globals__)') {
      return false;
    }
    if (line.trim() === '<module>' && nextLine.trim() === 'exec(__hvy_code__, __hvy_user_globals__)') {
      return false;
    }
    return true;
  });

  return cleaned.join('\n').trim();
}
