import { getSupabaseAdmin } from '../lib/supabase-server';

export type FiscalStatus =
  | 'requested'
  | 'pdf_received'
  | 'review'
  | 'ready_benner'
  | 'benner_done'
  | 'fiscal_done'
  | 'completed'
  | 'correction';

export type OperationsAction =
  | {
      action: 'create-document';
      supplierName: string;
      supplierCnpj: string;
      nfNumber: string;
      series?: string;
      issueDate?: string;
      dueDate?: string;
      totalValueCents: number;
      allocationType: 'vehicle' | 'project' | 'general';
      vehicleId?: string;
      costCenterId?: string;
      conversationId?: string;
    }
  | { action: 'update-status'; documentId: string; status: FiscalStatus; details?: string };

const STORAGE_BUCKET = 'fiscal-documents';

type DatabaseRow = Record<string, unknown>;

export async function getOperationsSnapshot() {
  const database = getSupabaseAdmin();
  const [documentsResult, eventsResult, vehiclesResult, costCentersResult, dreLinesResult, projectsResult] = await Promise.all([
    database.from('fiscal_documents').select('*').order('updated_at', { ascending: false }),
    database.from('workflow_events').select('*').order('created_at', { ascending: false }),
    database.from('vehicles').select('*').eq('active', true).order('plate'),
    database.from('cost_centers').select('*').eq('active', true).order('code'),
    database.from('dre_lines').select('*').eq('active', true).order('code'),
    database.from('projects').select('*').eq('active', true).order('code'),
  ]);
  for (const result of [documentsResult, eventsResult, vehiclesResult, costCentersResult, dreLinesResult, projectsResult]) {
    if (result.error) throw result.error;
  }

  const documents = (documentsResult.data ?? []) as DatabaseRow[];
  const events = (eventsResult.data ?? []) as DatabaseRow[];
  const vehicles = (vehiclesResult.data ?? []) as DatabaseRow[];
  const costCenters = (costCentersResult.data ?? []) as DatabaseRow[];
  const dreLines = (dreLinesResult.data ?? []) as DatabaseRow[];
  const projects = (projectsResult.data ?? []) as DatabaseRow[];

  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id as string, vehicle]));
  const costCenterById = new Map(costCenters.map((center) => [center.id as string, center]));
  const dreLineById = new Map(dreLines.map((line) => [line.id as string, line]));
  const projectById = new Map(projects.map((project) => [project.id as string, project]));
  const eventsByDocument = new Map<string, unknown[]>();
  for (const workflowEvent of events) {
    const documentId = workflowEvent.fiscal_document_id as string;
    const entries = eventsByDocument.get(documentId) ?? [];
    entries.push({
      id: workflowEvent.id,
      fiscalDocumentId: documentId,
      eventType: workflowEvent.event_type,
      fromStatus: workflowEvent.from_status,
      toStatus: workflowEvent.to_status,
      actorName: workflowEvent.actor_name,
      details: workflowEvent.details,
      createdAt: Number(workflowEvent.created_at),
    });
    eventsByDocument.set(documentId, entries);
  }

  return {
    documents: documents.map((document) => {
      const vehicle = document.vehicle_id ? vehicleById.get(document.vehicle_id as string) : null;
      const center = costCenterById.get(document.cost_center_id as string);
      const line = dreLineById.get(document.dre_line_id as string);
      const project = document.project_id ? projectById.get(document.project_id as string) : null;
      return {
        id: document.id,
        conversationId: document.conversation_id,
        supplierName: document.supplier_name,
        supplierCnpj: document.supplier_cnpj,
        nfNumber: document.nf_number,
        series: document.series,
        issueDate: document.issue_date,
        dueDate: document.due_date,
        totalValueCents: Number(document.total_value_cents),
        allocationType: document.allocation_type,
        vehicleId: document.vehicle_id,
        plate: vehicle?.plate ?? null,
        vehicleDescription: vehicle?.description ?? null,
        projectName: project?.name ?? null,
        costCenterCode: center?.code ?? 'Não vinculado',
        costCenterName: center?.name ?? 'Não vinculado',
        dreLine: line?.description ?? 'Não classificada',
        status: document.status,
        fileName: document.file_name,
        fileSize: document.file_size == null ? null : Number(document.file_size),
        fileAvailable: Boolean(document.file_key),
        bennerRecordedAt: document.benner_recorded_at == null ? null : Number(document.benner_recorded_at),
        bennerRecordedBy: document.benner_recorded_by,
        fiscalUploadedAt: document.fiscal_uploaded_at == null ? null : Number(document.fiscal_uploaded_at),
        fiscalUploadedBy: document.fiscal_uploaded_by,
        createdAt: Number(document.created_at),
        updatedAt: Number(document.updated_at),
        events: eventsByDocument.get(document.id as string) ?? [],
      };
    }),
    vehicles: vehicles.map((vehicle) => {
      const center = costCenterById.get(vehicle.cost_center_id as string);
      const line = center ? dreLineById.get(center.dre_line_id as string) : null;
      const project = center?.project_id ? projectById.get(center.project_id as string) : null;
      return {
        id: vehicle.id,
        plate: vehicle.plate,
        description: vehicle.description,
        costCenterId: center?.id,
        costCenterCode: center?.code,
        costCenterName: center?.name,
        dreLineId: line?.id,
        dreLine: line?.description,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
      };
    }),
    costCenters: costCenters.map((center) => {
      const line = dreLineById.get(center.dre_line_id as string);
      const project = center.project_id ? projectById.get(center.project_id as string) : null;
      return {
        id: center.id,
        code: center.code,
        name: center.name,
        kind: center.kind,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        dreLineId: line?.id,
        dreLine: line?.description,
      };
    }),
    dreLines: dreLines.map((line) => ({ id: line.id, code: line.code, description: line.description })),
    projects: projects.map((project) => ({ id: project.id, code: project.code, name: project.name })),
  };
}

