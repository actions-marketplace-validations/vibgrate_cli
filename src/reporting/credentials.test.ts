import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import {
  clearStoredCredentials,
  credentialsPath,
  gitignoreEntryForCredentials,
  homeCredentialsPath,
  projectCredentialsPath,
  readStoredCredentials,
  resolveDsn,
  writeStoredCredentials,
} from './credentials.js';

const SAMPLE_DSN = `vibgrate+https://${'a'.repeat(24)}:${'b'.repeat(64)}@us.ingest.vibgrate.com/0123456789abcdef`;

describe('credentials store', () => {
  let home: string;
  const prevHome = process.env.HOME;
  const prevDsn = process.env.VIBGRATE_DSN;
  const prevCredsEnv = process.env.VIBGRATE_CREDENTIALS;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(tmpdir(), 'vibgrate-home-'));
    process.env.HOME = home;
    delete process.env.VIBGRATE_DSN;
    delete process.env.VIBGRATE_CREDENTIALS;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevDsn === undefined) delete process.env.VIBGRATE_DSN;
    else process.env.VIBGRATE_DSN = prevDsn;
    if (prevCredsEnv === undefined) delete process.env.VIBGRATE_CREDENTIALS;
    else process.env.VIBGRATE_CREDENTIALS = prevCredsEnv;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes and reads stored credentials under ~/.vibgrate', () => {
    expect(readStoredCredentials()).toBeNull();
    writeStoredCredentials({ dsn: SAMPLE_DSN, workspaceId: '0123456789abcdef', savedAt: 'now' });
    expect(credentialsPath().startsWith(home)).toBe(true);
    expect(readStoredCredentials()?.dsn).toBe(SAMPLE_DSN);
  });

  it('clears stored credentials', () => {
    writeStoredCredentials({ dsn: SAMPLE_DSN, savedAt: 'now' });
    expect(clearStoredCredentials()).toBe(true);
    expect(readStoredCredentials()).toBeNull();
    // clearing again is a no-op
    expect(clearStoredCredentials()).toBe(false);
  });

  it('resolveDsn precedence: flag > env > stored', () => {
    writeStoredCredentials({ dsn: 'STORED', savedAt: 'now' });
    expect(resolveDsn('FLAG')).toBe('FLAG');

    process.env.VIBGRATE_DSN = 'ENV';
    expect(resolveDsn()).toBe('ENV');
    expect(resolveDsn('FLAG')).toBe('FLAG');

    delete process.env.VIBGRATE_DSN;
    expect(resolveDsn()).toBe('STORED');
  });

  it('returns undefined when nothing is configured', () => {
    expect(resolveDsn()).toBeUndefined();
  });

  it('ignores a corrupt credentials file', () => {
    fs.mkdirSync(path.dirname(credentialsPath()), { recursive: true });
    fs.writeFileSync(credentialsPath(), 'not json', 'utf8');
    expect(readStoredCredentials()).toBeNull();
  });

  it('derives a repo-relative .gitignore entry when creds live in the repo', () => {
    // With HOME pointed at the repo root, the credentials file is inside it.
    expect(gitignoreEntryForCredentials(home)).toBe('.vibgrate/credentials.json');
  });

  it('falls back to the conventional path when creds are outside the repo', () => {
    const repo = fs.mkdtempSync(path.join(tmpdir(), 'vibgrate-repo-'));
    try {
      // creds live under $HOME, which is a different tree than `repo`.
      expect(gitignoreEntryForCredentials(repo)).toBe('.vibgrate/credentials.json');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('project-local credential store', () => {
  let home: string;
  let project: string;
  const prevHome = process.env.HOME;
  const prevCredsEnv = process.env.VIBGRATE_CREDENTIALS;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(tmpdir(), 'vibgrate-home-'));
    // A project dir under tmpdir (no .git above it, so findGitRoot -> the dir).
    project = fs.mkdtempSync(path.join(tmpdir(), 'vibgrate-project-'));
    fs.mkdirSync(path.join(project, '.git'), { recursive: true });
    process.env.HOME = home;
    delete process.env.VIBGRATE_CREDENTIALS;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevCredsEnv === undefined) delete process.env.VIBGRATE_CREDENTIALS;
    else process.env.VIBGRATE_CREDENTIALS = prevCredsEnv;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('defaults to the home store when nothing opts in', () => {
    expect(credentialsPath({ cwd: project })).toBe(homeCredentialsPath());
    expect(credentialsPath({ cwd: project }).startsWith(home)).toBe(true);
  });

  it('writes to the project store with { local: true } and reads it back', () => {
    writeStoredCredentials({ dsn: SAMPLE_DSN, savedAt: 'now' }, { local: true, cwd: project });
    const expected = path.join(project, '.vibgrate', 'credentials.json');
    expect(projectCredentialsPath(project)).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
    // The home store is untouched.
    expect(fs.existsSync(homeCredentialsPath())).toBe(false);
    expect(readStoredCredentials({ cwd: project })?.dsn).toBe(SAMPLE_DSN);
  });

  it('auto-detects an existing project store without needing the flag again', () => {
    writeStoredCredentials({ dsn: SAMPLE_DSN, savedAt: 'now' }, { local: true, cwd: project });
    // A later plain call (no { local }) still resolves to the project store.
    expect(credentialsPath({ cwd: project })).toBe(path.join(project, '.vibgrate', 'credentials.json'));
    expect(readStoredCredentials({ cwd: project })?.dsn).toBe(SAMPLE_DSN);
  });

  it('finds the project store from a subdirectory (anchored at the git root)', () => {
    const sub = path.join(project, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    writeStoredCredentials({ dsn: SAMPLE_DSN, savedAt: 'now' }, { local: true, cwd: project });
    expect(projectCredentialsPath(sub)).toBe(path.join(project, '.vibgrate', 'credentials.json'));
    expect(readStoredCredentials({ cwd: sub })?.dsn).toBe(SAMPLE_DSN);
  });

  it('clears the project store it resolves to', () => {
    writeStoredCredentials({ dsn: SAMPLE_DSN, savedAt: 'now' }, { local: true, cwd: project });
    expect(clearStoredCredentials({ cwd: project })).toBe(true);
    expect(readStoredCredentials({ cwd: project })).toBeNull();
  });

  it('VIBGRATE_CREDENTIALS overrides both stores', () => {
    const custom = path.join(project, 'nested', 'creds.json');
    process.env.VIBGRATE_CREDENTIALS = custom;
    // Even with { local: true }, the explicit env path wins.
    expect(credentialsPath({ local: true, cwd: project })).toBe(path.resolve(custom));
    writeStoredCredentials({ dsn: SAMPLE_DSN, savedAt: 'now' });
    expect(fs.existsSync(custom)).toBe(true);
    expect(readStoredCredentials()?.dsn).toBe(SAMPLE_DSN);
  });

  it('derives a repo-relative gitignore entry for the project store', () => {
    const credsFile = path.join(project, '.vibgrate', 'credentials.json');
    expect(gitignoreEntryForCredentials(project, credsFile)).toBe('.vibgrate/credentials.json');
  });
});
