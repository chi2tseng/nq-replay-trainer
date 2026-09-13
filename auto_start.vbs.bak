' Replay Trainer auto-launcher. Runs at Windows login. Idempotent (port-listening guard).
' serve.py binds 5560 when Windows allows it, else 5460 (Hyper-V/WinNAT sometimes reserves the
' whole 55xx block after a reboot) — so detect which one is live and open that.
Option Explicit
Dim shell, port

Set shell = CreateObject("WScript.Shell")

Function Listening(p)
    Dim exec, output
    Set exec = shell.Exec("cmd /c netstat -ano | findstr LISTENING | findstr :" & p)
    output = exec.StdOut.ReadAll()
    Listening = (InStr(output, ":" & p) > 0)
End Function

port = 0
If Listening(5560) Then
    port = 5560
ElseIf Listening(5460) Then
    port = 5460
Else
    ' Not running — start the static server window-less (pythonw = no console window).
    shell.CurrentDirectory = "D:\Tools\replay-trainer"
    shell.Run """C:\Users\chi2t\AppData\Local\Programs\Python\Python312\pythonw.exe"" ""D:\Tools\replay-trainer\serve.py""", 0, False
    WScript.Sleep 1500   ' let it bind before opening the browser
    If Listening(5560) Then
        port = 5560
    ElseIf Listening(5460) Then
        port = 5460
    End If
End If

If port > 0 Then
    shell.Run "http://127.0.0.1:" & port & "/", 1, False
End If
