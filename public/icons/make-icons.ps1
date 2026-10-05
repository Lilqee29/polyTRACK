Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size, [string]$outPath) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.Clear([System.Drawing.Color]::FromArgb(255, 22, 32, 60))

  # checkered strip (top third)
  $cells = 6
  $cs = [int]($size / $cells)
  $stripH = [int]($size * 0.30)
  $white = [System.Drawing.Brushes]::White
  for ($x = 0; $x -lt $cells; $x++) {
    for ($y = 0; $y -lt [Math]::Ceiling($stripH / $cs); $y++) {
      if (($x + $y) % 2 -eq 0) {
        $r = New-Object System.Drawing.Rectangle(($x * $cs), ($y * $cs), $cs, [Math]::Min($cs, $stripH - $y * $cs))
        $g.FillRectangle($white, $r)
      }
    }
  }

  # green "P"
  $green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 34, 197, 94))
  $font = New-Object System.Drawing.Font("Segoe UI", ([int]($size * 0.48)), [System.Drawing.FontStyle]::Bold)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = "Center"
  $sf.LineAlignment = "Center"
  $rect = New-Object System.Drawing.RectangleF(0, ($size * 0.62), $size, ($size * 0.70))
  $g.DrawString("P", $font, $green, $rect, $sf)

  $g.Dispose()
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $outPath"
}

New-Icon 192 "$PSScriptRoot\icon-192.png"
New-Icon 512 "$PSScriptRoot\icon-512.png"
