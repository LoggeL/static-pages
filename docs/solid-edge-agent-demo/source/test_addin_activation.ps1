$ErrorActionPreference = "Stop"

$classId = [Guid]"D2D70C23-11EE-4A75-9080-C286A4BC15A6"
$type = [Type]::GetTypeFromCLSID($classId, $true)
Write-Output "COM_TYPE=$($type.FullName)|guid=$($type.GUID)"
$instance = [Activator]::CreateInstance($type)
Write-Output "COM_INSTANCE=$($instance.GetType().FullName)|assembly=$($instance.GetType().Assembly.FullName)"
