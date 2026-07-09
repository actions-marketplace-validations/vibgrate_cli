import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanCandidates } from '../src/engine/literal-scan.js';
import { searchSymbols } from '../src/engine/search.js';
import type { VgGraph } from '../src/schema.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS fixture helper, no types needed
import { generateRepo, expectedCounts } from './fixture.mjs';

/**
 * Reproducible latency benchmark for the literal-search path, before vs now,
 * over a generated repo covering many literal + symbol kinds. Run:
 *
 *   pnpm --filter @vibgrate/cli-public bench:literal          # default 6000 files
 *   BENCH_FILES=12000 pnpm --filter @vibgrate/cli-public bench:literal
 *
 * "before" is a faithful transcription of the pre-change scan (full-file
 * toLowerCase + per-line re-lowercase, single-threaded). "now (pure-JS)" is the
 * shipped worker-parallel engine with ripgrep disabled — the floor every
 * customer gets with nothing installed. "now (+rg)" adds ripgrep as the file
 * pruner. Every mode's match count is asserted equal, so the table is also a
 * parity proof: faster AND identical.
 */

const IGNORE_DIRS = new Set(['.git', '.vibgrate', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__']);
const MAX_FILE_BYTES = 1_000_000;

const N = Number(process.env.BENCH_FILES ?? 6000);
const REPEATS = 3;

function walk(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(abs);
      else files.push(path.relative(root, abs));
    }
  }
  return files.sort();
}

const NUL = String.fromCharCode(0);

/**
 * The pre-change algorithm: read + full-file lowercase + per-line rescan,
 * single-threaded. Skips binaries so it scans the same corpus as the new engine
 * (a fair same-input timing baseline and parity oracle).
 */
function naiveScan(root: string, files: string[], needle: string): number {
  const lower = needle.toLowerCase();
  let total = 0;
  for (const rel of files) {
    let text: string;
    try {
      if (fs.statSync(path.join(root, rel)).size > MAX_FILE_BYTES) continue;
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes(NUL)) continue;
    if (!text.toLowerCase().includes(lower)) continue;
    const lines = text.split('\n');
    for (const line of lines) if (line.toLowerCase().includes(lower)) total++;
  }
  return total;
}

const emptyGraph: VgGraph = {
  schemaVersion: 'vg-graph/1.0',
  generatedAt: 'x',
  provenance: { tool: 'vg', version: 'bench', grammars: {}, resolver: ['heuristic'], deep: false, corpusHash: 'h' },
  meta: { root: '.', languages: [], counts: { nodes: 0, edges: 0, areas: 0, tests: 0, untested: 0 }, cluster: 'none', edgeKinds: [] },
  nodes: [],
  edges: [],
  areas: [],
};

