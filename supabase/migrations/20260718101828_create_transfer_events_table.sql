create table public.transfer_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique,
  install_id text not null,
  attempted_at timestamptz not null,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_platform text not null check (source_platform in ('claude','chatgpt','gemini','grok','deepseek')),
  destination_platform text not null check (destination_platform in ('claude','chatgpt','gemini','grok','deepseek')),
  character_count integer,
  status text not null check (status in ('started','succeeded','failed')),
  failure_reason text check (failure_reason in (
    'no_conversation','conversation_too_large','capture_failed',
    'summary_rate_limited','summary_service_busy','summary_access_denied',
    'summary_failed','destination_open_failed','paste_failed',
    'extension_reloaded','client_interrupted','unknown_failure'
  )),
  extension_version text
);

create index transfer_events_attempted_at_idx on public.transfer_events (attempted_at desc);
create index transfer_events_status_idx on public.transfer_events (status);
create index transfer_events_install_id_idx on public.transfer_events (install_id);

alter table public.transfer_events enable row level security;

-- Extension can create a "started" row and later update its own row to a terminal status.
-- No public read policy is added, so raw rows are not readable with the anon key.
create policy "anon can insert transfer events"
  on public.transfer_events for insert
  to anon
  with check (true);

create policy "anon can update own transfer event by attempt_id"
  on public.transfer_events for update
  to anon
  using (true)
  with check (true);
