import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * How the user should re-invoke this CLI in a "next step" hint.
 *
 * A user who ran `npx @vibgrate/cli scan` has no `vg` (or `vibgrate`) on PATH,
 * so a hint like `vg install` or `vg login` would fail for them — the command
 * simply isn't there. We answer the practical question "what will actually run
 * this CLI for this user?" by checking whether our binary is reachable on PATH:
 *
 *   ours-on-PATH `vg`       → `vg`                 (the normal installed case)
 *   ours-on-PATH `vibgrate` → `vibgrate`           (alias present, `vg` shadowed)
 *   neither                 → `npx @vibgrate/cli`  (npx / not installed globally)
 *
 * This is deliberately the same ladder `detectServeLaunch` uses for the MCP
 * launch command — the underlying question ("is `vg` on PATH ours?") is identical.
 */

/** The npx form that always works without a global install. */
export const NPX_INVOCATION = 'npx @vibgrate/cli';

/**
 * Locate `cmd` on PATH, returning its resolved path or null. Best-effort: a
 * missing command or an unavailable `which`/`where` both yield null.
 */
export function whichOnPath(cmd: string): string | null {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(/\r?\n/)[0];
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Does this PATH entry launch *this* package? Symlink installs resolve into a
 * `…/@vibgrate/cli/…` directory; script shims (pnpm/bun/yarn, Windows .cmd)
 * reference the package path in their first bytes. Best-effort: unreadable or
 * unrecognisable entries count as foreign, which only makes callers pick a safer
 * fallback.
 */
export function isOwnBinary(binPath: string): boolean {
  try {
    const real = fs.realpathSync(binPath);
    if (/[\\/]@vibgrate[\\/]cli[\\/]/.test(real)) return true;
    const head = fs.readFileSync(real, { encoding: 'utf8' }).slice(0, 2048);
    return head.includes('@vibgrate/cli') || head.includes('vibgrate');
  } catch {
    return false;
  }
}

let cached: string | undefined;

/**
 * The command prefix a user should type to re-run this CLI (see module doc).
 * Memoized per-process: PATH does not change mid-run, and each call would
 * otherwise spawn `which`. Pass `which` to override lookup in tests, which also
 * bypasses the cache.
 */
export function resolveCliInvocation(which?: (cmd: string) => string | null): string {
  if (!which && cached !== undefined) return cached;
  const lookup = which ?? whichOnPath;

  const vg = lookup('vg');
  let result: string;
  if (vg && isOwnBinary(vg)) {
    result = 'vg';
  } else {
    const vibgrate = lookup('vibgrate');
    result = vibgrate && isOwnBinary(vibgrate) ? 'vibgrate' : NPX_INVOCATION;
  }

  if (!which) cached = result;
  return result;
}

/** Reset the memoized invocation. Test-only. */
export function resetCliInvocationCache(): void {
  cached = undefined;
}
