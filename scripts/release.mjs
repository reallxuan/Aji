#!/usr/bin/env node
// Publishes the installers as a GitHub release for a version tag (M8 design 5.5).
//
//   node scripts/release.mjs <tag> <artifacts-dir> [--dry-run]
//
// A release-candidate tag (v0.1.0-rc.1) publishes the installers CI just built as a pre-release.
// A version tag (v0.1.0) publishes the files of the newest release candidate on the same commit,
// so the release carries exactly what was walked in acceptance; with no such candidate it fails.
// --dry-run does every read, prints what it would publish, and creates nothing.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAG = /^v(\d+\.\d+\.\d+)(?:-rc\.(\d+))?$/;
const KINDS = [
  ['.dmg', (n) => n.endsWith('.dmg')],
  ['.AppImage', (n) => n.endsWith('.AppImage')],
  ['-setup.exe', (n) => n.endsWith('-setup.exe')],
];

/** The version a tag names and whether it is a release candidate; throws on any other tag. */
export function parseTag(tag, packageVersion) {
  const match = TAG.exec(tag);
  if (!match) throw new Error(`${tag} is not v<version> or v<version>-rc.<n>`);
  const version = match[1];
  if (version !== packageVersion) {
    throw new Error(`tag ${tag} names ${version}, but package.json is ${packageVersion}`);
  }
  return { version, prerelease: match[2] !== undefined };
}

/** The three installers among the artifact names, sorted; throws unless there is one of each. */
export function pickInstallers(names) {
  const picked = [];
  for (const [label, matches] of KINDS) {
    const found = names.filter(matches);
    if (found.length !== 1) throw new Error(`expected one ${label}, found ${found.length}`);
    picked.push(found[0]);
  }
  return picked.sort();
}

/** The newest release-candidate tag (highest n) whose commit is `sha`, or null. */
export function candidateFor(sha, releases) {
  let best = null;
  for (const { tagName, sha: at } of releases) {
    const rc = TAG.exec(tagName)?.[2];
    if (rc === undefined || at !== sha) continue;
    if (best === null || Number(rc) > best.rc) best = { tagName, rc: Number(rc) };
  }
  return best?.tagName ?? null;
}

/** Where the files come from: this run's build for a candidate, the walked candidate for a release. */
export function resolveSource({ prerelease, sha, releases }) {
  if (prerelease) return { kind: 'build' };
  const from = candidateFor(sha, releases);
  if (from === null) throw new Error(`no release candidate on this commit (${sha})`);
  return { kind: 'copy', from };
}

function run(command, args) {
  return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function releases() {
  const listed = JSON.parse(run('gh', ['release', 'list', '--limit', '100', '--json', 'tagName']));
  return listed.map(({ tagName }) => {
    let sha = null;
    try {
      sha = run('git', ['rev-list', '-n', '1', tagName]);
    } catch {
      // A release whose tag is not fetched cannot be on this commit.
    }
    return { tagName, sha };
  });
}

function main() {
  const [tag, artifacts] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  if (!tag || !artifacts) {
    console.error('usage: node scripts/release.mjs <tag> <artifacts-dir> [--dry-run]');
    process.exit(2);
  }
  const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const { prerelease } = parseTag(tag, version);
  const sha = process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD']);
  const source = resolveSource({ tag, prerelease, sha, releases: prerelease ? [] : releases() });

  const out = mkdtempSync(path.join(tmpdir(), 'aji-release-'));
  let files;
  if (source.kind === 'build') {
    const all = filesUnder(path.resolve(artifacts));
    const names = pickInstallers(all.map((f) => path.basename(f)));
    files = names.map((name) => {
      const target = path.join(out, name);
      copyFileSync(
        all.find((f) => path.basename(f) === name),
        target,
      );
      return target;
    });
    const sums = files.map((f) => `${sha256(f)}  ${path.basename(f)}`).join('\n');
    writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${sums}\n`);
  } else {
    run('gh', ['release', 'download', source.from, '--dir', out, '--clobber']);
    const names = pickInstallers(readdirSync(out));
    files = names.map((name) => path.join(out, name));
    const listed = new Map(
      readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split(/\s+/))
        .map(([hash, name]) => [name, hash]),
    );
    for (const file of files) {
      if (listed.get(path.basename(file)) !== sha256(file)) {
        throw new Error(`${path.basename(file)} does not match ${source.from}'s SHA256SUMS.txt`);
      }
    }
  }
  files.push(path.join(out, 'SHA256SUMS.txt'));

  const notes = readFileSync(path.join(ROOT, '.github', 'release-notes.md'), 'utf8')
    .replaceAll('{{tag}}', tag)
    .replaceAll('{{commit}}', sha);
  const notesFile = path.join(out, 'notes.md');
  writeFileSync(notesFile, notes);

  console.log(`tag ${tag}: ${prerelease ? 'pre-release' : 'release'} of ${version} at ${sha}`);
  console.log(source.kind === 'build' ? 'files: this build' : `files: copied from ${source.from}`);
  for (const file of files) console.log(`  ${sha256(file)}  ${path.basename(file)}`);
  console.log(`notes:\n${notes}`);
  if (dryRun) {
    console.log('dry run: nothing published');
    return;
  }
  const args = ['release', 'create', tag, '--title', `Aji ${tag}`, '--notes-file', notesFile];
  if (prerelease) args.push('--prerelease');
  run('gh', [...args, '--verify-tag', ...files]);
  console.log(`published ${tag}`);
}

// Run only when executed, so the tests can import the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
