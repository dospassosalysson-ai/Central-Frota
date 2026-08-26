-- Chat interno persistente e separado do canal externo do WhatsApp.
begin;

create table if not exists public.internal_channels (
  id text primary key,
  channel_type text not null check (channel_type in ('group', 'direct', 'conversation')),
  name text,
  direct_key text,
  context_type text,
  context_id text,
  context_label text,
  last_message text not null default '',
  last_message_at timestamptz,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (channel_type = 'direct' and direct_key is not null)
    or (channel_type = 'conversation' and context_type = 'conversation' and context_id is not null)
    or (channel_type = 'group')
  )
);

create unique index if not exists idx_internal_channels_direct_key
  on public.internal_channels(direct_key)
  where direct_key is not null;
create unique index if not exists idx_internal_channels_context
  on public.internal_channels(context_type, context_id)
  where context_type is not null and context_id is not null;
create index if not exists idx_internal_channels_last_message
  on public.internal_channels(last_message_at desc nulls last);

create table if not exists public.internal_channel_members (
  channel_id text not null references public.internal_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  last_read_message_id text,
  primary key (channel_id, user_id)
);

alter table public.internal_channel_members
  add column if not exists last_read_message_id text;

create index if not exists idx_internal_channel_members_user
  on public.internal_channel_members(user_id, channel_id);

create table if not exists public.internal_messages (
  id text primary key default gen_random_uuid()::text,
  channel_id text not null references public.internal_channels(id) on delete cascade,
  author_id uuid references public.profiles(user_id) on delete set null,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 4000),
  reply_to_id text references public.internal_messages(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists idx_internal_messages_channel_created
  on public.internal_messages(channel_id, created_at);
create unique index if not exists idx_internal_messages_id_channel
  on public.internal_messages(id, channel_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'internal_members_last_read_message_fkey'
  ) then
    alter table public.internal_channel_members
      add constraint internal_members_last_read_message_fkey
      foreign key (last_read_message_id) references public.internal_messages(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'internal_messages_reply_same_channel_fkey'
  ) then
    alter table public.internal_messages
      add constraint internal_messages_reply_same_channel_fkey
      foreign key (reply_to_id, channel_id) references public.internal_messages(id, channel_id);
  end if;
end;
$$;

alter table public.internal_channels enable row level security;
alter table public.internal_channel_members enable row level security;
alter table public.internal_messages enable row level security;

-- O navegador não consulta as tabelas diretamente. Esta função mínima existe
-- apenas para autorizar os tópicos privados do Realtime.
create or replace function public.is_active_internal_chat_member(requested_channel_id text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.internal_channel_members membership
    join public.profiles profile on profile.user_id = membership.user_id
    where membership.channel_id = requested_channel_id
      and membership.user_id = (select auth.uid())
      and profile.active = true
  );
$$;

revoke all on public.internal_channels from anon, authenticated;
revoke all on public.internal_channel_members from anon, authenticated;
revoke all on public.internal_messages from anon, authenticated;
revoke all on function public.is_active_internal_chat_member(text) from public;
grant execute on function public.is_active_internal_chat_member(text) to authenticated;

drop policy if exists "chat members can read own membership" on public.internal_channel_members;
create policy "chat members can read own membership"
  on public.internal_channel_members for select to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_active_internal_chat_member(channel_id)
  );

drop policy if exists "chat members can read channels" on public.internal_channels;
create policy "chat members can read channels"
  on public.internal_channels for select to authenticated
  using (public.is_active_internal_chat_member(id));

drop policy if exists "chat members can read messages" on public.internal_messages;
create policy "chat members can read messages"
  on public.internal_messages for select to authenticated
  using (public.is_active_internal_chat_member(channel_id));

-- Broadcast e Presence usam canais privados; a participação é validada pelo banco.
drop policy if exists "internal chat members receive realtime" on realtime.messages;
create policy "internal chat members receive realtime"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and left((select realtime.topic()), 14) = 'internal-chat:'
    and public.is_active_internal_chat_member(substring((select realtime.topic()) from 15))
  );

drop policy if exists "internal chat members send presence" on realtime.messages;
create policy "internal chat members send presence"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and left((select realtime.topic()), 14) = 'internal-chat:'
    and public.is_active_internal_chat_member(substring((select realtime.topic()) from 15))
  );

