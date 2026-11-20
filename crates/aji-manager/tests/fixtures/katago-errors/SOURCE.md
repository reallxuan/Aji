# KataGo error lines for the failure classifier

None of these lines was captured from a real failure. Each is built from a format string in
KataGo v1.18.2's source (commit `fd0723f`, paths under `cpp/`), as read on 2026-11-20 for the
M4 plan's "KataGo source findings". Where the source is cited, KataGo's own words are copied;
the parts that come from elsewhere are made up and listed under each table:

- `file`, `func` and `line` inside a `CUDA Error, for …` or `OpenCL error at …` line.
- The text after `error` in a CUDA, cuBLAS or cuDNN line, which comes from NVIDIA's libraries.
- The text after `GPU error:` and after `DirectML init failed:`, which comes from Apple's Metal
  and from ONNX Runtime.

`install::classify`'s table test reads the rows below: the code, the line, and where it comes
from. A line must not contain `|` or a backtick. Every pattern in the classifier must appear
in at least one line. Each pattern stays **[To verify]** until a real recording confirms it.

## Out of memory

| Code | Line | Source |
|---|---|---|
| `outOfMemory` | `ERROR: NN server thread failed: OpenCL error at openclbackend.cpp, func clEnqueueNDRangeKernel, line 1201, error CL_MEM_OBJECT_ALLOCATION_FAILURE (possibly ran out of GPU memory?)` | `neuralnet/nneval.cpp:399-404`, `neuralnet/openclhelpers.cpp:88,19` |
| `outOfMemory` | `OpenCL error at openclbackend.cpp, func clFinish, line 1310, error CL_OUT_OF_RESOURCES` | `neuralnet/openclhelpers.cpp:88,20` |
| `outOfMemory` | `OpenCL error at openclbackend.cpp, func clCreateBuffer, line 402, error CL_OUT_OF_HOST_MEMORY` | `neuralnet/openclhelpers.cpp:88,21` |
| `outOfMemory` | `ERROR: NN server thread failed: CUBLAS Error, for cublasCreate file cudaandrocmbackend.inc, func CublasHandle, line 120, error CUBLAS_STATUS_ALLOC_FAILED` | `neuralnet/cudaerrorcheck.h:37` |
| `outOfMemory` | `ERROR: NN server thread failed: CUDA Error, for Buffers file cudaandrocmbackend.inc, func Buffers, line 4724, error out of memory` | `neuralnet/cudaerrorcheck.h:10`, `cudaandrocmbackend.inc:4724-4771` |
| `outOfMemory` | `ERROR: NN server thread failed: CUDA Error, for ScratchBuffers file cudaandrocmbackend.inc, func ScratchBuffers, line 868, error out of memory` | `neuralnet/cudaerrorcheck.h:10`, `cudaandrocmbackend.inc:868` |

`CL_OUT_OF_RESOURCES` is followed by more text in KataGo's table (`openclhelpers.cpp:20`); the
line stops at the name, which is all the classifier reads.

## No OpenCL device

| Code | Line | Source |
|---|---|---|
| `openclNoDevice` | `Uncaught exception: No OpenCL devices were found on your system.` | `main.cpp:222-237`, `neuralnet/openclhelpers.cpp:503-506` |
| `openclNoDevice` | `OpenCL error at openclhelpers.cpp, func clGetPlatformIDs, line 395, error CL_PLATFORM_NOT_FOUND_KHR` | `neuralnet/openclhelpers.cpp:88,77` |
| `openclNoDevice` | `OpenCL error at openclhelpers.cpp, func clGetDeviceIDs, line 420, error CL_DEVICE_NOT_FOUND` | `neuralnet/openclhelpers.cpp:88,16` |

The no-device message goes on after its first sentence (`openclhelpers.cpp:503-506`); only the
first sentence is copied.

## Other GPU errors

| Code | Line | Source |
|---|---|---|
| `gpuError` | `ERROR: NN server thread failed: CUDA Error, for cudaMemcpy file cudaandrocmbackend.inc, func copyToDevice, line 310, error an illegal memory access was encountered` | `neuralnet/cudaerrorcheck.h:10` |
| `gpuError` | `ERROR: NN server thread failed: CUBLAS Error, for cublasSgemm file cudaandrocmbackend.inc, func matMul, line 1540, error CUBLAS_STATUS_EXECUTION_FAILED` | `neuralnet/cudaerrorcheck.h:37` |
| `gpuError` | `ERROR: NN server thread failed: CUDNN Error, for cudnnConvolutionForward file cudaandrocmbackend.inc, func apply, line 980, error CUDNN_STATUS_EXECUTION_FAILED` | `neuralnet/cudaerrorcheck.h:44` |
| `gpuError` | `OpenCL error at openclbackend.cpp, func clFinish, line 1310, error CL_INVALID_COMMAND_QUEUE` | `neuralnet/openclhelpers.cpp:88` |
| `gpuError` | `Uncaught exception: Tuning xGemm failed - could not find any working configuration` | `main.cpp:222-237`, `neuralnet/opencltuner.cpp:2647` |
| `gpuError` | `Uncaught exception: ONNX backend: DirectML init failed: D3D12 device could not be created. Check that a DirectX 12 capable GPU and driver are installed.` | `main.cpp:222-237`, `neuralnet/onnxbackend.cpp:697-714` |
| `gpuError` | `Uncaught exception: ONNX backend: DirectML execution provider is not available in this build of ONNX Runtime.` | `main.cpp:222-237`, `neuralnet/onnxbackend.cpp:681-682` |
| `gpuError` | `Metal backend: Failed to create Metal device` | `metalbackend.swift:441` |
| `gpuError` | `metalbackend.swift:657: Fatal error: Metal backend: GPU error: Execution of the command buffer was aborted due to an error during execution.` | `metalbackend.swift:656-657` |
| `gpuError` | `Metal backend: Logic error - expected exactly one compute handle per server thread` | `metalbackend.cpp:679-681` |
| `gpuError` | `ERROR: NN server thread failed: std::bad_alloc` | `neuralnet/nneval.cpp:399-404` |

The `stage` in the tuning line, the ONNX Runtime text, the end of the DirectML-not-available
line, Apple's text after `GPU error:`, the
Swift `<file>:<line>: Fatal error: ` prefix, the end of the Metal logic-error line and
`std::bad_alloc` are made up.

## Everything else

| Code | Line | Source |
|---|---|---|
| `crashed` | `Uncaught exception: Error loading or parsing model file kata1.bin.gz: Could not open file kata1.bin.gz - does not exist or invalid permissions?` | `main.cpp:222-237`, `neuralnet/desc.cpp:2859-2860` |
| `crashed` | `Uncaught exception: Could not find key 'numSearchThreads' in config file engines/e/configs/e+n.cfg` | `main.cpp:222-237`, `dataio/config_parser.cpp:536` |
| `crashed` | `Uncaught exception: Cannot specify both numSearchThreadsPerAnalysisThread and numSearchThreads in the same config` | `main.cpp:222-237`, `dataio/config_parser.cpp:353-354` |

A model or config error is Aji's or the network's problem, not the backend's.
