'use client';

import {
  Activity,
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileWarning,
  Gauge,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { UserProfile } from '../lib/supabase-server';

export type ManagementArea = 'control' | 'actions' | 'team' | 'finance';

type ChecklistItem = { id: string; label: string; done: boolean };
type Plan = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  ownerId: string | null;
  ownerName: string;
  createdByName: string;
  dueAt: string | null;
  completedAt: string | null;
  checklist: ChecklistItem[];
  progress: number;
  updatedAt: string;
  comments: { id: string; authorName: string; body: string; createdAt: string }[];
};

type ManagementSnapshot = {
  viewer: UserProfile;
  overview: {
    openConversations: number;
    waitingConversations: number;
    unreadMessages: number;
    conversationsToday: number;
    pendingDocuments: number;
    documentsInCorrection: number;
    fiscalValueCents: number;
    overduePlans: number;
    openPlans: number;
    pendingApprovals: number;
  };
  team: { userId: string; email?: string; displayName: string; role: string; assignedPlans: number; completedPlans: number }[];
  plans: Plan[];
  notifications: { id: string; kind: string; title: string; body: string; readAt: string | null; createdAt: string }[];
  approvals: { id: string; requestType: string; title: string; description: string; amountCents: number; status: string; requesterName: string; createdAt: string }[];
  budgets: { id: string; centerCode: string; centerName: string; referenceMonth: string; plannedValueCents: number; committedValueCents: number; actualValueCents: number; consumptionPercent: number }[];
  audit: { id: string; actorName: string; entityType: string; entityId: string; action: string; createdAt: string }[];
  traffic?: { label: string; incoming: number; outgoing: number }[];
};

const fallbackSnapshot: ManagementSnapshot = {
  viewer: { userId: 'demo', email: '', displayName: 'Gestão', role: 'admin', active: true },
  overview: { openConversations: 7, waitingConversations: 2, unreadMessages: 5, conversationsToday: 18, pendingDocuments: 5, documentsInCorrection: 1, fiscalValueCents: 1812190, overduePlans: 1, openPlans: 3, pendingApprovals: 1 },
  team: [
    { userId: 'wallace', displayName: 'Wallace', role: 'attendant', assignedPlans: 2, completedPlans: 5 },
    { userId: 'amanda', displayName: 'Amanda', role: 'attendant', assignedPlans: 1, completedPlans: 7 },
  ],
  plans: [
    { id: 'action-nf-backlog', title: 'Zerar pendências de notas no Benner', description: 'Conferir PDFs, lançar no Benner e concluir no Portal Fiscal.', category: 'fiscal', status: 'in_progress', priority: 'critical', ownerId: 'wallace', ownerName: 'Wallace', createdByName: 'Gestão da Frota', dueAt: new Date(Date.now() + 86400000).toISOString(), completedAt: null, progress: 33, updatedAt: new Date().toISOString(), checklist: [{ id: '1', label: 'Conferir CNPJ, NF e série', done: true }, { id: '2', label: 'Lançar pendências no Benner', done: false }, { id: '3', label: 'Subir PDFs no Portal Fiscal', done: false }], comments: [] },
    { id: 'action-cost-review', title: 'Revisar custo por placa da semana', description: 'Comparar realizado por centro de custo e DRE.', category: 'financial', status: 'planned', priority: 'high', ownerId: 'amanda', ownerName: 'Amanda', createdByName: 'Gestão da Frota', dueAt: new Date(Date.now() + 259200000).toISOString(), completedAt: null, progress: 0, updatedAt: new Date().toISOString(), checklist: [{ id: '1', label: 'Fechar despesas por placa', done: false }, { id: '2', label: 'Sinalizar desvios', done: false }], comments: [] },
    { id: 'action-supplier-sla', title: 'Atualizar SLA dos fornecedores críticos', description: 'Consolidar prazos de oficinas e pneus.', category: 'supplier', status: 'review', priority: 'medium', ownerId: 'wallace', ownerName: 'Wallace', createdByName: 'Gestão da Frota', dueAt: new Date(Date.now() + 432000000).toISOString(), completedAt: null, progress: 67, updatedAt: new Date().toISOString(), checklist: [], comments: [] },
    { id: 'action-driver-checklist', title: 'Padronizar retorno dos motoristas', description: 'Modelo de ocorrência e liberação.', category: 'operational', status: 'completed', priority: 'medium', ownerId: 'amanda', ownerName: 'Amanda', createdByName: 'Gestão da Frota', dueAt: new Date(Date.now() - 86400000).toISOString(), completedAt: new Date().toISOString(), progress: 100, updatedAt: new Date().toISOString(), checklist: [], comments: [] },
  ],
  notifications: [],
  approvals: [
    { id: 'approval-tires', requestType: 'purchase', title: 'Troca de pneus RTT4B18', description: 'Cotação emergencial para manter a programação.', amountCents: 729000, status: 'pending', requesterName: 'Wallace', createdAt: new Date().toISOString() },
    { id: 'approval-service', requestType: 'service', title: 'Reparo preventivo FDZ8C44', description: 'Serviço programado.', amountCents: 265000, status: 'approved', requesterName: 'Amanda', createdAt: new Date().toISOString() },
  ],
  budgets: [
    { id: 'b1', centerCode: 'CC-GKW1A92', centerName: 'Cavalo GKW1A92', referenceMonth: '2026-08-01', plannedValueCents: 1200000, committedValueCents: 895000, actualValueCents: 864200, consumptionPercent: 72 },
    { id: 'b2', centerCode: 'CC-RTT4B18', centerName: 'Cavalo RTT4B18', referenceMonth: '2026-08-01', plannedValueCents: 950000, committedValueCents: 810000, actualValueCents: 783100, consumptionPercent: 82 },
    { id: 'b3', centerCode: 'CC-FDZ8C44', centerName: 'Cavalo FDZ8C44', referenceMonth: '2026-08-01', plannedValueCents: 1100000, committedValueCents: 1030000, actualValueCents: 987500, consumptionPercent: 90 },
  ],
  audit: [],
  traffic: [
    { label: '08h', incoming: 4, outgoing: 3 }, { label: '10h', incoming: 8, outgoing: 7 }, { label: '12h', incoming: 6, outgoing: 6 },
    { label: '14h', incoming: 13, outgoing: 10 }, { label: '16h', incoming: 9, outgoing: 12 }, { label: '18h', incoming: 5, outgoing: 5 },
  ],
};