create or replace function public.broadcast_internal_chat_changes()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  chat_channel_id text;
begin
  chat_channel_id := case when tg_op = 'DELETE' then old.channel_id else new.channel_id end;
  perform realtime.broadcast_changes(
    'internal-chat:' || chat_channel_id,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

drop trigger if exists broadcast_internal_message_changes on public.internal_messages;
create trigger broadcast_internal_message_changes
  after insert or update or delete on public.internal_messages
  for each row execute function public.broadcast_internal_chat_changes();

drop trigger if exists broadcast_internal_member_changes on public.internal_channel_members;
create trigger broadcast_internal_member_changes
  after insert or update or delete on public.internal_channel_members
  for each row execute function public.broadcast_internal_chat_changes();

-- O envio inteiro confirma ou falha em uma única transação. O ID criado no
-- navegador torna novas tentativas idempotentes e evita mensagens duplicadas.
create or replace function public.send_internal_chat_message(
  p_message_id text,
  p_channel_id text,
  p_actor_id uuid,
  p_actor_name text,
  p_body text,
  p_reply_to_id text default null
)
returns table (id text, body text, reply_to_id text, created_at timestamptz)
language plpgsql
security definer set search_path = ''
as $$
declare
  chat_channel record;
  normalized_body text := btrim(p_body);
  saved_at timestamptz;
begin
  if p_message_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'INVALID_MESSAGE_ID';
  end if;
  if char_length(normalized_body) not between 1 and 4000 then
    raise exception 'INVALID_BODY';
  end if;
  if not exists (
    select 1
    from public.internal_channel_members membership
    join public.profiles profile on profile.user_id = membership.user_id
    where membership.channel_id = p_channel_id
      and membership.user_id = p_actor_id
      and profile.active = true
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.internal_messages parent
    where parent.id = p_reply_to_id and parent.channel_id = p_channel_id
  ) then
    raise exception 'INVALID_REPLY';
  end if;

  select channel.* into chat_channel
  from public.internal_channels channel
  where channel.id = p_channel_id
  for update;
  if not found then raise exception 'CHANNEL_NOT_FOUND'; end if;

  return query
    select stored.id, stored.body, stored.reply_to_id, stored.created_at
    from public.internal_messages stored
    where stored.id = p_message_id
      and stored.channel_id = p_channel_id
      and stored.author_id = p_actor_id;
  if found then return; end if;

  saved_at := clock_timestamp();
  insert into public.internal_messages (
    id, channel_id, author_id, author_name, body, reply_to_id, created_at
  ) values (
    p_message_id, p_channel_id, p_actor_id, p_actor_name, normalized_body, p_reply_to_id, saved_at
  );

  update public.internal_channels
  set last_message = normalized_body, last_message_at = saved_at, updated_at = saved_at
  where internal_channels.id = p_channel_id;

  insert into public.notifications (
    recipient_id, kind, title, body, entity_type, entity_id, created_at
  )
  select
    membership.user_id,
    'internal_chat_message',
    case
      when chat_channel.channel_type = 'direct' then p_actor_name
      else coalesce(chat_channel.context_label, chat_channel.name, 'Chat da equipe')
    end,
    left(normalized_body, 180),
    'internal_channel',
    p_channel_id,
    saved_at
  from public.internal_channel_members membership
  join public.profiles profile on profile.user_id = membership.user_id and profile.active = true
  where membership.channel_id = p_channel_id
    and membership.user_id <> p_actor_id;

  insert into public.audit_events (
    actor_user_id, actor_name, entity_type, entity_id, action, metadata, created_at
  ) values (
    p_actor_id,
    p_actor_name,
    'internal_channel',
    p_channel_id,
    'internal_message_sent',
    jsonb_strip_nulls(jsonb_build_object('messageId', p_message_id, 'replyToId', p_reply_to_id)),
    saved_at
  );

  return query select p_message_id, normalized_body, p_reply_to_id, saved_at;
end;
$$;

revoke all on function public.send_internal_chat_message(text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.send_internal_chat_message(text, text, uuid, text, text, text)
  to service_role;

insert into public.internal_channels (id, channel_type, name)
values ('team-general', 'group', 'Geral da Frota')
on conflict (id) do update set name = excluded.name;

insert into public.internal_channel_members (channel_id, user_id)
select 'team-general', user_id
from public.profiles
where active = true
on conflict (channel_id, user_id) do nothing;

insert into public.module_settings (module_key, label, enabled, position)
values ('chat', 'Chat interno', true, 25)
on conflict (module_key) do update set label = excluded.label, enabled = excluded.enabled, position = excluded.position;

notify pgrst, 'reload schema';
commit;
