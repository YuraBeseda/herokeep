export interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
  entityId?: string;
}

type Extra = Pick<Diagnostic, 'path' | 'entityId'>;

export function error(code: string, message: string, extra: Extra = {}): Diagnostic {
  return { severity: 'error', code, message, ...extra };
}

export function warning(code: string, message: string, extra: Extra = {}): Diagnostic {
  return { severity: 'warning', code, message, ...extra };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
