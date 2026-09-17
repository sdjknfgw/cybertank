' CyberTank backend auto-start (hidden, no browser)
' Runs start_game.bat in "silent" mode at Windows login:
' starts the backend only if it is not already running.
CreateObject("WScript.Shell").Run """D:\tark\start_game.bat"" silent", 0, False
