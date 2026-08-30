import type { Diagnostic } from '../diagnostics.ts';

export interface ChoiceRequest {
  choiceId: string;
  ownerId: string;
  count: number;
}

export interface Sheet {
  name: string;
  system: string;
  level: number;
  classes: { classId: string; level: number }[];
  pins: Record<string, string>;
  outstandingChoices: ChoiceRequest[];
  issues: Diagnostic[];
}
