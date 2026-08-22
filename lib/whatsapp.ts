import { getSupabaseAdmin } from './supabase-server';

type JsonRecord = Record<string, unknown>;

function whatsAppConfiguration() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) return null;
  return {
    accessToken,
    phoneNumberId,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v23.0',
  };
}

export function isWhatsAppConfigured() {
  return Boolean(whatsAppConfiguration());
}

export async function sendWhatsAppText(to: string, body: string) {
  const configuration = whatsAppConfiguration();
  if (!configuration) return { configured: false as const, messageId: null };
  const response = await fetch(`https://graph.facebook.com/${configuration.graphVersion}/${configuration.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${configuration.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/\D/g, ''), type: 'text', text: { preview_url: false, body } }),
  });
  const payload = await response.json().catch(() => ({})) as { messages?: { id?: string }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `WhatsApp returned HTTP ${response.status}`);
  return { configured: true as const, messageId: payload.messages?.[0]?.id || null };
}

export async function processWhatsAppWebhook(payload: JsonRecord) {
  const database = getSupabaseAdmin();
  const entries = Array.isArray(payload.entry) ? payload.entry.filter(isRecord) : [];
  let processed = 0;
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes.filter(isRecord) : [];
    for (const change of changes) {
      const value = isRecord(change.value) ? change.value : {};
      const contacts = Array.isArray(value.contacts) ? value.contacts.filter(isRecord) : [];
      const contactNameByPhone = new Map<string, string>();
      for (const contact of contacts) {
        const profile = isRecord(contact.profile) ? contact.profile : {};
        if (typeof contact.wa_id === 'string') contactNameByPhone.set(contact.wa_id, typeof profile.name === 'string' ? profile.name : contact.wa_id);
      }

      const messages = Array.isArray(value.messages) ? value.messages.filter(isRecord) : [];
      for (const message of messages) {
        if (typeof message.id !== 'string' || typeof message.from !== 'string') continue;
        await ingestIncomingMessage(message, contactNameByPhone.get(message.from));
        processed += 1;
      }

      const echoes = [value.smb_message_echoes, value.message_echoes].flatMap((item) => Array.isArray(item) ? item.filter(isRecord) : []);
      for (const echo of echoes) {
        await ingestMobileEcho(echo);
        processed += 1;
      }

      const statuses = Array.isArray(value.statuses) ? value.statuses.filter(isRecord) : [];
      for (const status of statuses) {
        if (typeof status.id !== 'string' || typeof status.status !== 'string') continue;
        const normalized = ['sent', 'delivered', 'read', 'failed'].includes(status.status) ? status.status : 'sent';
        await database.from('messages').update({ status: normalized, metadata: status }).eq('external_id', status.id);
        processed += 1;
      }
    }
  }
  return { processed };
}

async function ingestIncomingMessage(message: JsonRecord, contactName?: string) {
  const database = getSupabaseAdmin();
  const phone = String(message.from);
  const body = extractMessageBody(message);
  const sentAt = Number(message.timestamp) > 0 ? Number(message.timestamp) * 1000 : Date.now();
  const contact = await findOrCreateContact(phone, contactName || phone);
  const conversation = await findOrCreateConversation(contact.id, phone, body, sentAt);
  const { error } = await database.from('messages').upsert({
    id: crypto.randomUUID(),
    conversation_id: conversation.id,
    external_id: String(message.id),
    direction: 'incoming',
    body,
    message_type: typeof message.type === 'string' ? message.type : 'unknown',
    sent_at: sentAt,
    status: 'delivered',
    metadata: message,
  }, { onConflict: 'external_id', ignoreDuplicates: true });
  if (error) throw error;
  await database.from('conversations').update({
    last_message: body,
    last_message_at: sentAt,
    unread_count: Number(conversation.unread_count || 0) + 1,
    status: conversation.status === 'resolved' ? 'waiting' : conversation.status,
    updated_at: Date.now(),
  }).eq('id', conversation.id);
}

async function ingestMobileEcho(message: JsonRecord) {
  const externalId = typeof message.id === 'string' ? message.id : null;
  const phone = typeof message.to === 'string' ? message.to : typeof message.from === 'string' ? message.from : null;
  if (!externalId || !phone) return;
  const database = getSupabaseAdmin();
  const body = extractMessageBody(message);
  const sentAt = Number(message.timestamp) > 0 ? Number(message.timestamp) * 1000 : Date.now();
  const contact = await findOrCreateContact(phone, phone);
  const conversation = await findOrCreateConversation(contact.id, phone, body, sentAt);
  const { error } = await database.from('messages').upsert({
    id: crypto.randomUUID(),
    conversation_id: conversation.id,
    external_id: externalId,
    direction: 'outgoing',
    body,
    message_type: typeof message.type === 'string' ? message.type : 'unknown',
    sent_at: sentAt,
    author_name: 'Wallace',
    author_source: 'mobile',
    status: 'sent',
    metadata: message,
  }, { onConflict: 'external_id', ignoreDuplicates: true });
  if (error) throw error;
  await database.from('conversations').update({ last_message: body, last_message_at: sentAt, assignee: 'wallace', updated_at: Date.now() }).eq('id', conversation.id);
}

async function findOrCreateContact(phone: string, name: string) {
  const database = getSupabaseAdmin();
  const { data: existing, error } = await database.from('contacts').select('id').eq('phone', phone).maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const id = crypto.randomUUID();
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'WA';
  const { error: insertError } = await database.from('contacts').insert({ id, name, phone, initials, color: 'green', type: 'other' });
  if (insertError) throw insertError;
  return { id };
}

async function findOrCreateConversation(contactId: string, phone: string, lastMessage: string, sentAt: number) {
  const database = getSupabaseAdmin();
  const externalId = `whatsapp:${phone}`;
  const { data: existing, error } = await database.from('conversations').select('id, status, unread_count').eq('external_id', externalId).maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const row = { id: crypto.randomUUID(), contact_id: contactId, status: 'waiting', assignee: null, last_message: lastMessage, last_message_at: sentAt, unread_count: 0, external_id: externalId };
  const { error: insertError } = await database.from('conversations').insert(row);
  if (insertError) throw insertError;
  return row;
}

function extractMessageBody(message: JsonRecord) {
  const text = isRecord(message.text) ? message.text : {};
  if (typeof text.body === 'string') return text.body;
  const document = isRecord(message.document) ? message.document : {};
  if (typeof document.filename === 'string') return `Documento recebido: ${document.filename}`;
  const image = isRecord(message.image) ? message.image : {};
  if (typeof image.caption === 'string' && image.caption) return image.caption;
  const type = typeof message.type === 'string' ? message.type : 'mensagem';
  return `[${type} recebido]`;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
