import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { ensureServableGraph } from '../src/commands/serve.js';
import { defaultGraphPath } from '../src/engine/artifacts.js';
import { parseGraph } from '../src/engine/serialize.js';
import { buildGraph } from '../src/engine/build.js';
import { writeArtifacts } from '../src/engine/artifacts.js';
import { writeSnapshot, hasDrift, probeFreshness } from '../src/engine/freshness.js';
import { CliError, ExitCode } from '../src/util/exit.js';
import { makeProject, cleanup, SAMPLE_FILES } from './helpers.js';

/** Build the map + artifacts + freshness snapshot, like `vg build` does. */
async function buildAndSnapshot(dir: string): Promise<void> {
  const result = await buildGraph({ root: dir, inline: true });
  writeArtifacts(result.graph, { root: dir, html: false, report: false });
  writeSnapshot(dir, result.graph.provenance.corpusHash, result.fileStats, {});
}

function editFile(dir: string, rel: string, append: string): void {
  const abs = path.join(dir, rel);
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8') + append);
}

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const d = makeProject(files);
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

describe('ensureServableGraph (vg serve pre-serve build/refresh)', () => {
  it('builds the map from scratch when none exists', async () => {
    const dir = project(SAMPLE_FILES);
    const graphPath = defaultGraphPath(dir);
    expect(fs.existsSync(graphPath)).toBe(false);

    await ensureServableGraph(dir, graphPath, { cwd: dir }, true, { inline: true });

    expect(fs.existsSync(graphPath)).toBe(true);
    const graph = parseGraph(fs.readFileSync(graphPath, 'utf8'));
    expect(graph.nodes.some((n) => n.qualifiedName.endsWith('double'))).toBe(true);
    // A snapshot was written too, so the in-process auto-refresh can probe.
    expect(probeFreshness(dir)).not.toBeNull();
  });

  it('rebuilds a stale map before serving so the first query is current', async () => {
    const dir = project(SAMPLE_FILES);
    const graphPath = defaultGraphPath(dir);
    await buildAndSnapshot(dir);
    editFile(dir, 'src/math.ts', 'export function triple(x: number): number { return x * 3; }\n');

    await ensureServableGraph(dir, graphPath, { cwd: dir }, true, { inline: true });

    const graph = parseGraph(fs.readFileSync(graphPath, 'utf8'));
    expect(graph.nodes.some((n) => n.qualifiedName.endsWith('triple'))).toBe(true);
    expect(hasDrift(probeFreshness(dir)!.drift)).toBe(false);
  });

  it('leaves a fresh map untouched', async () => {
    const dir = project(SAMPLE_FILES);
    const graphPath = defaultGraphPath(dir);
    await buildAndSnapshot(dir);
    const before = fs.readFileSync(graphPath, 'utf8');

    await ensureServableGraph(dir, graphPath, { cwd: dir }, true, { inline: true });

    expect(fs.readFileSync(graphPath, 'utf8')).toBe(before);
  });

  it('does not build when auto-refresh is off; errors if no map exists', async () => {
    const dir = project(SAMPLE_FILES);
    const graphPath = defaultGraphPath(dir);

    await expect(
      ensureServableGraph(dir, graphPath, { cwd: dir }, false, { inline: true }),
    ).rejects.toMatchObject({ code: ExitCode.NOT_FOUND } as Partial<CliError>);
    // Refresh disabled → the map was not built behind the user's back.
    expect(fs.existsSync(graphPath)).toBe(false);
  });
});
