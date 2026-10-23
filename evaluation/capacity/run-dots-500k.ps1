param(
  [ValidateSet('test-a','test-b')][string]$TestKey = 'test-a',
  [ValidateRange(1,3)][int]$Repeats = 2,
  [string]$Output = 'evaluation/results/2026-10-23-dots-500k.json'
)
$ErrorActionPreference = 'Stop'
$capacityVaultPath = Join-Path $env:LOCALAPPDATA 'CapContext\testing'
try {
  $capacityCredential = Import-Clixml -LiteralPath (Join-Path $capacityVaultPath ($TestKey + '.credential.xml'))
  if ($capacityCredential -isnot [pscredential]) { throw 'Invalid testing credential' }
} catch {
  Write-Error 'Selected encrypted testing credential unavailable. No production key will be used.'
  exit 1
}
$capacityEnvironmentNames = @('OPENROUTER_API_KEY','CAP_CONTEXT_TEST_KEY_SLOT','CAP_CONTEXT_TEST_LEDGER_PATH')
$capacitySavedEnvironment = @{}
foreach ($capacityName in $capacityEnvironmentNames) { $capacitySavedEnvironment[$capacityName] = [Environment]::GetEnvironmentVariable($capacityName,'Process') }
try {
  # The key stays in this process and its child, never command arguments or reports.
  $env:OPENROUTER_API_KEY = $capacityCredential.GetNetworkCredential().Password
  $env:CAP_CONTEXT_TEST_KEY_SLOT = $TestKey
  $env:CAP_CONTEXT_TEST_LEDGER_PATH = Join-Path $capacityVaultPath ($TestKey + '.usage.json')
  & node (Join-Path $PSScriptRoot 'dots-500k.cjs') --repeats "$Repeats" --output $Output
  $capacityExitCode = $LASTEXITCODE
} finally {
  foreach ($capacityName in $capacityEnvironmentNames) { [Environment]::SetEnvironmentVariable($capacityName,$capacitySavedEnvironment[$capacityName],'Process') }
  $capacityCredential = $null
}
exit $capacityExitCode
