!macro preInit
  DetailPrint "Closing any running Qflo Station process..."
  nsExec::ExecToLog 'taskkill /IM "Qflo Station.exe" /T /F'
  Sleep 1500
!macroend
