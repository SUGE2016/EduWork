#Requires -Version 7.0
param([Parameter(Mandatory)][string]$App, [Parameter(Mandatory)][string]$Output,
    [string]$BrandingFile = (Join-Path $PSScriptRoot 'windows-msi/brand.json'),
    [string]$CacheDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EduWorkBuildCache/wix3'),
    [switch]$SkipIceValidation)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if (-not $IsWindows) { throw 'MSI packaging requires Windows' }
$App = (Resolve-Path -LiteralPath $App).Path
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'MSI output already exists' }
$identity = Get-Content (Join-Path $App 'resources/app/eduwork.desktop.json') -Raw | ConvertFrom-Json
if ($identity.shell -ne 'electron' -or $identity.productVersion -notmatch '^(\d+\.\d+\.\d+)(?:-dev\.\d{8}\.[1-9]\d*)?$') { throw 'Expected an EduWork Electron candidate' }
$version = $Matches[1]
if ($SkipIceValidation -and $identity.productVersion -notmatch '-dev[.]') { throw 'Skipping ICE is only allowed for local development previews' }
$uiRoot = Join-Path $PSScriptRoot 'windows-msi'
$brand = & "$uiRoot/read-brand.ps1" -BrandingFile $BrandingFile
if ($identity.distribution -ne $brand.distribution) { throw 'MSI branding distribution does not match the assembled application' }
if (-not (Test-Path -LiteralPath (Join-Path $App $brand.executable) -PathType Leaf)) { throw 'Branding executable is missing from the application' }
$xmlBrand = @{}
foreach ($key in @('productName', 'manufacturer', 'installDirectory', 'registryKey', 'upgradeCode', 'executable', 'icon', 'welcomeText')) {
    $xmlBrand[$key] = [Security.SecurityElement]::Escape($brand.$key)
}
$work = Join-Path ([IO.Path]::GetTempPath()) ('eduwork-msi-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
$timer = [Diagnostics.Stopwatch]::StartNew()
$timings = [ordered]@{}
$cacheLock = $null
try {
    # Pin the official WiX binaries; do not depend on the runner's installed version.
    $zip = Join-Path $work 'wix.zip'
    $CacheDirectory = [IO.Path]::GetFullPath($CacheDirectory)
    New-Item -ItemType Directory -Force -Path $CacheDirectory | Out-Null
    $cachedZip = Join-Path $CacheDirectory 'wix314-binaries.zip'
    $wixHash = '6ac824e1642d6f7277d0ed7ea09411a508f6116ba6fae0aa5f2c7daa2ff43d31'
    if ((Test-Path -LiteralPath $cachedZip) -and (Get-FileHash $cachedZip -Algorithm SHA256).Hash -eq $wixHash) {
        Copy-Item -LiteralPath $cachedZip -Destination $zip
    } else {
        Invoke-WebRequest 'https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip' -OutFile $zip -MaximumRetryCount 3
    }
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne '6ac824e1642d6f7277d0ed7ea09411a508f6116ba6fae0aa5f2c7daa2ff43d31') { throw 'WiX checksum mismatch' }
    $wix = Join-Path $work 'wix'
    Expand-Archive $zip $wix
    $cacheDownload = Join-Path $CacheDirectory ([guid]::NewGuid().ToString() + '.zip')
    Copy-Item -LiteralPath $zip -Destination $cacheDownload
    [IO.File]::Move($cacheDownload, $cachedZip, $true)
    $timings.toolchainSeconds = $timer.Elapsed.TotalSeconds
    # Hash bytes as well as names/timestamps: changed content with a preserved
    # timestamp must never select an old cabinet. Branding is outside this key.
    $node = Join-Path $App 'resources/runtime/node.exe'
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
    Write-Output 'Hashing immutable application payload...'
    $payload = (& $node (Join-Path $uiRoot 'hash-payload.mjs') $App) | ConvertFrom-Json
    $payloadKey = $payload.payloadKey
    if ($payloadKey -notmatch '^[a-f0-9]{64}$') { throw 'Payload hashing failed' }
    Write-Output "Payload: $($payload.files) files, $($payload.bytes) bytes"
    $cabCache = Join-Path $CacheDirectory "cabinets/$payloadKey"
    New-Item -ItemType Directory -Force -Path $cabCache | Out-Null
    # Concurrent builds must not write the same cabinet cache.
    $cacheLock = [IO.File]::Open((Join-Path $cabCache 'build.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $timings.payloadHashSeconds = $timer.Elapsed.TotalSeconds - $timings.toolchainSeconds
    $files = Join-Path $work 'files.wxs'
    & "$wix/heat.exe" dir $App -nologo -srd -sreg -scom -ag -cg AppFiles -dr INSTALLFOLDER -var var.App -out $files
    [xml]$harvest = Get-Content $files -Raw
    # Configuration belongs to the user after first installation, including on uninstall.
    foreach ($component in $harvest.SelectNodes('//*[local-name()="Component"]')) {
        if ($component.File.Source -like '$(var.App)\config\*') {
            $component.SetAttribute('Permanent', 'yes')
            $component.SetAttribute('NeverOverwrite', 'yes')
        }
    }
    $harvest.Save($files)
    $product = Join-Path $work 'product.wxs'
    & "$uiRoot/build-artwork.ps1" -OutputDirectory $work -Logo $brand.logo -ProductName $brand.productName -AccentColor $brand.accentColor
    $localization = (Get-Content "$uiRoot/zh-cn.wxl" -Raw).Replace('__WELCOME_TEXT__', $xmlBrand.welcomeText)
    $localization | Set-Content "$work/zh-cn.wxl" -Encoding utf8NoBOM
    @"
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="$($xmlBrand.productName)" Language="2052" Codepage="936" Version="$version" Manufacturer="$($xmlBrand.manufacturer)" UpgradeCode="$($xmlBrand.upgradeCode)">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perUser" Platform="x64" />
    <Condition Message="此安装包仅支持为当前 Windows 用户安装。请不要设置 ALLUSERS。">NOT ALLUSERS</Condition>
    <!-- Leave Language unset so the Chinese installer can upgrade earlier English packages. -->
    <Upgrade Id="$($xmlBrand.upgradeCode)">
      <UpgradeVersion Minimum="0.0.0" Maximum="$version" IncludeMaximum="yes" MigrateFeatures="yes" Property="WIX_UPGRADE_DETECTED" />
      <UpgradeVersion Minimum="$version" IncludeMinimum="no" OnlyDetect="yes" Property="WIX_DOWNGRADE_DETECTED" />
    </Upgrade>
    <Condition Message="已安装更新版本的 [ProductName]。">Installed OR NOT WIX_DOWNGRADE_DETECTED</Condition>
    <InstallExecuteSequence><RemoveExistingProducts After="InstallValidate" /></InstallExecuteSequence>
    <MediaTemplate EmbedCab="yes" MaximumUncompressedMediaSize="200" />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="LocalAppDataFolder"><Directory Id="INSTALLFOLDER" Name="$($xmlBrand.installDirectory)" /></Directory>
      <Directory Id="ProgramMenuFolder">
        <Component Id="StartMenu" Guid="*">
          <Shortcut Id="Launch" Name="$($xmlBrand.productName)" Target="[INSTALLFOLDER]$($xmlBrand.executable)" WorkingDirectory="INSTALLFOLDER" />
          <RegistryValue Root="HKCU" Key="$($xmlBrand.registryKey)" Name="Installed" Type="integer" Value="1" KeyPath="yes" />
        </Component>
      </Directory>
      <Directory Id="DesktopFolder">
        <Component Id="DesktopShortcut" Guid="*">
          <Condition>DESKTOP_SHORTCUT = "1"</Condition>
          <Shortcut Id="DesktopLaunch" Name="$($xmlBrand.productName)" Target="[INSTALLFOLDER]$($xmlBrand.executable)" WorkingDirectory="INSTALLFOLDER" Icon="EduWorkIcon" />
          <RegistryValue Root="HKCU" Key="$($xmlBrand.registryKey)" Name="DesktopShortcut" Type="integer" Value="1" KeyPath="yes" />
        </Component>
      </Directory>
    </Directory>
    <Feature Id="Main" Level="1"><ComponentGroupRef Id="AppFiles" /><ComponentRef Id="StartMenu" /><ComponentRef Id="DesktopShortcut" /></Feature>
    <Property Id="DESKTOP_SHORTCUT" Value="1" Secure="yes" />
    <Property Id="ARPPRODUCTICON" Value="EduWorkIcon" />
    <Icon Id="EduWorkIcon" SourceFile="$($xmlBrand.icon)" />
    <UIRef Id="EduWorkUI" />
    <WixVariable Id="WixUIDialogBmp" Value="$work/dialog.bmp" />
    <WixVariable Id="WixUIBannerBmp" Value="$work/banner.bmp" />
    <Property Id="ARPNOMODIFY" Value="1" />
  </Product>
</Wix>
"@ | Set-Content $product -Encoding utf8NoBOM
    $color = [Drawing.ColorTranslator]::FromHtml($brand.accentColor)
    & "$wix/candle.exe" -nologo -arch x64 "-dApp=$App" "-dAppExecutable=$($xmlBrand.executable)" "-dBrandRed=$($color.R)" "-dBrandGreen=$($color.G)" "-dBrandBlue=$($color.B)" -out "$work/" $product $files "$uiRoot/EduWorkUI.wxs"
    # Per-user file keypaths (ICE38), retained directories (ICE64), and per-user-only
    # locations (ICE91) are intentional. NOT ALLUSERS enforces the latter contract.
    $lightStart = $timer.Elapsed.TotalSeconds
    [string[]]$validationArguments = if ($SkipIceValidation) { @('-sval') } else { @('-sice:ICE38', '-sice:ICE64', '-sice:ICE91') }
    $lightLog = $Output + '.light.log'
    try {
        & "$wix/light.exe" -nologo -v -cc $cabCache -reusecab -ext "$wix/WixUIExtension.dll" -ext "$wix/WixUtilExtension.dll" -cultures:zh-cn -loc "$work/zh-cn.wxl" @validationArguments -out $Output "$work/product.wixobj" "$work/files.wixobj" "$work/EduWorkUI.wixobj" *> $lightLog
    } catch { Get-Content -LiteralPath $lightLog -Tail 20; throw }
    $cabinetReuseCount = @(Select-String -LiteralPath $lightLog -SimpleMatch 'Reusing cabinet ').Count
    $timings.linkSeconds = $timer.Elapsed.TotalSeconds - $lightStart
    Remove-Item ([IO.Path]::ChangeExtension($Output, '.wixpdb')) -ErrorAction SilentlyContinue
    $hash = (Get-FileHash $Output -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([IO.Path]::GetFileName($Output))" | Set-Content ($Output + '.sha256') -Encoding ascii
    $timings.totalSeconds = $timer.Elapsed.TotalSeconds
    @{ schemaVersion = 1; payloadKey = $payloadKey; payloadFiles = $payload.files; payloadBytes = $payload.bytes; cabinetsReused = $cabinetReuseCount; iceValidated = (-not $SkipIceValidation); timings = $timings } | ConvertTo-Json | Set-Content ($Output + '.build.json') -Encoding utf8NoBOM
} finally {
    if ($null -ne $cacheLock) { $cacheLock.Dispose() }
    $resolvedWork = [IO.Path]::GetFullPath($work)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedWork.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedWork) -notmatch '^eduwork-msi-[0-9a-f-]{36}$') { throw 'Unexpected MSI temporary directory' }
    Remove-Item -LiteralPath $resolvedWork -Recurse -Force
}