async function timeMs(fn: () => unknown | Promise<unknown>): Promise<number> {
  const best: number[] = [];
  for (let r = 0; r < REPEATS; r++) {
    const s = process.hrtime.bigint();
    await fn();
    best.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  return Math.min(...best);
}

/** All modes must return the same count; the synthetic fixture (want >= 0) also pins it. */
function parity(label: string, got: number[], want: number): void {
  const all = want >= 0 ? [want, ...got] : got;
  if (new Set(all).size !== 1) throw new Error(`PARITY FAIL [${label}]: ${want >= 0 ? `want ${want}, ` : ''}got ${got.join('/')}`);
}

async function main(): Promise<void> {
  // BENCH_DIR measures a real tree (cross-mode parity only, counts unknown);
  // otherwise a deterministic synthetic repo with known per-needle counts.
  const benchDir = process.env.BENCH_DIR;
  let root: string;
  let expected: Record<string, number>;
  let generated = false;
  if (benchDir) {
    root = path.resolve(benchDir);
    const needles = (process.env.BENCH_NEEDLES ?? 'not found,import type,the quick brown fox jumps').split(',');
    expected = Object.fromEntries(needles.map((n) => [n.trim(), -1])); // -1 = unknown, parity-only
  } else {
    ({ root } = generateRepo(N));
    generated = true;
    expected = expectedCounts(N) as Record<string, number>;
  }
  const files = walk(root);
  const bytes = files.reduce((a, rel) => {
    try {
      return a + fs.statSync(path.join(root, rel)).size;
    } catch {
      return a;
    }
  }, 0);

  console.log(`\nLiteral-search benchmark — ${benchDir ?? `synthetic ${N} files`}, ${files.length} scanned, ${(bytes / 1e6).toFixed(1)} MB, best of ${REPEATS}\n`);

  // Warm the fs cache and the worker pool so we measure steady state.
  await scanCandidates(root, files, 'Save changes', { collectAll: true, budget: 1e9 });

  const engineRows: string[] = [];
  const e2eRows: string[] = [];
  for (const [needle, want] of Object.entries(expected)) {
    // ---- Engine, same file list: before (naive) vs now-default (auto inline/
    // workers by bytes) vs workers forced (VG_PARALLEL_MIN_BYTES=0) ----
    const beforeTotal = naiveScan(root, files, needle);
    const before = await timeMs(() => naiveScan(root, files, needle));

    let nowTotal = 0;
    delete process.env.VG_PARALLEL_MIN_BYTES;
    const now = await timeMs(async () => {
      nowTotal = (await scanCandidates(root, files, needle, { collectAll: true, budget: 1e9 })).total;
    });

    let workersTotal = 0;
    const workers = await timeMs(async () => {
      process.env.VG_PARALLEL_MIN_BYTES = '0';
      workersTotal = (await scanCandidates(root, files, needle, { collectAll: true, budget: 1e9 })).total;
    });
    delete process.env.VG_PARALLEL_MIN_BYTES;

    // Every mode must agree (parity); the synthetic fixture also pins the count.
    parity(`engine:${needle}`, [beforeTotal, nowTotal, workersTotal], want);
    engineRows.push(`  ${pad(needle, 46)} ${padNum(nowTotal, 6)} ${padNum(before, 9)} ${padNum(now, 9)} ${padNum(workers, 9)}  ${(before / now).toFixed(1)}x`);

    // ---- End-to-end (only phrases trigger the sweep): rg off vs on ----
    if (/\s/.test(needle) && nowTotal > 0) {
      let offTotal = 0;
      let onTotal = 0;
      const off = await timeMs(async () => {
        process.env.VG_DISABLE_RIPGREP = '1';
        offTotal = (await searchSymbols(emptyGraph, root, needle, 100)).totalTextMatches ?? -1;
      });
      const on = await timeMs(async () => {
        delete process.env.VG_DISABLE_RIPGREP;
        onTotal = (await searchSymbols(emptyGraph, root, needle, 100)).totalTextMatches ?? -1;
      });
      delete process.env.VG_DISABLE_RIPGREP;
      parity(`e2e:${needle}`, [offTotal, onTotal, nowTotal], want);
      e2eRows.push(`  ${pad(needle, 46)} ${padNum(nowTotal, 6)} ${padNum(off, 9)} ${padNum(on, 9)}  ${(off / on).toFixed(1)}x`);
    }
  }

  console.log('Scan engine — same candidate list (before=naive, now=auto by bytes, workers=forced):');
  console.log(`  ${pad('needle', 46)} ${pad('hits', 6)} ${pad('before', 9)} ${pad('now', 9)} ${pad('workers', 9)}  now-speedup`);
  console.log(engineRows.join('\n'));
  console.log('\nEnd-to-end phrase sweep (listing + scan) — ripgrep off vs on:');
  console.log(`  ${pad('needle', 46)} ${pad('hits', 6)} ${pad('no-rg', 9)} ${pad('+rg', 9)}  speedup`);
  console.log(e2eRows.join('\n'));
  console.log('\nAll modes returned identical counts (parity proven).\n');

  if (generated) fs.rmSync(root, { recursive: true, force: true });
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}
function padNum(n: number, w: number): string {
  const s = Number.isInteger(n) ? String(n) : `${n.toFixed(1)}ms`;
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
