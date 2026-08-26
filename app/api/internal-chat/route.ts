import { getInternalChatSnapshot, InternalChatError, mutateInternalChat, type InternalChatAction } from '../../../db/internal-chat';
import { requireUserProfile } from '../../../lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  try {
    return Response.json(await getInternalChatSnapshot(authenticated.profile), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load internal chat', error);
    return Response.json({ error: 'Não foi possível carregar o chat interno.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new InternalChatError('JSON inválido.');
    }
    const action = parseInternalChatAction(payload);
    return Response.json(await mutateInternalChat(action, authenticated.profile));
  } catch (error) {
    if (error instanceof InternalChatError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to update internal chat', error);
    return Response.json({ error: 'Não foi possível salvar a alteração.' }, { status: 500 });
  }
}

function parseInternalChatAction(value: unknown): InternalChatAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InternalChatError('Ação inválida.');
  const row = value as Record<string, unknown>;
  const action = requiredString(row, 'action', 40);

  if (action === 'send') {
    return {
      action,
      channelId: requiredString(row, 'channelId', 200),
      text: requiredString(row, 'text', 4000, true),
      clientMessageId: requiredString(row, 'clientMessageId', 64),
      replyToId: optionalString(row, 'replyToId', 200),
    };
  }
  if (action === 'read') {
    return {
      action,
      channelId: requiredString(row, 'channelId', 200),
      messageId: requiredString(row, 'messageId', 200),
    };
  }
  if (action === 'open-direct') {
    return { action, targetUserId: requiredString(row, 'targetUserId', 64) };
  }
  if (action === 'open-conversation') {
    return { action, conversationId: requiredString(row, 'conversationId', 200) };
  }
  throw new InternalChatError('Ação desconhecida.');
}

function requiredString(row: Record<string, unknown>, key: string, maximum: number, allowWhitespace = false) {
  const value = row[key];
  if (typeof value !== 'string' || value.length > maximum || (!allowWhitespace && !value.trim())) {
    throw new InternalChatError(`Campo ${key} inválido.`);
  }
  return value;
}

function optionalString(row: Record<string, unknown>, key: string, maximum: number) {
  const value = row[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new InternalChatError(`Campo ${key} inválido.`);
  }
  return value;
}
