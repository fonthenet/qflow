!macro preInit
  ; Try graceful shutdown first (WM_CLOSE) — gives the app time to checkpoint DB
  DetailPrint "Requesting Qflo Station to close gracefully..."
  nsExec::ExecToLog 'taskkill /IM "Qflo Station.exe" /T'
  Sleep 3000

  ; Force-kill if still running (safety net)
  nsExec::ExecToLog 'taskkill /IM "Qflo Station.exe" /T /F'
  Sleep 1000
!macroend
