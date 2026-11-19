# macOS: MacBook Pro (Mac17,2), Apple M5

Captured on the development Mac on 2026-11-19 (macOS 27.2, build 26B123).

- `system_profiler.json` is the output of
  `/usr/sbin/system_profiler -json SPDisplaysDataType SPHardwareDataType`.
  These fields were replaced by `REDACTED`: `serial_number`, `platform_UUID`,
  `provisioning_UDID` and `model_number` in `SPHardwareDataType`, and
  `_spdisplays_display-serial-number` of the built-in display. Nothing else was changed.
- `sysctl.txt` is the output of
  `sysctl hw.memsize hw.ncpu hw.physicalcpu hw.nperflevels hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu hw.optional.arm64 hw.optional.avx2_0 machdep.cpu.brand_string kern.osproductversion kern.osversion`.
  `hw.optional.avx2_0` is absent from the output: on Apple Silicon sysctl leaves a missing
  `hw.optional.*` key out and still exits 0. Aji reads CPU, memory and OS facts through `sysinfo`,
  so this file is the reference for the Mac exit check rather than a parser input.
