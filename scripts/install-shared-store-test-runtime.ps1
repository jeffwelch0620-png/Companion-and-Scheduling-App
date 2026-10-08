$ErrorActionPreference = 'Stop'
$validationRoot = Join-Path (Split-Path $PSScriptRoot -Parent) '.sites-runtime/shared-store-validation'
New-Item -ItemType Directory -Path $validationRoot -Force | Out-Null
$version = '0.5.8'
$metadata = Invoke-RestMethod -Uri "https://registry.npmjs.org/@electric-sql%2fpglite/$version" -TimeoutSec 30
if ($metadata.name -ne '@electric-sql/pglite' -or $metadata.version -ne $version -or $metadata.dependencies) { throw 'Unexpected package identity or dependencies.' }
$archive = Join-Path $validationRoot "pglite-$version.tgz"
Invoke-WebRequest -Uri $metadata.dist.tarball -OutFile $archive -TimeoutSec 90
$actualIntegrity = 'sha512-' + [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::HashData([IO.File]::ReadAllBytes($archive)))
if ($actualIntegrity -ne $metadata.dist.integrity) { throw 'Package integrity mismatch.' }
$members = & tar -tf $archive
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect package archive.' }
foreach ($member in $members) {
  if (-not $member.StartsWith('package/') -or $member -match '(^|[/\\])\.\.([/\\]|$)' -or $member.Contains('\')) { throw 'Unsafe archive entry.' }
}
$listing = & tar -tvf $archive
if ($LASTEXITCODE -ne 0 -or @($listing | Where-Object { $_ -match '^[lh]' }).Count) { throw 'Package contains unsupported links.' }
$packageRoot = Join-Path $validationRoot 'node_modules/@electric-sql/pglite'
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
& tar -xzf $archive -C $packageRoot --strip-components 1
if ($LASTEXITCODE -ne 0) { throw 'Package extraction failed.' }
$installed = Get-Content -Raw -LiteralPath (Join-Path $packageRoot 'package.json') | ConvertFrom-Json
if ($installed.name -ne $metadata.name -or $installed.version -ne $version) { throw 'Installed package identity mismatch.' }
[ordered]@{
  name=$metadata.name; version=$version; resolved=$metadata.dist.tarball; integrity=$actualIntegrity
  installedAtUtc=[DateTime]::UtcNow.ToString('o'); method='Verified official npm tarball; no package scripts executed'
  command='pwsh -NoProfile -File scripts/install-shared-store-test-runtime.ps1'
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $validationRoot 'install-receipt.json') -Encoding utf8
Write-Output "Installed @electric-sql/pglite@$version in the isolated validation directory; SHA512 matched official npm metadata."

