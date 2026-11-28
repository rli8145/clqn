# Releasing

Maintainer notes for publishing the CLI and deploying the API and clqn.org. To run your own API, see [GCP hosting](docs/hosting.md).

## CLI release

The npm package is `clqn-cli`; its executable is `clqn`. It bundles the CLI, MCP adapter, shared client, and runtime dependencies. The same archive goes to GitHub Releases for this repository's Homebrew tap. Keep older release assets for existing installations.

### Configure release access

1. Under GitHub **Settings → Environments**, create `cli-release` and allow deployments from tags matching `v*`. To reserve release tags for specific maintainers, configure a `v*` tag ruleset.
2. In the npm settings for `clqn-cli`, add a GitHub Actions trusted publisher for owner `clqn-org`, repository `clqn`, workflow filename `ci.yml`, and environment `cli-release`. The workflow uses npm's short-lived OIDC credential and GitHub's built-in token. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

### Prepare

Start from a clean checkout with Node.js 22.12+ and npm 10+. Update workspace versions, internal dependency versions, the lockfile, and `VERSION` and `RELEASE_DATE` in `packages/shared/src/index.ts` together. Finish README edits before packaging; it is included in the archive.

```sh
npm ci
npm test
npm run typecheck
npm run package:cli
npm run test:package
cp dist/clqn.rb Formula/clqn.rb
```

Packaging generates the formula's SHA-256. The package test installs the archive offline and checks CLI/MCP behavior. CI saves the tested Node.js 22 archive and formula in its `cli-release` artifact. If your local checksum differs, copy the artifact's `clqn.rb` to `Formula/clqn.rb` before tagging.

### Publish

Merge release changes, including the generated formula, into `main`. Tag that commit with the new stable version. For example, to release 0.1.1 from the current remote main:

```sh
git fetch origin main
git tag v0.1.1 origin/main
git push origin refs/tags/v0.1.1
```

The tag runs the full CI matrix. CLI publication waits for the database migrations and API deployment to succeed, so hosts can use the parallel orchestration API when they upgrade. The release job checks main ancestry, the packed version, and the committed formula's URL and checksum. It uploads and verifies the GitHub draft asset, publishes the same bytes to npm with provenance, then makes the release public.

Rerun failed jobs for the original tag after an interruption. After the seven-day artifact retention period, rerun all jobs for the tag. A retry compares the archive with any published npm version and GitHub asset. A checksum conflict stops publication.

### Verify

```sh
npm view clqn-cli version
npm install -g clqn-cli
clqn --version
brew tap clqn-org/clqn https://github.com/clqn-org/clqn
brew install clqn-org/clqn/clqn
brew test clqn-org/clqn/clqn
```

Changes to `website/download.html` ship through the [website deployment](#website-deployment) after checks pass on `main`.

## API deployment

A stable `vX.Y.Z` tag on a commit on `main` deploys the API after checks pass. The `deploy-api` job builds `clqn-api:<tag>`, runs the `clqn-migrate` job with it, updates the `clqn-api` Cloud Run service to the same image, and verifies that the new revision serves all traffic and answers `/ready`. Existing env vars, secrets, and network settings are kept.

GitHub authenticates through Workload Identity Federation (pool and provider `github`, limited to `clqn-org/clqn`) as `clqn-deployer`, which holds Cloud Run Developer, Artifact Registry Writer, and permission to act as `clqn-api`. No key is stored in GitHub. Under GitHub **Settings → Environments**, create `api-production` and allow deployments from tags matching `v*`. To roll back, run `gcloud run services update-traffic clqn-api --to-revisions <previous-revision>=100`; migrations are not reversed, so keep them additive. Cloud Run preserves pinned traffic on later deployments. When you are ready to resume deployments, restore automatic traffic routing with `gcloud run services update-traffic clqn-api --to-latest`.

Before releasing, confirm the existing `clqn-cleanup` Cloud Run job runs through the `clqn-cleanup-daily` Cloud Scheduler trigger at 09:00 UTC. After the API readiness check, the deploy job updates `clqn-cleanup` to the same release image.

## Website deployment

After the Node.js 22 and 24 checks pass on the current `main` of `clqn-org/clqn`, GitHub Actions deploys the tested static site to the Vercel project `andy-zhang-s-projects2/clqn`. It compares the public homepage, download page, docs index, logo, and groundhog art with the build.

Under GitHub **Settings → Environments**, create `website-production`, restrict deployment branches to `main`, and add an environment secret named `VERCEL_TOKEN`. Use a dedicated token scoped to the Vercel team with permission to deploy the existing project. The workflow includes the nonsecret team and project IDs. [Vercel's GitHub Actions guide](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)

Select **Actions → CI/CD → Run workflow** on `main` to redeploy. Deployments run one at a time and skip superseded commits. Rerun a failed job within the artifact's seven-day retention period, or start a fresh workflow. To roll back, revert the site change on `main`.
