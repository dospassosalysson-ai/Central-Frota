import { getInboxSnapshot, mutateInbox, type InboxAction } from '../../../db/inbox';
import { requireUserProfile } from '../../../lib/supabase-server';

export async function GET(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  try {
    return Response.json(await getInboxSnapshot());
  } catch (error) {
    console.error('Failed to load inbox', error);
    return Response.json({ error: 'Não foi possível carregar a central.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  try {
    const action = await request.json() as InboxAction;
    if (!action || typeof action !== 'object' || !('action' in action)) {
      return Response.json({ error: 'Ação inválida.' }, { status: 400 });
    }

    const payload = action.action === 'send'
      ? { ...action, authorName: authenticated.profile.displayName }
      : action;

    return Response.json(await mutateInbox(payload, authenticated.profile));
  } catch (error) {
    console.error('Failed to update inbox', error);
    return Response.json({ error: 'Não foi possível salvar a alteração.' }, { status: 500 });
  }
}
