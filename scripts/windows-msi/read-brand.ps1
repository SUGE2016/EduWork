#Requires -Version 7.0
param([string]$BrandingFile = (Join-Path $PSScriptRoot 'brand.json'))
$ErrorActionPreference = 'Stop'
$BrandingFile = (Resolve-Path -LiteralPath $BrandingFile).Path
$brand = Get-Content -LiteralPath $BrandingFile -Raw | ConvertFrom-Json
$required = @('distribution', 'productName', 'manufacturer', 'installDirectory', 'registryKey', 'upgradeCode', 'executable', 'icon', 'logo', 'accentColor', 'welcomeText')
if ($brand.schemaVersion -ne 1) { throw 'Unsupported MSI branding schemaVersion' }
foreach ($key in $required) {
    if ($brand.$key -isnot [string] -or [string]::IsNullOrWhiteSpace($brand.$key)) { throw "Missing MSI branding field: $key" }
}
foreach ($key in $brand.PSObject.Properties.Name) {
    if ($key -notin ($required + 'schemaVersion')) { throw "Unknown MSI branding field: $key" }
}
if ($brand.distribution -notmatch '^[a-z][a-z0-9-]*$') { throw 'Invalid branding distribution' }
if ($brand.accentColor -notmatch '^#[0-9a-fA-F]{6}$') { throw 'accentColor must be #RRGGBB' }
$guid = [guid]::Empty
if (-not [guid]::TryParse($brand.upgradeCode, [ref]$guid) -or $guid -eq [guid]::Empty) { throw 'upgradeCode must be a non-empty GUID' }
$brand.upgradeCode = $guid.ToString().ToUpperInvariant()
foreach ($key in @('productName', 'installDirectory', 'executable')) {
    if ($brand.$key -match '[<>:"/\\|?*\[\]\x00-\x1f]' -or $brand.$key -match '[. ]$' -or $brand.$key -in '.', '..') { throw "Invalid single file/directory name: $key" }
}
if ($brand.executable -notmatch '\.exe$') { throw 'executable must name an EXE in the application root' }
if ($brand.registryKey -notmatch '^Software\\[^\r\n\[\]]+$') { throw 'registryKey must be an HKCU Software subkey' }
foreach ($key in @('productName', 'manufacturer', 'welcomeText')) {
    if ($brand.$key -match '[\[\]\x00-\x1f]' -or $brand.$key.Length -gt 255) { throw "Invalid MSI display text: $key" }
}
# Separate editions must not accidentally upgrade or share the public installation.
if ($brand.distribution -ne 'eduwork') {
    $public = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'brand.json') -Raw | ConvertFrom-Json
    foreach ($key in @('productName', 'upgradeCode', 'installDirectory', 'registryKey')) {
        if ($brand.$key.Trim('{}') -eq $public.$key.Trim('{}')) { throw "An independent edition requires its own $key" }
    }
}
foreach ($key in @('icon', 'logo')) {
    $path = if ([IO.Path]::IsPathRooted($brand.$key)) { $brand.$key } else { Join-Path (Split-Path $BrandingFile) $brand.$key }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing MSI branding asset: $key" }
    $brand.$key = (Resolve-Path -LiteralPath $path).Path
}
if ([IO.Path]::GetExtension($brand.icon) -ne '.ico' -or [IO.Path]::GetExtension($brand.logo) -notin '.png', '.bmp') { throw 'MSI assets must be an ICO and a PNG/BMP logo' }
$brand
