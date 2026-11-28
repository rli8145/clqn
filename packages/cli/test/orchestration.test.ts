import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ChatDecisionRequest, ChatMessage, ChatRouteRequest, ClqnClient } from '@clqn/shared';
import { createOrchestration } from '../src/orchestration.js';

const message = (id: string, text: string): ChatMessage => ({
  id,
  text,
  authorId: randomUUID(),
  author: 'Member',
  createdAt: '2026-11-26T12:00:00.000Z',
  replyTo: null,
  role: 'member',
  sequence: 1,
  status: 'queued',
});

test('the router forwards a follow-up while more than five independent sub-orchestrators are planning', async () => {
  const clanId = randomUUID();
  const leaseId = randomUUID();
  const first = message(randomUUID(), 'Build four features and fix three bugs');
  const followup = message(randomUUID(), 'For task two, keep compatibility with older clients');
  const titles = ['Feature one', 'Feature two', 'Feature three', 'Feature four', 'Bug one', 'Bug two', 'Bug three'];
  const work = titles.map((title, index) => ({ id: randomUUID(), title, status: 'queued', position: index + 1 }));
  const [target] = work.slice(1);
  const routes: ChatRouteRequest[] = [];
  const decisions: { id: string; decision: ChatDecisionRequest }[] = [];
  const models = new Map<string, (answer: string) => void>();
  const tasks: Promise<void>[] = [];
  const coordinator = createOrchestration(
    clanId,
    () => 0,
    () => {},
    (task) => tasks.push(task),
    () => 4 * 1024 ** 3,
  );
  const api = {
    chatInbox: async (_clan: string, _lease: string, workId?: string) => {
      const item = work.find(({ id }) => id === workId);
      const next = item ? message(item.id, item.title) : routes.length ? followup : first;
      return {
        next,
        pickId: randomUUID(),
        messages: [next],
        ...(item ? { workItem: item } : { work }),
      };
    },
    routeChat: async (_clan: string, _id: string, decision: ChatRouteRequest) => routes.push(decision),
    decideChat: async (_clan: string, id: string, decision: ChatDecisionRequest) => decisions.push({ id, decision }),
    listAgents: async () => ({ agents: [] }),
  } as unknown as ClqnClient;
  const host = {
    api,
    leaseId,
    active: () => true,
    generate: async (name: string, _rules: string, prompt: string) => {
      if (name === 'router') {
        if (!routes.length)
          return JSON.stringify({ action: 'start', work: titles.map((title) => ({ title, description: title })) });
        assert.match(prompt, /For task two/);
        return JSON.stringify({ action: 'followup', workId: target!.id });
      }
      return new Promise<string>((resolve) => models.set(name, resolve));
    },
  };

  coordinator.update({ pending: first.id, ready: [] }, [], host, null);
  await tasks[0];
  assert.equal(routes[0]?.action, 'start');
  const ready = work.map(({ id }) => id);
  coordinator.update({ pending: null, ready }, [], host, null);
  await new Promise((done) => setImmediate(done));
  assert.equal(models.size, 5);

  const raised = { ...host, plannerLimit: 8 };
  coordinator.update({ pending: null, ready }, [], raised, null);
  await new Promise((done) => setImmediate(done));
  assert.equal(models.size, titles.length);

  coordinator.update({ pending: followup.id, ready }, [], raised, null);
  await tasks.at(-1);
  assert.equal(routes[1]?.action, 'followup');
  assert.equal(routes[1].workId, target!.id);
  assert.equal(decisions.length, 0);
  for (const finish of models.values()) finish(JSON.stringify({ action: 'reply', text: 'Planning complete' }));
  await Promise.all(tasks);
  assert.deepEqual(decisions.map(({ id }) => id).sort(), ready.sort());
});

test('planning responds to host memory and the leader’s ceiling', async () => {
  const clanId = randomUUID();
  const ready = [randomUUID(), randomUUID(), randomUUID()];
  const models = new Map<string, (answer: string) => void>();
  const tasks: Promise<void>[] = [];
  let available = 256 * 1024 ** 2;
  const coordinator = createOrchestration(
    clanId,
    Date.now,
    () => {},
    (task) => tasks.push(task),
    () => available,
  );
  const host = {
    api: {
      chatInbox: async (_clan: string, _lease: string, id: string) => ({
        next: message(id, 'Plan the task'),
        pickId: randomUUID(),
        messages: [],
        workItem: { id, title: 'Task', status: 'queued' },
      }),
      listAgents: async () => ({ agents: [] }),
      decideChat: async () => ({}),
    } as unknown as ClqnClient,
    leaseId: randomUUID(),
    active: () => true,
    generate: async (name: string) => new Promise<string>((resolve) => models.set(name, resolve)),
  };

  coordinator.update({ pending: null, ready }, [], { ...host, plannerLimit: 8 }, null);
  coordinator.update({ pending: null, ready }, [], { ...host, plannerLimit: 8 }, null);
  await new Promise((done) => setImmediate(done));
  assert.equal(models.size, 1);

  available = 2 * 1024 ** 3;
  coordinator.update({ pending: null, ready }, [], { ...host, plannerLimit: 2 }, null);
  await new Promise((done) => setImmediate(done));
  assert.equal(models.size, 2);

  coordinator.update({ pending: null, ready }, [], { ...host, plannerLimit: 1 }, null);
  assert.equal(tasks.length, 2);

  coordinator.update({ pending: null, ready }, [], { ...host, plannerLimit: null }, null);
  await new Promise((done) => setImmediate(done));
  assert.equal(models.size, ready.length);
  for (const finish of models.values()) finish(JSON.stringify({ action: 'reply', text: 'Planning complete' }));
  await Promise.all(tasks);
});

