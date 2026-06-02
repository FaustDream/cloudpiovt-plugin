param(
  [ValidateSet("all", "chrome", "edge")]
  [string]$Browser = "all",

  [string[]]$ExtensionId = @(),

  [switch]$Build,

  [switch]$SkipRegister
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$rustProjectDir = Join-Path $repoRoot "native-host-rust"
$rustExePath = Join-Path $rustProjectDir "target\release\cloudpiovt_native_host.exe"
$extensionRoot = $repoRoot
$publishDir = Join-Path $extensionRoot ".native-host\publish"
$hostExePath = Join-Path $publishDir "cloudpiovt_native_host.exe"
$hostManifestPath = Join-Path $extensionRoot ".native-host\com.cloudpiovt.editor_helper.json"
$hostName = "com.cloudpiovt.editor_helper"

if ($Build) {
  if (-not (Test-Path $rustProjectDir)) {
    throw "Rust project directory not found: $rustProjectDir"
  }

  # 开发联调或发布构建时才编译 Rust；普通用户安装包直接使用 publish 内的 exe。
  Write-Output "Building Rust Native Host..."
  & cargo build --manifest-path (Join-Path $rustProjectDir "Cargo.toml") --release
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to build Rust Native Host."
  }

  if (-not (Test-Path $rustExePath)) {
    throw "Rust Native Host executable was not produced: $rustExePath"
  }

  New-Item -ItemType Directory -Force -Path $publishDir | Out-Null
  Copy-Item -LiteralPath $rustExePath -Destination $hostExePath -Force
  Write-Output "Rust Native Host built successfully: $hostExePath"
}

if ((-not (Test-Path $hostExePath)) -and (Test-Path $rustExePath)) {
  # 源码联调场景可能已手动 cargo build --release；复制到 publish 后再注册，避免 manifest 指向 Cargo target。
  New-Item -ItemType Directory -Force -Path $publishDir | Out-Null
  Copy-Item -LiteralPath $rustExePath -Destination $hostExePath -Force
}

function Get-ExtensionIdFromManifestKey {
  param([string]$ManifestPath)

  $manifest = Get-Content -Raw -Encoding UTF8 -Path $ManifestPath | ConvertFrom-Json
  if (-not $manifest.key) {
    throw "manifest.json is missing the key field."
  }

  $publicKeyBytes = [Convert]::FromBase64String([string]$manifest.key)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash($publicKeyBytes)
  } finally {
    $sha256.Dispose()
  }

  $alphabet = "abcdefghijklmnop"
  $builder = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt 16; $i++) {
    $byte = $hash[$i]
    [void]$builder.Append($alphabet[[int]($byte -shr 4)])
    [void]$builder.Append($alphabet[[int]($byte -band 15)])
  }

  return $builder.ToString()
}

function Register-HostManifest {
  param(
    [string]$RegistryPath,
    [string]$ManifestPathValue
  )

  if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  Set-Item -Path $RegistryPath -Value $ManifestPathValue
}

$manifestPath = Join-Path $extensionRoot "manifest.json"
$extensionId = Get-ExtensionIdFromManifestKey -ManifestPath $manifestPath
$extensionIds = @($extensionId) + @($ExtensionId | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$extensionIds = $extensionIds |
  ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } |
  Where-Object { $_ -match '^[a-p]{32}$' } |
  Select-Object -Unique

if (-not $extensionIds.Count) {
  throw "No valid extension IDs were resolved."
}

$allowedOrigins = $extensionIds | ForEach-Object { "chrome-extension://$_/" }

if (-not (Test-Path $hostExePath)) {
  throw "Rust Native Host executable was not found: $hostExePath. Release packages should include .native-host\publish; developers can run scripts\install-native-host.cmd -Build."
}

$hostManifest = [ordered]@{
  allowed_origins = @($allowedOrigins)
  path = $hostExePath
  name = $hostName
  type = "stdio"
  description = "CloudPiOvt native editor bridge (Rust)"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $hostManifestPath) | Out-Null
$hostManifestJson = $hostManifest | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($hostManifestPath, $hostManifestJson + [Environment]::NewLine, $utf8NoBom)

if (-not $SkipRegister) {
  if ($Browser -in @("all", "chrome")) {
    Register-HostManifest -RegistryPath "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName" -ManifestPathValue $hostManifestPath
  }

  if ($Browser -in @("all", "edge")) {
    Register-HostManifest -RegistryPath "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName" -ManifestPathValue $hostManifestPath
  }
}

if ($SkipRegister) {
  Write-Output "Native host release files prepared."
} else {
  Write-Output "Native host installed for current user."
}
Write-Output "Manifest extension ID: $extensionId"
Write-Output "Allowed origins:"
$allowedOrigins | ForEach-Object { Write-Output "  $_" }
Write-Output "Host manifest: $hostManifestPath"
