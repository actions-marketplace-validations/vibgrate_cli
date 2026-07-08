import * as fs from 'node:fs';
import * as path from 'node:path';
import { cacheDir } from './cache.js';

/**
 * Usage-savings tracking (VG-DEVELOPMENT-PLAN §5) — local, privacy-safe, and
 * **opt-in** (no telemetry by default, per GUARDRAILS). We record *counts only*
 * — never code, never the question text — comparing the context tokens vg
 * returned against a grep/read baseline estimate. `vg savings` reports it with
 * the assumptions shown; figures are labelled estimates, never a hero number.
 */

const LEDGER = 'savings.jsonl';
// A conservative, documented estimate: tokens an agent reads per file it opens.
export const PER_FILE_TOKENS = 400;

/** The tools whose grep/read token baseline the savings summary is computed from. */
export const SAVINGS_TOOLS = new Set(['query_graph', 'get_node']);

/**
 * Outcome of a recorded navigation call:
 *  - `complete` — returned results, with nothing capped or paginated;
 *  - `partial`  — returned results, but more were available/truncated;
 *  - `miss`     — returned no result (no match, not-found, not-connected).
 */
export type Outcome = 'complete' | 'partial' | 'miss';

export interface SavingEntry {
  ts: number; // epoch ms (runtime ledger state, not part of any artifact)
  tool: string;
  // Optional for back-compat with ledger lines written before outcomes existed;
  // an absent value is read as `complete` (those lines only recorded hits).
  outcome?: Outcome;
  vgTokens: number;
  baselineTokens: number;
}

function ledgerPath(root: string): string {
  return path.join(cacheDir(root), LEDGER);
}

/** Whether a savings ledger exists for this repo (i.e. `vg serve --savings` has recorded). */
export function savingsRecorded(root: string): boolean {
  return fs.existsSync(ledgerPath(root));
}

export function recordSaving(root: string, entry: Omit<SavingEntry, 'ts'>, now: number): void {
  try {
    fs.mkdirSync(cacheDir(root), { recursive: true });
    const line = JSON.stringify({ ts: now, ...entry });
    fs.appendFileSync(ledgerPath(root), line + '\n');
  } catch {
    /* never let telemetry break a tool call */
  }
}

export interface SavingsReport {
  enabled: boolean;
  days: number;
  queries: number;
  vgTokens: number;
  baselineTokens: number;
  ratio: number;
  estCostVg: number;
  estCostBaseline: number;
  saved: number;
  rateLabel: string;
}

// Published-style input rate ($/1M tokens), shipped with the CLI. Labelled
// estimate; the user can pass their own model rate.
const DEFAULT_RATE_PER_M = 3.0; // e.g. a mid-tier model input rate
const DEFAULT_RATE_LABEL = 'input @ $3/1M';

export function readSavings(root: string, days: number, now: number, ratePerM = DEFAULT_RATE_PER_M): SavingsReport {
  const file = ledgerPath(root);
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  let queries = 0;
  let vgTokens = 0;
  let baselineTokens = 0;
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as SavingEntry;
        if (e.ts < cutoff) continue;
        // The token-savings figures compare only the tools with a meaningful
        // grep/read baseline; the full per-command breakdown lives in readUsage.
        if (!SAVINGS_TOOLS.has(e.tool)) continue;
        queries++;
        vgTokens += e.vgTokens;
        baselineTokens += e.baselineTokens;
      } catch {
        /* skip corrupt line */
      }
    }
  }
  const estCostVg = (vgTokens / 1e6) * ratePerM;
  const estCostBaseline = (baselineTokens / 1e6) * ratePerM;
  return {
    enabled: savingsRecorded(root),
    days,
    queries,
    vgTokens,
    baselineTokens,
    ratio: vgTokens > 0 ? Math.round((baselineTokens / vgTokens) * 100) / 100 : 0,
    estCostVg: round2(estCostVg),
    estCostBaseline: round2(estCostBaseline),
    saved: round2(estCostBaseline - estCostVg),
    rateLabel: DEFAULT_RATE_LABEL,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Per-command usage stats over the ledger window (all recorded tools). */
export interface CommandStat {
  tool: string;
  calls: number;
  complete: number;
  partial: number;
  miss: number;
  /** (complete + partial) / calls, as a whole-number percentage. */
  successPct: number;
}

export interface UsageReport {
  enabled: boolean;
  days: number;
  /** One row per tool used, ordered by call count (desc), then name. */
  commands: CommandStat[];
  /** Column sums across all commands. */
  totals: { calls: number; complete: number; partial: number; miss: number };
  /** The mean of the per-command success percentages (each command weighted equally). */
  avgSuccessPct: number;
}

/**
 * Per-command breakdown of recorded navigation calls: how often each tool was
 * used and how those calls resolved (complete / partial / miss), plus column
 * totals and the average success rate. Complements the token-savings summary —
 * this counts *every* recorded tool, not just the grep-baseline ones.
 */
export function readUsage(root: string, days: number, now: number): UsageReport {
  const file = ledgerPath(root);
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const byTool = new Map<string, { complete: number; partial: number; miss: number }>();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as SavingEntry;
        if (e.ts < cutoff) continue;
        const outcome: Outcome = e.outcome ?? 'complete';
        const row = byTool.get(e.tool) ?? { complete: 0, partial: 0, miss: 0 };
        row[outcome]++;
        byTool.set(e.tool, row);
      } catch {
        /* skip corrupt line */
      }
    }
  }
  const commands: CommandStat[] = [...byTool.entries()]
    .map(([tool, r]) => {
      const calls = r.complete + r.partial + r.miss;
      return {
        tool,
        calls,
        complete: r.complete,
        partial: r.partial,
        miss: r.miss,
        successPct: calls ? Math.round(((r.complete + r.partial) / calls) * 100) : 0,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
  const totals = commands.reduce(
    (t, c) => ({
      calls: t.calls + c.calls,
      complete: t.complete + c.complete,
      partial: t.partial + c.partial,
      miss: t.miss + c.miss,
    }),
    { calls: 0, complete: 0, partial: 0, miss: 0 },
  );
  const avgSuccessPct = commands.length
    ? Math.round(commands.reduce((s, c) => s + c.successPct, 0) / commands.length)
    : 0;
  return { enabled: savingsRecorded(root), days, commands, totals, avgSuccessPct };
}
