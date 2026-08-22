import { getSupabaseAdmin, type UserProfile } from '../lib/supabase-server';

type ChecklistItem = { id: string; label: string; done: boolean };
type DatabaseRow = Record<string, unknown>;

export type ManagementAction =
  | { action: 'invite-user'; email: string; fullName: string; jobTitle?: string; role?: 'admin' | 'attendant' }
  | { action: 'update-member'; userId: string; active?: boolean; role?: 'admin' | 'attendant' }
  | {
      action: 'create-plan';
      title: string;
      description?: string;
      category: 'operational' | 'fleet' | 'fiscal' | 'financial' | 'team' | 'supplier' | 'improvement';
      priority: 'low' | 'medium' | 'high' | 'critical';
      ownerId?: string | null;
      ownerName?: string;
      dueAt?: string | null;
      checklist?: string[];
    }
  | { action: 'update-plan-status'; planId: string; status: 'backlog' | 'planned' | 'in_progress' | 'blocked' | 'review' | 'completed' | 'cancelled' }
  | { action: 'toggle-checklist'; planId: string; checklistId: string; done: boolean }
  | { action: 'add-comment'; planId: string; body: string }
  | { action: 'read-notification'; notificationId: string }
  | { action: 'decide-approval'; approvalId: string; decision: 'approved' | 'rejected'; note?: string };

function asChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DatabaseRow => Boolean(item) && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `item-${index + 1}`,
      label: typeof item.label === 'string' ? item.label : 'Etapa',
      done: item.done === true,
    }));
}

