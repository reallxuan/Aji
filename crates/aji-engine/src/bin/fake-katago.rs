//! A test-only stand-in for KataGo's analysis engine.
//!
//! It replays transcripts recorded from the real KataGo (see
//! `tests/fixtures/katago`). It takes KataGo's command line, reads a scenario
//! file from `-config`, and is deliberately independent of the crate's own
//! parser. Standard library, `serde` and `serde_json` only, so it builds and
//! behaves the same on Windows, macOS and Linux.

use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::Path;
use std::process;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{Value, json};

const READY_MARK: &str = "Started, ready to begin handling requests";
const CRASH_LINE: &str =
    "libc++abi: terminating due to uncaught exception of type StringError: fake crash";

// ---------------------------------------------------------------- scenario

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Scenario {
    transcript: String,
    speed: f64,
    on_eof: OnEof,
    fail_startup: bool,
    crash_after_reports: Option<u64>,
    crash_stderr_lines: u64,
    hang_after_ready: bool,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum OnEof {
    Exit,
    Ignore,
}

impl Default for Scenario {
    fn default() -> Self {
        Scenario {
            transcript: String::new(),
            speed: 20.0,
            on_eof: OnEof::Exit,
            fail_startup: false,
            crash_after_reports: None,
            crash_stderr_lines: 0,
            hang_after_ready: false,
        }
    }
}

fn die(message: &str) -> ! {
    eprintln!("fake-katago: {message}");
    process::exit(2);
}

fn load_scenario(args: &[String]) -> (Scenario, std::path::PathBuf) {
    let at = args
        .iter()
        .position(|a| a == "-config")
        .unwrap_or_else(|| die("missing -config"));
    let path = args
        .get(at + 1)
        .unwrap_or_else(|| die("-config needs a value"));
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| die(&format!("{path}: {e}")));
    let scenario: Scenario =
        serde_json::from_str(&text).unwrap_or_else(|e| die(&format!("{path}: {e}")));
    if scenario.speed <= 0.0 || scenario.transcript.is_empty() {
        die("scenario needs a transcript and a positive speed");
    }
    let dir = Path::new(path).parent().unwrap_or(Path::new("."));
    let transcript = dir.join(&scenario.transcript);
    (scenario, transcript)
}

// -------------------------------------------------------------- transcript

struct Record {
    t: f64,
    stream: String,
    line: String,
}

/// An analysis query that was recorded, with what KataGo answered.
struct Recorded {
    id: String,
    t_in: f64,
    key: Key,
    /// `(t, parsed line)` for every `out` line carrying this query's id.
    outs: Vec<(f64, Value)>,
}

/// The fields two queries must share for the fake to treat them as one.
struct Key {
    moves: Value,
    initial_stones: Value,
    rules: Value,
    komi: f64,
    x: Value,
    y: Value,
}

impl Key {
    fn of(query: &Value) -> Option<Key> {
        let or = |name: &str, default: Value| query.get(name).cloned().unwrap_or(default);
        Some(Key {
            moves: or("moves", json!([])),
            initial_stones: or("initialStones", json!([])),
            rules: or("rules", Value::Null),
            komi: query
                .get("komi")
                .and_then(Value::as_f64)
                .unwrap_or(f64::NAN),
            x: or("boardXSize", json!(19)),
            y: or("boardYSize", json!(19)),
        })
    }

    fn matches(&self, other: &Key) -> bool {
        self.moves == other.moves
            && self.initial_stones == other.initial_stones
            && self.rules == other.rules
            && self.x == other.x
            && self.y == other.y
            && (self.komi - other.komi).abs() < 1e-9
    }
}

struct Transcript {
    err: Vec<(f64, String)>,
    version_reply: Option<Value>,
    queries: Vec<Recorded>,
}

