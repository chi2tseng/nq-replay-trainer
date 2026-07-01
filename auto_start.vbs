' Replay Trainer auto-launcher. Runs at Windows login. Idempotent (port-listening guard).
Option Explicit
Dim shell, exec, output

Set shell = CreateObject("WScript.Shell")

' --- Step 1: detect an existing listener on port 5560 ---
Set exec = shell.Exec("cmd /c netstat -ano | findstr LISTENING | findstr :5560")
output = exec.StdOut.ReadAll()

If InStr(output, ":5560") = 0 Then
    ' Not running — start the static server window-less (pyw = no console window).
    shell.CurrentDirectory = "C:\Users\chi2t\Downloads\replay-trainer"
    shell.Run """C:\Users\chi2t\AppData\Local\Programs\Python\Python312\pythonw.exe"" ""C:\Users\chi2t\Downloads\replay-trainer\serve.py""", 0, False
    WScript.Sleep 1500   ' let it bind before opening the browser
End If

' --- Step 2: open the app in the default browser ---
shell.Run "http://127.0.0.1:5560/", 1, False
