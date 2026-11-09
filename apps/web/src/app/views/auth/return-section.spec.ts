import { isSameAppPath, returnSection } from './return-section';

describe('returnSection', () => {
  it.each([
    ['/g/00000000-0000-4000-8000-000000000001/lobby', 'campaigns'],
    ['/campaigns', 'campaigns'],
    ['/c/char:abc', 'heroes'],
    ['/characters?x=1', 'heroes'],
    ['/library/fireball#top', 'library'],
    ['/packs', 'packs'],
    ['/settings', 'settings'],
    ['/something-else', 'other'],
    ['/', 'other'],
  ])('%s names %s', (url, section) => {
    expect(returnSection(url)).toBe(section);
  });

  it.each([[null], [''], ['https://evil.example/x'], ['//evil.example/x'], ['relative/path']])(
    'gives nothing for %s: login falls back to the heroes list',
    (url) => {
      expect(returnSection(url)).toBeNull();
      expect(isSameAppPath(url)).toBe(false);
    },
  );
});
