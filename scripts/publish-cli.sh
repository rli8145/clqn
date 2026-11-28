#!/usr/bin/env bash
# Run from the repository root in the protected cli-release Actions job.
set -euo pipefail
tag=${GITHUB_REF_NAME:?Missing release tag}
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "Expected a stable vX.Y.Z tag" >&2; exit 1; }
version=${tag#v}
name="clqn-cli-$version.tgz"
archive="./dist/$name"

# The formula on main is the checksum users will install through Homebrew.
cmp Formula/clqn.rb dist/clqn.rb
digest=$(sha256sum "$archive" | cut -d' ' -f1)
grep -Fxq "  sha256 \"$digest\"" Formula/clqn.rb
grep -Fxq "  url \"https://github.com/clqn-org/clqn/releases/download/$tag/$name\"" Formula/clqn.rb
tar -xOzf "$archive" package/package.json | node -e '
  const manifest = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  if (manifest.name !== "clqn-cli" || manifest.version !== process.argv[1]) {
    throw Error("Packaged name or version does not match the release tag");
  }
' "$version"
# GitHub-hosted Node 24 provides npm with OIDC trusted publishing support.
node -e '
  const [major, minor, patch] = process.argv[1].split(".").map(Number);
  if (!(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))))) {
    throw Error("Trusted publishing requires npm >= 11.5.1");
  }
' "$(npm --version)"

# Only a definitive 404 means this version is available for first publication.
registry=https://registry.npmjs.org
metadata="$RUNNER_TEMP/clqn-npm-version.json"
http_status=$(curl -sS --retry 3 --output "$metadata" --write-out '%{http_code}' "$registry/clqn-cli/$version")
case "$http_status" in
  200)
    node -e '
      const fs = require("node:fs");
      const hash = require("node:crypto").createHash("sha512").update(fs.readFileSync(process.argv[1])).digest("base64");
      const registry = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
      if (registry.dist.integrity !== "sha512-" + hash) throw Error("The published npm archive differs from the CI artifact");
    ' "$archive" "$metadata"
    ;;
  404) ;;
  *) echo "npm registry lookup failed with HTTP $http_status" >&2; exit 1 ;;
esac

# A pending draft can exist after an interrupted release. Query by tag to find
# either state before creating anything, then verify any existing asset in full.
release_state=$(gh api graphql -f query='
  query($tag: String!) {
    repository(owner: "clqn-org", name: "clqn") { release(tagName: $tag) { isDraft } }
  }' -f tag="$tag" --jq '
    .data.repository.release | if . == null then "absent" elif .isDraft then "draft" else "published" end')
if [[ "$release_state" == absent ]]; then
  gh release create "$tag" --draft --verify-tag --title "clqn $version" --generate-notes
  release_state=draft
fi
existing=$(gh release view "$tag" --json assets --jq ".assets[] | select(.name == \"$name\") | .name")
if [[ -z "$existing" ]]; then
  gh release upload "$tag" "$archive"
fi
gh release download "$tag" --pattern "$name" --output "$RUNNER_TEMP/clqn-release-asset.tgz" --clobber
cmp "$archive" "$RUNNER_TEMP/clqn-release-asset.tgz"

if [[ "$http_status" == 404 ]]; then
  npm publish "$archive" --access public --registry "$registry" --ignore-scripts --provenance
fi
if [[ "$release_state" == draft ]]; then
  gh release edit "$tag" --draft=false
fi