export async function getManagementSnapshot(profile: UserProfile) {
  const database = getSupabaseAdmin();
  let plansQuery = database.from('action_plans').select('*').order('updated_at', { ascending: false });
  if (profile.role !== 'admin') {
    plansQuery = plansQuery.or(`owner_id.eq.${profile.userId},created_by.eq.${profile.userId}`);
  }

  const [profilesResult, plansResult, commentsResult, notificationsResult, conversationsResult, documentsResult, budgetsResult, centersResult, approvalsResult, messagesResult, auditResult] = await Promise.all([
    database.from('profiles').select('user_id, email, display_name, job_title, role, active, updated_at').eq('active', true).order('display_name'),
    plansQuery,
    database.from('action_comments').select('*').order('created_at', { ascending: true }),
    database.from('notifications').select('*').eq('recipient_id', profile.userId).order('created_at', { ascending: false }).limit(30),
    database.from('conversations').select('id, status, assignee, unread_count, last_message_at, updated_at'),
    database.from('fiscal_documents').select('id, status, total_value_cents, due_date, updated_at, cost_center_id'),
    database.from('budget_envelopes').select('*').order('reference_month', { ascending: false }),
    database.from('cost_centers').select('id, code, name'),
    database.from('approval_requests').select('*').order('created_at', { ascending: false }).limit(50),
    database.from('messages').select('sent_at, direction').gte('sent_at', Date.now() - 12 * 60 * 60 * 1000).order('sent_at'),
    profile.role === 'admin'
      ? database.from('audit_events').select('*').order('created_at', { ascending: false }).limit(30)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [profilesResult, plansResult, commentsResult, notificationsResult, conversationsResult, documentsResult, budgetsResult, centersResult, approvalsResult, messagesResult, auditResult]) {
    if (result.error) throw result.error;
  }

  const comments = (commentsResult.data ?? []) as DatabaseRow[];
  const commentsByPlan = new Map<string, DatabaseRow[]>();
  for (const comment of comments) {
    const planId = String(comment.action_plan_id);
    commentsByPlan.set(planId, [...(commentsByPlan.get(planId) ?? []), comment]);
  }

  const centers = new Map(((centersResult.data ?? []) as DatabaseRow[]).map((center) => [String(center.id), center]));
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const conversations = (conversationsResult.data ?? []) as DatabaseRow[];
  const documents = (documentsResult.data ?? []) as DatabaseRow[];
  const messageRows = (messagesResult.data ?? []) as DatabaseRow[];
  const traffic = Array.from({ length: 6 }, (_, index) => {
    const end = now - (5 - index) * 2 * 60 * 60 * 1000;
    const start = end - 2 * 60 * 60 * 1000;
    const entries = messageRows.filter((message) => Number(message.sent_at) >= start && Number(message.sent_at) < end);
    return {
      label: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit' }).format(new Date(end)),
      incoming: entries.filter((message) => message.direction === 'incoming').length,
      outgoing: entries.filter((message) => message.direction === 'outgoing').length,
    };
  });
  const plans = ((plansResult.data ?? []) as DatabaseRow[]).map((plan) => {
    const checklist = asChecklist(plan.checklist);
    const completedItems = checklist.filter((item) => item.done).length;
    return {
      id: plan.id,
      title: plan.title,
      description: plan.description,
      category: plan.category,
      status: plan.status,
      priority: plan.priority,
      ownerId: plan.owner_id,
      ownerName: plan.owner_name || 'Sem responsável',
      createdByName: plan.created_by_name,
      dueAt: plan.due_at,
      completedAt: plan.completed_at,
      checklist,
      progress: checklist.length ? Math.round((completedItems / checklist.length) * 100) : plan.status === 'completed' ? 100 : 0,
      updatedAt: plan.updated_at,
      comments: (commentsByPlan.get(String(plan.id)) ?? []).map((comment) => ({
        id: comment.id,
        authorName: comment.author_name,
        body: comment.body,
        createdAt: comment.created_at,
      })),
    };
  });

  return {
    viewer: profile,
    team: ((profilesResult.data ?? []) as DatabaseRow[]).map((member) => ({
      userId: member.user_id,
      email: profile.role === 'admin' ? member.email : undefined,
      displayName: member.display_name,
      jobTitle: member.job_title || (member.role === 'admin' ? 'Administrador da Central' : 'Assistente'),
      role: member.role,
      active: member.active,
      assignedPlans: plans.filter((plan) => plan.ownerId === member.user_id && !['completed', 'cancelled'].includes(String(plan.status))).length,
      completedPlans: plans.filter((plan) => plan.ownerId === member.user_id && plan.status === 'completed').length,
    })),
    plans,
    notifications: ((notificationsResult.data ?? []) as DatabaseRow[]).map((notification) => ({
      id: notification.id,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      entityType: notification.entity_type,
      entityId: notification.entity_id,
      readAt: notification.read_at,
      createdAt: notification.created_at,
    })),
    approvals: (profile.role === 'admin' ? ((approvalsResult.data ?? []) as DatabaseRow[]) : []).map((approval) => ({
      id: approval.id,
      requestType: approval.request_type,
      title: approval.title,
      description: approval.description,
      amountCents: Number(approval.amount_cents),
      status: approval.status,
      requesterName: approval.requester_name,
      createdAt: approval.created_at,
    })),
    budgets: (profile.role === 'admin' ? ((budgetsResult.data ?? []) as DatabaseRow[]) : []).map((budget) => {
      const center = centers.get(String(budget.cost_center_id));
      const planned = Number(budget.planned_value_cents);
      const actual = Number(budget.actual_value_cents);
      return {
        id: budget.id,
        centerCode: center?.code ?? 'Geral',
        centerName: center?.name ?? 'Centro não vinculado',
        referenceMonth: budget.reference_month,
        plannedValueCents: planned,
        committedValueCents: Number(budget.committed_value_cents),
        actualValueCents: actual,
        consumptionPercent: planned ? Math.round((actual / planned) * 100) : 0,
      };
    }),
    audit: ((auditResult.data ?? []) as DatabaseRow[]).map((event) => ({
      id: event.id,
      actorName: event.actor_name,
      entityType: event.entity_type,
      entityId: event.entity_id,
      action: event.action,
      createdAt: event.created_at,
    })),
    traffic,
    overview: {
      openConversations: conversations.filter((conversation) => conversation.status !== 'resolved').length,
      waitingConversations: conversations.filter((conversation) => conversation.status === 'waiting').length,
      unreadMessages: conversations.reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0),
      conversationsToday: conversations.filter((conversation) => Number(conversation.last_message_at) >= startOfDay.getTime()).length,
      pendingDocuments: documents.filter((document) => document.status !== 'completed').length,
      documentsInCorrection: documents.filter((document) => document.status === 'correction').length,
      fiscalValueCents: documents.reduce((sum, document) => sum + Number(document.total_value_cents || 0), 0),
      overduePlans: plans.filter((plan) => plan.dueAt && new Date(String(plan.dueAt)).getTime() < now && !['completed', 'cancelled'].includes(String(plan.status))).length,
      openPlans: plans.filter((plan) => !['completed', 'cancelled'].includes(String(plan.status))).length,
      pendingApprovals: ((approvalsResult.data ?? []) as DatabaseRow[]).filter((approval) => approval.status === 'pending').length,
    },
  };
}

