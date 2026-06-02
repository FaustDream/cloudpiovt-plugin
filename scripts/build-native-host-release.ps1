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
  # Edge 扩展 ID 只在发布包需要兼容特定 Edge 安装时传入，避免空数组被转成缺少参数值。
  $installArgs.ExtensionId = $ExtensionId
}

# 发布构建入口只在开发维护机器执行，产物复制到 .native-host/publish 后供普通用户直接注册。
& pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File $scriptPath @installArgs
