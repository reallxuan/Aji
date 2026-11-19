# Linux sysfs tree (synthetic)

Hand-made; there is no Linux GPU machine to capture from. `sys/class/drm` holds an AMD card
(`card0`, device 0x744c, 16 GiB of VRAM in `mem_info_vram_total`), an Intel iGPU (`card1`, device
0x46a6, no VRAM file), a connector entry (`card0-DP-1`) and a render node (`renderD128`), both of
which must be ignored.
`card2` is an NVIDIA card (device 0x2f04, no VRAM file: the proprietary driver does not write one),
used to test the merge with `nvidia-smi`.
