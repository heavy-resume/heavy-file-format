import type { VisualDocument } from '../types';
import {
  formatHvyCliLintIssueLine,
  runHvyCliLinter,
  type HvyCliLintIssue,
} from './document-linter';

export type HvyCliDiagnosticIssue = HvyCliLintIssue;

export async function collectHvyCliDiagnostics(document: VisualDocument): Promise<HvyCliDiagnosticIssue[]> {
  return [
    ...await runHvyCliLinter(document),
  ];
}

export function formatHvyCliDiagnosticIssueLine(issue: HvyCliDiagnosticIssue): string {
  return formatHvyCliLintIssueLine(issue);
}

export function formatHvyCliDiagnosticDiff(before: HvyCliDiagnosticIssue[], after: HvyCliDiagnosticIssue[]): string {
  const beforeLines = new Map(before.map((issue) => [issue.key, formatHvyCliDiagnosticIssueLine(issue)]));
  const afterLines = new Map(after.map((issue) => [issue.key, formatHvyCliDiagnosticIssueLine(issue)]));
  const removed = [...beforeLines.entries()]
    .filter(([key]) => !afterLines.has(key))
    .map(([, line]) => `- ${line}`);
  const added = [...afterLines.entries()]
    .filter(([key]) => !beforeLines.has(key))
    .map(([, line]) => `+ ${line}`);
  if (removed.length === 0 && added.length === 0) {
    return '';
  }
  return [
    'diagnostics diff',
    ...removed,
    ...added,
  ].join('\n');
}
