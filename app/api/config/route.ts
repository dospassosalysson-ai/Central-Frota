import { getSupabasePublicConfiguration } from '../../../lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(getSupabasePublicConfiguration(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Supabase public configuration is unavailable', error);
    return Response.json({ error: 'A Central ainda não foi configurada.' }, { status: 503 });
  }
}
