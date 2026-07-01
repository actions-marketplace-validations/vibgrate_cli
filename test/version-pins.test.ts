import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
// The release-pin stamper is plain ESM shared by scripts/stamp-version.mjs and
// the Docker workflow; test its pure core plus the live-file invariant CI checks.
import { applyPins, readPins, PINNED_FILES } from '../scripts/stamp-release-pins.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('applyPins', () => {
  it('rewrites a single-quoted pin, preserving quotes and the trailing comment', () => {
    const src = `    default: '2026.1.1' # vibgrate:cli-version — stamped by scripts/stamp-release-pins.mjs\n`;
    expect(applyPins(src, '2026.701.3')).toBe(
      `    default: '2026.701.3' # vibgrate:cli-version — stamped by scripts/stamp-release-pins.mjs\n`,
    );
  });

  it('rewrites a double-quoted pin, keeping the double quotes', () => {
    const src = `appVersion: "2026.1.1" # vibgrate:cli-version\n`;
    expect(applyPins(src, '2026.701.3')).toBe(`appVersion: "2026.701.3" # vibgrate:cli-version\n`);
  });

  it('rewrites an unquoted pin without adding quotes', () => {
    const src = `tag: 2026.1.1 # vibgrate:cli-version\n`;
    expect(applyPins(src, '2026.701.3')).toBe(`tag: 2026.701.3 # vibgrate:cli-version\n`);
  });

  it('leaves unmarked lines untouched (only the marked scalar changes)', () => {
    const src = [
      `name: 'Vibgrate Scan'`,
      `    default: 'sarif'`, // an unrelated default — must not move
      `    default: '2026.1.1' # vibgrate:cli-version`,
    ].join('\n');
    const out = applyPins(src, '2026.701.3');
    expect(out).toContain(`    default: 'sarif'`);
    expect(out).toContain(`    default: '2026.701.3' # vibgrate:cli-version`);
  });

  it('is idempotent', () => {
    const src = `appVersion: "2026.1.1" # vibgrate:cli-version\n`;
    const once = applyPins(src, '2026.701.3');
    expect(applyPins(once, '2026.701.3')).toBe(once);
  });
});

describe('readPins', () => {
  it('returns every marked version, ignoring unmarked lines', () => {
    const src = `default: 'x'\nappVersion: "2026.9.9" # vibgrate:cli-version\n`;
    expect(readPins(src)).toEqual(['2026.9.9']);
  });
});

describe('live repo pins', () => {
  it('every pinned file carries exactly one marker and they all agree (mirrors `pnpm check:pins`)', () => {
    const pins = PINNED_FILES.flatMap((rel) => {
      const found = readPins(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      expect(found, `${rel} must carry a vibgrate:cli-version marker`).toHaveLength(1);
      return found;
    });
    expect(new Set(pins).size, `pins disagree: ${pins.join(', ')}`).toBe(1);
  });
});
