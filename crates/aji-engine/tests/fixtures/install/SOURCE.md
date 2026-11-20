# Install-mode scenarios for the fake KataGo

Hand-made. In install mode the fake KataGo is copied into a folder as `katago` (or
`katago.exe`), reads its scenario from `fake-katago-scenario.json` beside itself, and reads
`-config` as a `key = value` file, as an installed engine would. The tests copy these files
there; a `transcript` path is resolved against this folder.

| File | Behaviour |
|---|---|
| `benchmark.json` | `benchmark` prints 100 visits/s at 8 threads and 180 at 16. |
| `require-onnx.json` | Needs `onnxProvider = directml` in the config. |
| `runtime-path.json` | Needs the first `PATH` entry to be a folder named `运行库 x`. |
| `cuda-oom.json` | `benchmark` fails with a CUDA out-of-memory error, exit code 3. |
| `startup-failure.json` | Fails at start-up with a DirectML error, exit code 1. |
| `hang.json` | Prints nothing and never exits. |
| `analysis.json` | Replays the recorded analysis transcript. |

## Which text is synthetic

None of the stderr lines below were captured from a real failure; each is built from the format
string in KataGo v1.18.2's source (commit `fd0723f`, paths under `cpp/`):

- `cuda-oom.json`: `ERROR: NN server thread failed: <what>` (`neuralnet/nneval.cpp:399-404`)
  around `CUDA Error, for <op> file <f>, func <x>, line <n>, error <text>`
  (`neuralnet/cudaerrorcheck.h:10`). `ScratchBuffers` is one of the `cudaMalloc` op names
  (`neuralnet/cudaandrocmbackend.inc:868`); `func`, `line` and `out of memory` (NVIDIA's
  `cudaGetErrorString` text) are made up. Exit code 3 is what `abort()` gives on Windows.
- `startup-failure.json`: `Uncaught exception: <what>` is the Windows form of a main-thread
  exception (`main.cpp:222-237`); the message follows `neuralnet/onnxbackend.cpp:681-682`.
- The config errors the fake prints itself use KataGo's own text:
  `Could not find key '<k>' in config file <f>` (`dataio/config_parser.cpp:536`) and
  `Cannot specify both numSearchThreadsPerAnalysisThread and numSearchThreads in the same
  config` (`dataio/config_parser.cpp:353-354`), with the Windows `Uncaught exception: ` prefix
  and exit code 1.
- The benchmark lines follow `program/playutils.cpp:834-869` and the recorded
  `crates/aji-manager/tests/fixtures/benchmark/1.18.2-metal/*fixed-threads*` output; the
  speeds are the scenario's.
