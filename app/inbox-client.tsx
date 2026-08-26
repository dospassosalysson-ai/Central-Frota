'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Check,
  CheckCheck,
  ChevronRight,
  Inbox,
  FileText,
  LogOut,
  LayoutDashboard,
  MessageSquareText,
  MessageCircle,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Plus,
  Search,
  Send,
  Truck,
  UserRound,
  Users,
  WalletCards,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserProfile } from '../lib/supabase-server';
import ManagementClient, { type ManagementArea } from './management-client';
import OperationsClient, { type OperationsArea } from './operations-client';
import TeamChatClient from './team-chat-client';

type Message = {
  id: string;
  direction: 'incoming' | 'outgoing';
  body: string;
  sentAt: number;
  authorName?: string | null;
  authorSource?: 'panel' | 'mobile' | null;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
};

type Tag = { id: string; name: string; color: string };

type Conversation = {
  id: string;
  name: string;
  phone: string;
  initials: string;
  color: string;
  contactType?: 'driver' | 'supervisor' | 'supplier' | 'other';
  organization?: string | null;
  status: 'open' | 'waiting' | 'resolved';
  assignee: 'current' | 'wallace' | null;
  lastMessage: string;
  lastMessageAt: number;
  unreadCount: number;
  messages: Message[];
  tags: Tag[];
  note: string;
};

const now = Date.now();
const minute = 60_000;
const day = 86_400_000;

const demoConversations: Conversation[] = [
  {
    id: 'conv-fernanda', name: 'Fernanda Oliveira', phone: '+55 11 98765-4321', initials: 'FO', color: 'coral', status: 'open', assignee: 'current',
    lastMessage: 'Perfeito, pode reservar para mim?', lastMessageAt: now - minute * 2, unreadCount: 2,
    tags: [{ id: 'tag-new', name: 'Novo cliente', color: 'green' }, { id: 'tag-schedule', name: 'Agendamento', color: 'lilac' }],
    note: 'Prefere atendimento no período da tarde.',
    messages: [
      { id: 'msg-f1', direction: 'incoming', body: 'Oi, bom dia! Gostaria de saber se ainda tem horário disponível para sexta-feira.', sentAt: now - minute * 10, status: 'read' },
      { id: 'msg-f2', direction: 'outgoing', body: 'Bom dia, Fernanda! Temos sim. Posso te oferecer às 14h30 ou às 16h. Qual funciona melhor para você?', sentAt: now - minute * 6, authorName: 'Wallace', authorSource: 'mobile', status: 'read' },
      { id: 'msg-f3', direction: 'incoming', body: 'Às 14h30 fica ótimo 😊', sentAt: now - minute * 4, status: 'read' },
      { id: 'msg-f4', direction: 'incoming', body: 'Perfeito, pode reservar para mim?', sentAt: now - minute * 2, status: 'read' },
    ],
  },
  {
    id: 'conv-rafael', name: 'Rafael Santos', phone: '+55 21 99222-1034', initials: 'RS', color: 'blue', status: 'open', assignee: 'wallace',
    lastMessage: 'Enviei o comprovante agora.', lastMessageAt: now - minute * 13, unreadCount: 0,
    tags: [{ id: 'tag-payment', name: 'Pagamento', color: 'amber' }], note: '',
    messages: [{ id: 'msg-r1', direction: 'incoming', body: 'Enviei o comprovante agora.', sentAt: now - minute * 13, status: 'read' }],
  },
  {
    id: 'conv-daniela', name: 'Daniela Costa', phone: '+55 31 99771-2840', initials: 'DC', color: 'violet', status: 'waiting', assignee: null,
    lastMessage: 'Vocês atendem aos sábados?', lastMessageAt: now - minute * 46, unreadCount: 1, tags: [], note: '',
    messages: [{ id: 'msg-d1', direction: 'incoming', body: 'Olá! Vocês atendem aos sábados?', sentAt: now - minute * 46, status: 'read' }],
  },
  {
    id: 'conv-henrique', name: 'Henrique Lima', phone: '+55 41 99100-7765', initials: 'HL', color: 'amber', status: 'resolved', assignee: 'current',
    lastMessage: 'Obrigado pela atenção!', lastMessageAt: now - day, unreadCount: 0, tags: [], note: '',
    messages: [
      { id: 'msg-h1', direction: 'outgoing', body: 'Ficamos felizes em ajudar. Até a próxima!', sentAt: now - day - minute * 5, authorName: 'Você', authorSource: 'panel', status: 'read' },
      { id: 'msg-h2', direction: 'incoming', body: 'Obrigado pela atenção!', sentAt: now - day, status: 'read' },
    ],
  },
];

