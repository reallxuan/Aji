//! Turning a failed KataGo run into a failure code the interface can explain (design 5.6).

use aji_engine::ExitInfo;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Why an install step failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FailureCode {
    DownloadFailed,
    ChecksumMismatch,
    NotEnoughSpace,
    UnpackFailed,
    MissingLibrary,
    GpuDriverTooOld,
    GpuError,
    OutOfMemory,
    OpenclNoDevice,
    LicenceNotAccepted,
    TimedOut,
    Crashed,
}

/// A failed step: its code and the last lines KataGo printed, for display only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepFailure {
    pub code: FailureCode,
    pub stderr_tail: Vec<String>,
}

/// `STATUS_DLL_NOT_FOUND` (0xC0000135): Windows' loader could not find a DLL, before `main`.
pub const WINDOWS_DLL_NOT_FOUND: i32 = 0xC000_0135_u32 as i32;

/// Case-sensitive substrings of a line, checked code by code in this order: the first code with
/// a match in any line wins. Every line comes from KataGo v1.18.2's source (the M4 plan's
/// "KataGo source findings" 1); each is **[To verify]** until a real recording confirms it.
/// `tests/fixtures/katago-errors/SOURCE.md` has a sample line for every substring.
const PATTERNS: &[(FailureCode, &[&str])] = &[
    // missingLibrary has no text: the OS loader fails before `main` (findings 1). It is the
    // Windows exit code above.
    // gpuDriverTooOld has none yet: KataGo prints nothing of its own for an old driver
    // (`cudaandrocmbackend.inc:5099-5102`) and CUDA's text comes from NVIDIA's library. It waits
    // for a recording.
    (
        FailureCode::OutOfMemory,
        &[
            // OpenCL error names (`neuralnet/openclhelpers.cpp:19,20,21`).
            "CL_MEM_OBJECT_ALLOCATION_FAILURE",
            "CL_OUT_OF_RESOURCES",
            "CL_OUT_OF_HOST_MEMORY",
            // cuBLAS status in `CUBLAS Error, for …` (`neuralnet/cudaerrorcheck.h:37`).
            "CUBLAS_STATUS_ALLOC_FAILED",
            // The `cudaMalloc` op names (`cudaandrocmbackend.inc:4724-4771, 868`) in
            // `CUDA Error, for <op> file …` (`neuralnet/cudaerrorcheck.h:10`).
            "CUDA Error, for Buffers ",
            "CUDA Error, for ScratchBuffers ",
        ],
    ),
    (
        FailureCode::OpenclNoDevice,
        &[
            // `neuralnet/openclhelpers.cpp:503-506`.
            "No OpenCL devices were found on your system",
            // OpenCL error names (`neuralnet/openclhelpers.cpp:77,16`).
            "CL_PLATFORM_NOT_FOUND_KHR",
            "CL_DEVICE_NOT_FOUND",
        ],
    ),
    (
        FailureCode::GpuError,
        &[
            // `neuralnet/cudaerrorcheck.h:10,37,44`.
            "CUDA Error, for ",
            "CUBLAS Error, for ",
            "CUDNN Error, for ",
            // `neuralnet/openclhelpers.cpp:88`.
            "OpenCL error at ",
            // A failed tuning stage (`neuralnet/opencltuner.cpp:2647` and others).
            "failed - could not find any working configuration",
            // `neuralnet/onnxbackend.cpp:697-714, 681-682`.
            "ONNX backend: DirectML init failed",
            "ONNX backend: DirectML execution provider is not available",
            // `metalbackend.swift:441,447,656-657`, `metalbackend.cpp:679-681`.
            "Metal backend: Failed to create",
            "Metal backend: GPU error",
            "Metal backend: Logic error",
            // The catch-all for the neural-net thread (`neuralnet/nneval.cpp:399-404`).
            "ERROR: NN server thread failed",
        ],
    ),
];

