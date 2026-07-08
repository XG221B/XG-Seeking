' XG221B launcher - runs the latest built version when available.
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

scriptFolder = files.GetParentFolderName(WScript.ScriptFullName)
projectRoot = files.GetParentFolderName(scriptFolder)
builtExe = projectRoot & "\src-tauri\target\release\xg221b.exe"
installedExe = "D:\XG221B\xg221b.exe"

If files.FileExists(builtExe) Then
  shell.Run Chr(34) & builtExe & Chr(34), 1, False
ElseIf files.FileExists(installedExe) Then
  shell.Run Chr(34) & installedExe & Chr(34), 1, False
Else
  MsgBox "App not found. Please run: npm run build", 48, "XG221B"
End If
