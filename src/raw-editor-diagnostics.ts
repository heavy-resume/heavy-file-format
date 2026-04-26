import { deserializeDocumentWithDiagnostics, getHvyDiagnosticUsageHint } from './serialization';
import { detectExtension } from './utils';
import type { RawEditorDiagnostic } from './types';

export function getRawEditorDiagnostics(source: string, filename: string): RawEditorDiagnostic[] {
  const extension = detectExtension(filename, source);
  const { diagnostics } = deserializeDocumentWithDiagnostics(source, extension);
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    message: diagnostic.message,
    hint: getHvyDiagnosticUsageHint(diagnostic),
  }));
}
