# KataGo 1.18.2 Metal benchmarks on the M5

Recorded on the development Mac (MacBook Pro Mac17,2, Apple M5 with a 10-core GPU, 24 GB,
macOS 27.2) on 2026-11-19, with Homebrew KataGo 1.18.2 (Metal) and Homebrew's
`configs/gtp_example.cfg` unchanged:

    katago benchmark -config gtp.cfg -model <network>.bin.gz

That is 800 visits per search, 10 positions, and automatic thread tuning. stdout and stderr
were captured separately and are unedited; no home path appears in them.

- Progress lines are joined by carriage returns (`\r`), not newlines. Only the
  `Ordered summary of results:` block has one result per line.
- `(recommended)` marks KataGo's choice by estimated Elo, which is not always the thread count
  with the most visits/s.
- `kata1-b28c512nbt-...partial.stdout.txt` was stopped after two thread counts. It has no
  summary block, which makes it the truncated-output case for the parser.
- With the transformer networks (`tf2`, `tf3`), stderr repeats `Failed to import MPS module`.
  The convolutional networks do not print it.
- `kata1-tf3-b11c768-...fixed-threads.*` used `-t 6,8,10 -v 800 -n 10` instead of auto-tuning,
  which is the shape M4's own benchmark run takes. It has a full summary block and was stopped
  during KataGo's optional extra tests (half batch size, two server threads) that follow it.
