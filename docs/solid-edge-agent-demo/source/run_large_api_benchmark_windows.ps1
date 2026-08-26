param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9-]+$')]
    [string]$RunId,

    [ValidateRange(1, 100)]
    [int]$Iterations = 7,

    [ValidateRange(0, 20)]
    [int]$Warmups = 2
)

$ErrorActionPreference = "Stop"

$demoRoot = "C:\Users\iv-dev\Documents\IV-SolidEdge-Demo"
$runDirectory = Join-Path $demoRoot "large-assembly-demo\runs\$RunId"
$sourceDirectory = Join-Path $runDirectory "runtime-snapshot"
$activeSource = Join-Path $runDirectory "IV_InnovaVento_Oven_Factory.asm"
$fixtureDirectory = Join-Path $demoRoot "large-api-benchmark-fixture"
$fixture = Join-Path $fixtureDirectory "IV_InnovaVento_Oven_Factory_Benchmark.asm"
$outputDirectory = Join-Path $demoRoot "large-api-benchmark-output"
$benchmark = Join-Path $demoRoot "tools\api-benchmark\IV.SolidEdge.ApiBenchmark.exe"

foreach ($requiredPath in @($sourceDirectory, $activeSource, $benchmark)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required benchmark input is missing: $requiredPath"
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

if (Test-Path -LiteralPath $outputDirectory) {
    & "Z:\tooling\solid-edge\inspect_file_apis.ps1" |
        Set-Content -LiteralPath (Join-Path $outputDirectory "api-contracts.txt") -Encoding UTF8
}

exit $benchmarkExit
