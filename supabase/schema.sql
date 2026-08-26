-- Central Frota — estrutura inicial para Supabase Postgres
-- Execute este arquivo uma única vez no SQL Editor do projeto Supabase.

begin;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  job_title text,
  role text not null default 'attendant' check (role in ('admin', 'attendant')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists job_title text;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, display_name, job_title, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, 'Usuário'), '@', 1)),
    new.raw_user_meta_data ->> 'job_title',
    case when exists (select 1 from public.profiles) then 'attendant' else 'admin' end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

insert into public.profiles (user_id, email, display_name, job_title, role)
select
  id,
  coalesce(email, ''),
  coalesce(raw_user_meta_data ->> 'full_name', split_part(coalesce(email, 'Usuário'), '@', 1)),
  raw_user_meta_data ->> 'job_title',
  case when row_number() over (order by created_at, id) = 1 then 'admin' else 'attendant' end
from auth.users
on conflict (user_id) do nothing;

update public.profiles as profile
set job_title = auth_user.raw_user_meta_data ->> 'job_title', updated_at = now()
from auth.users as auth_user
where profile.user_id = auth_user.id
  and profile.job_title is null
  and nullif(auth_user.raw_user_meta_data ->> 'job_title', '') is not null;

create table if not exists public.contacts (
  id text primary key,
  name text not null,
  phone text not null unique,
  initials text not null,
  color text not null default 'green',
  type text not null default 'other' check (type in ('driver', 'supervisor', 'supplier', 'other')),
  organization text,
  document text,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists public.conversations (
  id text primary key,
  contact_id text not null references public.contacts(id),
  status text not null default 'waiting' check (status in ('open', 'waiting', 'resolved')),
  assignee text check (assignee in ('current', 'wallace')),
  last_message text not null default '',
  last_message_at bigint not null,
  unread_count integer not null default 0 check (unread_count >= 0),
  channel text not null default 'whatsapp',
  external_id text unique,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_conversations_status_last_message_at on public.conversations(status, last_message_at desc);
create index if not exists idx_conversations_assignee on public.conversations(assignee);
create index if not exists idx_conversations_contact_id on public.conversations(contact_id);

create table if not exists public.messages (
  id text primary key,
  conversation_id text not null references public.conversations(id) on delete cascade,
  external_id text unique,
  direction text not null check (direction in ('incoming', 'outgoing')),
  body text not null,
  message_type text not null default 'text',
  sent_at bigint not null,
  author_name text,
  author_source text check (author_source in ('panel', 'mobile', 'automation')),
  status text not null default 'sent' check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_messages_conversation_sent_at on public.messages(conversation_id, sent_at);
create index if not exists idx_messages_external_id on public.messages(external_id) where external_id is not null;

create table if not exists public.tags (
  id text primary key,
  name text not null unique,
  color text not null
);

create table if not exists public.conversation_tags (
  conversation_id text not null references public.conversations(id) on delete cascade,
  tag_id text not null references public.tags(id) on delete cascade,
  primary key (conversation_id, tag_id)
);

create table if not exists public.notes (
  id text primary key,
  conversation_id text not null references public.conversations(id) on delete cascade,
  body text not null,
  created_by uuid references auth.users(id),
  created_at bigint not null
);

create index if not exists idx_notes_conversation_created_at on public.notes(conversation_id, created_at desc);

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

create unique index if not exists idx_internal_channels_direct_key on public.internal_channels(direct_key) where direct_key is not null;
create unique index if not exists idx_internal_channels_context on public.internal_channels(context_type, context_id) where context_type is not null and context_id is not null;
create index if not exists idx_internal_channels_last_message on public.internal_channels(last_message_at desc nulls last);

create table if not exists public.internal_channel_members (
  channel_id text not null references public.internal_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  last_read_message_id text,
  primary key (channel_id, user_id)
);

alter table public.internal_channel_members add column if not exists last_read_message_id text;

create index if not exists idx_internal_channel_members_user on public.internal_channel_members(user_id, channel_id);

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

create index if not exists idx_internal_messages_channel_created on public.internal_messages(channel_id, created_at);
create unique index if not exists idx_internal_messages_id_channel on public.internal_messages(id, channel_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'internal_members_last_read_message_fkey') then
    alter table public.internal_channel_members
      add constraint internal_members_last_read_message_fkey
      foreign key (last_read_message_id) references public.internal_messages(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'internal_messages_reply_same_channel_fkey') then
    alter table public.internal_messages
      add constraint internal_messages_reply_same_channel_fkey
      foreign key (reply_to_id, channel_id) references public.internal_messages(id, channel_id);
  end if;
end;
$$;

create table if not exists public.dre_lines (
  id text primary key,
  code text not null unique,
  description text not null,
  active boolean not null default true
);

create table if not exists public.projects (
  id text primary key,
  code text not null unique,
  name text not null,
  active boolean not null default true
);

create table if not exists public.cost_centers (
  id text primary key,
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('vehicle', 'project', 'general')),
  project_id text references public.projects(id),
  dre_line_id text not null references public.dre_lines(id),
  active boolean not null default true
);

create index if not exists idx_cost_centers_project_id on public.cost_centers(project_id);
create index if not exists idx_cost_centers_dre_line_id on public.cost_centers(dre_line_id);

create table if not exists public.vehicles (
  id text primary key,
  plate text not null unique,
  description text not null,
  cost_center_id text not null references public.cost_centers(id),
  active boolean not null default true
);

create index if not exists idx_vehicles_cost_center_id on public.vehicles(cost_center_id);

create table if not exists public.fiscal_documents (
  id text primary key,
  conversation_id text references public.conversations(id),
  source_message_id text references public.messages(id),
  supplier_contact_id text references public.contacts(id),
  supplier_name text not null,
  supplier_cnpj text not null,
  nf_number text not null,
  series text not null default '',
  issue_date date,
  due_date date,
  total_value_cents bigint not null default 0 check (total_value_cents >= 0),
  allocation_type text not null check (allocation_type in ('vehicle', 'project', 'general')),
  vehicle_id text references public.vehicles(id),
  project_id text references public.projects(id),
  cost_center_id text not null references public.cost_centers(id),
  dre_line_id text not null references public.dre_lines(id),
  status text not null default 'requested' check (status in ('requested', 'pdf_received', 'review', 'ready_benner', 'benner_done', 'fiscal_done', 'completed', 'correction')),
  file_key text,
  file_name text,
  file_type text,
  file_size bigint,
  benner_recorded_at bigint,
  benner_recorded_by text,
  fiscal_uploaded_at bigint,
  fiscal_uploaded_by text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (supplier_cnpj, nf_number, series)
);

create index if not exists idx_fiscal_documents_status_updated_at on public.fiscal_documents(status, updated_at desc);
create index if not exists idx_fiscal_documents_vehicle_id on public.fiscal_documents(vehicle_id);
create index if not exists idx_fiscal_documents_project_id on public.fiscal_documents(project_id);
create index if not exists idx_fiscal_documents_conversation_id on public.fiscal_documents(conversation_id);

create table if not exists public.workflow_events (
  id text primary key,
  fiscal_document_id text not null references public.fiscal_documents(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  actor_name text not null,
  actor_user_id uuid references auth.users(id),
  details text,
  created_at bigint not null
);

create index if not exists idx_workflow_events_document_created_at on public.workflow_events(fiscal_document_id, created_at desc);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text,
  event_type text not null,
  direction text not null default 'incoming',
  status text not null default 'pending' check (status in ('pending', 'processed', 'ignored', 'failed')),
  payload jsonb not null,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_id, event_type)
);

create index if not exists idx_integration_events_status_received_at on public.integration_events(status, received_at desc);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  actor_name text not null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_entity on public.audit_events(entity_type, entity_id, created_at desc);
create index if not exists idx_audit_events_created_at on public.audit_events(created_at desc);

create table if not exists public.module_settings (
  module_key text primary key,
  label text not null,
  enabled boolean not null default true,
  position integer not null default 0,
  configuration jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.action_plans (
  id text primary key,
  title text not null,
  description text not null default '',
  category text not null default 'operational' check (category in ('operational', 'fleet', 'fiscal', 'financial', 'team', 'supplier', 'improvement')),
  status text not null default 'planned' check (status in ('backlog', 'planned', 'in_progress', 'blocked', 'review', 'completed', 'cancelled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  owner_id uuid references auth.users(id),
  owner_name text,
  created_by uuid references auth.users(id),
  created_by_name text not null,
  due_at timestamptz,
  completed_at timestamptz,
  checklist jsonb not null default '[]'::jsonb,
  evidence_url text,
  related_entity_type text,
  related_entity_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_action_plans_owner_status_due on public.action_plans(owner_id, status, due_at);
create index if not exists idx_action_plans_status_due on public.action_plans(status, due_at);

create table if not exists public.action_comments (
  id uuid primary key default gen_random_uuid(),
  action_plan_id text not null references public.action_plans(id) on delete cascade,
  author_id uuid references auth.users(id),
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_action_comments_plan_created on public.action_comments(action_plan_id, created_at);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_read on public.notifications(recipient_id, read_at, created_at desc);

create table if not exists public.budget_envelopes (
  id text primary key,
  cost_center_id text references public.cost_centers(id),
  reference_month date not null,
  planned_value_cents bigint not null default 0,
  committed_value_cents bigint not null default 0,
  actual_value_cents bigint not null default 0,
  warning_percent integer not null default 85,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cost_center_id, reference_month)
);

create table if not exists public.approval_requests (
  id text primary key,
  request_type text not null check (request_type in ('purchase', 'service', 'payment', 'exception', 'reimbursement')),
  title text not null,
  description text not null default '',
  amount_cents bigint not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requester_id uuid references auth.users(id),
  requester_name text not null,
  approver_id uuid references auth.users(id),
  related_entity_type text,
  related_entity_id text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_approval_requests_status_created on public.approval_requests(status, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fiscal-documents', 'fiscal-documents', false, 15728640, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.tags enable row level security;
alter table public.conversation_tags enable row level security;
alter table public.notes enable row level security;
alter table public.internal_channels enable row level security;
alter table public.internal_channel_members enable row level security;
alter table public.internal_messages enable row level security;
alter table public.dre_lines enable row level security;
alter table public.projects enable row level security;
alter table public.cost_centers enable row level security;
alter table public.vehicles enable row level security;
alter table public.fiscal_documents enable row level security;
alter table public.workflow_events enable row level security;
alter table public.integration_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.module_settings enable row level security;
alter table public.action_plans enable row level security;
alter table public.action_comments enable row level security;
alter table public.notifications enable row level security;
alter table public.budget_envelopes enable row level security;
alter table public.approval_requests enable row level security;

-- A aplicação acessa as tabelas somente pelo backend autenticado do Render.
-- A secret key ignora RLS; não são concedidas políticas diretas ao navegador.

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
create policy "chat members can read own membership" on public.internal_channel_members for select to authenticated using (user_id = (select auth.uid()) and public.is_active_internal_chat_member(channel_id));
drop policy if exists "chat members can read channels" on public.internal_channels;
create policy "chat members can read channels" on public.internal_channels for select to authenticated using (public.is_active_internal_chat_member(id));
drop policy if exists "chat members can read messages" on public.internal_messages;
create policy "chat members can read messages" on public.internal_messages for select to authenticated using (public.is_active_internal_chat_member(channel_id));

drop policy if exists "internal chat members receive realtime" on realtime.messages;
create policy "internal chat members receive realtime" on realtime.messages for select to authenticated using (realtime.messages.extension in ('broadcast', 'presence') and left((select realtime.topic()), 14) = 'internal-chat:' and public.is_active_internal_chat_member(substring((select realtime.topic()) from 15)));
drop policy if exists "internal chat members send presence" on realtime.messages;
create policy "internal chat members send presence" on realtime.messages for insert to authenticated with check (realtime.messages.extension = 'presence' and left((select realtime.topic()), 14) = 'internal-chat:' and public.is_active_internal_chat_member(substring((select realtime.topic()) from 15)));

create or replace function public.broadcast_internal_chat_changes() returns trigger language plpgsql security definer set search_path = '' as $$
declare chat_channel_id text;
begin
  chat_channel_id := case when tg_op = 'DELETE' then old.channel_id else new.channel_id end;
  perform realtime.broadcast_changes('internal-chat:' || chat_channel_id, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  return null;
end;
$$;
drop trigger if exists broadcast_internal_message_changes on public.internal_messages;
create trigger broadcast_internal_message_changes after insert or update or delete on public.internal_messages for each row execute function public.broadcast_internal_chat_changes();
drop trigger if exists broadcast_internal_member_changes on public.internal_channel_members;
create trigger broadcast_internal_member_changes after insert or update or delete on public.internal_channel_members for each row execute function public.broadcast_internal_chat_changes();

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
  if char_length(normalized_body) not between 1 and 4000 then raise exception 'INVALID_BODY'; end if;
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
  insert into public.internal_messages (id, channel_id, author_id, author_name, body, reply_to_id, created_at)
  values (p_message_id, p_channel_id, p_actor_id, p_actor_name, normalized_body, p_reply_to_id, saved_at);

  update public.internal_channels
  set last_message = normalized_body, last_message_at = saved_at, updated_at = saved_at
  where internal_channels.id = p_channel_id;

  insert into public.notifications (recipient_id, kind, title, body, entity_type, entity_id, created_at)
  select
    membership.user_id,
    'internal_chat_message',
    case when chat_channel.channel_type = 'direct' then p_actor_name else coalesce(chat_channel.context_label, chat_channel.name, 'Chat da equipe') end,
    left(normalized_body, 180),
    'internal_channel',
    p_channel_id,
    saved_at
  from public.internal_channel_members membership
  join public.profiles profile on profile.user_id = membership.user_id and profile.active = true
  where membership.channel_id = p_channel_id and membership.user_id <> p_actor_id;

  insert into public.audit_events (actor_user_id, actor_name, entity_type, entity_id, action, metadata, created_at)
  values (
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

revoke all on function public.send_internal_chat_message(text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.send_internal_chat_message(text, text, uuid, text, text, text) to service_role;

insert into public.module_settings (module_key, label, enabled, position) values
  ('control', 'Sala de controle', true, 10),
  ('inbox', 'Atendimento', true, 20),
  ('chat', 'Chat interno', true, 25),
  ('actions', 'Planos de ação', true, 30),
  ('documents', 'Fiscal e notas', true, 40),
  ('fleet', 'Frota e DRE', true, 50),
  ('finance', 'Gestão financeira', true, 60),
  ('team', 'Equipe', true, 70),
  ('reports', 'Indicadores', true, 80)
on conflict (module_key) do update set label = excluded.label, position = excluded.position;

insert into public.internal_channels (id, channel_type, name) values
  ('team-general', 'group', 'Geral da Frota')
on conflict (id) do update set name = excluded.name;

insert into public.internal_channel_members (channel_id, user_id)
select 'team-general', user_id from public.profiles where active = true
on conflict (channel_id, user_id) do nothing;

insert into public.dre_lines (id, code, description) values
  ('dre-fuel', '3.1.01', 'Combustíveis e lubrificantes'),
  ('dre-parts', '3.1.02', 'Peças e componentes'),
  ('dre-maintenance', '3.1.03', 'Manutenção e serviços'),
  ('dre-tires', '3.1.04', 'Pneus e recapagens'),
  ('dre-admin', '3.2.01', 'Despesas administrativas da frota')
on conflict (id) do nothing;

insert into public.projects (id, code, name) values
  ('project-log20', 'PRJ-LOG20', 'Operação LOG20'),
  ('project-fleet', 'PRJ-FROTA', 'Estrutura de Frota')
on conflict (id) do nothing;

insert into public.cost_centers (id, code, name, kind, project_id, dre_line_id) values
  ('cc-gkw1a92', 'CC-GKW1A92', 'Cavalo GKW1A92', 'vehicle', 'project-log20', 'dre-fuel'),
  ('cc-rtt4b18', 'CC-RTT4B18', 'Cavalo RTT4B18', 'vehicle', 'project-log20', 'dre-tires'),
  ('cc-fdz8c44', 'CC-FDZ8C44', 'Cavalo FDZ8C44', 'vehicle', 'project-log20', 'dre-maintenance'),
  ('cc-ejk6d07', 'CC-EJK6D07', 'Carreta EJK6D07', 'vehicle', 'project-log20', 'dre-parts'),
  ('cc-log20-general', 'CC-LOG20-GERAL', 'Despesas gerais LOG20', 'project', 'project-log20', 'dre-maintenance'),
  ('cc-fleet-admin', 'CC-FROTA-ADM', 'Administração da frota', 'general', 'project-fleet', 'dre-admin')
on conflict (id) do nothing;

insert into public.vehicles (id, plate, description, cost_center_id) values
  ('veh-gkw1a92', 'GKW1A92', 'Volvo FH 540', 'cc-gkw1a92'),
  ('veh-rtt4b18', 'RTT4B18', 'Scania R 450', 'cc-rtt4b18'),
  ('veh-fdz8c44', 'FDZ8C44', 'DAF XF 480', 'cc-fdz8c44'),
  ('veh-ejk6d07', 'EJK6D07', 'Carreta LS', 'cc-ejk6d07')
on conflict (id) do nothing;

insert into public.contacts (id, name, phone, initials, color, type, organization) values
  ('contact-marcos', 'Marcos Vieira', '+5511987654321', 'MV', 'coral', 'driver', 'Frota própria'),
  ('contact-patricia', 'Patrícia Azevedo', '+5521992221034', 'PA', 'blue', 'supervisor', 'LOG20'),
  ('contact-rodovia', 'Rodovia Pneus', '+5531997712840', 'RP', 'violet', 'supplier', 'Fornecedor'),
  ('contact-horizonte', 'Posto Horizonte', '+5541991007765', 'PH', 'amber', 'supplier', 'Fornecedor')
on conflict (id) do nothing;

insert into public.conversations (id, contact_id, status, assignee, last_message, last_message_at, unread_count) values
  ('conv-marcos', 'contact-marcos', 'open', 'current', 'A carreta está liberada. Sigo para a LOG20?', 1787360369361, 2),
  ('conv-patricia', 'contact-patricia', 'open', 'wallace', 'Precisamos priorizar o GKW1A92 hoje.', 1787359709361, 0),
  ('conv-rodovia', 'contact-rodovia', 'waiting', null, 'Enviei a NF 019884 em PDF.', 1787357729361, 1),
  ('conv-horizonte', 'contact-horizonte', 'resolved', 'current', 'NF 84592 recebida, obrigado!', 1787274089361, 0)
on conflict (id) do nothing;

insert into public.messages (id, conversation_id, direction, body, sent_at, author_name, author_source, status) values
  ('msg-m1', 'conv-marcos', 'incoming', 'Bom dia! Finalizaram o serviço da carreta agora.', 1787359889361, null, null, 'read'),
  ('msg-m2', 'conv-marcos', 'outgoing', 'Bom dia, Marcos. Confirma se o checklist foi assinado e se não ficou nenhuma pendência.', 1787360129361, 'Wallace', 'mobile', 'read'),
  ('msg-m3', 'conv-marcos', 'incoming', 'Tudo certo, checklist assinado.', 1787360249361, null, null, 'read'),
  ('msg-m4', 'conv-marcos', 'incoming', 'A carreta está liberada. Sigo para a LOG20?', 1787360369361, null, null, 'read'),
  ('msg-p1', 'conv-patricia', 'incoming', 'Precisamos priorizar o GKW1A92 hoje.', 1787359709361, null, null, 'read'),
  ('msg-r1', 'conv-rodovia', 'incoming', 'Olá! Enviei a NF 019884 em PDF.', 1787357729361, null, null, 'read'),
  ('msg-h1', 'conv-horizonte', 'outgoing', 'Recebemos o PDF e vamos seguir com o lançamento.', 1787273789361, 'Você', 'panel', 'read'),
  ('msg-h2', 'conv-horizonte', 'incoming', 'NF 84592 recebida, obrigado!', 1787274089361, null, null, 'read')
on conflict (id) do nothing;

insert into public.tags (id, name, color) values
  ('tag-driver', 'Motorista', 'green'),
  ('tag-fleet', 'Frota', 'lilac'),
  ('tag-log20', 'LOG20', 'amber'),
  ('tag-fiscal', 'Nota fiscal', 'blue')
on conflict (id) do nothing;

insert into public.conversation_tags (conversation_id, tag_id) values
  ('conv-marcos', 'tag-driver'),
  ('conv-marcos', 'tag-fleet'),
  ('conv-patricia', 'tag-log20'),
  ('conv-rodovia', 'tag-fiscal')
on conflict do nothing;

insert into public.notes (id, conversation_id, body, created_at) values
  ('note-marcos', 'conv-marcos', 'Motorista vinculado ao cavalo GKW1A92.', 1787360009361)
on conflict (id) do nothing;

insert into public.fiscal_documents (
  id, supplier_name, supplier_cnpj, nf_number, series, issue_date, due_date,
  total_value_cents, allocation_type, vehicle_id, project_id, cost_center_id,
  dre_line_id, status, file_name, file_size, benner_recorded_at,
  benner_recorded_by, fiscal_uploaded_at, fiscal_uploaded_by, created_at, updated_at
) values
  ('doc-fuel-84592', 'Posto Horizonte', '12830456000172', '84592', '1', '2026-08-20', '2026-08-30', 384760, 'vehicle', 'veh-gkw1a92', 'project-log20', 'cc-gkw1a92', 'dre-fuel', 'pdf_received', 'NF-84592.pdf', 248120, null, null, null, null, 1787346000000, 1787356800000),
  ('doc-tires-19884', 'Rodovia Pneus', '34761902000108', '019884', '2', '2026-08-19', '2026-09-02', 729000, 'vehicle', 'veh-rtt4b18', 'project-log20', 'cc-rtt4b18', 'dre-tires', 'ready_benner', 'NF-019884.pdf', 312890, null, null, null, null, 1787270400000, 1787349600000),
  ('doc-service-7721', 'Oficina Norte Diesel', '05844219000166', '7721', '1', '2026-08-18', '2026-08-28', 265000, 'vehicle', 'veh-fdz8c44', 'project-log20', 'cc-fdz8c44', 'dre-maintenance', 'benner_done', null, null, 1787338800000, 'Wallace', null, null, 1787184000000, 1787338800000),
  ('doc-parts-34098', 'ARK Peças Pesadas', '61973085000147', '34098', '1', '2026-08-17', '2026-08-27', 189430, 'vehicle', 'veh-ejk6d07', 'project-log20', 'cc-ejk6d07', 'dre-parts', 'fiscal_done', null, null, 1787270400000, 'Amanda', 1787328000000, 'Amanda', 1787097600000, 1787328000000),
  ('doc-project-9081', 'Guincho Resgate 24h', '42570118000191', '9081', '1', '2026-08-15', '2026-08-25', 98000, 'project', null, 'project-log20', 'cc-log20-general', 'dre-maintenance', 'completed', null, null, 1786924800000, 'Wallace', 1786924800000, 'Wallace', 1786838400000, 1786924800000),
  ('doc-correction-4412', 'Clima Tech Serviços', '73114562000130', '4412', '1', '2026-08-16', '2026-08-26', 145000, 'general', null, 'project-fleet', 'cc-fleet-admin', 'dre-admin', 'correction', null, null, null, null, null, null, 1787011200000, 1787353200000)
on conflict (id) do nothing;

insert into public.workflow_events (id, fiscal_document_id, event_type, to_status, actor_name, details, created_at) values
  ('event-seed-1', 'doc-fuel-84592', 'seeded', 'pdf_received', 'Central', 'Registro demonstrativo', 1787356800000),
  ('event-seed-2', 'doc-tires-19884', 'seeded', 'ready_benner', 'Central', 'Registro demonstrativo', 1787349600000),
  ('event-seed-3', 'doc-service-7721', 'seeded', 'benner_done', 'Central', 'Registro demonstrativo', 1787338800000),
  ('event-seed-4', 'doc-parts-34098', 'seeded', 'fiscal_done', 'Central', 'Registro demonstrativo', 1787328000000),
  ('event-seed-5', 'doc-project-9081', 'seeded', 'completed', 'Central', 'Registro demonstrativo', 1786924800000),
  ('event-seed-6', 'doc-correction-4412', 'seeded', 'correction', 'Central', 'Registro demonstrativo', 1787353200000)
on conflict (id) do nothing;

insert into public.action_plans (
  id, title, description, category, status, priority, owner_name, created_by_name, due_at, checklist
) values
  ('action-nf-backlog', 'Zerar pendências de notas no Benner', 'Validar PDFs recebidos, lançar os dados no Benner pelo MV e concluir a carga no Portal Fiscal.', 'fiscal', 'in_progress', 'critical', 'Wallace', 'Gestão da Frota', now() + interval '1 day', '[{"id":"check-1","label":"Conferir CNPJ, NF e série","done":true},{"id":"check-2","label":"Lançar pendências no Benner","done":false},{"id":"check-3","label":"Subir PDFs no Portal Fiscal","done":false}]'::jsonb),
  ('action-cost-review', 'Revisar custo por placa da semana', 'Comparar realizado por centro de custo com a linha do DRE e registrar desvios relevantes.', 'financial', 'planned', 'high', 'Amanda', 'Gestão da Frota', now() + interval '3 days', '[{"id":"check-1","label":"Fechar despesas por placa","done":false},{"id":"check-2","label":"Sinalizar variações acima de 10%","done":false}]'::jsonb),
  ('action-supplier-sla', 'Atualizar SLA dos fornecedores críticos', 'Consolidar prazo de retorno das oficinas e fornecedores de pneus com maior impacto na operação.', 'supplier', 'review', 'medium', 'Wallace', 'Gestão da Frota', now() + interval '5 days', '[{"id":"check-1","label":"Revisar oficinas","done":true},{"id":"check-2","label":"Revisar fornecedores de pneus","done":true},{"id":"check-3","label":"Apresentar recomendação","done":false}]'::jsonb),
  ('action-driver-checklist', 'Padronizar retorno dos motoristas', 'Criar modelo de resposta e checklist para ocorrências, liberação e chegada na LOG20.', 'operational', 'completed', 'medium', 'Amanda', 'Gestão da Frota', now() - interval '1 day', '[{"id":"check-1","label":"Mapear perguntas recorrentes","done":true},{"id":"check-2","label":"Validar modelo com supervisão","done":true}]'::jsonb)
on conflict (id) do nothing;

insert into public.budget_envelopes (
  id, cost_center_id, reference_month, planned_value_cents, committed_value_cents, actual_value_cents
) values
  ('budget-gkw1a92-current', 'cc-gkw1a92', date_trunc('month', current_date)::date, 1200000, 895000, 864200),
  ('budget-rtt4b18-current', 'cc-rtt4b18', date_trunc('month', current_date)::date, 950000, 810000, 783100),
  ('budget-fdz8c44-current', 'cc-fdz8c44', date_trunc('month', current_date)::date, 1100000, 1030000, 987500),
  ('budget-fleet-admin-current', 'cc-fleet-admin', date_trunc('month', current_date)::date, 600000, 405000, 392300)
on conflict (id) do nothing;

insert into public.approval_requests (
  id, request_type, title, description, amount_cents, status, requester_name, related_entity_type, related_entity_id
) values
  ('approval-tires-rtt4b18', 'purchase', 'Troca de pneus RTT4B18', 'Cotação emergencial para manter a programação da LOG20.', 729000, 'pending', 'Wallace', 'vehicle', 'veh-rtt4b18'),
  ('approval-service-fdz8c44', 'service', 'Reparo preventivo FDZ8C44', 'Serviço programado para evitar nova indisponibilidade.', 265000, 'approved', 'Amanda', 'vehicle', 'veh-fdz8c44')
on conflict (id) do nothing;

commit;
