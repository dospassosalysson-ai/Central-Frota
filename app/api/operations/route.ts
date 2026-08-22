import { getOperationsSnapshot, mutateOperations, type OperationsAction } from '../../../db/operations';
import { requireUserProfile } from '../../../lib/supabase-server';

export async function GET(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  try {
    return Response.json(await getOperationsSnapshot());
  } catch (error) {
    console.error('Failed to load operations', error);
    return Response.json({ error: 'Não foi possível carregar a operação.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  try {
    const action = await request.json() as OperationsAction;
    if (!action || typeof action !== 'object' || !('action' in action)) {
      return Response.json({ error: 'Ação inválida.' }, { status: 400 });
    }
    const actorName = authenticated.profile.displayName;
    return Response.json(await mutateOperations(action, actorName));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'DUPLICATE_DOCUMENT') {
      return Response.json({ error: 'Esta combinação de CNPJ, número da NF e série já existe.' }, { status: 409 });
    }
    if (['INVALID_DOCUMENT', 'INVALID_ALLOCATION', 'INVALID_STATUS', 'INVALID_TRANSITION'].includes(message)) {
      return Response.json({ error: 'Confira os dados informados e tente novamente.' }, { status: 400 });
    }
    if (message === 'DOCUMENT_NOT_FOUND') {
      return Response.json({ error: 'Lançamento não encontrado.' }, { status: 404 });
    }
    console.error('Failed to update operations', error);
    return Response.json({ error: 'Não foi possível salvar a alteração.' }, { status: 500 });
  }
}
