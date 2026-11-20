//! A std-only HTTP/1.1 server for tests, bound to 127.0.0.1 on a free port.
#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

/// How the body's length is told to the client.
#[derive(Clone, Copy)]
pub enum Framing {
    /// A correct `Content-Length`.
    Length,
    /// `Transfer-Encoding: chunked`, with no `Content-Length`.
    Chunked,
    /// A `Content-Length` of this value, whatever the body's real length.
    WrongLength(u64),
}

/// Holds replies back until the test opens it.
#[derive(Clone, Default)]
pub struct Gate(Arc<(Mutex<bool>, Condvar)>);

impl Gate {
    pub fn open(&self) {
        let (open, changed) = &*self.0;
        *open.lock().unwrap() = true;
        changed.notify_all();
    }

    fn wait(&self) {
        let (open, changed) = &*self.0;
        let mut guard = open.lock().unwrap();
        while !*guard {
            guard = changed.wait(guard).unwrap();
        }
    }
}

/// One canned answer.
#[derive(Clone)]
pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
    pub framing: Framing,
    pub gate: Option<Gate>,
}

impl Reply {
    pub fn ok(body: impl Into<Vec<u8>>) -> Reply {
        Reply {
            status: 200,
            body: body.into(),
            framing: Framing::Length,
            gate: None,
        }
    }

    pub fn chunked(mut self) -> Reply {
        self.framing = Framing::Chunked;
        self
    }

    pub fn with_length(mut self, length: u64) -> Reply {
        self.framing = Framing::WrongLength(length);
        self
    }

    /// Answers only once `gate` is open.
    pub fn held(mut self, gate: &Gate) -> Reply {
        self.gate = Some(gate.clone());
        self
    }
}

/// Serves `routes` (path to reply); any other path gets 404. Returns the base URL, such as
/// `http://127.0.0.1:41234`. The server thread lives until the test process ends.
pub fn serve(routes: Vec<(&str, Reply)>) -> String {
    let routes: HashMap<String, Reply> = routes
        .into_iter()
        .map(|(path, reply)| (path.to_string(), reply))
        .collect();
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let routes = routes.clone();
            thread::spawn(move || answer(stream, &routes));
        }
    });
    base
}

/// A server that accepts connections and never answers them. Returns the base URL.
pub fn serve_silent() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    thread::spawn(move || {
        // Keep every stream open, so the client waits rather than seeing a reset.
        let mut held = Vec::new();
        for stream in listener.incoming().flatten() {
            held.push(stream);
        }
    });
    base
}

fn answer(mut stream: TcpStream, routes: &HashMap<String, Reply>) {
    let mut request = Vec::new();
    let mut buf = [0u8; 1024];
    while !request.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => return,
            Ok(n) => request.extend_from_slice(&buf[..n]),
        }
    }
    let text = String::from_utf8_lossy(&request);
    let path = text
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");
    let reply = routes.get(path).cloned().unwrap_or(Reply {
        status: 404,
        ..Reply::ok("not found")
    });
    if let Some(gate) = &reply.gate {
        gate.wait();
    }
    let framing = match reply.framing {
        Framing::Length => format!("Content-Length: {}", reply.body.len()),
        Framing::Chunked => "Transfer-Encoding: chunked".to_string(),
        Framing::WrongLength(n) => format!("Content-Length: {n}"),
    };
    let head = format!(
        "HTTP/1.1 {} X\r\n{framing}\r\nConnection: close\r\n\r\n",
        reply.status
    );
    // The client may hang up early (an oversized body), so write errors are ignored.
    let _ = stream.write_all(head.as_bytes());
    match reply.framing {
        Framing::Chunked => {
            for chunk in reply.body.chunks(64 * 1024) {
                let _ = write!(stream, "{:x}\r\n", chunk.len());
                let _ = stream.write_all(chunk);
                let _ = stream.write_all(b"\r\n");
            }
            let _ = stream.write_all(b"0\r\n\r\n");
        }
        _ => {
            let _ = stream.write_all(&reply.body);
        }
    }
}
