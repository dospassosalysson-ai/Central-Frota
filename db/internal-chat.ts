import { getSupabaseAdmin, type UserProfile } from '../lib/supabase-server';

const GENERAL_CHANNEL_ID = 'team-general';

type DatabaseRow = Record<string, unknown>;

export class InternalChatError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export type InternalChatAction =
  | { action: 'send'; channelId: string; text: string; clientMessageId: string; replyToId?: string | null }
  | { action: 'read'; channelId: string; messageId: string }
  | { action: 'open-direct'; targetUserId: string }
  | { action: 'open-conversation'; conversationId: string };

export async function getInternalChatSnapshot(viewer: UserProfile) {
  const database = getSupabaseAdmin();
  await ensureGeneralChannel(viewer);

  const [teamResult, viewerMembershipResult] = await Promise.all([
    database
      .from('profiles')
      .select('user_id, email, display_name, job_title, role, active')
      .eq('active', true)
      .order('display_name'),
    database
      .from('internal_channel_members')
      .select('channel_id, last_read_at, last_read_message_id')
      .eq('user_id', viewer.userId),
  ]);
  if (teamResult.error) throw teamResult.error;
  if (viewerMembershipResult.error) throw viewerMembershipResult.error;

  const viewerMemberships = (viewerMembershipResult.data ?? []) as DatabaseRow[];
  const channelIds = viewerMemberships.map((entry) => String(entry.channel_id));
  const teamRows = (teamResult.data ?? []) as DatabaseRow[];
  const team = teamRows.map((row) => mapProfile(row, viewer.role === 'admin'));

  if (!channelIds.length) {
    return { viewer, team, channels: [] };
  }

  const [channelResult, memberResult] = await Promise.all([
    database
      .from('internal_channels')
      .select('id, channel_type, name, context_type, context_id, context_label, last_message, last_message_at, created_at')
      .in('id', channelIds),
    database
      .from('internal_channel_members')
      .select('channel_id, user_id, last_read_at, last_read_message_id, joined_at')
      .in('channel_id', channelIds),
  ]);
  if (channelResult.error) throw channelResult.error;
  if (memberResult.error) throw memberResult.error;

  const [messageResults, unreadResults] = await Promise.all([
    Promise.all(channelIds.map((channelId) => database
      .from('internal_messages')
      .select('id, channel_id, author_id, author_name, body, reply_to_id, created_at, edited_at')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(200))),
    Promise.all(viewerMemberships.map((membership) => database
      .from('internal_messages')
      .select('id', { count: 'exact', head: true })
      .eq('channel_id', String(membership.channel_id))
      .neq('author_id', viewer.userId)
      .gt('created_at', String(membership.last_read_at)))),
  ]);
  const messageRows: DatabaseRow[] = [];
  for (const result of messageResults) {
    if (result.error) throw result.error;
    messageRows.push(...([...((result.data ?? []) as DatabaseRow[])]).reverse());
  }
  const unreadByChannel = new Map<string, number>();
  unreadResults.forEach((result, index) => {
    if (result.error) throw result.error;
    unreadByChannel.set(String(viewerMemberships[index].channel_id), result.count ?? 0);
  });

  const memberRows = (memberResult.data ?? []) as DatabaseRow[];
  const missingProfileIds = [...new Set(memberRows.map((entry) => String(entry.user_id)).filter((id) => !team.some((profile) => profile.userId === id)))];
  if (missingProfileIds.length) {
    const missingResult = await database
      .from('profiles')
      .select('user_id, email, display_name, job_title, role, active')
      .in('user_id', missingProfileIds);
    if (missingResult.error) throw missingResult.error;
    team.push(...((missingResult.data ?? []) as DatabaseRow[]).map((row) => mapProfile(row, viewer.role === 'admin')));
  }

  const profileById = new Map(team.map((profile) => [profile.userId, profile]));
  const membershipsByChannel = new Map<string, DatabaseRow[]>();
  for (const membership of memberRows) {
    const channelId = String(membership.channel_id);
    const entries = membershipsByChannel.get(channelId) ?? [];
    entries.push(membership);
    membershipsByChannel.set(channelId, entries);
  }

  const messagesByChannel = new Map<string, DatabaseRow[]>();
  for (const message of messageRows) {
    const channelId = String(message.channel_id);
    const entries = messagesByChannel.get(channelId) ?? [];
    entries.push(message);
    messagesByChannel.set(channelId, entries);
  }

  const viewerReadByChannel = new Map(viewerMemberships.map((entry) => [String(entry.channel_id), dateValue(entry.last_read_at)]));
  const channels = ((channelResult.data ?? []) as DatabaseRow[]).map((channel) => {
    const channelId = String(channel.id);
    const memberships = membershipsByChannel.get(channelId) ?? [];
    const channelMessages = messagesByChannel.get(channelId) ?? [];
    const readAt = viewerReadByChannel.get(channelId) ?? 0;
    const messages = channelMessages.map((message) => ({
      id: String(message.id),
      channelId,
      authorId: message.author_id ? String(message.author_id) : '',
      authorName: String(message.author_name || 'Equipe'),
      body: String(message.body || ''),
      replyToId: message.reply_to_id ? String(message.reply_to_id) : null,
      createdAt: String(message.created_at),
      editedAt: message.edited_at ? String(message.edited_at) : null,
      readBy: memberships
        .filter((membership) => membership.last_read_message_id && String(membership.user_id) !== String(message.author_id) && dateValue(membership.last_read_at) >= dateValue(message.created_at))
        .map((membership) => String(membership.user_id)),
    }));
    return {
      id: channelId,
      channelType: String(channel.channel_type) as 'group' | 'direct' | 'conversation',
      name: channel.name ? String(channel.name) : null,
      contextType: channel.context_type ? String(channel.context_type) : null,
      contextId: channel.context_id ? String(channel.context_id) : null,
      contextLabel: channel.context_label ? String(channel.context_label) : null,
      lastMessage: String(channel.last_message || ''),
      lastMessageAt: channel.last_message_at ? String(channel.last_message_at) : null,
      createdAt: String(channel.created_at),
      unreadCount: unreadByChannel.get(channelId) ?? channelMessages.filter((message) => String(message.author_id) !== viewer.userId && dateValue(message.created_at) > readAt).length,
      members: memberships.map((membership) => ({
        ...(profileById.get(String(membership.user_id)) ?? {
          userId: String(membership.user_id),
          email: '',
          displayName: 'Integrante',
          jobTitle: '',
          role: 'attendant',
          active: false,
        }),
        lastReadAt: membership.last_read_at ? String(membership.last_read_at) : null,
        lastReadMessageId: membership.last_read_message_id ? String(membership.last_read_message_id) : null,
      })),
      messages,
    };
  }).sort((left, right) => {
    if (left.id === GENERAL_CHANNEL_ID) return -1;
    if (right.id === GENERAL_CHANNEL_ID) return 1;
    return dateValue(right.lastMessageAt || right.createdAt) - dateValue(left.lastMessageAt || left.createdAt);
  });

  return { viewer, team, channels };
}

