param([switch]$RestartAfterReadOnlyFailure)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
if((git rev-parse --show-toplevel) -ne 'D:/Projetos/Futebol' -or (git branch --show-current) -ne 'codex/dev-kinde-neon'){throw 'Git incorreto'}
$taskPath=Join-Path $taskRoot '.local-backup/neon-prd/live-release.json'
if(Test-Path $taskPath){
 $taskPrevious=Get-Content -LiteralPath $taskPath -Raw|ConvertFrom-Json
 $taskReadFailure=($taskPrevious.phase -eq 'pooled_connect' -and $taskPrevious.code -eq '08P01') -or ($taskPrevious.phase -eq 'retrieve_existing_runtime_password' -and $taskPrevious.code -eq 'HTTP_401')
 if(-not $RestartAfterReadOnlyFailure -or -not $taskReadFailure){throw 'Sessão existente; conferir antes de repetir.'}
}
@{status='AWAITING_PROJECT_SCOPED_KEY'}|ConvertTo-Json|Set-Content -LiteralPath $taskPath
$taskKey=$null;$taskPayload=$null;$taskProcess=$null
try{
 Write-Host 'Somente projeto futebol-prd / withered-haze-60370136 / production. Free US$0. Sem migrations.'
 Write-Host 'Digite o VALOR da API key Neon completa, sem Bearer. Não é senha PostgreSQL nem Client ID Kinde.'
 $taskKey=Read-Host 'Chave temporária Neon Project-scoped SOMENTE Futebol PRD (oculta)' -AsSecureString
 $taskPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskKey)
 try{$taskPayload=@{apiKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPtr)}|ConvertTo-Json -Compress}
 finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPtr)}
 $taskStart=[Diagnostics.ProcessStartInfo]::new();$taskStart.FileName=(Get-Command node -CommandType Application|Select-Object -First 1).Source
 $taskStart.WorkingDirectory=$taskRoot;$taskStart.UseShellExecute=$false
 $taskStart.RedirectStandardInput=$true;$taskStart.RedirectStandardOutput=$true;$taskStart.RedirectStandardError=$true
 $taskStart.ArgumentList.Add('scripts/neon-prd-release.mjs');$taskStart.Environment.Clear()
 foreach($taskName in @('SystemRoot','WINDIR','TEMP','TMP')){$taskValue=[Environment]::GetEnvironmentVariable($taskName);if($taskValue){$taskStart.Environment[$taskName]=$taskValue}}
 $taskProcess=[Diagnostics.Process]::Start($taskStart)
 $taskOut=$taskProcess.StandardOutput.ReadToEndAsync();$taskErr=$taskProcess.StandardError.ReadToEndAsync()
 $taskProcess.StandardInput.Write($taskPayload);$taskProcess.StandardInput.Close();$taskPayload=$null;$taskKey.Dispose();$taskKey=$null
 Write-Host 'Entrada concluída. Senha existente será recuperada em memória; não será exibida. Aguarde orientação nesta janela.'
 $taskProcess.WaitForExit();[void]$taskErr.GetAwaiter().GetResult();[void]$taskOut.GetAwaiter().GetResult()
}catch{Write-Host 'Operação interrompida; detalhes sensíveis suprimidos.'}finally{
 $taskPayload=$null;if($taskKey){$taskKey.Dispose()};if($taskProcess){$taskProcess.Dispose()}
}