export async function mutateManagement(action: ManagementAction, profile: UserProfile) {
  const database = getSupabaseAdmin();

  if (action.action === 'invite-user') {
    if (profile.role !== 'admin') throw new Error('FORBIDDEN');
    const email = action.email.trim().toLowerCase();
    const fullName = action.fullName.trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || !fullName) throw new Error('INVALID_MEMBER');
    const redirectTo = `${(process.env.APP_URL || 'https://central-frota.onrender.com').replace(/\/$/, '')}/?first_access=1`;
    const { data, error } = await database.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: fullName, job_title: action.jobTitle?.trim() || null } });
    if (error || !data.user) throw new Error(error?.message || 'INVITE_FAILED');
    if (action.role === 'admin') await database.from('profiles').update({ role: 'admin', updated_at: new Date().toISOString() }).eq('user_id', data.user.id);
    await writeAudit(profile, 'team_member', data.user.id, 'invited', { email, role: action.role || 'attendant' });
    return { ok: true, userId: data.user.id };
  }

  if (action.action === 'update-member') {
    if (profile.role !== 'admin' || (action.userId === profile.userId && action.active === false)) throw new Error('FORBIDDEN');
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof action.active === 'boolean') update.active = action.active;
    if (action.role) update.role = action.role;
    const { error } = await database.from('profiles').update(update).eq('user_id', action.userId);
    if (error) throw error;
    await writeAudit(profile, 'team_member', action.userId, 'updated', update);
    return { ok: true };
  }

  if (action.action === 'read-notification') {
    const { error } = await database.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', action.notificationId).eq('recipient_id', profile.userId);
    if (error) throw error;
    return { ok: true };
  }

  if (action.action === 'create-plan') {
    if (profile.role !== 'admin') throw new Error('FORBIDDEN');
    const title = action.title.trim();
    if (!title) throw new Error('INVALID_PLAN');
    let ownerName = action.ownerName?.trim() || null;
    if (action.ownerId) {
      const { data: owner, error } = await database.from('profiles').select('display_name').eq('user_id', action.ownerId).eq('active', true).single();
      if (error || !owner) throw new Error('INVALID_OWNER');
      ownerName = owner.display_name;
    }
    const id = crypto.randomUUID();
    const checklist = (action.checklist ?? []).map((label) => label.trim()).filter(Boolean).slice(0, 20).map((label) => ({ id: crypto.randomUUID(), label, done: false }));
    const { error } = await database.from('action_plans').insert({
      id,
      title,
      description: action.description?.trim() || '',
      category: action.category,
      priority: action.priority,
      owner_id: action.ownerId || null,
      owner_name: ownerName,
      created_by: profile.userId,
      created_by_name: profile.displayName,
      due_at: action.dueAt || null,
      checklist,
    });
    if (error) throw error;
    if (action.ownerId) {
      await database.from('notifications').insert({
        recipient_id: action.ownerId,
        kind: 'action_assigned',
        title: 'Novo plano de ação',
        body: `${profile.displayName} atribuiu: ${title}`,
        entity_type: 'action_plan',
        entity_id: id,
      });
    }
    await writeAudit(profile, 'action_plan', id, 'created', { ownerId: action.ownerId || null });
    return { id };
  }

  if (action.action === 'decide-approval') {
    if (profile.role !== 'admin') throw new Error('FORBIDDEN');
    const { error } = await database.from('approval_requests').update({
      status: action.decision,
      approver_id: profile.userId,
      decided_at: new Date().toISOString(),
      decision_note: action.note?.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', action.approvalId).eq('status', 'pending');
    if (error) throw error;
    await writeAudit(profile, 'approval', action.approvalId, action.decision, {});
    return { ok: true };
  }

  const planId = action.planId;
  const { data: plan, error: planError } = await database.from('action_plans').select('*').eq('id', planId).single();
  if (planError || !plan) throw new Error('PLAN_NOT_FOUND');
  const mayEdit = profile.role === 'admin' || plan.owner_id === profile.userId || plan.created_by === profile.userId;
  if (!mayEdit) throw new Error('FORBIDDEN');

  if (action.action === 'add-comment') {
    const body = action.body.trim();
    if (!body) throw new Error('INVALID_COMMENT');
    const { error } = await database.from('action_comments').insert({ action_plan_id: planId, author_id: profile.userId, author_name: profile.displayName, body });
    if (error) throw error;
    await writeAudit(profile, 'action_plan', planId, 'commented', {});
    return { ok: true };
  }

  if (action.action === 'toggle-checklist') {
    const checklist = asChecklist(plan.checklist).map((item) => item.id === action.checklistId ? { ...item, done: action.done } : item);
    const { error } = await database.from('action_plans').update({ checklist, updated_at: new Date().toISOString() }).eq('id', planId);
    if (error) throw error;
    await writeAudit(profile, 'action_plan', planId, 'checklist_updated', { checklistId: action.checklistId, done: action.done });
    return { ok: true };
  }

  const completedAt = action.status === 'completed' ? new Date().toISOString() : null;
  const { error } = await database.from('action_plans').update({ status: action.status, completed_at: completedAt, updated_at: new Date().toISOString() }).eq('id', planId);
  if (error) throw error;
  await writeAudit(profile, 'action_plan', planId, `status_${action.status}`, {});
  if (action.status === 'completed') await notifyPlanCompletion(plan, profile);
  return { ok: true, status: action.status };
}

async function writeAudit(profile: UserProfile, entityType: string, entityId: string, action: string, metadata: Record<string, unknown>) {
  const { error } = await getSupabaseAdmin().from('audit_events').insert({
    actor_user_id: profile.userId,
    actor_name: profile.displayName,
    entity_type: entityType,
    entity_id: entityId,
    action,
    metadata,
  });
  if (error) console.error('Failed to write audit event', error);
}

async function notifyPlanCompletion(plan: DatabaseRow, actor: UserProfile) {
  const database = getSupabaseAdmin();
  const recipients = new Set<string>();
  if (typeof plan.created_by === 'string') recipients.add(plan.created_by);
  const { data: admins } = await database.from('profiles').select('user_id').eq('role', 'admin').eq('active', true);
  for (const admin of admins ?? []) recipients.add(admin.user_id);
  recipients.delete(actor.userId);
  if (!recipients.size) return;
  await database.from('notifications').insert([...recipients].map((recipientId) => ({
    recipient_id: recipientId,
    kind: 'action_completed',
    title: 'Plano de ação concluído',
    body: `${actor.displayName} concluiu: ${String(plan.title)}`,
    entity_type: 'action_plan',
    entity_id: String(plan.id),
  })));
}