fn load_transcript(path: &Path) -> Transcript {
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|e| die(&format!("{}: {e}", path.display())));
    let records: Vec<Record> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let v: Value =
                serde_json::from_str(l).unwrap_or_else(|e| die(&format!("transcript: {e}")));
            Record {
                t: v["t"].as_f64().unwrap_or(0.0),
                stream: v["s"].as_str().unwrap_or("").to_string(),
                line: v["line"].as_str().unwrap_or("").to_string(),
            }
        })
        .collect();

    let mut transcript = Transcript {
        err: Vec::new(),
        version_reply: None,
        queries: Vec::new(),
    };
    for r in &records {
        match r.stream.as_str() {
            "err" => transcript.err.push((r.t, r.line.clone())),
            "in" => {
                let Ok(q) = serde_json::from_str::<Value>(&r.line) else {
                    continue;
                };
                if q.get("action").is_some() {
                    continue;
                }
                let (Some(id), Some(key)) = (q["id"].as_str(), Key::of(&q)) else {
                    continue;
                };
                transcript.queries.push(Recorded {
                    id: id.to_string(),
                    t_in: r.t,
                    key,
                    outs: Vec::new(),
                });
            }
            "out" => {
                let Ok(v) = serde_json::from_str::<Value>(&r.line) else {
                    continue;
                };
                if v["action"] == "query_version" && transcript.version_reply.is_none() {
                    transcript.version_reply = Some(v);
                } else if let Some(id) = v["id"].as_str()
                    && let Some(q) = transcript.queries.iter_mut().find(|q| q.id == id)
                {
                    q.outs.push((r.t, v));
                }
            }
            _ => {}
        }
    }
    transcript
}

// ------------------------------------------------------------------ output

fn emit(value: &Value) {
    let mut line = serde_json::to_string(value).expect("serialise");
    line.push('\n');
    let mut out = io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.flush();
}

fn emit_err(line: &str) {
    let mut err = io::stderr().lock();
    let _ = writeln!(err, "{line}");
    let _ = err.flush();
}

fn sleep_until(deadline: Instant) {
    let now = Instant::now();
    if deadline > now {
        thread::sleep(deadline - now);
    }
}

fn scaled(seconds: f64, speed: f64) -> Duration {
    Duration::from_secs_f64((seconds / speed).max(0.0))
}

fn forever() -> ! {
    loop {
        thread::sleep(Duration::from_secs(3600));
    }
}

// ------------------------------------------------------------------ replay

/// One replay in progress. All of them live in `Shared`, behind one lock that
/// is also held while a line is written, so lines never interleave and a
/// terminate sees a consistent picture.
/// An entry exists only while its replay is live: it is removed, under the
/// same lock hold that writes the final line (natural or from a terminate).
struct Replay {
    /// Identifies this replay, so a stale thread can never write for a newer
    /// replay that reused the same query id.
    generation: u64,
    last_report: Option<Value>,
    turn_number: usize,
}

struct Shared {
    replays: HashMap<String, Replay>,
    reports_written: u64,
    next_generation: u64,
}

struct Config {
    speed: f64,
    crash_after_reports: Option<u64>,
    crash_stderr_lines: u64,
}

fn crash(config: &Config) -> ! {
    for n in 1..=config.crash_stderr_lines {
        emit_err(&format!("fake crash line {n}"));
    }
    emit_err(CRASH_LINE);
    process::abort();
}

fn start_replay(
    query: &Value,
    id: String,
    recorded: &'static Recorded,
    shared: &Arc<Mutex<Shared>>,
    config: &Arc<Config>,
) {
    let turn_number = query["moves"].as_array().map_or(0, Vec::len);
    let generation = {
        let mut state = shared.lock().unwrap();
        let generation = state.next_generation;
        state.next_generation += 1;
        state.replays.insert(
            id.clone(),
            Replay {
                generation,
                last_report: None,
                turn_number,
            },
        );
        generation
    };
    let started = Instant::now();
    let shared = Arc::clone(shared);
    let config = Arc::clone(config);
    thread::spawn(move || {
        for (t, line) in &recorded.outs {
            sleep_until(started + scaled(t - recorded.t_in, config.speed));
            let mut line = line.clone();
            line["id"] = Value::String(id.clone());
            let is_report = line["isDuringSearch"] == true;
            let mut state = shared.lock().unwrap();
            let Some(replay) = state.replays.get_mut(&id) else {
                return;
            };
            if replay.generation != generation {
                return;
            }
            if is_report {
                replay.last_report = Some(line.clone());
            }
            emit(&line);
            if line["isDuringSearch"] == false {
                state.replays.remove(&id);
                continue;
            }
            if is_report {
                state.reports_written += 1;
                if config.crash_after_reports == Some(state.reports_written) {
                    crash(&config);
                }
            }
        }
        let mut state = shared.lock().unwrap();
        if state
            .replays
            .get(&id)
            .is_some_and(|r| r.generation == generation)
        {
            state.replays.remove(&id);
        }
    });
}

