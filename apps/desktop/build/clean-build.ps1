$targetDir = "C:\Users\Faycel\Documents\qflow\apps\desktop\release\win-unpacked"
# Kill any Electron/Qflo processes
Get-Process -Name "Qflo Station","electron" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
# Remove the win-unpacked directory
if (Test-Path $targetDir) {
    Remove-Item -Force -Recurse $targetDir -ErrorAction SilentlyContinue
}
if (Test-Path $targetDir) {
    Write-Host "STILL EXISTS - trying individual file deletion"
    Get-ChildItem -Path $targetDir -Recurse -File | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    Remove-Item -Force -Recurse $targetDir -ErrorAction SilentlyContinue
}
if (Test-Path $targetDir) { Write-Host "FAILED" } else { Write-Host "CLEANED" }
