param([Parameter(Mandatory)][ValidateSet('dev','prd')][string]$Target,[switch]$Deploy)
$ErrorActionPreference = 'Stop'
$futebolRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $futebolRoot
if ((Get-Location).Path -ne $futebolRoot -or (git remote get-url origin) -ne 'https://github.com/jaissoncb/futebol.git') { throw 'Checkout Futebol incorreto' }
if ($Deploy -and $Target -ne 'dev') { throw 'Operador de escrita disponível apenas para DEV' }
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class FutebolCredential {
    [StructLayout(LayoutKind.Sequential)]
    struct Credential {
        public uint Flags, Type;
        public IntPtr Target, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME Written;
        public uint Size;
        public IntPtr Blob;
        public uint Persist, Count;
        public IntPtr Attributes, Alias, User;
    }
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
    static extern bool CredReadW(string name, uint type, uint flags, out IntPtr pointer);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr pointer);
    public static int Pipe(string name, Stream destination) {
        IntPtr pointer;
        if (!CredReadW(name, 1, 0, out pointer)) return Marshal.GetLastWin32Error();
        byte[] bytes = null;
        try {
            Credential value = Marshal.PtrToStructure<Credential>(pointer);
            if (value.Blob == IntPtr.Zero || value.Size == 0 || value.Size > 8192) return 13;
            int width = value.Size % 2 == 0 && Marshal.ReadByte(value.Blob, 1) == 0 ? 2 : 1;
            int count = (int)value.Size / width;
            if (Marshal.ReadByte(value.Blob, (count - 1) * width) == 0) count--;
            if (count < 16 || count > 4096) return 13;
            bytes = new byte[count];
            for (int i = 0; i < count; i++) {
                byte b = Marshal.ReadByte(value.Blob, i * width);
                if (b < 33 || b > 126 || (width == 2 && Marshal.ReadByte(value.Blob, i * width + 1) != 0)) return 13;
                bytes[i] = b;
            }
            destination.Write(bytes, 0, bytes.Length);
            return 0;
        } finally {
            if (bytes != null) Array.Clear(bytes, 0, bytes.Length);
            CredFree(pointer);
        }
    }
}
'@
$futebolStart = [Diagnostics.ProcessStartInfo]::new()
$futebolStart.FileName = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$futebolStart.WorkingDirectory = $futebolRoot
$futebolStart.UseShellExecute = $false
$futebolStart.RedirectStandardInput = $true
$futebolStart.ArgumentList.Add($(if ($Deploy) { '.local-backup/deploy-sharing-dev.mjs' } else { 'scripts/neon-verify-access.mjs' }))
$futebolStart.ArgumentList.Add($(if ($Deploy) { '--deploy' } else { $Target }))
$futebolStart.Environment.Clear()
foreach ($futebolName in 'SYSTEMROOT','WINDIR','TEMP','TMP') {
    $futebolValue = [Environment]::GetEnvironmentVariable($futebolName)
    if ($futebolValue) { $futebolStart.Environment[$futebolName] = $futebolValue }
}
$futebolProcess = [Diagnostics.Process]::Start($futebolStart)
try {
    try {
        $futebolCode = [FutebolCredential]::Pipe("sabara/futebol/neon/$Target", $futebolProcess.StandardInput.BaseStream)
    } finally { $futebolProcess.StandardInput.Close() }
    Write-Output "CredReadW $Target status=$futebolCode"
    $futebolProcess.WaitForExit()
    if ($futebolCode -ne 0 -or $futebolProcess.ExitCode -ne 0) { exit 1 }
} finally { $futebolProcess.Dispose() }
