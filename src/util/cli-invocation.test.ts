import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolveCliInvocation,
  resetCliInvocationCache,
  NPX_INVOCATION,
} from './cli-invocation.js';

describe('resolveCliInvocation', () => {
  let dir: string;
  let ownBin: string; // a file that looks like our binary
  let foreignBin: string; // a file that belongs to some other tool

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), 'vg-invocation-'));
    ownBin = path.join(dir, 'vg-own');
    foreignBin = path.join(dir, 'vg-foreign');
    fs.writeFileSync(ownBin, '#!/usr/bin/env node\n// launcher for @vibgrate/cli\n');
    fs.writeFileSync(foreignBin, '#!/usr/bin/env node\n// some other project\n');
    resetCliInvocationCache();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    resetCliInvocationCache();
  });

  it('returns `vg` when our binary is first on PATH', () => {
    const which = (cmd: string) => (cmd === 'vg' ? ownBin : null);
    expect(resolveCliInvocation(which)).toBe('vg');
  });

  it('falls back to `vibgrate` when `vg` on PATH is a foreign binary', () => {
    const which = (cmd: string) =>
      cmd === 'vg' ? foreignBin : cmd === 'vibgrate' ? ownBin : null;
    expect(resolveCliInvocation(which)).toBe('vibgrate');
  });

  it('falls back to npx when neither command is on PATH (the npx case)', () => {
    const which = () => null;
    expect(resolveCliInvocation(which)).toBe(NPX_INVOCATION);
  });

  it('falls back to npx when both commands are foreign', () => {
    const which = () => foreignBin;
    expect(resolveCliInvocation(which)).toBe(NPX_INVOCATION);
  });

  it('memoizes the default lookup but re-evaluates when a which is injected', () => {
    let calls = 0;
    const counting = (cmd: string) => {
      calls++;
      return cmd === 'vg' ? ownBin : null;
    };
    // Injected lookups always run (and never populate the cache).
    expect(resolveCliInvocation(counting)).toBe('vg');
    expect(resolveCliInvocation(counting)).toBe('vg');
    expect(calls).toBe(2);
  });
});