export async function mutateInternalChat(action: InternalChatAction, actor: UserProfile) {
  if (action.action === 'open-direct') return openDirectChannel(actor, action.targetUserId);
  if (action.action === 'open-conversation') return openConversationChannel(actor, action.conversationId);

  const database = getSupabaseAdmin();
  await requireMembership(action.channelId, actor.userId);

  if (action.action === 'read') {
    const { data: message, error: messageError } = await database
      .from('internal_messages')
      .select('id, created_at')
      .eq('id', action.messageId)
      .eq('channel_id', action.channelId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message) throw new InternalChatError('Mensagem não encontrada neste canal.', 404);
    const readAt = String(message.created_at);
    const { error } = await database
      .from('internal_channel_members')
      .update({ last_read_at: readAt, last_read_message_id: message.id })
      .eq('channel_id', action.channelId)
      .eq('user_id', actor.userId)
      .lt('last_read_at', readAt);
    if (error) throw error;
    const notificationResult = await database
      .from('notifications')
      .update({ read_at: readAt })
      .eq('recipient_id', actor.userId)
      .eq('entity_type', 'internal_channel')
      .eq('entity_id', action.channelId)
      .lte('created_at', readAt)
      .is('read_at', null);
    if (notificationResult.error) console.error('Failed to mark chat notifications as read', notificationResult.error);
    return { ok: true, readAt, messageId: message.id };
  }

  const text = action.text.trim();
  if (!text || text.length > 4000) throw new InternalChatError('A mensagem precisa ter entre 1 e 4.000 caracteres.');
  if (!isUuid(action.clientMessageId)) throw new InternalChatError('Identificador da mensagem inválido.');
  const { data: rows, error: sendError } = await database.rpc('send_internal_chat_message', {
    p_message_id: action.clientMessageId,
    p_channel_id: action.channelId,
    p_actor_id: actor.userId,
    p_actor_name: actor.displayName,
    p_body: text,
    p_reply_to_id: action.replyToId || null,
  });
  if (sendError) {
    if (/FORBIDDEN/i.test(sendError.message)) throw new InternalChatError('Você não participa deste canal.', 403);
    if (/INVALID_REPLY/i.test(sendError.message)) throw new InternalChatError('A mensagem respondida não pertence a este canal.');
    throw sendError;
  }
  const saved = ((rows ?? []) as DatabaseRow[])[0];
  if (!saved) throw new Error('MESSAGE_NOT_RETURNED');
  return {
    id: String(saved.id),
    channelId: action.channelId,
    authorId: actor.userId,
    authorName: actor.displayName,
    body: String(saved.body),
    replyToId: saved.reply_to_id ? String(saved.reply_to_id) : null,
    createdAt: String(saved.created_at),
    editedAt: null,
    readBy: [],
  };
}

