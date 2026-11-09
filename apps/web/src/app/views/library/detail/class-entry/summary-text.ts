const MAX_LENGTH = 140;

/**
 * A one-line plain-text lead for a pack description (markdown): the first paragraph's first
 * sentence with the markup stripped, cut at a word boundary with an ellipsis when it is still
 * long. The full text stays one click away (the entry), so this is only a preview.
 */
export function summaryOf(markdown: string): string {
  const paragraph = markdown.trim().split(/\n\s*\n/, 1)[0] ?? '';
  const plain = paragraph
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain;
  if (sentence.length <= MAX_LENGTH) return sentence;
  const cut = sentence.slice(0, MAX_LENGTH);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 40 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