test('two invalid router decisions prompt one clarification and release the next message', async () => {
  const clanId = randomUUID();
  const next = message(randomUUID(), 'Fix the broken links');
  const following = message(randomUUID(), 'Update the docs');
  const tasks: Promise<void>[] = [];
  const submitted: { id: string; decision: ChatRouteRequest }[] = [];
  let now = 0;
  const coordinator = createOrchestration(
    clanId,
    () => now,
    () => {},
    (task) => tasks.push(task),
  );
  const responses = [
    '{',
    JSON.stringify({ action: 'followup', workId: randomUUID() }),
    JSON.stringify({ action: 'reply', text: 'Acknowledged' }),
  ];
  const host = {
    api: {
      chatInbox: async () => ({
        next: submitted.length ? following : next,
        pickId: randomUUID(),
        messages: [],
        work: [],
      }),
      routeChat: async (_clan: string, id: string, decision: ChatRouteRequest) => submitted.push({ id, decision }),
    } as unknown as ClqnClient,
    leaseId: randomUUID(),
    active: () => true,
    generate: async () => responses.shift()!,
  };
  const state = { pending: next.id, ready: [] };
  coordinator.update(state, [], host, null);
  await tasks[0];
  assert.deepEqual(coordinator.status(), ['Orchestrator · The router returned an invalid decision']);
  coordinator.update(state, [], host, null);
  assert.equal(tasks.length, 1);
  assert.equal(submitted.length, 0);

  now += 10_000;
  coordinator.update(state, [], host, null);
  await tasks[1];
  assert.equal(submitted[0]?.id, next.id);
  assert.equal(submitted[0]?.decision.action, 'clarify');

  coordinator.update({ ...state, pending: following.id }, [], host, null);
  await tasks[2];
  assert.equal(submitted[1]?.id, following.id);
  assert.equal(submitted[1]?.decision.action, 'reply');
  assert.deepEqual(coordinator.status(), []);
});

test('losing the host lease cancels all turns before they can submit decisions', async () => {
  const clanId = randomUUID();
  const first = message(randomUUID(), 'Implement a feature');
  const tasks: Promise<void>[] = [];
  const coordinator = createOrchestration(
    clanId,
    () => 0,
    () => {},
    (task) => tasks.push(task),
  );
  let active = true;
  let modelSignal: AbortSignal | undefined;
  let finish: ((value: string) => void) | undefined;
  const host = {
    api: {
      chatInbox: async () => ({ next: first, pickId: randomUUID(), messages: [] }),
      routeChat: async () => assert.fail('A former host submitted a decision'),
    } as unknown as ClqnClient,
    leaseId: randomUUID(),
    active: () => active,
    generate: async (_name: string, _rules: string, _prompt: string, signal: AbortSignal) => {
      modelSignal = signal;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    },
  };
  coordinator.update({ pending: first.id, ready: [] }, [], host, null);
  await new Promise((done) => setImmediate(done));
  active = false;
  coordinator.stop();
  assert.equal(modelSignal?.aborted, true);
  finish?.(JSON.stringify({ action: 'reply', text: 'Acknowledged' }));
  await Promise.all(tasks);
  assert.deepEqual(coordinator.status(), []);
});

test('a continuation keeps the task and previous worker and forwards the chosen model', async () => {
  const clanId = randomUUID();
  const workId = randomUUID();
  const workerId = randomUUID();
  const taskId = randomUUID();
  const model = 'review-model';
  const next = message(randomUUID(), 'Continue the stopped feature');
  const tasks: Promise<void>[] = [];
  const submitted: ChatDecisionRequest[] = [];
  let now = 0;
  const coordinator = createOrchestration(
    clanId,
    () => now,
    () => {},
    (task) => tasks.push(task),
  );
  const api = {
    chatInbox: async () => ({
      next,
      pickId: randomUUID(),
      messages: [],
      workItem: { id: workId, title: 'Feature', taskId, workerId, status: 'released' },
    }),
    listAgents: async () => ({
      agents: [
        { id: workerId, name: 'Previous worker', role: 'worker', allowedModels: [model] },
        { id: randomUUID(), name: 'Other worker', role: 'worker' },
      ],
    }),
    decideChat: async (_clan: string, _id: string, decision: ChatDecisionRequest) => submitted.push(decision),
  } as unknown as ClqnClient;
  const state = { pending: null, ready: [workId] };
  const host = {
    api,
    leaseId: randomUUID(),
    active: () => true,
    generate: async (_name: string, _rules: string, prompt: string) => {
      if (!now) return '{}';
      const modelInput = JSON.parse(prompt);
      assert.deepEqual(modelInput.continuation, { taskId, workerId });
      assert.deepEqual(
        modelInput.workers.map(({ id }: { id: string }) => id),
        [workerId],
      );
      assert.deepEqual(modelInput.workers[0].allowedModels, [model]);
      return JSON.stringify({
        action: 'delegate',
        taskId,
        workerId,
        model,
        title: 'Feature',
        description: next.text,
        estimatedTokens: 5000,
      });
    },
  };
  coordinator.update(state, [], host, null);
  await tasks[0];
  assert.deepEqual(coordinator.status(), ['Orchestrator · The sub-orchestrator returned an invalid decision']);
  assert.equal(submitted.length, 0);

  now += 10_000;
  coordinator.update(state, [], host, null);
  await tasks[1];
  assert.equal(submitted[0]?.action, 'delegate');
  assert.equal(submitted[0]?.taskId, taskId);
  assert.equal(submitted[0]?.workerId, workerId);
  assert.equal(submitted[0]?.model, model);
});
