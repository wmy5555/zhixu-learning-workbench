$ErrorActionPreference = 'Stop'
$taskBytes = $null
$taskResult = $null
try {
  Add-Type -AssemblyName System.Security
  $taskBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
  $taskResult = [System.Security.Cryptography.ProtectedData]::Unprotect($taskBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($taskResult))
} catch {
  [Console]::Error.Write('DPAPI operation failed')
  exit 1
} finally {
  if ($null -ne $taskBytes) {[Array]::Clear($taskBytes, 0, $taskBytes.Length)}
  if ($null -ne $taskResult) {[Array]::Clear($taskResult, 0, $taskResult.Length)}
}
