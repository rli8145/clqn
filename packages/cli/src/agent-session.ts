import { createHash } from 'node:crypto';
import { constants, mkdirSync } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { agentRegistrationSchema, agentSchema, ClqnClient, modelIdSchema, type WorkerCommands } from '@clqn/shared';
import { configDirectory, writePrivateJson } from './config.js';

export const runtimes = ['codex', 'claude'] as const;
export type Runtime = (typeof runtimes)[number];

export const runtimeNames: Record<Runtime, string> = { claude: 'Claude Code', codex: 'Codex' };

export function orchestratorRuntime(installed: Runtime[], off: Runtime[], backup: boolean) {
  return installed.find((runtime) => !off.includes(runtime)) ?? (backup ? undefined : installed[0]);
}

// On Windows, spawning `claude` without a shell also runs claude.com or claude.exe, and the native Claude Code
// installer adds only claude.exe to PATH.
const programNames = (runtime: Runtime, platform: NodeJS.Platform) =>
  platform === 'win32' ? [runtime, `${runtime}.com`, `${runtime}.exe`] : [runtime];

async function installed(runtime: Runtime, path: string, platform: NodeJS.Platform) {
  const directories = path.split(delimiter).filter(Boolean);
  return Promise.any(
    directories.flatMap((directory) =>
      programNames(runtime, platform).map(async (name) => {
        const file = resolve(directory, name);
        await access(file, constants.X_OK);
        if (!(await stat(file)).isFile()) throw new Error();
      }),
    ),
  ).then(
    () => true,
    () => false,
  );
}

// The agent CLIs on PATH, in the order the orchestrator prefers them.
export async function installedRuntimes(
  path = process.env.PATH ?? '',
  platform = process.platform,
): Promise<Runtime[]> {
  const found = await Promise.all(runtimes.map((runtime) => installed(runtime, path, platform)));
  return runtimes.filter((_, index) => found[index]);
}

// Agents the member turned off on this machine. Saving what is off keeps newly installed agents on.
const choicesPath = () => join(configDirectory(), 'agents.json');

export async function readAgentsOff(): Promise<Runtime[]> {
  try {
    const value: unknown = JSON.parse(await readFile(choicesPath(), 'utf8'));
    const off = (value as { off?: unknown } | null)?.off;
    return runtimes.filter((runtime) => Array.isArray(off) && off.includes(runtime));
  } catch {
    return [];
  }
}

export function saveAgentsOff(off: Runtime[]): Promise<void> {
  return writePrivateJson(choicesPath(), { off: runtimes.filter((runtime) => off.includes(runtime)) });
}

// Keep hosting preferences local to this device, member, clan, and server.
const hostingPath = (directory: string, server: string, clanId: string, userId: string) => {
  const key = JSON.stringify([new URL(server).origin, clanId, userId]);
  return join(configDirectory(), directory, `${createHash('sha256').update(key).digest('hex')}.json`);
};

export async function readBackupHosting(server: string, clanId: string, userId: string): Promise<boolean> {
  try {
    return JSON.parse(await readFile(hostingPath('backup-hosting', server, clanId, userId), 'utf8')) === true;
  } catch {
    return false;
  }
}

export function saveBackupHosting(server: string, clanId: string, userId: string, enabled: boolean): Promise<void> {
  return writePrivateJson(hostingPath('backup-hosting', server, clanId, userId), enabled);
}

const orchestratorModelId = modelIdSchema.refine((model) => !/^-|[\x00-\x1f\x7f-\x9f]/.test(model));

export async function readOrchestratorModel(server: string, clanId: string, userId: string, runtime: Runtime) {
  try {
    const path = hostingPath(`orchestrator-model/${runtime}`, server, clanId, userId);
    return orchestratorModelId.safeParse(JSON.parse(await readFile(path, 'utf8'))).data ?? '';
  } catch {
    return '';
  }
}

export async function saveOrchestratorModel(
  server: string,
  clanId: string,
  userId: string,
  runtime: Runtime,
  text: string,
) {
  const model = text.trim();
  if (model && !orchestratorModelId.safeParse(model).success)
    throw new Error('Enter a model ID without spaces, or leave it blank for the default');
  await writePrivateJson(hostingPath(`orchestrator-model/${runtime}`, server, clanId, userId), model || null);
}

export type AgentProfile = {
  agentId: string;
  clanId: string;
  server: string;
  token: string;
  runtime?: Runtime | undefined;
};

export function agentProfilePath(server: string, agentId: string): string {
  const origin = new URL(server).origin;
  const hash = createHash('sha256').update(origin).digest('hex');
  return resolve(configDirectory(), 'agents', `${hash}-${agentId}.json`);
}

