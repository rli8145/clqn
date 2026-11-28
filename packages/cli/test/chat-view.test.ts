import assert from 'node:assert/strict';
import test from 'node:test';
import { type ChatMessage, type ChatState, defaultChatSettings } from '@clqn/shared';
import {
  chatFrame,
  messageLines,
  orchestratorModelField,
  painter,
  plannerLimitField,
  settingsFields,
  settingsLines,
  threaded,
} from '../src/chat-view.js';

const message: ChatMessage = {
  id: '00000000-0000-4000-8000-000000000001',
  sequence: 1,
  authorId: '00000000-0000-4000-8000-000000000002',
  author: 'ana@example.com',
  role: 'member',
  createdAt: new Date().toISOString(),
  text: 'Fix the links',
  status: 'queued',
  replyTo: null,
};

test('queued and processing messages shimmer until the orchestrator answers', () => {
  const paint = painter(true);
  const queued = messageLines(message, 60, 'me', paint, 3)[0]!;
  assert.match(queued.replace(/\x1b\[\d+m/g, ''), /Pending$/);
  assert.match(queued, /\x1b\[97mP/);
  const processing = { ...message, processing: true };
  assert.match(messageLines(processing, 60, 'me', paint)[0]!.replace(/\x1b\[\d+m/g, ''), /Processing$/);
  const bright = (frame: number) =>
    [...messageLines(processing, 60, 'me', paint, frame)[0]!.matchAll(/\x1b\[97m(.)/g)].map((match) => match[1]);
  assert.deepEqual(bright(3), ['P']);
  assert.deepEqual(bright(5), ['o']);
  assert.notDeepEqual(bright(5), bright(6));
  // Handled messages never shimmer or show Processing.
  assert.doesNotMatch(messageLines({ ...processing, status: 'handled' }, 60, 'me', paint, 3)[0]!, /\x1b\[97m/);
});

test('parallel planning is editable above Save settings and displays Auto for a blank value', () => {
  const settings = {
    value: defaultChatSettings,
    tokenText: '',
    agentText: '',
    modelText: '',
    inviteText: '',
    deleteText: '',
    field: plannerLimitField,
    action: 'Save settings',
  };
  assert.deepEqual(settingsFields(true, false, true, true).slice(-4), [plannerLimitField, 7, 10, 8]);
  assert.doesNotMatch(settingsLines(settings, 60, painter(false), 12, '').join('\n'), /Planners/);
  for (const [input, label] of [
    ['', 'Auto'],
    ['7', '7'],
  ] as const) {
    const lines = settingsLines({ ...settings, plannerText: input }, 60, painter(false), 10, '');
    assert.ok(lines.length <= 10);
    assert.ok(lines.includes(`› Planners         ${label}`));
  }
});

test('host settings show the orchestrator model and recommend stronger reasoning', () => {
  const settings = {
    value: defaultChatSettings,
    tokenText: '',
    agentText: '',
    modelText: '',
    field: orchestratorModelField,
    action: 'Start session',
  };
  const render = (extra: Partial<Parameters<typeof settingsLines>[0]>) =>
    settingsLines({ ...settings, ...extra }, 65, painter(false), 20, '').join('\n');
  assert.doesNotMatch(render({}), /Host model/);
  assert.match(render({ orchestratorRuntime: 'codex' }), /› Host model       Default \(Codex\)/);
  assert.match(render({ orchestratorRuntime: 'claude' }), /A stronger reasoning model is recommended/);
});

test('answers sit right below the message they answer', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const at = (n: number, changes: Partial<ChatMessage>): ChatMessage => ({
    ...message,
    id: id(n),
    sequence: n,
    ...changes,
  });
  const first = at(1, {});
  const second = at(2, {});
  const answerToSecond = at(3, { role: 'orchestrator', replyTo: id(2), status: 'handled' });
  const answerToFirst = at(4, { role: 'orchestrator', replyTo: id(1), status: 'handled' });
  const workerResult = at(5, { role: 'worker', replyTo: id(1), status: 'handled' });
  const memberReply = at(6, { replyTo: id(1) });
  const answerToOlder = at(7, { role: 'orchestrator', replyTo: id(9), status: 'handled' });
  const order = threaded([first, second, answerToSecond, answerToFirst, workerResult, memberReply, answerToOlder]);
  assert.deepEqual(
    order.map(({ sequence }) => sequence),
    [1, 4, 5, 2, 3, 6, 7],
  );
});

test('scrolling past the start keeps the oldest transcript page full', () => {
  const log = Array.from({ length: 40 }, (_, index) => `Log line ${index + 1}`);
  const view = {
    color: false,
    clan: 'Test',
    userId: 'me',
    messages: [{ ...message, text: log.join('\n') }],
    draft: '',
    caret: 0,
    hasOlder: false,
    approval: 0,
    approvalFocused: false,
  };
  for (const layout of [
    { columns: 80, rows: 24, expected: 14 },
    { columns: 60, rows: 14, expected: 3, notice: 'Chat disconnected' },
  ]) {
    const top = chatFrame({ ...view, ...layout, scroll: 100 });
    const visible = top.lines.flatMap((line) => line.match(/Log line \d+/) ?? []);
    assert.deepEqual(visible, log.slice(0, layout.expected));
    assert.deepEqual(chatFrame({ ...view, ...layout, scroll: 103 }), top);
  }
  const short = { ...view, columns: 80, rows: 24, messages: [{ ...message, text: log.slice(0, 15).join('\n') }] };
  assert.deepEqual(chatFrame({ ...short, scroll: 3 }), chatFrame({ ...short, scroll: 0 }));
});

test('peach-accented transcript lines keep the agents divider aligned', () => {
  const answer: ChatMessage = { ...message, id: '00000000-0000-4000-8000-000000000003', role: 'orchestrator' };
  const { lines } = chatFrame({
    columns: 100,
    rows: 24,
    color: true,
    clan: 'Test',
    userId: 'me',
    state: {
      session: { clan: 'Test', host: 'ana@example.com' },
      settings: { approval: 'manual', tokenLimit: null, agentLimit: null, allowedModels: null, commands: 'sandboxed' },
      messages: [message, answer],
      before: null,
      approvals: [],
      questions: [],
      runs: [],
      queued: 0,
      running: 0,
      usage: { tokens: 0, reserved: 0, agents: 0 },
    },
    messages: [message, answer],
    draft: '',
    caret: 0,
    scroll: 0,
    hasOlder: false,
    approval: 0,
    approvalFocused: false,
  });
  const columns = lines
    .map((line) => line.replace(/\x1b\[[\d;]*m/g, ''))
    .filter((line) => line.includes(' │ '))
    .map((line) => line.indexOf(' │ '));
  assert.ok(columns.length > 2);
  assert.equal(new Set(columns).size, 1);
});

test('this member’s running agents show a clickable Stop with their run time, and stopping asks first', () => {
  const run = (taskId: string, title: string) => ({
    messageId: taskId.replace(/.$/, 'f'),
    taskId,
    title,
    worker: 'Codex',
    estimatedTokens: 500,
    status: 'running' as const,
    tokens: null,
  });
  const mine = run('00000000-0000-4000-8000-0000000000a1', 'Mine');
  const theirs = run('00000000-0000-4000-8000-0000000000b1', 'Theirs');
  const state: ChatState = {
    messages: [],
    before: null,
    session: { host: 'lead@example.com', clan: 'Test' },
    settings: { approval: 'manual', tokenLimit: null, agentLimit: null, allowedModels: null, commands: 'sandboxed' },
    approvals: [],
    questions: [],
    runs: [mine, theirs],
    queued: 0,
    running: 2,
    usage: { tokens: 0, reserved: 0, agents: 1 },
  };
  const view = {
    columns: 120,
    rows: 24,
    color: false,
    clan: 'Test',
    userId: 'me',
    state,
    messages: [],
    draft: '',
    caret: 0,
    scroll: 0,
    hasOlder: false,
    approval: 0,
    approvalFocused: false,
    stoppable: new Map([[mine.taskId, 0]]),
    now: 12 * 60_000,
  };
  const frame = chatFrame(view);
  assert.equal(frame.stops?.length, 1);
  const [stop] = frame.stops!;
  assert.equal(stop?.taskId, mine.taskId);
  const line = frame.lines[stop!.row]!;
  assert.equal(line.slice(stop!.column, stop!.column + stop!.width), '■ Stop');
  assert.match(line, /Codex · Running · 12m/);
  assert.equal(frame.lines.filter((text) => text.includes('■ Stop')).length, 1, 'only this member’s agent');
  assert.match(frame.lines.at(-1)!, /Ctrl\+X Stop agent/);

  const confirm = chatFrame({ ...view, stopping: mine.taskId });
  assert.ok(
    confirm.lines.some((text) => text.includes('■ Stop Mine? Its work stays for a follow-up · Y Stop  N Keep')),
  );
  assert.match(confirm.lines.at(-1)!, /Y Stop {2}N Keep running/);
  assert.equal(confirm.cursor, undefined);
  // A task that can no longer be stopped asks nothing.
  assert.equal(
    chatFrame({ ...view, stopping: theirs.taskId })
      .lines.join('\n')
      .includes('Theirs?'),
    false,
  );
});
