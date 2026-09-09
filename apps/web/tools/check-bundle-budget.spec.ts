import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BUDGET_BYTES, measureGzipTotal, parseInitialFiles } from './check-bundle-budget';

// A trimmed but representative slice of what `ng build` actually emits (captured from this
// task's own production build): critical CSS inlined, the real stylesheet loaded async via the
// media=print swap trick (plus an identical noscript fallback), a modulepreload'd common chunk,
// and the main ESM entry script. Lazy route/component chunks are deliberately absent — they are
// never referenced from index.html, which is exactly the property this parser relies on.
const SAMPLE_INDEX_HTML = `<!doctype html>
<html lang="en" data-theme="dark" data-beasties-container>
  <head>
    <meta charset="utf-8">
    <title>Web</title>
    <link rel="icon" type="image/x-icon" href="favicon.ico">
    <link rel="manifest" href="manifest.webmanifest">
  <style>:root{--surface-0:#111113}</style><link rel="stylesheet" href="styles-ABC123.css" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="styles-ABC123.css"></noscript></head>
  <body>
    <app-root></app-root>
  <link rel="modulepreload" href="chunk-XYZ789.js"><script src="main-DEF456.js" type="module"></script></body>
</html>`;

describe('parseInitialFiles', () => {
  it('collects script src, stylesheet href, and modulepreload href, deduplicated', () => {
    const files = parseInitialFiles(SAMPLE_INDEX_HTML);
    expect([...files].sort()).toEqual(
      ['chunk-XYZ789.js', 'main-DEF456.js', 'styles-ABC123.css'].sort(),
    );
  });

  it('excludes non-initial <link> rels (icon, manifest)', () => {
    const files = parseInitialFiles(SAMPLE_INDEX_HTML);
    expect(files).not.toContain('favicon.ico');
    expect(files).not.toContain('manifest.webmanifest');
  });

  it('returns an empty list for an index.html with no initial references', () => {
    expect(parseInitialFiles('<html><head></head><body></body></html>')).toEqual([]);
  });
});

describe('measureGzipTotal', () => {
  it('sums the real gzip byte length of every file, not raw byte length', () => {
    const content = Buffer.from('a'.repeat(10_000), 'utf8'); // highly compressible
    const rawLength = content.length;
    const expectedGzipLength = gzipSync(content).length;

    const result = measureGzipTotal('/dist', ['main.js'], () => content);

    expect(result.files).toEqual([{ path: 'main.js', gzipBytes: expectedGzipLength }]);
    expect(result.totalGzipBytes).toBe(expectedGzipLength);
    // The whole point of this gate: gzip, not raw, bytes — assert they actually differ here.
    expect(expectedGzipLength).toBeLessThan(rawLength);
  });

  it('sums across multiple files and reads each by its joined path', () => {
    const seenPaths: string[] = [];
    const readFile = (path: string): Buffer => {
      seenPaths.push(path);
      return Buffer.from(path, 'utf8');
    };

    const result = measureGzipTotal('/dist/web/browser', ['a.js', 'b.css'], readFile);

    expect(seenPaths).toEqual([expect.stringContaining('a.js'), expect.stringContaining('b.css')]);
    expect(result.files).toHaveLength(2);
    expect(result.totalGzipBytes).toBe(result.files.reduce((sum, file) => sum + file.gzipBytes, 0));
  });
});

describe('BUDGET_BYTES', () => {
  it('is the roadmap-binding 600 KB gzip line', () => {
    expect(BUDGET_BYTES).toBe(600 * 1024);
  });
});