export async function readAgentProfile(path: string): Promise<AgentProfile | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    const profile = {
      agentId: agentSchema.shape.id.parse(value.agentId),
      clanId: agentSchema.shape.clanId.parse(value.clanId),
      server: new URL(value.server).origin,
      token: agentRegistrationSchema.shape.token.parse(value.token),
      runtime: runtimes.find((runtime) => runtime === value.runtime),
    };
    new ClqnClient(profile.server, profile.token);
    return profile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Could not read the saved agent connection.');
  }
}

export async function saveAgentProfile(profile: AgentProfile): Promise<void> {
  await writePrivateJson(agentProfilePath(profile.server, profile.agentId), profile);
}

export interface AgentCommand {
  command: Runtime;
  args: string[];
  env: NodeJS.ProcessEnv;
}

const workerSandbox = {
  sandbox: {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: ['registry.npmjs.org'] },
  },
};

export const codexSandbox = {
  off: { mode: 'read-only', policy: 'readOnly' },
  sandboxed: { mode: 'workspace-write', policy: 'workspaceWrite' },
  unrestricted: { mode: 'danger-full-access', policy: 'dangerFullAccess' },
} as const satisfies Record<WorkerCommands, { mode: string; policy: string }>;

interface AgentCommandOptions {
  project: string;
  role: 'orchestrator' | 'worker';
  model?: string | null | undefined;
  commands?: WorkerCommands | undefined;
  // Workers with live follow-ups use a bidirectional runtime session.
  live?: boolean | undefined;
  // Rules added to the system (Claude Code) or developer (Codex) instructions, so they hold for every turn.
  instructions?: string | undefined;
}

interface McpCommand {
  command: string;
  args: string[];
  profilePath: string;
}

const codexDisabled = ['--disable', 'hooks', '--disable', 'plugins', '--disable', 'apps'];

function codexMcpArgs(mcp: McpCommand | undefined) {
  if (!mcp) return [];
  return [
    '-c',
    // Codex cannot ask for approval in clqn chat, so approve clqn tool calls at runtime.
    `mcp_servers.clqn={command=${JSON.stringify(mcp.command)},args=${JSON.stringify(mcp.args)},default_tools_approval_mode="approve"}`,
    '-c',
    `shell_environment_policy.set.CLQN_AGENT_PROFILE=${JSON.stringify(mcp.profilePath)}`,
  ];
}

function codexLiveArgs(commands: WorkerCommands, mcp: McpCommand | undefined) {
  return [
    'app-server',
    '--listen',
    'stdio://',
    '-c',
    'approval_policy="never"',
    '-c',
    `sandbox_mode="${codexSandbox[commands].mode}"`,
    '-c',
    'sandbox_workspace_write.network_access=false',
    '-c',
    'sandbox_workspace_write.writable_roots=[]',
    ...codexDisabled,
    ...codexMcpArgs(mcp),
  ];
}

function codexExecArgs(options: AgentCommandOptions, commands: WorkerCommands, mcp: McpCommand | undefined) {
  const sandboxArgs =
    commands === 'unrestricted'
      ? ['--dangerously-bypass-approvals-and-sandbox']
      : ['--sandbox', codexSandbox[commands].mode];

  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    // Skip the member's own Codex config: it adds context to every turn. Sign-in still works.
    '--ignore-user-config',
    ...(options.role === 'orchestrator'
      ? [
          '-c',
          'model_reasoning_effort="low"',
          '-c',
          'project_doc_max_bytes=0',
          '--disable',
          'shell_tool',
          ...codexDisabled,
        ]
      : []),
    ...sandboxArgs,
    ...(options.model ? ['-m', options.model] : []),
    ...(options.instructions ? ['-c', `developer_instructions=${JSON.stringify(options.instructions)}`] : []),
    ...codexMcpArgs(mcp),
    '-',
  ];
}