export async function mutateOperations(action: OperationsAction, actorName: string) {
  if (action.action === 'create-document') return createFiscalDocument(action, actorName);

  const validStatuses: FiscalStatus[] = ['requested', 'pdf_received', 'review', 'ready_benner', 'benner_done', 'fiscal_done', 'completed', 'correction'];
  if (!validStatuses.includes(action.status)) throw new Error('INVALID_STATUS');
  const database = getSupabaseAdmin();
  const { data: current, error: currentError } = await database.from('fiscal_documents').select('status').eq('id', action.documentId).single();
  if (currentError || !current) throw new Error(currentError?.code === 'PGRST116' ? 'DOCUMENT_NOT_FOUND' : currentError?.message);

  const currentStatus = current.status as FiscalStatus;
  const allowedNext: Record<FiscalStatus, FiscalStatus[]> = {
    requested: ['pdf_received', 'correction'],
    pdf_received: ['review', 'correction'],
    review: ['ready_benner', 'correction'],
    ready_benner: ['benner_done', 'correction'],
    benner_done: ['fiscal_done', 'correction'],
    fiscal_done: ['completed', 'correction'],
    completed: ['correction'],
    correction: ['review'],
  };
  if (currentStatus !== action.status && !allowedNext[currentStatus].includes(action.status)) throw new Error('INVALID_TRANSITION');

  const updatedAt = Date.now();
  const update: Record<string, unknown> = { status: action.status, updated_at: updatedAt };
  if (action.status === 'benner_done') Object.assign(update, { benner_recorded_at: updatedAt, benner_recorded_by: actorName });
  if (action.status === 'fiscal_done') Object.assign(update, { fiscal_uploaded_at: updatedAt, fiscal_uploaded_by: actorName });
  const { error: updateError } = await database.from('fiscal_documents').update(update).eq('id', action.documentId);
  if (updateError) throw updateError;
  const { error: eventError } = await database.from('workflow_events').insert({
    id: crypto.randomUUID(),
    fiscal_document_id: action.documentId,
    event_type: 'status_changed',
    from_status: currentStatus,
    to_status: action.status,
    actor_name: actorName,
    details: action.details?.trim() || null,
    created_at: updatedAt,
  });
  if (eventError) throw eventError;
  return { ok: true, status: action.status, updatedAt };
}

