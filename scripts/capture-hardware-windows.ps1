<#
.SYNOPSIS
  Captures what Aji's hardware detection reads on Windows, as JSON test fixtures.

.DESCRIPTION
  Writes aji-hardware-capture.json into the current folder. It holds the facts Aji's M3 hardware
  detection uses: the DXGI adapter descriptions, the WMI video controllers, nvidia-smi's GPU query,
  the CPU, memory and Windows version. Each section is captured independently, so one failure
  leaves the others intact and records its error.

  Nothing identifying is written: no computer name, no user name, no GPU UUID or serial number,
  and PNP device ids are cut before their instance part. Read the file before sending it.

  Run it from PowerShell (Windows PowerShell 5.1 or PowerShell 7):
    powershell -ExecutionPolicy Bypass -File .\capture-hardware-windows.ps1

  The -ExecutionPolicy Bypass applies to that one process only; no setting changes.
#>

$ErrorActionPreference = 'Stop'
$capture = [ordered]@{
  schema   = 1
  captured = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  tool     = 'scripts/capture-hardware-windows.ps1'
}

function Capture([string]$name, [scriptblock]$block) {
  try {
    $capture[$name] = & $block
  } catch {
    $capture[$name] = [ordered]@{ error = $_.Exception.Message }
  }
}

$dxgiSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace AjiCapture {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DXGI_ADAPTER_DESC1 {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
    public uint VendorId;
    public uint DeviceId;
    public uint SubSysId;
    public uint Revision;
    public UIntPtr DedicatedVideoMemory;
    public UIntPtr DedicatedSystemMemory;
    public UIntPtr SharedSystemMemory;
    public uint LuidLowPart;
    public int LuidHighPart;
    public uint Flags;
  }

  // Only the methods called are typed; the others hold their vtable slots.
  [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IDXGIAdapter1 {
    void SetPrivateData();
    void SetPrivateDataInterface();
    void GetPrivateData();
    void GetParent();
    void EnumOutputs();
    void GetDesc();
    [PreserveSig] int CheckInterfaceSupport([In] ref Guid interfaceName, out long umdVersion);
    [PreserveSig] int GetDesc1(out DXGI_ADAPTER_DESC1 desc);
  }

  [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IDXGIFactory1 {
    void SetPrivateData();
    void SetPrivateDataInterface();
    void GetPrivateData();
    void GetParent();
    void EnumAdapters();
    void MakeWindowAssociation();
    void GetWindowAssociation();
    void CreateSwapChain();
    void CreateSoftwareAdapter();
    [PreserveSig] int EnumAdapters1(uint index, out IDXGIAdapter1 adapter);
  }

  public static class Dxgi {
    [DllImport("dxgi.dll")]
    static extern int CreateDXGIFactory1([In] ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IDXGIFactory1 factory);

    const int DXGI_ERROR_NOT_FOUND = unchecked((int)0x887A0002);

    public static List<Dictionary<string, object>> Adapters() {
      Guid factoryId = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
      Guid deviceId = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c"); // IDXGIDevice
      IDXGIFactory1 factory;
      int hr = CreateDXGIFactory1(ref factoryId, out factory);
      if (hr != 0) throw new Exception("CreateDXGIFactory1 failed: 0x" + hr.ToString("X8"));
      List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
      for (uint i = 0; ; i++) {
        IDXGIAdapter1 adapter;
        hr = factory.EnumAdapters1(i, out adapter);
        if (hr == DXGI_ERROR_NOT_FOUND) break;
        if (hr != 0) throw new Exception("EnumAdapters1 failed: 0x" + hr.ToString("X8"));
        DXGI_ADAPTER_DESC1 d;
        hr = adapter.GetDesc1(out d);
        if (hr != 0) throw new Exception("GetDesc1 failed: 0x" + hr.ToString("X8"));
        Dictionary<string, object> a = new Dictionary<string, object>();
        a["index"] = i;
        a["description"] = d.Description;
        a["vendorId"] = "0x" + d.VendorId.ToString("X4");
        a["deviceId"] = "0x" + d.DeviceId.ToString("X4");
        a["subSysId"] = "0x" + d.SubSysId.ToString("X8");
        a["revision"] = d.Revision;
        a["dedicatedVideoMemory"] = d.DedicatedVideoMemory.ToUInt64();
        a["dedicatedSystemMemory"] = d.DedicatedSystemMemory.ToUInt64();
        a["sharedSystemMemory"] = d.SharedSystemMemory.ToUInt64();
        a["flags"] = d.Flags;
        long umd;
        hr = adapter.CheckInterfaceSupport(ref deviceId, out umd);
        if (hr == 0) {
          a["umdVersion"] = string.Format("{0}.{1}.{2}.{3}",
            (umd >> 48) & 0xFFFF, (umd >> 32) & 0xFFFF, (umd >> 16) & 0xFFFF, umd & 0xFFFF);
        } else {
          a["umdVersion"] = null;
          a["umdVersionError"] = "0x" + hr.ToString("X8");
        }
        result.Add(a);
        Marshal.ReleaseComObject(adapter);
      }
      Marshal.ReleaseComObject(factory);
      return result;
    }
  }
}
'@

Capture 'dxgi' {
  Add-Type -TypeDefinition $dxgiSource -Language CSharp
  , [AjiCapture.Dxgi]::Adapters()
}

Capture 'wmiVideoControllers' {
  , @(Get-CimInstance Win32_VideoController | ForEach-Object {
      [ordered]@{
        name                 = $_.Name
        adapterCompatibility = $_.AdapterCompatibility
        videoProcessor       = $_.VideoProcessor
        adapterRam           = $_.AdapterRAM
        driverVersion        = $_.DriverVersion
        driverDate           = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { $null }
        # Keep PCI\VEN_xxxx&DEV_xxxx&SUBSYS_xxxxxxxx&REV_xx; drop the instance part.
        pnpDeviceId          = if ($_.PNPDeviceID) { ($_.PNPDeviceID -split '\\')[0..1] -join '\' } else { $null }
        status               = $_.Status
      }
    })
}

function Find-NvidiaSmi {
  $candidates = @()
  $onPath = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }
  $candidates += "$env:SystemRoot\System32\nvidia-smi.exe"
  $candidates += "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  return $null
}

Capture 'nvidiaSmi' {
  # Under 'Stop', Windows PowerShell 5.1 turns a native program's stderr line into an error.
  $ErrorActionPreference = 'Continue'
  $smi = Find-NvidiaSmi
  if (-not $smi) { return [ordered]@{ present = $false } }
  $result = [ordered]@{ present = $true; location = (Split-Path $smi -Parent) -replace [regex]::Escape($env:SystemRoot), '%SystemRoot%' }
  # Each query runs on its own: nvidia-smi rejects the whole query if one field is unknown.
  $queries = [ordered]@{
    base       = 'index,name,memory.total,driver_version,pci.device_id,pci.sub_device_id'
    computeCap = 'index,compute_cap'
  }
  foreach ($key in $queries.Keys) {
    $out = & $smi "--query-gpu=$($queries[$key])" --format=csv 2>&1
    $result[$key] = [ordered]@{ exitCode = $LASTEXITCODE; stdout = @($out | ForEach-Object { "$_" }) }
  }
  $version = & $smi --version 2>&1
  $result['version'] = [ordered]@{ exitCode = $LASTEXITCODE; stdout = @($version | ForEach-Object { "$_" }) }
  $result
}

Capture 'cpu' {
  , @(Get-CimInstance Win32_Processor | ForEach-Object {
      [ordered]@{
        name                      = $_.Name
        manufacturer              = $_.Manufacturer
        numberOfCores             = $_.NumberOfCores
        numberOfLogicalProcessors = $_.NumberOfLogicalProcessors
        architecture              = $_.Architecture
      }
    })
}

Capture 'cpuFeatures' {
  Add-Type -Namespace AjiCapture -Name Kernel32 -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(uint feature);'
  [ordered]@{
    # PF_AVX_INSTRUCTIONS_AVAILABLE = 39, PF_AVX2_INSTRUCTIONS_AVAILABLE = 40
    avx  = [AjiCapture.Kernel32]::IsProcessorFeaturePresent(39)
    avx2 = [AjiCapture.Kernel32]::IsProcessorFeaturePresent(40)
  }
}

Capture 'memory' {
  $cs = Get-CimInstance Win32_ComputerSystem
  [ordered]@{ totalPhysicalMemory = $cs.TotalPhysicalMemory }
}

Capture 'os' {
  $os = Get-CimInstance Win32_OperatingSystem
  $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  [ordered]@{
    caption        = $os.Caption
    version        = $os.Version
    buildNumber    = $os.BuildNumber
    osArchitecture = $os.OSArchitecture
    displayVersion = $cv.DisplayVersion
    currentBuild   = $cv.CurrentBuild
    ubr            = $cv.UBR
  }
}

Capture 'session' {
  # "Console" locally; "RDP-Tcp#N" over Remote Desktop, where Windows shows the Basic Render Driver.
  [ordered]@{ sessionName = $env:SESSIONNAME }
}

$json = $capture | ConvertTo-Json -Depth 8
# Last guard against identifying text.
foreach ($secret in @($env:COMPUTERNAME, $env:USERNAME, $env:USERDOMAIN)) {
  if ($secret -and $secret.Length -ge 3) { $json = $json -replace [regex]::Escape($secret), 'REDACTED' }
}
$path = Join-Path (Get-Location) 'aji-hardware-capture.json'
[System.IO.File]::WriteAllText($path, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $path"
