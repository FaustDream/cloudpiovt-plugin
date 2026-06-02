param(
  [ValidateSet("all", "chrome", "edge")]
  [string]$Browser = "all",

  [string[]]$ExtensionId = @()
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "install-native-host.ps1"
$installArgs = @{
  Browser = $Browser
  Build = $true
  SkipRegister = $true
}

if ($ExtensionId.Count) {
  # Edge 扩展 ID 只有在发布包需要兼容特定 Edge 安装时传入，避免空数组转发成缺少参数值。
  $installArgs.ExtensionId = $ExtensionId
}

# 发布包构建入口：只在开发维护机器执行，产物包含 .NET 运行时，普通用户安装时不再需要 dotnet。
& pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File $scriptPath @installArgs
