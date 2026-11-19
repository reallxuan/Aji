//! The Tauri IPC transport: one command that hands every request to the dispatcher.

use crate::protocol::{ProtocolError, Request, Response};
use crate::service::{self, AppContext};

#[tauri::command]
pub async fn rpc(
    ctx: tauri::State<'_, AppContext>,
    request: Request,
) -> Result<Response, ProtocolError> {
    service::handle(&ctx, request).await
}
