' Free daily Yahoo data update for the NQ Replay Trainer.
' Runs scripts\update_yahoo.py HIDDEN (no console window) and appends output to data\yahoo_update.log.
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = repo
sh.Run "cmd /c C:\WINDOWS\py.exe """ & repo & "\scripts\update_yahoo.py"" >> """ & repo & "\data\yahoo_update.log"" 2>&1", 0, False
