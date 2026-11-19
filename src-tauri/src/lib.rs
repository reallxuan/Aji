mod ipc;
pub mod protocol;
pub mod service;

use service::AppContext;

/// Registers the app state and the `rpc` command. Generic over the runtime so tests can use
/// Tauri's mock runtime.
pub fn configure<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
    ctx: AppContext,
) -> tauri::Builder<R> {
    builder
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![ipc::rpc])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let ctx = AppContext::detect(context.package_info().version.to_string());
    configure(tauri::Builder::default(), ctx)
        .run(context)
        .expect("error while running tauri application");
}
