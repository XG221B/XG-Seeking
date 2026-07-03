Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

folder = files.GetParentFolderName(WScript.ScriptFullName)
installedExe = "D:\XG221B\xg221b.exe"
builtExe = folder & "\src-tauri\target\release\xg221b.exe"

If files.FileExists(installedExe) Then
  shell.Run Chr(34) & installedExe & Chr(34), 1, False
ElseIf files.FileExists(builtExe) Then
  shell.Run Chr(34) & builtExe & Chr(34), 1, False
Else
  MsgBox "Cannot find the desktop app. Please install XG221B first, or run npm run build in this project.", 48, "XG221B"
End If
