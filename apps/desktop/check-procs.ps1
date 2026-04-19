Get-Process | ForEach-Object {
  try {
    $p = $_.MainModule.FileName
    if ($p -like "*Qflo*" -or $p -like "*electron*" -or $p -like "*win-unpacked*") {
      Write-Host "$($_.Name) PID=$($_.Id) PATH=$p"
    }
  } catch {}
}
