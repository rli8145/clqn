import {
  linkedRepositoriesSchema,
  linkedRepositorySetupSchema,
  linkRepositorySchema,
  unlinkedRepositorySchema,
} from './repositories.js';

export * from './repositories.js';

import { z } from 'zod';
import { eventsSchema, statusSchema } from './activity.js';
import {
  actorSchema,
  agentRegistrationSchema,
  agentSchema,
  agentsSchema,
  logoutSchema,
  registerAgentSchema,
  revokedAgentSchema,
} from './agents.js';
import { setAliasSchema } from './aliases.js';
import {
  type ChatDecisionRequest,
  type ChatMetricsWindow,
  type ChatRouteRequest,
  type ChatSettings,
  type ChatUsage,
  chatBackupsInputSchema,
  chatBackupsSchema,
  chatDecisionRequestSchema,
  chatFollowupsSchema,
  chatHistorySchema,
  chatInboxSchema,
  chatInfoSchema,
  chatLeaseHeartbeatSchema,
  chatLeaseInputSchema,
  chatLeaseSchema,
  chatMessageSchema,
  chatMessageStatusSchema,
  chatMetricsSchema,
  chatPlannerLimitInputSchema,
  chatRouteRequestSchema,
  chatSettingsSchema,
  chatStateSchema,
  chatUsageSchema,
  type SendChat,
  sendChatSchema,
} from './chat.js';
import {
  contextEntrySchema,
  contextHistorySchema,
  contextKeySchema,
  contextListSchema,
  writeContextSchema,
} from './context.js';
import {
  assignTaskSchema,
  createTaskSchema,
  type IntegrationReport,
  integrationReportSchema,
  mergeApprovalSchema,
  type RepositoryInput,
  type RepositoryReport,
  repositoryInputSchema,
  repositoryReportSchema,
  type TaskListFilters,
  taskSchema,
  tasksSchema,
} from './tasks.js';

export * from './activity.js';
export * from './agents.js';
export * from './aliases.js';
export * from './chat.js';
export * from './context.js';
export * from './pagination.js';
export * from './tasks.js';

export const githubStartSchema = z.object({
  handle: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  userCode: z.string(),
  verificationUri: z.literal('https://github.com/login/device'),
  expiresIn: z.number().int().positive().max(900),
  interval: z.number().int().min(5).max(300),
});
export const githubPollSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), interval: z.number().int().min(5).max(300) }),
  z.object({
    status: z.literal('complete'),
    token: z.string().regex(/^clqn_[A-Za-z0-9_-]{43}$/),
    user: z.object({ id: z.uuid(), email: z.email() }),
  }),
  z.object({ status: z.enum(['expired', 'denied', 'account_conflict']) }),
]);
export const VERSION = '0.4.1';
// The day VERSION was released, shown on the CLI's landing page.
export const RELEASE_DATE = '2026-11-27';
export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('clqn-api'),
  version: z.string(),
});
export type Health = z.infer<typeof healthSchema>;
export const userSchema = z.object({ id: z.uuid(), email: z.email() });
export type User = z.infer<typeof userSchema>;
export const createClanSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((name) => !name.includes('\0'), 'Clan names cannot contain NUL'),
  })
  .strict();
