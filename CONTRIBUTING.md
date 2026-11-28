# Contributing

Thanks for helping with clqn. It's a lightweight, CLI-first tool, so we favor small, focused changes and few dependencies. Read [ROADMAP.md](ROADMAP.md) for scope before starting larger work.

- **Bugs and ideas:** [open an issue](https://github.com/clqn-org/clqn/issues). For larger changes, open an issue first so we can agree on the approach.
- **Security problems:** don't open a public issue. Follow [SECURITY.md](SECURITY.md).

## Prerequisites

- Node.js 22.12+ and npm 10+
- Docker, for the local PostgreSQL database

## Set up

```sh
git clone https://github.com/clqn-org/clqn.git
cd clqn
npm install
cp .env.example .env
docker compose up -d --wait
npm run db:migrate
npm run build
```

`.env.example` already points at the Docker database. Start the API in watch mode:

```sh
npm run dev
```

The API listens on `127.0.0.1:3000`. Create a local account in another terminal and use its token to open chat.

```sh
npm run user -- create you@example.com
CLQN_API_URL=http://127.0.0.1:3000 CLQN_TOKEN='<personal-token>' npm run cli
```

Choose **Create a clan**. For GitHub sign-in and invitations, [enable device flow](docs/hosting.md#github-oauth-app). Watch mode reloads API changes. Run `npm run build` again after changing `packages/shared` or the CLI.

## Project structure

| Workspace | Responsibility |
| --- | --- |
| `packages/shared` | Zod contracts, API errors, HTTP client |
| `packages/api` | Hono server, Drizzle schema and migrations |
| `packages/mcp` | Thin stdio MCP adapter |
| `packages/cli` | Commander commands and terminal output |

Business logic and authorization belong in the API. Keep the CLI and MCP adapter thin. Every command should support `--json`.

## Run the checks

```sh
npm run lint        # formatting and lint rules (npm run format fixes most issues)
npm run typecheck
npm test
```

Without a database, `npm test` skips the PostgreSQL integration tests. To run them, create a test database once and point the tests at it:

```sh
docker compose exec db createdb -U postgres clqn_test
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/clqn_test npm test
```

CI runs all checks, including the database tests, on Node 22 and 24. On Node 22 it also runs `npm run test:coverage`, which fails if line coverage drops below 88% or branch coverage below 82%, and reports the result to [Codecov](https://app.codecov.io/gh/clqn-org/clqn). Run it locally with `TEST_DATABASE_URL` set to see the same per-file table.

Write new tests in TypeScript as `packages/<name>/test/*.test.ts` and import the code under test from `../src`. `npm test` runs the package suites and CLI/MCP subprocesses directly from source, including workspace dependencies, without a build. `npm run typecheck` checks them with the same strict settings as the source. Packaging tests separately verify the built release archive.

Changes to authorization, concurrent writes or task ownership need tests that cover them. For schema changes, follow [database setup](docs/database.md#schema-changes) and commit the generated migration.

## Open a pull request

1. Fork the repository and create a branch from `main`.
2. Make one focused change. Keep unrelated cleanup out of it.
3. Run the checks above.
4. Write commit messages as `<type>(optional scope): <description>`, for example `feat(cli): add clan status` or `fix(api): reject expired invitations`.
5. Open the pull request with what changed, why, and how you tested it.

Maintainers: release and deployment steps are in [RELEASING.md](RELEASING.md).
