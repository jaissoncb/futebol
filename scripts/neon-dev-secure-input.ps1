$ErrorActionPreference = 'Stop'
$taskRoot = 'D:\Projetos\Futebol'
Write-Host 'Futebol Neon DEV — conexão temporária em memória, sem arquivos de credenciais.'
Write-Host 'No console Neon: projeto futebol-dev-20261018, branch dev, banco futebol_dev, role futebol_dev_owner.'
Write-Host 'Copie a connection string PostgreSQL para o campo oculto abaixo. Não cole no chat.'
$taskSecret = Read-Host 'Connection string DEV (entrada oculta)' -AsSecureString
$taskPointer = [IntPtr]::Zero
try {
    $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
    $taskConnection = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
    $taskStart = [Diagnostics.ProcessStartInfo]::new()
    $taskStart.FileName = (Get-Command node).Source
    $taskStart.WorkingDirectory = $taskRoot
    $taskStart.ArgumentList.Add('--experimental-strip-types')
    $taskStart.ArgumentList.Add('scripts/test-neon-dev.ts')
    $taskStart.UseShellExecute = $false
    $taskStart.RedirectStandardInput = $true
    $taskProcess = [Diagnostics.Process]::Start($taskStart)
    $taskProcess.StandardInput.Write($taskConnection)
    $taskProcess.StandardInput.Close()
    $taskConnection = $null
    $taskProcess.WaitForExit()
    Write-Host ('Runner encerrado. Exit code: ' + $taskProcess.ExitCode)
} finally {
    if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
    $taskSecret.Dispose()
    Remove-Variable taskConnection -ErrorAction SilentlyContinue
}
Read-Host 'Pressione Enter para fechar esta janela'
