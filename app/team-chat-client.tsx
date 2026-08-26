'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ArrowLeft,
  AtSign,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Hash,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  MessageSquareText,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserProfile } from '../lib/supabase-server';

type ChatProfile = {
  userId: string;
  email: string;
  displayName: string;
  jobTitle: string;
  role: string;
  active: boolean;
};

type ChannelMember = ChatProfile & { lastReadAt: string | null; lastReadMessageId: string | null };

type InternalMessage = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  body: string;
  replyToId: string | null;
  createdAt: string;
  editedAt: string | null;
  readBy: string[];
};

type InternalChannel = {
  id: string;
  channelType: 'group' | 'direct' | 'conversation';
  name: string | null;
  contextType: string | null;
  contextId: string | null;
  contextLabel: string | null;
  lastMessage: string;
  lastMessageAt: string | null;
  createdAt: string;
  unreadCount: number;
  members: ChannelMember[];
  messages: InternalMessage[];
};

type ChatSnapshot = {
  viewer: UserProfile;
  team: ChatProfile[];
  channels: InternalChannel[];
};

type TeamChatClientProps = {
  profile: UserProfile;
  accessToken: string;
  supabaseClient: SupabaseClient | null;
  notify: (message: string) => void;
  focusConversationId: string | null;
  onFocusConversationHandled: () => void;
  onOpenInboxConversation: (conversationId: string) => void;
  onUnreadChange: (count: number) => void;
};

