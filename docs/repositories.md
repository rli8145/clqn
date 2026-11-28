# Pull requests and syncing main

Agents do their work with Git on their owners' machines. clqn uses the local Git and GitHub CLI sign-ins to publish and merge pull requests. The API stores the task and repository metadata, along with chat and worker results. GitHub device sign-in is a separate flow for clqn accounts. [Architecture and trust boundaries](architecture.md)

## What each person needs

- **Everyone:** Git and the GitHub CLI (`gh`), signed in. Run `clqn` from a GitHub clone of the project.
- **Members with workers:** push access, so their agents can push branches and open pull requests.
- **Clan leader:** admin access to link the repository (it sets up a webhook), and merge access to merge approved work.

The leader links the repository when creating the clan. To link or repair it later, run `clqn repo link` from the clone. See [GitHub webhooks](webhooks.md).

## From request to merge

1. You ask for work in chat. The orchestrator turns it into tasks.
2. Each worker's owner approves (or has automatic approval on). The worker starts in its own worktree on its own task branch (`clqn/task-<id>`), so your checkout is never touched. The worktree is a folder next to your clone, named after it plus the start of the task ID, for example `../project-1a2b3c4d`.
3. When the worker finishes, clqn commits, pushes the branch, opens a pull request, and posts the link in chat.
4. The leader reviews the PR on GitHub, then approves that commit in chat (**Ctrl+L**, then **Y**).
5. While the leader's chat is open, clqn squash-merges with the leader's `gh` sign-in once the GitHub checks pass and GitHub allows the merge. At least one check must succeed, so a repository without CI checks is never merged automatically. If the branch changes after approval, it needs approval again.

## Keeping main current

While chat is open, clqn keeps your local default branch (`main`, `master`, or whatever GitHub reports) up to date. A GitHub notification triggers a fetch and fast-forward within seconds of someone pushing. As a fallback, clqn also fetches at startup and every five minutes.

clqn only fast-forwards a clean checkout of the default branch, even if you're working in another worktree. It skips a checkout that has uncommitted changes, local commits, or diverged history, and never stashes, resets, rebases, or touches your task branches. If no worktree has the default branch checked out, it only fetches. Sync status appears in chat.

After you fix a skipped update, reopen chat or wait for the next push or fallback.

## How merges are recorded

Clan events record assignments, pull requests, approvals, merges, and changes to main. Once the repository's webhook delivers a signed pull request event, a merge on GitHub completes the matching task in chat. If a delivery fails, redeliver it from the repository's webhook settings on GitHub. For older links that only receive push events, clqn records a merge after the leader's clqn checks it with GitHub; run `clqn repo link` again to upgrade the link.
