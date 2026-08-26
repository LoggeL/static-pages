$ErrorActionPreference = "Stop"

$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$programDirectory = "C:\Program Files\Siemens\Solid Edge 2026\Program"
$outputDirectory = "C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\tools"
$outputFile = Join-Path $outputDirectory "IV.SolidEdge.LargeAssemblyDemo.exe"
$sourceFile = "Z:\tooling\solid-edge\SolidEdgeLargeAssemblyDemo.cs"

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$references = @(
    "Microsoft.CSharp.dll",
    "System.Core.dll",
    "System.Web.Extensions.dll",
    (Join-Path $programDirectory "Interop.SolidEdgeFrameworkLib.dll"),
    (Join-Path $programDirectory "Interop.SolidEdgePartLib.dll"),
    (Join-Path $programDirectory "Interop.SolidEdgeAssemblyLib.dll"),
    (Join-Path $programDirectory "Interop.SolidEdgeDraftLib.dll"),
    (Join-Path $programDirectory "Interop.SolidEdgeConstantLib.dll"),
    (Join-Path $programDirectory "Interop.SolidEdgeRevisionManagerLib.dll")
)

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

foreach ($reference in $references | Where-Object { $_ -like "C:\*" }) {
    Copy-Item -LiteralPath $reference -Destination $outputDirectory -Force
}

Write-Output "BUILT=$outputFile"
