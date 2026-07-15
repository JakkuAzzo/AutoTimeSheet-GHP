[CmdletBinding()]
param(
    [switch]$Exchange,
    [switch]$Graph,
    [switch]$SharePoint,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'

if (-not ($Exchange -or $Graph -or $SharePoint)) {
    $Exchange = $Graph = $SharePoint = $true
}

if ($ValidateOnly) {
    foreach ($moduleName in 'ExchangeOnlineManagement', 'Microsoft.Graph.Authentication', 'PnP.PowerShell') {
        $installed = Get-Module -ListAvailable -Name $moduleName | Select-Object -First 1
        if ($installed) {
            Write-Host "$moduleName $($installed.Version) is installed."
        } else {
            Write-Host "$moduleName is not installed."
        }
    }
    return
}

if ($Exchange) {
    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        Write-Host 'Install ExchangeOnlineManagement first:'
        Write-Host '  Install-PSResource ExchangeOnlineManagement -Scope CurrentUser'
    } else {
        Connect-ExchangeOnline -ShowBanner:$false
        Write-Host 'Exchange Online connected.'
    }
}

if ($Graph) {
    if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
        Write-Host 'Install Microsoft.Graph first:'
        Write-Host '  Install-PSResource Microsoft.Graph -Scope CurrentUser'
    } else {
        Connect-MgGraph -Scopes 'Calendars.ReadWrite','Group.ReadWrite.All','Sites.ReadWrite.All'
        Write-Host 'Microsoft Graph connected with delegated permissions.'
    }
}

if ($SharePoint) {
    if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
        Write-Host 'Install PnP.PowerShell first:'
        Write-Host '  Install-PSResource PnP.PowerShell -Scope CurrentUser'
    } else {
        Write-Host 'PnP.PowerShell requires an approved Entra app client ID for interactive authentication.'
        Write-Host 'Use: Connect-PnPOnline -Url https://gmtelectservsltd.sharepoint.com/sites/GMTWeb-App -Interactive -ClientId <approved-client-id>'
    }
}
