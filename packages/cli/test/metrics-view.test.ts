import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMetrics, ChatState } from '@clqn/shared';
import { backupHostingField, chatFrame, deleteClanField, width } from '../src/chat-view.js';
import { areaChart, metricsFrame } from '../src/metrics-view.js';

const metrics: ChatMetrics = {
  window: '24h',
  bucketHours: 1,
  start: new Date().toISOString(),
  tokens: [...Array(22).fill(0), 1200, 2400],
  agents: [...Array(20).fill(0), 1, 2, 2, 1],
  queueWait: [...Array(22).fill(null), 30, 90],
  queue: { averageSeconds: 60, longestSeconds: 90, waiting: 2, oldestSeconds: 400 },
  members: [
    { name: 'ana@example.com', tokens: 3000, reserved: 500, tokenLimit: 5000 },
    { name: 'bo@example.com', tokens: 600, reserved: 0, tokenLimit: null },
  ],
  tasks: [
    { title: 'Refresh the guide', worker: 'Docs worker', estimatedTokens: 4000, status: 'running', tokens: 2400 },
    { title: 'Fix links', worker: 'Link worker', estimatedTokens: 900, status: 'done', tokens: null },
  ],
};
const view = { columns: 80, rows: 30, color: false, clan: 'Docs', window: '24h' as const, metrics };

test('metrics tab charts tokens and agents and lists members, tasks, and queue wait', () => {
  const { lines } = metricsFrame(view);
  const text = lines.join('\n');
  assert.equal(lines.length, 30);
  assert.match(lines[0]!, /clqn \/ Docs · Metrics/);
  assert.match(text, /Tokens · 24h {2}3\.6k total · peak 2\.4k\/h/);
  assert.match(text, /Active agents · 24h {2}peak 2/);
  assert.match(text, /2\.4k ┤.*█/);
  assert.match(text, /ana {2,}━+┄+ {2}3k \+500 \/ 5k/);
  assert.match(text, /bo .*600 \/ ∞/);
  assert.match(text, /◉ Refresh the guide .*Docs worker 2\.4k/);
  assert.match(text, /✓ Fix links .*~900/);
  assert.match(text, /Queue wait · avg 1m · longest 2m · 2 waiting \(oldest 7m\)/);
  assert.match(lines.at(-1)!, /T \[24h\] 7d {2}· {2}Esc Back/);
});

test('metrics tab fits small terminals and shows loading for another window', () => {
  const small = metricsFrame({ ...view, columns: 40, rows: 12, notice: 'Request failed' });
  assert.equal(small.lines.length, 12);
  const text = small.lines.join('\n');
  for (const caption of ['Tokens · 24h', 'Active agents', 'Tokens by member', 'Tokens by task', 'Queue wait'])
    assert.ok(text.includes(caption), caption);
  assert.match(small.lines.at(-3)!, /Request failed/);
  assert.match(small.lines.at(-1)!, /Esc Back/);

  const loading = metricsFrame({ ...view, window: '7d' });
  assert.match(loading.lines.join('\n'), /Loading metrics…/);
  assert.match(loading.lines.at(-1)!, /T 24h \[7d\]/);
  assert.deepEqual(metricsFrame({ ...view, rows: 11 }).lines, ['Enlarge terminal · Ctrl+C to quit']);
});

test('metrics lines never overflow the terminal at any size', () => {
  for (const sample of [metrics, { ...metrics, tasks: [] }])
    for (let columns = 28; columns <= 120; columns++)
      for (const rows of [12, 14, 20, 40]) {
        const frame = metricsFrame({ ...view, metrics: sample, columns, rows });
        assert.ok(frame.lines.length <= rows, `${columns}x${rows}`);
        for (const line of frame.lines) assert.ok(width(line) <= columns, `${columns}x${rows}: ${line}`);
      }
});

test('area charts scale to the width and keep the peak', () => {
  const chart = areaChart([0, 4, 8], 9, 2, (text) => text);
  assert.deepEqual(chart, ['8 ┤    ██', '0 ┤  ████']);
  assert.deepEqual(
    areaChart([0, 0], 6, 1, (text) => text),
    ['0 ┤   '],
  );
});

