param([ValidateSet('test','api')][string]$Mode = 'test')
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = ('Futebol Neon DEV — ' + $Mode)
$taskRoot = 'D:\Projetos\Futebol'
Write-Host 'Futebol Neon DEV — conexão temporária em memória, sem arquivos de credenciais.'
Write-Host ('Modo: ' + $Mode)
Write-Host 'No console Neon: projeto futebol-dev-20261018, branch dev, banco futebol_dev, role futebol_dev_owner.'
Write-Host 'Copie a connection string PostgreSQL para o campo oculto abaixo. Não cole no chat.'
$taskSecret = Read-Host 'Connection string DEV (entrada oculta)' -AsSecureString
$taskPointer = [IntPtr]::Zero
$taskMutex = [Threading.Mutex]::new($false, 'Local\FutebolNeonDevSecretRunner')
$taskLockHeld = $false
try {
    try { $taskLockHeld = $taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $taskLockHeld = $true }
    if (-not $taskLockHeld) { throw 'Outro runner Futebol Neon DEV está ativo; nenhuma operação foi iniciada.' }
    $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
    $taskConnection = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
    $taskStart = [Diagnostics.ProcessStartInfo]::new()
    $taskStart.FileName = (Get-Command node).Source
    $taskStart.WorkingDirectory = $taskRoot
    $taskStart.ArgumentList.Add('--experimental-strip-types')
    $taskStart.ArgumentList.Add($(if($Mode -eq 'api'){'scripts/start-neon-dev.ts'}else{'scripts/test-neon-dev.ts'}))
    $taskStart.UseShellExecute = $false
    $taskStart.RedirectStandardInput = $true
    $taskProcess = [Diagnostics.Process]::Start($taskStart)
    $taskProcess.StandardInput.Write($taskConnection)
    $taskProcess.StandardInput.Close()
    $taskConnection = $null
    $taskProcess.WaitForExit()
    Write-Host ('Runner encerrado. Exit code: ' + $taskProcess.ExitCode)
} finally {
    if ($taskLockHeld) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
    if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
    $taskSecret.Dispose()
    Remove-Variable taskConnection -ErrorAction SilentlyContinue
}
$taskCloseInput = Read-Host 'Pressione Enter para fechar esta janela' -AsSecureString
$taskCloseInput.Dispose()
