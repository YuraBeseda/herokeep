export interface SkippedEvent {
  eventId: string;
  reason: string;
}

export interface Facts {
  streamId: string;
  created: boolean;
  name: string;
  system: string;
  grammaticalGender: 'masculine' | 'feminine' | 'neuter';
  createdWith: { engineVersion: string };
  pins: Record<string, string>;
  decisions: Record<string, string[]>;
  skipped: SkippedEvent[];
  lastSeq: number;
  appliedEventIds: string[];
}

export function emptyFacts(streamId: string): Facts {
  return {
    streamId,
    created: false,
    name: '',
    system: '',
    grammaticalGender: 'neuter',
    createdWith: { engineVersion: '' },
    pins: {},
    decisions: {},
    skipped: [],
    lastSeq: 0,
    appliedEventIds: [],
  };
}

export interface Snapshot {
  seq: number;
  facts: Facts;
  engineVersion: string;
}
