//! Drives the `fake-katago` binary the way Aji's launch code will.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

const READY: &str = "Started, ready to begin handling requests";

struct Fake {
    child: Child,
    stdin: Option<ChildStdin>,
    out: Receiver<String>,
    err: Arc<Mutex<Vec<String>>>,
}

fn scenario(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/scenarios")
        .join(format!("{name}.json"))
}

impl Fake {
    fn spawn(name: &str) -> Fake {
        let mut child = Command::new(env!("CARGO_BIN_EXE_fake-katago"))
            .arg("analysis")
            .arg("-config")
            .arg(scenario(name))
            .args(["-model", "x", "-quit-without-waiting"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn fake-katago");
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let (tx, out) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let err = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&err);
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                sink.lock().unwrap().push(line);
            }
        });
        Fake {
            child,
            stdin,
            out,
            err,
        }
    }

    fn send(&mut self, line: &str) {
        let stdin = self.stdin.as_mut().expect("stdin open");
        writeln!(stdin, "{line}").unwrap();
        stdin.flush().unwrap();
    }

    fn recv_within(&self, ms: u64) -> Option<Value> {
        let line = self.out.recv_timeout(Duration::from_millis(ms)).ok()?;
        Some(serde_json::from_str(&line).expect("stdout line is JSON"))
    }

    fn recv(&self) -> Value {
        self.recv_within(5000)
            .expect("timed out waiting for stdout")
    }

    fn stderr_lines(&self) -> Vec<String> {
        self.err.lock().unwrap().clone()
    }

    fn wait_exit(&mut self, ms: u64) -> std::process::ExitStatus {
        let deadline = Instant::now() + Duration::from_millis(ms);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(Instant::now() < deadline, "process did not exit in time");
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_for_stderr(&self, ms: u64, pred: impl Fn(&[String]) -> bool) -> Vec<String> {
        let deadline = Instant::now() + Duration::from_millis(ms);
        loop {
            let lines = self.stderr_lines();
            if pred(&lines) {
                return lines;
            }
            assert!(Instant::now() < deadline, "stderr never matched");
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Fake {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn p1(id: &str) -> String {
    format!(
        r#"{{"id":"{id}","moves":[["B","Q16"],["W","D4"]],"rules":"chinese","komi":7.5,"boardXSize":19,"boardYSize":19,"maxVisits":300,"reportDuringSearchEvery":0.25}}"#
    )
}

fn p2(id: &str) -> String {
    format!(
        r#"{{"id":"{id}","moves":[["B","R4"]],"rules":"chinese","komi":7.5,"boardXSize":19,"boardYSize":19,"maxVisits":100000,"reportDuringSearchEvery":0.25}}"#
    )
}

fn during_search(v: &Value) -> Option<bool> {
    v.get("isDuringSearch").and_then(Value::as_bool)
}

#[test]
fn answers_query_version_after_the_ready_line() {
    let mut fake = Fake::spawn("normal");
    fake.send(r#"{"id":"aji-version","action":"query_version"}"#);
    let reply = fake.recv();
    assert_eq!(reply["version"], "1.18.2");
    assert_eq!(reply["id"], "aji-version");
    let lines = fake.wait_for_stderr(2000, |l| l.iter().any(|x| x.contains(READY)));
    assert!(
        lines.last().unwrap().contains(READY),
        "ready is the last startup line"
    );
}

#[test]
fn replays_p1_with_reports_then_a_final() {
    let mut fake = Fake::spawn("normal");
    fake.send(&p1("mine"));
    let mut reports = 0;
    loop {
        let v = fake.recv();
        assert_eq!(v["id"], "mine");
        match during_search(&v) {
            Some(true) => reports += 1,
            Some(false) => break,
            None => panic!("unexpected line {v}"),
        }
    }
    assert!(reports >= 3, "got {reports} reports");
    assert!(fake.recv_within(300).is_none(), "nothing after the final");
}

#[test]
fn terminate_returns_partial_final() {
    let mut fake = Fake::spawn("slow");
    fake.send(&p2("q2"));
    let first = fake.recv();
    assert_eq!(during_search(&first), Some(true));
    fake.send(r#"{"id":"t2","action":"terminate","terminateId":"q2"}"#);
    let ack = loop {
        let v = fake.recv();
        if v.get("action").is_some() {
            break v;
        }
        assert_eq!(during_search(&v), Some(true), "only reports before the ack");
    };
    assert_eq!(ack["action"], "terminate");
    assert_eq!(ack["id"], "t2");
    assert_eq!(ack["terminateId"], "q2");
    let fin = fake.recv();
    assert_eq!(fin["id"], "q2");
    assert_eq!(during_search(&fin), Some(false));
    assert!(fin.get("moveInfos").is_some(), "partial results are kept");
    assert!(
        fake.recv_within(600).is_none(),
        "the replay stops after terminate"
    );
}

#[test]
fn terminate_before_any_report_gives_no_results() {
    let mut fake = Fake::spawn("slow");
    fake.send(&p2("q3"));
    fake.send(r#"{"id":"t3","action":"terminate","terminateId":"q3"}"#);
    assert_eq!(fake.recv()["action"], "terminate");
    let fin = fake.recv();
    assert_eq!(fin["id"], "q3");
    assert_eq!(fin["noResults"], true);
    assert_eq!(fin["isDuringSearch"], false);
    assert_eq!(fin["turnNumber"], 1);
}

#[test]
fn unknown_position_gets_a_field_error() {
    let mut fake = Fake::spawn("normal");
    fake.send(r#"{"id":"zz","moves":[["B","A1"]],"rules":"chinese","komi":7.5,"boardXSize":19,"boardYSize":19}"#);
    let v = fake.recv();
    assert_eq!(v["id"], "zz");
    assert_eq!(v["field"], "moves");
    assert!(v["error"].as_str().unwrap().starts_with("fake-katago"));
}

#[test]
fn exits_on_eof() {
    let mut fake = Fake::spawn("normal");
    fake.send(r#"{"id":"aji-version","action":"query_version"}"#);
    fake.recv();
    drop(fake.stdin.take());
    let status = fake.wait_exit(1000);
    assert_eq!(status.code(), Some(0));
}

#[test]
fn startup_failure_aborts() {
    let mut fake = Fake::spawn("startup-failure");
    let status = fake.wait_exit(5000);
    assert!(!status.success());
    let lines = fake.wait_for_stderr(2000, |l| {
        l.last().is_some_and(|x| x.starts_with("libc++abi"))
    });
    assert!(lines.last().unwrap().starts_with("libc++abi"));
}

#[test]
fn crash_prints_stderr_lines_then_aborts() {
    let mut fake = Fake::spawn("crash");
    fake.send(&p1("c1"));
    let mut reports = 0;
    while let Some(v) = fake.recv_within(3000) {
        if during_search(&v) == Some(true) {
            reports += 1;
        }
    }
    assert_eq!(reports, 2);
    assert!(!fake.wait_exit(5000).success());
    let lines = fake.wait_for_stderr(2000, |l| {
        l.last().is_some_and(|x| x.starts_with("libc++abi"))
    });
    let n = lines.len();
    assert_eq!(lines[n - 2], "fake crash line 60");
    assert_eq!(lines[n - 61], "fake crash line 1");
}

#[test]
fn a_reused_id_after_terminate_only_sees_its_own_replay() {
    let mut fake = Fake::spawn("slow");
    fake.send(&p2("x"));
    fake.send(r#"{"id":"tx","action":"terminate","terminateId":"x"}"#);
    // Reuse the id at once; the first replay's thread is still asleep.
    fake.send(&p1("x"));
    let mut finals = 0;
    let mut reports = 0;
    let mut acks = 0;
    // p1 at speed 2 takes about 1 s; p2's stale lines would arrive within it.
    while let Some(v) = fake.recv_within(1500) {
        if v.get("action").is_some() {
            acks += 1;
            continue;
        }
        assert_eq!(v["id"], "x");
        match during_search(&v) {
            Some(true) => {
                reports += 1;
                // p1's reports have turnNumber 2; p2's would have 1.
                assert_eq!(v["turnNumber"], 2, "line from a stale replay");
            }
            _ => {
                finals += 1;
                if v.get("noResults").is_none() {
                    assert_eq!(v["turnNumber"], 2, "final from a stale replay");
                }
            }
        }
    }
    assert_eq!(acks, 1);
    // One final from the terminate (noResults for p2, nothing sent yet) and
    // exactly one from p1's own completion.
    assert_eq!(finals, 2);
    assert_eq!(reports, 8);
}

#[test]
fn terminate_after_natural_completion_writes_no_second_final() {
    let mut fake = Fake::spawn("normal");
    fake.send(&p1("done"));
    loop {
        if during_search(&fake.recv()) == Some(false) {
            break;
        }
    }
    fake.send(r#"{"id":"td","action":"terminate_all"}"#);
    assert_eq!(fake.recv()["action"], "terminate_all");
    assert!(fake.recv_within(300).is_none(), "no second final");
}
