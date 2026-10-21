param([switch]$Deploy)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCandidate = Join-Path $taskRoot '.local-backup/neon-functions-20261019/candidate-WRWZHz/function.zip'
$taskDigest = '510bf79183fa4025d5ceb36849606b22cf845b4541d732888270cb98dc71202e'
if ((Get-FileHash -LiteralPath $taskCandidate -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskDigest) { throw 'Candidato local divergente; envio bloqueado.' }
Write-Host 'Destino: org-steep-math-64054637 / ancient-wildflower-55433050 / br-shiny-dust-bastckar / futebolapi'
Write-Host 'Plano: Free / US$0. Efeito futuro: publicar o ZIP e substituir as duas URLs pelo login futebol_api_dev_functions.'
Write-Host ('SHA256: ' + $taskDigest)
if (-not $Deploy) { Write-Host 'Somente preparação local. Nenhuma credencial solicitada ou chamada de rede realizada.'; return }
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Use PowerShell 7.' }
if ((Get-Location).Path -ne $taskRoot -or (Convert-Path -LiteralPath (git rev-parse --show-toplevel)) -ne $taskRoot -or (git branch --show-current) -ne 'codex/dev-kinde-neon') { throw 'Diretório/branch incorreto; envio bloqueado.' }
if ((Read-Host 'Somente após autorização no chat e login restrito pronto: digite DEPLOY DEV futebolapi') -cne 'DEPLOY DEV futebolapi') { throw 'Envio não autorizado.' }
Write-Host 'Digite os valores nos campos ocultos. Não use clipboard, transcript, .env ou argumentos contendo valores.'
$taskPassword = $null; $taskApiKey = $null; $taskPasswordPointer = [IntPtr]::Zero; $taskKeyPointer = [IntPtr]::Zero
try {
    $taskPassword = Read-Host 'Senha do login restrito futebol_api_dev_functions' -AsSecureString
    $taskApiKey = Read-Host 'Credencial de gestão Neon autorizada para este destino (nunca vai à Function)' -AsSecureString
    $taskPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskPassword)
    $taskKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskApiKey)
    $taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'deployment/neon-dev.runtime-config.json') -Raw | ConvertFrom-Json
    $taskConfig.database.runtimeRole = 'futebol_api_dev_functions'
    $taskPayload = @{config=$taskConfig;password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPasswordPointer);apiKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskKeyPointer)} | ConvertTo-Json -Depth 8 -Compress
    $taskStart = [Diagnostics.ProcessStartInfo]::new()
    $taskStart.FileName = (Get-Command node -CommandType Application).Source
    $taskStart.WorkingDirectory = $taskRoot
    $taskStart.UseShellExecute = $false
    $taskStart.RedirectStandardInput = $true
    $taskStart.ArgumentList.Add('scripts/send-neon-dev-upload.mjs')
    $taskStart.ArgumentList.Add('--send')
    $taskStart.Environment.Clear()
    foreach ($taskVariable in @('SystemRoot','WINDIR','TEMP','TMP')) {
        $taskValue = [Environment]::GetEnvironmentVariable($taskVariable)
        if ($taskValue) { $taskStart.Environment[$taskVariable] = $taskValue }
    }
    $taskProcess = [Diagnostics.Process]::Start($taskStart)
    $taskProcess.StandardInput.Write($taskPayload)
    $taskProcess.StandardInput.Close()
    $taskPayload = $null
    $taskProcess.WaitForExit()
    if ($taskProcess.ExitCode -ne 0) { throw 'Envio não confirmado. Verifique o Console antes de qualquer repetição.' }
    Write-Host 'Pedido aceito; conferir conclusão no Console. Isso não é PASS do smoke DEV.'
} finally {
    $taskPayload = $null
    if ($taskPasswordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPasswordPointer) }
    if ($taskKeyPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskKeyPointer) }
    if ($null -ne $taskPassword) { $taskPassword.Dispose() }
    if ($null -ne $taskApiKey) { $taskApiKey.Dispose() }
}
