' Replay Trainer auto-launcher. Runs at Windows login. Idempotent (port-listening guard).
' serve.py binds 5560 when Windows allows it, else 5460 (Hyper-V/WinNAT sometimes reserves the
' whole 55xx block after a reboot) - so detect which one is live and open that.
' 2026-09-02: Listening() now runs netstat HIDDEN (shell.Run style 0 + temp file)
' instead of shell.Exec, which flashed a cmd window per call at login.
Option Explicit
Dim shell, fso, port

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Function Listening(p)
    Dim tmp, f, output
    tmp = fso.GetSpecialFolder(2) & "\replay_port_check.txt"
    shell.Run "cmd /c netstat -ano | findstr LISTENING | findstr :" & p & " > """ & tmp & """", 0, True
    output = ""
    If fso.FileExists(tmp) Then
        Set f = fso.OpenTextFile(tmp, 1)
        If Not f.AtEndOfStream Then output = f.ReadAll()
        f.Close
        fso.DeleteFile tmp
    End If
    Listening = (InStr(output, ":" & p) > 0)
End Function

port = 0
If Listening(5560) Then
    port = 5560
ElseIf Listening(5460) Then
    port = 5460
Else
    ' Not running - start the static server window-less (pythonw = no console window).
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