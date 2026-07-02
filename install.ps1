<#
  The Forge - Windows installer (PowerShell).

    irm https://raw.githubusercontent.com/ycianno/the-forge/main/install.ps1 | iex

  or, from inside a cloned repo:   .\install.ps1
  or (most bulletproof, double-clickable):   install.bat

  Parameters (only when run as a downloaded file, not via irm | iex):
    -Service        register a Scheduled Task so The Forge starts at logon
    -Dir <path>     install location (default: %USERPROFILE%\the-forge)
    -NoPause        do not wait for a keypress at the end (used by install.bat / CI)

  No Docker, no WSL, no Visual Studio required on a normal x64 PC: better-sqlite3
  ships prebuilt binaries for current Node LTS on Windows x64.

  This installer is designed to NEVER close a window before you can read what
  happened: every run is written to a log file, and unless -NoPause is given it
  waits for a keypress at the end (success or failure).
#>
[CmdletBinding()]
param(
  [switch]$Service,
  [string]$Dir,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # quieter + faster winget/downloads
$Repo       = 'https://github.com/ycianno/the-forge.git'
$DefaultDir = Join-Path $env:USERPROFILE 'the-forge'
$script:LogPath = Join-Path $env:TEMP ("the-forge-install_{0}.log" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))

# ---- logging: capture EVERYTHING so an error is never lost, even if the window vanishes ----
try { Start-Transcript -Path $script:LogPath -Force | Out-Null; $script:Transcribing = $true }
catch { $script:Transcribing = $false }

function Step($m) { Write-Host "> $m"  -ForegroundColor Cyan }
function Ok($m)   { Write-Host "+ $m"  -ForegroundColor Green }
function Warn($m) { Write-Host "! $m"  -ForegroundColor Yellow }

function Finish([int]$code) {
  if ($script:Transcribing) { try { Stop-Transcript | Out-Null } catch {} }
  Write-Host ''
  Write-Host ("Full log saved to: {0}" -f $script:LogPath) -ForegroundColor DarkGray
  if (-not $NoPause) {
    Write-Host ''
    try { Read-Host 'Press Enter to close this window' | Out-Null } catch {}
  }
  exit $code
}

function Die($m, [string[]]$fixes) {
  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Red
  Write-Host '  The Forge installer stopped.' -ForegroundColor Red
  Write-Host '============================================================' -ForegroundColor Red
  Write-Host ("  What went wrong: {0}" -f $m) -ForegroundColor Yellow
  if ($fixes) {
    Write-Host ''
    Write-Host '  Try this:' -ForegroundColor White
    foreach ($f in $fixes) { Write-Host ("    - {0}" -f $f) -ForegroundColor Gray }
  }
  Write-Host ''
  Write-Host '  Still stuck? Send the log file above to whoever set this up.' -ForegroundColor DarkGray
  Finish 1
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Add-ToPath($dir) {
  if (-not $dir) { return }
  $parts = @($env:Path -split ';' | Where-Object { $_ })
  if ($parts -notcontains $dir) { $env:Path = "$dir;$env:Path" }
}
function Find-NodeExe {
  $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    $(if ($pf86) { Join-Path $pf86 'nodejs\node.exe' }),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) {
      Add-ToPath (Split-Path $p -Parent)
      return $p
    }
  }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  return $null
}
function Find-NpmCmd {
  $nodeExe = Find-NodeExe
  if ($nodeExe) {
    $npm = Join-Path (Split-Path $nodeExe -Parent) 'npm.cmd'
    if (Test-Path $npm) {
      Add-ToPath (Split-Path $npm -Parent)
      return $npm
    }
  }
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  return $null
}
function Run-WingetInstall([string]$id, [string]$label, [string[]]$extraArgs = @()) {
  Step "$label - installing via winget..."
  $args = @(
    'install',
    '--exact',
    '--id', $id,
    '--source', 'winget',
    '--accept-source-agreements',
    '--accept-package-agreements'
  ) + $extraArgs
  winget @args
  return $LASTEXITCODE
}