/// From the exit status and output lines: the stderr tail, plus stdout's last 20 lines for the
/// benchmark, whose log goes to stdout (findings 4c). Windows 0xC0000135 (-1073741515) is
/// MissingLibrary.
pub fn classify(exit: Option<ExitInfo>, lines: &[String]) -> FailureCode {
    if exit.and_then(|e| e.code) == Some(WINDOWS_DLL_NOT_FOUND) {
        return FailureCode::MissingLibrary;
    }
    PATTERNS
        .iter()
        .find(|(_, substrings)| {
            lines
                .iter()
                .any(|line| substrings.iter().any(|s| line.contains(s)))
        })
        .map_or(FailureCode::Crashed, |(code, _)| *code)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn lines(list: &[&str]) -> Vec<String> {
        list.iter().map(|l| l.to_string()).collect()
    }

    fn exited(code: i32) -> Option<ExitInfo> {
        Some(ExitInfo {
            code: Some(code),
            signal: None,
        })
    }

    /// The rows of SOURCE.md's tables: the code and the line.
    fn source_rows() -> Vec<(FailureCode, String)> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/katago-errors/SOURCE.md");
        let text = std::fs::read_to_string(path).unwrap();
        text.lines()
            .filter(|row| row.starts_with("| `"))
            .map(|row| {
                let cells: Vec<&str> = row.split(" | ").collect();
                let cell = |i: usize| cells[i].trim_matches(|c| c == '|' || c == ' ' || c == '`');
                let code = serde_json::from_value(serde_json::json!(cell(0))).unwrap();
                (code, cell(1).to_string())
            })
            .collect()
    }

    #[test]
    fn windows_dll_not_found_is_missing_library() {
        assert_eq!(WINDOWS_DLL_NOT_FOUND, -1073741515);
        assert_eq!(
            classify(exited(-1073741515), &[]),
            FailureCode::MissingLibrary
        );
        // The exit code wins over any text.
        assert_eq!(
            classify(
                exited(-1073741515),
                &lines(&["ERROR: NN server thread failed: x"])
            ),
            FailureCode::MissingLibrary
        );
    }

    #[test]
    fn unknown_output_is_crashed() {
        assert_eq!(
            classify(exited(1), &lines(&["something went wrong"])),
            FailureCode::Crashed
        );
        assert_eq!(classify(None, &[]), FailureCode::Crashed);
    }

    #[test]
    fn the_recorded_metal_bad_model_run_is_crashed() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../aji-engine/tests/fixtures/katago/1.18.2-metal/bad-model.jsonl");
        let stderr: Vec<String> = std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap())
            .filter(|record| record["s"] == "err")
            .map(|record| record["line"].as_str().unwrap().to_string())
            .collect();
        assert!(
            stderr
                .iter()
                .any(|l| l.contains("Error loading or parsing model file"))
        );
        let sigabrt = Some(ExitInfo {
            code: None,
            signal: Some(6),
        });
        assert_eq!(classify(sigabrt, &stderr), FailureCode::Crashed);
    }

    #[test]
    fn out_of_memory_beats_the_generic_server_thread_error() {
        let line = "ERROR: NN server thread failed: CUDA Error, for Buffers file x, func cudaMalloc(..), line 1, error (library text)";
        assert_eq!(
            classify(exited(3), &lines(&[line])),
            FailureCode::OutOfMemory
        );
        // Also when the generic line comes first and the specific one later.
        assert_eq!(
            classify(
                exited(3),
                &lines(&[
                    "ERROR: NN server thread failed: x",
                    "CUDA Error, for ScratchBuffers file y"
                ])
            ),
            FailureCode::OutOfMemory
        );
    }

    #[test]
    fn every_pattern_maps_to_its_code() {
        let rows = source_rows();
        assert!(rows.len() >= 20, "{} rows", rows.len());
        for (code, line) in &rows {
            assert_eq!(classify(exited(1), &lines(&[line])), *code, "{line}");
        }
        for (code, substrings) in PATTERNS {
            for substring in *substrings {
                assert!(
                    rows.iter().any(|(c, l)| c == code && l.contains(substring)),
                    "no sample line in SOURCE.md for {code:?} {substring:?}"
                );
            }
        }
        assert!(
            PATTERNS
                .iter()
                .all(|(code, _)| *code != FailureCode::GpuDriverTooOld),
            "gpuDriverTooOld waits for a recording"
        );
    }
}
