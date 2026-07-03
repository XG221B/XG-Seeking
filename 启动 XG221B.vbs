' XG221B Launcher — always runs the latest built version
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

folder = files.GetParentFolderName(WScript.ScriptFullName)
builtExe = folder & "\src-tauri\target\release\xg221b.exe"
installedExe = "D:\XG221B\xg221b.exe"

If files.FileExists(builtExe) Then
  shell.Run Chr(34) & builtExe & Chr(34), 1, False
ElseIf files.FileExists(installedExe) Then
  shell.Run Chr(34) & installedExe & Chr(34), 1, False
Else
  MsgBox "App not found. Please run: npm run build", 48, "XG221B"
End If
