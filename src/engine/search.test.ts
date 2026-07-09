import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { searchSymbols, type TextHit } from './search.js';
import type { GraphNode, VgGraph } from '../schema.js';

/**
 * `search_symbols` literal-string support: a whitespace/phrase query must run a
 * *complete* literal sweep and never let loosely-token-matching symbols starve
 * the string hits. Regression cover for the "you say" trace — the graph ranked
 * the `*SayCard` components first, the literal scan got the leftover (zero)
 * budget, and the agent abandoned vg for grep.
 */

function component(id: string, name: string, file: string): GraphNode {
  return {
    id,
    kind: 'component',
    name,
    qualifiedName: `${file}:${name}`,
    file,
    span: { start: 1, end: 10 },
    lang: 'typescript',
    importance: 0.5,
    centrality: { degree: 0, pagerank: 0, betweenness: 0, eigenvector: 0 },
    area: 0,
    isHub: false,
    tested: false,
  };
}

// A graph whose only name matches for the phrase "you say" are the `Say`
// components — the different-meaning symbols that used to crowd out the strings.
function makeGraph(): VgGraph {
  const nodes = [
    component('n_bill', 'BillSayCard', 'src/BillSayCard.tsx'),
    component('n_quick', 'QuickSayCard', 'src/QuickSayCard.tsx'),
    component('n_member', 'MemberSayCard', 'src/MemberSayCard.tsx'),
  ];
  return {
    schemaVersion: 'vg-graph/1.0',
    generatedAt: '2026-01-01T00:00:00Z',
    provenance: { tool: 'vg', version: 'test', grammars: {}, resolver: ['heuristic'], deep: false, corpusHash: 'h' },
    meta: {
      root: '.',
      languages: ['typescript'],
      counts: { nodes: 3, edges: 0, areas: 1, tests: 0, untested: 3 },
      cluster: 'louvain',
      edgeKinds: [],
    },
    nodes,
    edges: [],
    areas: [{ id: 0, label: 'core', size: 3, members: ['n_bill', 'n_member', 'n_quick'], cohesion: 0.8, externalEdges: 0 }],
  };
}

const textHits = (r: { matches: unknown[] }): TextHit[] => r.matches.filter((m): m is TextHit => (m as TextHit).kind === 'text');

let root: string;
// 10 literal occurrences of the strapline across two files (mixed case).
const TOTAL_LITERAL = 10;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-search-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(
    path.join(root, 'src', 'Footer.tsx'),
    ['export const tagline = "We watch. You say.";', '// you say it once', '<p>you say</p>', 'const x = "you say";'].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, 'docs', 'brand.md'),
    ['# You Say', 'you say', 'You say', 'YOU SAY', 'we watch. you say.', 'trailing you say line'].join('\n'),
  );
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('searchSymbols — literal phrase sweep', () => {
  it('does not let symbol matches starve the literal scan (the "you say" regression)', async () => {
    const r = await searchSymbols(makeGraph(), root, 'you say', 8);
    // The literal string hits survive alongside the (capped) symbol matches —
    // before the fix, spare budget was 0 and no text hit appeared.
    expect(textHits(r).length).toBeGreaterThan(0);
    // Symbols are demoted to secondary context, capped to a fraction of the budget.
    const symbolCount = r.matches.length - textHits(r).length;
    expect(symbolCount).toBeLessThanOrEqual(2); // floor(8/3)
  });

  it('reports the true total so a sweep can be trusted as complete', async () => {
    const r = await searchSymbols(makeGraph(), root, 'you say', 50);
    expect(r.totalTextMatches).toBe(TOTAL_LITERAL);
    // With a generous limit every occurrence is shown and nothing is left over.
    expect(textHits(r).length).toBe(TOTAL_LITERAL);
    expect(r.moreAvailable).toBe(false);
    expect(r.hint).toBeUndefined();
  });

  it('flags an incomplete sweep honestly instead of silently truncating', async () => {
    const r = await searchSymbols(makeGraph(), root, 'you say', 8);
    expect(r.totalTextMatches).toBe(TOTAL_LITERAL);
    expect(textHits(r).length).toBeLessThan(TOTAL_LITERAL);
    expect(r.moreAvailable).toBe(true);
    expect(r.hint).toMatch(/of 10 literal matches/);
  });

  it('is case-insensitive across files and reports repo-relative paths', async () => {
    const r = await searchSymbols(makeGraph(), root, 'you say', 50);
    const files = new Set(textHits(r).map((h) => h.file));
    expect(files.has(path.join('src', 'Footer.tsx'))).toBe(true);
    expect(files.has(path.join('docs', 'brand.md'))).toBe(true);
  });
});

describe('searchSymbols — single-name lookups are unchanged', () => {
  it('resolves a symbol name symbol-first with no literal-sweep total', async () => {
    const r = await searchSymbols(makeGraph(), root, 'BillSayCard', 8);
    expect(r.matches[0]).toMatchObject({ kind: 'component', name: 'src/BillSayCard.tsx:BillSayCard' });
    // No whitespace → not a literal sweep → no completeness total advertised.
    expect(r.totalTextMatches).toBeUndefined();
  });

  it('empty query asks for input', async () => {
    const r = await searchSymbols(makeGraph(), root, '   ', 8);
    expect(r.matches).toHaveLength(0);
    expect(r.hint).toBe('query is required');
  });

  it('a phrase that matches nothing pivots to query_graph', async () => {
    const r = await searchSymbols(makeGraph(), root, 'zzz qqq nomatch', 8);
    expect(r.matches).toHaveLength(0);
    expect(r.hint).toMatch(/query_graph/);
  });
});

describe('searchSymbols — ripgrep pruning is engine-independent', () => {
  const withRg = async (disabled: boolean, fn: () => Promise<void>) => {
    const prev = process.env.VG_DISABLE_RIPGREP;
    if (disabled) process.env.VG_DISABLE_RIPGREP = '1';
    else delete process.env.VG_DISABLE_RIPGREP;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.VG_DISABLE_RIPGREP;
      else process.env.VG_DISABLE_RIPGREP = prev;
    }
  };
  const sweep = () => searchSymbols(makeGraph(), root, 'you say', 50);
  const rows = (r: { matches: unknown[] }) =>
    textHits(r as { matches: TextHit[] })
      .map((h) => `${h.file}:${h.line}`)
      .sort();

  it('the forced-fallback Node walk and rg produce identical rows and totals', async () => {
    let viaFallback!: Awaited<ReturnType<typeof sweep>>;
    let viaRg!: Awaited<ReturnType<typeof sweep>>;
    await withRg(true, async () => {
      viaFallback = await sweep();
    });
    await withRg(false, async () => {
      viaRg = await sweep();
    });
    // rg is only a pruner; the pure-JS scan is the authority, so completeness
    // does not depend on whether rg happens to be installed.
    expect(viaRg.totalTextMatches).toBe(viaFallback.totalTextMatches);
    expect(rows(viaRg)).toEqual(rows(viaFallback));
  });

  it('the fallback path alone still finds every occurrence', async () => {
    await withRg(true, async () => {
      const r = await sweep();
      expect(r.totalTextMatches).toBe(TOTAL_LITERAL);
      expect(textHits(r).length).toBe(TOTAL_LITERAL);
    });
  });
});
