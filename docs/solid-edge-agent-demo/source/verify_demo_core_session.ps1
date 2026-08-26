[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:18000",
    [string]$TokenEnvironmentVariable = "IV_CONNECT_PILOT_API_BEARER_TOKEN"
)

$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd("/")
$token = [Environment]::GetEnvironmentVariable($TokenEnvironmentVariable, "User")
if ([string]::IsNullOrWhiteSpace($token)) {
    throw "The configured user-scoped Platform API token is missing."
}

$headers = @{
    Authorization = "Bearer $token"
    "X-IV-User" = "windows-vm-e2e"
}
$query = "role=operator&user_id=windows-vm-e2e&channel=desktop_installed"
$stopwatch = [Diagnostics.Stopwatch]::StartNew()

$health = Invoke-RestMethod -TimeoutSec 5 -Uri "$base/health"
$projection = Invoke-RestMethod -TimeoutSec 5 -Headers $headers -Uri "$base/api/v1/client/core-projection?$query"
$tasks = @(Invoke-RestMethod -TimeoutSec 5 -Headers $headers -Uri "$base/api/v1/client/tasks?$query&status=pending")
$bundles = @(Invoke-RestMethod -TimeoutSec 5 -Headers $headers -Uri "$base/api/v1/client/bundles?$query")

$correlationId = [guid]::NewGuid().ToString()
$ownerToken = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$ownershipHeaders = @{
    Authorization = $headers.Authorization
    "X-IV-User" = $headers["X-IV-User"]
    "X-IV-Project-Snapshot-Owner" = $ownerToken
}
$reservation = Invoke-RestMethod `
    -Method Post `
    -TimeoutSec 5 `
    -Headers $ownershipHeaders `
    -ContentType "application/json" `
    -Body (@{ correlation_id = $correlationId } | ConvertTo-Json -Compress) `
    -Uri "$base/api/v1/project-snapshot-flows/reservations"
$abandonment = Invoke-RestMethod `
    -Method Post `
    -TimeoutSec 5 `
    -Headers $ownershipHeaders `
    -Uri "$base/api/v1/project-snapshot-flows/$($reservation.flow_id)/abandon"

$negativeStatus = 0
try {
    Invoke-WebRequest `
        -UseBasicParsing `
        -TimeoutSec 5 `
        -Headers @{ Authorization = "Bearer deliberately-wrong-token"; "X-IV-User" = "negative-test" } `
        -Uri "$base/api/v1/client/core-projection?$query" | Out-Null
    $negativeStatus = 200
}
catch {
    if ($null -ne $_.Exception.Response) {
        $negativeStatus = [int]$_.Exception.Response.StatusCode
    }
    else {
        throw
    }
}

$stopwatch.Stop()
$passed = (
    $health.status -eq "ok" -and
    $projection.schema_version -eq "1.0" -and
    $reservation.phase -eq "reserved" -and
    $abandonment.accepted -eq $true -and
    $abandonment.phase -eq "abandoned" -and
    $negativeStatus -eq 401
)

[pscustomobject]@{
    passed = $passed
    elapsed_ms = $stopwatch.ElapsedMilliseconds
    health = $health.status
    platform_status = $projection.platform_status
    tasks_read = $true
    task_count = $tasks.Count
    bundles_read = $true
    bundle_count = $bundles.Count
    reservation_phase = $reservation.phase
    release_phase = $abandonment.phase
    negative_status = $negativeStatus
    credentials_logged = $false
} | ConvertTo-Json -Compress

if (-not $passed) {
    throw "Authenticated Mac Core to VM Runtime verification failed."
}
