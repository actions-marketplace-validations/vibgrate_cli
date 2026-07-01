#!/usr/bin/env node
// Keep the release version consistent across the two surfaces that PIN the CLI
// image but are published from COMMITTED files — so a build-time-only stamp
// (scripts/stamp-version.mjs, which never commits) would not reach them:
//
//   - action.yml                  → the GitHub Action's default `image-tag`
//   - charts/vibgrate/Chart.yaml  → the Helm chart's `appVersion`
//
// Each pinned line carries an inline `vibgrate:cli-version` marker. This stamper
// rewrites ONLY the marked scalar, preserving its quote style and any trailing
// comment, so it is an unambiguous single-line replacement that can't drift onto
// another `default:`/`version:` key.
//
// It runs in two places (see AGENTS.md / the Docker workflow):
//   1. scripts/stamp-version.mjs calls stampPins() when it stamps a release, so
//      an in-workspace build always carries the matching pin.
//   2. the Docker release workflow re-stamps to the just-published version and
//      commits action.yml + Chart.yaml back to main, so the rendered
//      Marketplace / chart pages track the latest build.
//
// Usage:
//   node scripts/stamp-release-pins.mjs                 # stamp to package.json version
//   node scripts/stamp-release-pins.mjs --version X.Y.Z # stamp to an explicit version
//   node scripts/stamp-release-pins.mjs --check         # exit 1 if the pins disagree
//   node scripts/stamp-release-pins.mjs --dry-run       # print the plan, write nothing

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files (relative to the package root) that pin the CLI release version behind a
// `vibgrate:cli-version` marker comment.
export const PINNED_FILES = ['action.yml', 'charts/vibgrate/Chart.yaml'];

const MARKER = 'vibgrate:cli-version';

// Matches a `key: <scalar>  # vibgrate:cli-version …` line. Captures the quote
// character so it round-trips (single, double, or none), and keeps everything
// from the marker comment onward intact. Built fresh per call to avoid shared
// lastIndex state between .replace() and .matchAll().
const pinRe = () =>
  new RegExp(
    String.raw`(^[^\n:]*:[ \t]*)(['"]?)([^'"\n#]*?)\2([ \t]*#[ \t]*${MARKER}\b)`,
    'gm',
  );

// Pure: rewrite every marked pin in `text` to `version`. Returns the new text.
export function applyPins(text, version) {
  return text.replace(pinRe(), (_m, key, quote, _old, comment) => `${key}${quote}${version}${quote}${comment}`);
}

// Pure: the versions currently pinned in `text` (one entry per marked line).
export function readPins(text) {
  return [...text.matchAll(pinRe())].map((m) => m[3]);
}

// Stamp every pinned file to `version`. Returns the relative paths that changed.
export function stampPins(version, { root = ROOT } = {}) {
  const changed = [];
  for (const rel of PINNED_FILES) {
    const file = path.join(root, rel);
    const src = fs.readFileSync(file, 'utf8');
    if (readPins(src).length === 0) {
      throw new Error(`no \`${MARKER}\` marker to stamp in ${rel}`);
    }
    const next = applyPins(src, version);
    if (next !== src) {
      fs.writeFileSync(file, next);
      changed.push(rel);
    }
  }
  return changed;
}

// --- CLI (only when run directly, not when imported by stamp-version.mjs) -----

function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name) => argv.includes(name);

  if (has('--check')) {
    // Enforceable, calendar-model-safe invariant: every pin agrees. This is the
    // exact drift the pins had before automation (Action 2026.3.1 vs chart
    // 2026.618.2). A stricter "== package.json" check would fight the calendar
    // scheme, whose committed version intentionally lags npm.
    const pins = [];
    for (const rel of PINNED_FILES) {
      for (const v of readPins(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) {
        pins.push({ rel, v });
      }
    }
    const distinct = [...new Set(pins.map((p) => p.v))];
    if (distinct.length > 1) {
      const detail = pins.map((p) => `  ${p.rel}: ${p.v}`).join('\n');
      console.error(`Version pins disagree — run \`pnpm stamp:pins\`:\n${detail}`);
      process.exit(1);
    }
    console.log(`Version pins in sync at ${distinct[0] ?? '(none)'}.`);
    return;
  }

  const version = (arg('--version') ?? JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version ?? '')
    .replace(/^v/, '')
    .trim();
  if (!version) {
    console.error('stamp-release-pins: no version (pass --version or set package.json version).');
    process.exit(1);
  }

  if (has('--dry-run')) {
    for (const rel of PINNED_FILES) {
      const cur = readPins(fs.readFileSync(path.join(ROOT, rel), 'utf8')).join(', ');
      console.log(`${rel}: ${cur} -> ${version}`);
    }
    return;
  }

  const changed = stampPins(version);
  console.log(changed.length ? `Stamped ${version} into: ${changed.join(', ')}.` : `Version pins already at ${version}.`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