export default function TeamChatClient({
  profile,
  accessToken,
  supabaseClient,
  notify,
  focusConversationId,
  onFocusConversationHandled,
  onOpenInboxConversation,
  onUnreadChange,
}: TeamChatClientProps) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyTo, setReplyTo] = useState<InternalMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>(supabaseClient ? 'connecting' : 'offline');
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set([profile.userId]));
  const [mobileRoomOpen, setMobileRoomOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const pendingSendsRef = useRef<Record<string, { fingerprint: string; id: string }>>({});

  const request = useCallback(async (body: object) => {
    const response = await fetch('/api/internal-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.error || 'Não foi possível concluir a ação.'));
    return payload;
  }, [accessToken]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch('/api/internal-chat', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const payload = await response.json() as ChatSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o chat.');
      setSnapshot(payload);
      setError('');
      setSelectedId((current) => payload.channels.some((channel) => channel.id === current)
        ? current
        : payload.channels.find((channel) => channel.id === 'team-general')?.id || payload.channels[0]?.id || '');
      onUnreadChange(payload.channels.reduce((total, channel) => total + channel.unreadCount, 0));
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o chat interno.');
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accessToken, onUnreadChange]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 15_000);
    return () => { window.clearTimeout(initialLoad); window.clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    if (!focusConversationId) return;
    let active = true;
    request({ action: 'open-conversation', conversationId: focusConversationId })
      .then(async (result) => {
        const next = await load(true);
        const channelId = String(result.channelId || '');
        if (!active || !channelId || !next?.channels.some((channel) => channel.id === channelId)) return;
        setSelectedId(channelId);
        setReplyTo(null);
        setMobileRoomOpen(true);
        onFocusConversationHandled();
      })
      .catch((cause) => {
        notify(cause instanceof Error ? cause.message : 'Não foi possível abrir a discussão interna.');
        onFocusConversationHandled();
      });
    return () => { active = false; };
  }, [focusConversationId, load, notify, onFocusConversationHandled, request]);

  useEffect(() => {
    if (!selectedId || !snapshot || document.visibilityState !== 'visible') return;
    const channel = snapshot.channels.find((entry) => entry.id === selectedId);
    const latestMessage = channel?.messages.at(-1);
    const compactLayout = window.matchMedia('(max-width: 620px)').matches;
    if (!channel?.unreadCount || !latestMessage || (compactLayout && !mobileRoomOpen)) return;
    void request({ action: 'read', channelId: selectedId, messageId: latestMessage.id })
      .then(() => load(true))
      .catch(() => undefined);
    window.setTimeout(() => chatEndRef.current?.scrollIntoView({ block: 'end' }), 40);
  }, [selectedId, snapshot, mobileRoomOpen, request, load]);

  useEffect(() => {
    if (!selectedId || !supabaseClient) return;
    let disposed = false;
    const cleanupRef = { current: (() => undefined) as () => void };

    void supabaseClient.realtime.setAuth(accessToken).then(() => {
      if (disposed) return;
      const realtimeChannel = supabaseClient.channel(`internal-chat:${selectedId}`, {
        config: { private: true, presence: { key: profile.userId } },
      });
      const refreshFromEvent = () => {
        void load(true);
      };
      realtimeChannel
        .on('broadcast', { event: 'INSERT' }, refreshFromEvent)
        .on('broadcast', { event: 'UPDATE' }, () => void load(true))
        .on('broadcast', { event: 'DELETE' }, () => void load(true))
        .on('presence', { event: 'sync' }, () => {
          const ids = new Set<string>();
          const state = realtimeChannel.presenceState();
          Object.values(state).flat().forEach((entry) => {
            if (entry && typeof entry === 'object' && 'userId' in entry && typeof entry.userId === 'string') ids.add(entry.userId);
          });
          ids.add(profile.userId);
          setOnlineUsers(ids);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            setConnection('online');
            await realtimeChannel.track({ userId: profile.userId, displayName: profile.displayName, at: new Date().toISOString() });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setConnection('offline');
          }
        });

      const clean = () => {
        void realtimeChannel.untrack();
        void supabaseClient.removeChannel(realtimeChannel);
      };
      if (disposed) clean();
      else cleanupRef.current = clean;
    }).catch(() => setConnection('offline'));

    return () => {
      disposed = true;
      cleanupRef.current();
    };
  }, [accessToken, load, profile.displayName, profile.userId, request, selectedId, supabaseClient]);

  const selected = snapshot?.channels.find((channel) => channel.id === selectedId) ?? null;
  const draft = selected ? drafts[selected.id] || '' : '';
  const directByUser = useMemo(() => {
    const entries = new Map<string, InternalChannel>();
    snapshot?.channels.filter((channel) => channel.channelType === 'direct').forEach((channel) => {
      const other = channel.members.find((member) => member.userId !== profile.userId);
      if (other) entries.set(other.userId, channel);
    });
    return entries;
  }, [profile.userId, snapshot]);

  const filteredTeam = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    return (snapshot?.team ?? []).filter((member) => member.userId !== profile.userId && (!needle || `${member.displayName} ${member.jobTitle}`.toLocaleLowerCase('pt-BR').includes(needle)));
  }, [profile.userId, search, snapshot]);

  const filteredContextChannels = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    return (snapshot?.channels ?? []).filter((channel) => channel.channelType === 'conversation' && (!needle || `${channel.contextLabel} ${channel.lastMessage}`.toLocaleLowerCase('pt-BR').includes(needle)));
  }, [search, snapshot]);

  async function openDirect(targetUserId: string) {
    try {
      const result = await request({ action: 'open-direct', targetUserId });
      const channelId = String(result.channelId || '');
      await load(true);
      if (channelId) {
        setSelectedId(channelId);
        setReplyTo(null);
        setMobileRoomOpen(true);
      }
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Não foi possível abrir a conversa direta.');
    }
  }

  function openChannel(channelId: string) {
    setSelectedId(channelId);
    setReplyTo(null);
    setMobileRoomOpen(true);
  }

  async function sendMessage() {
    if (!selected || !draft.trim() || sending) return;
    const text = draft.trim();
    const replyToId = replyTo?.id || null;
    const fingerprint = JSON.stringify([text, replyToId]);
    const pending = pendingSendsRef.current[selected.id];
    const clientMessageId = pending?.fingerprint === fingerprint ? pending.id : crypto.randomUUID();
    pendingSendsRef.current[selected.id] = { fingerprint, id: clientMessageId };
    setSending(true);
    try {
      const saved = await request({
        action: 'send',
        channelId: selected.id,
        text,
        clientMessageId,
        replyToId,
      }) as unknown as InternalMessage;
      if (pendingSendsRef.current[selected.id]?.id === clientMessageId) delete pendingSendsRef.current[selected.id];
      setDrafts((current) => ({ ...current, [selected.id]: '' }));
      setReplyTo(null);
      setSnapshot((current) => current ? {
        ...current,
        channels: current.channels.map((channel) => channel.id === selected.id ? {
          ...channel,
          messages: channel.messages.some((message) => message.id === saved.id) ? channel.messages : [...channel.messages, saved],
          lastMessage: saved.body,
          lastMessageAt: saved.createdAt,
          unreadCount: 0,
        } : channel),
      } : current);
      window.setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 0);
      void load(true);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'A mensagem não foi enviada.');
    } finally {
      setSending(false);
    }
  }

  if (loading && !snapshot) {
    return <section className="team-chat-loading"><LoaderCircle size={24} /><strong>Preparando o chat da equipe</strong><span>Sincronizando canais e participantes…</span></section>;
  }

  if (error && !snapshot) {
    return <section className="team-chat-loading error"><CircleAlert size={25} /><strong>Chat interno indisponível</strong><span>{error}</span><button onClick={() => void load()}><RefreshCw size={14} /> Tentar novamente</button></section>;
  }

  return (
    <section className={`team-chat-workspace ${mobileRoomOpen ? 'mobile-room-open' : ''}`}>
      <aside className="team-chat-sidebar">
        <header>
          <div><p>Comunicação interna</p><h1>Equipe</h1></div>
          <span><LockKeyhole size={11} /> Interno</span>
        </header>
        <label className="team-chat-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pessoas ou discussões" />{search && <button aria-label="Limpar busca" onClick={() => setSearch('')}><X size={13} /></button>}</label>
        <div className="team-channel-scroll">
          <ChannelSection label="Sala da equipe">
            {(snapshot?.channels ?? []).filter((channel) => channel.channelType === 'group').map((channel) => (
              <ChannelButton key={channel.id} channel={channel} selected={channel.id === selectedId} profile={profile} onOpen={openChannel} />
            ))}
          </ChannelSection>

          <ChannelSection label="Mensagens diretas">
            {filteredTeam.map((member) => {
              const channel = directByUser.get(member.userId);
              return <button className={`team-person-row ${channel?.id === selectedId ? 'selected' : ''}`} key={member.userId} onClick={() => void openDirect(member.userId)}>
                <TeamAvatar name={member.displayName} userId={member.userId} online={onlineUsers.has(member.userId)} />
                <span><strong>{member.displayName}</strong><small>{channel?.lastMessage || member.jobTitle}</small></span>
                {channel?.unreadCount ? <b>{channel.unreadCount}</b> : <ChevronRight size={13} />}
              </button>;
            })}
            {!filteredTeam.length && <p className="team-channel-empty">Nenhum integrante encontrado.</p>}
          </ChannelSection>

          <ChannelSection label="Discussões de atendimento">
            {filteredContextChannels.map((channel) => <ChannelButton key={channel.id} channel={channel} selected={channel.id === selectedId} profile={profile} onOpen={openChannel} />)}
            {!filteredContextChannels.length && <p className="team-channel-empty">Abra uma conversa do WhatsApp e escolha “Discussão interna”.</p>}
          </ChannelSection>
        </div>
      </aside>

      <section className="internal-room">
        {selected ? <>
          <header className="internal-room-header">
            <button className="internal-mobile-back" aria-label="Voltar aos canais" onClick={() => setMobileRoomOpen(false)}><ArrowLeft size={18} /></button>
            <ChannelAvatar channel={selected} profile={profile} />
            <div className="internal-room-heading">
              <div><h2>{channelTitle(selected, profile)}</h2><span className="internal-only-badge"><LockKeyhole size={9} /> Somente equipe</span></div>
              <p>{selected.channelType === 'conversation' ? selected.contextLabel : `${selected.members.length} participante${selected.members.length === 1 ? '' : 's'}`}</p>
            </div>
            {selected.channelType === 'conversation' && selected.contextId && <button className="internal-open-external" onClick={() => onOpenInboxConversation(selected.contextId!)}>Abrir atendimento <ChevronRight size={13} /></button>}
            <span className={`realtime-state ${connection}`}><i />{connection === 'online' ? 'Tempo real' : connection === 'connecting' ? 'Conectando' : 'Sincronização ativa'}</span>
          </header>

          <div className="internal-message-list">
            <div className="internal-safety-banner"><ShieldCheck size={15} /><p><strong>Conversa protegida da equipe</strong><span>Nada escrito aqui é enviado ao contato pelo WhatsApp.</span></p></div>
            {!selected.messages.length && <div className="internal-empty-room"><MessageCircleMore size={28} /><strong>Comece a conversa</strong><span>{selected.channelType === 'conversation' ? 'Registre contexto, decisões e próximos passos deste atendimento.' : 'Use este espaço para alinhar a operação da frota.'}</span></div>}
            {selected.messages.map((message, index) => {
              const own = message.authorId === profile.userId;
              const previous = selected.messages[index - 1];
              const showDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
              const reply = message.replyToId ? selected.messages.find((entry) => entry.id === message.replyToId) : null;
              return <div key={message.id}>
                {showDay && <div className="internal-day-divider"><span>{dayLabel(message.createdAt)}</span></div>}
                <article className={`internal-message ${own ? 'own' : ''}`}>
                  {!own && <TeamAvatar name={message.authorName} userId={message.authorId} />}
                  <div>
                    <header><strong>{own ? 'Você' : message.authorName}</strong><time>{chatTime(message.createdAt)}</time></header>
                    {reply && <blockquote><Reply size={10} /><span><strong>{reply.authorId === profile.userId ? 'Você' : reply.authorName}</strong>{reply.body}</span></blockquote>}
                    <p>{message.body}</p>
                    <footer>
                      <button onClick={() => setReplyTo(message)}><Reply size={11} /> Responder</button>
                      {own && <span>{message.readBy.length ? <><CheckCheck size={12} /> Lida por {message.readBy.length}</> : 'Enviada'}</span>}
                    </footer>
                  </div>
                </article>
              </div>;
            })}
            <div ref={chatEndRef} />
          </div>

          <footer className="internal-composer-wrap">
            {replyTo && <div className="internal-reply-preview"><Reply size={13} /><p><strong>Respondendo a {replyTo.authorId === profile.userId ? 'você' : replyTo.authorName}</strong><span>{replyTo.body}</span></p><button aria-label="Cancelar resposta" onClick={() => setReplyTo(null)}><X size={14} /></button></div>}
            <div className="internal-destination"><LockKeyhole size={11} /> Mensagem visível somente para a equipe</div>
            <div className="internal-composer">
              <button aria-label="Inserir menção" onClick={() => setDrafts((current) => ({ ...current, [selected.id]: `${current[selected.id] || ''}@` }))}><AtSign size={17} /></button>
              <textarea value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [selected.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} rows={1} maxLength={4000} placeholder="Escreva para a equipe…" aria-label="Mensagem interna" />
              <button className="internal-send" disabled={!draft.trim() || sending} aria-label="Enviar mensagem interna" onClick={() => void sendMessage()}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}</button>
            </div>
          </footer>
        </> : <div className="internal-empty-room standalone"><MessageSquareText size={30} /><strong>Selecione uma conversa</strong><span>Escolha a sala geral, um integrante ou uma discussão de atendimento.</span></div>}
      </section>

      <aside className="team-chat-context">
        {selected && <>
          <div className="team-context-heading"><span><Users size={16} /></span><p><strong>{channelTitle(selected, profile)}</strong><small>{selected.channelType === 'direct' ? 'Conversa privada' : 'Canal interno da operação'}</small></p></div>
          {selected.channelType === 'conversation' && selected.contextId && <div className="team-context-card"><p>Atendimento relacionado</p><strong>{selected.contextLabel}</strong><span>Discussão preservada junto ao histórico do contato.</span><button onClick={() => onOpenInboxConversation(selected.contextId!)}>Abrir no WhatsApp <ChevronRight size={14} /></button></div>}
          <div className="team-member-list"><p>Participantes · {selected.members.length}</p>{selected.members.map((member) => <div key={member.userId}><TeamAvatar name={member.displayName} userId={member.userId} online={onlineUsers.has(member.userId)} /><span><strong>{member.displayName}</strong><small>{member.jobTitle}</small></span><i className={onlineUsers.has(member.userId) ? 'online' : ''} /></div>)}</div>
          <div className="team-security-note"><ShieldCheck size={17} /><p><strong>Separado do WhatsApp</strong><span>Este módulo possui rota, armazenamento e permissões próprias.</span></p></div>
        </>}
      </aside>
    </section>
  );
}

function ChannelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="team-channel-section"><p>{label}</p>{children}</section>;
}

function ChannelButton({ channel, selected, profile, onOpen }: { channel: InternalChannel; selected: boolean; profile: UserProfile; onOpen: (id: string) => void }) {
  return <button className={`team-channel-row ${selected ? 'selected' : ''}`} onClick={() => onOpen(channel.id)}>
    <ChannelAvatar channel={channel} profile={profile} small />
    <span><strong>{channelTitle(channel, profile)}</strong><small>{channel.lastMessage || (channel.channelType === 'conversation' ? 'Discussão vinculada ao atendimento' : 'Sala da equipe')}</small></span>
    <span className="team-channel-meta">{channel.unreadCount ? <b>{channel.unreadCount}</b> : channel.lastMessageAt ? <time>{compactTime(channel.lastMessageAt)}</time> : null}</span>
  </button>;
}

function ChannelAvatar({ channel, profile, small = false }: { channel: InternalChannel; profile: UserProfile; small?: boolean }) {
  if (channel.channelType === 'group') return <span className={`internal-channel-avatar group ${small ? 'small' : ''}`}><Hash size={small ? 14 : 17} /></span>;
  if (channel.channelType === 'conversation') return <span className={`internal-channel-avatar context ${small ? 'small' : ''}`}><MessageSquareText size={small ? 14 : 17} /></span>;
  const other = channel.members.find((member) => member.userId !== profile.userId);
  return <TeamAvatar name={other?.displayName || 'Conversa'} userId={other?.userId || channel.id} small={small} />;
}

function TeamAvatar({ name, userId, online = false, small = false }: { name: string; userId: string; online?: boolean; small?: boolean }) {
  const palette = Math.abs(hashString(userId)) % 5;
  return <span className={`team-chat-avatar palette-${palette} ${small ? 'small' : ''}`}>{initials(name)}{online && <i />}</span>;
}

function channelTitle(channel: InternalChannel, profile: UserProfile) {
  if (channel.channelType === 'direct') return channel.members.find((member) => member.userId !== profile.userId)?.displayName || 'Conversa direta';
  return channel.contextLabel || channel.name || 'Chat interno';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || 'E'}${parts.length > 1 ? parts.at(-1)?.[0] || '' : ''}`.toUpperCase();
}

function hashString(value: string) {
  return [...value].reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0);
}

function chatTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function compactTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? chatTime(value)
    : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
}

function dayKey(value: string) {
  return new Date(value).toDateString();
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' }).format(date);
}
