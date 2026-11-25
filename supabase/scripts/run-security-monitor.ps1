param(
  [Parameter(Mandatory = $true)][uri]$SupabaseUrl,
  [Parameter(Mandatory = $true)][string]$CredentialFile,
  [Parameter(Mandatory = $true)][string]$LogFile,
  [ValidateSet('monitor', 'alerts')][string]$Kind = 'monitor',
  [string]$BrevoCredentialFile,
  [string]$SenderEmail,
  [uri]$AppOrigin
)

$ErrorActionPreference = 'Stop'
$exitCode = 1
$environment = @{}
try {
  $credential = Import-Clixml -LiteralPath $CredentialFile
  if ($credential -isnot [pscredential]) { throw 'Invalid service credential file' }
  if ($Kind -eq 'alerts') {
    if (!$BrevoCredentialFile -or !$SenderEmail -or !$AppOrigin) {
      throw 'Missing security alert settings'
    }
    $brevo = Import-Clixml -LiteralPath $BrevoCredentialFile
    if ($brevo -isnot [pscredential]) { throw 'Invalid Brevo credential file' }
    $script = 'security-alert-worker.mjs'
    $environment['SECURITY_ALERT_SUPABASE_URL'] = $SupabaseUrl.AbsoluteUri
    $environment['SECURITY_ALERT_SERVICE_KEY'] = $credential.GetNetworkCredential().Password
    $environment['BREVO_API_KEY'] = $brevo.GetNetworkCredential().Password
    $environment['BREVO_SENDER_EMAIL'] = $SenderEmail
    $environment['APP_ORIGIN'] = $AppOrigin.AbsoluteUri
  } else {
    $script = 'security-monitor.mjs'
    $environment['SECURITY_MONITOR_SUPABASE_URL'] = $SupabaseUrl.AbsoluteUri
    $environment['SECURITY_MONITOR_SERVICE_KEY'] = $credential.GetNetworkCredential().Password
  }
  $previous = @{}
  foreach ($name in $environment.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process')
  }
  & node (Join-Path $PSScriptRoot $script) *> $null
  $exitCode = $LASTEXITCODE
} catch {
  # Do not log exception objects, paths, environment values, or provider output.
  $exitCode = 1
} finally {
  if ($previous) {
    foreach ($name in $previous.Keys) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
  }
}

$timestamp = [DateTimeOffset]::UtcNow.ToString('o')
$status = if ($exitCode -eq 0) { 'ok' } else { 'failed' }
try {
  Add-Content -LiteralPath $LogFile -Value "$timestamp ${Kind}=$status exit=$exitCode"
} catch {
  Write-Error 'Monitor status log is unavailable.' -ErrorAction Continue
  exit 1
}
exit $exitCode