async function ensureGeneralChannel(viewer: UserProfile) {
  const database = getSupabaseAdmin();
  const { error: channelError } = await database.from('internal_channels').upsert({
    id: GENERAL_CHANNEL_ID,
    channel_type: 'group',
    name: 'Geral da Frota',
    created_by: viewer.userId,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (channelError) throw channelError;

  const { data: profiles, error: profileError } = await database
    .from('profiles')
    .select('user_id')
    .eq('active', true);
  if (profileError) throw profileError;
  const memberships = (profiles ?? []).map((profile) => ({
    channel_id: GENERAL_CHANNEL_ID,
    user_id: profile.user_id,
  }));
  if (!memberships.length) return;
  const { error: membershipError } = await database
    .from('internal_channel_members')
    .upsert(memberships, { onConflict: 'channel_id,user_id', ignoreDuplicates: true });
  if (membershipError) throw membershipError;
}

async function openDirectChannel(actor: UserProfile, targetUserId: string) {
  if (!targetUserId || targetUserId === actor.userId) throw new InternalChatError('Escolha outro integrante da equipe.');
  const database = getSupabaseAdmin();
  const { data: target, error: targetError } = await database
    .from('profiles')
    .select('user_id, display_name')
    .eq('user_id', targetUserId)
    .eq('active', true)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new InternalChatError('Integrante não encontrado.', 404);

  const directKey = [actor.userId, targetUserId].sort().join(':');
  const { data: initialChannel, error: channelError } = await database
    .from('internal_channels')
    .select('id')
    .eq('direct_key', directKey)
    .maybeSingle();
  if (channelError) throw channelError;
  let channel = initialChannel;

  if (!channel) {
    const candidateId = `direct-${crypto.randomUUID()}`;
    const insertResult = await database.from('internal_channels').insert({
      id: candidateId,
      channel_type: 'direct',
      name: null,
      direct_key: directKey,
      created_by: actor.userId,
    }).select('id').single();
    if (insertResult.error) {
      if (insertResult.error.code !== '23505') throw insertResult.error;
      const retry = await database.from('internal_channels').select('id').eq('direct_key', directKey).single();
      if (retry.error) throw retry.error;
      channel = retry.data;
    } else {
      channel = insertResult.data;
    }
  }

  await addMembers(String(channel.id), [actor.userId, targetUserId]);
  return { channelId: String(channel.id) };
}

async function openConversationChannel(actor: UserProfile, conversationId: string) {
  if (!conversationId) throw new InternalChatError('Atendimento inválido.');
  const database = getSupabaseAdmin();
  const { data: conversation, error: conversationError } = await database
    .from('conversations')
    .select('id, contacts!inner(name)')
    .eq('id', conversationId)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation) throw new InternalChatError('Atendimento não encontrado.', 404);
  const contactValue = conversation.contacts as unknown as { name?: string } | { name?: string }[];
  const contactName = (Array.isArray(contactValue) ? contactValue[0]?.name : contactValue?.name) || 'Contato';

  const { data: initialChannel, error: channelError } = await database
    .from('internal_channels')
    .select('id')
    .eq('context_type', 'conversation')
    .eq('context_id', conversationId)
    .maybeSingle();
  if (channelError) throw channelError;
  let channel = initialChannel;

  if (!channel) {
    const candidateId = `conversation-${crypto.randomUUID()}`;
    const insertResult = await database.from('internal_channels').insert({
      id: candidateId,
      channel_type: 'conversation',
      name: `Atendimento • ${contactName}`,
      context_type: 'conversation',
      context_id: conversationId,
      context_label: `Atendimento com ${contactName}`,
      created_by: actor.userId,
    }).select('id').single();
    if (insertResult.error) {
      if (insertResult.error.code !== '23505') throw insertResult.error;
      const retry = await database
        .from('internal_channels')
        .select('id')
        .eq('context_type', 'conversation')
        .eq('context_id', conversationId)
        .single();
      if (retry.error) throw retry.error;
      channel = retry.data;
    } else {
      channel = insertResult.data;
    }
  }

  const { data: activeProfiles, error: profileError } = await database
    .from('profiles')
    .select('user_id')
    .eq('active', true);
  if (profileError) throw profileError;
  await addMembers(String(channel.id), (activeProfiles ?? []).map((profile) => String(profile.user_id)));
  await writeChatAudit(actor, String(channel.id), 'conversation_chat_opened', { conversationId });
  return { channelId: String(channel.id) };
}

async function addMembers(channelId: string, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) return;
  const { error } = await getSupabaseAdmin()
    .from('internal_channel_members')
    .upsert(uniqueUserIds.map((userId) => ({ channel_id: channelId, user_id: userId })), {
      onConflict: 'channel_id,user_id',
      ignoreDuplicates: true,
    });
  if (error) throw error;
}

async function requireMembership(channelId: string, userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('internal_channel_members')
    .select('channel_id')
    .eq('channel_id', channelId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new InternalChatError('Você não participa deste canal.', 403);
}

async function writeChatAudit(actor: UserProfile, channelId: string, action: string, metadata: Record<string, unknown>) {
  const { error } = await getSupabaseAdmin().from('audit_events').insert({
    actor_user_id: actor.userId,
    actor_name: actor.displayName,
    entity_type: 'internal_channel',
    entity_id: channelId,
    action,
    metadata,
  });
  if (error) console.error('Failed to write internal chat audit', error);
}

function mapProfile(row: DatabaseRow, includeEmail: boolean) {
  return {
    userId: String(row.user_id),
    email: includeEmail ? String(row.email || '') : '',
    displayName: String(row.display_name || (includeEmail ? row.email : '') || 'Integrante'),
    jobTitle: String(row.job_title || (row.role === 'admin' ? 'Administrador da Central' : 'Assistente')),
    role: String(row.role || 'attendant'),
    active: Boolean(row.active),
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function dateValue(value: unknown) {
  if (!value) return 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
