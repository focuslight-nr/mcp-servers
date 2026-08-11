[CmdletBinding()]
param(
    [string]$TaskName = 'Check Point Baseline Audit',
    [Parameter(Mandatory = $true)][string]$WrapperPath,
    [Parameter(Mandatory = $true)][string]$DeploymentConfigPath,
    [Parameter(Mandatory = $true)][string]$ServiceAccount,
    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string]$DailyAt = '02:00'
)

$ErrorActionPreference = 'Stop'
$wrapper = (Resolve-Path -LiteralPath $WrapperPath).Path
$deployment = (Resolve-Path -LiteralPath $DeploymentConfigPath).Path
$startTime = [DateTime]::ParseExact($DailyAt, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$arguments = "-NoProfile -NonInteractive -File `"$wrapper`" -DeploymentConfigPath `"$deployment`""

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $startTime
$principal = New-ScheduledTaskPrincipal `
    -UserId $ServiceAccount `
    -LogonType ServiceAccount `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Scheduled read-only Check Point security baseline audit' `
    -Force
