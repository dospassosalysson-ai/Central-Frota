import { getManagementSnapshot, mutateManagement, type ManagementAction } from '../../../db/management';
import { requireUserProfile } from '../../../lib/supabase-server';

export async function GET(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });
  try {
    return Response.json(await getManagementSnapshot(authenticated.profile));
  } catch (error) {
    console.error('Failed to load management center', error);
    return Response.json({ error: 'Não foi possível carregar a gestão.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });
  try {
    const action = await request.json() as ManagementAction;
    if (!action || typeof action !== 'object' || !('action' in action)) return Response.json({ error: 'Ação inválida.' }, { status: 400 });
    return Response.json(await mutateManagement(action, authenticated.profile));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'FORBIDDEN') return Response.json({ error: 'Você não possui permissão para esta ação.' }, { status: 403 });
    if (['INVALID_PLAN', 'INVALID_OWNER', 'INVALID_COMMENT', 'INVALID_MEMBER'].includes(message)) return Response.json({ error: 'Revise os dados informados.' }, { status: 400 });
    if (message === 'PLAN_NOT_FOUND') return Response.json({ error: 'Plano de ação não encontrado.' }, { status: 404 });
    console.error('Failed to update management center', error);
    return Response.json({ error: 'Não foi possível salvar a alteração.' }, { status: 500 });
  }
}
