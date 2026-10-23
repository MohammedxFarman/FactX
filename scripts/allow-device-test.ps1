param([Parameter(Mandatory=$true)][string]$WifiAddress)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resultPath = Join-Path $projectRoot 'data/device-test/firewall-status.json'
try {
    if ($WifiAddress -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') {
        throw 'Use the private IPv4 address of the testing Wi-Fi interface.'
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Administrator rights are required for this Windows Firewall rule.'
    }
    $address = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $WifiAddress
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
    $ruleName = 'FactX-Device-Test-TCP3003-' + $WifiAddress
    $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.Description -ne 'FactX isolated device rehearsal; local subnet only.') {
            throw 'An unrelated firewall rule already uses this name.'
        }
        Set-NetFirewallRule -Name $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Any -Protocol TCP -LocalPort 3003 -LocalAddress $WifiAddress -RemoteAddress LocalSubnet -InterfaceAlias $address.InterfaceAlias -Program $nodeExecutable | Out-Null
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName 'FactX device test (Wi-Fi TCP 3003)' -Description 'FactX isolated device rehearsal; local subnet only.' -Enabled True -Direction Inbound -Action Allow -Profile Any -Protocol TCP -LocalPort 3003 -LocalAddress $WifiAddress -RemoteAddress LocalSubnet -InterfaceAlias $address.InterfaceAlias -Program $nodeExecutable | Out-Null
    }
    @{ok=$true;rule=$ruleName;address=$WifiAddress;port=3003;interface=$address.InterfaceAlias} | ConvertTo-Json | Set-Content -LiteralPath $resultPath
} catch {
    @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $resultPath
    throw
}
