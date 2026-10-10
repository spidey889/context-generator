-- Copy is a normal transfer whose final delivery writes the clipboard.
-- Expand only destinations; clipboard can never be a capture source.
alter table public.transfers
  drop constraint transfers_destination_platform_check;
alter table public.transfers
  add constraint transfers_destination_platform_check
  check (destination_platform in ('claude','chatgpt','gemini','grok','deepseek','clipboard'));
