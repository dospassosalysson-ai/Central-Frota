import { getSupabaseAdmin, type UserProfile } from '../lib/supabase-server';
import { sendWhatsAppText } from '../lib/whatsapp';

export type InboxAction =
  | { action: 'send'; conversationId: string; text: string; authorName: string }
  | { action: 'assign'; conversationId: string; assignee: 'current' | 'wallace' | null }
  | { action: 'resolve'; conversationId: string; resolved: boolean }
  | { action: 'read'; conversationId: string };

type ContactRow = {
  name: string;
  phone: string;
  initials: string;
  color: string;
  type: 'driver' | 'supervisor' | 'supplier' | 'other';
  organization: string | null;
};

type ConversationRow = {
  id: string;
  status: 'open' | 'waiting' | 'resolved';
  assignee: 'current' | 'wallace' | null;
  last_message: string;
  last_message_at: number;
  unread_count: number;
  contacts: ContactRow | ContactRow[];
};

export async function getInboxSnapshot() {
  const database = getSupabaseAdmin();
  const { data: conversationData, error: conversationError } = await database
    .from('conversations')
    .select(`
      id,
      status,
      assignee,
      last_message,
      last_message_at,
      unread_count,
      contacts!inner(name, phone, initials, color, type, organization)
    `)
    .order('last_message_at', { ascending: false });
  if (conversationError) throw conversationError;

  const conversationRows = (conversationData ?? []) as unknown as ConversationRow[];
  const conversationIds = conversationRows.map((conversation) => conversation.id);
  if (!conversationIds.length) return { conversations: [] };

  const [messageResult, noteResult, conversationTagResult] = await Promise.all([
    database.from('messages').select('*').in('conversation_id', conversationIds).order('sent_at', { ascending: true }),
    database.from('notes').select('conversation_id, body, created_at').in('conversation_id', conversationIds).order('created_at', { ascending: false }),
    database.from('conversation_tags').select('conversation_id, tag_id').in('conversation_id', conversationIds),
  ]);
  if (messageResult.error) throw messageResult.error;
  if (noteResult.error) throw noteResult.error;
  if (conversationTagResult.error) throw conversationTagResult.error;

  const tagIds = [...new Set((conversationTagResult.data ?? []).map((entry) => entry.tag_id as string))];
  const tagResult = tagIds.length
    ? await database.from('tags').select('id, name, color').in('id', tagIds)
    : { data: [], error: null };
  if (tagResult.error) throw tagResult.error;

  const messagesByConversation = new Map<string, unknown[]>();
  for (const message of messageResult.data ?? []) {
    const conversationId = message.conversation_id as string;
    const entries = messagesByConversation.get(conversationId) ?? [];
    entries.push({
      id: message.id,
      direction: message.direction,
      body: message.body,
      sentAt: message.sent_at,
      authorName: message.author_name,
      authorSource: message.author_source,
      status: message.status,
    });
    messagesByConversation.set(conversationId, entries);
  }

  const latestNoteByConversation = new Map<string, string>();
  for (const note of noteResult.data ?? []) {
    const conversationId = note.conversation_id as string;
    if (!latestNoteByConversation.has(conversationId)) latestNoteByConversation.set(conversationId, note.body as string);
  }

  const tagById = new Map((tagResult.data ?? []).map((tag) => [tag.id as string, tag]));
  const tagsByConversation = new Map<string, unknown[]>();
  for (const relation of conversationTagResult.data ?? []) {
    const tag = tagById.get(relation.tag_id as string);
    if (!tag) continue;
    const conversationId = relation.conversation_id as string;
    const entries = tagsByConversation.get(conversationId) ?? [];
    entries.push(tag);
    tagsByConversation.set(conversationId, entries);
  }

  return {
    conversations: conversationRows.map((conversation) => {
      const contact = Array.isArray(conversation.contacts) ? conversation.contacts[0] : conversation.contacts;
      return {
        id: conversation.id,
        name: contact.name,
        phone: contact.phone,
        initials: contact.initials,
        color: contact.color,
        contactType: contact.type,
        organization: contact.organization,
        status: conversation.status,
        assignee: conversation.assignee,
        lastMessage: conversation.last_message,
        lastMessageAt: Number(conversation.last_message_at),
        unreadCount: conversation.unread_count,
        messages: messagesByConversation.get(conversation.id) ?? [],
        tags: tagsByConversation.get(conversation.id) ?? [],
        note: latestNoteByConversation.get(conversation.id) ?? '',
      };
    }),
  };
}

