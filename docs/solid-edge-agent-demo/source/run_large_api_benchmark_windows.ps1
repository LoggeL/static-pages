param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9-]+$')]
    [string]$RunId,

    [ValidateRange(1, 100)]
    [int]$Iterations = 10,

    [ValidateRange(0, 20)]
    [int]$Warmups = 2,

    [ValidateRange(0, 20)]
    [int]$ColdIterations = 0,

    [switch]$AllowApplicationRestart
)

$ErrorActionPreference = "Stop"

$demoRoot = "C:\Users\iv-dev\Documents\IV-SolidEdge-Demo"
$runDirectory = Join-Path $demoRoot "large-assembly-demo\runs\$RunId"
$sourceDirectory = Join-Path $runDirectory "runtime-snapshot"
$activeSource = Join-Path $runDirectory "IV_InnovaVento_Oven_Factory.asm"
$manifestPath = "Z:\output\solid-edge-large-assembly\fixture-manifest.json"
$fixtureDirectory = Join-Path $demoRoot "large-api-benchmark-fixture"
$fixture = Join-Path $fixtureDirectory "IV_InnovaVento_Oven_Factory_Benchmark.asm"
$outputDirectory = Join-Path $demoRoot "large-api-benchmark-output"
$benchmark = Join-Path $demoRoot "tools\api-benchmark\IV.SolidEdge.ApiBenchmark.exe"
$startModeBenchmark = Join-Path $demoRoot "tools\api-benchmark\IV.SolidEdge.StartModeBenchmark.exe"
$edgePath = "C:\Program Files\Siemens\Solid Edge 2026\Program\Edge.exe"

foreach ($requiredPath in @($sourceDirectory, $activeSource, $manifestPath, $benchmark)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required benchmark input is missing: $requiredPath"
    }
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (-not [String]::Equals([string]$manifest.run_id, $RunId, [StringComparison]::Ordinal)) {
    throw "Fixture manifest run_id does not match the requested run: manifest=$($manifest.run_id); requested=$RunId"
}
$expectedOccurrences = [int]$manifest.expanded_occurrences
if ($expectedOccurrences -lt 1) { throw "Fixture manifest has no valid expanded_occurrences count." }
if ($ColdIterations -gt 0 -and -not $AllowApplicationRestart) {
    throw "Cold iterations require the explicit -AllowApplicationRestart switch."
}
if ($ColdIterations -gt 0) {
    foreach ($requiredPath in @($startModeBenchmark, $edgePath)) {
        if (-not (Test-Path -LiteralPath $requiredPath)) {
            throw "Required cold-start benchmark input is missing: $requiredPath"
        }
    }
}

Remove-Item -LiteralPath $fixtureDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $fixtureDirectory | Out-Null
Get-ChildItem -LiteralPath $sourceDirectory -File |
    Where-Object { $_.Extension -in @('.asm', '.par') } |
    Copy-Item -Destination $fixtureDirectory -Force

$sourceRoot = Join-Path $fixtureDirectory "IV_InnovaVento_Oven_Factory.asm"
if (-not (Test-Path -LiteralPath $sourceRoot)) {
    throw "Staged root assembly is missing: $sourceRoot"
}
Rename-Item -LiteralPath $sourceRoot -NewName (Split-Path -Leaf $fixture)

Remove-Item -LiteralPath $outputDirectory -Recurse -Force -ErrorAction SilentlyContinue
& $benchmark $fixture $outputDirectory $Iterations $Warmups $activeSource
$benchmarkExit = $LASTEXITCODE

