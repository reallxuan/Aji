//! Classifies the lines KataGo's analysis engine prints on stdout.

use serde::Deserialize;
use serde_json::Value;

/// The fields of an analysis response that Aji uses.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawAnalysis {
    pub id: String,
    pub is_during_search: bool,
    pub turn_number: u32,
    pub root_info: RawRootInfo,
    pub move_infos: Vec<RawMoveInfo>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawRootInfo {
    pub visits: u32,
    pub winrate: f64,
    pub score_lead: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawMoveInfo {
    #[serde(rename = "move")]
    pub mv: String,
    pub order: u32,
    pub visits: u32,
    pub winrate: f64,
    pub score_lead: f64,
    pub prior: f64,
    #[serde(default)]
    pub pv: Vec<String>,
}

/// One classified stdout line.
#[derive(Debug, Clone, PartialEq)]
pub enum KataLine {
    Analysis(RawAnalysis),
    NoResults {
        id: String,
    },
    Ack {
        id: String,
        action: String,
        version: Option<String>,
    },
    QueryError {
        id: Option<String>,
        field: Option<String>,
        message: String,
    },
    Warning {
        id: Option<String>,
        field: Option<String>,
        message: String,
    },
    Unrecognised(String),
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn message(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Classifies one line. Never panics; anything not understood is `Unrecognised`.
///
/// Checks run in this order: `error`, `warning`, `action`, `noResults: true`, then a
/// response with `moveInfos` and `rootInfo`.
pub fn parse_line(line: &str) -> KataLine {
    let unrecognised = || KataLine::Unrecognised(line.to_owned());
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return unrecognised();
    };
    if !v.is_object() {
        return unrecognised();
    }
    if let Some(e) = v.get("error") {
        return KataLine::QueryError {
            id: text(&v, "id"),
            field: text(&v, "field"),
            message: message(e),
        };
    }
    if let Some(w) = v.get("warning") {
        return KataLine::Warning {
            id: text(&v, "id"),
            field: text(&v, "field"),
            message: message(w),
        };
    }
    if let Some(action) = text(&v, "action") {
        return KataLine::Ack {
            id: text(&v, "id").unwrap_or_default(),
            action,
            version: text(&v, "version"),
        };
    }
    if v.get("noResults") == Some(&Value::Bool(true)) {
        if let Some(id) = text(&v, "id") {
            return KataLine::NoResults { id };
        }
        return unrecognised();
    }
    if v.get("moveInfos").is_some() && v.get("rootInfo").is_some() {
        return match serde_json::from_value::<RawAnalysis>(v) {
            Ok(raw) => KataLine::Analysis(raw),
            Err(_) => unrecognised(),
        };
    }
    unrecognised()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn garbage_is_unrecognised() {
        assert!(matches!(parse_line("garbage"), KataLine::Unrecognised(_)));
        assert!(matches!(parse_line("{}"), KataLine::Unrecognised(_)));
        assert!(matches!(parse_line("[1]"), KataLine::Unrecognised(_)));
        assert!(matches!(parse_line(""), KataLine::Unrecognised(_)));
    }

    #[test]
    fn error_without_id() {
        match parse_line(r#"{"error":"boom"}"#) {
            KataLine::QueryError { id, field, message } => {
                assert_eq!((id, field, message.as_str()), (None, None, "boom"));
            }
            other => panic!("{other:?}"),
        }
    }
}
