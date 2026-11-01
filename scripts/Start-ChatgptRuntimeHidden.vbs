Option Explicit

If WScript.Arguments.Count <> 2 Then WScript.Quit 2

Dim shell, files, powershellPath, configPath, entryPath, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
powershellPath = WScript.Arguments.Item(0)
configPath = WScript.Arguments.Item(1)
entryPath = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "Ensure-ChatgptRuntime.ps1")

If Not files.FileExists(powershellPath) Or Not files.FileExists(configPath) Or Not files.FileExists(entryPath) Then WScript.Quit 2
command = Chr(34) & powershellPath & Chr(34) & " -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & entryPath & Chr(34) & " -ConfigPath " & Chr(34) & configPath & Chr(34)
' Window style 0 is passed when creating PowerShell, before it processes arguments.
' Wait for completion so Task Scheduler receives the actual maintenance exit code.
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
