/**
 * Body normalization is shared by the parser and the serializer. Both applying
 * the same function is what makes `parse(serialize(doc))` an identity — and
 * what keeps a stray trailing space from minting a new version.
 */
export function normalizeBody(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}
