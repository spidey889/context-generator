-- Separate server-side failure evidence survives fallback and old clients.
-- Fixed codes/counts only; never copy provider bodies or conversation content.
create function public.is_valid_provider_failure(input jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  rules constant jsonb := '{"id":{"type":"uuid"},"request_id":{"type":"uuid"},"attempt_id":{"type":"uuid"},"occurred_at":{"type":"timestamp"},"environment":{"type":"string","values":["production","preview","development"]},"provider":{"type":"string","values":["tokenharbor","openrouter","gemini","mistral"]},"model":{"type":"string","values":["deepseek-v4.1-flash:free","dots-studio/dots-3-note-preview:free","qwen/qwen3.8-27b:free","google/gemma-4-26b-a4b-it:free","gemini-3.6-flash","gemini-3.5-flash-lite","ministral-14b-2512"]},"failure_reason":{"type":"string","values":["provider_timeout","provider_request_failed","provider_http_error","provider_invalid_json","provider_generation_failed","provider_empty","provider_output_rejected"]},"phase":{"type":"string","values":["waiting_headers","reading_body","waiting_answer","answer_stream","parsing_response","validating_output","http_error"]},"timeout_kind":{"type":"string","values":["first_answer","completion"]},"key_slot":{"type":"string","values":["primary","backup"]},"route_index":{"type":"number","min":1,"max":16},"request_attempt":{"type":"number","min":1,"max":2},"input_chars":{"type":"number","min":0,"max":350000},"request_bytes":{"type":"number","min":0,"max":10000000},"max_output_tokens":{"type":"number","min":1,"max":1000000},"elapsed_ms":{"type":"number","min":0,"max":360000},"budget_ms":{"type":"number","min":1,"max":90000},"first_answer_budget_ms":{"type":"number","min":1,"max":90000},"headers_ms":{"type":"number","min":0,"max":360000},"first_answer_ms":{"type":"number","min":0,"max":360000},"answer_chars":{"type":"number","min":0,"max":2147483647},"reasoning_chars":{"type":"number","min":0,"max":2147483647},"stream_chunks":{"type":"number","min":0,"max":2147483647},"http_status":{"type":"number","min":100,"max":599},"finish_reason":{"type":"string","values":["stop","length","other"]},"prompt_tokens":{"type":"number","min":0,"max":2147483647},"completion_tokens":{"type":"number","min":0,"max":2147483647},"reasoning_tokens":{"type":"number","min":0,"max":2147483647}}'::jsonb;
  required constant text[] := array['id','request_id','occurred_at','environment','provider','model','failure_reason','phase','route_index','request_attempt','input_chars','request_bytes','max_output_tokens','elapsed_ms','budget_ms'];
  models constant jsonb := '{"tokenharbor":["deepseek-v4.1-flash:free"],"openrouter":["dots-studio/dots-3-note-preview:free","qwen/qwen3.8-27b:free","google/gemma-4-26b-a4b-it:free"],"gemini":["gemini-3.6-flash","gemini-3.5-flash-lite"],"mistral":["ministral-14b-2512"]}'::jsonb;
  item record; rule jsonb; value numeric;
begin
  if jsonb_typeof(input) <> 'object' or input is null or not input ?& required then return false; end if;
  for item in select * from jsonb_each(input) loop
    rule := rules -> item.key;
    if rule is null or item.value = 'null'::jsonb then return false; end if;
    if rule->>'type' = 'number' then
      if jsonb_typeof(item.value) <> 'number' then return false; end if;
      value := (item.value #>> '{}')::numeric;
      if value <> trunc(value) or value < (rule->>'min')::numeric or value > (rule->>'max')::numeric then return false; end if;
    else
      if jsonb_typeof(item.value) <> 'string' then return false; end if;
      if rule ? 'values' and not (rule->'values' ? (item.value #>> '{}')) then return false; end if;
      if rule->>'type' = 'uuid' and (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
      if rule->>'type' = 'timestamp' then
        if (item.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then return false; end if;
        perform (item.value #>> '{}')::timestamptz;
      end if;
    end if;
  end loop;
  return (models->(input->>'provider') ? (input->>'model')) and
    (not input ? 'timeout_kind' or input->>'failure_reason' = 'provider_timeout');
exception when others then return false;
end;
$$;
revoke all on function public.is_valid_provider_failure(jsonb) from public,anon,authenticated;
grant execute on function public.is_valid_provider_failure(jsonb) to service_role;

create table public.provider_failures (
  id uuid primary key,
  request_id uuid not null,
  attempt_id uuid,
  occurred_at timestamptz not null,
  environment text not null check (environment in ('production','preview','development')),
  provider text not null check (provider in ('tokenharbor','openrouter','gemini','mistral')),
  model text not null check (model in ('deepseek-v4.1-flash:free','dots-studio/dots-3-note-preview:free','qwen/qwen3.8-27b:free','google/gemma-4-26b-a4b-it:free','gemini-3.6-flash','gemini-3.5-flash-lite','ministral-14b-2512')),
  failure_reason text not null check (failure_reason in ('provider_timeout','provider_request_failed','provider_http_error','provider_invalid_json','provider_generation_failed','provider_empty','provider_output_rejected')),
  phase text not null check (phase in ('waiting_headers','reading_body','waiting_answer','answer_stream','parsing_response','validating_output','http_error')),
  timeout_kind text check (timeout_kind in ('first_answer','completion')),
  key_slot text check (key_slot in ('primary','backup')),
  route_index integer not null check (route_index between 1 and 16),
  request_attempt integer not null check (request_attempt between 1 and 2),
  input_chars integer not null check (input_chars between 0 and 350000),
  request_bytes integer not null check (request_bytes between 0 and 10000000),
  max_output_tokens integer not null check (max_output_tokens between 1 and 1000000),
  elapsed_ms integer not null check (elapsed_ms between 0 and 360000),
  budget_ms integer not null check (budget_ms between 1 and 90000),
  first_answer_budget_ms integer check (first_answer_budget_ms between 1 and 90000),
  headers_ms integer check (headers_ms between 0 and 360000),
  first_answer_ms integer check (first_answer_ms between 0 and 360000),
  answer_chars integer check (answer_chars between 0 and 2147483647),
  reasoning_chars integer check (reasoning_chars between 0 and 2147483647),
  stream_chunks integer check (stream_chunks between 0 and 2147483647),
  http_status integer check (http_status between 100 and 599),
  finish_reason text check (finish_reason in ('stop','length','other')),
  prompt_tokens integer check (prompt_tokens between 0 and 2147483647),
  completion_tokens integer check (completion_tokens between 0 and 2147483647),
  reasoning_tokens integer check (reasoning_tokens between 0 and 2147483647),
  check (not (timeout_kind is not null and failure_reason <> 'provider_timeout'))
);
alter table public.provider_failures enable row level security;
revoke all on public.provider_failures from public,anon,authenticated,service_role;
grant select,insert on public.provider_failures to service_role;
create index provider_failures_time_idx on public.provider_failures (occurred_at desc);
create index provider_failures_attempt_idx on public.provider_failures (attempt_id) where attempt_id is not null;
create index provider_failures_request_idx on public.provider_failures (request_id);
comment on table public.provider_failures is 'Private backend provider failure metadata. No prompts, answers, reasoning text, keys or upstream bodies. Retained for 30 days.';

create function public.record_provider_failure(p_event jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not public.is_valid_provider_failure(p_event) then
    raise exception 'Invalid provider failure metadata' using errcode = '22023';
  end if;
  -- The backend retries the identical event UUID after a lost acknowledgement.
  insert into public.provider_failures select row.*
    from jsonb_populate_record(null::public.provider_failures,p_event) as row
    on conflict (id) do nothing;
end;
$$;
revoke all on function public.record_provider_failure(jsonb) from public,anon,authenticated;
grant execute on function public.record_provider_failure(jsonb) to service_role;
select cron.schedule('prune-provider-failures','23 3 * * *',
  $$delete from public.provider_failures where occurred_at < now() - interval '30 days'$$);
