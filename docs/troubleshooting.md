# Troubleshooting

Start with `clqn --version`, `clqn whoami`, and `gh auth status`. The last two check separate identities. `clqn` uses its own account for the clan and your local GitHub CLI account for repository operations.

| Symptom | What to check |
| --- | --- |
| The device code expired or GitHub sign-in was denied | Start sign-in again from clqn. Use the GitHub account with a verified primary email. For a self-hosted API, check that the OAuth App has Device Flow enabled. [Sign-in details](authentication.md#sign-in) |
| An invitation is missing | Check the selected API server, the signed-in account's primary email, and the address the leader invited. Invitations expire after seven days. The leader can send a fresh invitation from chat settings. [Invitations](index.md#create-or-join-a-clan) |
| Messages stay queued | Check that the leader or an opted-in backup has chat open with a signed-in, enabled agent runtime. A disconnected host's lease takes up to 45 seconds to expire. [Backup hosts](chat.md#set-up-backup-hosts) |
| A worker is missing or never starts | Confirm Codex or Claude Code is installed and signed in on the assigned member's machine, then check **Agents**, **Spawn approval**, and the member's model, token, and agent limits in **Ctrl+S**. Use **Ctrl+P** to find a pending approval. [Agent limits](policies.md) |
| A worker finished but the PR is missing | Confirm the clone matches the linked repository, the run produced changes, and the worker's local Git and GitHub CLI accounts can push and open pull requests. A failed publication can retry while chat stays open. [Repository workflow](repositories.md#from-request-to-merge) |
| A PR is approved in chat but is still open on GitHub | Keep the leader's chat open and check the PR on GitHub for pending checks, reviews, and other merge requirements. Chat requires a successful check and approval of the current PR commit. [Repository workflow](repositories.md#from-request-to-merge) |
| The local default branch did not update | Check `git status --short --branch` in the default branch's worktree. clqn skips dirty, ahead, or diverged checkouts. For a clean checkout, check webhook deliveries or wait for the five-minute fallback. [Main sync](repositories.md#keeping-main-current) |
| A self-hosted CLI cannot connect | Check the exact API URL passed to `clqn --api-url`. Non-loopback URLs require HTTPS. Request `/health` for liveness and `/ready` to verify the database connection. [Deployment checks](hosting.md#verify-a-deployment) |

For public bug reports, include your OS and terminal, `clqn --version`, the agent runtime and version if relevant, the failing step, and any request ID shown by the API. Remove tokens, invite links, private repository names, and sensitive chat or logs before posting. Use [private vulnerability reporting](https://github.com/clqn-org/clqn/security/advisories/new) for security issues.
