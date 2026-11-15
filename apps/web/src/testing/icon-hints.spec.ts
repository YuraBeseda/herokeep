import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findHintViolations } from './icon-hints';

function htmlFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return htmlFilesUnder(path);
    return path.endsWith('.html') ? [path] : [];
  });
}

describe('findHintViolations', () => {
  it('flags an hk-icon-button without a hint', () => {
    const bad = `<button hk-icon-button icon="roll" variant="brass"></button>`;
    expect(findHintViolations(bad).map((v) => v.rule)).toEqual(['icon-button-needs-hint']);
  });

  it('flags the element form and multi-line tags without a hint', () => {
    const bad = `<hk-icon-button\n  icon="roll"\n></hk-icon-button>`;
    expect(findHintViolations(bad)).toHaveLength(1);
  });

  it('accepts an hk-icon-button with a static or bound hint', () => {
    expect(
      findHintViolations(`<button hk-icon-button icon="roll" hint="shell.icon.roll"></button>`),
    ).toEqual([]);
    expect(findHintViolations(`<button hk-icon-button [icon]="i" [hint]="h"></button>`)).toEqual(
      [],
    );
  });

  it('flags a button whose only child is an hk-icon and that has no aria-label', () => {
    const bad = `<button type="button" (click)="go()">\n  <hk-icon icon="gi:cog" />\n</button>`;
    expect(findHintViolations(bad).map((v) => v.rule)).toEqual([
      'icon-only-button-needs-aria-label',
    ]);
  });

  it('accepts an icon-only button with a static or bound aria-label', () => {
    expect(
      findHintViolations(`<button aria-label="Close"><hk-icon icon="gi:cog" /></button>`),
    ).toEqual([]);
    expect(
      findHintViolations(
        `<button [attr.aria-label]="t('x')"><hk-icon icon="gi:cog"></hk-icon></button>`,
      ),
    ).toEqual([]);
  });

  it('ignores buttons that also carry text', () => {
    const ok = `<button><hk-icon icon="gi:cog" /> {{ t('x') }}</button>`;
    expect(findHintViolations(ok)).toEqual([]);
  });
});

describe('templates under src/app', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../app');
  const files = htmlFilesUnder(root);

  it('finds the templates it is meant to lint', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('every icon-only control follows the hint rule', () => {
    const report = files.flatMap((file) =>
      findHintViolations(readFileSync(file, 'utf8')).map(
        (v) => `${file.slice(root.length + 1)}: ${v.rule}: ${v.snippet.replace(/\s+/g, ' ')}`,
      ),
    );
    expect(report).toEqual([]);
  });
});
