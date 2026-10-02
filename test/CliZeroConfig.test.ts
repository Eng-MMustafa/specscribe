/**
 * `npx specscribe` needs no arguments: the source folder is optional on every
 * single-project command, and bare `specscribe` outside a project explains
 * what to do instead of failing.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatHelp, parseCommand, type CommandDef } from '../src/utils/CliParser';

const cli = path.resolve(__dirname, '..', 'dist', 'cli.js');

describe('optional source folder', () => {
  const serve: CommandDef = { name: 'serve', description: 'x', positionals: [], optionalPositionals: ['sourcePath'], options: [] };

  it('parses with and without the folder', () => {
    expect(parseCommand(serve, []).positionals).toEqual([]);
    expect(parseCommand(serve, ['src']).positionals).toEqual(['src']);
  });

  it('shows it as optional in the help', () => {
    expect(formatHelp('specscribe', 'd', [serve])).toContain('serve [sourcePath]');
  });
});

describe('bare `specscribe`', () => {
  jest.setTimeout(30_000);
  const run = (cwd: string, args: string[] = []) =>
    execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CI: '1' } });

  it('outside a project, prints the help and says where to run it', () => {
    if (!fs.existsSync(cli)) return; // built by `npm run build` before the suite in CI
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-empty-'));
    try {
      const out = run(empty);
      expect(out).toContain('serve [sourcePath]');
      expect(out).toContain('Run `npx specscribe` inside your project folder');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('rejects unknown options without starting anything', () => {
    if (!fs.existsSync(cli)) return;
    expect(() => execFileSync(process.execPath, [cli, '--nope'], { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' }))
      .toThrow(/unknown option '--nope'/);
  });
});
