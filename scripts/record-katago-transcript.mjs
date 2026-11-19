// Records real KataGo analysis sessions as JSON Lines transcripts, used as test fixtures.
// Usage: node scripts/record-katago-transcript.mjs --katago <path> --model <path>
//          --config <path> --out-dir <dir>
// Each line: {"t": <seconds since spawn>, "s": "in" | "out" | "err" | "ctl", "line": "<text>"}
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const READY = 'Started, ready to begin handling requests';
const TIMEOUT_MS = 120_000;
const MAX_TOTAL_BYTES = 1024 * 1024;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) {
      throw new Error(`bad arguments near ${argv[i]}`);
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  for (const key of ['katago', 'model', 'config', 'out-dir']) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

class Session {
  constructor(katago, model, config) {
    this.log = [];
    this.waiters = [];
    this.t0 = performance.now();
    const home = homedir();
    this.scrub = (text) => text.split(home).join('~');
    // The launch arguments are fixed by the Aji global constraints.
    const args = [
      'analysis',
      '-config',
      config,
      '-model',
      model,
      '-quit-without-waiting',
      '-override-config',
      'reportAnalysisWinratesAs=BLACK,logToStderr=true',
    ];
    this.proc = spawn(katago, args, { cwd: dirname(config), stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdin.on('error', () => {});
    this.closed = Promise.all([
      this.#pump(this.proc.stdout, 'out'),
      this.#pump(this.proc.stderr, 'err'),
      new Promise((res) =>
        this.proc.on('close', (code, signal) => {
          this.rec('ctl', `exit code=${code} signal=${signal}`);
          res();
        }),
      ),
    ]);
  }

  #pump(stream, name) {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => this.rec(name, line));
    return new Promise((res) => rl.on('close', res));
  }

  rec(s, line) {
    const t = Math.round(performance.now() - this.t0) / 1000;
    this.log.push({ t, s, line: this.scrub(line) });
    for (const w of [...this.waiters]) w();
  }

  send(msg) {
    const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
    this.rec('in', line);
    this.proc.stdin.write(`${line}\n`);
  }

  // Resolves once some entry at index >= from satisfies pred; rejects on timeout.
  waitFor(what, pred, from = 0) {
    return new Promise((resolveWait, reject) => {
      const check = () => {
        for (let i = from; i < this.log.length; i++) {
          if (pred(this.log[i])) return done(resolveWait);
        }
        return false;
      };
      const done = (fn) => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== check);
        fn();
        return true;
      };
      const timer = setTimeout(
        () => done(() => reject(new Error(`timeout waiting for ${what}`))),
        TIMEOUT_MS,
      );
      this.waiters.push(check);
      check();
    });
  }

  // A query is finished by its final response, an error, or an action echo.
  waitFinal(id) {
    return this.waitFor(`final of ${id}`, (e) => {
      if (e.s !== 'out') return false;
      const d = parseJson(e.line);
      return (
        d !== null && d.id === id && (d.isDuringSearch === false || 'error' in d || 'action' in d)
      );
    });
  }

  mark() {
    return this.log.length;
  }

  async closeAndWait() {
    this.rec('ctl', 'close stdin');
    this.proc.stdin.end();
    await Promise.race([
      this.closed,
      sleep(TIMEOUT_MS).then(() => {
        throw new Error('KataGo did not exit after stdin closed');
      }),
    ]);
  }

  write(file) {
    writeFileSync(file, this.log.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
}

const empty = { moves: [], rules: 'chinese', komi: 7.5, boardXSize: 19, boardYSize: 19 };

async function recordAnalysis(opts) {
  const s = new Session(opts.katago, opts.model, opts.config);
  // Sent before the ready line on purpose: this records the real ordering.
  s.send({ id: 'aji-version', action: 'query_version' });
  await s.waitFinal('aji-version');
  await s.waitFor('ready line', (e) => e.s === 'err' && e.line.includes(READY));

  // Metal warm-up.
  s.send({ id: 'warmup', ...empty, boardXSize: 9, boardYSize: 9, komi: 7, maxVisits: 50 });
  await s.waitFinal('warmup');

  s.send({
    id: 'p1',
    ...empty,
    moves: [
      ['B', 'Q16'],
      ['W', 'D4'],
    ],
    maxVisits: 300,
    reportDuringSearchEvery: 0.25,
  });
  await s.waitFinal('p1');

  s.send({ id: 'p0', ...empty, maxVisits: 200 });
  await s.waitFinal('p0');

  s.send({
    id: 'p2',
    ...empty,
    moves: [['B', 'R4']],
    maxVisits: 100000,
    reportDuringSearchEvery: 0.25,
  });
  await sleep(1000);
  s.send({ id: 'p2-terminate', action: 'terminate', terminateId: 'p2' });
  await s.waitFinal('p2');

  const queued = [
    ['ta1', []],
    ['ta2', [['B', 'C3']]],
    ['ta3', [['B', 'C4']]],
  ];
  for (const [id, moves] of queued) s.send({ id, ...empty, moves, maxVisits: 100000 });
  await sleep(300);
  s.send({ id: 'ta-terminate-all', action: 'terminate_all' });
  for (const [id] of queued) await s.waitFinal(id);

  // Error cases. Each is sent alone and awaited, so the replies stay in order.
  let from = s.mark();
  s.send('this is not json');
  await s.waitFor(
    'reply to the non-JSON line',
    (e) => e.s === 'out' && e.line.includes('"error"'),
    from,
  );
  const { boardXSize: _x, ...noBoardX } = empty;
  s.send({ id: 'e1', ...noBoardX, maxVisits: 10 });
  await s.waitFinal('e1');
  s.send({
    id: 'e2',
    ...empty,
    moves: [
      ['B', 'Q16'],
      ['W', 'Q16'],
    ],
    maxVisits: 10,
  });
  await s.waitFinal('e2');
  s.send({ id: 'e3', ...empty, rules: 'nonsense', maxVisits: 10 });
  await s.waitFinal('e3');
  s.send({ id: 'e4', ...empty, maxVisits: 10, notAField: 1 });
  await s.waitFinal('e4');
  // Let the stream go quiet before stdin closes.
  await sleep(300);

  await s.closeAndWait();
  return s;
}

async function recordBadModel(opts, missingModel) {
  const s = new Session(opts.katago, missingModel, opts.config);
  await Promise.race([
    s.closed,
    sleep(TIMEOUT_MS).then(() => {
      throw new Error('KataGo did not exit with a missing model');
    }),
  ]);
  return s;
}

function summarise(log) {
  const ids = new Map();
  for (const e of log) {
    if (e.s !== 'out') continue;
    const d = parseJson(e.line);
    if (!d || typeof d.id !== 'string' || !('moveInfos' in d || 'noResults' in d)) continue;
    const r = ids.get(d.id) ?? { reports: 0, final: false, moveInfos: null, noResults: false };
    if (d.isDuringSearch === false) {
      r.final = true;
      r.moveInfos = d.moveInfos?.length ?? 0;
      r.noResults = d.noResults === true;
    } else {
      r.reports += 1;
    }
    ids.set(d.id, r);
  }
  return ids;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const opts = {
    katago: resolve(a.katago),
    model: resolve(a.model),
    config: resolve(a.config),
  };
  const outDir = resolve(a['out-dir']);
  mkdirSync(outDir, { recursive: true });

  const analysis = await recordAnalysis(opts);
  const analysisFile = join(outDir, 'analysis.jsonl');
  analysis.write(analysisFile);

  const bad = await recordBadModel(opts, join(outDir, 'missing.bin.gz'));
  const badFile = join(outDir, 'bad-model.jsonl');
  bad.write(badFile);

  const sizes = [analysisFile, badFile].map((f) => [f, statSync(f).size]);
  for (const [f, size] of sizes) console.log(`${f}: ${size} bytes`);
  const summary = summarise(analysis.log);
  for (const [id, r] of summary) {
    console.log(
      `${id}: reports=${r.reports} final=${r.final} moveInfos=${r.moveInfos} noResults=${r.noResults}`,
    );
  }

  const failures = [];
  const total = sizes.reduce((n, [, size]) => n + size, 0);
  if (total > MAX_TOTAL_BYTES) failures.push(`files total ${total} bytes, over ${MAX_TOTAL_BYTES}`);
  const p1 = summary.get('p1');
  if (!p1 || p1.reports < 3 || !p1.final) failures.push('p1 needs at least 3 reports and a final');
  const p0 = summary.get('p0');
  if (!p0 || !(p0.moveInfos > 20)) failures.push('p0 final needs more than 20 moveInfos');
  if (![...summary.values()].some((r) => r.noResults)) failures.push('no noResults line');
  const ready = analysis.log.findIndex((e) => e.s === 'err' && e.line.includes(READY));
  const version = analysis.log.findIndex(
    (e) => e.s === 'out' && parseJson(e.line)?.action === 'query_version',
  );
  console.log(`ordering: ready line at index ${ready}, query_version reply at index ${version}`);
  if (ready < 0 || version < 0 || version < ready) {
    failures.push('query_version reply does not come after the ready line');
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`CHECK FAILED: ${f}`);
    process.exit(1);
  }
  console.log('all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
