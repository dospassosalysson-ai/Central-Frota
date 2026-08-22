import { attachFiscalFile, getFiscalFile } from '../../../db/operations';
import { requireUserProfile } from '../../../lib/supabase-server';

export async function GET(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  const documentId = new URL(request.url).searchParams.get('id');
  if (!documentId) return Response.json({ error: 'Documento não informado.' }, { status: 400 });

  try {
    const file = await getFiscalFile(documentId);
    if (!file) return Response.json({ error: 'PDF ainda não disponível.' }, { status: 404 });
    const headers = new Headers();
    headers.set('Content-Type', file.fileType);
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(await file.object.arrayBuffer(), { headers });
  } catch (error) {
    console.error('Failed to download fiscal document', error);
    return Response.json({ error: 'Não foi possível baixar o PDF.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authenticated = await requireUserProfile(request);
  if (!authenticated) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  try {
    const formData = await request.formData();
    const documentId = formData.get('documentId');
    const file = formData.get('file');
    if (typeof documentId !== 'string' || !(file instanceof File)) {
      return Response.json({ error: 'Envie o lançamento e o PDF.' }, { status: 400 });
    }
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf || file.size === 0 || file.size > 15 * 1024 * 1024) {
      return Response.json({ error: 'O arquivo deve ser um PDF de até 15 MB.' }, { status: 400 });
    }
    const actorName = authenticated.profile.displayName;
    return Response.json(await attachFiscalFile(documentId, file, actorName));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'DOCUMENT_NOT_FOUND') {
      return Response.json({ error: 'Lançamento não encontrado.' }, { status: 404 });
    }
    console.error('Failed to upload fiscal document', error);
    return Response.json({ error: 'Não foi possível guardar o PDF.' }, { status: 500 });
  }
}
