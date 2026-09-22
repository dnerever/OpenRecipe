/**
 * The platform-wide default for public recipe content — see docs/PLAN.md
 * §10, Slice 17. Deliberately one constant rather than a per-recipe choice:
 * a proposal merging a CC-BY-NC recipe into a CC0 one has no correct answer
 * for what license the merge carries, so there is nothing to pick from.
 *
 * `frontmatter.license` stays free-text and is never overwritten with this —
 * it remains the override for content that isn't under the platform default,
 * such as an imported recipe carrying its source page's own terms.
 */
export const DEFAULT_CONTENT_LICENSE = 'CC-BY-SA-4.0';

const LICENSE_URLS: Record<string, string> = {
  'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-NC-4.0': 'https://creativecommons.org/licenses/by-nc/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};

/** A link only for licenses we recognize — an arbitrary string is shown as text, not guessed at. */
export function licenseUrlFor(license: string): string | undefined {
  return LICENSE_URLS[license];
}
