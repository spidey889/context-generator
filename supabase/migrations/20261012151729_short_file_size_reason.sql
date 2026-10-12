begin;

alter table public.transfers alter column file_size_failure_reason
set expression as (
  case when diagnostics->>'capture_detail' = 'attachment_size_limit'
    then 'file size'
    else null end
);

notify pgrst, 'reload schema';
commit;
