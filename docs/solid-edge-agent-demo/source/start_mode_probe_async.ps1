param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("interactive_normal", "interactive_file_open", "automation_spawned")]
    [string]$StartMode,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9-]+$')]
    [string]$RunId,

    [ValidateRange(1, 100)]
    [int]$Iteration = 1
)

$ErrorActionPreference = "Stop"

$demoRoot = "C:\Users\iv-dev\Documents\IV-SolidEdge-Demo"
$fixture = Join-Path $demoRoot "large-api-benchmark-fixture\IV_InnovaVento_Oven_Factory_Benchmark.asm"
$manifestPath = "Z:\output\solid-edge-large-assembly\fixture-manifest.json"
$benchmark = Join-Path $demoRoot "tools\api-benchmark\IV.SolidEdge.StartModeBenchmark.exe"
$edgePath = "C:\Program Files\Siemens\Solid Edge 2026\Program\Edge.exe"
$outputDirectory = Join-Path $demoRoot "large-api-benchmark-output\start-mode-isolated"
$resultPath = Join-Path $outputDirectory "$StartMode-$Iteration.json"

foreach ($requiredPath in @($fixture, $manifestPath, $benchmark, $edgePath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required isolated start-mode input is missing: $requiredPath"
    }
}
if (Get-Process -Name Edge -ErrorAction SilentlyContinue) {
    throw "Isolated application-cold preflight requires zero Edge.exe processes."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (-not [String]::Equals([string]$manifest.run_id, $RunId, [StringComparison]::Ordinal)) {
    throw "Fixture manifest run_id does not match: manifest=$($manifest.run_id); requested=$RunId"
}
$expectedOccurrences = [int]$manifest.expanded_occurrences
if ($expectedOccurrences -lt 1) {
    throw "Fixture manifest has no valid expanded_occurrences count."
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue

function Quote-Argument([string]$Value) {
    return '"' + $Value.Replace('"', '\"') + '"'
}

$arguments = @(
    (Quote-Argument $fixture),
    (Quote-Argument $resultPath),
    (Quote-Argument $RunId),
    (Quote-Argument $StartMode),
    ([string]$Iteration),
    ([string]$expectedOccurrences),
    (Quote-Argument $edgePath)
)
$process = Start-Process -FilePath $benchmark -ArgumentList $arguments -PassThru

[ordered]@{
    schema_version = 1
    launched_at_utc = [DateTime]::UtcNow.ToString("o")
    launcher_process_id = $PID
    probe_process_id = $process.Id
    session_id = $process.SessionId
    start_mode = $StartMode
    iteration = $Iteration
    result_path = $resultPath
    expected_occurrences = $expectedOccurrences
} | ConvertTo-Json -Compress
