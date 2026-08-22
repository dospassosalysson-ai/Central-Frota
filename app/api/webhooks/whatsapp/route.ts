import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '../../../../lib/supabase-server';
import { processWhatsAppWebhook } from '../../../../lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token && safeEqual(token, expected) && challenge) return new Response(challenge, { status: 200 });
  return Response.json({ error: 'Verificação recusada.' }, { status: 403 });
}

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return Response.json({ error: 'Webhook ainda não configurado.' }, { status: 503 });
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  if (!signature || !safeEqual(signature, expected)) return Response.json({ error: 'Assinatura inválida.' }, { status: 401 });

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; }
  catch { return Response.json({ error: 'JSON inválido.' }, { status: 400 }); }

  const database = getSupabaseAdmin();
  const externalId = createHash('sha256').update(rawBody).digest('hex');
  const { data: event, error: eventError } = await database.from('integration_events').upsert({
    provider: 'meta-whatsapp',
    external_id: externalId,
    event_type: 'webhook',
    direction: 'incoming',
    status: 'pending',
    payload,
  }, { onConflict: 'provider,external_id,event_type', ignoreDuplicates: true }).select('id, status').maybeSingle();
  if (eventError) return Response.json({ error: 'Evento não persistido.' }, { status: 500 });
  if (!event) return Response.json({ ok: true, duplicate: true });

  try {
    const result = await processWhatsAppWebhook(payload);
    await database.from('integration_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', event.id);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to process WhatsApp webhook', error);
    await database.from('integration_events').update({ status: 'failed', error_message: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error', processed_at: new Date().toISOString() }).eq('id', event.id);
    return Response.json({ error: 'Falha ao processar evento.' }, { status: 500 });
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
