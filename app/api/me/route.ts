import { requireUserProfile } from '../../../lib/supabase-server';

export async function GET(request: Request) {
  try {
    const authenticated = await requireUserProfile(request);
    if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });
    return Response.json({ profile: authenticated.profile });
  } catch (error) {
    console.error('Failed to load profile', error);
    return Response.json({ error: 'Perfil ainda não configurado no Supabase.' }, { status: 503 });
  }
}
