'use client';

import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheck,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Database,
  Download,
  FileCheck2,
  FileText,
  Filter,
  Link2,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type OperationsArea = 'documents' | 'fleet' | 'reports';

type FiscalStatus = 'requested' | 'pdf_received' | 'review' | 'ready_benner' | 'benner_done' | 'fiscal_done' | 'completed' | 'correction';

type WorkflowEvent = {
  id: string;
  eventType: string;
  fromStatus: FiscalStatus | null;
  toStatus: FiscalStatus | null;
  actorName: string;
  details: string | null;
  createdAt: number;
};

type FiscalDocument = {
  id: string;
  supplierName: string;
  supplierCnpj: string;
  nfNumber: string;
  series: string;
  issueDate: string | null;
  dueDate: string | null;
  totalValueCents: number;
  allocationType: 'vehicle' | 'project' | 'general';
  vehicleId: string | null;
  plate: string | null;
  vehicleDescription: string | null;
  projectName: string | null;
  costCenterCode: string;
  costCenterName: string;
  dreLine: string;
  status: FiscalStatus;
  fileName: string | null;
  fileSize: number | null;
  fileAvailable: boolean;
  bennerRecordedAt: number | null;
  bennerRecordedBy: string | null;
  fiscalUploadedAt: number | null;
  fiscalUploadedBy: string | null;
  createdAt: number;
  updatedAt: number;
  events: WorkflowEvent[];
};

type VehicleMapping = {
  id: string;
  plate: string;
  description: string;
  costCenterId: string;
  costCenterCode: string;
  costCenterName: string;
  dreLineId: string;
  dreLine: string;
  projectId: string | null;
  projectName: string | null;
};

type CostCenter = {
  id: string;
  code: string;
  name: string;
  kind: 'vehicle' | 'project' | 'general';
  projectId: string | null;
  projectName: string | null;
  dreLineId: string;
  dreLine: string;
};

type OperationsSnapshot = {
  documents: FiscalDocument[];
  vehicles: VehicleMapping[];
  costCenters: CostCenter[];
  dreLines: { id: string; code: string; description: string }[];
  projects: { id: string; code: string; name: string }[];
};

const now = Date.now();
const hour = 3_600_000;
const day = 86_400_000;

const fallbackVehicles: VehicleMapping[] = [
  { id: 'veh-gkw1a92', plate: 'GKW1A92', description: 'Volvo FH 540', costCenterId: 'cc-gkw1a92', costCenterCode: 'CC-GKW1A92', costCenterName: 'Cavalo GKW1A92', dreLineId: 'dre-fuel', dreLine: 'Combustíveis e lubrificantes', projectId: 'project-log20', projectName: 'Operação LOG20' },
  { id: 'veh-rtt4b18', plate: 'RTT4B18', description: 'Scania R 450', costCenterId: 'cc-rtt4b18', costCenterCode: 'CC-RTT4B18', costCenterName: 'Cavalo RTT4B18', dreLineId: 'dre-tires', dreLine: 'Pneus e recapagens', projectId: 'project-log20', projectName: 'Operação LOG20' },
  { id: 'veh-fdz8c44', plate: 'FDZ8C44', description: 'DAF XF 480', costCenterId: 'cc-fdz8c44', costCenterCode: 'CC-FDZ8C44', costCenterName: 'Cavalo FDZ8C44', dreLineId: 'dre-maintenance', dreLine: 'Manutenção e serviços', projectId: 'project-log20', projectName: 'Operação LOG20' },
  { id: 'veh-ejk6d07', plate: 'EJK6D07', description: 'Carreta LS', costCenterId: 'cc-ejk6d07', costCenterCode: 'CC-EJK6D07', costCenterName: 'Carreta EJK6D07', dreLineId: 'dre-parts', dreLine: 'Peças e componentes', projectId: 'project-log20', projectName: 'Operação LOG20' },
];

const fallbackCostCenters: CostCenter[] = [
  ...fallbackVehicles.map((vehicle) => ({ id: vehicle.costCenterId, code: vehicle.costCenterCode, name: vehicle.costCenterName, kind: 'vehicle' as const, projectId: vehicle.projectId, projectName: vehicle.projectName, dreLineId: vehicle.dreLineId, dreLine: vehicle.dreLine })),
  { id: 'cc-log20-general', code: 'CC-LOG20-GERAL', name: 'Despesas gerais LOG20', kind: 'project', projectId: 'project-log20', projectName: 'Operação LOG20', dreLineId: 'dre-maintenance', dreLine: 'Manutenção e serviços' },
  { id: 'cc-fleet-admin', code: 'CC-FROTA-ADM', name: 'Administração da frota', kind: 'general', projectId: 'project-fleet', projectName: 'Estrutura de Frota', dreLineId: 'dre-admin', dreLine: 'Despesas administrativas da frota' },
];

function event(id: string, status: FiscalStatus, createdAt: number): WorkflowEvent {
  return { id, eventType: 'seeded', fromStatus: null, toStatus: status, actorName: 'Central', details: 'Registro demonstrativo para validação da estrutura', createdAt };
}

