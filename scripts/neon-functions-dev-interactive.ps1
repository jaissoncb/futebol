param([switch]$CheckOnly, [switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
function Invoke-FutebolPrivatePipe([string]$taskScript, [string]$taskMode, [string]$taskInput) {
    $taskStart = [Diagnostics.ProcessStartInfo]::new()
    $taskStart.FileName = (Get-Command node -CommandType Application | Select-Object -First 1).Source
    $taskStart.WorkingDirectory = $taskRoot
    $taskStart.UseShellExecute = $false
    $taskStart.RedirectStandardInput = $true
    $taskStart.RedirectStandardOutput = $true
    $taskStart.RedirectStandardError = $true
    $taskStart.ArgumentList.Add($taskScript)
    $taskStart.ArgumentList.Add($taskMode)
    $taskStart.Environment.Clear()
    foreach ($taskName in @('SystemRoot','WINDIR','TEMP','TMP')) {
        $taskValue = [Environment]::GetEnvironmentVariable($taskName)
        if ($taskValue) { $taskStart.Environment[$taskName] = $taskValue }
    }
    $taskStart.Environment['FUTEBOL_OPERATOR_PIPE'] = 'v1'
    $taskProcess = $null
    try {
        $taskProcess = [Diagnostics.Process]::Start($taskStart)
        $taskOut = $taskProcess.StandardOutput.ReadToEndAsync()
        $taskErr = $taskProcess.StandardError.ReadToEndAsync()
        $taskProcess.StandardInput.Write($taskInput)
        $taskProcess.StandardInput.Close()
        $taskInput = $null
        $taskProcess.WaitForExit()
        $taskReply = $taskOut.GetAwaiter().GetResult() | ConvertFrom-Json
        [void]$taskErr.GetAwaiter().GetResult()
        if ($taskProcess.ExitCode -ne 0 -and $taskReply.status -notin @('existing_login_requires_password','login_created_verification_failed')) { throw 'Operação bloqueada; detalhes sensíveis suprimidos.' }
        return $taskReply
    } catch { throw 'Operação bloqueada; confira o status sanitizado. Nenhum reenvio automático.' }
    finally { $taskInput = $null; $taskReply = $null; if ($null -ne $taskProcess) { $taskProcess.Dispose() } }
}
function Get-FutebolPlain([Security.SecureString]$taskSecret) {
    $taskPointer = [IntPtr]::Zero
    try {
        $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
    } finally {
        if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
    }
}
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Use PowerShell 7 normal, sem administrador.' }
if ((Get-Location).Path -ne $taskRoot -or (Convert-Path -LiteralPath (git rev-parse --show-toplevel)) -ne $taskRoot -or (git branch --show-current) -ne 'codex/dev-kinde-neon') { throw 'Diretório/branch incorreto.' }
if ($IsWindows -and [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Feche esta janela e use PowerShell normal, sem administrador.' }
$taskPreflight = Invoke-FutebolPrivatePipe 'scripts/neon-functions-operator.mjs' '--check' ''
if ($taskPreflight.status -ne 'local_preflight_passed') { throw 'Preflight local falhou.' }
Write-Host 'Futebol DEV: ancient-wildflower-55433050 / br-shiny-dust-bastckar / Frankfurt / Free US$0.'
Write-Host 'ZIP aprovado e fontes conferidos. Sem migrations, testes de banco vazio ou acesso Kinde.'
if ($CheckOnly) { Write-Host 'Preflight local PASS. Nenhuma entrada de segredo ou rede.'; return }
if ($SelfTest) {
    $taskSyntheticAdmin = ConvertTo-SecureString 'postgresql://futebol_dev_owner:SYNTHETIC_ONLY@ep-small-voice-baiso0c9.c-8.eu-central-1.aws.neon.tech/futebol_dev?sslmode=verify-full' -AsPlainText -Force
    $taskSyntheticKey = ConvertTo-SecureString 'SYNTHETIC-management-key' -AsPlainText -Force
    try {
        $taskSynthetic = @{adminConnection=(Get-FutebolPlain $taskSyntheticAdmin);apiKey=(Get-FutebolPlain $taskSyntheticKey)} | ConvertTo-Json -Compress
        $taskValidation = Invoke-FutebolPrivatePipe 'scripts/neon-functions-operator.mjs' '--validate' $taskSynthetic
        if ($taskValidation.status -ne 'input_validated_locally' -or $taskValidation.network -ne $false) { throw 'Teste de pipe falhou.' }
    } finally { $taskSynthetic = $null; $taskSyntheticAdmin.Dispose(); $taskSyntheticKey.Dispose() }
    Write-Host 'SelfTest PASS: stdin/stdout privados, ambiente mínimo, entrada sintética, nenhuma rede.'
    return
}
$taskAdmin = $null; $taskKey = $null; $taskRuntime = $null; $taskPayload = $null; $taskReply = $null
try {
    Write-Host 'Entrada oculta: digite os valores; não use clipboard, transcript, chat, arquivos ou argumentos com segredos.'
    Write-Host 'A primeira fase recebe/valida localmente e PAUSA. Não há conexão remota automática.'
    $taskAdmin = Read-Host 'Conexão temporária futebol_dev / futebol_dev_owner' -AsSecureString
    $taskKey = Read-Host 'Chave Neon Project-scoped somente futebol-dev-20261018' -AsSecureString
    $taskPayload = @{adminConnection=(Get-FutebolPlain $taskAdmin);apiKey=(Get-FutebolPlain $taskKey)} | ConvertTo-Json -Compress
    $taskReply = Invoke-FutebolPrivatePipe 'scripts/neon-functions-operator.mjs' '--validate' $taskPayload
    $taskPayload = $null
    if ($taskReply.status -ne 'input_validated_locally') { throw 'Entrada inválida; nada enviado.' }
    Write-Host 'ENTRADA SEGURA PRONTA. Validação apenas local; chave/credenciais reais ainda não verificadas remotamente.'
    Write-Host 'Valores somente nesta janela em memória. Avise no chat: entrada pronta. Não informe valores.'
    $taskAction = Read-Host 'AGUARDE orientação. Para futura criação/verificação: PROVISIONAR DEV; qualquer outra entrada encerra sem rede'
    if ($taskAction -cne 'PROVISIONAR DEV') { return }
    $taskPayload = @{adminConnection=(Get-FutebolPlain $taskAdmin)} | ConvertTo-Json -Compress
    $taskReply = Invoke-FutebolPrivatePipe 'scripts/neon-functions-operator.mjs' '--provision' $taskPayload
    $taskPayload = $null
    if ($taskReply.status -eq 'existing_login_requires_password') {
        $taskRuntime = Read-Host 'Login já existe: senha restrita existente (não será rotacionada)' -AsSecureString
        $taskPayload = @{adminConnection=(Get-FutebolPlain $taskAdmin);runtimePassword=(Get-FutebolPlain $taskRuntime)} | ConvertTo-Json -Compress
        $taskReply = Invoke-FutebolPrivatePipe 'scripts/neon-functions-operator.mjs' '--provision' $taskPayload
        $taskPayload = $null; $taskRuntime.Dispose(); $taskRuntime = $null
    }
    $taskAdmin.Dispose(); $taskAdmin = $null
    if ($taskReply.status -notin @('created_verified','existing_verified')) { throw 'Login sem verificação completa. Pare; nenhum deploy foi enviado.' }
    $taskRuntime = ConvertTo-SecureString -String $taskReply.password -AsPlainText -Force
    $taskReply = $null
    Write-Host 'Login restrito verificado; conexão administrativa fechada/descartada. Nenhum deploy enviado.'
    $taskAction = Read-Host 'AGUARDE orientação e confirmação Free. Para futuro envio ÚNICO: PUBLICAR DEV futebolapi; outra entrada encerra'
    if ($taskAction -cne 'PUBLICAR DEV futebolapi') { return }
    $taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'deployment/neon-dev.runtime-config.json') -Raw | ConvertFrom-Json
    $taskConfig.database.runtimeRole = 'futebol_api_dev_functions'
    $taskPayload = @{config=$taskConfig;password=(Get-FutebolPlain $taskRuntime);apiKey=(Get-FutebolPlain $taskKey)} | ConvertTo-Json -Depth 8 -Compress
    $taskReply = Invoke-FutebolPrivatePipe 'scripts/send-neon-dev-upload.mjs' '--send' $taskPayload
    $taskPayload = $null
    Write-Host 'Envio concluído ou incerto: conferir Console antes de qualquer repetição. Nenhum retry automático.'
    Write-Host ('Status sanitizado: ' + $taskReply.status)
} catch { Write-Host 'Operação interrompida; nenhum detalhe sensível será exibido. Confira o Console se já houve envio.' }
finally {
    $taskPayload = $null; $taskReply = $null
    if ($null -ne $taskAdmin) { $taskAdmin.Dispose() }
    if ($null -ne $taskKey) { $taskKey.Dispose() }
    if ($null -ne $taskRuntime) { $taskRuntime.Dispose() }
}