test('chat screen offers Ctrl+G metrics, drops the token graph, and settings fit 12 rows', () => {
  const state = {
    session: { clan: 'Docs', host: 'ana@example.com' },
    settings: {
      approval: 'manual',
      tokenLimit: 5000,
      agentLimit: 2,
      allowedModels: ['model-a', 'model-b'],
      commands: 'sandboxed',
    },
    messages: [],
    before: null,
    approvals: [],
    questions: [],
    runs: [],
    queued: 0,
    running: 0,
    usage: { tokens: 0, reserved: 0, agents: 0 },
  } satisfies ChatState;
  const base = {
    columns: 100,
    rows: 24,
    color: false,
    clan: 'Docs',
    userId: 'me',
    state,
    messages: [],
    draft: '',
    caret: 0,
    scroll: 0,
    hasOlder: false,
    approval: 0,
    approvalFocused: false,
  };
  const chat = chatFrame(base).lines.join('\n');
  assert.match(chat, /Ctrl\+G Metrics/);
  assert.doesNotMatch(chat, /Clan tokens/);
  const settings = chatFrame({
    ...base,
    rows: 12,
    settings: {
      value: state.settings,
      tokenText: '5000',
      agentText: '2',
      modelText: 'model-a, model-b',
      agents: { installed: ['codex', 'claude'], off: ['codex'], orchestratorModels: { codex: '', claude: '' } },
      field: 7,
      action: 'Save settings',
    },
  }).lines;
  assert.ok(settings.length <= 12);
  assert.match(settings.join('\n'), /› Sign out/);
  assert.match(settings.join('\n'), /Models {11}model-a, model-b/);
  assert.match(settings.join('\n'), /Agents {11}Codex off · Claude Code on/);
  const any = chatFrame({
    ...base,
    settings: { value: state.settings, tokenText: '', agentText: '', modelText: '', field: 3, action: 'Save settings' },
  }).lines.join('\n');
  assert.match(any, /› Models {11}Any/);
  assert.match(settings.at(-1)!, /Enter a whole number or none/);
  // Leaders get an Invite row above the session action, with its own hint.
  const leader = chatFrame({
    ...base,
    settings: {
      value: state.settings,
      tokenText: '',
      agentText: '',
      modelText: '',
      inviteText: 'pal@example.com',
      field: 6,
      action: 'Save settings',
    },
  }).lines.join('\n');
  assert.match(leader, /› Invite {11}pal@example\.com\n\s+Save settings\n\s+Sign out/);
  assert.match(leader, /press Enter to invite them/);
  assert.doesNotMatch(any, /Invite|Delete clan/);
  // Leaders also get a Delete clan row above Sign out, confirmed by typing the clan name.
  const deleting = chatFrame({
    ...base,
    settings: {
      value: state.settings,
      tokenText: '',
      agentText: '',
      modelText: '',
      inviteText: '',
      deleteText: 'My cl',
      field: deleteClanField,
      action: 'Save settings',
    },
  }).lines.join('\n');
  assert.match(deleting, /Save settings\n\s+› Delete clan {6}My cl\n\s+Sign out/);
  assert.match(deleting, /delete it for every member\. This cannot be undone\./);

  // At the smallest size, every row and the notice still fit; the title and hints make room.
  for (const rows of [12, 14]) {
    const compact = chatFrame({
      ...base,
      rows,
      notice: 'main up to date',
      settings: {
        value: state.settings,
        tokenText: '',
        agentText: '',
        modelText: '',
        inviteText: '',
        deleteText: '',
        field: 8,
        action: 'Save settings',
      },
    }).lines;
    assert.ok(compact.length <= rows);
    assert.match(compact.join('\n'), /› Sign out\n/);
    assert.match(compact.at(-1)!, /main up to date/);
  }
  // When a leader's rows do not all fit, the rows around the selection stay visible.
  const top = chatFrame({
    ...base,
    rows: 12,
    notice: 'main up to date',
    settings: {
      value: state.settings,
      tokenText: '',
      agentText: '',
      modelText: '',
      inviteText: '',
      deleteText: '',
      field: 0,
      action: 'Save settings',
    },
  }).lines.join('\n');
  assert.match(top, /› Spawn approval/);
  assert.doesNotMatch(top, /Sign out/);
  const backup = chatFrame({
    ...base,
    rows: 12,
    settings: {
      value: state.settings,
      tokenText: '',
      agentText: '',
      modelText: '',
      backupHosting: false,
      field: backupHostingField,
      action: 'Save settings',
    },
    notice: 'Could not save backup hosting',
  }).lines;
  assert.equal(backup.length, 12);
  assert.match(backup.find((line) => line.includes('Backup hosting'))!, /› Backup hosting {3}Off/);
  assert.ok(backup.some((line) => line.includes('Sign out')));
  assert.match(backup.at(-1)!, /Could not save backup hosting/);
  assert.doesNotMatch(leader, /Backup hosting/);
});
