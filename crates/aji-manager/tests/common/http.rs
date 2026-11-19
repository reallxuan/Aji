//! A std-only HTTP/1.1 server for tests, bound to 127.0.0.1 on a free port.
#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

/// One canned answer.
#[derive(Clone)]
pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn ok(body: impl Into<Vec<u8>>) -> Reply {
        Reply {
            status: 200,
            body: body.into(),
        }
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
        body: b"not found".to_vec(),
    });
    let head = format!(
        "HTTP/1.1 {} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        reply.status,
        reply.body.len()
    );
    // The client may hang up early (an oversized body), so write errors are ignored.
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&reply.body);
}