const areaCopy: Record<ManagementArea, { eyebrow: string; title: string; description: string }> = {
  control: { eyebrow: 'Visão executiva', title: 'Sala de controle', description: 'Atendimento, equipe, fiscal e custos em uma leitura operacional.' },
  actions: { eyebrow: 'Execução e cobrança', title: 'Planos de ação', description: 'Responsáveis, prazos, etapas e conclusão acompanhados em um só fluxo.' },
  team: { eyebrow: 'Gestão de pessoas', title: 'Equipe', description: 'Carga, entregas, cobertura e desenvolvimento dos assistentes.' },
  finance: { eyebrow: 'Governança financeira', title: 'Financeiro', description: 'Orçamento, realizado, aprovações e desvios por centro de custo.' },
};

export default function ManagementClient({ area, profile, accessToken, notify }: { area: ManagementArea; profile: UserProfile; accessToken: string; notify: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<ManagementSnapshot>({ ...fallbackSnapshot, viewer: profile });
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const reduceMotion = useReducedMotion();

  const load = useCallback(async (silent = false) => {
    try {
      const response = await fetch('/api/management', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
      if (!response.ok) throw new Error('LOAD_FAILED');
      setSnapshot(await response.json() as ManagementSnapshot);
    } catch {
      if (!silent) notify('Dados demonstrativos ativos até concluir a base Supabase.');
    }
  }, [accessToken, notify]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load().finally(() => setLoading(false)); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const mutate = useCallback(async (body: object, success: string) => {
    const response = await fetch('/api/management', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar.');
    notify(success);
    await load(true);
  }, [accessToken, load, notify]);

  const copy = areaCopy[area];
  const unreadNotifications = snapshot.notifications.filter((notification) => !notification.readAt).length;

  return (
    <section className="workspace-panel management-workspace">
      <header className="workspace-header management-header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <div className="management-title-line"><h1>{copy.title}</h1>{loading && <LoaderCircle className="spin" size={15} />}</div>
          <p className="workspace-description">{copy.description}</p>
        </div>
        <div className="workspace-actions">
          <span className="live-chip"><i /> Atualização automática</span>
          <div className="notification-anchor">
            <button className="icon-action" aria-label="Notificações" onClick={() => setNotificationsOpen((value) => !value)}><Bell size={17} />{unreadNotifications > 0 && <b>{unreadNotifications}</b>}</button>
            <AnimatePresence>{notificationsOpen && <NotificationMenu notifications={snapshot.notifications} onClose={() => setNotificationsOpen(false)} onRead={(id) => void mutate({ action: 'read-notification', notificationId: id }, 'Notificação lida.')} />}</AnimatePresence>
          </div>
          {area === 'actions' && profile.role === 'admin' && <button className="primary-action" onClick={() => setCreateOpen(true)}><Plus size={15} /> Novo plano</button>}
          {area === 'team' && profile.role === 'admin' && <button className="primary-action" onClick={() => setInviteOpen(true)}><UserCheck size={15} /> Convidar assistente</button>}
        </div>
      </header>

      <motion.div key={area} className="workspace-scroll management-scroll" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28, ease: 'easeOut' }}>
        {area === 'control' && <ControlRoom snapshot={snapshot} />}
        {area === 'actions' && <ActionsCenter snapshot={snapshot} search={search} setSearch={setSearch} mutate={mutate} />}
        {area === 'team' && <TeamCenter snapshot={snapshot} />}
        {area === 'finance' && <FinanceCenter snapshot={snapshot} mutate={mutate} />}
      </motion.div>

      <AnimatePresence>{createOpen && <CreatePlanModal team={snapshot.team} onClose={() => setCreateOpen(false)} onCreate={async (payload) => { await mutate(payload, 'Plano de ação criado e responsável notificado.'); setCreateOpen(false); }} />}</AnimatePresence>
      <AnimatePresence>{inviteOpen && <InviteMemberModal onClose={() => setInviteOpen(false)} onInvite={async (payload) => { await mutate(payload, 'Convite enviado para o novo assistente.'); setInviteOpen(false); }} />}</AnimatePresence>
    </section>
  );
}

function ControlRoom({ snapshot }: { snapshot: ManagementSnapshot }) {
  const traffic = snapshot.traffic?.length ? snapshot.traffic : fallbackSnapshot.traffic!;
  const openPlans = snapshot.plans.filter((plan) => !['completed', 'cancelled'].includes(plan.status)).slice(0, 5);
  const alerts = [
    snapshot.overview.waitingConversations > 0 && { tone: 'amber', title: `${snapshot.overview.waitingConversations} atendimentos aguardando`, detail: 'Distribua a fila para evitar estouro de SLA.' },
    snapshot.overview.documentsInCorrection > 0 && { tone: 'red', title: `${snapshot.overview.documentsInCorrection} nota em correção`, detail: 'Há pendência bloqueando o fluxo fiscal.' },
    snapshot.overview.overduePlans > 0 && { tone: 'red', title: `${snapshot.overview.overduePlans} plano vencido`, detail: 'Revise prazo ou responsável ainda hoje.' },
    snapshot.overview.pendingApprovals > 0 && { tone: 'blue', title: `${snapshot.overview.pendingApprovals} aprovação pendente`, detail: 'Existe decisão financeira aguardando a gestão.' },
  ].filter(Boolean) as { tone: string; title: string; detail: string }[];

  return <>
    <div className="executive-strip">
      <div><span className="pulse-orb"><Activity size={16} /></span><p><strong>Operação monitorada</strong><small>Última leitura agora · Render + Supabase</small></p></div>
      <p className="executive-date">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date())}</p>
    </div>
    <div className="management-metrics">
      <ExecutiveMetric icon={<MessageSquareText />} label="Atendimentos abertos" value={snapshot.overview.openConversations} detail={`${snapshot.overview.waitingConversations} aguardando distribuição`} tone="green" />
      <ExecutiveMetric icon={<ListChecks />} label="Planos em execução" value={snapshot.overview.openPlans} detail={`${snapshot.overview.overduePlans} fora do prazo`} tone="violet" />
      <ExecutiveMetric icon={<FileWarning />} label="Documentos pendentes" value={snapshot.overview.pendingDocuments} detail={`${snapshot.overview.documentsInCorrection} em correção`} tone="amber" />
      <ExecutiveMetric icon={<WalletCards />} label="Volume fiscal" value={formatCurrency(snapshot.overview.fiscalValueCents)} detail={`${snapshot.overview.pendingApprovals} aprovação pendente`} tone="blue" />
    </div>
    <div className="control-room-grid">
      <section className="management-card traffic-card">
        <CardHeading eyebrow="Ritmo da operação" title="Fluxo de mensagens" extra={<span className="soft-pill">Últimas 12 horas</span>} />
        <div className="chart-legend"><span><i className="incoming-dot" /> Recebidas</span><span><i className="outgoing-dot" /> Enviadas</span></div>
        <div className="traffic-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={traffic} margin={{ top: 8, right: 8, bottom: 0, left: -28 }}><defs><linearGradient id="incomingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#236b55" stopOpacity={.25}/><stop offset="95%" stopColor="#236b55" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#edf1ef" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8a9691', fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#9aa49f', fontSize: 9 }} allowDecimals={false} /><Tooltip contentStyle={{ border: '1px solid #dfe7e3', borderRadius: 10, fontSize: 11 }} /><Area type="monotone" dataKey="incoming" stroke="#236b55" strokeWidth={2} fill="url(#incomingFill)" /><Area type="monotone" dataKey="outgoing" stroke="#6e62a8" strokeWidth={2} fill="transparent" /></AreaChart></ResponsiveContainer></div>
      </section>
      <section className="management-card alert-center"><CardHeading eyebrow="Exceções" title="Atenção da gestão" extra={<span className="count-pill">{alerts.length}</span>} /><div className="alert-list">{alerts.length ? alerts.map((alert) => <div className={`management-alert ${alert.tone}`} key={alert.title}><span><AlertCircle size={15} /></span><p><strong>{alert.title}</strong><small>{alert.detail}</small></p><ArrowRight size={14} /></div>) : <div className="all-clear"><BadgeCheck size={28} /><strong>Sem alertas críticos</strong><span>A operação está dentro dos parâmetros.</span></div>}</div></section>
      <section className="management-card active-plans-card"><CardHeading eyebrow="Prioridades" title="Planos de ação ativos" extra={<span className="soft-pill">{openPlans.length} acompanhados</span>} /><div className="compact-plan-list">{openPlans.map((plan) => <div key={plan.id}><span className={`priority-flag ${plan.priority}`} /><p><strong>{plan.title}</strong><small>{plan.ownerName} · {dueLabel(plan.dueAt)}</small></p><div className="compact-progress"><i style={{ width: `${plan.progress}%` }} /></div><b>{plan.progress}%</b></div>)}</div></section>
      <section className="management-card team-radar"><CardHeading eyebrow="Cobertura" title="Equipe hoje" extra={<span className="online-label"><i /> disponível</span>} /><div className="team-radar-list">{snapshot.team.map((member) => <div key={member.userId}><AvatarName name={member.displayName} /><p><strong>{member.displayName}</strong><small>{member.assignedPlans} ações abertas</small></p><span>{member.completedPlans} entregas</span></div>)}</div></section>
    </div>
  </>;
}

