//! The dispatcher behind every transport. It knows nothing about Tauri, so the WebSocket server of
//! Phase 3 can call the same [`handle`] with the same messages.

use crate::protocol::{AppInfo, OsKind, ProtocolError, Request, Response};

/// Facts about this installation that requests may need.
#[derive(Debug, Clone)]
pub struct AppContext {
    pub version: String,
    pub os: OsKind,
    pub arch: String,
}

impl AppContext {
    pub fn detect(version: String) -> Self {
        Self {
            version,
            os: OsKind::current(),
            arch: std::env::consts::ARCH.to_string(),
        }
    }
}

pub async fn handle(ctx: &AppContext, request: Request) -> Result<Response, ProtocolError> {
    match request {
        Request::AppInfo => Ok(Response::AppInfo(AppInfo {
            version: ctx.version.clone(),
            os: ctx.os,
            arch: ctx.arch.clone(),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{AppInfo, OsKind, Request, Response};

    #[tokio::test]
    async fn app_info_reports_the_context() {
        let ctx = AppContext {
            version: "0.1.0".into(),
            os: OsKind::Macos,
            arch: "aarch64".into(),
        };
        assert_eq!(
            handle(&ctx, Request::AppInfo).await,
            Ok(Response::AppInfo(AppInfo {
                version: "0.1.0".into(),
                os: OsKind::Macos,
                arch: "aarch64".into(),
            }))
        );
    }
}
