# clqn — Roadmap

Type `clqn`, and a chat opens in your terminal. You talk to one orchestrator agent, and it gets the work done using your team's agents. Tasks, branches, and agents all happen behind the scenes.

## How it works

1. **Type `clqn`.** That's the only command. The first time, it signs you in with GitHub.
2. **Make or join a clan.** Pick "Create a clan" or "Join a clan" (your invites are listed). Then the full-screen chat opens, and everything happens there.
3. **Message the orchestrator.** One host routes each message as it arrives. The leader normally hosts, and nominated members can opt in to cover when a host goes offline.
4. **The orchestrator splits up the work.** Sub-orchestrators plan independent tasks in parallel on the host. Follow-ups go to the existing task and its approved worker session.
5. **You say yes or no.** When the orchestrator wants to start an agent on your machine, you get asked. Type `y` or `n`. It never goes over your limits.
6. **Watch it happen.** A sidebar shows who's working, task progress, and tokens used over time.
7. **Review the pull request.** Workers publish code changes from their task branches. The clan leader reviews the PR and approves its commit in chat. clqn merges approved work once checks pass.
8. **Your `main` stays current.** While chat is open, GitHub notifications trigger a fast-forward of clean local default-branch checkouts.

## Member limits

Each member sets their own:

- **Token limit:** total tokens their agents can use
- **Agent count:** how many agents can run on their machine at once
- **Models:** which models their agents are allowed to use

## What's done

- Full-screen landing page for setup: sign-in, clan choice, limits, repository linking, and session settings, one step at a time with Esc to go back
- `clqn` is the only command: it signs you in with GitHub, offers "Create a clan" or "Join a clan" (with your pending invites), and opens the chat. "Sign out" is in settings (Ctrl+S)
- Invite teammates by email
- The chat screen: a full-screen chat, saved on the server, with an agents sidebar and settings (Ctrl+S)
- Chat messages and task context saved in PostgreSQL, including requests sent while the host is offline
- One active orchestrator per clan, hosted by the leader or an opted-in backup, with parallel task planning and live follow-ups to approved workers
- Backup hosts: the leader nominates members with `clqn host`; each opts in with **Backup hosting** in settings and takes over the orchestrator lease when the host goes offline
- Force-send (Ctrl+F) gives a message priority while task planning and approved workers continue
- Stop a running agent (Ctrl+X or ■ Stop) and later ask the orchestrator to continue the same task in its worktree, branch, and pull request
- Yes/no approvals in the chat (Ctrl+P, then `y`/`n`), or automatic approval
- Approved agents start in the background on the member's machine, with the approved model
- Limits: new members pick Full access (no limits) or Custom when they join; edit token, agent-count, and model limits in settings (Ctrl+S). All are enforced before each delegation
- Live sidebar: each delegation's task, worker, status, and tokens
- Metrics view (Ctrl+G): tokens and active agents over time, tokens by member and by task, and queue wait, over 24h or 7d
- GitHub repository linking during chat setup. Signed push webhooks and a slow fallback keep clean default-branch checkouts current while chat is open
- Worker branches and PRs are published to the linked repository. Clan-leader approval and passing GitHub checks gate merges, and the clan can follow the PR from chat
- The API runs on Google Cloud (Cloud Run + PostgreSQL)
- Choose your agents: settings (Ctrl+S) list the agent CLIs on your machine (Claude Code, Codex), each on or off. Each one that's on is a worker the orchestrator can pick
- User-focused README with a demo GIF, and docs and website matched to the current chat keys and settings

## What's next

- Nothing queued. Pick from **Later**.

## Later

- **clqn logo in TUI**

## Ground rules

- **Your machine, your call.** Nothing runs on your computer without your "yes".
- **Hide the plumbing.** People chat and approve. Tasks, branches, and agents are the orchestrator's job.
- **Keep it simple.** Small working steps, few dependencies, minimal cloud setup.
- **Chat isn't a command.** Treat messages as untrusted. Only approved tasks lead to real work.
- **Never touch your work.** Only sync a clean `main`. Never rebase, reset, or stash your changes.
- **Secrets stay on the server**, and everything is scoped to its clan.
