import { Injectable } from '@angular/core';
// NOT `@hk/content` (its barrel drags in Node-only build tooling, see engine.facade.ts).
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { formatIssues, parsePack, type Pack } from '@hk/protocol';

async function fetchPack(url: string): Promise<Pack> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`PackLoader: ${url} responded ${response.status} ${response.statusText}`);
  }
  const result = parsePack(await response.json());
  if (!result.ok) {
    throw new Error(
      `PackLoader: ${url} failed pack validation:\n${formatIssues(result.issues).join('\n')}`,
    );
  }
  return result.pack;
}

/**
 * Fetches the two build-time pack assets copied under `/packs/**` (`angular.json`, from
 * `packages/content/dist/packs` and `packages/content/translations`).
 */
@Injectable({ providedIn: 'root' })
export class PackLoader {
  loadCore(): Promise<Pack> {
    return fetchPack(`/packs/${PACK_ID}/${PACK_VERSION}/pack.json`);
  }

  loadDemoRu(): Promise<Pack> {
    return fetchPack('/packs/demo/srd-5e-2024-ru-sample.json');
  }
}
