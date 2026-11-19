<#
.SYNOPSIS
  Benchmarks every KataGo backend Aji could pick for an NVIDIA GPU on Windows: CUDA 13.2, CUDA 12.8,
  DirectML and OpenCL.

.DESCRIPTION
  Aji's install manifest is the single source of URLs, sizes and hashes. Copy it next to this script
  as manifest.json (or pass -Manifest). The script takes the newest KataGo version that has a Windows
  CUDA engine, and runs `katago.exe benchmark -v 800` for each of the four engines and each network.

  Run it from PowerShell (Windows PowerShell 5.1 or PowerShell 7), from a folder with room to spare:
    powershell -ExecutionPolicy Bypass -File .\benchmark-windows.ps1
    powershell -ExecutionPolicy Bypass -File .\benchmark-windows.ps1 -Network kata1-b18c384nbt-s9996604416-d4316597426

  The -ExecutionPolicy Bypass applies to that one process only; no setting changes.

  Networks: by default rows 1, 3 and 7 of the manifest's main networks (it lists them by Elo, highest
  first). -Network <id>... overrides that with the ids you name.

  What gets downloaded, into aji-benchmarks\ in the current folder (re-runs reuse and re-verify it):
    - the NVIDIA CUDA/cuDNN runtime files: about 1.95 GB for the CUDA 13.2 set and 1.54 GB for the
      CUDA 12.8 set. Only the needed DLLs are kept; each archive is deleted after extraction.
      You must read the NVIDIA licences the script prints and type "accept" first. Anything else
      skips the CUDA engines, and DirectML and OpenCL still run.
    - the four KataGo engine zips (about 10 MB each) and the networks (roughly 100 to 260 MB each).
  Every download is checked against the size and hash in the manifest before use.

  The benchmark takes a while: each run can last many minutes and a run is stopped after
  -TimeoutMinutes (default 30), which counts as a failure. A section that fails reports its error
  and the script carries on with the rest.

  Output:
    aji-benchmarks\<engine id>\<network id>.stdout.txt and .stderr.txt
    aji-benchmarks\summary.json
  The summary holds, per run, the engine, network, exit code, duration and best visits/s. Paths in it
  are relative to aji-benchmarks. Your computer name, user name and the full path of the folder are
  replaced in the output files too, but read them before sending.

  Nothing is written outside aji-benchmarks\ and no setting changes: the NVIDIA runtime folder is
  put in front of PATH for the benchmark process only, never for your session or machine, and
  KataGo's own data folder (OpenCL tuning files) is pointed inside aji-benchmarks\ as well.
#>

