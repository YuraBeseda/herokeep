import { mkdirSync, writeFileSync } from 'node:fs';
import { toPackJsonSchema } from '../src/pack/json-schema.ts';

const out = new URL('../schema/pack-v1.json', import.meta.url);
mkdirSync(new URL('../schema/', import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify(toPackJsonSchema(), null, 2) + '\n');
console.log(`wrote ${out.pathname}`);