const fallbackDocuments: FiscalDocument[] = [
  { id: 'doc-fuel-84592', supplierName: 'Posto Horizonte', supplierCnpj: '12830456000172', nfNumber: '84592', series: '1', issueDate: '2026-08-20', dueDate: '2026-08-30', totalValueCents: 384760, allocationType: 'vehicle', vehicleId: 'veh-gkw1a92', plate: 'GKW1A92', vehicleDescription: 'Volvo FH 540', projectName: 'Operação LOG20', costCenterCode: 'CC-GKW1A92', costCenterName: 'Cavalo GKW1A92', dreLine: 'Combustíveis e lubrificantes', status: 'pdf_received', fileName: 'NF-84592.pdf', fileSize: 248120, fileAvailable: false, bennerRecordedAt: null, bennerRecordedBy: null, fiscalUploadedAt: null, fiscalUploadedBy: null, createdAt: now - hour * 5, updatedAt: now - hour * 2, events: [event('e1', 'pdf_received', now - hour * 2)] },
  { id: 'doc-tires-19884', supplierName: 'Rodovia Pneus', supplierCnpj: '34761902000108', nfNumber: '019884', series: '2', issueDate: '2026-08-19', dueDate: '2026-09-02', totalValueCents: 729000, allocationType: 'vehicle', vehicleId: 'veh-rtt4b18', plate: 'RTT4B18', vehicleDescription: 'Scania R 450', projectName: 'Operação LOG20', costCenterCode: 'CC-RTT4B18', costCenterName: 'Cavalo RTT4B18', dreLine: 'Pneus e recapagens', status: 'ready_benner', fileName: 'NF-019884.pdf', fileSize: 312890, fileAvailable: false, bennerRecordedAt: null, bennerRecordedBy: null, fiscalUploadedAt: null, fiscalUploadedBy: null, createdAt: now - day, updatedAt: now - hour * 4, events: [event('e2', 'ready_benner', now - hour * 4)] },
  { id: 'doc-service-7721', supplierName: 'Oficina Norte Diesel', supplierCnpj: '05844219000166', nfNumber: '7721', series: '1', issueDate: '2026-08-18', dueDate: '2026-08-28', totalValueCents: 265000, allocationType: 'vehicle', vehicleId: 'veh-fdz8c44', plate: 'FDZ8C44', vehicleDescription: 'DAF XF 480', projectName: 'Operação LOG20', costCenterCode: 'CC-FDZ8C44', costCenterName: 'Cavalo FDZ8C44', dreLine: 'Manutenção e serviços', status: 'benner_done', fileName: null, fileSize: null, fileAvailable: false, bennerRecordedAt: now - hour * 7, bennerRecordedBy: 'Wallace', fiscalUploadedAt: null, fiscalUploadedBy: null, createdAt: now - day * 2, updatedAt: now - hour * 7, events: [event('e3', 'benner_done', now - hour * 7)] },
  { id: 'doc-parts-34098', supplierName: 'ARK Peças Pesadas', supplierCnpj: '61973085000147', nfNumber: '34098', series: '1', issueDate: '2026-08-17', dueDate: '2026-08-27', totalValueCents: 189430, allocationType: 'vehicle', vehicleId: 'veh-ejk6d07', plate: 'EJK6D07', vehicleDescription: 'Carreta LS', projectName: 'Operação LOG20', costCenterCode: 'CC-EJK6D07', costCenterName: 'Carreta EJK6D07', dreLine: 'Peças e componentes', status: 'fiscal_done', fileName: null, fileSize: null, fileAvailable: false, bennerRecordedAt: now - day, bennerRecordedBy: 'Amanda', fiscalUploadedAt: now - hour * 10, fiscalUploadedBy: 'Amanda', createdAt: now - day * 3, updatedAt: now - hour * 10, events: [event('e4', 'fiscal_done', now - hour * 10)] },
  { id: 'doc-project-9081', supplierName: 'Guincho Resgate 24h', supplierCnpj: '42570118000191', nfNumber: '9081', series: '1', issueDate: '2026-08-15', dueDate: '2026-08-25', totalValueCents: 98000, allocationType: 'project', vehicleId: null, plate: null, vehicleDescription: null, projectName: 'Operação LOG20', costCenterCode: 'CC-LOG20-GERAL', costCenterName: 'Despesas gerais LOG20', dreLine: 'Manutenção e serviços', status: 'completed', fileName: null, fileSize: null, fileAvailable: false, bennerRecordedAt: now - day * 4, bennerRecordedBy: 'Wallace', fiscalUploadedAt: now - day * 4, fiscalUploadedBy: 'Wallace', createdAt: now - day * 5, updatedAt: now - day * 4, events: [event('e5', 'completed', now - day * 4)] },
  { id: 'doc-correction-4412', supplierName: 'Clima Tech Serviços', supplierCnpj: '73114562000130', nfNumber: '4412', series: '1', issueDate: '2026-08-16', dueDate: '2026-08-26', totalValueCents: 145000, allocationType: 'general', vehicleId: null, plate: null, vehicleDescription: null, projectName: 'Estrutura de Frota', costCenterCode: 'CC-FROTA-ADM', costCenterName: 'Administração da frota', dreLine: 'Despesas administrativas da frota', status: 'correction', fileName: null, fileSize: null, fileAvailable: false, bennerRecordedAt: null, bennerRecordedBy: null, fiscalUploadedAt: null, fiscalUploadedBy: null, createdAt: now - day * 4, updatedAt: now - hour * 3, events: [event('e6', 'correction', now - hour * 3)] },
];

