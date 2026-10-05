' Daily review-list refresh (Mack's PATs + Thomas Wade) for the NQ/ES Replay Trainer.
' Runs scripts\daily_reviews.py HIDDEN (no console window). The script appends to data\daily_reviews.log itself;
' the console output (and any crash traceback) of the latest run is kept in data\daily_reviews.last.txt.
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = repo
sh.Run "cmd /c C:\WINDOWS\py.exe -3.12 -B """ & repo & "\scripts\daily_reviews.py"" > """ & repo & "\data\daily_reviews.last.txt"" 2>&1", 0, False
