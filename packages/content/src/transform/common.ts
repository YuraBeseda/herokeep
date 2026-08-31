export const SOURCE = { book: 'SRD 5.2.1' };

interface BaseEntityFields {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  source: { book: string };
  prerequisites: [];
  effects: [];
  grants: [];
  choices: [];
}

/**
 * The six base fields every glossary entity shares: `description` is the trimmed `desc`,
 * omitted entirely when empty (the schema requires a non-empty string when present).
 */
export function baseEntity(id: string, name: string, desc: string | undefined, tags: string[] = []): BaseEntityFields {
  const description = desc?.trim();
  return {
    id,
    name,
    ...(description ? { description } : {}),
    tags,
    source: SOURCE,
    prerequisites: [],
    effects: [],
    grants: [],
    choices: [],
  };
}
