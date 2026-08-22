import { getSupabaseAdmin } from '../../../lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const { error } = await getSupabaseAdmin().from('profiles').select('user_id', { head: true, count: 'exact' }).limit(1);
    if (error) throw error;
    return Response.json({ status: 'ok', service: 'central-frota', database: 'connected', checkedAt });
  } catch (error) {
    console.error('Health check failed', error);
    return Response.json({ status: 'degraded', service: 'central-frota', database: 'unavailable', checkedAt }, { status: 503 });
  }
}
