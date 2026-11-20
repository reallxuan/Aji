//! A test-only stand-in for KataGo's analysis engine and benchmark.
//!
//! It replays transcripts recorded from the real KataGo (see
//! `tests/fixtures/katago`). It takes KataGo's command line and is deliberately
//! independent of the crate's own parser. Standard library, `serde` and
//! `serde_json` only, so it builds and behaves the same on Windows, macOS and
//! Linux.
//!
//! Two modes, chosen by the `-config` file:
//!
//! - JSON: the config is the scenario itself (M2's engine tests).
//! - Install: any other config is KataGo's `key = value` format. The fake then
//!   runs as an installed engine: it writes its pid to `fake-katago.pid` and
//!   reads its scenario from `fake-katago-scenario.json`, both beside its own
//!   executable, and checks what a real KataGo would (its config rules, the
//!   model file, the runtime folder on `PATH`). See `tests/fixtures/install`.

use std::collections::{BTreeMap, HashMap};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
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
    stall_after_reports: Option<u64>,
    // Install mode only.
    /// Config keys that must be present with these values.
    require_config: BTreeMap<String, String>,
    /// The first `PATH` entry must be a folder of this name, as the runtime folder is.
    require_path_entry: Option<String>,
    /// The exit code when the runtime folder is missing.
    missing_library_exit: i32,
    benchmark: Option<Benchmark>,
    failure: Option<Failure>,
    /// Prints nothing and never exits.
    hang: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Benchmark {
    /// Per thread count, as text.
    visits_per_second: BTreeMap<String, f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Failure {
    during: During,
    stderr: Vec<String>,
    exit_code: i32,
}

#[derive(Deserialize, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum During {
    Startup,
    Benchmark,
    Query,
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
            stall_after_reports: None,
            require_config: BTreeMap::new(),
            require_path_entry: None,
            missing_library_exit: 127,
            benchmark: None,
            failure: None,
            hang: false,
        }
    }
}

fn die(message: &str) -> ! {
    eprintln!("fake-katago: {message}");
    process::exit(2);
}

/// The value after `flag` on the command line.
fn arg<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    let at = args.iter().position(|a| a == flag)?;
    args.get(at + 1).map(String::as_str)
}

/// Reads a scenario file. The transcript, when there is one, is resolved against its folder.
fn read_scenario(path: &Path) -> (Scenario, PathBuf) {
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|e| die(&format!("{}: {e}", path.display())));
    let scenario: Scenario =
        serde_json::from_str(&text).unwrap_or_else(|e| die(&format!("{}: {e}", path.display())));
    if scenario.speed <= 0.0 {
        die("scenario needs a positive speed");
    }
    let dir = path.parent().unwrap_or(Path::new("."));
    let transcript = dir.join(&scenario.transcript);
    (scenario, transcript)
}

/// KataGo's config format: `key = value` lines, `#` starting a comment.
fn parse_config(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .map(|line| line.split('#').next().unwrap_or(""))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .collect()
}

/// A failure KataGo reports through an uncaught exception: printed in its Windows form,
/// with exit code 1.
fn uncaught(message: &str) -> ! {
    emit_err(&format!("Uncaught exception: {message}"));
    process::exit(1);
}

/// The config rules of KataGo 1.18.2 (`config_parser.cpp`, `analysis.cpp`, `setup.cpp`), with
/// its messages, so a bad template fails here as it would for real.
fn check_katago_config(command: &str, config: &BTreeMap<String, String>, file: &str) {
    let has = |key: &str| config.contains_key(key);
    let missing =
        |key: &str| -> ! { uncaught(&format!("Could not find key '{key}' in config file {file}")) };
    match command {
        "analysis" => {
            if has("numSearchThreadsPerAnalysisThread") && has("numSearchThreads") {
                uncaught(
                    "Cannot specify both numSearchThreadsPerAnalysisThread and numSearchThreads \
                     in the same config",
                );
            }
            for key in ["numAnalysisThreads", "nnMaxBatchSize"] {
                if !has(key) {
                    missing(key);
                }
            }
            // `numSearchThreadsPerAnalysisThread` is read as `numSearchThreads`.
            if !has("numSearchThreads") && !has("numSearchThreadsPerAnalysisThread") {
                missing("numSearchThreads");
            }
        }
        "benchmark" if !has("numSearchThreads") => missing("numSearchThreads"),
        _ => {}
    }
}

