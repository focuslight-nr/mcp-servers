[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DeploymentConfigPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function ConvertFrom-SecureValue {
    param([Parameter(Mandatory = $true)][Security.SecureString]$Value)
    return [Net.NetworkCredential]::new('', $Value).Password
}

function Set-ProcessEnvironment {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][AllowEmptyString()][string]$Value
    )
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Get-OptionalProperty {
    param(
        [Parameter(Mandatory = $true)][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

$deploymentPath = (Resolve-Path -LiteralPath $DeploymentConfigPath).Path
$deployment = Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json
$requiredProperties = @(
    'runnerConfigPath',
    'runnerPath',
    'nodePath',
    'logDirectory',
    'gaiaCredentialPath',
    'gaiaCredentialProfile',
    'gaiaAllowedTargets',
    'managementApiKeyPath',
    'managementHost'
)

foreach ($property in $requiredProperties) {
    if (-not $deployment.$property) {
        throw "Missing deployment configuration property: $property"
    }
}

if ($deployment.gaiaCredentialProfile -notmatch '^[A-Za-z0-9_-]+$') {
    throw 'gaiaCredentialProfile contains unsupported characters'
}

$runnerConfigPath = (Resolve-Path -LiteralPath $deployment.runnerConfigPath).Path
$runnerPath = (Resolve-Path -LiteralPath $deployment.runnerPath).Path
$nodePath = (Resolve-Path -LiteralPath $deployment.nodePath).Path
$gaiaCredentialPath = (Resolve-Path -LiteralPath $deployment.gaiaCredentialPath).Path
$managementApiKeyPath = (Resolve-Path -LiteralPath $deployment.managementApiKeyPath).Path
$profile = $deployment.gaiaCredentialProfile.ToUpperInvariant().Replace('-', '_')
$sensitiveNames = @(
    "GAIA_CREDENTIAL_${profile}_USERNAME",
    "GAIA_CREDENTIAL_${profile}_PASSWORD",
    'API_KEY',
    'BASELINE_AUDIT_WEBHOOK_URL'
)

$gaiaPassword = $null
$managementApiKey = $null
$webhookUrl = $null

try {
    $gaiaCredential = Import-Clixml -LiteralPath $gaiaCredentialPath
    if ($gaiaCredential -isnot [PSCredential]) {
        throw 'gaiaCredentialPath must contain an exported PSCredential'
    }
    $gaiaPassword = ConvertFrom-SecureValue $gaiaCredential.Password
    $managementSecureValue = Import-Clixml -LiteralPath $managementApiKeyPath
    if ($managementSecureValue -isnot [Security.SecureString]) {
        throw 'managementApiKeyPath must contain an exported SecureString'
    }
    $managementApiKey = ConvertFrom-SecureValue $managementSecureValue

    Set-ProcessEnvironment "GAIA_CREDENTIAL_${profile}_USERNAME" $gaiaCredential.UserName
    Set-ProcessEnvironment "GAIA_CREDENTIAL_${profile}_PASSWORD" $gaiaPassword
    Set-ProcessEnvironment 'GAIA_ALLOWED_TARGETS' $deployment.gaiaAllowedTargets
    Set-ProcessEnvironment 'API_KEY' $managementApiKey
    Set-ProcessEnvironment 'MANAGEMENT_HOST' $deployment.managementHost
    $managementPort = Get-OptionalProperty $deployment 'managementPort'
    if (-not $managementPort) { $managementPort = 443 }
    Set-ProcessEnvironment 'MANAGEMENT_PORT' ([string]$managementPort)

    $gaiaCaFile = Get-OptionalProperty $deployment 'gaiaCaFile'
    if ($gaiaCaFile) {
        Set-ProcessEnvironment "GAIA_CREDENTIAL_${profile}_CA_FILE" ((Resolve-Path -LiteralPath $gaiaCaFile).Path)
    }
    $auditStorePath = Get-OptionalProperty $deployment 'auditStorePath'
    if ($auditStorePath) {
        Set-ProcessEnvironment 'BASELINE_AUDIT_STORE_PATH' $auditStorePath
    }
    $webhookUrlPath = Get-OptionalProperty $deployment 'webhookUrlPath'
    if ($webhookUrlPath) {
        $webhookSecureValue = Import-Clixml -LiteralPath (Resolve-Path -LiteralPath $webhookUrlPath).Path
        if ($webhookSecureValue -isnot [Security.SecureString]) {
            throw 'webhookUrlPath must contain an exported SecureString'
        }
        $webhookUrl = ConvertFrom-SecureValue $webhookSecureValue
        Set-ProcessEnvironment 'BASELINE_AUDIT_WEBHOOK_URL' $webhookUrl
    }

    New-Item -ItemType Directory -Path $deployment.logDirectory -Force | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $logPath = Join-Path $deployment.logDirectory "baseline-audit-$timestamp.log"
    $output = & $nodePath $runnerPath run-once --config $runnerConfigPath 2>&1
    $runnerExitCode = $LASTEXITCODE
    $output | Tee-Object -FilePath $logPath
    exit $runnerExitCode
}
finally {
    foreach ($name in $sensitiveNames) {
        Set-ProcessEnvironment $name $null
    }
    $gaiaPassword = $null
    $managementApiKey = $null
    $webhookUrl = $null
}
