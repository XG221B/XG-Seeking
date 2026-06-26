Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

folder = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
shell.Run "cmd /c npm run local", 0, False
WScript.Sleep 1200
shell.Run "msedge http://127.0.0.1:1420", 1, False
