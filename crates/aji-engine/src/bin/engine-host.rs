//! A test-only host for `Engine`: `engine-host <fake-katago> <scenario>`.
//!
//! It starts an `Engine` on P1 (B Q16, W D4), prints `pid <n>` with KataGo's process id once
//! the state is `analysing`, then sleeps until it is killed. The force-quit test kills it
//! and checks that KataGo does not survive.

use std::path::PathBuf;
use std::process;

use aji_core::{BoardSize, Color, Komi, Move, Point, Position, Rules};
use aji_engine::{Engine, EngineEvent, EngineFiles, EngineOptions, EngineState};
use tokio::sync::mpsc;

fn p1() -> Position {
    let komi = Komi::new(7.5).expect("7.5 is a valid komi");
    let mut p = Position::empty(BoardSize::NINETEEN, Rules::Chinese.into(), komi);
    p.moves = vec![
        (Color::Black, Move::Play(Point { x: 15, y: 3 })),
        (Color::White, Move::Play(Point { x: 3, y: 15 })),
    ];
    p
}

fn fail(message: &str) -> ! {
    eprintln!("engine-host: {message}");
    process::exit(2);
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    let [katago, scenario] = args.as_slice() else {
        fail("usage: engine-host <fake-katago> <scenario>");
    };
    let working_dir = std::env::current_dir().unwrap_or_else(|e| fail(&e.to_string()));
    let files = EngineFiles {
        katago: katago.clone(),
        model: PathBuf::from("model.bin.gz"),
        config: scenario.clone(),
        working_dir,
        path_prepend: Vec::new(),
    };
    let (tx, mut states) = mpsc::unbounded_channel();
    let engine = Engine::spawn(Some(files), p1(), EngineOptions::default(), move |event| {
        if let EngineEvent::State(state) = event {
            let _ = tx.send(state);
        }
    });
    while let Some(state) = states.recv().await {
        match state {
            EngineState::Analysing { .. } => {
                let pid = engine
                    .pid()
                    .unwrap_or_else(|| fail("analysing without a pid"));
                println!("pid {pid}");
                break;
            }
            EngineState::Crashed { .. } | EngineState::Stopped => fail(&format!("{state:?}")),
            _ => {}
        }
    }
    // Keep the engine (and the runtime that drives it) alive until killed.
    std::future::pending::<()>().await;
}
