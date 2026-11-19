//! The Tauri IPC transport: one command that hands every request to the dispatcher, and an event
//! sink that pushes engine events to the webview.

use tauri::{AppHandle, Emitter, Runtime};

use crate::protocol::{AppEvent, ProtocolError, Request, Response};
use crate::service::{self, AppContext, EventSink};

/// The event name the UI listens on.
pub const EVENT_CHANNEL: &str = "aji://event";

#[tauri::command]
pub async fn rpc(
    ctx: tauri::State<'_, AppContext>,
    request: Request,
) -> Result<Response, ProtocolError> {
    service::handle(&ctx, request).await
}

/// Emits every [`AppEvent`] to all webviews on [`EVENT_CHANNEL`].
pub struct TauriEventSink<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> EventSink for TauriEventSink<R> {
    fn emit(&self, event: AppEvent) {
        if let Err(error) = self.0.emit(EVENT_CHANNEL, event) {
            eprintln!("aji: cannot emit {EVENT_CHANNEL}: {error}");
        }
    }
}
