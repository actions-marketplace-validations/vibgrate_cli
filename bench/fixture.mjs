import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Deterministic synthetic repo for the literal-search benchmark and the
 * varied-literal-types test. No randomness — every file's content is a pure
 * function of its index, so counts are exact and reproducible across runs and
 * machines. Covers the literal kinds real code carries: UI copy, log lines,
 * config keys, error strings, comments, JSX text, and Markdown/JSON/HTML — plus
 * a symbol per file so symbol-pass lookups have something to resolve.
 */

// Repo-relative markers → the exact number of files each appears in, given N.
// Query these to assert the scan finds every occurrence, of every kind.
export function expectedCounts(n) {
  return {
    'Save changes': countWhere(n, (i) => i % 3 === 0), // common UI copy
    'failed to connect to database': countWhere(n, (i) => i % 17 === 0), // log line
    'MAX_RETRY_COUNT': countWhere(n, (i) => i % 12 === 0), // config key (single token)
    'you say the quiet part': RARE_INDICES.filter((i) => i < n).length, // rare phrase
    '$9.99 (per item) [tax] a|b': countWhere(n, (i) => i % 7 === 0), // regex metacharacters — must stay literal
    'Café ☕ Ünïcödé déjà vu': countWhere(n, (i) => i % 23 === 0), // unicode / emoji / accents
    'this phrase appears in absolutely no file anywhere': 0, // worst-case miss
  };
}

const RARE_INDICES = [5, 500, 3000, 5500];

function countWhere(n, pred) {
  let c = 0;
  for (let i = 0; i < n; i++) if (pred(i)) c++;
  return c;
}

const IGNORED_DECOYS = ['node_modules', 'dist']; // files here must NOT be counted

/** Build the repo under a fresh temp dir; returns { root, n }. */
export function generateRepo(n) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-litbench-'));
  for (const d of ['src', 'src/components', 'docs', 'config', ...IGNORED_DECOYS]) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(root, relFor(i)), contentFor(i));
  // Decoys inside ignored dirs — every marker present, but must be pruned out.
  for (const d of IGNORED_DECOYS) {
    fs.writeFileSync(
      path.join(root, d, 'decoy.ts'),
      'Save changes\nMAX_RETRY_COUNT\nfailed to connect to database\nyou say the quiet part\n$9.99 (per item) [tax] a|b\nCafé ☕ Ünïcödé déjà vu\n',
    );
  }
  return { root, n };
}

function relFor(i) {
  const kind = i % 10;
  if (kind === 7) return path.join('docs', `doc-${pad(i)}.md`);
  if (kind === 8) return path.join('config', `conf-${pad(i)}.json`);
  if (kind === 3) return path.join('src', 'components', `Comp${i}.tsx`);
  if (kind === 5) return path.join('src', `page-${pad(i)}.html`);
  return path.join('src', `mod-${pad(i)}.ts`);
}

function contentFor(i) {
  const lines = [];
  // A symbol per file (some share a hub name) so symbol-pass lookups resolve.
  const sym = i % 50 === 0 ? 'OrderService' : `handler${i}`;
  const kind = i % 10;
  // Kind gives file-type variety (extension + shape); it does NOT gate the
  // counted markers below, so each marker's count is exactly its predicate.
  if (kind === 7) lines.push(`# Doc ${i}`, '', 'Prose paragraph describing the module.', `See \`${sym}\`.`);
  else if (kind === 8) lines.push('{', `  "name": "conf-${i}",`, `  "handler": "${sym}"`, '}');
  else if (kind === 3) lines.push(`export function ${sym}() {`, '  return <button>Submit</button>;', '}');
  else if (kind === 5) lines.push(`<!doctype html><html><body><span>${sym}</span></body></html>`);
  else lines.push(`export function ${sym}(x) {`, `  throw new Error("Error E${i}: operation failed");`, '  // TODO: refactor this handler', '  return x;', '}');

  // Counted literal markers — injected uniformly so a marker appears in exactly
  // the files its predicate selects, regardless of file kind. Different literal
  // shapes: UI copy, a log line, a config key, and a rare comment phrase.
  if (i % 3 === 0) lines.push('// UI copy: Save changes'); // common
  if (i % 17 === 0) lines.push('logger.error("failed to connect to database");'); // log line
  if (i % 12 === 0) lines.push('const cfg = MAX_RETRY_COUNT;'); // config key (single token)
  if (RARE_INDICES.includes(i)) lines.push('// note: you say the quiet part out loud'); // rare phrase
  if (i % 7 === 0) lines.push('// receipt line: $9.99 (per item) [tax] a|b — total'); // regex metacharacters
  if (i % 23 === 0) lines.push('const greeting = "Café ☕ Ünïcödé déjà vu";'); // unicode / emoji / accents

  // Filler so files have realistic mass (the scan reads every byte). Tunable via
  // BENCH_LINES to push total bytes above the worker threshold for the big run.
  const filler = Number(process.env.BENCH_LINES ?? 40);
  for (let k = 0; k < filler; k++) lines.push(`  const filler_${k} = ${k} * ${i}; // padding to give the scanner real bytes`);
  return lines.join('\n') + '\n';
}

function pad(i) {
  return String(i).padStart(6, '0');
}
