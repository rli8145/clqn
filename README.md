<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/header.svg">
  <img src="docs/assets/header.gif" width="1032" alt="clqn">
</picture>

<p align="center">
  <a href="https://clqn.org/">clqn.org</a> · <a href="https://clqn.org/download.html">Download</a> · <a href="https://clqn.org/docs/">Documentation</a>
</p>

<p align="center">
<a href="https://github.com/rli8145/clqn/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/rli8145/clqn/ci.yml?branch=main&style=for-the-badge" alt="Build status"></a>
<a href="https://app.codecov.io/gh/rli8145/clqn"><img src="https://img.shields.io/codecov/c/github/rli8145/clqn?style=for-the-badge" alt="Test coverage"></a>
<img src="https://img.shields.io/badge/node-%3E%3D22.12-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 22.12 or newer">
<a href="https://npmjs.com/package/clqn-cli"><img src="https://img.shields.io/npm/v/clqn-cli?style=for-the-badge" alt="npm version"></a>
<a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT license"></a>
</p>

## Why clqn?

When several people each run several agents on one repository, context drifts, branches collide, and nobody is sure who owns what. `clqn` is a shared, lightweight TUI for coordinating work across your team and its agents.

- **One chat.** The orchestrator routes each prompt so independent tasks can progress in parallel.
- **Your machine, your call.** Agents run on their owners' compute and only with their approval.
- **Limits you set.** Cap your tokens, how many agents run at once, and which models they use.
- **No plumbing.** Tasks, branches, and worktrees are handled for you. Your `main` is automatically synced.

## Install

```sh
npm install -g clqn-cli
```

Or with Homebrew:

```sh
brew tap rli8145/clqn https://github.com/rli8145/clqn
brew install clqn
```

You'll need Node.js 22.12+, Git, the GitHub CLI (`gh`), and [Claude Code](https://claude.com/claude-code) or [Codex CLI](https://github.com/openai/codex).

## Start a clan

In your project's GitHub clone, run:

```sh
clqn
```

Sign in with GitHub, choose **Create a clan**, and say yes to linking the repository (this needs admin access to the repo). Then choose **Start session** to open the chat.

## Invite teammates

Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to open settings and type teammate email in **Invite**. Or, from another terminal:

```sh
clqn invite teammate@example.com
```

Teammates run `clqn` in their own clone, sign in with the invited GitHub account, choose **View clan invites**, then **Join session**.

## Work

<img src="docs/assets/demo.gif" width="1052" alt="Starting clqn: create a clan and start the session. In the chat, a member asks for rate limiting, the orchestrator splits it into two tasks, the member approves one, two workers run, and the result arrives as a pull request the leader approves">

Everyone freely prompts the orchestrator. When the orchestrator wants to start an agent on your machine, approve or decline with <kbd>Y</kbd>/<kbd>N</kbd>. Results and pull requests appear in the chat. As leader, press <kbd>Ctrl</kbd>+<kbd>L</kbd> to review a pull request and <kbd>Y</kbd> to approve the merge; clqn merges it once GitHub checks pass.

Press <kbd>Ctrl</kbd>+<kbd>S</kbd> for settings and <kbd>Ctrl</kbd>+<kbd>G</kbd> for graphs and metrics. See the [chat guide](docs/chat.md) for every key.

## Documentation

- [Getting started](docs/index.md) · [Chat and keys](docs/chat.md) · [Commands](docs/commands.md)
- [Agent limits](docs/policies.md) · [Pull requests and syncing `main`](docs/repositories.md)
- [Accounts, clans, and custom MCP clients](docs/authentication.md) · [GitHub webhooks](docs/webhooks.md)
- [Architecture and trust boundaries](docs/architecture.md) · [Troubleshooting](docs/troubleshooting.md) · [Changelog](CHANGELOG.md)
- Self-hosting: [run your own server](docs/hosting.md) · [database](docs/database.md)

## Contributing

[Report an issue](https://github.com/rli8145/clqn/issues) or read the [contribution guide](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE.md)
