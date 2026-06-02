param(
  [string]$Version = "1.2.0",

  [ValidateSet("all", "chrome", "edge")]
  [string]$Browser = "all",

  [string[]]$ExtensionId = @()
)

$ErrorActionPreference = "Stop"

$extensionRoot = Split-Path -Parent $PSScriptRoot
# 扩展根目录即仓库根目录，不再有中间层子目录
$repoRoot = $extensionRoot
$releaseDir = Join-Path $repoRoot "release"
$zipPath = Join-Path $releaseDir "cloudpiovt-plugin-v$Version.zip"
$buildScript = Join-Path $PSScriptRoot "build-native-host-release.ps1"
$stagingRoot = Join-Path $releaseDir ".staging"
$stagingExtensionRoot = Join-Path $stagingRoot "cloudpiovt-plugin"
$buildArgs = @{
  Browser = $Browser
}

if ($ExtensionId.Count) {
  # Edge 扩展 ID 只在发布包需要兼容特定 Edge 安装时传入，避免空数组被转成缺少参数值。
  $buildArgs.ExtensionId = $ExtensionId
}

# 发布包先生成 Rust Native Host 运行产物，普通用户双击 .cmd 注册时不需要 Rust/Cargo 环境。
& pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File $buildScript @buildArgs

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

$excludeDirectoryNames = @(".git", "bin", "obj", "node_modules", "target")
$excludeFilePatterns = @("*.pdb")

# 使用 staging 目录生成发布包，保留 .native-host/publish 运行产物，排除 Cargo target 等开发缓存。
Copy-Item -LiteralPath $extensionRoot -Destination $stagingRoot -Recurse -Force

Get-ChildItem -LiteralPath $stagingExtensionRoot -Directory -Recurse -Force |
  Where-Object { $_.Name -in $excludeDirectoryNames } |
  Sort-Object FullName -Descending |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }

Get-ChildItem -LiteralPath $stagingExtensionRoot -File -Recurse -Force |
  Where-Object {
    foreach ($pattern in $excludeFilePatterns) {
      if ($_.Name -like $pattern) {
        return $true
      }
    }
    return $false
  } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

Compress-Archive -LiteralPath $stagingExtensionRoot -DestinationPath $zipPath -Force
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

Write-Output "Release package created: $zipPath"