export async function mutateInbox(action: InboxAction, actor?: UserProfile) {
  const database = getSupabaseAdmin();

  if (action.action === 'send') {
    const text = action.text.trim();
    if (!text || text.length > 4096) throw new Error('Mensagem inválida.');
    const id = crypto.randomUUID();
    const sentAt = Date.now();
    const { data: conversation, error: conversationReadError } = await database.from('conversations').select('id, contacts!inner(phone)').eq('id', action.conversationId).single();
    if (conversationReadError || !conversation) throw conversationReadError || new Error('CONVERSATION_NOT_FOUND');
    const contactValue = conversation.contacts as unknown as { phone?: string } | { phone?: string }[];
    const phone = (Array.isArray(contactValue) ? contactValue[0]?.phone : contactValue?.phone) || '';
    const { error: messageError } = await database.from('messages').insert({
      id,
      conversation_id: action.conversationId,
      direction: 'outgoing',
      body: text,
      sent_at: sentAt,
      author_name: action.authorName,
      author_source: 'panel',
      status: 'queued',
    });
    if (messageError) throw messageError;
    const { error: conversationError } = await database.from('conversations').update({
      last_message: text,
      last_message_at: sentAt,
      unread_count: 0,
      status: 'open',
    }).eq('id', action.conversationId);
    if (conversationError) throw conversationError;
    let status: 'queued' | 'sent' | 'failed' = 'queued';
    let externalId: string | null = null;
    try {
      const delivery = await sendWhatsAppText(phone, text);
      if (delivery.configured) {
        status = 'sent';
        externalId = delivery.messageId;
        await database.from('messages').update({ status, external_id: externalId, metadata: { provider: 'meta-whatsapp' } }).eq('id', id);
      }
    } catch (error) {
      status = 'failed';
      await database.from('messages').update({ status, metadata: { provider: 'meta-whatsapp', error: error instanceof Error ? error.message.slice(0, 500) : 'Delivery failed' } }).eq('id', id);
    }
    await writeInboxAudit(actor, action.conversationId, 'message_sent', { messageId: id, deliveryStatus: status });
    return { id, direction: 'outgoing', body: text, sentAt, authorName: action.authorName, authorSource: 'panel', status, externalId };
  }

  if (action.action === 'assign') {
    const { data: current, error: readError } = await database.from('conversations').select('status').eq('id', action.conversationId).single();
    if (readError) throw readError;
    const { error } = await database.from('conversations').update({
      assignee: action.assignee,
      status: current.status === 'resolved' ? 'resolved' : 'open',
    }).eq('id', action.conversationId);
    if (error) throw error;
    await writeInboxAudit(actor, action.conversationId, 'assigned', { assignee: action.assignee });
    return { ok: true };
  }

  if (action.action === 'resolve') {
    const { error } = await database.from('conversations').update({ status: action.resolved ? 'resolved' : 'open' }).eq('id', action.conversationId);
    if (error) throw error;
    await writeInboxAudit(actor, action.conversationId, action.resolved ? 'resolved' : 'reopened', {});
    return { ok: true };
  }

  const { error } = await database.from('conversations').update({ unread_count: 0 }).eq('id', action.conversationId);
  if (error) throw error;
  return { ok: true };
}

async function writeInboxAudit(actor: UserProfile | undefined, conversationId: string, action: string, metadata: Record<string, unknown>) {
  if (!actor) return;
  const { error } = await getSupabaseAdmin().from('audit_events').insert({ actor_user_id: actor.userId, actor_name: actor.displayName, entity_type: 'conversation', entity_id: conversationId, action, metadata });
  if (error) console.error('Failed to write inbox audit', error);
}