const fallbackSnapshot: OperationsSnapshot = {
  documents: fallbackDocuments,
  vehicles: fallbackVehicles,
  costCenters: fallbackCostCenters,
  dreLines: [
    { id: 'dre-fuel', code: '3.1.01', description: 'Combustíveis e lubrificantes' },
    { id: 'dre-parts', code: '3.1.02', description: 'Peças e componentes' },
    { id: 'dre-maintenance', code: '3.1.03', description: 'Manutenção e serviços' },
    { id: 'dre-tires', code: '3.1.04', description: 'Pneus e recapagens' },
    { id: 'dre-admin', code: '3.2.01', description: 'Despesas administrativas da frota' },
  ],
  projects: [
    { id: 'project-log20', code: 'PRJ-LOG20', name: 'Operação LOG20' },
    { id: 'project-fleet', code: 'PRJ-FROTA', name: 'Estrutura de Frota' },
  ],
};

const statusConfig: Record<FiscalStatus, { label: string; short: string; tone: string }> = {
  requested: { label: 'NF solicitada', short: 'Solicitada', tone: 'slate' },
  pdf_received: { label: 'PDF recebido', short: 'PDF recebido', tone: 'blue' },
  review: { label: 'Em conferência', short: 'Conferência', tone: 'amber' },
  ready_benner: { label: 'Pronta para Benner', short: 'Aguard. Benner', tone: 'violet' },
  benner_done: { label: 'Lançada no Benner', short: 'Benner lançado', tone: 'teal' },
  fiscal_done: { label: 'Enviada ao Portal Fiscal', short: 'Portal Fiscal', tone: 'green' },
  completed: { label: 'Concluída', short: 'Concluída', tone: 'darkgreen' },
  correction: { label: 'Correção necessária', short: 'Correção', tone: 'red' },
};

const nextStatus: Partial<Record<FiscalStatus, FiscalStatus>> = {
  requested: 'pdf_received',
  pdf_received: 'review',
  review: 'ready_benner',
  ready_benner: 'benner_done',
  benner_done: 'fiscal_done',
  fiscal_done: 'completed',
  correction: 'review',
};

function StatusPill({ status }: { status: FiscalStatus }) {
  const config = statusConfig[status];
  return <span className={`fiscal-status status-${config.tone}`}><i />{config.short}</span>;
}

function formatCurrency(valueInCents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valueInCents / 100);
}

function formatDocument(cnpj: string) {
  const value = cnpj.replace(/\D/g, '').padStart(14, '0');
  return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
}

