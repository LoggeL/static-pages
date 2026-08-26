$ErrorActionPreference = "Stop"

$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$programDirectory = "C:\Program Files\Siemens\Solid Edge 2026\Program"
$outputDirectory = Join-Path $env:LOCALAPPDATA "iV-Connect\SolidEdgeAddIn"
$outputFile = Join-Path $outputDirectory "IV.SolidEdge.AddIn.dll"
$sourceFile = "Z:\tooling\solid-edge\IVSolidEdgeAddIn.cs"
$resourceCompiler = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\rc.exe"
$resourceFile = Join-Path $outputDirectory "addin.res"

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "Z:\tooling\solid-edge\generate_addin_resources.ps1" -OutputDirectory $outputDirectory
if ($LASTEXITCODE -ne 0) {
    throw "Add-in resource generation failed with exit code $LASTEXITCODE."
}
Copy-Item -LiteralPath "Z:\tooling\solid-edge\addin.rc" -Destination (Join-Path $outputDirectory "addin.rc") -Force
Push-Location $outputDirectory
try {
    & $resourceCompiler /nologo "/fo$resourceFile" "addin.rc"
    if ($LASTEXITCODE -ne 0) {
        throw "Win32 resource compilation failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

$references = @(
    "Microsoft.CSharp.dll",
    "System.Windows.Forms.dll",
    "System.Drawing.dll",
    "System.Web.Extensions.dll",
    (Join-Path $programDirectory "Interop.SolidEdgeFrameworkLib.dll"),
    (Join-Path $programDirectory "Interop.SolidEdgeConstantLib.dll")
)

$arguments = @(
    "/nologo",
    "/target:library",
    "/platform:anycpu",
    "/win32res:$resourceFile",
    "/out:$outputFile"
)
$arguments += $references | ForEach-Object { "/reference:$_" }
$arguments += $sourceFile

& $compiler $arguments
if ($LASTEXITCODE -ne 0) {
    throw "C# add-in compilation failed with exit code $LASTEXITCODE."
}

foreach ($reference in $references | Where-Object { $_ -like "C:\*" }) {
    Copy-Item -LiteralPath $reference -Destination $outputDirectory -Force
}

Write-Output "BUILT=$outputFile"
