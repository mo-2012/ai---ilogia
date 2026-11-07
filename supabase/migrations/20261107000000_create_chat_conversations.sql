create table public.chat_conversations (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  title text not null default '',
  subject text not null default 'عام',
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.chat_conversations enable row level security;

create policy "Users can read their own conversations"
  on public.chat_conversations for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own conversations"
  on public.chat_conversations for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own conversations"
  on public.chat_conversations for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own conversations"
  on public.chat_conversations for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.chat_conversations to authenticated;
