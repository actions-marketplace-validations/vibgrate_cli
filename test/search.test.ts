import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildGraph } from '../src/engine/build.js';
import { searchSymbols } from '../src/engine/search.js';
import { makeProject, cleanup } from './helpers.js';
import type { VgGraph } from '../src/schema.js';

let graph: VgGraph;
let dir: string;
beforeAll(async () => {
  dir = makeProject({
    'src/scan.ts': [
      'export function newScanModal() {}',
      'export function resolveWorkspaceDsn() {}',
      'export function copyToClipboard() {}',
    ].join('\n'),
  });
  graph = (await buildGraph({ root: dir, generatedAt: '2020-01-01T00:00:00.000Z', inline: true })).graph;
});
afterAll(() => cleanup(dir));

describe('searchSymbols', () => {
  it('resolves a known exact name (primary path, unchanged)', () => {
    const r = searchSymbols(graph, dir, 'newScanModal', 8);
    expect(r.matches[0]?.name).toContain('newScanModal');
  });

  it('resolves a multi-word phrase via per-token fallthrough', () => {
    // The whole-string name index misses "new scan modal"; the fallthrough unions
    // per-token matches and ranks by coverage. Before, this was an empty dead end.
    const r = searchSymbols(graph, dir, 'new scan modal', 8);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.some((m) => 'name' in m && m.name.includes('newScanModal'))).toBe(true);
  });

  it('ranks the best-covered symbol first for a phrase', () => {
    const r = searchSymbols(graph, dir, 'resolve workspace dsn', 8);
    expect(r.matches[0] && 'name' in r.matches[0] && r.matches[0].name).toContain('resolveWorkspaceDsn');
  });

  it('still returns the pivot hint when nothing matches at all', () => {
    const r = searchSymbols(graph, dir, 'zzznope qqxyz', 8);
    expect(r.matches.length).toBe(0);
    expect(r.hint).toBeTruthy();
  });
});