async function createFiscalDocument(action: Extract<OperationsAction, { action: 'create-document' }>, actorName: string) {
  const database = getSupabaseAdmin();
  const supplierName = action.supplierName.trim();
  const supplierCnpj = action.supplierCnpj.replace(/\D/g, '');
  const nfNumber = action.nfNumber.trim();
  const series = action.series?.trim() || '';
  if (!supplierName || supplierCnpj.length !== 14 || !nfNumber || !Number.isInteger(action.totalValueCents) || action.totalValueCents < 0) throw new Error('INVALID_DOCUMENT');

  const { data: duplicate, error: duplicateError } = await database.from('fiscal_documents').select('id').eq('supplier_cnpj', supplierCnpj).eq('nf_number', nfNumber).eq('series', series).maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) throw new Error('DUPLICATE_DOCUMENT');

  let vehicleId: string | null = null;
  let projectId: string | null = null;
  let costCenterId: string;
  let dreLineId: string;
  if (action.allocationType === 'vehicle') {
    const { data: vehicle, error: vehicleError } = await database.from('vehicles').select('id, cost_center_id').eq('id', action.vehicleId).eq('active', true).single();
    if (vehicleError || !vehicle) throw new Error('INVALID_ALLOCATION');
    const { data: center, error: centerError } = await database.from('cost_centers').select('id, project_id, dre_line_id').eq('id', vehicle.cost_center_id).single();
    if (centerError || !center) throw new Error('INVALID_ALLOCATION');
    vehicleId = vehicle.id;
    projectId = center.project_id;
    costCenterId = center.id;
    dreLineId = center.dre_line_id;
  } else {
    const { data: center, error: centerError } = await database.from('cost_centers').select('id, project_id, dre_line_id, kind').eq('id', action.costCenterId).eq('active', true).single();
    if (centerError || !center || center.kind !== action.allocationType) throw new Error('INVALID_ALLOCATION');
    projectId = center.project_id;
    costCenterId = center.id;
    dreLineId = center.dre_line_id;
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const { error: insertError } = await database.from('fiscal_documents').insert({
    id,
    conversation_id: action.conversationId || null,
    supplier_name: supplierName,
    supplier_cnpj: supplierCnpj,
    nf_number: nfNumber,
    series,
    issue_date: action.issueDate || null,
    due_date: action.dueDate || null,
    total_value_cents: action.totalValueCents,
    allocation_type: action.allocationType,
    vehicle_id: vehicleId,
    project_id: projectId,
    cost_center_id: costCenterId,
    dre_line_id: dreLineId,
    status: 'requested',
    created_at: createdAt,
    updated_at: createdAt,
  });
  if (insertError) throw insertError;
  const { error: eventError } = await database.from('workflow_events').insert({
    id: crypto.randomUUID(),
    fiscal_document_id: id,
    event_type: 'document_created',
    from_status: null,
    to_status: 'requested',
    actor_name: actorName,
    details: 'Lançamento criado na Central',
    created_at: createdAt,
  });
  if (eventError) throw eventError;
  return { id, status: 'requested' as const, createdAt };
}

export async function attachFiscalFile(documentId: string, file: File, actorName: string) {
  const database = getSupabaseAdmin();
  const { data: current, error: currentError } = await database.from('fiscal_documents').select('status').eq('id', documentId).single();
  if (currentError || !current) throw new Error('DOCUMENT_NOT_FOUND');
  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'nota-fiscal.pdf';
  const fileKey = `${documentId}/${crypto.randomUUID()}-${safeFileName}`;
  const { error: uploadError } = await database.storage.from(STORAGE_BUCKET).upload(fileKey, file, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw uploadError;

  const currentStatus = current.status as FiscalStatus;
  const nextStatus: FiscalStatus = currentStatus === 'requested' ? 'pdf_received' : currentStatus;
  const updatedAt = Date.now();
  const { error: updateError } = await database.from('fiscal_documents').update({
    file_key: fileKey,
    file_name: file.name,
    file_type: 'application/pdf',
    file_size: file.size,
    status: nextStatus,
    updated_at: updatedAt,
  }).eq('id', documentId);
  if (updateError) throw updateError;
  const { error: eventError } = await database.from('workflow_events').insert({
    id: crypto.randomUUID(),
    fiscal_document_id: documentId,
    event_type: 'pdf_attached',
    from_status: currentStatus,
    to_status: nextStatus,
    actor_name: actorName,
    details: file.name,
    created_at: updatedAt,
  });
  if (eventError) throw eventError;
  return { ok: true, fileName: file.name, fileSize: file.size, status: nextStatus };
}

export async function getFiscalFile(documentId: string) {
  const database = getSupabaseAdmin();
  const { data: document, error: documentError } = await database.from('fiscal_documents').select('file_key, file_name, file_type').eq('id', documentId).single();
  if (documentError || !document?.file_key) return null;
  const { data: object, error: downloadError } = await database.storage.from(STORAGE_BUCKET).download(document.file_key);
  if (downloadError || !object) return null;
  return { object, fileName: document.file_name || 'nota-fiscal.pdf', fileType: document.file_type || 'application/pdf' };
}