function ActionsCenter({ snapshot, search, setSearch, mutate }: { snapshot: ManagementSnapshot; search: string; setSearch: (value: string) => void; mutate: (body: object, success: string) => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(snapshot.plans[0]?.id || '');
  const needle = search.trim().toLocaleLowerCase('pt-BR');
  const filtered = snapshot.plans.filter((plan) => !needle || `${plan.title} ${plan.ownerName} ${plan.category}`.toLocaleLowerCase('pt-BR').includes(needle));
  const selected = snapshot.plans.find((plan) => plan.id === selectedId) ?? snapshot.plans[0];
  const columns = [
    { id: 'planned', label: 'Planejado', statuses: ['backlog', 'planned'] },
    { id: 'doing', label: 'Em execução', statuses: ['in_progress', 'blocked'] },
    { id: 'review', label: 'Em validação', statuses: ['review'] },
    { id: 'done', label: 'Concluído', statuses: ['completed'] },
  ];
  return <>
    <div className="action-toolbar"><label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ação ou responsável" />{search && <button onClick={() => setSearch('')}><X size={13} /></button>}</label><div className="action-summary"><span><b>{snapshot.overview.openPlans}</b> abertas</span><span className="overdue"><b>{snapshot.overview.overduePlans}</b> vencidas</span><span><b>{snapshot.plans.filter((plan) => plan.status === 'completed').length}</b> concluídas</span></div></div>
    <div className={`action-center-layout ${selected ? '' : 'without-detail'}`}>
      <div className="kanban-board">{columns.map((column) => { const plans = filtered.filter((plan) => column.statuses.includes(plan.status)); return <section className="kanban-column" key={column.id}><header><span className={`column-dot ${column.id}`} /> <strong>{column.label}</strong><b>{plans.length}</b></header><div>{plans.map((plan) => <motion.button layout className={`plan-card ${selected?.id === plan.id ? 'selected' : ''}`} key={plan.id} onClick={() => setSelectedId(plan.id)} whileHover={{ y: -2 }}><div className="plan-card-top"><span className={`plan-category ${plan.category}`}>{categoryLabel(plan.category)}</span><span className={`priority-label ${plan.priority}`}>{priorityLabel(plan.priority)}</span></div><strong>{plan.title}</strong><p>{plan.description}</p><div className="plan-progress"><span><i style={{ width: `${plan.progress}%` }} /></span><b>{plan.progress}%</b></div><footer><AvatarName name={plan.ownerName} small /><span>{plan.ownerName}</span><time className={isOverdue(plan) ? 'overdue' : ''}><Clock3 size={11} />{shortDueLabel(plan.dueAt)}</time></footer></motion.button>)}</div></section>; })}</div>
      {selected && <PlanDetail plan={selected} mutate={mutate} />}
    </div>
  </>;
}

function PlanDetail({ plan, mutate }: { plan: Plan; mutate: (body: object, success: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const update = async (body: object, success: string) => { setSaving(true); try { await mutate(body, success); } catch (error) { window.alert(error instanceof Error ? error.message : 'Erro ao salvar.'); } finally { setSaving(false); } };
  return <aside className="plan-detail-panel"><header><div><span className={`priority-label ${plan.priority}`}>{priorityLabel(plan.priority)}</span><h2>{plan.title}</h2><p>{plan.description}</p></div></header><div className="plan-meta-grid"><div><span>Responsável</span><strong><AvatarName name={plan.ownerName} small />{plan.ownerName}</strong></div><div><span>Prazo</span><strong className={isOverdue(plan) ? 'danger-text' : ''}><CalendarClock size={13} />{dueLabel(plan.dueAt)}</strong></div><div><span>Categoria</span><strong>{categoryLabel(plan.category)}</strong></div><div><span>Criado por</span><strong>{plan.createdByName}</strong></div></div><section className="detail-checklist"><div className="detail-section-heading"><span>Checklist</span><b>{plan.progress}%</b></div>{plan.checklist.length ? plan.checklist.map((item) => <label key={item.id} className={item.done ? 'done' : ''}><input type="checkbox" checked={item.done} disabled={saving} onChange={(event) => void update({ action: 'toggle-checklist', planId: plan.id, checklistId: item.id, done: event.target.checked }, 'Etapa atualizada.')} /><span><Check size={11} /></span>{item.label}</label>) : <p className="empty-checklist">Nenhuma etapa cadastrada.</p>}</section><section className="plan-comments"><div className="detail-section-heading"><span>Atualizações</span><b>{plan.comments.length}</b></div>{plan.comments.slice(-3).map((comment) => <div key={comment.id}><AvatarName name={comment.authorName} small /><p><strong>{comment.authorName}</strong><span>{comment.body}</span></p></div>)}<form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const body = String(data.get('comment') || ''); void update({ action: 'add-comment', planId: plan.id, body }, 'Atualização registrada.').then(() => form.reset()); }}><input name="comment" placeholder="Registrar andamento…" /><button disabled={saving}><ArrowRight size={14} /></button></form></section><footer><label>Status<select value={plan.status} disabled={saving} onChange={(event) => void update({ action: 'update-plan-status', planId: plan.id, status: event.target.value }, event.target.value === 'completed' ? 'Plano concluído; a gestão foi notificada.' : 'Status atualizado.')}><option value="planned">Planejado</option><option value="in_progress">Em execução</option><option value="blocked">Bloqueado</option><option value="review">Em validação</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select><ChevronDown size={13} /></label>{saving && <LoaderCircle className="spin" size={15} />}</footer></aside>;
}

function TeamCenter({ snapshot }: { snapshot: ManagementSnapshot }) {
  const team = snapshot.team.length ? snapshot.team : fallbackSnapshot.team;
  const totalOpen = team.reduce((sum, member) => sum + member.assignedPlans, 0);
  return <>
    <div className="team-overview-grid"><ExecutiveMetric icon={<Users />} label="Equipe ativa" value={team.length} detail="perfis com acesso à Central" tone="green" /><ExecutiveMetric icon={<Target />} label="Ações distribuídas" value={totalOpen} detail="carga atual dos assistentes" tone="violet" /><ExecutiveMetric icon={<BadgeCheck />} label="Entregas registradas" value={team.reduce((sum, member) => sum + member.completedPlans, 0)} detail="histórico visível à gestão" tone="blue" /></div>
    <div className="team-management-grid"><section className="management-card team-performance"><CardHeading eyebrow="Capacidade" title="Carga e entregas" extra={<span className="soft-pill">Atual</span>} /><div className="member-cards">{team.map((member) => { const load = Math.min(100, member.assignedPlans * 24); return <article key={member.userId}><div className="member-heading"><AvatarName name={member.displayName} /><div><strong>{member.displayName}</strong><span>{member.role === 'admin' ? 'Administrador' : 'Assistente de frota'}</span></div><span className="availability"><i /> Disponível</span></div><div className="member-numbers"><p><strong>{member.assignedPlans}</strong><span>ações abertas</span></p><p><strong>{member.completedPlans}</strong><span>concluídas</span></p><p><strong>{Math.max(0, 100 - load)}%</strong><span>capacidade</span></p></div><div className="capacity-bar"><i style={{ width: `${load}%` }} /></div></article>; })}</div></section><section className="management-card people-toolbox"><CardHeading eyebrow="Rotinas de liderança" title="Ferramentas de equipe" /><div className="toolbox-list"><ToolboxItem icon={<CalendarClock />} title="Escala e cobertura" text="Organize turnos, ausências e responsáveis de plantão." status="Estrutura preparada" /><ToolboxItem icon={<Gauge />} title="SLA por assistente" text="Acompanhe primeira resposta, fila e resolução." status="Dados da Central" /><ToolboxItem icon={<ClipboardCheck />} title="1:1 e feedbacks" text="Registre combinados, evolução e próximos passos." status="Próxima camada" /><ToolboxItem icon={<Sparkles />} title="Base de conhecimento" text="Procedimentos, respostas e padrões da operação." status="Próxima camada" /></div></section></div>
  </>;
}

function FinanceCenter({ snapshot, mutate }: { snapshot: ManagementSnapshot; mutate: (body: object, success: string) => Promise<void> }) {
  const budgets = snapshot.budgets.length ? snapshot.budgets : fallbackSnapshot.budgets;
  const planned = budgets.reduce((sum, budget) => sum + budget.plannedValueCents, 0);
  const actual = budgets.reduce((sum, budget) => sum + budget.actualValueCents, 0);
  const pending = snapshot.approvals.filter((approval) => approval.status === 'pending');
  const chartData = budgets.map((budget) => ({ name: budget.centerCode.replace('CC-', ''), planejado: budget.plannedValueCents / 100, realizado: budget.actualValueCents / 100 }));
  return <>
    <div className="finance-summary"><ExecutiveMetric icon={<WalletCards />} label="Orçamento monitorado" value={formatCurrency(planned)} detail="centros de custo ativos" tone="green" /><ExecutiveMetric icon={<TrendingUp />} label="Realizado no período" value={formatCurrency(actual)} detail={`${planned ? Math.round((actual / planned) * 100) : 0}% do planejado`} tone="blue" /><ExecutiveMetric icon={<CircleDollarSign />} label="Aguardando decisão" value={formatCurrency(pending.reduce((sum, item) => sum + item.amountCents, 0))} detail={`${pending.length} solicitações pendentes`} tone="amber" /></div>
    <div className="finance-grid"><section className="management-card budget-chart-card"><CardHeading eyebrow="Planejado × realizado" title="Consumo por centro de custo" extra={<span className="soft-pill">Mês atual</span>} /><div className="budget-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 10, right: 10, left: 4, bottom: 0 }}><CartesianGrid stroke="#edf1ef" vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#7d8b85', fontSize: 9 }} /><YAxis hide /><Tooltip formatter={(value) => formatCurrency(Number(value) * 100)} contentStyle={{ border: '1px solid #dfe7e3', borderRadius: 10, fontSize: 11 }} /><Bar dataKey="planejado" fill="#dfe7e3" radius={[5, 5, 0, 0]} /><Bar dataKey="realizado" fill="#276f59" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></section><section className="management-card approval-card"><CardHeading eyebrow="Governança" title="Aprovações" extra={<span className="count-pill">{pending.length}</span>} /><div className="approval-list">{snapshot.approvals.map((approval) => <article key={approval.id}><div><span className={`approval-status ${approval.status}`}>{approval.status === 'pending' ? 'Pendente' : approval.status === 'approved' ? 'Aprovado' : 'Rejeitado'}</span><strong>{approval.title}</strong><p>{approval.description}</p><small>Solicitado por {approval.requesterName}</small></div><b>{formatCurrency(approval.amountCents)}</b>{approval.status === 'pending' && <footer><button onClick={() => void mutate({ action: 'decide-approval', approvalId: approval.id, decision: 'rejected' }, 'Solicitação rejeitada.')}>Rejeitar</button><button onClick={() => void mutate({ action: 'decide-approval', approvalId: approval.id, decision: 'approved' }, 'Solicitação aprovada.')}>Aprovar</button></footer>}</article>)}</div></section><section className="management-card budget-table-card"><CardHeading eyebrow="Controle detalhado" title="Centros de custo" /><div className="budget-table"><div className="budget-table-head"><span>Centro</span><span>Planejado</span><span>Comprometido</span><span>Realizado</span><span>Consumo</span></div>{budgets.map((budget) => <div className="budget-row" key={budget.id}><p><strong>{budget.centerCode}</strong><small>{budget.centerName}</small></p><span>{formatCurrency(budget.plannedValueCents)}</span><span>{formatCurrency(budget.committedValueCents)}</span><span>{formatCurrency(budget.actualValueCents)}</span><div><b className={budget.consumptionPercent >= 90 ? 'critical' : budget.consumptionPercent >= 80 ? 'warning' : ''}>{budget.consumptionPercent}%</b><i><span style={{ width: `${Math.min(100, budget.consumptionPercent)}%` }} /></i></div></div>)}</div></section></div>
  </>;
}

function CreatePlanModal({ team, onClose, onCreate }: { team: ManagementSnapshot['team']; onClose: () => void; onCreate: (payload: object) => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError('');
    const data = new FormData(event.currentTarget);
    const ownerId = String(data.get('ownerId') || '');
    const owner = team.find((member) => member.userId === ownerId);
    try {
      await onCreate({ action: 'create-plan', title: String(data.get('title') || ''), description: String(data.get('description') || ''), category: String(data.get('category') || 'operational'), priority: String(data.get('priority') || 'medium'), ownerId: ownerId || null, ownerName: owner?.displayName || '', dueAt: data.get('dueAt') ? new Date(String(data.get('dueAt'))).toISOString() : null, checklist: String(data.get('checklist') || '').split('\n').map((item) => item.trim()).filter(Boolean) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar o plano.'); setSubmitting(false); }
  }
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><motion.form className="action-modal" onSubmit={submit} initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }}><header><div><p className="eyebrow">Delegação de atividades</p><h2>Novo plano de ação</h2><span>Defina o resultado, o responsável e como a entrega será validada.</span></div><button type="button" onClick={onClose}><X size={17} /></button></header><div className="action-form"><label className="full">Título<input name="title" required placeholder="Ex.: Concluir pendências fiscais da semana" /></label><label>Responsável<select name="ownerId" defaultValue=""><option value="">Atribuir depois</option>{team.map((member) => <option value={member.userId} key={member.userId}>{member.displayName}</option>)}</select></label><label>Prazo<input name="dueAt" type="datetime-local" /></label><label>Categoria<select name="category" defaultValue="operational"><option value="operational">Operação</option><option value="fleet">Frota</option><option value="fiscal">Fiscal</option><option value="financial">Financeiro</option><option value="team">Equipe</option><option value="supplier">Fornecedor</option><option value="improvement">Melhoria</option></select></label><label>Prioridade<select name="priority" defaultValue="medium"><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><label className="full">Descrição<textarea name="description" rows={3} placeholder="Contexto, resultado esperado e critério de conclusão." /></label><label className="full">Checklist <small>Uma etapa por linha</small><textarea name="checklist" rows={4} placeholder={'Conferir documentos\nExecutar lançamento\nAnexar evidência'} /></label>{error && <p className="auth-error full">{error}</p>}</div><footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary-action" disabled={submitting}>{submitting ? <><LoaderCircle className="spin" size={14} /> Criando…</> : <><Plus size={14} /> Criar e notificar</>}</button></footer></motion.form></motion.div>;
}

function InviteMemberModal({ onClose, onInvite }: { onClose: () => void; onInvite: (payload: object) => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      await onInvite({ action: 'invite-user', fullName: String(data.get('fullName') || ''), email: String(data.get('email') || ''), role: String(data.get('role') || 'attendant') });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar o convite.'); setSubmitting(false); }
  }
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><motion.form className="action-modal invite-modal" onSubmit={submit} initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }}><header><div><p className="eyebrow">Acesso da equipe</p><h2>Convidar assistente</h2><span>O Supabase enviará um link seguro para criação da senha.</span></div><button type="button" onClick={onClose}><X size={17} /></button></header><div className="action-form"><label className="full">Nome completo<input name="fullName" required placeholder="Nome do assistente" /></label><label className="full">E-mail corporativo<input name="email" type="email" required placeholder="nome@empresa.com.br" /></label><label className="full">Nível de acesso<select name="role" defaultValue="attendant"><option value="attendant">Assistente — tarefas e operação</option><option value="admin">Administrador — visão e gestão completas</option></select></label>{error && <p className="auth-error full">{error}</p>}</div><footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary-action" disabled={submitting}>{submitting ? <><LoaderCircle className="spin" size={14} /> Enviando…</> : <><UserCheck size={14} /> Enviar convite</>}</button></footer></motion.form></motion.div>;
}