if ($ColdIterations -gt 0) {
    $application = [Runtime.InteropServices.Marshal]::GetActiveObject("SolidEdge.Application")
    $discardedGeneratedDemoState = @()
    for ($index = 1; $index -le $application.Documents.Count; $index++) {
        $document = $application.Documents.Item($index)
        try {
            $fullName = [string]$document.FullName
            if (-not $document.Saved) {
                $isGeneratedDemoState = -not [String]::IsNullOrWhiteSpace($fullName) -and
                    (Test-Path -LiteralPath $fullName) -and
                    ($fullName.StartsWith((Join-Path $demoRoot "oven-demo") + "\", [StringComparison]::OrdinalIgnoreCase) -or
                        $fullName.StartsWith((Join-Path $demoRoot "large-assembly-demo\runs") + "\", [StringComparison]::OrdinalIgnoreCase)) -and
                    ([IO.Path]::GetFileName($fullName).StartsWith("IV_", [StringComparison]::OrdinalIgnoreCase))
                if (-not $isGeneratedDemoState) {
                    throw "Refusing application-cold benchmark because an unsaved non-generated document is open: $fullName"
                }
                $discardedGeneratedDemoState += $fullName
            }
            if (-not $fullName.StartsWith($demoRoot + "\", [StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing application-cold benchmark because a document outside the isolated demo root is open: $fullName"
            }
        } finally {
            [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
        }
    }
    for ($index = $application.Documents.Count; $index -ge 1; $index--) {
        $document = $application.Documents.Item($index)
        try { $document.Close($false) }
        finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null }
    }
    if ($discardedGeneratedDemoState.Count -gt 0) {
        Write-Output "COLD_PREFLIGHT=discarded_generated_in_memory_state|count=$($discardedGeneratedDemoState.Count)"
    }
    $application.Quit()
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($application) | Out-Null

    $quitDeadline = [DateTime]::UtcNow.AddSeconds(45)
    while ((Get-Process -Name Edge -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $quitDeadline) {
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Name Edge -ErrorAction SilentlyContinue) {
        throw "Solid Edge did not exit cleanly before the application-cold series; no forced termination was used."
    }

    $startModeDirectory = Join-Path $outputDirectory "start-mode-raw"
    New-Item -ItemType Directory -Force -Path $startModeDirectory | Out-Null
    $startModeExit = 0
    foreach ($startMode in @("interactive_normal", "interactive_file_open", "automation_spawned")) {
        for ($iteration = 1; $iteration -le $ColdIterations; $iteration++) {
            $resultPath = Join-Path $startModeDirectory "$startMode-$iteration.json"
            & $startModeBenchmark $fixture $resultPath $RunId $startMode $iteration $expectedOccurrences $edgePath
            if ($LASTEXITCODE -ne 0) { $startModeExit = 2 }
            if (-not (Test-Path -LiteralPath $resultPath)) {
                throw "Start-mode probe did not preserve a result file: $resultPath"
            }
            $probe = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
            if (-not $probe.cleanup.edge_exit_observed) {
                throw "Start-mode probe did not release its owned Edge.exe process; aborting the cold series."
            }
        }
    }

    $startModeRuns = @(Get-ChildItem -LiteralPath $startModeDirectory -Filter "*.json" -File |
        Sort-Object Name |
        ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json })
    $startModeRuns | ConvertTo-Json -Depth 12 |
        Set-Content -LiteralPath (Join-Path $outputDirectory "api-start-mode-runs.json") -Encoding UTF8

    $flatRuns = foreach ($run in $startModeRuns) {
        [pscustomobject]@{
            run_id = $run.run_id
            start_mode = $run.start_mode
            iteration = $run.iteration
            success = $run.success
            fixture_sha256 = $run.fixture_sha256
            application_ready_ms = $run.timings_ms.application_ready_ms
            document_ready_ms = $run.timings_ms.document_ready_ms
            occurrence_read_ms = $run.timings_ms.occurrence_read_ms
            addin_ready_observed_ms = $run.timings_ms.addin_ready_observed_ms
            total_ms = $run.timings_ms.total_ms
            actual_occurrences = $run.actual_occurrences
            addin_status = $run.addin.status
            error_stage = $run.error_stage
            error_type = $run.error_type
            error_message = $run.error_message
        }
    }
    $flatRuns | ConvertTo-Csv -NoTypeInformation |
        Set-Content -LiteralPath (Join-Path $outputDirectory "api-start-mode-runs.csv") -Encoding UTF8

    function Get-Percentile([double[]]$Values, [double]$Percentile) {
        if ($Values.Count -eq 0) { return $null }
        $sorted = @($Values | Sort-Object)
        $rank = [Math]::Max(1, [Math]::Ceiling($Percentile * $sorted.Count))
        return [double]$sorted[$rank - 1]
    }
    function Get-MetricSummary($Runs, [string]$Metric, [string]$RequiredStage) {
        $valid = @($Runs | Where-Object {
            (($RequiredStage -eq "success" -and $_.success) -or
                ($RequiredStage -ne "success" -and $_.stages.$RequiredStage)) -and
                $null -ne $_.timings_ms.$Metric
        })
        $values = [double[]]@($valid | ForEach-Object { [double]$_.timings_ms.$Metric })
        $mean = if ($values.Count -eq 0) { $null } else { ($values | Measure-Object -Average).Average }
        $variance = if ($values.Count -eq 0) { $null } else {
            (($values | ForEach-Object { [Math]::Pow($_ - $mean, 2) } | Measure-Object -Sum).Sum / $values.Count)
        }
        return [ordered]@{
            metric = $Metric
            attempts = @($Runs).Count
            successes = $values.Count
            failures = @($Runs).Count - $values.Count
            p50_ms = Get-Percentile $values 0.50
            p90_ms = Get-Percentile $values 0.90
            p95_ms = Get-Percentile $values 0.95
            max_ms = if ($values.Count -eq 0) { $null } else { ($values | Measure-Object -Maximum).Maximum }
            coefficient_of_variation = if ($null -eq $mean -or $mean -eq 0) { $null } else { [Math]::Sqrt($variance) / $mean }
        }
    }

    $summaries = foreach ($group in ($startModeRuns | Group-Object start_mode)) {
        [ordered]@{
            start_mode = $group.Name
            warm_state = "cold"
            sample_count = $group.Count
            metrics = @(
                Get-MetricSummary $group.Group "application_ready_ms" "application_ready"
                Get-MetricSummary $group.Group "document_ready_ms" "document_ready"
                Get-MetricSummary $group.Group "occurrence_read_ms" "structure_valid"
                Get-MetricSummary $group.Group "addin_ready_observed_ms" "addin_ready"
                Get-MetricSummary $group.Group "total_ms" "success"
            )
        }
    }
    [ordered]@{
        schema_version = 1
        run_id = $RunId
        generated_at_utc = [DateTime]::UtcNow.ToString("o")
        fixture_path = $fixture
        fixture_sha256 = ($startModeRuns | Select-Object -First 1).fixture_sha256
        percentile_method = "nearest_rank"
        summaries = @($summaries)
    } | ConvertTo-Json -Depth 12 |
        Set-Content -LiteralPath (Join-Path $outputDirectory "api-start-mode-summary.json") -Encoding UTF8

    [ordered]@{
        schema_version = 1
        run_id = $RunId
        captured_at_utc = [DateTime]::UtcNow.ToString("o")
        definition = "Application-cold means zero Edge.exe processes before every sample; this is not an OS-cold or filesystem-cache-cold measurement."
        start_modes = @("interactive_normal", "interactive_file_open", "automation_spawned")
        samples_per_start_mode = $ColdIterations
        addin_ready_observation = "First new 'Registered command bar enabled' marker detected by a 20 ms background file observer, cross-checked against AddIn.Connect and at least two iV-Connect command captions."
        forced_termination_allowed = $false
        os_cold_measured = $false
        timing_fields_not_supported = @("native_ms", "transport_ms", "end_to_end_ms split without in-process instrumentation")
    } | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (Join-Path $outputDirectory "api-start-mode-environment.json") -Encoding UTF8
}

if (Test-Path -LiteralPath $outputDirectory) {
    & "Z:\tooling\solid-edge\inspect_file_apis.ps1" |
        Set-Content -LiteralPath (Join-Path $outputDirectory "api-contracts.txt") -Encoding UTF8
}

if ($ColdIterations -gt 0 -and $startModeExit -ne 0) { exit $startModeExit }
exit $benchmarkExit