param(
  [string[]]$Network,
  [string]$Manifest,
  [int]$TimeoutMinutes = 30
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Windows PowerShell 5.1 does not enable TLS 1.2 by default. This affects this process only.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
if (-not $Manifest) { $Manifest = Join-Path $scriptDir 'manifest.json' }

$root = Join-Path (Get-Location).Path 'aji-benchmarks'
$dirDownloads = Join-Path $root 'downloads'
$dirEngines = Join-Path $root 'engines'
$dirRuntimes = Join-Path $root 'runtimes'
$dirNetworks = Join-Path $root 'networks'
$dirHome = Join-Path $root 'katago-home'

$summary = [ordered]@{
  schema    = 1
  generated = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  tool      = 'scripts/benchmark-windows.ps1'
  visits    = 800
  gpu       = $null
  manifest  = $null
  engines   = @()
  networks  = @()
  notes     = @()
  runs      = @()
}

function Add-Note([string]$text) {
  $text = Hide-Identity $text
  Write-Host "NOTE: $text"
  $script:summary.notes = @($script:summary.notes) + $text
}

function Save-Summary {
  try {
    $json = Hide-Identity ($summary | ConvertTo-Json -Depth 8)
    [System.IO.File]::WriteAllText((Join-Path $root 'summary.json'), $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    Write-Host "Could not write summary.json: $($_.Exception.Message)"
  }
}

# Hides the machine and user identity, and the absolute path of aji-benchmarks, in text.
function Hide-Identity([string]$text) {
  if (-not $text) { return $text }
  $text = [regex]::Replace($text, [regex]::Escape($root), 'aji-benchmarks', 'IgnoreCase')
  $text = [regex]::Replace($text, [regex]::Escape($root.Replace('\', '/')), 'aji-benchmarks', 'IgnoreCase')
  foreach ($secret in @($env:COMPUTERNAME, $env:USERNAME, $env:USERDOMAIN)) {
    if ($secret -and $secret.Length -ge 3) { $text = [regex]::Replace($text, [regex]::Escape($secret), 'REDACTED', 'IgnoreCase') }
  }
  return $text
}

function Write-Utf8([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function New-Dir([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { [void](New-Item -ItemType Directory -Path $path -Force) }
}

# Checks a file against the manifest's size and "algorithm:hex" digest.
function Test-FileDigest([string]$path, [long]$size, [string]$digest) {
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  if ((Get-Item -LiteralPath $path).Length -ne $size) { return $false }
  $parts = $digest -split ':', 2
  if ($parts.Count -ne 2) { return $false }
  $algorithm = $parts[0].ToUpperInvariant()
  if ($algorithm -ne 'SHA256' -and $algorithm -ne 'MD5') { return $false }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm $algorithm).Hash
  return ($actual -ieq $parts[1])
}

# Downloads from the first URL that gives a file matching size and digest. Reuses a verified file.
function Get-VerifiedFile([string[]]$urls, [string]$path, [long]$size, [string]$digest, [string]$label) {
  if (Test-Path -LiteralPath $path) {
    if (Test-FileDigest $path $size $digest) {
      Write-Host "  $label : already downloaded and verified"
      return $true
    }
    Write-Host "  $label : existing file does not match the manifest, downloading again"
    Remove-Item -LiteralPath $path -Force
  }
  $part = $path + '.part'
  foreach ($url in $urls) {
    try {
      Write-Host "  $label : downloading $url"
      if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $part
      if (-not (Test-FileDigest $part $size $digest)) {
        throw 'the size or digest does not match the manifest'
      }
      Move-Item -LiteralPath $part -Destination $path -Force
      Write-Host "  $label : verified"
      return $true
    } catch {
      Write-Host "  $label : failed from this source: $($_.Exception.Message)"
      if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }
    }
  }
  return $false
}

function Join-Url([string]$base, [string]$relative) {
  return ($base.TrimEnd('/') + '/' + $relative.TrimStart('/'))
}

# Extracts zip entries whose file name matches a pattern, from any folder, flat into $dest. When several
# entries share a name, the one under x64 wins, then the one under bin. Returns the patterns that matched nothing.
function Expand-Dlls([string]$zipPath, [string[]]$patterns, [string]$dest) {
  $missing = @()
  $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    foreach ($pattern in $patterns) {
      $best = @{}
      $scores = @{}
      foreach ($entry in $zip.Entries) {
        if (-not $entry.Name) { continue }
        if (-not ($entry.Name -like $pattern)) { continue }
        $score = 0
        if ($entry.FullName -match '(^|/)bin/') { $score = 1 }
        if ($entry.FullName -match '(^|/)x64/') { $score = $score + 2 }
        if (-not $best.ContainsKey($entry.Name) -or $score -gt $scores[$entry.Name]) {
          $best[$entry.Name] = $entry
          $scores[$entry.Name] = $score
        }
      }
      if ($best.Count -eq 0) { $missing += $pattern; continue }
      foreach ($name in $best.Keys) {
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($best[$name], (Join-Path $dest $name), $true)
      }
    }
  } finally {
    $zip.Dispose()
  }
  return $missing
}

# True when every extract pattern of every component already has a file in $dest.
function Test-RuntimeComplete($runtime, [string]$dest) {
  if (-not (Test-Path -LiteralPath (Join-Path $dest '.verified'))) { return $false }
  foreach ($component in @($runtime.components)) {
    foreach ($pattern in @($component.extract)) {
      if (-not (Get-ChildItem -LiteralPath $dest -File -Filter $pattern -ErrorAction SilentlyContinue)) { return $false }
    }
  }
  return $true
}

# Downloads a runtime set's archives one at a time, verifies them, keeps only the DLLs, deletes the archives.
function Install-Runtime($runtime) {
  $dest = Join-Path $dirRuntimes $runtime.id
  if (Test-RuntimeComplete $runtime $dest) {
    Write-Host "  $($runtime.id): already installed"
    return $dest
  }
  New-Dir $dest
  $okAll = $true
  foreach ($component in @($runtime.components)) {
    $label = "$($component.name) $($component.version)"
    $archive = Join-Path $dirDownloads ([System.IO.Path]::GetFileName($component.archive.path))
    $urls = @($component.hosts | ForEach-Object { Join-Url $_ $component.archive.path })
    $ok = Get-VerifiedFile $urls $archive ([long]$component.archive.size) ([string]$component.archive.digest) $label
    if (-not $ok) {
      Add-Note "Could not download $label for $($runtime.id)."
      $okAll = $false
      continue
    }
    try {
      $missing = @(Expand-Dlls $archive @($component.extract) $dest)
      if ($missing.Count -gt 0) {
        throw "no match in the archive for: $($missing -join ', ')"
      }
      Write-Host "  $label : extracted"
    } catch {
      Add-Note "Could not extract $label for $($runtime.id): $($_.Exception.Message)"
      $okAll = $false
    } finally {
      Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not $okAll) { return $null }
  Write-Utf8 (Join-Path $dest '.verified') "ok`n"
  return $dest
}

# Parses KataGo's benchmark output: the best final visits/s (only "N / N positions" readings, never the
# partial progress ones) and the thread count marked (recommended).
function Read-BenchmarkOutput([string]$text) {
  $best = $null
  $recommended = $null
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  foreach ($m in [regex]::Matches($text, '\b(\d+) / \1 positions, visits/s = ([0-9]+(?:\.[0-9]+)?)')) {
    $v = [double]::Parse($m.Groups[2].Value, $culture)
    if ($null -eq $best -or $v -gt $best) { $best = $v }
  }
  foreach ($line in ($text -split "\r?\n")) {
    $r = [regex]::Match($line, 'numSearchThreads\s*=\s*(\d+):.*\(recommended\)')
    if ($r.Success) { $recommended = [int]$r.Groups[1].Value }
  }
  return [ordered]@{ visitsPerSecond = $best; recommendedThreads = $recommended }
}

# Runs katago.exe with the runtime folder (if any) in front of PATH for that child process only.
function Invoke-Katago([string]$exe, [string]$arguments, [string]$workDir, [string]$runtimeDir, [int]$timeoutMinutes) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = $arguments
  $psi.WorkingDirectory = $workDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  if ($runtimeDir) {
    $currentPath = $psi.EnvironmentVariables['PATH']
    if ($currentPath) { $psi.EnvironmentVariables['PATH'] = $runtimeDir + ';' + $currentPath }
    else { $psi.EnvironmentVariables['PATH'] = $runtimeDir }
  }
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $process = [System.Diagnostics.Process]::Start($psi)
  # Reading both streams asynchronously keeps a full pipe from stalling KataGo.
  $outTask = $process.StandardOutput.ReadToEndAsync()
  $errTask = $process.StandardError.ReadToEndAsync()
  $timedOut = $false
  if (-not $process.WaitForExit($timeoutMinutes * 60 * 1000)) {
    $timedOut = $true
    try { $process.Kill() } catch { }
    $process.WaitForExit()
  }
  $watch.Stop()
  [void]$outTask.Wait(15000)
  [void]$errTask.Wait(15000)
  $stdout = ''
  $stderr = ''
  if ($outTask.IsCompleted) { $stdout = $outTask.Result }
  if ($errTask.IsCompleted) { $stderr = $errTask.Result }
  $exitCode = $null
  if (-not $timedOut) { $exitCode = $process.ExitCode }
  $process.Dispose()
  return [ordered]@{
    exitCode = $exitCode
    timedOut = $timedOut
    seconds  = [math]::Round($watch.Elapsed.TotalSeconds, 1)
    stdout   = $stdout
    stderr   = $stderr
  }
}

New-Dir $root
New-Dir $dirDownloads
Write-Host "Writing to $root"

# ---- GPU name -------------------------------------------------------------------------------------
try {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $smi = $null
  $onPath = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  if ($onPath) { $smi = $onPath.Source }
  elseif (Test-Path "$env:SystemRoot\System32\nvidia-smi.exe") { $smi = "$env:SystemRoot\System32\nvidia-smi.exe" }
  elseif (Test-Path "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe") { $smi = "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe" }
  if ($smi) {
    $out = & $smi --query-gpu=name,driver_version --format=csv,noheader 2>&1
    if ($LASTEXITCODE -eq 0) { $summary.gpu = @($out | ForEach-Object { "$_" }) }
    else { Add-Note "nvidia-smi exited with code $LASTEXITCODE." }
  } else {
    Add-Note 'nvidia-smi was not found, so the GPU name is not recorded.'
  }
  $ErrorActionPreference = $oldPreference
} catch {
  $ErrorActionPreference = 'Stop'
  Add-Note "GPU query failed: $($_.Exception.Message)"
}

# ---- Manifest and choices -------------------------------------------------------------------------
$manifest = $null
try {
  if (-not (Test-Path -LiteralPath $Manifest)) { throw "manifest not found: copy it next to this script as manifest.json, or pass -Manifest" }
  $manifest = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.schema -ne 1) { throw "unsupported manifest schema $($manifest.schema)" }
  $summary.manifest = [ordered]@{ schema = $manifest.schema; sequence = $manifest.sequence; generated = $manifest.generated }
} catch {
  Add-Note "Cannot read the manifest: $($_.Exception.Message)"
  Save-Summary
  Write-Host 'Nothing to benchmark without the manifest.'
  return
}

$engines = @()
try {
  $windows = @($manifest.engines | Where-Object { $_.platform -eq 'windows-x64' })
  $cudaEngines = @($windows | Where-Object { $_.backend -eq 'cuda' })
  if ($cudaEngines.Count -eq 0) { throw 'the manifest has no Windows CUDA engine' }
  $newest = $null
  foreach ($e in $cudaEngines) {
    try { $v = [version](([string]$e.version) -replace '[-+].*$', '') } catch { continue }
    if ($null -eq $newest -or $v -gt $newest) { $newest = $v }
  }
  if ($null -eq $newest) { throw 'no Windows CUDA engine has a readable version' }
  $sameVersion = @($windows | Where-Object {
      try { ([version](([string]$_.version) -replace '[-+].*$', '')) -eq $newest } catch { $false }
    })
  $wanted = @(
    @{ label = 'cuda13.2'; test = { param($e) $e.backend -eq 'cuda' -and ([string]$e.variant) -like 'cuda13.2*' } },
    @{ label = 'cuda12.8'; test = { param($e) $e.backend -eq 'cuda' -and ([string]$e.variant) -like 'cuda12.8*' } },
    @{ label = 'directml'; test = { param($e) $e.backend -eq 'directml' } },
    @{ label = 'opencl'; test = { param($e) $e.backend -eq 'opencl' } }
  )
  foreach ($w in $wanted) {
    $match = $null
    foreach ($e in $sameVersion) { if (& $w.test $e) { $match = $e; break } }
    if ($match) { $engines += $match }
    else { Add-Note "No $($w.label) Windows engine for KataGo $newest in the manifest; skipping it." }
  }
  Write-Host "KataGo $newest, engines: $(($engines | ForEach-Object { $_.id }) -join ', ')"
} catch {
  Add-Note "Cannot choose the engines: $($_.Exception.Message)"
}

$networks = @()
try {
  $mainNetworks = @($manifest.networks | Where-Object { $_.kind -eq 'main' })
  if ($Network -and $Network.Count -gt 0) {
    foreach ($id in $Network) {
      $match = $manifest.networks | Where-Object { $_.id -eq $id } | Select-Object -First 1
      if ($match) { $networks += $match } else { Add-Note "Network $id is not in the manifest; skipping it." }
    }
  } else {
    # Rows 1, 3 and 7 of the Elo-ordered table are positions 0, 2 and 6.
    foreach ($i in @(0, 2, 6)) {
      if ($i -lt $mainNetworks.Count) { $networks += $mainNetworks[$i] }
      else { Add-Note "The manifest has only $($mainNetworks.Count) main networks, so row $($i + 1) is skipped." }
    }
  }
  Write-Host "Networks: $(($networks | ForEach-Object { $_.id }) -join ', ')"
} catch {
  Add-Note "Cannot choose the networks: $($_.Exception.Message)"
}

foreach ($e in $engines) { $summary.engines += [ordered]@{ id = $e.id; version = [string]$e.version; backend = $e.backend; variant = $e.variant } }
foreach ($n in $networks) { $summary.networks += [ordered]@{ id = $n.id; elo = $n.elo } }
Save-Summary

# ---- NVIDIA licences and runtimes -----------------------------------------------------------------
$runtimeDirs = @{}
$cudaSelected = @($engines | Where-Object { $_.backend -eq 'cuda' })
if ($cudaSelected.Count -gt 0) {
  $runtimeIds = @($cudaSelected | ForEach-Object { $_.runtime } | Where-Object { $_ } | Select-Object -Unique)
  $sets = @()
  foreach ($id in $runtimeIds) {
    $set = $manifest.runtimes | Where-Object { $_.id -eq $id } | Select-Object -First 1
    if ($set) { $sets += $set } else { Add-Note "Runtime set $id is not in the manifest." }
  }
  $accepted = $false
  try {
    Write-Host ''
    Write-Host '================ NVIDIA licences ================'
    Write-Host 'The CUDA engines need NVIDIA runtime files that this script downloads from NVIDIA.'
    Write-Host 'They are not part of Aji or KataGo and are under NVIDIA licences:'
    foreach ($set in $sets) {
      Write-Host ''
      Write-Host "Set: $($set.id)"
      foreach ($component in @($set.components)) {
        Write-Host "  - $($component.name) $($component.version)"
        Write-Host "    Licence: $($component.licence.name)"
        Write-Host "    URL:     $($component.licence.url)"
      }
      Write-Host "  Notice: $($set.notice)"
    }
    Write-Host ''
    $answer = Read-Host 'Type "accept" to download them, anything else skips the CUDA engines'
    if ($answer -and $answer.Trim() -eq 'accept') { $accepted = $true }
  } catch {
    Add-Note "Could not ask for the licence answer: $($_.Exception.Message)"
  }
  if (-not $accepted) {
    Add-Note 'NVIDIA licences were not accepted; the CUDA engines are skipped. DirectML and OpenCL still run.'
    $engines = @($engines | Where-Object { $_.backend -ne 'cuda' })
  } else {
    foreach ($set in $sets) {
      Write-Host "Preparing runtime $($set.id)"
      try {
        $dir = Install-Runtime $set
        if ($dir) { $runtimeDirs[$set.id] = $dir }
      } catch {
        Add-Note "Runtime $($set.id) failed: $($_.Exception.Message)"
      }
    }
  }
}

# ---- Networks -------------------------------------------------------------------------------------
$networkFiles = @{}
if ($networks.Count -gt 0) { New-Dir $dirNetworks }
foreach ($n in $networks) {
  try {
    Write-Host "Network $($n.id)"
    $path = Join-Path $dirNetworks $n.file.name
    $ok = Get-VerifiedFile @($n.file.urls) $path ([long]$n.file.size) ([string]$n.file.digest) $n.id
    if ($ok) { $networkFiles[$n.id] = $path } else { Add-Note "Could not download network $($n.id)." }
  } catch {
    Add-Note "Network $($n.id) failed: $($_.Exception.Message)"
  }
}

# ---- Engines and runs -----------------------------------------------------------------------------
foreach ($engine in $engines) {
  Write-Host ''
  Write-Host "Engine $($engine.id)"
  $runtimeDir = $null
  try {
    if ($engine.backend -eq 'cuda') {
      if (-not $engine.runtime -or -not $runtimeDirs.ContainsKey($engine.runtime)) {
        throw 'its NVIDIA runtime is not available'
      }
      $runtimeDir = $runtimeDirs[$engine.runtime]
    }
    New-Dir $dirEngines
    $zipPath = Join-Path $dirDownloads $engine.file.name
    if (-not (Get-VerifiedFile @($engine.file.urls) $zipPath ([long]$engine.file.size) ([string]$engine.file.digest) $engine.id)) {
      throw 'the engine download failed'
    }
    $engineDir = Join-Path $dirEngines $engine.id
    $exe = $null
    if (Test-Path -LiteralPath $engineDir) { $exe = Get-ChildItem -LiteralPath $engineDir -Recurse -File -Filter 'katago.exe' | Select-Object -First 1 }
    if (-not $exe) {
      if (Test-Path -LiteralPath $engineDir) { Remove-Item -LiteralPath $engineDir -Recurse -Force }
      [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $engineDir)
      $exe = Get-ChildItem -LiteralPath $engineDir -Recurse -File -Filter 'katago.exe' | Select-Object -First 1
    }
    if (-not $exe) { throw 'katago.exe is not in the engine zip' }
    $exeDir = $exe.DirectoryName

    # Generated config: the stock default_gtp.cfg plus the engine's own settings.
    $extra = @()
    $extraKeys = @()
    if ($engine.config) {
      foreach ($property in $engine.config.PSObject.Properties) {
        $extra += "$($property.Name) = $($property.Value)"
        $extraKeys += $property.Name
      }
    }
    $extra += 'homeDataDir = ' + $dirHome.Replace('\', '/')
    $extraKeys += 'homeDataDir'
    $baseCfg = Join-Path $exeDir 'default_gtp.cfg'
    $configPath = Join-Path $engineDir 'benchmark_gtp.cfg'
    if (Test-Path -LiteralPath $baseCfg) {
      # KataGo rejects a key given twice, so drop uncommented lines of the keys set below.
      $keptLines = @()
      foreach ($cfgLine in ([System.IO.File]::ReadAllText($baseCfg) -split "\r?\n")) {
        $drop = $false
        foreach ($key in $extraKeys) {
          if ($cfgLine -match ('^\s*' + [regex]::Escape($key) + '\s*=')) { $drop = $true }
        }
        if (-not $drop) { $keptLines += $cfgLine }
      }
      $baseText = $keptLines -join "`r`n"
      Write-Utf8 $configPath ($baseText.TrimEnd() + "`r`n`r`n# Added by benchmark-windows.ps1`r`n" + ($extra -join "`r`n") + "`r`n")
    } else {
      Add-Note "$($engine.id): default_gtp.cfg is not in the zip; using a minimal config with only the engine settings."
      Write-Utf8 $configPath ("# Written by benchmark-windows.ps1`r`n" + ($extra -join "`r`n") + "`r`n")
    }
    New-Dir $dirHome

    $resultDir = Join-Path $root $engine.id
    New-Dir $resultDir
    foreach ($n in $networks) {
      $run = [ordered]@{
        engine             = $engine.id
        network            = $n.id
        exitCode           = $null
        seconds            = $null
        visitsPerSecond    = $null
        recommendedThreads = $null
        timedOut           = $false
        stdout             = $null
        stderr             = $null
        error              = $null
      }
      try {
        if (-not $networkFiles.ContainsKey($n.id)) { throw 'the network is not available' }
        Write-Host "  Benchmarking $($engine.id) with $($n.id) (can take several minutes)"
        $arguments = 'benchmark -config "' + $configPath + '" -model "' + $networkFiles[$n.id] + '" -v 800'
        $result = Invoke-Katago $exe.FullName $arguments $exeDir $runtimeDir $TimeoutMinutes
        $stdoutText = Hide-Identity $result.stdout
        $stderrText = Hide-Identity $result.stderr
        Write-Utf8 (Join-Path $resultDir "$($n.id).stdout.txt") $stdoutText
        Write-Utf8 (Join-Path $resultDir "$($n.id).stderr.txt") $stderrText
        $run.stdout = "$($engine.id)/$($n.id).stdout.txt"
        $run.stderr = "$($engine.id)/$($n.id).stderr.txt"
        $run.exitCode = $result.exitCode
        $run.seconds = $result.seconds
        $run.timedOut = $result.timedOut
        $parsed = Read-BenchmarkOutput $stdoutText
        if ($null -eq $parsed.visitsPerSecond) { $parsed = Read-BenchmarkOutput ($stdoutText + "`n" + $stderrText) }
        $run.visitsPerSecond = $parsed.visitsPerSecond
        $run.recommendedThreads = $parsed.recommendedThreads
        if ($result.timedOut) {
          $run.error = "timed out after $TimeoutMinutes minutes"
          Write-Host "  FAILED: $($run.error)"
        } elseif ($result.exitCode -ne 0) {
          $run.error = "exit code $($result.exitCode)"
          Write-Host "  FAILED: $($run.error)"
        } elseif ($null -eq $run.visitsPerSecond) {
          $run.error = 'no visits/s found in the output'
          Write-Host "  FAILED: $($run.error)"
        } else {
          Write-Host "  Best visits/s: $($run.visitsPerSecond)"
        }
      } catch {
        $run.error = Hide-Identity $_.Exception.Message
        Write-Host "  FAILED: $($run.error)"
      }
      $summary.runs = @($summary.runs) + , $run
      Save-Summary
    }
  } catch {
    Add-Note "Engine $($engine.id) failed: $(Hide-Identity $_.Exception.Message)"
    Save-Summary
  }
}

Save-Summary
Write-Host ''
Write-Host "Wrote $(Join-Path $root 'summary.json')"
foreach ($run in $summary.runs) {
  $line = '{0} | {1} | {2}' -f $run.engine, $run.network, $(if ($run.error) { 'FAILED: ' + $run.error } else { "$($run.visitsPerSecond) visits/s" })
  Write-Host $line
}
