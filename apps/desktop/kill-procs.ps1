Get-Process | ForEach-Object {
  try {
    $p = $_.MainModule.FileName
    if ($p -like "*win-unpacked*" -or $p -like "*Qflo*") {
      Write-Host "Killing $($_.Name) PID=$($_.Id) PATH=$p"
      Stop-Process -Id $_.Id -Force
    }
  } catch {}
}
