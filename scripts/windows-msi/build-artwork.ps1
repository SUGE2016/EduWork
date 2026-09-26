# Build native MSI bitmap resources from the checked-in brand icon, without new dependencies.
#Requires -Version 7.0
param([Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$Logo,
    [Parameter(Mandatory)][string]$ProductName,
    [Parameter(Mandatory)][string]$AccentColor)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$icon = [Drawing.Image]::FromFile($Logo)
$red = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($AccentColor))
$font = [Drawing.Font]::new('Segoe UI', 22, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
$pen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(65, 255, 255, 255), 1.5)
try {
    foreach ($kind in 'dialog', 'banner') {
        $height = if ($kind -eq 'dialog') { 312 } else { 58 }
        $bitmap = [Drawing.Bitmap]::new(493, $height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([Drawing.Color]::White)
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            if ($kind -eq 'dialog') {
                $graphics.FillRectangle($red, 0, 0, 164, 312)
                $graphics.DrawImage($icon, 37, 42, 90, 90)
                $format = [Drawing.StringFormat]::new()
                $format.Alignment = [Drawing.StringAlignment]::Center
                $format.Trimming = [Drawing.StringTrimming]::EllipsisCharacter
                try {
                    $graphics.DrawString($ProductName, $font, [Drawing.Brushes]::White, [Drawing.RectangleF]::new(12, 145, 140, 68), $format)
                } finally { $format.Dispose() }
                $graphics.DrawBezier($pen, 0, 222, 160, 260, 200, 262, 42, 298)
            } else {
                $graphics.FillRectangle($red, 0, 0, 493, 3)
                # Keep the left side clear for stock maintenance/progress titles.
                $graphics.DrawImage($icon, 440, 12, 34, 34)
            }
            $bitmap.Save((Join-Path $OutputDirectory "$kind.bmp"), [Drawing.Imaging.ImageFormat]::Bmp)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $icon.Dispose(); $red.Dispose(); $font.Dispose(); $pen.Dispose() }
