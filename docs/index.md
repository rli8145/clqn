# Getting started

clqn is one terminal chat for your team and its AI agents. You ask the orchestrator for work, it splits the work into tasks, and your teammates' agents do them once each owner approves.

![clqn from creating a clan to an approved pull request](assets/demo.gif)

## Before you begin

[Install clqn](../README.md#install), then make sure you have:

- Git, and the GitHub CLI (`gh`) signed in with push access to the repository
- Claude Code or Codex CLI, installed and signed in

## Sign in

Run `clqn` in your project's GitHub clone. A full-screen setup page walks you through each step; press **Esc** to go back a step and **Ctrl+C** to quit. Press **Enter** to open GitHub (or **C** to copy the one-time code), then enter the code there. clqn uses the hosted server unless you choose another one with `clqn --api-url https://clqn.example.com`.

## Create or join a clan

A clan is your team's shared chat. Choose **Create a clan** and name it (the folder name is the default). Say yes when clqn offers to link the repository. Linking needs admin access to the GitHub repository. Then invite teammates: press **Ctrl+S** in the chat, type their email in **Invite**, and press **Enter**. From another terminal, `clqn invite teammate@example.com` does the same.

Your teammate runs `clqn` in their clone, signs in with the GitHub account for that email, and chooses **View clan invites**. Invitations expire after seven days.

To delete a clan you lead, open it, press **Ctrl+S**, go to **Delete clan**, type the clan's name, and press **Enter**. Deleting removes it for every member, along with its chat, tasks, agents, and repository links, and can't be undone.

When you create or join a clan, choose **Full access** or **Custom** [limits](policies.md) for agents on your machine.

## Start the session

Before the chat opens, clqn shows your [settings](chat.md#settings). The leader chooses **Start session**. Everyone else chooses **Join session** once the leader has started it; until then, **Check for session** looks again.

## Use the chat

Type a request, question, or piece of context and press **Enter**. The orchestrator answers below your message and, when it needs an agent on your machine, asks for your approval. See [chat and keys](chat.md).

Press **Ctrl+S** to open settings, where you choose which installed agents (Claude Code, Codex) to offer and change your limits.

Every time you run `clqn` it asks which clan to open, and you can also create or join one there. Press Enter to reopen the clan you used last.

## Try a first delegation

Use a linked practice repository with a pull request check. Have a teammate join from their own clone, enable an agent in **Ctrl+S**, and keep **Spawn approval** set to **Manual**.

1. Ask in chat, for example, “Ask a worker to add a short explanation of how to run the existing tests to the README. Keep the change limited to that file.”
2. The assigned member reviews the proposed task in **Ctrl+P** and presses **Y** to approve it. When the worker finishes, open its pull request from the chat.
3. Review the diff and checks in GitHub. If you want clqn to merge it, the leader selects that PR with **Ctrl+L** and approves the displayed commit with **Y**. Keep the leader's chat open while GitHub finishes its checks and applies repository merge rules.

See the [repository workflow](repositories.md) for worktrees, review, and default-branch sync. For setup and connection problems, see [troubleshooting](troubleshooting.md). See [architecture and trust boundaries](architecture.md) for where requests and data go.
