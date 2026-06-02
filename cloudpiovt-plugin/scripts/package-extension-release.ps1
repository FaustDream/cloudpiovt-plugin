param(
  [string]$Version = "1.1.0",

  [ValidateSet("all", "chrome", "edge")]
  [string]$Browser = "all",

  [string[]]$ExtensionId = @()
)

$ErrorActionPreference = "Stop"

$extensionRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $extensionRoot
$releaseDir = Join-Path $repoRoot "release"
$zipPath = Join-Path $releaseDir "cloudpiovt-plugin-v$Version.zip"
$buildScript = Join-Path $PSScriptRoot "build-native-host-release.ps1"
$stagingRoot = Join-Path $releaseDir ".staging"
$stagingExtensionRoot = Join-Path $stagingRoot "cloudpiovt-plugin"
$buildArgs = @{
  Browser = $Browser
}

if ($ExtensionId.Count) {
  # 只有明确传入 Edge 扩展 ID 时才写入 allowed_origins，普通 Chrome 包使用 manifest key 推导 ID。
  $buildArgs.ExtensionId = $ExtensionId
}

# 发布包必须先生成自包含 Native Host，保证普通用户双击安装时不需要 .NET SDK/Runtime。
& pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File $buildScript @buildArgs

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

$excludeDirectoryNames = @(".git", "bin", "obj", "node_modules")
$excludeFilePatterns = @("*.pdb")

# 使用 staging 目录生成发布包，避免把 native-host/bin、obj 等开发产物混入用户 zip。
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
