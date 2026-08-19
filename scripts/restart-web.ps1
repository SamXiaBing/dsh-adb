# restart-web.ps1 — 一键重启 dsh web（杀掉当前进程树 → 重新启动 start-dsh-web.bat → 等待服务起来 → 打开页面）
# 用法：powershell -ExecutionPolicy Bypass -File D:\AIWorkSpace\dsh-adb\scripts\restart-web.ps1
param(
  [string]$BatPath = 'D:\AIWorkSpace\deepseek-harness\start-dsh-web.bat',
  [string]$Url = 'http://127.0.0.1:3080',
  [int]$WaitSeconds = 45
)

Write-Host "==> 1/3 停止当前 dsh web 进程树"
$targets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'web' -and $_.CommandLine -match 'dsh' }
if ($targets) {
  foreach ($p in $targets) {
    Write-Host "    killing node $($p.ProcessId)"
    taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null
  }
} else {
  Write-Host "    未发现 dsh web 的 node 进程（可能已停止）"
}
# 顺带清掉还在跑 bat 的 cmd 窗口
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'start-dsh-web\.bat' } |
  ForEach-Object { Write-Host "    killing cmd $($_.ProcessId)"; taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null }
Start-Sleep -Seconds 2

Write-Host "==> 2/3 启动 $BatPath"
Start-Process -FilePath $BatPath -WorkingDirectory (Split-Path -Parent $BatPath)

Write-Host "==> 3/3 等待服务就绪并打开页面"
$up = $false
for ($i = 1; $i -le $WaitSeconds; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing -SkipHttpErrorCheck
    if ($r.StatusCode -lt 500) { $up = $true; Write-Host "    服务已就绪（${i}s）"; break }
  } catch { }
}
if (-not $up) { Write-Host "    警告：${WaitSeconds}s 内服务未就绪，仍尝试打开页面" }
Start-Process $Url
Write-Host "==> 完成。页面已在默认浏览器打开（若原标签已存在则可能复用，必要时手动刷新）。"
