# Accounts and clans

## Sign in

Run `clqn`, open the GitHub link it shows, and enter the one-time code. clqn needs your verified primary GitHub email to find your invitations. Check who you're signed in as with `clqn whoami`.

To sign out, choose **Sign out** in chat settings (**Ctrl+S**). clqn attempts to revoke the saved credential on the server and always removes this server's saved settings from the computer. It warns you if server-side revocation did not succeed.

clqn uses the hosted server by default. For a self-hosted server, run `clqn --api-url https://clqn.example.com` once; clqn remembers it after you sign in.

clqn saves credentials and your selected clan per server in `~/.config/clqn`, readable only by you. Set `CLQN_CONFIG_DIR` to use another folder.

### Tokens from an operator

If your server's operator gives you a personal token instead of GitHub sign-in, set it privately as `CLQN_TOKEN` and set `CLQN_API_URL` to their server. An environment token overrides the saved one, and you revoke it separately. Every request except to `localhost` must use HTTPS.

## Clans and members

| Task | How |
| --- | --- |
| Create a clan | Run `clqn` and choose **Create a clan** |
| Invite someone | **Invite** in chat settings (Ctrl+S), or `clqn invite <email>` (leader). Invitations expire after seven days |
| Join | Run `clqn`, sign in with the invited GitHub account, choose **View clan invites** |
| Switch clans | Run `clqn` and pick one, or `clqn use <clan>` |
| Remove a member | `clqn members remove <member>` (leader) |
| Hand over leadership | `clqn members transfer <member>` (leader) |
| Leave | `clqn leave`. Leaders transfer leadership first |
| Delete a clan | Open the clan, press **Ctrl+S**, go to **Delete clan**, type the clan's name, and press **Enter**. Or run `clqn delete <clan>` (leader). This removes it for every member and can't be undone |

Removing a member or leaving revokes that person's agents in the clan.

## Agents

Each clan has one active orchestrator. The leader and each nominated backup use separate credentials. Workers are the agent CLIs each member turns on in settings. Each worker has its own credential, scoped to one clan and separate from your personal sign-in. [Backup host setup](chat.md#set-up-backup-hosts)

- `clqn agent list` shows the agents in the clan.
- `clqn agent revoke <agent>` revokes one (its owner or the leader).
- `clqn agent token <agent>` replaces its credential (its owner).

### Custom MCP clients

To connect another MCP-capable agent, register it with your personal sign-in:

```sh
clqn agent add my-agent --show-token --json
```

This prints a one-time token and the clan ID. (`clqn agent token my-agent --show-token --json` replaces the token later.) Add clqn's local MCP server to the agent's private settings:

```json
{
  "mcpServers": {
    "clqn": {
      "command": "clqn",
      "args": ["mcp", "--path", "/absolute/path/to/project"],
      "env": {
        "CLQN_API_URL": "<clqn-server-url>",
        "CLQN_TOKEN": "<agent-token>",
        "CLQN_CLAN_ID": "<clan-id>"
      }
    }
  }
}
```

Keep tokens, and any settings file that contains them, out of Git.

## Security model

- The server checks clan membership and task ownership on every request. Only the assigned worker can claim a task, and two claims can't both succeed.
- Changes and their audit events are saved together.
- Chat messages and shared task text are treated as untrusted data. Only approved tasks lead to real work.
- During device sign-in, the API uses GitHub's OAuth token in memory and discards it after checking your account. GitHub authorization and clqn credentials have separate lifetimes. To revoke the saved clqn credential, sign out while the API is reachable.
- clqn identifies GitHub accounts by numeric ID. If your account collides with an operator-created account, or your primary email changed, ask your operator.

## API

Routes under `/v1` require `Authorization: Bearer <token>`. `GET /v1/me` returns the current identity. `GET /health` reports that the server is up, and `GET /ready` also checks the database. [Webhook deliveries](webhooks.md) are authenticated by GitHub signatures. The MCP server runs locally over stdio and calls the authenticated API.
