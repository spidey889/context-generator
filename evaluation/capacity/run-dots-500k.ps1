param(
  [ValidateSet('test-a','test-b')][string]$TestKey = 'test-a',
  [ValidateSet(500000,1000000)][int]$InputChars = 500000,
  [ValidateRange(1,3)][int]$Repeats = 2,
  [string]$Output
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
  $capacityArguments = @('--chars',"$InputChars",'--repeats',"$Repeats")
  if ($Output) { $capacityArguments += @('--output',$Output) }
  & node (Join-Path $PSScriptRoot 'dots-500k.cjs') @capacityArguments
  $capacityExitCode = $LASTEXITCODE
} finally {
  foreach ($capacityName in $capacityEnvironmentNames) { [Environment]::SetEnvironmentVariable($capacityName,$capacitySavedEnvironment[$capacityName],'Process') }
  $capacityCredential = $null
}
exit $capacityExitCode
