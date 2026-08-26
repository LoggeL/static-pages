$ErrorActionPreference = "Stop"

$application = [Runtime.InteropServices.Marshal]::GetActiveObject("SolidEdge.Application")
$documents = $application.Documents

Write-Output "APPLICATION=$($application.Name)|$($application.Version)|visible=$($application.Visible)"
Write-Output "COUNT=$($documents.Count)"

try {
    $activeDocument = $application.ActiveDocument
    Write-Output "ACTIVE=$($activeDocument.Name)|$($activeDocument.FullName)|$($activeDocument.Type)"
}
catch {
    Write-Output "ACTIVE_ERROR=$($_.Exception.Message)"
}

for ($index = 1; $index -le $documents.Count; $index++) {
    try {
        $document = $documents.Item($index)
        Write-Output "DOCUMENT=$index|$($document.Name)|$($document.FullName)|$($document.Type)"
    }
    catch {
        Write-Output "DOCUMENT_ERROR=$index|$($_.Exception.Message)"
    }
}

$demoPartPath = "C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\IV_Demo_Block.par"
Write-Output "DEMO_PART_EXISTS=$(Test-Path -LiteralPath $demoPartPath)"
