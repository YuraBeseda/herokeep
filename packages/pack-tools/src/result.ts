import type { Diagnostic } from '@hk/engine';

export interface CommandResult {
  exitCode: 0 | 1 | 2;
  lines: string[];
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = [d.path, d.entityId].filter(Boolean).join(' @ ');
  return `${d.severity} ${d.code}${where ? ` [${where}]` : ''}: ${d.message}`;
}
