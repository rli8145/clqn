#!/usr/bin/env bash
# Exercise release recovery using local registry and GitHub fixtures.
set -euo pipefail
publish="$(pwd)/scripts/publish-cli.sh"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
cd "$fixture"
mkdir -p Formula dist package remote
export GITHUB_REF_NAME=v1.2.3 RUNNER_TEMP="$fixture"
archive=dist/clqn-cli-1.2.3.tgz
echo '{"name":"clqn-cli","version":"1.2.3"}' > package/package.json
tar -czf "$archive" package
digest=$(sha256sum "$archive" | cut -d' ' -f1)
cat > Formula/clqn.rb <<EOF
  url "https://github.com/clqn-org/clqn/releases/download/v1.2.3/clqn-cli-1.2.3.tgz"
  sha256 "$digest"
EOF
cp Formula/clqn.rb dist/clqn.rb

curl() {
  if [[ -f remote/npm.json ]]; then
    cp remote/npm.json "$RUNNER_TEMP/clqn-npm-version.json"
    printf 200
  else
    printf 404
  fi
}
npm() {
  case "$1" in
    --version) echo 11.13.0 ;;
    publish)
      [[ "$2" == ./dist/clqn-cli-1.2.3.tgz ]] || return 1
      [[ ! -f remote/npm.json ]] || return 1
      node -e '
        const hash = require("node:crypto").createHash("sha512").update(require("node:fs").readFileSync(process.argv[1]));
        console.log(JSON.stringify({dist: {integrity: "sha512-" + hash.digest("base64")}}));
      ' "$2" > remote/npm.json
      ;;
    *) return 1 ;;
  esac
}
gh() {
  case "$1 $2" in
    'api graphql') cat remote/state ;;
    'release create') echo draft > remote/state ;;
    'release view') if [[ -f remote/asset ]]; then echo clqn-cli-1.2.3.tgz; fi ;;
    'release upload') [[ ! -f remote/asset ]] && cp "$4" remote/asset ;;
    'release download') cp remote/asset "$RUNNER_TEMP/clqn-release-asset.tgz" ;;
    'release edit') [[ -z "${FAIL_EDIT:-}" ]] && echo published > remote/state ;;
    *) return 1 ;;
  esac
}
export -f curl npm gh

echo absent > remote/state
# Interrupt after npm accepted the archive, then retry using the draft.
if FAIL_EDIT=yes bash "$publish" > trace 2>&1; then exit 1; fi
[[ -s remote/npm.json && "$(cat remote/state)" == draft ]]
bash "$publish"
[[ "$(cat remote/state)" == published ]]
bash "$publish"

echo '{"dist":{"integrity":"sha512-wrong"}}' > remote/npm.json
if bash "$publish" > trace 2>&1; then exit 1; fi
grep -Fq 'published npm archive differs' trace
rm remote/npm.json
echo damaged > remote/asset
if bash "$publish" > trace 2>&1; then exit 1; fi
grep -Fq 'clqn-release-asset.tgz' trace
[[ ! -f remote/npm.json && "$(cat remote/asset)" == damaged ]]
echo absent > remote/state
echo stale >> Formula/clqn.rb
if bash "$publish" > trace 2>&1; then exit 1; fi
grep -Fq 'dist/clqn.rb' trace
[[ "$(cat remote/state)" == absent ]]
echo "Release retry and checksum checks passed"
