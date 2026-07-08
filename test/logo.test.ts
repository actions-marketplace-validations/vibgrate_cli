import { describe, it, expect } from 'vitest';
import { logoLines } from '../src/util/logo.js';

const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

describe('vg logo banner', () => {
  it('renders the robot mark, the Vibgrate Graph wordmark, and a version', () => {
    const text = plain(logoLines().join('\n'));
    expect(text).toContain('Vibgrate');
    expect(text).toContain('Graph');
    expect(text).toMatch(/v\d/); // calendar version stamp
    expect(text).toContain('╭──────╮'); // the robot mark, matching the scanner
  });

  it('stacks the wordmark on its own line, not beside the variable-width art', () => {
    const lines = logoLines().map(plain);
    const wordmarkLine = lines.find((l) => l.includes('Vibgrate'))!;
    // the wordmark line carries no box-drawing glyphs → nothing misaligns beside it
    expect(wordmarkLine).not.toMatch(/[╭╮╰╯┤├│◼]/);
  });

  it('shows the root path on its own line when given', () => {
    expect(plain(logoLines('myrepo').join('\n'))).toContain('myrepo');
  });
});
