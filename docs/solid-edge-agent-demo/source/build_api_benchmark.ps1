$ErrorActionPreference = "Stop"

$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$programDirectory = "C:\Program Files\Siemens\Solid Edge 2026\Program"
$toolDirectory = "C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\tools\api-benchmark"
$outputFile = Join-Path $toolDirectory "IV.SolidEdge.ApiBenchmark.exe"
$sourceFile = "Z:\tooling\solid-edge\SolidEdgeApiBenchmark.cs"
$startModeOutputFile = Join-Path $toolDirectory "IV.SolidEdge.StartModeBenchmark.exe"
$startModeSourceFile = "Z:\tooling\solid-edge\SolidEdgeStartModeBenchmark.cs"

New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null

$references = @(
    "Microsoft.CSharp.dll",
    "System.Core.dll",
    "System.Web.Extensions.dll",
    (Join-Path $programDirectory "Interop.SolidEdgeFrameworkLib.dll"),
    (Join-Path $programDirectory "Interop.SolidEdgeAssemblyLib.dll"),
    (Join-Path $programDirectory "Interop.SolidEdgePropAutoLib.dll"),
    (Join-Path $programDirectory "Interop.SolidEdgeRevisionManagerLib.dll")
)

foreach ($reference in $references | Where-Object { $_ -like "C:\*" }) {
    if (-not (Test-Path -LiteralPath $reference)) {
        throw "Required build reference is missing: $reference"
    }
}

$arguments = @(
    "/nologo",
    "/target:exe",
    "/platform:x64",
    "/optimize+",
    "/out:$outputFile"
)
$arguments += $references | ForEach-Object { "/reference:$_" }
$arguments += $sourceFile

& $compiler $arguments
if ($LASTEXITCODE -ne 0) {
    throw "C# compilation failed with exit code $LASTEXITCODE."
}

$startModeArguments = @(
    "/nologo",
    "/target:exe",
    "/platform:x64",
    "/optimize+",
    "/out:$startModeOutputFile",
    "/reference:Microsoft.CSharp.dll",
    "/reference:System.Core.dll",
    "/reference:System.Web.Extensions.dll",
    $startModeSourceFile
)
& $compiler $startModeArguments
if ($LASTEXITCODE -ne 0) {
    throw "Start-mode benchmark compilation failed with exit code $LASTEXITCODE."
}

foreach ($reference in $references | Where-Object { $_ -like "C:\*" }) {
    Copy-Item -LiteralPath $reference -Destination $toolDirectory -Force
}

Write-Output "BUILT=$outputFile"
Write-Output "BUILT=$startModeOutputFile"
