use std::env;
use std::path::PathBuf;

fn main() {
    // The target, not the host: `cfg!(windows)` in a build script describes the machine running it.
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        embed_manifest_in_every_binary();
    } else {
        tauri_build::build();
    }
}

/// tauri-build embeds its application manifest as a resource of the app binary only. A test
/// binary that links Tauri then loads Common Controls v5, which lacks entry points Tauri imports,
/// and exits with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) before any test runs. Instead the
/// linker embeds the same manifest into every binary of this package, tests included. This is the
/// workaround in Tauri's own build script:
/// https://github.com/tauri-apps/tauri/pull/4383#issuecomment-1212221864
fn embed_manifest_in_every_binary() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("set by cargo"))
        .join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
    )
    .expect("tauri-build failed");
}