function formatDate(value: string | number | null, withTime = false) {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('pt-BR', withTime ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function parseCurrencyToCents(value: string) {
  const normalized = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : -1;
}

export default function OperationsClient({
  area,
  currentUser,
  accessToken,
  notify,
}: {
  area: OperationsArea;
  currentUser: string;
  accessToken: string;
  notify: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(fallbackSnapshot);
  const [loading, setLoading] = useState(true);
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);

  const reloadOperations = useCallback(async (silent = false) => {
    try {
      const response = await fetch('/api/operations', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('Request failed');
      setSnapshot(await response.json() as OperationsSnapshot);
    } catch {
      if (!silent) notify('Estrutura demonstrativa carregada.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, notify]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void reloadOperations(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [reloadOperations]);

  return (
    <section className="workspace-panel">
      {area === 'documents' && (
        <FiscalDocumentsView
          snapshot={snapshot}
          currentUser={currentUser}
          accessToken={accessToken}
          loading={loading}
          notify={notify}
          reload={() => reloadOperations(true)}
          newDocumentOpen={newDocumentOpen}
          setNewDocumentOpen={setNewDocumentOpen}
        />
      )}
      {area === 'fleet' && <FleetView snapshot={snapshot} loading={loading} />}
      {area === 'reports' && <ReportsView snapshot={snapshot} />}
    </section>
  );
}

function WorkspaceHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return (
    <header className="workspace-header">
      <div>
        <p className="workspace-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="workspace-description">{description}</p>
      </div>
      {children && <div className="workspace-actions">{children}</div>}
    </header>
  );
}

function FiscalDocumentsView({
  snapshot,
  currentUser,
  accessToken,
  loading,
  notify,
  reload,
  newDocumentOpen,
  setNewDocumentOpen,
}: {
  snapshot: OperationsSnapshot;
  currentUser: string;
  accessToken: string;
  loading: boolean;
  notify: (message: string) => void;
  reload: () => Promise<void>;
  newDocumentOpen: boolean;
  setNewDocumentOpen: (open: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState(snapshot.documents[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'correction' | 'completed'>('all');
  const [saving, setSaving] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const selected = snapshot.documents.find((document) => document.id === selectedId) ?? snapshot.documents[0];
  const metrics = useMemo(() => ({
    inbox: snapshot.documents.filter((document) => ['pdf_received', 'review'].includes(document.status)).length,
    benner: snapshot.documents.filter((document) => document.status === 'ready_benner').length,
    fiscal: snapshot.documents.filter((document) => document.status === 'benner_done').length,
    correction: snapshot.documents.filter((document) => document.status === 'correction').length,
  }), [snapshot.documents]);

  const visibleDocuments = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    return snapshot.documents.filter((document) => {
      const matchesSearch = !needle || `${document.supplierName} ${document.supplierCnpj} ${document.nfNumber} ${document.plate ?? ''} ${document.costCenterCode}`.toLocaleLowerCase('pt-BR').includes(needle);
      const matchesFilter = filter === 'all'
        || (filter === 'pending' && document.status !== 'completed' && document.status !== 'correction')
        || (filter === 'correction' && document.status === 'correction')
        || (filter === 'completed' && document.status === 'completed');
      return matchesSearch && matchesFilter;
    });
  }, [snapshot.documents, search, filter]);

  async function updateStatus(status: FiscalStatus) {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: 'update-status', documentId: selected.id, status }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar.');
      await reload();
      notify(status === 'correction' ? 'Lançamento enviado para correção.' : `Etapa atualizada: ${statusConfig[status].label}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível atualizar a etapa.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadExisting(file: File) {
    if (!selected || saving) return;
    setSaving(true);
    const formData = new FormData();
    formData.set('documentId', selected.id);
    formData.set('file', file);
    try {
      const response = await fetch('/api/documents', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: formData });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível guardar o PDF.');
      await reload();
      notify('PDF vinculado ao lançamento.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível guardar o PDF.');
    } finally {
      setSaving(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  }

  async function downloadDocument(document: FiscalDocument) {
    try {
      const response = await fetch(`/api/documents?id=${encodeURIComponent(document.id)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('PDF indisponível.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.fileName || `NF-${document.nfNumber}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.');
    }
  }

  return (
    <>
      <WorkspaceHeader eyebrow="Financeiro da frota" title="Notas fiscais" description="Da conversa do WhatsApp ao Benner e Portal Fiscal, com cada etapa registrada.">
        <button className="secondary-action" onClick={() => void reload()}><RefreshCw size={15} /> Atualizar</button>
        <button className="primary-action" onClick={() => setNewDocumentOpen(true)}><Plus size={16} /> Novo lançamento</button>
      </WorkspaceHeader>

      <div className="workspace-scroll">
        <div className="metric-grid fiscal-metrics">
          <MetricCard icon={<FileText size={18} />} tone="blue" label="Recebidas / conferência" value={metrics.inbox} hint="PDFs para validar" />
          <MetricCard icon={<Database size={18} />} tone="violet" label="Aguardando Benner" value={metrics.benner} hint="Lançamento via MV" />
          <MetricCard icon={<Upload size={18} />} tone="teal" label="Aguardando Portal" value={metrics.fiscal} hint="Enviar o mesmo PDF" />
          <MetricCard icon={<AlertTriangle size={18} />} tone="red" label="Em correção" value={metrics.correction} hint="Exigem atenção" />
        </div>

        <div className={`fiscal-workbench ${selected ? 'has-detail' : ''}`}>
          <section className="data-card fiscal-list-card">
            <div className="data-toolbar">
              <label className="workspace-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar NF, fornecedor, CNPJ ou placa" /></label>
              <label className="filter-select"><Filter size={14} /><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Todas</option><option value="pending">Pendentes</option><option value="correction">Correções</option><option value="completed">Concluídas</option></select></label>
            </div>
            <div className="table-wrap">
              <table className="fiscal-table">
                <thead><tr><th>Nota fiscal</th><th>Destino</th><th>Valor</th><th>Etapa</th><th /></tr></thead>
                <tbody>
                  {visibleDocuments.map((document) => (
                    <tr key={document.id} className={selected?.id === document.id ? 'selected' : ''} onClick={() => setSelectedId(document.id)}>
                      <td><strong>NF {document.nfNumber}{document.series ? ` · S${document.series}` : ''}</strong><span>{document.supplierName}</span><small>{formatDocument(document.supplierCnpj)}</small></td>
                      <td><strong className="allocation-name">{document.plate ?? document.projectName ?? 'Geral'}</strong><span>{document.costCenterCode}</span><small>{document.dreLine}</small></td>
                      <td><strong>{formatCurrency(document.totalValueCents)}</strong><span>{formatDate(document.issueDate)}</span></td>
                      <td><StatusPill status={document.status} /></td>
                      <td><ChevronRight size={15} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleDocuments.length && <div className="data-empty"><ClipboardList size={28} /><strong>Nenhum lançamento encontrado</strong><span>Ajuste a busca ou o filtro aplicado.</span></div>}
            </div>
            <footer className="table-footer"><span>{visibleDocuments.length} de {snapshot.documents.length} lançamentos</span><span>{loading ? 'Atualizando…' : 'Base pronta para migração'}</span></footer>
          </section>

          {selected && (
            <aside className="document-detail">
              <header className="document-detail-header">
                <div><span className="detail-kicker">Lançamento fiscal</span><h2>NF {selected.nfNumber}</h2><p>{selected.supplierName}</p></div>
                <StatusPill status={selected.status} />
              </header>

              <div className="detail-summary-grid">
                <div><span>Valor</span><strong>{formatCurrency(selected.totalValueCents)}</strong></div>
                <div><span>Emissão</span><strong>{formatDate(selected.issueDate)}</strong></div>
                <div><span>CNPJ</span><strong>{formatDocument(selected.supplierCnpj)}</strong></div>
                <div><span>Série</span><strong>{selected.series || 'Sem série'}</strong></div>
              </div>

              <section className="detail-section">
                <div className="detail-section-title"><Link2 size={14} /><span>Vínculo contábil</span></div>
                <div className="allocation-card">
                  <span className="allocation-icon">{selected.plate ? <Truck size={18} /> : <Building2 size={18} />}</span>
                  <div><strong>{selected.plate ? `${selected.plate} · ${selected.vehicleDescription}` : selected.projectName}</strong><span>{selected.costCenterCode} · {selected.costCenterName}</span><small>DRE: {selected.dreLine}</small></div>
                  <Check size={16} />
                </div>
              </section>

              <section className="detail-section">
                <div className="detail-section-title"><FileText size={14} /><span>Documento PDF</span></div>
                <div className="pdf-card">
                  <span className="pdf-icon">PDF</span>
                  <div><strong>{selected.fileName || 'PDF ainda não vinculado'}</strong><span>{selected.fileAvailable ? `${Math.max(1, Math.round((selected.fileSize ?? 0) / 1024))} KB · armazenado na Central` : selected.fileName ? 'Referência pronta para a migração' : 'Anexe o arquivo recebido do fornecedor'}</span></div>
                  {selected.fileAvailable ? <button onClick={() => void downloadDocument(selected)} aria-label="Baixar PDF"><Download size={15} /></button> : <button onClick={() => uploadRef.current?.click()} aria-label="Anexar PDF"><Upload size={15} /></button>}
                  <input ref={uploadRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadExisting(file); }} />
                </div>
              </section>

              <section className="detail-section workflow-section">
                <div className="detail-section-title"><ListChecks size={14} /><span>Fluxo operacional</span></div>
                <WorkflowSteps document={selected} />
              </section>

              <section className="detail-section audit-section">
                <div className="detail-section-title"><Clock size={14} /><span>Últimas atividades</span></div>
                {(selected.events.length ? selected.events : [event('fallback', selected.status, selected.updatedAt)]).slice(0, 3).map((entry) => (
                  <div className="audit-row" key={entry.id}><span className="audit-dot" /><div><strong>{entry.toStatus ? statusConfig[entry.toStatus].label : 'Atualização'}</strong><p>{entry.actorName} · {formatDate(entry.createdAt, true)}</p></div></div>
                ))}
              </section>

              <footer className="detail-actions">
                {selected.status !== 'completed' && selected.status !== 'correction' && <button className="correction-action" disabled={saving} onClick={() => void updateStatus('correction')}>Solicitar correção</button>}
                {nextStatus[selected.status] && <button className="advance-action" disabled={saving} onClick={() => void updateStatus(nextStatus[selected.status]!)}>{saving ? 'Salvando…' : advanceLabel(selected.status)} <ChevronRight size={15} /></button>}
                {selected.status === 'completed' && <span className="completed-note"><CircleCheck size={16} /> Fluxo concluído</span>}
              </footer>
            </aside>
          )}
        </div>
      </div>

      {newDocumentOpen && <NewDocumentModal snapshot={snapshot} currentUser={currentUser} accessToken={accessToken} onClose={() => setNewDocumentOpen(false)} onCreated={async (id) => { await reload(); setSelectedId(id); setNewDocumentOpen(false); notify('Lançamento criado e vinculado à estrutura da frota.'); }} notify={notify} />}
    </>
  );
}

function advanceLabel(status: FiscalStatus) {
  if (status === 'requested') return 'Registrar recebimento';
  if (status === 'pdf_received') return 'Iniciar conferência';
  if (status === 'review') return 'Liberar para Benner';
  if (status === 'ready_benner') return 'Confirmar no Benner';
  if (status === 'benner_done') return 'Confirmar Portal Fiscal';
  if (status === 'fiscal_done') return 'Concluir lançamento';
  if (status === 'correction') return 'Retomar conferência';
  return 'Avançar';
}

function WorkflowSteps({ document }: { document: FiscalDocument }) {
  const stages: { status: FiscalStatus; label: string; help: string }[] = [
    { status: 'pdf_received', label: 'PDF recebido', help: 'WhatsApp ou envio manual' },
    { status: 'review', label: 'Dados conferidos', help: 'NF, fornecedor e vínculo' },
    { status: 'benner_done', label: 'Lançado no Benner', help: document.bennerRecordedBy ? `${document.bennerRecordedBy} · ${formatDate(document.bennerRecordedAt, true)}` : 'Via computador autenticado no MV' },
    { status: 'fiscal_done', label: 'Portal Fiscal', help: document.fiscalUploadedBy ? `${document.fiscalUploadedBy} · ${formatDate(document.fiscalUploadedAt, true)}` : 'Mesmo PDF enviado ao portal' },
    { status: 'completed', label: 'Concluído', help: 'Trilha finalizada' },
  ];
  const order: FiscalStatus[] = ['requested', 'pdf_received', 'review', 'ready_benner', 'benner_done', 'fiscal_done', 'completed'];
  const currentIndex = document.status === 'correction' ? 2 : order.indexOf(document.status);
  return <div className="workflow-steps">{stages.map((stage) => { const done = currentIndex >= order.indexOf(stage.status) && document.status !== 'correction'; const active = stage.status === document.status || (stage.status === 'review' && ['review', 'ready_benner', 'correction'].includes(document.status)); return <div className={`workflow-step ${done ? 'done' : ''} ${active ? 'active' : ''}`} key={stage.status}><span className="step-marker">{done ? <Check size={12} /> : ''}</span><div><strong>{stage.label}</strong><small>{stage.help}</small></div></div>; })}</div>;
}

function MetricCard({ icon, tone, label, value, hint }: { icon: React.ReactNode; tone: string; label: string; value: number | string; hint: string }) {
  return <article className="metric-card"><span className={`metric-icon metric-${tone}`}>{icon}</span><div><p>{label}</p><strong>{value}</strong><span>{hint}</span></div></article>;
}

function NewDocumentModal({ snapshot, currentUser, accessToken, onClose, onCreated, notify }: { snapshot: OperationsSnapshot; currentUser: string; accessToken: string; onClose: () => void; onCreated: (id: string) => Promise<void>; notify: (message: string) => void }) {
  const [allocationType, setAllocationType] = useState<'vehicle' | 'project' | 'general'>('vehicle');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const totalValueCents = parseCurrencyToCents(String(data.get('totalValue') || ''));
    const allocationId = String(data.get('allocationId') || '');
    setSaving(true);
    try {
      const response = await fetch('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          action: 'create-document',
          supplierName: data.get('supplierName'),
          supplierCnpj: data.get('supplierCnpj'),
          nfNumber: data.get('nfNumber'),
          series: data.get('series'),
          issueDate: data.get('issueDate'),
          dueDate: data.get('dueDate'),
          totalValueCents,
          allocationType,
          vehicleId: allocationType === 'vehicle' ? allocationId : undefined,
          costCenterId: allocationType !== 'vehicle' ? allocationId : undefined,
        }),
      });
      const payload = await response.json() as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || 'Não foi possível criar o lançamento.');

      const file = data.get('file');
      if (file instanceof File && file.size > 0) {
        const upload = new FormData();
        upload.set('documentId', payload.id);
        upload.set('file', file);
        const uploadResponse = await fetch('/api/documents', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: upload });
        const uploadPayload = await uploadResponse.json() as { error?: string };
        if (!uploadResponse.ok) notify(uploadPayload.error || 'Lançamento criado, mas o PDF não foi anexado.');
      }
      await onCreated(payload.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível criar o lançamento.');
    } finally {
      setSaving(false);
    }
  }

  const options = allocationType === 'vehicle' ? snapshot.vehicles : snapshot.costCenters.filter((center) => center.kind === allocationType);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="document-modal" onSubmit={submit}>
        <header><div><span className="detail-kicker">Novo lançamento</span><h2>Cadastrar nota fiscal</h2><p>A chave CNPJ + NF + série evita documentos duplicados.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
        <div className="modal-content">
          <section className="form-section"><h3><span>1</span> Fornecedor e nota</h3><div className="form-grid"><label className="span-2">Fornecedor<input name="supplierName" required placeholder="Razão social ou nome fantasia" /></label><label>CNPJ<input name="supplierCnpj" required inputMode="numeric" minLength={14} placeholder="00.000.000/0000-00" /></label><label>Número da NF<input name="nfNumber" required placeholder="Ex.: 84592" /></label><label>Série<input name="series" defaultValue="1" placeholder="Ex.: 1" /></label><label>Valor total<input name="totalValue" required inputMode="decimal" placeholder="0,00" /></label><label>Emissão<input name="issueDate" type="date" /></label><label>Vencimento<input name="dueDate" type="date" /></label></div></section>
          <section className="form-section"><h3><span>2</span> Vínculo com a frota</h3><div className="allocation-tabs">{(['vehicle', 'project', 'general'] as const).map((kind) => <button type="button" className={allocationType === kind ? 'active' : ''} key={kind} onClick={() => setAllocationType(kind)}>{kind === 'vehicle' ? 'Placa' : kind === 'project' ? 'Projeto' : 'Geral'}</button>)}</div><label className="wide-field">{allocationType === 'vehicle' ? 'Veículo / placa' : allocationType === 'project' ? 'Projeto / centro de custo' : 'Centro de custo geral'}<select name="allocationId" required defaultValue=""><option value="" disabled>Selecione o vínculo</option>{options.map((option) => 'plate' in option ? <option value={option.id} key={option.id}>{option.plate} · {option.description} · {option.dreLine}</option> : <option value={option.id} key={option.id}>{option.code} · {option.name} · {option.dreLine}</option>)}</select></label><p className="form-help"><Link2 size={13} /> A DRE será preenchida automaticamente pelo vínculo cadastrado.</p></section>
          <section className="form-section"><h3><span>3</span> Documento</h3><label className="file-drop"><Upload size={20} /><strong>Selecionar PDF da nota</strong><span>Opcional agora · PDF de até 15 MB</span><input name="file" type="file" accept="application/pdf,.pdf" /></label></section>
        </div>
        <footer><div className="created-by"><span>{currentUser.slice(0, 1).toUpperCase()}</span><p>Registro atribuído a <strong>{currentUser}</strong></p></div><button type="button" className="modal-cancel" onClick={onClose}>Cancelar</button><button type="submit" className="primary-action" disabled={saving}>{saving ? 'Salvando…' : 'Criar lançamento'}</button></footer>
      </form>
    </div>
  );
}

function FleetView({ snapshot, loading }: { snapshot: OperationsSnapshot; loading: boolean }) {
  const [search, setSearch] = useState('');
  const visible = snapshot.vehicles.filter((vehicle) => `${vehicle.plate} ${vehicle.description} ${vehicle.costCenterCode} ${vehicle.dreLine}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return (
    <>
      <WorkspaceHeader eyebrow="Cadastros e classificação" title="Frota & DRE" description="Uma fonte única para placa, projeto, centro de custo e linha do DRE.">
        <button className="secondary-action"><RefreshCw size={15} /> Sincronizar Ginfo</button>
        <button className="primary-action"><Plus size={16} /> Novo vínculo</button>
      </WorkspaceHeader>
      <div className="workspace-scroll">
        <div className="metric-grid fleet-metrics">
          <MetricCard icon={<Truck size={18} />} tone="green" label="Veículos ativos" value={snapshot.vehicles.length} hint="Placas mapeadas" />
          <MetricCard icon={<Building2 size={18} />} tone="blue" label="Projetos" value={snapshot.projects.length} hint="Destinos sem placa" />
          <MetricCard icon={<CircleDollarSign size={18} />} tone="amber" label="Centros de custo" value={snapshot.costCenters.length} hint="Vínculos disponíveis" />
          <MetricCard icon={<ListChecks size={18} />} tone="violet" label="Linhas DRE" value={snapshot.dreLines.length} hint="Classificações ativas" />
        </div>
        <div className="registry-layout">
          <section className="data-card registry-card">
            <div className="card-heading"><div><h2>Mapa de veículos</h2><p>Cada placa aponta para um centro de custo e uma linha do DRE.</p></div><label className="workspace-search compact"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar placa" /></label></div>
            <div className="table-wrap"><table className="registry-table"><thead><tr><th>Veículo</th><th>Centro de custo</th><th>Projeto</th><th>Linha DRE</th><th>Status</th></tr></thead><tbody>{visible.map((vehicle) => <tr key={vehicle.id}><td><span className="plate-badge">{vehicle.plate}</span><strong>{vehicle.description}</strong></td><td><strong>{vehicle.costCenterCode}</strong><span>{vehicle.costCenterName}</span></td><td>{vehicle.projectName || 'Sem projeto'}</td><td>{vehicle.dreLine}</td><td><span className="mapping-ok"><Check size={12} /> Mapeado</span></td></tr>)}</tbody></table></div>
            <footer className="table-footer"><span>{visible.length} vínculos nesta estrutura</span><span>{loading ? 'Atualizando…' : 'Importação completa será feita depois'}</span></footer>
          </section>
          <aside className="registry-side">
            <section className="data-card source-card"><span className="source-icon"><Database size={19} /></span><div><h3>Fonte: Ginfo</h3><p>O agente instalado em um PC autenticado poderá sincronizar placas, projetos e DRE sem expor o acesso do Ginfo na internet.</p></div><span className="structure-pill">Estrutura pronta</span></section>
            <section className="data-card"><div className="card-heading small"><div><h2>Destinos sem placa</h2><p>Serviços e produtos gerais.</p></div></div><div className="simple-list">{snapshot.costCenters.filter((center) => center.kind !== 'vehicle').map((center) => <div key={center.id}><span className={`simple-icon ${center.kind}`}><Building2 size={15} /></span><div><strong>{center.name}</strong><span>{center.code} · {center.projectName}</span><small>DRE: {center.dreLine}</small></div><Check size={14} /></div>)}</div></section>
          </aside>
        </div>
      </div>
    </>
  );
}

function ReportsView({ snapshot }: { snapshot: OperationsSnapshot }) {
  const totalCents = snapshot.documents.reduce((sum, document) => sum + document.totalValueCents, 0);
  const completedCents = snapshot.documents.filter((document) => document.status === 'completed').reduce((sum, document) => sum + document.totalValueCents, 0);
  const pending = snapshot.documents.filter((document) => document.status !== 'completed').length;
  const dreTotals = Array.from(snapshot.documents.reduce((map, document) => map.set(document.dreLine, (map.get(document.dreLine) ?? 0) + document.totalValueCents), new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]);
  const maxDre = Math.max(...dreTotals.map(([, value]) => value), 1);
  const workflow = [
    { label: 'Recebidas', statuses: ['requested', 'pdf_received', 'review'] as FiscalStatus[], color: 'blue' },
    { label: 'Benner', statuses: ['ready_benner'] as FiscalStatus[], color: 'violet' },
    { label: 'Portal Fiscal', statuses: ['benner_done', 'fiscal_done'] as FiscalStatus[], color: 'teal' },
    { label: 'Concluídas', statuses: ['completed'] as FiscalStatus[], color: 'green' },
  ];
  return (
    <>
      <WorkspaceHeader eyebrow="Visão gerencial" title="Indicadores" description="Pendências fiscais e custos da frota em uma visão única.">
        <button className="secondary-action"><CalendarDays size={15} /> Agosto de 2026</button>
        <button className="primary-action"><Download size={15} /> Exportar</button>
      </WorkspaceHeader>
      <div className="workspace-scroll">
        <div className="metric-grid reports-metrics">
          <MetricCard icon={<CircleDollarSign size={18} />} tone="green" label="Valor das notas" value={formatCurrency(totalCents)} hint="Na base atual" />
          <MetricCard icon={<FileCheck2 size={18} />} tone="blue" label="Valor concluído" value={formatCurrency(completedCents)} hint="Benner + Portal Fiscal" />
          <MetricCard icon={<Clock size={18} />} tone="amber" label="Pendências abertas" value={pending} hint="Em qualquer etapa" />
          <MetricCard icon={<AlertTriangle size={18} />} tone="red" label="Correções" value={snapshot.documents.filter((document) => document.status === 'correction').length} hint="Ação necessária" />
        </div>
        <div className="reports-grid">
          <section className="data-card report-card"><div className="card-heading"><div><h2>Despesas por linha do DRE</h2><p>Valores classificados pelos vínculos da frota.</p></div><span className="structure-pill">Base demonstrativa</span></div><div className="bar-list">{dreTotals.map(([name, value], index) => <div className="bar-row" key={name}><span className={`bar-rank rank-${index + 1}`}>{index + 1}</span><div><div className="bar-label"><strong>{name}</strong><span>{formatCurrency(value)}</span></div><div className="bar-track"><i style={{ width: `${Math.max(7, (value / maxDre) * 100)}%` }} /></div></div></div>)}</div></section>
          <section className="data-card report-card"><div className="card-heading"><div><h2>Esteira fiscal</h2><p>Onde estão os lançamentos agora.</p></div></div><div className="workflow-summary">{workflow.map((stage) => { const count = snapshot.documents.filter((document) => stage.statuses.includes(document.status)).length; return <div key={stage.label}><span className={`workflow-count workflow-${stage.color}`}>{count}</span><div><strong>{stage.label}</strong><span>{Math.round((count / Math.max(snapshot.documents.length, 1)) * 100)}% da base</span></div><ChevronRight size={15} /></div>; })}</div><div className="migration-banner"><span><Database size={18} /></span><div><strong>Pronta para receber o painel atual</strong><p>Cadastros, PDFs e histórico poderão ser migrados sem alterar esta estrutura.</p></div></div></section>
          <section className="data-card report-card full-report"><div className="card-heading"><div><h2>Controles da operação</h2><p>O que passa a ficar rastreável na Central.</p></div></div><div className="control-grid"><div><span><FileText size={18} /></span><strong>Identidade da NF</strong><p>CNPJ + número + série impedem duplicidade.</p></div><div><span><Truck size={18} /></span><strong>Rateio correto</strong><p>Placa ou projeto define centro de custo e DRE.</p></div><div><span><Database size={18} /></span><strong>Benner</strong><p>Registro de quem lançou e quando, usando o MV.</p></div><div><span><Upload size={18} /></span><strong>Portal Fiscal</strong><p>Confirmação do envio do mesmo PDF recebido.</p></div><div><span><Clock size={18} /></span><strong>Auditoria</strong><p>Cada mudança de etapa fica no histórico.</p></div><div><span><CircleCheck size={18} /></span><strong>Fechamento</strong><p>Uma nota só conclui após as duas confirmações.</p></div></div></section>
        </div>
      </div>
    </>
  );
}
