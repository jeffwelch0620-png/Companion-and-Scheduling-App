$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $sourceRoot
if (!(Test-Path -LiteralPath 'dist/server/index.js')) {
    throw 'Build the current source before starting this walkthrough.'
}
# Keep workerd temporary SQLite paths short and inside this workspace.
$previewTemp = [IO.Path]::GetFullPath((Join-Path $sourceRoot '../../../preview-tmp'))
New-Item -ItemType Directory -Force -Path $previewTemp | Out-Null
$env:TEMP = $previewTemp
$env:TMP = $previewTemp
node tests/module-access-preview.mjs
