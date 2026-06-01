# Maps sg-help-admin.test -> 127.0.0.1 in the Windows hosts file.
# Run from an ELEVATED (Administrator) terminal:  make hosts
$ErrorActionPreference = 'Stop'

$domain    = 'sg-help-admin.test'
$ip        = '127.0.0.1'
$hostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Warning "Editing $hostsPath requires Administrator rights."
  Write-Host    "Re-open your terminal as Administrator, then run:  make hosts"
  exit 1
}

if (Select-String -Path $hostsPath -Pattern $domain -SimpleMatch -Quiet) {
  Write-Host "[hosts] '$domain' is already mapped in $hostsPath - nothing to do."
  exit 0
}

Add-Content -Path $hostsPath -Value "`r`n$ip`t$domain"
Write-Host "[hosts] Added '$ip $domain' to $hostsPath."
Write-Host "[hosts] Dashboard: http://$domain`:5173   API: http://$domain`:3001"
