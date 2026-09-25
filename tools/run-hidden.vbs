' run-hidden.vbs — silent launcher for Scheduled Tasks (no console window flash)
' Usage: wscript.exe //B run-hidden.vbs "<path-to-command-file>"
' The command file is a plain .cmd/.bat — its content is exactly the original
' task command line. Reading it from disk avoids every embedded-quote problem,
' and wscript itself never shows a window. Exits with the command's exit code
' so Task Scheduler's Last Task Result keeps working.
Option Explicit

If WScript.Arguments.Count < 1 Then WScript.Quit 87 ' ERROR_INVALID_PARAMETER

Dim shell, fso, cmdFile
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

cmdFile = WScript.Arguments(0)
If Not fso.FileExists(cmdFile) Then WScript.Quit 2

' read the single command line from the file (first non-empty line)
Dim ts, cmdline
Set ts = fso.OpenTextFile(cmdFile, 1) ' 1 = ForReading
Do While Not ts.AtEndOfStream
  cmdline = Trim(ts.ReadLine)
  If cmdline <> "" Then Exit Do
Loop
ts.Close
If cmdline = "" Then WScript.Quit 2

Dim rc
On Error Resume Next
rc = shell.Run(cmdline, 0, True) ' 0 = hidden window · True = wait
If Err.Number <> 0 Then
  On Error GoTo 0
  WScript.Quit 2 ' command could not start
End If
On Error GoTo 0

WScript.Quit rc