fn terminate(query: &Value, raw: &Value, shared: &Arc<Mutex<Shared>>) {
    let all = query["action"] == "terminate_all";
    let target = query["terminateId"].as_str();
    let mut state = shared.lock().unwrap();
    emit(raw);
    let ids: Vec<String> = state
        .replays
        .keys()
        .filter(|id| all || target == Some(id.as_str()))
        .cloned()
        .collect();
    for id in ids {
        let mut replay = state.replays.remove(&id).expect("listed above");
        let fin = match replay.last_report.take() {
            Some(mut report) => {
                report["isDuringSearch"] = Value::Bool(false);
                report
            }
            None => json!({
                "id": id,
                "isDuringSearch": false,
                "noResults": true,
                "turnNumber": replay.turn_number,
            }),
        };
        emit(&fin);
    }
}

// -------------------------------------------------------------------- main

fn print_startup(transcript: &Transcript, scenario: &Scenario) {
    let started = Instant::now();
    for (t, line) in &transcript.err {
        sleep_until(started + scaled(*t, scenario.speed));
        emit_err(line);
        if !scenario.fail_startup && line.contains(READY_MARK) {
            return;
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (scenario, transcript_path) = load_scenario(&args);
    // The transcript lives for the whole process; replay threads borrow it.
    let transcript: &'static Transcript = Box::leak(Box::new(load_transcript(&transcript_path)));

    print_startup(transcript, &scenario);
    if scenario.fail_startup {
        process::abort();
    }

    let config = Arc::new(Config {
        speed: scenario.speed,
        crash_after_reports: scenario.crash_after_reports,
        crash_stderr_lines: scenario.crash_stderr_lines,
    });
    let shared = Arc::new(Mutex::new(Shared {
        replays: HashMap::new(),
        reports_written: 0,
        next_generation: 0,
    }));

    let mut stdin = io::stdin().lock();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match stdin.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => match scenario.on_eof {
                OnEof::Exit => process::exit(0),
                OnEof::Ignore => forever(),
            },
            Ok(_) => {}
        }
        let text = String::from_utf8_lossy(&buf);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let Ok(query) = serde_json::from_str::<Value>(text) else {
            emit(&json!({"error": "fake-katago: could not parse input line as json request"}));
            continue;
        };
        let id = query["id"].as_str().unwrap_or("").to_string();
        match query["action"].as_str() {
            Some("query_version") => {
                let mut reply = transcript.version_reply.clone().unwrap_or_else(
                    || json!({"action": "query_version", "git_hash": "<omitted>", "version": "1.18.2"}),
                );
                reply["id"] = Value::String(id);
                emit(&reply);
                if scenario.hang_after_ready {
                    // Never write again and never read stdin again.
                    forever();
                }
            }
            Some("terminate") | Some("terminate_all") => terminate(&query, &query, &shared),
            Some(_) => emit(&json!({"error": "fake-katago: unsupported action", "id": id})),
            None => {
                let key = Key::of(&query);
                let found = key
                    .as_ref()
                    .and_then(|k| transcript.queries.iter().find(|q| q.key.matches(k)));
                match found {
                    Some(recorded) => start_replay(&query, id, recorded, &shared, &config),
                    None => emit(&json!({
                        "error": "fake-katago: no recorded query for this position",
                        "field": "moves",
                        "id": id,
                    })),
                }
            }
        }
    }
}
