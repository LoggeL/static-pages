[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$ProjectPath
)

$ErrorActionPreference = "Stop"
$root = Join-Path ([Environment]::GetFolderPath("UserProfile")) "source\iv-connect-client-desktop"
$manifest = Join-Path $root "src-tauri\Cargo.toml"
$cargo = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".cargo\bin\cargo.exe"
$developerShell = "C:\BuildTools\Common7\Tools\Launch-VsDevShell.ps1"

if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "Staged client source is missing. Run stage_client_desktop_build.ps1 first."
}
if (-not (Test-Path -LiteralPath $developerShell -PathType Leaf)) {
    throw "Visual Studio developer shell is missing."
}

& $developerShell -Arch arm64 -HostArch amd64 -SkipAutomaticLocation
$env:PATH = "C:\BuildTools\VC\Tools\Llvm\bin;$env:PATH"
$env:IV_SOLID_EDGE_E2E_DOCUMENT = (Resolve-Path -LiteralPath $ProjectPath).Path
try {
    & $cargo test --manifest-path $manifest `
        real_solid_edge_snapshot_preserves_native_sources_and_verifies_exports `
        -- --ignored --nocapture
    if ($LASTEXITCODE -ne 0) {
        throw "Solid Edge ProjectSnapshot E2E failed."
    }
}
finally {
    Remove-Item Env:\IV_SOLID_EDGE_E2E_DOCUMENT -ErrorAction SilentlyContinue
}
