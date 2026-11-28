import { randomUUID } from 'node:crypto';
import { emitKeypressEvents, type Key } from 'node:readline';
import {
  ApiError,
  allowedModelsSchema,
  type ChatMessage,
  type ChatMetrics,
  type ChatMetricsWindow,
  type ChatSettings,
  type ChatState,
  type ClqnClient,
  chatPlannerLimitSchema,
  createInvitationSchema,
  type SendChat,
} from '@clqn/shared';
import type { AgentChoices } from './agent-runner.js';
import { orchestratorRuntime, type Runtime, runtimes } from './agent-session.js';
import {
  backupHostingField,
  characters,
  chatFrame,
  clip,
  deleteClanField,
  type Frame,
  messageLines,
  orchestratorModelField,
  painter,
  plain,
  plannerLimitField,
  type StopTarget,
  settingsFields,
  settingsLines,
  threaded,
  transcriptColumns,
} from './chat-view.js';
import { type LandingFrame, type LandingView, openLinkAt } from './landing.js';
import { metricsFrame } from './metrics-view.js';
import { chatMerger, chatPullRequests, pullRequestKey, pullRequestsFrame } from './pull-requests.js';
import { leftoverNotice } from './setup.js';
import { mouseReportReader, terminalSizeNotice, terminalText } from './terminal.js';

const ctrlShortcuts: Record<string, string> = { s: 'f2', p: 'f3', q: 'f4', g: 'f5', l: 'f6' };
const help = (error: unknown) => (error instanceof Error ? error.message : 'Request failed');
const numeric = (text: string) => {
  if (!text || /^(none|∞)$/i.test(text)) return null;
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number)) throw new Error('Limits must be whole numbers or none');
  return number;
};
const models = (text: string) => {
  if (!text.trim() || /^any$/i.test(text.trim())) return null;
  const parsed = allowedModelsSchema.safeParse(text.split(',').map((model) => model.trim()));
  if (!parsed.success) throw new Error('Models must be unique names without spaces, separated by commas');
  return parsed.data;
};
const parallelPlanning = (text: string) => {
  if (!text || /^auto$/i.test(text)) return null;
  const parsed = chatPlannerLimitSchema.safeParse(/^\d+$/.test(text) ? Number(text) : undefined);
  if (!parsed.success) throw new Error('Planners must be a positive whole number or Auto');
  return parsed.data;
};

type Info = Awaited<ReturnType<ClqnClient['chatInfo']>>;
export type ChatResult = 'quit' | 'sign-out' | 'back' | { deleted: string };
type Setup = Omit<NonNullable<Parameters<typeof chatFrame>[0]['settings']>, 'action'> & {
  originalPlannerLimit?: number | null;
};
// Leaders get an Invite row before the session action, which shifts the last two rows down.
const setupFor = (settings: ChatSettings, leader: boolean, plannerLimit?: number | null): Setup => ({
  value: settings,
  tokenText: settings.tokenLimit?.toString() ?? '',
  agentText: settings.agentLimit?.toString() ?? '',
  modelText: settings.allowedModels?.join(', ') ?? '',
  ...(leader ? { inviteText: '', deleteText: '' } : {}),
  ...(leader && plannerLimit !== undefined
    ? { plannerText: plannerLimit?.toString() ?? '', originalPlannerLimit: plannerLimit }
    : {}),
  field: leader ? 7 : 6,
});
const settingsRows = (setup: Setup) => (setup.inviteText === undefined ? 8 : 9);

// Background agents that follow the polled chat state and report a short status line.
export interface ChatAgents {
  update(state: ChatState): void;
  status(): string | undefined;
  // Calls back after each orchestrator turn, when the chat has likely changed.
  listen?(listener: () => void): void;
  // The agent CLIs installed on this machine and which the member turned off.
  choices(userId: string): Promise<AgentChoices>;
  choose(off: Runtime[]): Promise<void>;
  setOrchestratorModel(userId: string, runtime: Runtime, model: string): Promise<void>;
  backupHosting(): boolean | undefined;
  setBackupHosting(enabled: boolean): Promise<void>;
  // Running tasks this member can stop, with when this machine started each.
  stoppable?(): Map<string, number | undefined>;
  stopRun?(taskId: string): Promise<string>;
}

