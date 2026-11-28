---
name: pr
description: Open or review a clqn pull request. Use when asked to ship, push, open a PR, or review a PR (by number, branch, or the current diff).
---

# Pull requests in clqn

`main` is protected: every change lands through a pull request with passing CI and one approving review from someone other than the author. There is no bypass, so `gh pr merge --admin` fails.

## Open a pull request

1. **Branch.** Start from a fresh `origin/main` (`git fetch origin`). If the current checkout has unrelated or uncommitted work, use a separate worktree instead of stashing or resetting it.
2. **Stay focused.** One batch of related work per PR. Stage files by name; never `git add -A` over someone's unrelated changes.
3. **Check.** Run `npm run lint`, `npm run typecheck`, and `npm test`. Set `TEST_DATABASE_URL` to include the PostgreSQL tests when the change touches the API or schema. Schema changes need the generated migration (`NODE_OPTIONS=--conditions=clqn-source npm run db:generate`).
4. **Commit** as `<type>(optional scope): <brief description>`, for example `fix(api): reject expired invitations`. No AI attribution: no `Co-Authored-By: Claude`, `Claude-Session`, or "Generated with Claude Code" lines in commits or PR bodies.
5. **Push and open.** `git push -u origin <branch>`, then `gh pr create --base main` with a short title (same format as the commit) and a body of a few lines:
   - **What** changed
   - **Why**
   - **Testing**: the checks you ran
6. **Follow up.** Watch `gh pr checks <n> --watch` and fix failures with new commits. Report the PR URL and that it needs a teammate's approval to merge.

Stacked PRs: before merging the base PR with `--delete-branch`, retarget the stacked one (`gh pr edit <n> --base main`), or GitHub closes it.

## Review a pull request

1. **Gather.** `gh pr view <n>`, `gh pr diff <n>`, `gh pr checks <n>`. For anything nontrivial, check the branch out in a separate worktree and run the checks yourself.
2. **Look for bugs first**: correctness, races, error paths, missing tests. `/code-review` can do the bug hunt.
3. **Then check clqn's rules** (`AGENTS.md`):
   - Business logic and clan authorization live in the API; the CLI and MCP adapter stay thin.
   - Every resource is scoped by clan, credentials stay server-side, and shared context is treated as untrusted data.
   - No agent starts on a member's machine without that member's approval, and token, agent-count, and model limits are enforced.
   - Authorization, concurrent writes, and task ownership changes have tests.
   - Commands support `--json`. No new dependencies or subcommands without a clear need.
   - Git sync never rebases, resets, or stashes user work.
   - Within the current `ROADMAP.md` scope, small, and no overengineering.
4. **Report** findings to the user, most severe first, each with `file:line` and a concrete failure case. Say plainly if nothing is wrong.
5. **Post** to GitHub only when the user asks. Use `gh pr review <n> --comment` or `--request-changes` with the same findings; approve only when asked. The author cannot approve their own PR.