function Avatar({ initials, color = 'green', small = false }: { initials: string; color?: string; small?: boolean }) {
  return <span className={`${small ? 'mini-avatar' : 'avatar'} avatar-${color}`}>{initials}</span>;
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const current = new Date();
  if (date.toDateString() === current.toDateString()) {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  const yesterday = new Date(current.getTime() - day);
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
}

function statusLabel(status: Conversation['status']) {
  if (status === 'waiting') return 'Aguardando';
  if (status === 'resolved') return 'Finalizado';
  return 'Em atendimento';
}

function contactTypeLabel(type: Conversation['contactType']) {
  if (type === 'driver') return 'Motorista';
  if (type === 'supervisor') return 'Supervisor LOG20';
  if (type === 'supplier') return 'Fornecedor';
  return 'Contato';
}

export default function InboxClient({ profile, accessToken, supabaseClient = null, onSignOut }: { profile: UserProfile; accessToken: string; supabaseClient?: SupabaseClient | null; onSignOut: () => void | Promise<unknown> }) {
  const currentUser = profile.displayName.split(' ')[0] || profile.displayName;
  const [activeArea, setActiveArea] = useState<'inbox' | 'chat' | OperationsArea | ManagementArea>(profile.role === 'admin' ? 'control' : 'actions');
  const [conversations, setConversations] = useState(demoConversations);
  const [selectedId, setSelectedId] = useState(demoConversations[0].id);
  const [queue, setQueue] = useState<'all' | 'mine' | 'waiting'>('all');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatFocusConversationId, setChatFocusConversationId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    fetch('/api/inbox', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { conversations?: Conversation[] }) => {
        if (data.conversations?.length) {
          setConversations(data.conversations);
          setSelectedId((current) => data.conversations?.some((item) => item.id === current) ? current : data.conversations![0].id);
        }
      })
      .catch(() => notify('Modo de demonstração ativo.'));
  }, [accessToken, notify]);

  useEffect(() => {
    let active = true;
    const loadUnread = () => fetch('/api/internal-chat', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { channels?: { unreadCount: number }[] }) => {
        if (active) setChatUnread((data.channels ?? []).reduce((total, channel) => total + channel.unreadCount, 0));
      })
      .catch(() => undefined);
    void loadUnread();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadUnread(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [accessToken]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0];
  const counts = useMemo(() => ({
    all: conversations.length,
    mine: conversations.filter((item) => item.assignee === 'current').length,
    waiting: conversations.filter((item) => item.status === 'waiting').length,
  }), [conversations]);

  const visibleConversations = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    return conversations.filter((conversation) => {
      const matchesQueue = queue === 'all' || (queue === 'mine' && conversation.assignee === 'current') || (queue === 'waiting' && conversation.status === 'waiting');
      const matchesSearch = !needle || `${conversation.name} ${conversation.phone} ${conversation.lastMessage}`.toLocaleLowerCase('pt-BR').includes(needle);
      return matchesQueue && matchesSearch;
    });
  }, [conversations, queue, search]);

  const postAction = useCallback(async (body: object) => {
    const response = await fetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  }, [accessToken]);

  function openConversation(id: string) {
    setSelectedId(id);
    setMobileListOpen(false);
    setConversations((items) => items.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item));
    void postAction({ action: 'read', conversationId: id }).catch(() => undefined);
  }

  async function assignConversation(assignee: 'current' | 'wallace') {
    if (!selected) return;
    const previous = selected.assignee;
    setConversations((items) => items.map((item) => item.id === selected.id ? { ...item, assignee, status: item.status === 'resolved' ? 'resolved' : 'open' } : item));
    try {
      await postAction({ action: 'assign', conversationId: selected.id, assignee });
      notify(assignee === 'current' ? 'Atendimento atribuído a você.' : 'Atendimento transferido para Wallace.');
    } catch {
      setConversations((items) => items.map((item) => item.id === selected.id ? { ...item, assignee: previous } : item));
      notify('Não foi possível alterar o responsável.');
    }
  }

  async function toggleResolved() {
    if (!selected) return;
    const resolved = selected.status !== 'resolved';
    const previousStatus = selected.status;
    setConversations((items) => items.map((item) => item.id === selected.id ? { ...item, status: resolved ? 'resolved' : 'open' } : item));
    try {
      await postAction({ action: 'resolve', conversationId: selected.id, resolved });
      notify(resolved ? 'Atendimento finalizado.' : 'Atendimento reaberto.');
    } catch {
      setConversations((items) => items.map((item) => item.id === selected.id ? { ...item, status: previousStatus } : item));
      notify('Não foi possível atualizar o atendimento.');
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!selected || !text || sending || selected.assignee !== 'current' || selected.status === 'resolved') return;
    const tempId = `temp-${Date.now()}`;
    const message: Message = { id: tempId, direction: 'outgoing', body: text, sentAt: Date.now(), authorName: 'Você', authorSource: 'panel', status: 'sent' };
    setDraft('');
    setSending(true);
    setConversations((items) => items.map((item) => item.id === selected.id
      ? { ...item, messages: [...item.messages, message], lastMessage: text, lastMessageAt: message.sentAt, unreadCount: 0, status: 'open' }
      : item));
    window.setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);

    try {
      const saved = await postAction({ action: 'send', conversationId: selected.id, text });
      setConversations((items) => items.map((item) => item.id === selected.id
        ? { ...item, messages: item.messages.map((entry) => entry.id === tempId ? { ...entry, id: saved.id, status: saved.status || 'queued' } : entry) }
        : item));
      if (saved.status === 'queued') notify('Mensagem salva. A Meta ainda não está conectada.');
      if (saved.status === 'failed') notify('Mensagem registrada, mas a entrega pelo WhatsApp falhou.');
    } catch {
      setConversations((items) => items.map((item) => item.id === selected.id
        ? { ...item, messages: item.messages.filter((entry) => entry.id !== tempId), lastMessage: selected.lastMessage, lastMessageAt: selected.lastMessageAt }
        : item));
      setDraft(text);
      notify('A mensagem não foi salva. Tente novamente.');
    } finally {
      setSending(false);
    }
  }

  if (!selected) return null;

  const canReply = selected.assignee === 'current' && selected.status !== 'resolved';
  const composerPlaceholder = selected.status === 'resolved'
    ? 'Reabra o atendimento para responder'
    : selected.assignee === 'wallace'
      ? 'Atendimento atribuído ao Wallace'
      : selected.assignee === null
        ? 'Assuma o atendimento para responder'
        : 'Digite uma mensagem...';

  return (
    <main className={`app-shell ${activeArea !== 'inbox' ? 'workspace-mode' : ''} ${detailsOpen ? '' : 'details-closed'} ${mobileListOpen ? 'mobile-list-open' : ''}`}>
      <aside className="rail" aria-label="Navegação principal">
        <div className="brand-mark">F</div>
        <nav className="rail-nav">
          {profile.role === 'admin' && <button className={`rail-button ${activeArea === 'control' ? 'active' : ''}`} aria-label="Sala de controle" title="Sala de controle" onClick={() => setActiveArea('control')}><LayoutDashboard size={19} /></button>}
          <button className={`rail-button ${activeArea === 'inbox' ? 'active' : ''}`} aria-label="Atendimento" title="Atendimento" onClick={() => setActiveArea('inbox')}><MessageSquareText size={19} /></button>
          <button className={`rail-button rail-chat-button ${activeArea === 'chat' ? 'active' : ''}`} aria-label="Chat interno" title="Chat interno" onClick={() => { setChatFocusConversationId(null); setActiveArea('chat'); }}><MessageCircle size={19} />{chatUnread > 0 && <span>{chatUnread > 99 ? '99+' : chatUnread}</span>}</button>
          <button className={`rail-button ${activeArea === 'actions' ? 'active' : ''}`} aria-label="Planos de ação" title="Planos de ação" onClick={() => setActiveArea('actions')}><ClipboardList size={19} /></button>
          <button className={`rail-button ${activeArea === 'documents' ? 'active' : ''}`} aria-label="Notas fiscais" title="Notas fiscais" onClick={() => setActiveArea('documents')}><FileText size={19} /></button>
          <button className={`rail-button ${activeArea === 'fleet' ? 'active' : ''}`} aria-label="Frota e DRE" title="Frota e DRE" onClick={() => setActiveArea('fleet')}><Truck size={19} /></button>
          <button className={`rail-button ${activeArea === 'reports' ? 'active' : ''}`} aria-label="Indicadores" title="Indicadores" onClick={() => setActiveArea('reports')}><BarChart3 size={19} /></button>
          {profile.role === 'admin' && <button className={`rail-button ${activeArea === 'finance' ? 'active' : ''}`} aria-label="Financeiro" title="Financeiro" onClick={() => setActiveArea('finance')}><WalletCards size={19} /></button>}
          {profile.role === 'admin' && <button className={`rail-button ${activeArea === 'team' ? 'active' : ''}`} aria-label="Equipe" title="Equipe" onClick={() => setActiveArea('team')}><Users size={19} /></button>}
        </nav>
        <div className="rail-bottom">
          <button className="rail-button" aria-label="Sair" title="Sair" onClick={() => void onSignOut()}><LogOut size={18} /></button>
          <span className="user-avatar" title={currentUser}>A<span className="online-dot" /></span>
        </div>
      </aside>

      {activeArea === 'inbox' ? <>
      <section className="inbox-panel">
        <header className="inbox-header">
          <div><p className="eyebrow">Central de atendimento</p><h1>Conversas</h1></div>
          <button className="new-chat" aria-label="Nova conversa" onClick={() => notify('Novas conversas serão liberadas após conectar a Meta.')}><Plus size={18} /></button>
        </header>

        <label className="search-box">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Buscar conversas" placeholder="Buscar por nome ou telefone" />
          {search ? <button aria-label="Limpar busca" onClick={() => setSearch('')}><X size={13} /></button> : <kbd>⌘ K</kbd>}
        </label>

        <div className="queue-tabs" role="tablist" aria-label="Filas de atendimento">
          {([
            ['all', 'Todas', counts.all],
            ['mine', 'Minhas', counts.mine],
            ['waiting', 'Aguardando', counts.waiting],
          ] as const).map(([key, label, count]) => (
            <button key={key} className={`queue-tab ${queue === key ? 'active' : ''}`} role="tab" aria-selected={queue === key} onClick={() => setQueue(key)}>{label} <span>{count}</span></button>
          ))}
        </div>

        <div className="conversation-list">
          <p className="list-label">{search ? `${visibleConversations.length} resultado${visibleConversations.length === 1 ? '' : 's'}` : 'Recentes'}</p>
          {visibleConversations.map((conversation) => (
            <button className={`conversation-row ${conversation.id === selected.id ? 'selected' : ''}`} key={conversation.id} onClick={() => openConversation(conversation.id)}>
              <Avatar initials={conversation.initials} color={conversation.color} />
              <span className="conversation-copy">
                <span className="conversation-title"><strong>{conversation.name}</strong><time>{formatTime(conversation.lastMessageAt)}</time></span>
                <span className="conversation-preview"><span>{conversation.lastMessage}</span>{conversation.unreadCount > 0 && <b className="unread-badge">{conversation.unreadCount}</b>}</span>
                <span className={`row-status status-${conversation.status}`}>{statusLabel(conversation.status)}</span>
              </span>
            </button>
          ))}
          {visibleConversations.length === 0 && <div className="empty-list"><Inbox size={24} /><strong>Nenhuma conversa</strong><span>Tente buscar por outro nome.</span></div>}
        </div>
      </section>

      <section className="chat-panel">
        <header className="chat-header">
          <div className="contact-heading">
            <button className="mobile-back" aria-label="Voltar para conversas" onClick={() => setMobileListOpen(true)}><ArrowLeft size={18} /></button>
            <Avatar initials={selected.initials} color={selected.color} />
            <div>
              <div className="contact-name-line"><h2>{selected.name}</h2><span className="whatsapp-badge">WhatsApp</span></div>
              <p><span className="status-dot" /> {statusLabel(selected.status)}</p>
            </div>
          </div>
          <div className="chat-actions">
            <button aria-label="Buscar nesta conversa" onClick={() => notify('Busca na conversa em preparação.')}><Search size={16} /></button>
            <button className="header-internal-chat" aria-label="Abrir discussão interna" title="Discussão interna" onClick={() => { setChatFocusConversationId(selected.id); setActiveArea('chat'); }}><MessageCircle size={16} /></button>
            <button aria-label="Mostrar detalhes" onClick={() => setDetailsOpen((open) => !open)}><PanelRight size={16} /></button>
            <button aria-label="Mais opções" onClick={() => notify('Mais opções em preparação.')}><MoreHorizontal size={17} /></button>
          </div>
        </header>

        <div className="chat-body">
          <div className="date-divider"><span>Hoje</span></div>
          {selected.messages.map((message) => message.direction === 'incoming' ? (
            <div className="message incoming" key={message.id}><p>{message.body}</p><time>{formatTime(message.sentAt)}</time></div>
          ) : (
            <div className="message-block outgoing-block" key={message.id}>
              <div className="message-meta">
                <Avatar initials={message.authorSource === 'mobile' ? 'W' : 'A'} color={message.authorSource === 'mobile' ? 'blue' : 'green'} small />
                {message.authorSource === 'mobile' ? 'Wallace' : 'Você'} <span>• {message.authorSource === 'mobile' ? 'celular' : 'painel'}</span>
              </div>
              <div className="message outgoing"><p>{message.body}</p><time>{formatTime(message.sentAt)} <CheckCheck size={12} /></time></div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <footer className="composer-wrap">
          <div className={`assignment-note ${selected.assignee === null ? 'unassigned' : ''}`}>
            {selected.assignee === null ? <UserRound size={13} /> : <Avatar initials={selected.assignee === 'wallace' ? 'W' : 'A'} color={selected.assignee === 'wallace' ? 'blue' : 'green'} small />}
            {selected.status === 'resolved' ? <span>Este atendimento está finalizado</span> : selected.assignee === null ? <><span>Atendimento sem responsável</span><button onClick={() => void assignConversation('current')}>Assumir</button></> : <span>Atendimento atribuído a <strong>{selected.assignee === 'wallace' ? 'Wallace' : 'você'}</strong></span>}
          </div>
          <div className={`composer ${!canReply ? 'disabled' : ''}`}>
            <button aria-label="Anexar arquivo" disabled={!canReply} onClick={() => notify('Anexos serão habilitados com a conexão oficial.')}><Paperclip size={17} /></button>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} disabled={!canReply} aria-label="Mensagem" placeholder={composerPlaceholder} rows={1} />
            <button aria-label="Respostas rápidas" disabled={!canReply} onClick={() => setDraft('Olá! Como posso ajudar?')}><Zap size={16} /></button>
            <button className="send-button" aria-label="Enviar mensagem" disabled={!canReply || !draft.trim() || sending} onClick={() => void sendMessage()}><Send size={15} /></button>
          </div>
          <p className="composer-hint">Enter para enviar <span>•</span> Shift + Enter para nova linha</p>
        </footer>
      </section>

      <aside className="details-panel">
        <header className="details-header"><h2>Detalhes</h2><button aria-label="Fechar detalhes" onClick={() => setDetailsOpen(false)}><X size={17} /></button></header>
        <div className="profile-card">
          <Avatar initials={selected.initials} color={selected.color} />
          <h3>{selected.name}</h3><p>{selected.phone}</p><span className="client-pill">{contactTypeLabel(selected.contactType)}</span>
        </div>
        <div className="details-section contact-context">
          <p className="details-label">Contexto do contato</p>
          <div><span className="context-icon">{selected.contactType === 'driver' ? <Truck size={15} /> : selected.contactType === 'supplier' ? <FileText size={15} /> : <Users size={15} />}</span><p><strong>{selected.organization || contactTypeLabel(selected.contactType)}</strong><small>{selected.contactType === 'supplier' ? 'Pode enviar notas e documentos' : selected.contactType === 'driver' ? 'Solicitações e ocorrências da frota' : 'Demandas da operação LOG20'}</small></p></div>
          {selected.contactType === 'supplier' && <button className="fiscal-shortcut" onClick={() => setActiveArea('documents')}><FileText size={14} /> Abrir controle de notas <ChevronRight size={14} /></button>}
        </div>
        <div className="details-section">
          <p className="details-label">Responsável</p>
          <div className="assignee-options">
            <button className={selected.assignee === 'current' ? 'selected' : ''} onClick={() => void assignConversation('current')}><Avatar initials="A" small /><span><strong>Você</strong><small>Atendente no painel</small></span>{selected.assignee === 'current' && <Check size={14} />}</button>
            <button className={selected.assignee === 'wallace' ? 'selected' : ''} onClick={() => void assignConversation('wallace')}><Avatar initials="W" color="blue" small /><span><strong>Wallace</strong><small>Celular</small></span>{selected.assignee === 'wallace' && <Check size={14} />}</button>
          </div>
        </div>
        <div className="details-section">
          <p className="details-label">Etiquetas <button onClick={() => notify('Editor de etiquetas em preparação.')}><Plus size={14} /></button></p>
          <div className="tags">{selected.tags.length ? selected.tags.map((tag) => <span className={`tag ${tag.color}`} key={tag.id}>{tag.name}</span>) : <span className="no-tags">Nenhuma etiqueta</span>}</div>
        </div>
        <div className="details-section notes-section">
          <p className="details-label">Anotações internas <button onClick={() => notify('Editor de anotações em preparação.')}><Plus size={14} /></button></p>
          <p>{selected.note || 'Nenhuma anotação adicionada.'}</p>
          <button className="internal-discussion-shortcut" onClick={() => { setChatFocusConversationId(selected.id); setActiveArea('chat'); }}><MessageCircle size={14} /><span><strong>Abrir discussão interna</strong><small>Somente integrantes autorizados</small></span><ChevronRight size={14} /></button>
        </div>
        <button className={`resolve-button ${selected.status === 'resolved' ? 'reopen' : ''}`} onClick={() => void toggleResolved()}>{selected.status === 'resolved' ? <Archive size={15} /> : <Check size={15} />}{selected.status === 'resolved' ? 'Reabrir atendimento' : 'Finalizar atendimento'}</button>
      </aside>
      </> : activeArea === 'chat'
        ? <TeamChatClient profile={profile} accessToken={accessToken} supabaseClient={supabaseClient} notify={notify} focusConversationId={chatFocusConversationId} onFocusConversationHandled={() => setChatFocusConversationId(null)} onOpenInboxConversation={(conversationId) => { const target = conversations.find((conversation) => conversation.id === conversationId); if (!target) { notify('Este atendimento não está disponível na fila atual.'); return; } setSelectedId(target.id); setMobileListOpen(false); setActiveArea('inbox'); }} onUnreadChange={setChatUnread} />
        : ['documents', 'fleet', 'reports'].includes(activeArea)
        ? <OperationsClient area={activeArea as OperationsArea} currentUser={currentUser} accessToken={accessToken} notify={notify} />
        : <ManagementClient area={activeArea as ManagementArea} profile={profile} accessToken={accessToken} notify={notify} />}

      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </main>
  );
}