/// Prints the failure's stderr and exits with its code, when it is due `now`.
fn fail_if(failure: Option<&Failure>, now: During) {
    if let Some(failure) = failure.filter(|f| f.during == now) {
        for line in &failure.stderr {
            emit_err(line);
        }
        process::exit(failure.exit_code);
    }
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
    stall_after_reports: Option<u64>,
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
        // Reports this replay has written, and when the previous line was recorded.
        let mut written = 0;
        let mut previous_t = recorded.t_in;
        for (t, line) in &recorded.outs {
            sleep_until(started + scaled(t - recorded.t_in, config.speed));
            let interval = scaled(t - previous_t, config.speed);
            previous_t = *t;
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
                written += 1;
                if config.stall_after_reports == Some(written) {
                    drop(state);
                    stall(&line, interval, &id, generation, &shared);
                    return;
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

/// Re-sends `report` every `interval`, with the same visits and never a final, for as long
/// as its replay is live. A terminate ends the replay and writes the final itself.
fn stall(report: &Value, interval: Duration, id: &str, generation: u64, shared: &Mutex<Shared>) {
    let interval = interval.max(Duration::from_millis(1));
    loop {
        thread::sleep(interval);
        let state = shared.lock().unwrap();
        if !state
            .replays
            .get(id)
            .is_some_and(|r| r.generation == generation)
        {
            return;
        }
        emit(report);
    }
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
    let config_path = arg(&args, "-config").unwrap_or_else(|| die("missing -config"));
    let config_text = std::fs::read_to_string(config_path)
        .unwrap_or_else(|e| die(&format!("{config_path}: {e}")));
    if serde_json::from_str::<Value>(&config_text).is_ok() {
        let (scenario, transcript) = read_scenario(Path::new(config_path));
        analysis(scenario, &transcript);
    }
    installed(&args, config_path, &config_text);
}

/// Install mode: the checks a real KataGo makes, then the command.
fn installed(args: &[String], config_path: &str, config_text: &str) -> ! {
    let exe = std::env::current_exe().unwrap_or_else(|e| die(&format!("current_exe: {e}")));
    let dir = exe.parent().unwrap_or(Path::new("."));
    let _ = std::fs::write(dir.join("fake-katago.pid"), process::id().to_string());
    let (scenario, transcript) = read_scenario(&dir.join("fake-katago-scenario.json"));

    // The OS loader fails before `main` when a runtime library is missing.
    if let Some(name) = &scenario.require_path_entry {
        let first = std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).next());
        if !first
            .as_deref()
            .and_then(Path::file_name)
            .is_some_and(|n| n == name.as_str())
        {
            emit_err("fake-katago: library not found");
            process::exit(scenario.missing_library_exit);
        }
    }
    let command = args.first().map(String::as_str).unwrap_or("");
    let config = parse_config(config_text);
    check_katago_config(command, &config, config_path);
    for (key, value) in &scenario.require_config {
        if config.get(key) != Some(value) {
            emit_err(&format!("fake-katago: missing config {key}"));
            process::exit(1);
        }
    }
    let model = arg(args, "-model").unwrap_or_else(|| die("missing -model"));
    if !Path::new(model).is_file() {
        emit_err("fake-katago: model not found");
        process::exit(1);
    }
    fail_if(scenario.failure.as_ref(), During::Startup);
    if scenario.hang {
        forever();
    }
    match command {
        "benchmark" => benchmark(&scenario, args, model),
        "analysis" => {
            if scenario.transcript.is_empty() {
                die("an analysis scenario needs a transcript");
            }
            analysis(scenario, &transcript)
        }
        other => die(&format!("unknown command {other:?}")),
    }
}

/// `benchmark -v <visits> -n <positions> -t <a,b,c>`: for each thread count, the progress
/// lines joined by `\r` and a final line, in KataGo's format (`playutils.cpp`), on stdout.
fn benchmark(scenario: &Scenario, args: &[String], model: &str) -> ! {
    let speeds = &scenario
        .benchmark
        .as_ref()
        .unwrap_or_else(|| die("the scenario has no benchmark"))
        .visits_per_second;
    let number = |flag: &str, default: u32| {
        arg(args, flag).map_or(default, |v| v.parse().unwrap_or_else(|_| die(flag)))
    };
    let visits = number("-v", 800);
    let positions = number("-n", 10);
    let threads: Vec<u32> = arg(args, "-t")
        .unwrap_or_else(|| die("missing -t"))
        .split(',')
        .map(|t| t.parse().unwrap_or_else(|_| die("bad -t")))
        .collect();

    let mut out = io::stdout().lock();
    let _ = writeln!(out, "Loaded model {model}");
    let _ = writeln!(out);
    let _ = writeln!(out, "Testing using {visits} visits.");
    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "Testing different numbers of threads (board size 19x19): "
    );
    let _ = out.flush();
    fail_if(scenario.failure.as_ref(), During::Benchmark);
    for (n, t) in threads.iter().enumerate() {
        let speed = *speeds
            .get(&t.to_string())
            .unwrap_or_else(|| die(&format!("no speed for {t} threads")));
        let secs = |done: u32| f64::from(done) * f64::from(visits) / speed;
        for done in 0..positions {
            let rate = if done == 0 {
                "nan".to_string()
            } else {
                format!("{speed:.2}")
            };
            let _ = write!(
                out,
                "\rnumSearchThreads = {t:2}: {done} / {positions} positions, visits/s = {rate} ({:.1} secs)      ",
                secs(done)
            );
        }
        let elo = if n == 0 {
            "baseline".to_string()
        } else {
            format!("-{}", 20 * n)
        };
        let evals = speed * 0.85;
        let batch = f64::from(*t) / 2.0;
        let _ = writeln!(
            out,
            "\rnumSearchThreads = {t:2}: {positions} / {positions} positions, visits/s = {speed:.2} nnEvals/s = {evals:.2} nnBatches/s = {:.2} avgBatchSize = {batch:.2} ({:.1} secs) (EloDiff {elo})",
            evals / batch,
            secs(positions)
        );
        let _ = out.flush();
    }
    process::exit(0);
}

/// The analysis engine: start-up lines, then queries on stdin until EOF.
fn analysis(scenario: Scenario, transcript_path: &Path) -> ! {
    if scenario.transcript.is_empty() {
        die("scenario needs a transcript");
    }
    // The transcript lives for the whole process; replay threads borrow it.
    let transcript: &'static Transcript = Box::leak(Box::new(load_transcript(transcript_path)));

    print_startup(transcript, &scenario);
    if scenario.fail_startup {
        process::abort();
    }

    let config = Arc::new(Config {
        speed: scenario.speed,
        crash_after_reports: scenario.crash_after_reports,
        crash_stderr_lines: scenario.crash_stderr_lines,
        stall_after_reports: scenario.stall_after_reports,
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
                fail_if(scenario.failure.as_ref(), During::Query);
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