function claudeArgs(
  options: AgentCommandOptions,
  commands: WorkerCommands,
  live: boolean,
  npmCache: string,
  mcp: McpCommand | undefined,
) {
  const orchestrator = options.role === 'orchestrator';
  return [
    '--print',
    ...(live
      ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
      : ['--output-format', 'json']),
    ...(options.instructions ? ['--append-system-prompt', options.instructions] : []),
    ...(orchestrator ? ['--effort', 'low'] : []),
    ...(options.model ? ['--model', options.model] : []),
    '--strict-mcp-config',
    ...(mcp
      ? [
          '--mcp-config',
          JSON.stringify({ mcpServers: { clqn: { type: 'stdio', command: mcp.command, args: mcp.args } } }),
        ]
      : []),
    // Workers keep the repo's skills. Planning turns get only their supplied instructions and chat context.
    '--setting-sources',
    orchestrator ? '' : 'project,local',
    ...(orchestrator ? ['--disable-slash-commands', '--tools', ''] : []),
    // Sandboxed workers run commands without prompts inside Claude Code's OS sandbox: writes stay in the
    // worktree (git metadata included, hooks and config excluded) and the network is limited to the npm
    // registry. npm's cache moves out of ~/.npm, which the sandbox blocks, into a directory it may write.
    ...(commands === 'sandboxed' ? ['--settings', JSON.stringify(workerSandbox), '--add-dir', npmCache] : []),
    '--permission-mode',
    commands === 'unrestricted' ? 'bypassPermissions' : orchestrator ? 'default' : 'acceptEdits',
    ...(mcp ? ['--allowedTools', 'mcp__clqn'] : []),
  ];
}

// Prompts go to stdin. Planning turns run without clqn credentials or action tools. Workers use their clqn MCP
// server and run commands as the member's settings allow. Codex cannot edit without commands, so `off` is read-only.
export function agentCommand(runtime: Runtime, profilePath: string, options: AgentCommandOptions): AgentCommand {
  const commands = options.role === 'worker' ? (options.commands ?? 'sandboxed') : 'off';
  const live = options.role === 'worker' && options.live === true;
  const npmCache = join(configDirectory(), 'npm-cache');
  const mcp =
    options.role === 'worker'
      ? {
          command: process.execPath,
          // The parent chat already watches the project.
          args: [resolve(process.argv[1]!), 'mcp', '--profile', profilePath, '--path', options.project, '--no-sync'],
          profilePath,
        }
      : undefined;
  let runtimeArgs: string[];
  if (runtime === 'claude') runtimeArgs = claudeArgs(options, commands, live, npmCache, mcp);
  else if (live) runtimeArgs = codexLiveArgs(commands, mcp);
  else runtimeArgs = codexExecArgs(options, commands, mcp);

  const env = { ...process.env };
  if (mcp) env.CLQN_AGENT_PROFILE = profilePath;
  else delete env.CLQN_AGENT_PROFILE;
  if (runtime === 'claude' && commands === 'sandboxed') {
    mkdirSync(npmCache, { recursive: true, mode: 0o700 });
    env.npm_config_cache = npmCache;
  }
  delete env.CLQN_TOKEN;
  delete env.CLQN_CLAN_ID;
  return { command: runtime, args: runtimeArgs, env };
}

type Json = { [key: string]: unknown };
const object = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const count = (...values: unknown[]) =>
  values.reduce<number>((sum, value) => sum + (typeof value === 'number' && value > 0 ? value : 0), 0);

// Total input and output tokens and the final message from a finished run's stdout.
export function agentOutput(runtime: Runtime, stdout: string): { tokens: number; text?: string; error?: string } {
  let tokens = 0;
  let text: string | undefined;
  let error: string | undefined;
  for (const line of runtime === 'codex' ? stdout.split('\n') : [stdout]) {
    let event: Json;
    try {
      event = object(JSON.parse(line));
    } catch {
      continue;
    }
    // Tokens count everything but cache reads: each API call resends the whole conversation, mostly from the
    // cache, so adding cache reads would count the same context again on every call. See docs/chat.md.
    if (runtime === 'claude') {
      // Claude Code reports usage summed over the run.
      const usage = object(event.usage);
      tokens = count(usage.input_tokens, usage.cache_creation_input_tokens, usage.output_tokens);
      if (typeof event.result === 'string') text = event.result;
      if (event.is_error === true) error = text ?? 'Claude Code reported an error';
    } else if (event.type === 'turn.completed') {
      // Codex input tokens include cached input.
      const usage = object(event.usage);
      tokens += count(usage.input_tokens, usage.output_tokens) - count(usage.cached_input_tokens);
    } else if (event.type === 'turn.failed' || event.type === 'error') {
      const detail = event.type === 'error' ? event.message : object(event.error).message;
      if (typeof detail === 'string') error = detail;
    } else if (event.type === 'item.completed') {
      const item = object(event.item);
      if (item.type === 'agent_message' && typeof item.text === 'string') text = item.text;
    }
  }
  return {
    tokens: Math.min(tokens, Number.MAX_SAFE_INTEGER),
    ...(text?.trim() ? { text: text.trim() } : {}),
    ...(error ? { error: plainError(error) } : {}),
  };
}

// Runtime errors are shown on one status line, so keep them short and free of control characters.
const plainError = (text: string) =>
  text
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .trim()
    .slice(0, 160);
