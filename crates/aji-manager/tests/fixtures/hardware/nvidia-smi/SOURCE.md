# nvidia-smi output (synthetic)

Hand-written, not captured from a machine. `rtx5070-synthetic.csv` has the shape of
`nvidia-smi --query-gpu=index,name,memory.total,driver_version,pci.device_id --format=csv`;
`driver-failure.txt` is the message nvidia-smi prints when it cannot reach the driver.
The values are plausible, not measured. Real query output from the PC capture is added next to
these files when the owner sends it.
