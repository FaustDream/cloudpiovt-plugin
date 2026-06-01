param(
  [ValidateSet("all", "chrome", "edge")]
  [string]$Browser = "all",

  [string[]]$ExtensionId = @()
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = $repoRoot
$projectPath = Join-Path $extensionRoot "native-host\CloudPiOvt.NativeHost\CloudPiOvt.NativeHost.csproj"
$publishDir = Join-Path $extensionRoot ".native-host\publish"
$hostManifestPath = Join-Path $extensionRoot ".native-host\com.cloudpiovt.editor_helper.json"
$hostName = "com.cloudpiovt.editor_helper"

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

# Edge 从商店安装或重新加载解压扩展时可能得到不同扩展 ID；Native Host 必须显式允许所有会调用它的扩展来源。
$allowedOrigins = $extensionIds | ForEach-Object { "chrome-extension://$_/" }

New-Item -ItemType Directory -Force -Path $publishDir | Out-Null

dotnet publish $projectPath -c Release -r win-x64 --self-contained false -o $publishDir

$exePath = Join-Path $publishDir "CloudPiOvt.NativeHost.exe"
if (-not (Test-Path $exePath)) {
  throw "Published native host executable was not found: $exePath"
}

$hostManifest = @{
  name = $hostName
  description = "CloudPiOvt native editor bridge"
  path = $exePath
  type = "stdio"
  allowed_origins = @($allowedOrigins)
}

$hostManifest | ConvertTo-Json -Depth 4 | Set-Content -Path $hostManifestPath -Encoding UTF8

if ($Browser -in @("all", "chrome")) {
  Register-HostManifest -RegistryPath "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName" -ManifestPathValue $hostManifestPath
}

if ($Browser -in @("all", "edge")) {
  Register-HostManifest -RegistryPath "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName" -ManifestPathValue $hostManifestPath
}

Write-Output "Native host installed."
Write-Output "Manifest extension ID: $extensionId"
Write-Output "Allowed origins:"
$allowedOrigins | ForEach-Object { Write-Output "  $_" }
Write-Output "Host manifest: $hostManifestPath"