try {
  Write-Host ''
  Write-Host '   The Forge' -ForegroundColor DarkYellow
  Write-Host '   ---------------------------------------' -ForegroundColor DarkGray
  Write-Host '   Self-hosted habit tracker - Windows installer' -ForegroundColor DarkGray
  Write-Host ''

  # ---- 0. sanity: 64-bit Windows, note ARM ----
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -eq 'ARM64') {
    Warn 'This is an ARM64 PC. Prebuilt database binaries may be missing;'
    Warn 'if the install fails at the database step, use Docker Desktop or WSL2 instead (see README).'
  }

  # ---- 1. Node.js 20+ (install LTS via winget if needed) ----
  function Get-NodeMajor {
    $nodeExe = Find-NodeExe
    if ($nodeExe) {
      try { return [int](& $nodeExe -p "process.versions.node.split('.')[0]" 2>$null) } catch { return 0 }
    }
    return 0
  }

  $nodeMajor = Get-NodeMajor
  if ($nodeMajor -lt 20) {
    if (Have winget) {
      $wingetCode = Run-WingetInstall 'OpenJS.NodeJS.LTS' 'Node.js 20+ not found'
      if ($wingetCode -ne 0) {
        Die 'Node.js could not be installed automatically with winget.' @(
          'Install Node.js LTS manually from https://nodejs.org (pick the "LTS" button), then re-run this installer.',
          'If winget complained about package sources, run: winget source reset --force',
          'Then re-run the installer in a NEW PowerShell window.'
        )
      }
      Refresh-Path
      $nodeMajor = Get-NodeMajor
    } else {
      Die 'Node.js 20 or newer is required, and winget is not available to install it.' @(
        'Install Node.js LTS from https://nodejs.org (pick the "LTS" button), then re-run this installer.',
        'winget ships with Windows 10/11 App Installer - update "App Installer" from the Microsoft Store to get it.'
      )
    }
  }
  if ($nodeMajor -lt 20) {
    Die 'Node.js was installed but is not visible yet (PATH not refreshed).' @(
      'Close this window, open a NEW PowerShell window, and run the installer again.',
      'If it still fails, install Node.js LTS manually from https://nodejs.org and re-run.'
    )
  }
  $nodeExe = Find-NodeExe

  # Non-LTS Node (odd major: 21, 23, 25, ...) often has no prebuilt database binary.
  # We do not block on it - we verify the module actually loads after install (step 3b).
  if (($nodeMajor % 2) -ne 0) {
    Warn ("Node $(& $nodeExe -v) is a non-LTS version - prebuilt database binaries may be missing.")
    Warn 'If the database step fails, install Node LTS (even-numbered) from https://nodejs.org and re-run.'
  }
  Ok "Node $(& $nodeExe -v) detected"

  $npmCmd = Find-NpmCmd
  if (-not $npmCmd) {
    Die 'Node is installed but "npm" was not found.' @(
      'Close this window, open a NEW PowerShell window, and re-run the installer (PATH may need a refresh).',
      'Reinstall Node.js LTS from https://nodejs.org, which includes npm.'
    )
  }

  # ---- 2. locate the source (install in place, or clone) ----
  $inPlace = (Test-Path package.json) -and (Select-String -Path package.json -Pattern '"name":\s*"the-forge"' -Quiet)
  if ($inPlace) {
    $Dir = (Get-Location).Path
    Step 'Installing in the current directory'
  } else {
    if (-not (Have git)) {
      if (Have winget) {
        $wingetCode = Run-WingetInstall 'Git.Git' 'git not found'
        if ($wingetCode -ne 0) {
          Warn 'winget could not install Git automatically.'
        }
        Refresh-Path
      }
      if (-not (Have git)) {
        Die 'git is required to download The Forge, and it could not be installed automatically.' @(
          'Install Git from https://git-scm.com/download/win, then re-run this installer.'
        )
      }
    }
    if (-not $Dir) { $Dir = $DefaultDir }
    if (Test-Path (Join-Path $Dir '.git')) {
      Step "Updating existing install at $Dir"
      git -C $Dir pull --ff-only --quiet
      if ($LASTEXITCODE -ne 0) {
        Die "Could not update the existing copy at $Dir." @(
          "Delete or rename that folder and re-run, or run: git -C `"$Dir`" pull"
        )
      }
    } else {
      Step "Downloading into $Dir"
      git clone --depth 1 --quiet $Repo $Dir
      if ($LASTEXITCODE -ne 0) {
        Die 'Download (git clone) failed.' @(
          'Check your internet connection and that GitHub is reachable, then re-run.',
          'If a firewall/proxy blocks git, download the ZIP from the GitHub page and extract it, then run install.ps1 inside it.'
        )
      }
    }
    Set-Location $Dir
  }
  $Dir = (Get-Location).Path

  # ---- 3. dependencies (prebuilt native module; no compiler needed on x64) ----
  Step 'Installing dependencies (~1 min)...'
  & $npmCmd install --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) {
    Die 'Installing dependencies (npm install) failed.' @(
      'Scroll up in this window (or open the log file) to see the exact npm error.',
      'Most common cause: the database module could not download a prebuilt binary and tried to compile.',
      'Fix: install Node LTS (even-numbered) from https://nodejs.org and re-run - it has prebuilt binaries.',
      'npm keeps its own detailed log under: %LocalAppData%\npm-cache\_logs'
    )
  }
  Ok 'Dependencies installed'

  # ---- 3b. verify the native database module actually loads ----
  Step 'Verifying the database engine...'
  & $nodeExe -e "require('better-sqlite3'); process.exit(0)" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Warn 'The database engine (better-sqlite3) installed but will not load on this Node version / CPU.'
    Write-Host ''
    Write-Host '  This means no prebuilt binary matched, and it needs to be built.' -ForegroundColor White
    Write-Host '  The reliable fix is to use an even-numbered (LTS) Node - it has ready-made binaries:' -ForegroundColor White
    Write-Host '    1) Uninstall your current Node, install "LTS" from https://nodejs.org' -ForegroundColor Gray
    Write-Host '    2) Re-run this installer' -ForegroundColor Gray
    Write-Host ''
    $tryBuild = Read-Host 'Or try to build it now (needs a large download of build tools)? [y/N]'
    if ($tryBuild -match '^[Yy]') {
      if (Have winget) {
        $wingetCode = Run-WingetInstall 'Microsoft.VisualStudio.2022.BuildTools' 'Installing Visual Studio C++ Build Tools (this is large and slow)' @(
          '--override', '--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
        )
        if ($wingetCode -ne 0) {
          Die 'Visual Studio C++ Build Tools could not be installed automatically.' @(
            'Install Node LTS (even-numbered) from https://nodejs.org and re-run - this is usually enough.',
            'Or install Visual Studio 2022 Build Tools manually with the C++ workload, then re-run.'
          )
        }
        Refresh-Path
        Step 'Rebuilding the database engine from source...'
        $npmCmd = Find-NpmCmd
        & $npmCmd rebuild better-sqlite3 --build-from-source
        & $nodeExe -e "require('better-sqlite3'); process.exit(0)" 2>$null
        if ($LASTEXITCODE -ne 0) {
          Die 'The database engine still will not load after building.' @(
            'Switch to Node LTS (even-numbered) from https://nodejs.org and re-run - this is the most reliable path.',
            'Or run The Forge under Docker Desktop / WSL2 instead (see README).'
          )
        }
        Ok 'Database engine built and loaded'
      } else {
        Die 'Cannot build automatically because winget is not available.' @(
          'Install Node LTS (even-numbered) from https://nodejs.org and re-run.'
        )
      }
    } else {
      Die 'Stopped so you can switch to Node LTS.' @(
        'Install "LTS" from https://nodejs.org, then re-run this installer.'
      )
    }
  } else {
    Ok 'Database engine OK'
  }

  # ---- 4. password / .env ----
  if (Test-Path .env) {
    Ok '.env already present - keeping your settings'
  } else {
    Write-Host ''
    Write-Host 'Choose a password to protect your dashboard:' -ForegroundColor White
    $pw = ''
    while (-not $pw) {
      $secure = Read-Host '  Password' -AsSecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    "APP_PASSWORD=$pw`r`nPORT=3007" | Set-Content -Path .env -Encoding ascii
    Ok 'Saved .env'
  }

  # ---- 5. Start Menu shortcut ----
  try {
    $nodeExe  = Find-NodeExe
    $programs = [Environment]::GetFolderPath('Programs')
    $lnk      = Join-Path $programs 'The Forge.lnk'
    $ws       = New-Object -ComObject WScript.Shell
    $sc       = $ws.CreateShortcut($lnk)
    $sc.TargetPath       = $nodeExe
    $sc.Arguments        = 'server.js'
    $sc.WorkingDirectory = $Dir
    $sc.Description       = 'The Forge'
    $icon = Join-Path $Dir 'public\favicon.ico'
    if (Test-Path $icon) { $sc.IconLocation = $icon }
    $sc.Save()
    Ok 'Start Menu shortcut created ("The Forge")'
  } catch {
    Warn "Could not create Start Menu shortcut: $($_.Exception.Message)"
  }

  # ---- 6. optional: run at logon via Scheduled Task ----
  if ($Service) {
    try {
      $nodeExe = Find-NodeExe
      $action  = New-ScheduledTaskAction -Execute $nodeExe -Argument 'server.js' -WorkingDirectory $Dir
      $trigger = New-ScheduledTaskTrigger -AtLogOn
      $set     = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
      Register-ScheduledTask -TaskName 'The Forge' -Action $action -Trigger $trigger -Settings $set -Force | Out-Null
      Start-ScheduledTask -TaskName 'The Forge'
      Ok 'Scheduled Task "The Forge" registered - starts at logon and is running now'
      Write-Host ''
      Write-Host '+ The Forge is installed and running.' -ForegroundColor Green
      Write-Host '  Open:    http://localhost:3007' -ForegroundColor Cyan
      Write-Host '  Manage:  Task Scheduler -> "The Forge"' -ForegroundColor White
      Finish 0
    } catch {
      Warn "Could not register Scheduled Task: $($_.Exception.Message)"
      Write-Host '  You can still start it manually below.' -ForegroundColor DarkGray
    }
  }

  # ---- 7. done ----
  Write-Host ''
  Write-Host '+ The Forge is installed.' -ForegroundColor Green
  Write-Host ''
  Write-Host "  Start it:   cd `"$Dir`"; npm start" -ForegroundColor White
  Write-Host '  Then open:  http://localhost:3007' -ForegroundColor Cyan
  Write-Host '  At logon:   re-run with -Service (or use the Start Menu shortcut)' -ForegroundColor White
  Write-Host ''

  $ans = Read-Host 'Start The Forge now? [Y/n]'
  if ($ans -match '^[Nn]') {
    Write-Host '  Run "npm start" when you are ready.' -ForegroundColor DarkGray
    Finish 0
  } else {
    Write-Host ''
    Write-Host '  Starting... open http://localhost:3007 in your browser.' -ForegroundColor Cyan
    Write-Host '  (Close this window or press Ctrl+C to stop the server.)' -ForegroundColor DarkGray
    Write-Host ''
    # Server runs in the foreground; no keypress pause needed after it.
    $NoPause = $true
    if ($script:Transcribing) { try { Stop-Transcript | Out-Null } catch {} ; $script:Transcribing = $false }
    & $npmCmd start
    exit 0
  }
}
catch {
  # Anything unexpected lands here so the window never just disappears.
  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Red
  Write-Host '  The Forge installer hit an unexpected error.' -ForegroundColor Red
  Write-Host '============================================================' -ForegroundColor Red
  Write-Host ("  {0}" -f $_.Exception.Message) -ForegroundColor Yellow
  if ($_.InvocationInfo -and $_.InvocationInfo.PositionMessage) {
    Write-Host ''
    Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor DarkGray
  }
  Write-Host ''
  Write-Host '  Send the log file below to whoever set this up.' -ForegroundColor White
  Finish 1
}