export const clanSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type Clan = z.infer<typeof clanSchema>;
export const createInvitationSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) }).strict();
export const invitationCodeSchema = z.string().regex(/^clqn_inv_[A-Za-z0-9_-]{43}$/);
export const joinInvitationSchema = z.object({ code: invitationCodeSchema }).strict();
export const acceptInvitationSchema = z.object({ clanId: z.uuid() }).strict();
const pendingInvitationSchema = z.object({ clanId: z.uuid(), clanName: z.string(), expiresAt: z.iso.datetime() });
export type PendingInvitation = z.infer<typeof pendingInvitationSchema>;
const pendingInvitationsSchema = z.object({
  invitations: z.array(pendingInvitationSchema),
  nextCursor: z.uuid().optional(),
});
export const invitationSchema = z.object({
  code: invitationCodeSchema,
  clanId: z.uuid(),
  email: z.email(),
  expiresAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;
export const clansSchema = z.object({ clans: z.array(clanSchema), nextCursor: z.uuid().optional() });
export const membersSchema = z.object({
  nextCursor: z.uuid().optional(),
  members: z.array(
    z.object({
      userId: z.uuid(),
      email: z.email(),
      role: z.enum(['leader', 'member']),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export const removedMemberSchema = z.object({ removed: z.literal(true) });
export const leftClanSchema = z.object({ left: z.literal(true) });
export const deletedClanSchema = z.object({
  deleted: z.literal(true),
  repositories: z.array(z.object({ id: z.uuid(), slug: z.string() })),
});
export const transferLeadershipSchema = z.object({ userId: z.uuid() }).strict();
export const leaderSchema = z.object({ leaderId: z.uuid() });
export const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiErrorBody = z.infer<typeof errorSchema>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Both adapters use this client; collaboration rules belong on the API server.
export class ClqnClient {
  private readonly baseUrl: URL;
  constructor(
    baseUrl: string,
    private readonly token?: string,
  ) {
    this.baseUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol)) {
      throw new Error('CLQN_API_URL must use HTTP or HTTPS');
    }
    if (this.baseUrl.username || this.baseUrl.password) throw new Error('API URL must not contain credentials');
    if (
      token &&
      this.baseUrl.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(this.baseUrl.hostname)
    ) {
      throw new Error('Authenticated requests require HTTPS except on loopback');
    }
  }
  private async request<T>(path: string, schema: z.ZodType<T>, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: body === undefined ? 'GET' : 'POST',
      signal: signal ? AbortSignal.any([AbortSignal.timeout(10_000), signal]) : AbortSignal.timeout(10_000),
      redirect: 'error',
      headers: {
        accept: 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const parsed = errorSchema.safeParse(await response.json().catch(() => null));
      throw new ApiError(
        response.status,
        parsed.success ? parsed.data.error.code : 'HTTP_ERROR',
        parsed.success ? parsed.data.error.message : `API returned HTTP ${response.status}`,
      );
    }
    return schema.parse(await response.json());
  }
  private async pages<T extends { nextCursor?: string | undefined }>(
    path: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const pages: T[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    do {
      const page = await this.request(
        after ? `${path}?after=${encodeURIComponent(after)}` : path,
        schema,
        undefined,
        signal,
      );
      pages.push(page);
      after = page.nextCursor;
      if (after && seen.has(after)) throw new Error('Pagination cursor did not advance');
      if (after) seen.add(after);
    } while (after);
    return pages;
  }
  private chatPath(clanId: string) {
    return `/v1/clans/${encodeURIComponent(clanId)}/chat`;
  }
  chatInfo(clanId: string, signal?: AbortSignal) {
    return this.request(this.chatPath(clanId), chatInfoSchema, undefined, signal);
  }
  joinChat(clanId: string, settings: ChatSettings, signal?: AbortSignal) {
    return this.request(
      `${this.chatPath(clanId)}/join`,
      chatSettingsSchema,
      chatSettingsSchema.parse(settings),
      signal,
    );
  }
  setChatPlannerLimit(clanId: string, plannerLimit: number | null, signal?: AbortSignal) {
    return this.request(
      `${this.chatPath(clanId)}/planner-limit`,
      chatPlannerLimitInputSchema,
      chatPlannerLimitInputSchema.parse({ plannerLimit }),
      signal,
    );
  }
  // Saves the member's limits without joining a session, for example right after joining a clan.
  saveChatSettings(clanId: string, settings: ChatSettings) {
    return this.request(`${this.chatPath(clanId)}/settings`, chatSettingsSchema, chatSettingsSchema.parse(settings));
  }
  chatState(clanId: string, signal?: AbortSignal) {
    return this.request(`${this.chatPath(clanId)}/state`, chatStateSchema, undefined, signal);
  }
  chatHistory(clanId: string, before: number, signal?: AbortSignal) {
    return this.request(`${this.chatPath(clanId)}/history?before=${before}`, chatHistorySchema, undefined, signal);
  }
  sendChat(clanId: string, message: SendChat, signal?: AbortSignal) {
    return this.request(`${this.chatPath(clanId)}/messages`, chatMessageSchema, sendChatSchema.parse(message), signal);
  }
  chatBackups(clanId: string) {
    return this.request(`${this.chatPath(clanId)}/host/backups`, chatBackupsSchema);
  }
  setChatBackups(clanId: string, userIds: string[]) {
    return this.request(
      `${this.chatPath(clanId)}/host/backups`,
      chatBackupsSchema,
      chatBackupsInputSchema.parse({ userIds }),
    );
  }
  heartbeatChatLease(clanId: string, leaseId: string, signal?: AbortSignal, renew = false) {
    return this.request(
      `${this.chatPath(clanId)}/host/heartbeat`,
      chatLeaseSchema,
      chatLeaseHeartbeatSchema.parse({ leaseId, renew }),
      signal,
    );
  }
  releaseChatLease(clanId: string, leaseId: string, signal?: AbortSignal) {
    return this.request(
      `${this.chatPath(clanId)}/host/release`,
      chatLeaseSchema,
      chatLeaseInputSchema.parse({ leaseId }),
      signal,
    );
  }
  // Takes the next queued message for the orchestrator to handle.
  chatInbox(clanId: string, leaseId?: string, workId?: string, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (leaseId) query.set('lease', leaseId);
    if (workId) query.set('work', workId);
    return this.request(`${this.chatPath(clanId)}/inbox${query.size ? `?${query}` : ''}`, chatInboxSchema, {}, signal);
  }
  decideChat(clanId: string, id: string, decision: ChatDecisionRequest, leaseId?: string, signal?: AbortSignal) {
    const query = leaseId ? `?lease=${encodeURIComponent(leaseId)}` : '';
    return this.request(
      `${this.chatPath(clanId)}/messages/${encodeURIComponent(id)}/decision${query}`,
      z.object({ status: chatMessageStatusSchema, blocker: z.string().nullable() }),
      chatDecisionRequestSchema.parse(decision),
      signal,
    );
  }
  routeChat(clanId: string, id: string, decision: ChatRouteRequest, leaseId: string, signal?: AbortSignal) {
    return this.request(
      `${this.chatPath(clanId)}/messages/${encodeURIComponent(id)}/route?lease=${encodeURIComponent(leaseId)}`,
      z.object({ ok: z.literal(true) }),
      chatRouteRequestSchema.parse(decision),
      signal,
    );
  }
  chatFollowups(clanId: string, taskId: string, after: number, signal?: AbortSignal) {
    return this.request(
      `${this.chatPath(clanId)}/tasks/${encodeURIComponent(taskId)}/followups?after=${after}`,
      chatFollowupsSchema,
      undefined,
      signal,
    );
  }
  chatMetrics(clanId: string, window: ChatMetricsWindow, signal?: AbortSignal) {
    return this.request(`${this.chatPath(clanId)}/metrics?window=${window}`, chatMetricsSchema, undefined, signal);
  }
  approveChat(clanId: string, id: string, approve: boolean, signal?: AbortSignal) {
    return this.request(
      `${this.chatPath(clanId)}/messages/${encodeURIComponent(id)}/approval`,
      z.object({ ok: z.literal(true) }),
      { approve },
      signal,
    );
  }
  reportChatUsage(clanId: string, taskId: string, usage: ChatUsage) {
    return this.request(
      `${this.chatPath(clanId)}/tasks/${encodeURIComponent(taskId)}/usage`,
      z.object({ ok: z.literal(true) }),
      chatUsageSchema.parse(usage),
    );
  }
  private requireSecureLogin() {
    if (this.baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(this.baseUrl.hostname)) {
      throw new Error('GitHub login requires HTTPS except on loopback');
    }
  }
  startGithubLogin() {
    this.requireSecureLogin();
    return this.request('/auth/github/start', githubStartSchema, {});
  }
  pollGithubLogin(handle: string) {
    this.requireSecureLogin();
    return this.request('/auth/github/poll', githubPollSchema, { handle });
  }
  health(): Promise<Health> {
    return this.request('/health', healthSchema);
  }
  whoami(signal?: AbortSignal) {
    return this.request('/v1/me', actorSchema, undefined, signal);
  }
  logout() {
    return this.request('/v1/logout', logoutSchema, {});
  }
  createClan(name: string): Promise<Clan> {
    return this.request('/v1/clans', clanSchema, createClanSchema.parse({ name }));
  }
  async listClans() {
    return { clans: (await this.pages('/v1/clans', clansSchema)).flatMap((page) => page.clans) };
  }
  async members(clanId: string) {
    return {
      members: (await this.pages(`/v1/clans/${encodeURIComponent(clanId)}/members`, membersSchema)).flatMap(
        (page) => page.members,
      ),
    };
  }
  removeMember(clanId: string, userId: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/members/${encodeURIComponent(userId)}/remove`,
      removedMemberSchema,
      {},
    );
  }
  leaveClan(clanId: string) {
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/leave`, leftClanSchema, {});
  }
  deleteClan(clanId: string) {
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/delete`, deletedClanSchema, {});
  }
  transferLeadership(clanId: string, userId: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/leader`,
      leaderSchema,
      transferLeadershipSchema.parse({ userId }),
    );
  }
  createInvitation(clanId: string, email: string): Promise<Invitation> {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/invitations`,
      invitationSchema,
      createInvitationSchema.parse({ email }),
    );
  }
  async listInvitations() {
    const pages = await this.pages('/v1/invitations', pendingInvitationsSchema);
    return { invitations: pages.flatMap((page) => page.invitations) };
  }
  acceptInvitation(clanId: string): Promise<Clan> {
    return this.request('/v1/invitations/accept', clanSchema, acceptInvitationSchema.parse({ clanId }));
  }
  joinClan(code: string): Promise<Clan> {
    return this.request('/v1/invitations/join', clanSchema, joinInvitationSchema.parse({ code }));
  }
  registerAgent(clanId: string, name: string, role: 'worker' | 'orchestrator' = 'worker', alias?: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/agents`,
      agentRegistrationSchema,
      registerAgentSchema.parse({ name, role, alias }),
    );
  }
  setAgentAlias(clanId: string, agentId: string, alias: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/agents/${encodeURIComponent(agentId)}/alias`,
      agentSchema,
      setAliasSchema.parse({ alias }),
    );
  }
  revokeAgent(clanId: string, agentId: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/agents/${encodeURIComponent(agentId)}/revoke`,
      revokedAgentSchema,
      {},
    );
  }
  rotateAgentToken(clanId: string, agentId: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/agents/${encodeURIComponent(agentId)}/token`,
      agentRegistrationSchema,
      {},
    );
  }
  async listAgents(clanId: string) {
    return {
      agents: (await this.pages(`/v1/clans/${encodeURIComponent(clanId)}/agents`, agentsSchema)).flatMap(
        (page) => page.agents,
      ),
    };
  }
  agentStatus() {
    return this.request('/v1/agent', agentSchema);
  }
  linkRepository(clanId: string, slug: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/repositories`,
      linkedRepositorySetupSchema,
      linkRepositorySchema.parse({ slug }),
    );
  }
  async repositories(clanId: string, signal?: AbortSignal) {
    return {
      repositories: (
        await this.pages(`/v1/clans/${encodeURIComponent(clanId)}/repositories`, linkedRepositoriesSchema, signal)
      ).flatMap((page) => page.repositories),
    };
  }
  unlinkRepository(clanId: string, repositoryId: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/repositories/${encodeURIComponent(repositoryId)}/unlink`,
      unlinkedRepositorySchema,
      {},
    );
  }
  async listContext(clanId: string) {
    return {
      entries: (await this.pages(`/v1/clans/${encodeURIComponent(clanId)}/context`, contextListSchema)).flatMap(
        (page) => page.entries,
      ),
    };
  }
  readContext(clanId: string, key: string) {
    contextKeySchema.parse(key);
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/context/${encodeURIComponent(key)}`,
      contextEntrySchema,
    );
  }
  writeContext(clanId: string, key: string, text: string, expectedRevision: number) {
    contextKeySchema.parse(key);
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/context/${encodeURIComponent(key)}`,
      contextEntrySchema,
      writeContextSchema.parse({ text, expectedRevision }),
    );
  }
  contextHistory(clanId: string, key: string) {
    contextKeySchema.parse(key);
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/context/${encodeURIComponent(key)}/history`,
      contextHistorySchema,
    );
  }
  createTask(clanId: string, description: string, repository?: RepositoryInput, alias?: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks`,
      taskSchema,
      createTaskSchema.parse({ description, repository, alias }),
    );
  }
  setTaskAlias(clanId: string, taskId: string, alias: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}/alias`,
      taskSchema,
      setAliasSchema.parse({ alias }),
    );
  }
  task(clanId: string, taskId: string, signal?: AbortSignal) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}`,
      taskSchema,
      undefined,
      signal,
    );
  }
  assignTask(clanId: string, taskId: string, agentId: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}/assign`,
      taskSchema,
      assignTaskSchema.parse({ agentId }),
    );
  }
  unassignTask(clanId: string, taskId: string, agentId: string) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}/unassign`,
      taskSchema,
      assignTaskSchema.parse({ agentId }),
    );
  }
  bindChatTaskRepository(clanId: string, taskId: string, repository: RepositoryInput) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}/chat-repository`,
      taskSchema,
      repositoryInputSchema.parse(repository),
    );
  }
  decideChatMerge(clanId: string, taskId: string, headSha: string, approve: boolean, signal?: AbortSignal) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}/merge-approval`,
      taskSchema,
      mergeApprovalSchema.parse({ headSha, approved: approve }),
      signal,
    );
  }
  reportTaskRepository(clanId: string, taskId: string, report: RepositoryReport) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}/repository`,
      taskSchema,
      repositoryReportSchema.parse(report),
    );
  }
  integrateTask(clanId: string, taskId: string, report: IntegrationReport, signal?: AbortSignal) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}/integration`,
      taskSchema,
      integrationReportSchema.parse(report),
      signal,
    );
  }
  listTasks(clanId: string, filters: TaskListFilters = {}) {
    const query = new URLSearchParams();
    if (filters.status) query.set('status', filters.status);
    if (filters.mine) query.set('mine', 'true');
    if (filters.limit !== undefined) query.set('limit', String(filters.limit));
    if (filters.after) query.set('after', filters.after);
    const search = query.size ? `?${query}` : '';
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/tasks${search}`, tasksSchema);
  }
  transitionTask(clanId: string, taskId: string, action: 'claim' | 'release' | 'complete') {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}/${action}`,
      taskSchema,
      {},
    );
  }

  events(clanId: string, cursor = 0, limit = 100, signal?: AbortSignal) {
    return this.request(
      `/v1/clans/${encodeURIComponent(clanId)}/events?cursor=${cursor}&limit=${limit}`,
      eventsSchema,
      undefined,
      signal,
    );
  }
  status(clanId: string) {
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/status`, statusSchema);
  }
}
