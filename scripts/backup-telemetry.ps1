param(
    [string]$Supabase = 'supabase',
    [string]$OutputPath,
    [string]$DecryptPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function Resolve-BackupPath([string]$Candidate) {
    $absolute = [IO.Path]::GetFullPath($Candidate)
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\') + '\'
    if ($absolute.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Private backup files must be outside the repository.'
    }
    return $absolute
}

# Application-only recovery export. Windows DPAPI ties it to this Windows user;
# keep an independent off-device copy under your normal encrypted backup policy.
# It contains no Supabase auth users, keys, Storage objects or managed schemas.
if ($DecryptPath) {
    if (-not $OutputPath) { throw 'Decrypt requires an explicit temporary OutputPath outside the repository.' }
    $envelope = Get-Content -LiteralPath $DecryptPath -Raw | ConvertFrom-Json
    if ($envelope.format -ne 'cap-context-telemetry-dpapi-v1') { throw 'Unknown backup format.' }
    $plain = [Security.Cryptography.ProtectedData]::Unprotect(
        [Convert]::FromBase64String($envelope.protected), $null,
        [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes((Resolve-BackupPath $OutputPath), $plain)
    Write-Output 'Decrypted temporary application snapshot. Remove it after the local restore check.'
    exit
}
if (-not $OutputPath) {
    $backupDirectory = Join-Path $env:LOCALAPPDATA 'CapContext\telemetry-backups'
    [IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
    $OutputPath = Join-Path $backupDirectory ((Get-Date -Format 'yyyyMMdd-HHmmss') + '.dpapi.json')
}
$query = @'
select jsonb_build_object(
  'snapshot_at',now(), 'project_ref','iqkzynzxbmemhtiupwwu', 'server_version',version(),
  'transfers',(select coalesce(jsonb_agg(to_jsonb(t) order by attempt_id),'[]') from public.transfers t),
  'users',(select coalesce(jsonb_agg(to_jsonb(u) order by user_no),'[]') from public.users u),
  'users_sequence',(select jsonb_build_object('last_value',last_value::text,'is_called',is_called) from public.users_user_no_seq),
  'migrations',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m),
  'functions',(select jsonb_agg(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
  'views',(select coalesce(jsonb_agg(jsonb_build_object('name',viewname,'definition',definition)),'[]') from pg_views where schemaname='public'),
  'cron_jobs',(select coalesce(jsonb_agg(to_jsonb(j)),'[]') from cron.job j)
) as backup;
'@
$raw = & $Supabase db query $query --linked --project-ref iqkzynzxbmemhtiupwwu --output json
if ($LASTEXITCODE -ne 0) { throw 'Supabase export failed; no backup written.' }
$snapshot = (($raw -join "`n") | ConvertFrom-Json).rows[0].backup
if ($snapshot.project_ref -ne 'iqkzynzxbmemhtiupwwu' -or -not $snapshot.migrations) { throw 'Invalid application snapshot.' }
$plain = [Text.Encoding]::UTF8.GetBytes(($snapshot | ConvertTo-Json -Depth 100 -Compress))
$protected = [Security.Cryptography.ProtectedData]::Protect($plain, $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser)
$envelope = [ordered]@{
    format = 'cap-context-telemetry-dpapi-v1'
    project_ref = $snapshot.project_ref
    snapshot_at = $snapshot.snapshot_at
    event_count = @($snapshot.transfers).Count
    user_count = @($snapshot.users).Count
    protected = [Convert]::ToBase64String($protected)
}
$absoluteOutput = Resolve-BackupPath $OutputPath
[IO.File]::WriteAllText($absoluteOutput, ($envelope | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)
# Read/decrypt the saved artifact, so a failed or truncated write cannot look good.
$saved = Get-Content -LiteralPath $absoluteOutput -Raw | ConvertFrom-Json
$restored = [Security.Cryptography.ProtectedData]::Unprotect(
    [Convert]::FromBase64String($saved.protected), $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser)
if ([Convert]::ToBase64String($plain) -ne [Convert]::ToBase64String($restored)) { throw 'Backup round-trip failed.' }
Write-Output "Encrypted backup verified: $absoluteOutput ($($envelope.event_count) events, $($envelope.user_count) users)."
