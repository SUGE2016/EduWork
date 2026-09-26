#Requires -Version 7.0
param([Parameter(Mandatory)][string]$Msi,
    [string]$BrandingFile = (Join-Path $PSScriptRoot 'windows-msi/brand.json'),
    [string]$App)
$ErrorActionPreference = 'Stop'
$brand = & "$PSScriptRoot/windows-msi/read-brand.ps1" -BrandingFile $BrandingFile
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase((Resolve-Path -LiteralPath $Msi).Path, 0)
function Read-Rows([string]$Sql, [int]$Columns = 1) {
    $view = $database.OpenView($Sql)
    try {
        [void]$view.Execute()
        while ($record = $view.Fetch()) {
            $values = for ($i = 1; $i -le $Columns; $i++) { $record.StringData($i) }
            ,@($values)
        }
    } finally { [void]$view.Close() }
}
function Assert-Row([string]$Sql, [string]$Message) {
    if (@(Read-Rows $Sql).Count -ne 1) { throw $Message }
}
try {
    $properties = @{}
    foreach ($row in (Read-Rows 'SELECT `Property`, `Value` FROM `Property`' 2)) { $properties[$row[0]] = $row[1] }
    if ($properties.ProductName -ne $brand.productName -or $properties.Manufacturer -ne $brand.manufacturer -or $properties.UpgradeCode.Trim('{}') -ne $brand.upgradeCode) { throw 'MSI product identity does not match its branding profile' }
    $directory = @(Read-Rows 'SELECT `DefaultDir` FROM `Directory` WHERE `Directory` = ''INSTALLFOLDER''')
    if ($directory.Count -ne 1 -or $directory[0][0].Split('|')[-1] -ne $brand.installDirectory) { throw 'MSI installation directory does not match branding' }
    foreach ($row in (Read-Rows 'SELECT `Name`, `Target` FROM `Shortcut`' 2)) {
        if ($row[0].Split('|')[-1] -ne $brand.productName -or $row[1] -ne ('[INSTALLFOLDER]' + $brand.executable)) { throw 'Shortcut name/target does not match branding' }
    }
    Assert-Row 'SELECT `Dialog` FROM `Dialog` WHERE `Dialog` = ''EduWorkInstallDlg''' 'Missing install settings dialog'
    Assert-Row 'SELECT `Property` FROM `Property` WHERE `Property` = ''ProductLanguage'' AND `Value` = ''2052''' 'Installer must use Simplified Chinese'
    Assert-Row 'SELECT `Name` FROM `_Tables` WHERE `Name` = ''ActionText''' 'Missing localized action descriptions; progress may display raw placeholders'
    $copyText = @(Read-Rows 'SELECT `Description`, `Template` FROM `ActionText` WHERE `Action` = ''InstallFiles''' 2)
    if ($copyText.Count -ne 1 -or $copyText[0][0] -ne '正在复制新文件' -or $copyText[0][0] -match '\[\d+\]' -or $copyText[0][1] -notmatch '\[1\]') { throw 'Copy progress must separate the action description from its file-data template' }
    Assert-Row 'SELECT `Control_` FROM `EventMapping` WHERE `Dialog_` = ''ProgressDlg'' AND `Control_` = ''ActionText'' AND `Event` = ''ActionText'' AND `Attribute` = ''Text''' 'Progress status must subscribe to the action description'
    $upgrades = @(Read-Rows 'SELECT `Language`, `ActionProperty`, `Attributes` FROM `Upgrade`' 3)
    if ($upgrades.Count -ne 2) { throw 'Expected upgrade and downgrade detection rules' }
    foreach ($row in $upgrades) {
        if ($row[0]) { throw 'Upgrade detection must also match earlier English installers' }
    }
    $replace = @($upgrades | Where-Object { $_[1] -eq 'WIX_UPGRADE_DETECTED' })
    $detect = @($upgrades | Where-Object { $_[1] -eq 'WIX_DOWNGRADE_DETECTED' })
    if ($replace.Count -ne 1 -or ([int]$replace[0][2] -band 514) -ne 512 -or $detect.Count -ne 1 -or ([int]$detect[0][2] -band 258) -ne 2) { throw 'Same-version upgrades and newer-version blocking must be retained' }
    Assert-Row 'SELECT `Condition` FROM `LaunchCondition` WHERE `Condition` = ''Installed OR NOT WIX_DOWNGRADE_DETECTED''' 'Newer versions must block installation'
    Assert-Row 'SELECT `Condition` FROM `LaunchCondition` WHERE `Condition` = ''NOT ALLUSERS''' 'Per-user-only contract must be enforced before suppressing ICE91'
    Assert-Row 'SELECT `Action` FROM `InstallExecuteSequence` WHERE `Action` = ''RemoveExistingProducts''' 'Related products must be removed during upgrade'
    if (@(Read-Rows 'SELECT `Property` FROM `Property` WHERE `Property` = ''LIMITUI''').Count) { throw 'LIMITUI suppresses the branded wizard' }
    foreach ($bitmap in 'WixUI_Bmp_Dialog', 'WixUI_Bmp_Banner') {
        Assert-Row ('SELECT `Name` FROM `Binary` WHERE `Name` = ''{0}''' -f $bitmap) "Missing brand bitmap: $bitmap"
    }
    Assert-Row 'SELECT `Property` FROM `Control` WHERE `Dialog_` = ''EduWorkInstallDlg'' AND `Control` = ''Path'' AND `Property` = ''WIXUI_INSTALLDIR''' 'Directory editor is not wired to INSTALLFOLDER'
    Assert-Row 'SELECT `Value` FROM `Property` WHERE `Property` = ''DESKTOP_SHORTCUT'' AND `Value` = ''1''' 'Desktop shortcut must default on'
    if (@(Read-Rows 'SELECT `Property` FROM `Property` WHERE `Property` = ''LAUNCH_AFTER_INSTALL''').Count) { throw 'Launch must default off' }
    $shortcutCondition = @(Read-Rows 'SELECT `Condition` FROM `Component` WHERE `Component` = ''DesktopShortcut''')
    if ($shortcutCondition[0][0] -ne 'DESKTOP_SHORTCUT = "1"') { throw 'Desktop shortcut is not conditional' }
    Assert-Row 'SELECT `Argument` FROM `ControlEvent` WHERE `Dialog_` = ''WelcomeDlg'' AND `Control_` = ''Next'' AND `Argument` = ''EduWorkInstallDlg''' 'Welcome must lead to settings'
    $pathEvents = @(Read-Rows 'SELECT `Event`, `Argument`, `Condition` FROM `ControlEvent` WHERE `Dialog_` = ''EduWorkInstallDlg'' AND `Control_` = ''Install'' ORDER BY `Ordering`' 3)
    if ($pathEvents.Count -ne 4 -or $pathEvents[0][0] -ne 'SetTargetPath' -or $pathEvents[1][1] -ne 'WixUIValidatePath' -or $pathEvents[3][0] -ne 'EndDialog' -or $pathEvents[3][2] -ne 'WIXUI_INSTALLDIR_VALID = "1"') { throw 'Installation must validate the edited path before proceeding' }
    $launch = @(Read-Rows 'SELECT `Condition` FROM `ControlEvent` WHERE `Dialog_` = ''ExitDialog'' AND `Control_` = ''Finish'' AND `Argument` = ''LaunchEduWork''')
    if ($launch.Count -ne 1 -or $launch[0][0] -ne 'LAUNCH_AFTER_INSTALL = "1" AND NOT Installed AND NOT REMOVE AND UILevel = 5') { throw 'Launch must be opt-in after a successful interactive installation' }
    $target = @(Read-Rows 'SELECT `Source`, `Target` FROM `CustomAction` WHERE `Action` = ''SetLaunchTarget''' 2)
    if ($target.Count -ne 1 -or $target[0][0] -ne 'WixShellExecTarget' -or $target[0][1] -ne ('[INSTALLFOLDER]' + $brand.executable)) { throw 'Launch target must resolve the configured executable at runtime' }
    $welcome = @(Read-Rows 'SELECT `Text` FROM `Control` WHERE `Dialog_` = ''WelcomeDlg'' AND `Control` = ''Description''')
    if ($welcome.Count -ne 1 -or -not $welcome[0][0].StartsWith($brand.welcomeText)) { throw 'Welcome text does not match branding' }
    foreach ($table in 'InstallExecuteSequence', 'InstallUISequence') {
        if (@(Read-Rows ('SELECT `Action` FROM `{0}` WHERE `Action` = ''LaunchEduWork''' -f $table)).Count) { throw 'Launch must not run in unattended or maintenance sequences' }
    }
    if ($App) {
        $App = (Resolve-Path -LiteralPath $App).Path
        $directories = @{}; $components = @{}; $payload = @{}
        foreach ($row in (Read-Rows 'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`' 3)) { $directories[$row[0]] = @($row[1], $row[2].Split(':')[0].Split('|')[-1]) }
        foreach ($row in (Read-Rows 'SELECT `Component`, `Directory_` FROM `Component`' 2)) { $components[$row[0]] = $row[1] }
        foreach ($row in (Read-Rows 'SELECT `File`, `Component_`, `FileName`, `FileSize` FROM `File`' 4)) {
            $relative = $row[2].Split('|')[-1]; $directory = $components[$row[1]]; $visited = @{}
            while ($directory -ne 'INSTALLFOLDER') {
                if (-not $directory -or -not $directories.ContainsKey($directory) -or $visited.ContainsKey($directory)) { throw 'Invalid payload directory ancestry' }
                $visited[$directory] = $true
                if ($directories[$directory][1] -ne '.') { $relative = $directories[$directory][1] + '/' + $relative }
                $directory = $directories[$directory][0]
            }
            $payload[$relative] = @($row[0], [long]$row[3])
        }
        foreach ($relative in @('resources/app/lib/main.js', 'resources/product/d/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js', 'config/eduwork.jsonc')) {
            $source = Join-Path $App $relative
            if (-not $payload.ContainsKey($relative) -or $payload[$relative][1] -ne (Get-Item -LiteralPath $source).Length) { throw "Missing or mismatched startup file in MSI: $relative" }
            $fileId = $payload[$relative][0]
            $expected = @(Read-Rows ('SELECT `HashPart1`, `HashPart2`, `HashPart3`, `HashPart4` FROM `MsiFileHash` WHERE `File_` = ''{0}''' -f $fileId) 4)
            $actual = $installer.FileHash($source, 0)
            try {
                if ($expected.Count -ne 1) { throw "Missing installer hash: $relative" }
                for ($part=1; $part -le 4; $part++) { if ([int]$expected[0][$part-1] -ne $actual.IntegerData($part)) { throw "Startup file hash mismatch: $relative" } }
            } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($actual) }
        }
        Write-Output "MSI startup file presence and installer hashes verified against application source ($($payload.Count) payload files)."
    }
    Write-Output 'MSI validation passed: Chinese branding, cross-language upgrade rules, directory validation, shortcut option, interactive-only launch.'
} finally {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
}
