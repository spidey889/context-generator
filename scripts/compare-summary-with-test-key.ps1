param(
  [ValidateSet('test-a','test-b')][string]$TestKey = 'test-a',
  [ValidateSet('ling','dots','qwen')][string]$Model = 'ling',
  [string]$BaselineRef = 'master',
  [string]$Cases = 'evaluation/handoff-quality-cases.json',
  [ValidateRange(1,3)][int]$Repeats = 1,
  [string]$Output,
  [string]$CaseId,
  [switch]$LongHistory
)
$ErrorActionPreference = 'Stop'
$testVault = Join-Path $env:LOCALAPPDATA 'CapContext\testing'
try {
  $testCredential = Import-Clixml -LiteralPath (Join-Path $testVault ($TestKey + '.credential.xml'))
  if ($testCredential -isnot [pscredential]) { throw 'Invalid test credential' }
} catch {
  Write-Error 'The selected local testing credential is unavailable. No production key will be used.'
  exit 1
}
$testModels = @{
  ling = 'inclusionai/ling-3.1-flash'
  dots = 'dots-studio/dots-3-note-preview:free'
  qwen = 'qwen/qwen3.8-27b:free'
}
$testArguments = @('--baseline-ref',$BaselineRef,'--cases',$Cases,'--model',$testModels[$Model],'--repeats',"$Repeats")
if ($Output) { $testArguments += @('--output',$Output) }
if ($CaseId) { $testArguments += @('--case-id',$CaseId) }
if ($LongHistory) { $testArguments += '--long-history' }
$testEnvironmentNames = @('OPENROUTER_API_KEY','CAP_CONTEXT_TEST_KEY_SLOT','CAP_CONTEXT_TEST_LEDGER_PATH')
$savedTestEnvironment = @{}
foreach ($testName in $testEnvironmentNames) { $savedTestEnvironment[$testName] = [Environment]::GetEnvironmentVariable($testName,'Process') }
try {
  # DPAPI decrypts only for this Windows user. The value never enters CLI arguments.
  $env:OPENROUTER_API_KEY = $testCredential.GetNetworkCredential().Password
  $env:CAP_CONTEXT_TEST_KEY_SLOT = $TestKey
  $env:CAP_CONTEXT_TEST_LEDGER_PATH = Join-Path $testVault ($TestKey + '.usage.json')
  & node --require (Join-Path $PSScriptRoot 'openrouter-test-budget.cjs') (Join-Path $PSScriptRoot 'compare-summary-prompts.js') @testArguments
  $testExitCode = $LASTEXITCODE
} finally {
  foreach ($testName in $testEnvironmentNames) { [Environment]::SetEnvironmentVariable($testName,$savedTestEnvironment[$testName],'Process') }
  $testCredential = $null
}
exit $testExitCode
