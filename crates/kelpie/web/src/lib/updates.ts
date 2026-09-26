// Is there a newer release, and could `mise` actually take it?
//
// The rule is the same one the `kelpie-update` skill's `scripts/update.sh`
// applies, and it is deliberately not "the newest tag": a release whose macOS
// binary is still uploading is published but not installable, and `mise` fails
// with "No matching asset found". So we want the newest *stable* release that
// carries the asset — the one the skill would pick.
//
// GitHub's API is CORS-open, so the browser asks directly and the bridge needs
// no endpoint of its own. Unauthenticated callers get 60 requests an hour per
// address, which one check per visit to Settings stays well inside.

const REPO = "yumazak/kelpie";

/** The binary name mise resolves for Apple Silicon; `scripts/update.sh` pins
 *  the same string, and the release workflow produces it. */
const INSTALLABLE_ASSET = "kelpie-aarch64-apple-darwin";

interface Release {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string }[];
}

/** The newest version a `mise install` can take, or `null` when none qualifies. */
export async function fetchLatestInstallable(): Promise<string | null> {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=30`,
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const releases = (await response.json()) as Release[];
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    if (release.assets?.some((asset) => asset.name === INSTALLABLE_ASSET)) {
      return release.tag_name.replace(/^v/, "");
    }
  }
  return null;
}

/** `X.Y.Z` compared numerically — negative when `a` is older than `b`. A part
 *  that will not parse counts as zero, so a strange tag can never look newer
 *  than a real version. */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) =>
    value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