function NotificationMenu({ notifications, onClose, onRead }: { notifications: ManagementSnapshot['notifications']; onClose: () => void; onRead: (id: string) => void }) {
  return <motion.div className="notification-menu" initial={{ opacity: 0, y: -6, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }}><header><strong>Notificações</strong><button onClick={onClose}><X size={14} /></button></header><div>{notifications.length ? notifications.slice(0, 8).map((notification) => <button className={notification.readAt ? 'read' : ''} key={notification.id} onClick={() => !notification.readAt && onRead(notification.id)}><span><CheckCircle2 size={14} /></span><p><strong>{notification.title}</strong><small>{notification.body}</small><time>{relativeDate(notification.createdAt)}</time></p></button>) : <div className="empty-notifications"><Bell size={22} /><span>Nenhuma notificação nova.</span></div>}</div></motion.div>;
}

function ExecutiveMetric({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string | number; detail: string; tone: string }) { return <motion.article className="executive-metric" whileHover={{ y: -2 }}><span className={`executive-icon ${tone}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></motion.article>; }
function CardHeading({ eyebrow, title, extra }: { eyebrow: string; title: string; extra?: React.ReactNode }) { return <header className="management-card-heading"><div><p>{eyebrow}</p><h2>{title}</h2></div>{extra}</header>; }
function AvatarName({ name, small = false }: { name: string; small?: boolean }) { const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'; return <span className={`management-avatar ${small ? 'small' : ''}`}>{initials}</span>; }
function ToolboxItem({ icon, title, text, status }: { icon: React.ReactNode; title: string; text: string; status: string }) { return <div><span>{icon}</span><p><strong>{title}</strong><small>{text}</small></p><b>{status}</b></div>; }
function formatCurrency(cents: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(cents / 100); }
function categoryLabel(category: string) { return ({ operational: 'Operação', fleet: 'Frota', fiscal: 'Fiscal', financial: 'Financeiro', team: 'Equipe', supplier: 'Fornecedor', improvement: 'Melhoria' } as Record<string, string>)[category] || category; }
function priorityLabel(priority: string) { return ({ low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' } as Record<string, string>)[priority] || priority; }
function isOverdue(plan: Plan) { return Boolean(plan.dueAt && new Date(plan.dueAt).getTime() < Date.now() && !['completed', 'cancelled'].includes(plan.status)); }
function dueLabel(date: string | null) { if (!date) return 'Sem prazo'; return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(date)); }
function shortDueLabel(date: string | null) { if (!date) return 'Sem prazo'; return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(date)); }
function relativeDate(date: string) { const delta = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 60000)); return delta < 60 ? `${delta} min` : delta < 1440 ? `${Math.round(delta / 60)} h` : `${Math.round(delta / 1440)} d`; }
