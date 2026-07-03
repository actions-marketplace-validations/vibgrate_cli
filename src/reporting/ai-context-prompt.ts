import * as path from 'node:path';
import chalk from 'chalk';
import { pathExists } from '../core-open/index.js';
import { resolveCliInvocation } from '../util/cli-invocation.js';

// Map of AI assistant config file/dir patterns to the `vg install <name>` argument.
// Checked in priority order — first match wins.
const AI_ASSISTANT_DETECTORS: Array<{ files: string[]; name: string }> = [
  { files: ['CLAUDE.md', '.claude'],                             name: 'claude'   },
  { files: ['.cursor', '.cursorrules'],                          name: 'cursor'   },
  { files: ['.windsurf'],                                        name: 'windsurf' },
  { files: ['.github/copilot-instructions.md', '.copilot'],      name: 'copilot'  },
  { files: ['.gemini'],                                          name: 'gemini'   },
  { files: ['.continuerc.json'],                                 name: 'continue' },
  { files: ['.codex'],                                           name: 'codex'    },
];

export async function detectAiAssistant(rootDir: string): Promise<string | null> {
  for (const detector of AI_ASSISTANT_DETECTORS) {
    for (const file of detector.files) {
      if (await pathExists(path.join(rootDir, file))) {
        return detector.name;
      }
    }
  }
  return null;
}

export function printAiContextPrompt(detectedAssistant: string | null): void {
  const teal = chalk.hex('#3FB0A4');
  const mint = chalk.hex('#4FE3C1');
  // Prefix with whatever actually runs this CLI for the user: `vg` when it's
  // installed on PATH, or `npx @vibgrate/cli` when they ran via npx (where a
  // bare `vg install` would not resolve).
  const cli = resolveCliInvocation();
  const installArgs = detectedAssistant ? `install ${detectedAssistant}` : 'install --all';
  const installCmd = `${cli} ${installArgs}`;
  const detectedNote = detectedAssistant
    ? chalk.dim(`  (${detectedAssistant} config detected)`)
    : '';

  console.log('');
  console.log(teal('  ╭──────────────────────────────────────────────────╮'));
  console.log(teal('  │') + '  ' + mint('◆') + '  ' + chalk.bold.white('Get AI-aware answers in your editor') + '          ' + teal('│'));
  console.log(teal('  ╰──────────────────────────────────────────────────╯'));
  console.log('');
  console.log('  ' + chalk.bold.white(installCmd) + detectedNote);
  console.log('');
  console.log('  ' + teal('·') + ' ' + chalk.white('Code map in your assistant') + chalk.dim(' — call trees, impact surfaces, import paths'));
  console.log('  ' + teal('·') + ' ' + chalk.white('Offline drift') + chalk.dim(' — DriftScore and upgrade priorities, right inside your editor'));
  console.log('  ' + teal('·') + ' ' + chalk.white('Version-correct library docs') + chalk.dim(' — pinned to your lockfile, no hallucinated APIs'));
  console.log('');
}