// Step through every on/off combination of the installed agents, all on first.
function nextChoice(choices: AgentChoices, step: number): AgentChoices {
  const { installed } = choices;
  const combinations = 2 ** installed.length;
  const mask = installed.reduce((bits, runtime, index) => bits | (choices.off.includes(runtime) ? 1 << index : 0), 0);
  const next = (mask + step + combinations) % combinations;
  const kept = choices.off.filter((runtime) => !installed.includes(runtime));
  return { ...choices, off: [...kept, ...installed.filter((_, index) => next & (1 << index))] };
}

// Resolves when the user quits, with 'sign-out' when they choose Sign out in settings, or with a notice
// after the leader deletes the clan.
export async function runChat(
  api: ClqnClient,
  clanId: string,
  agents?: ChatAgents,
  options?: {
    repositoryStatus?: () => string | undefined;
    // Draws the settings shown before joining a session on the landing page; Esc there returns 'back'.
    page?: (view: { columns: number; rows: number; color: boolean; content: LandingView['content'] }) => LandingFrame;
    // Deletes this clan; returns the repositories whose webhooks could not be removed.
    deleteClan?: () => Promise<{ webhooksLeft: string[] }>;
  },
): Promise<ChatResult> {
  const { stdin, stdout } = process;
  const actor = await api.whoami();
  if (actor.agentId) throw new Error('Sign in with a personal credential to open the chat');
  let info: Info = await api.chatInfo(clanId);
  let setup: Setup | undefined = setupFor(info.settings, info.canStart);
  let saved: AgentChoices | undefined;
  void loadChoices();
  let result: ChatResult = 'quit';
  let replaceField = true;
  let state: ChatState | undefined;
  let draft = '';
  let caret = 0;
  let scroll = 0;
  let maxScroll = 0;
  const older: ChatMessage[] = [];
  let recent: ChatMessage[] = [];
  let historyCursor: number | null = null;
  let loadOlder = false;
  let approval = 0;
  let approvalFocused = false;
  let reply: ChatMessage | undefined;
  let notice: string | undefined;
  let connection: string | undefined;
  let busy = false;
  let refreshing = false;
  let again = false;
  let tick = 0;
  let sending = false;
  let failed = false;
  let closed = false;
  let paste: string | undefined;
  let metrics: { window: ChatMetricsWindow; data?: ChatMetrics; at: number } | undefined;
  let reviews: { selected?: string } | undefined;
  // The running task whose stop waits for y/n, and where the sidebar's Stop labels were last drawn.
  let stopping: string | undefined;
  let stopTargets: StopTarget[] = [];
  const outbox: SendChat[] = [];
  const controller = new AbortController();
  const merger = chatMerger(api, clanId, controller.signal);
  let pageLinks: LandingFrame['links'] = [];
  const readMouse = mouseReportReader(
    (lines) => {
      if (!state || setup || metrics || reviews) return;
      scrollBy(lines);
      draw();
    },
    (column, row) => {
      openLinkAt(pageLinks, column, row);
      if (!state || setup || metrics || reviews) return;
      const target = stopTargets.find(
        (stop) => stop.row === row - 1 && column - 1 >= stop.column && column - 1 < stop.column + stop.width,
      );
      if (!target) return;
      stopping = target.taskId;
      approvalFocused = false;
      draw();
    },
  );

  // This member's running tasks that can be stopped, in sidebar order.
  function stoppableTasks() {
    const stoppable = agents?.stoppable?.();
    return (state?.runs ?? [])
      .filter((run) => run.status === 'running' && stoppable?.has(run.taskId))
      .map(({ taskId }) => taskId);
  }

  async function halt(taskId: string) {
    if (!agents?.stopRun) return;
    try {
      notice = await agents.stopRun(taskId);
    } catch (error) {
      notice = help(error);
    } finally {
      void refresh();
      draw();
    }
  }

  function rows() {
    return stdout.rows || 24;
  }

  function columns() {
    return stdout.columns || 80;
  }

  function messages() {
    return threaded([...older, ...recent]);
  }

  function backupHosting() {
    return state?.orchestration?.backup && setup?.inviteText === undefined ? agents?.backupHosting() : undefined;
  }

  function modelRuntime() {
    const hosting = state?.orchestration;
    const choices = setup?.agents;
    if (choices && (state ? state.work && hosting?.eligible : info.canStart))
      return orchestratorRuntime(choices.installed, choices.off, hosting?.backup ?? false);
  }

  function draw() {
    if (closed) return;
    const session = state?.session ?? info.session;
    const orchestration = state?.orchestration;
    const host = orchestration ? (orchestration.activeHost ?? undefined) : session?.host;
    const pullRequests = chatPullRequests(state);
    const stoppable = agents?.stoppable?.();
    if (stopping && !stoppableTasks().includes(stopping)) stopping = undefined;
    const background = [
      agents?.status(),
      orchestration && !host && state?.queued ? 'Orchestrator offline · messages saved' : undefined,
      options?.repositoryStatus?.(),
    ]
      .filter(Boolean)
      .join(' · ');
    const settings = setup && {
      ...setup,
      backupHosting: backupHosting(),
      orchestratorRuntime: modelRuntime(),
      action: busy
        ? 'Connecting…'
        : state
          ? 'Save settings'
          : session
            ? 'Join session'
            : info.canStart
              ? 'Start session'
              : 'Check for session',
    };
    const color = !('NO_COLOR' in process.env);
    const chat = chatFrame({
      columns: columns(),
      rows: rows(),
      color,
      clan: session?.clan ?? info.clan,
      host,
      userId: actor.id,
      state,
      frame: tick,
      messages: messages(),
      settings,
      draft,
      caret,
      scroll,
      hasOlder: historyCursor !== null,
      approval,
      approvalFocused,
      hasPullRequests: pullRequests.length > 0,
      reply,
      stoppable,
      stopping,
      now: Date.now(),
      notice:
        notice ??
        connection ??
        (failed ? 'Message unsent · Ctrl+R Retry' : outbox.length ? 'Sending…' : undefined) ??
        (background || undefined),
    });
    if (chat.history) {
      scroll = chat.history.offset;
      maxScroll = chat.history.max;
    }
    stopTargets = chat.stops ?? [];
    let frame: Frame = chat;
    pageLinks = [];
    if (settings && !state && options?.page) {
      const paint = painter(color);
      const warning = notice ?? connection;
      const page = options.page({
        columns: columns(),
        rows: rows(),
        color,
        content: (width, height) =>
          settingsLines(settings, width, paint, height, warning ? paint(clip(plain(warning), width), 'warning') : ''),
      });
      pageLinks = page.links;
      frame = page;
    }
    if (metrics)
      frame = metricsFrame({
        columns: columns(),
        rows: rows(),
        color: !('NO_COLOR' in process.env),
        clan: session?.clan ?? info.clan,
        window: metrics.window,
        metrics: metrics.data,
        notice,
      });
    if (reviews)
      frame = pullRequestsFrame({
        columns: columns(),
        rows: rows(),
        color: !('NO_COLOR' in process.env),
        links: process.env.TERM !== 'dumb',
        clan: session?.clan ?? info.clan,
        requests: pullRequests,
        selected: reviews.selected,
        status: merger.status(reviews.selected),
        notice,
      });
    // Draw in one write to keep polling from moving the input cursor or scrolling the shell.
    const screen = frame.lines.map((line, index) => `\x1b[${index + 1};1H\x1b[2K${line}`).join('');
    const cursor = frame.cursor ? `\x1b[${frame.cursor.row + 1};${frame.cursor.column + 1}H\x1b[?25h` : '';
    stdout.write(
      `\x1b[?25l${screen}\x1b[${Math.min(rows(), frame.lines.length + 1)};1H${frame.lines.length < rows() ? '\x1b[J' : ''}${cursor}`,
    );
  }

  function mergeState(next: ChatState) {
    const first = next.messages[0]?.sequence ?? 0;
    const last = next.messages.at(-1)?.sequence ?? 0;
    if (scroll && recent.length) {
      const previous = recent.at(-1)!.sequence;
      const transcript = transcriptColumns(columns());
      scroll += next.messages
        .filter((message) => message.sequence > previous)
        .reduce((sum, message) => sum + messageLines(message, transcript, actor.id).length, 0);
    }
    const displaced = recent.filter((message) => message.sequence < first);
    if (displaced.length) older.push(...displaced);
    recent = [...next.messages, ...recent.filter((message) => message.sequence > last)];
    if (older.length === 0) historyCursor = next.before;
    const selectedApproval = state?.approvals[approval]?.messageId;
    const index = next.approvals.findIndex(({ messageId }) => messageId === selectedApproval);
    approval = Math.max(index, 0);
    if (!next.approvals.length) approvalFocused = false;
    state = next;
    if (setup?.field === backupHostingField && backupHosting() === undefined) setup.field = 6;
    agents?.update(next);
    merger.update(chatPullRequests(next));
  }

  async function loadMetrics() {
    const view = metrics;
    if (!view) return;
    view.at = Date.now();
    try {
      const data = await api.chatMetrics(clanId, view.window, controller.signal);
      if (metrics?.window === data.window) metrics.data = data;
    } catch (error) {
      if (!closed) notice = help(error);
    } finally {
      draw();
    }
  }

  async function refresh() {
    if (metrics && Date.now() - metrics.at > 30_000) void loadMetrics();
    if (refreshing) again = true;
    if (closed || refreshing) return;
    if (!state) {
      draw();
      return;
    }
    refreshing = true;
    again = false;
    try {
      mergeState(await api.chatState(clanId, controller.signal));
      connection = undefined;
    } catch (error) {
      if (!closed) connection = `Chat disconnected · ${help(error)}`;
    } finally {
      refreshing = false;
      draw();
    }
    // A refresh asked for mid-request may need newer state than that request returned.
    if (again) void refresh();
  }

  async function loadChoices() {
    const currentSetup = setup;
    const initialChoices = currentSetup?.agents;
    try {
      const choices = await agents?.choices(actor.id);
      if (currentSetup && setup === currentSetup && !busy && currentSetup.agents === initialChoices) {
        saved = choices;
        currentSetup.agents = choices;
      }
    } catch {
      // Keep the last known choices if the refresh fails.
    }
    draw();
  }

  async function save() {
    if (busy || !setup) return;
    busy = true;
    notice = undefined;
    draw();
    try {
      if (!info.session && !info.canStart) {
        info = await api.chatInfo(clanId, controller.signal);
        if (!info.session && !info.canStart) {
          notice = 'Waiting for the clan leader to start this session';
          return;
        }
      }
      const { value, tokenText, agentText, modelText, plannerText, originalPlannerLimit } = setup;
      const plannerLimit = plannerText === undefined ? undefined : parallelPlanning(plannerText);
      const settings = {
        ...value,
        tokenLimit: numeric(tokenText),
        agentLimit: numeric(agentText),
        allowedModels: models(modelText),
      };
      const chosen = setup.agents;
      if (chosen && agents && saved) {
        for (const runtime of runtimes) {
          const model = chosen.orchestratorModels[runtime];
          if (model !== saved.orchestratorModels[runtime]) await agents.setOrchestratorModel(actor.id, runtime, model);
        }
      }
      await api.joinChat(clanId, settings, controller.signal);
      if (plannerLimit !== undefined && plannerLimit !== originalPlannerLimit) {
        await api.setChatPlannerLimit(clanId, plannerLimit, controller.signal);
        setup.originalPlannerLimit = plannerLimit;
      }
      if (chosen && agents) {
        if (chosen.off.join() !== saved?.off.join()) await agents.choose(chosen.off);
        saved = chosen;
      }
      mergeState(await api.chatState(clanId, controller.signal));
      setup = undefined;
    } catch (error) {
      notice = help(error);
    } finally {
      busy = false;
      draw();
    }
  }

  async function olderPage() {
    if (loadOlder || !historyCursor) return;
    loadOlder = true;
    try {
      const page = await api.chatHistory(clanId, historyCursor, controller.signal);
      older.unshift(...page.messages);
      historyCursor = page.before;
    } catch (error) {
      notice = help(error);
    } finally {
      loadOlder = false;
      draw();
    }
  }

  async function flush() {
    if (sending) return;
    sending = true;
    failed = false;
    let pending: SendChat | undefined;
    try {
      while (outbox.length && !closed) {
        pending = outbox.find(({ force }) => force) ?? outbox[0]!;
        const message = await api.sendChat(clanId, pending, controller.signal);
        if (!recent.some(({ id }) => id === message.id)) recent.push(message);
        outbox.splice(outbox.indexOf(pending), 1);
        if (pending.force) void refresh();
        draw();
      }
      void refresh();
    } catch (error) {
      failed = true;
      notice = `Unsent · ${help(error)} · Ctrl+R Retry`;
    } finally {
      sending = false;
      draw();
      if (failed && !pending?.force && outbox.some(({ force }) => force) && !closed) void flush();
    }
  }

  async function decide(approve: boolean) {
    const pending = state?.approvals[approval];
    if (!pending || busy) return;
    busy = true;
    try {
      await api.approveChat(clanId, pending.messageId, approve, controller.signal);
      approvalFocused = false;
      notice = approve ? 'Delegation approved' : 'Delegation declined';
      void refresh();
    } catch (error) {
      notice = help(error);
      if (error instanceof ApiError && error.code === 'CHAT_CONFLICT') void refresh();
    } finally {
      busy = false;
      draw();
    }
  }

  async function decideMerge(approve: boolean) {
    const pending = chatPullRequests(state).find((request) => pullRequestKey(request) === reviews?.selected);
    if (!pending?.canReview || busy || columns() < 28 || rows() < 12) return;
    busy = true;
    try {
      await api.decideChatMerge(clanId, pending.taskId, pending.repository.headSha, approve, controller.signal);
      notice = approve ? 'Approved · will merge when checks pass' : 'Merge declined';
    } catch (error) {
      notice = help(error);
    } finally {
      busy = false;
      void refresh();
      draw();
    }
  }

  // Invites go to the open clan; the API still checks that the user leads it.
  async function invite() {
    if (busy || setup?.inviteText === undefined) return;
    const parsed = createInvitationSchema.safeParse({ email: setup.inviteText });
    if (!parsed.success) {
      notice = 'Enter a valid email address to invite';
      return;
    }
    busy = true;
    notice = undefined;
    draw();
    try {
      const { email } = await api.createInvitation(clanId, parsed.data.email);
      notice = `Invited ${email}. They run clqn and choose View clan invites.`;
      setup.inviteText = '';
      replaceField = true;
    } catch (error) {
      notice = help(error);
    } finally {
      busy = false;
      draw();
    }
  }

  async function removeClan() {
    if (!setup || setup.deleteText === undefined || busy || !options?.deleteClan) return;
    const name = (state?.session ?? info.session)?.clan ?? info.clan;
    if (setup.deleteText.trim().toLowerCase() !== name.trim().toLowerCase()) {
      notice = 'Type the clan name exactly to delete it.';
      return;
    }
    busy = true;
    draw();
    try {
      const { webhooksLeft } = await options.deleteClan();
      result = { deleted: terminalText(`Deleted ${name}.`, false) + leftoverNotice(webhooksLeft) };
      stop();
    } catch (error) {
      notice = help(error);
    } finally {
      busy = false;
      draw();
    }
  }

  async function toggleBackupHosting() {
    const current = backupHosting();
    if (busy || current === undefined || !agents || columns() < 28 || rows() < 12) return;
    busy = true;
    try {
      await agents.setBackupHosting(!current);
    } catch (error) {
      notice = help(error);
    } finally {
      busy = false;
      draw();
    }
  }

  function edit(text: string) {
    const insert = plain(text).slice(0, Math.max(0, 4000 - draft.length));
    draft = draft.slice(0, caret) + insert + draft.slice(caret);
    caret += insert.length;
  }

  function setupKey(text: string, key: Key) {
    if (!setup || busy) return;
    if (!state && options?.page && terminalSizeNotice(columns(), rows())) return;
    const runtime = modelRuntime();
    const fields = settingsFields(
      setup.inviteText !== undefined,
      backupHosting() !== undefined,
      setup.deleteText !== undefined,
      setup.plannerText !== undefined,
      runtime !== undefined,
    );
    if (key.name === 'escape') {
      if (!state) {
        if (options?.page) result = 'back';
        stop();
      } else setup = undefined;
    } else if (key.name === 'tab' || key.name === 'up' || key.name === 'down') {
      const change = key.name === 'up' || key.shift ? -1 : 1;
      const index = fields.indexOf(setup.field);
      setup.field = fields[(index + fields.length + change) % fields.length]!;
      replaceField = true;
    } else if (setup.field === 0 && ['left', 'right', 'space', 'return'].includes(key.name ?? '')) {
      setup.value = { ...setup.value, approval: setup.value.approval === 'manual' ? 'automatic' : 'manual' };
    } else if (setup.field === 4 && ['left', 'right', 'space', 'return'].includes(key.name ?? '')) {
      const levels = ['off', 'sandboxed', 'unrestricted'] as const;
      const next = levels.indexOf(setup.value.commands) + (key.name === 'left' ? 2 : 1);
      setup.value = { ...setup.value, commands: levels[next % 3]! };
    } else if (setup.field === 5 && ['left', 'right', 'space', 'return'].includes(key.name ?? '')) {
      if (setup.agents?.installed.length) setup.agents = nextChoice(setup.agents, key.name === 'left' ? -1 : 1);
    } else if (setup.inviteText !== undefined && setup.field === 6) {
      if (key.name === 'return') void invite();
      else if (key.name === 'backspace') {
        setup.inviteText = setup.inviteText.slice(0, -1);
        replaceField = false;
      } else if (text && /^[^\s\x00-\x1f\x7f-\x9f]+$/.test(text) && !key.ctrl && !key.meta) {
        setup.inviteText = ((replaceField ? '' : setup.inviteText) + text).slice(0, 254);
        replaceField = false;
      }
    } else if (setup.deleteText !== undefined && setup.field === deleteClanField) {
      if (key.name === 'return') void removeClan();
      else if (key.name === 'backspace') {
        setup.deleteText = setup.deleteText.slice(0, -1);
        replaceField = false;
      } else if (text && /^[^\x00-\x1f\x7f-\x9f]+$/.test(text) && !key.ctrl && !key.meta) {
        setup.deleteText = ((replaceField ? '' : setup.deleteText) + text).slice(0, 100);
        replaceField = false;
      }
    } else if (key.name === 'return') {
      if (setup.field === backupHostingField) void toggleBackupHosting();
      else if (setup.field === settingsRows(setup) - 2) void save();
      else if (setup.field === settingsRows(setup) - 1) {
        result = 'sign-out';
        stop();
      } else {
        setup.field = fields[(fields.indexOf(setup.field) + 1) % fields.length]!;
        replaceField = true;
      }
    } else if (setup.field === orchestratorModelField && runtime && setup.agents) {
      const choices = setup.agents;
      let model = choices.orchestratorModels[runtime];
      if (key.name === 'backspace') model = model.slice(0, -1);
      else if (text && /^[^\x00-\x1f\x7f-\x9f]+$/.test(text) && !key.ctrl && !key.meta)
        model = ((replaceField ? '' : model) + text).slice(0, 200);
      else return;
      setup.agents = { ...choices, orchestratorModels: { ...choices.orchestratorModels, [runtime]: model } };
      replaceField = false;
    } else if ((setup.field >= 1 && setup.field <= 3) || setup.field === plannerLimitField) {
      const field =
        setup.field === plannerLimitField
          ? 'plannerText'
          : (['tokenText', 'agentText', 'modelText'] as const)[setup.field - 1]!;
      const allowed =
        field === 'plannerText'
          ? /^[0-9auto]+$/i
          : field === 'modelText'
            ? /^[^\x00-\x1f\x7f-\x9f]+$/
            : /^[0-9none∞]+$/i;
      if (key.name === 'backspace') {
        setup[field] = (setup[field] ?? '').slice(0, -1);
        replaceField = false;
      } else if (text && allowed.test(text) && !key.ctrl && !key.meta) {
        setup[field] = ((replaceField ? '' : (setup[field] ?? '')) + text).slice(0, field === 'modelText' ? 1000 : 16);
        replaceField = false;
      }
    }
  }

  // Positive lines scroll back through history, loading older messages near the top.
  function scrollBy(lines: number) {
    scroll = Math.max(0, Math.min(maxScroll, scroll + lines));
    if (lines > 0 && scroll >= Math.max(0, maxScroll - Math.max(lines, rows() - 13))) void olderPage();
  }

  function composerKey(text: string, key: Key) {
    if (key.name === 'f2' && state) {
      const hosting = state.orchestration;
      const leader = hosting ? hosting.eligible && !hosting.backup : info.canStart;
      setup = { ...setupFor(state.settings, leader, hosting?.plannerLimit), agents: saved };
      void loadChoices();
      approvalFocused = false;
    } else if (key.name === 'f5') {
      metrics = { window: '24h', at: 0 };
      approvalFocused = false;
      void loadMetrics();
    } else if (key.name === 'f6') {
      const first = chatPullRequests(state)[0];
      reviews = first ? { selected: pullRequestKey(first) } : {};
      approvalFocused = false;
    } else if (['f3', 'tab'].includes(key.name ?? '') && state?.approvals.length) {
      approvalFocused = !approvalFocused;
    } else if (key.name === 'f4' && state?.questions.length) {
      const index = state.questions.findIndex(({ id }) => id === reply?.id);
      reply = state.questions[(index + 1) % state.questions.length];
      approvalFocused = false;
    } else if (key.ctrl && key.name === 'x') {
      const tasks = stoppableTasks();
      if (!tasks.length) notice = 'None of your agents are running';
      else {
        // Each press moves to the next running agent.
        stopping = tasks[(tasks.indexOf(stopping ?? '') + 1) % tasks.length];
        approvalFocused = false;
      }
    } else if (stopping) {
      if (!key.ctrl && !key.meta && /^[yn]$/i.test(text)) {
        if (text.toLowerCase() === 'y') void halt(stopping);
        stopping = undefined;
      } else if (key.name === 'escape') stopping = undefined;
    } else if (approvalFocused) {
      const count = state?.approvals.length ?? 0;
      if (key.name === 'escape' || key.name === 'tab') approvalFocused = false;
      else if (count && key.name === 'up') approval = (approval + count - 1) % count;
      else if (count && key.name === 'down') approval = (approval + 1) % count;
      else if (!key.ctrl && !key.meta && /^[yn]$/i.test(text)) void decide(text.toLowerCase() === 'y');
    } else if (key.ctrl && key.name === 'r' && failed) {
      void flush();
    } else if (key.name === 'escape') {
      reply = undefined;
    } else if (['pageup', 'pagedown', 'up', 'down'].includes(key.name ?? '')) {
      const page = Math.max(1, rows() - 13);
      const increment = key.name === 'up' || key.name === 'down' ? 1 : page;
      scrollBy(key.name === 'pageup' || key.name === 'up' ? increment : -increment);
    } else if (key.name === 'end' && scroll) {
      scroll = 0;
    } else if (
      (key.name === 'return' || (key.ctrl && key.name === 'f' && state?.forcePending !== undefined)) &&
      draft.trim()
    ) {
      if (outbox.length === 10) {
        notice = 'Outbox full · Ctrl+R Retry';
        return;
      }
      const force = key.name === 'f';
      outbox.push({
        id: randomUUID(),
        text: draft.trim(),
        ...(reply?.replyTo ? { replyTo: reply.replyTo } : {}),
        ...(force ? { force } : {}),
      });
      draft = '';
      caret = scroll = 0;
      reply = undefined;
      if (force || !failed) void flush();
    } else if (key.name === 'backspace' || key.name === 'left') {
      const length = characters(draft.slice(0, caret)).at(-1)?.length ?? 0;
      if (key.name === 'backspace') draft = draft.slice(0, caret - length) + draft.slice(caret);
      caret -= length;
    } else if (key.name === 'delete' || key.name === 'right') {
      const length = characters(draft.slice(caret))[0]?.length ?? 0;
      if (key.name === 'delete') draft = draft.slice(0, caret) + draft.slice(caret + length);
      else caret += length;
    } else if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
      caret = 0;
    } else if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
      caret = draft.length;
    } else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f-\x9f]/.test(text)) {
      edit(text);
    }
  }

  function reviewKey(text: string, key: Key) {
    if (!reviews) return;
    if (key.name === 'escape' || key.name === 'f6') {
      reviews = undefined;
    } else if (key.name === 'up' || key.name === 'down') {
      const requests = chatPullRequests(state);
      if (!requests.length) return;
      const index = requests.findIndex((request) => pullRequestKey(request) === reviews?.selected);
      const step = key.name === 'up' ? -1 : 1;
      const next = index < 0 ? 0 : (index + step + requests.length) % requests.length;
      reviews.selected = pullRequestKey(requests[next]!);
    } else if (!key.ctrl && !key.meta && /^[yn]$/i.test(text)) {
      void decideMerge(text.toLowerCase() === 'y');
    }
  }

  function keypress(text: string | undefined, key: Key = {}) {
    if (closed) return;
    if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
      stop();
      return;
    }
    if (readMouse(text, key.sequence)) return;
    if (key.name === 'paste-start') {
      paste = '';
      return;
    }
    if (paste !== undefined) {
      if (key.name === 'paste-end') {
        if (state && !setup && !metrics && !reviews && !approvalFocused) edit(paste);
        else if (setup?.inviteText !== undefined && setup.field === 6) {
          setup.inviteText = ((replaceField ? '' : setup.inviteText) + plain(paste).trim()).slice(0, 254);
          replaceField = false;
        } else if (setup?.field === orchestratorModelField) setupKey(paste.trim(), {});
        paste = undefined;
        draw();
      } else if (paste.length < 4000) {
        paste += text ?? (key.name === 'return' ? ' ' : '');
      }
      return;
    }
    notice = undefined;
    // macOS sends F-keys to brightness and volume unless fn is held, so each has a Ctrl alternative.
    const fKey = key.ctrl ? ctrlShortcuts[key.name ?? ''] : undefined;
    if (fKey) key = { ...key, ctrl: false, name: fKey };
    if (metrics) {
      if (key.name === 'escape' || key.name === 'f5') metrics = undefined;
      else if (key.name === 't' || key.name === 'tab') {
        metrics = { window: metrics.window === '24h' ? '7d' : '24h', at: 0 };
        void loadMetrics();
      }
    } else if (reviews) reviewKey(text ?? '', key);
    else if (setup) setupKey(text ?? '', key);
    else if (state) composerKey(text ?? '', key);
    draw();
  }

  const wasRaw = stdin.isRaw;
  let stop!: () => void;
  return new Promise((resolve) => {
    const timer = setInterval(() => void refresh(), 2500);
    // Animate messages waiting for the orchestrator, then draw once more to settle them.
    let animating = false;
    const animation = setInterval(() => {
      const working = messages().some(({ role, status }) => role === 'member' && status === 'queued');
      if (working) tick++;
      if ((working || animating) && !setup && !metrics) draw();
      animating = working;
    }, 120);
    stop = () => {
      if (closed) return;
      closed = true;
      controller.abort();
      clearInterval(timer);
      clearInterval(animation);
      stdin.off('keypress', keypress);
      stdin.off('end', stop);
      stdout.off('resize', draw);
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write('\x1b[0m\x1b[?25h\x1b[?2004l\x1b[?1006l\x1b[?1000l\x1b[?1049l');
      resolve(result);
    };
    // Show the orchestrator's answer as soon as its turn ends instead of at the next poll.
    agents?.listen?.(() => void refresh());
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.on('keypress', keypress);
    stdin.on('end', stop);
    stdout.on('resize', draw);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // ?1000h and ?1006h report mouse buttons, including the wheel, so the wheel scrolls in every terminal.
    // Text selection then needs Option-drag (iTerm2, Terminal) or Shift-drag (most others).
    stdout.write('\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[2J');
    stdin.resume();
    draw();
  });
}
