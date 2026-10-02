/**
 * What `npm publish` would ship. The docs page reads the prebuilt UI bundle
 * at runtime, so losing it from `files` would break every install, while the
 * UI's TypeScript/CSS sources only add weight.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

describe('npm package contents', () => {
  jest.setTimeout(60_000);
  let files: string[];

  beforeAll(() => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const out = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    files = JSON.parse(out.slice(out.indexOf('[')))[0].files.map((f: { path: string }) => f.path.replace(/\\/g, '/'));
  });

  it('ships the prebuilt docs UI bundle and the compiled entry points', () => {
    expect(files).toContain('src/ui/lit/lit-docs.bundle.js');
    expect(files).toContain('dist/index.js');
    expect(files).toContain('dist/cli.js');
  });

  it('leaves out UI sources, tests and fixtures', () => {
    expect(files.filter((f) => /^src\/ui\/lit\/.*\.(ts|css)$/.test(f))).toEqual([]);
    expect(files.filter((f) => f.startsWith('test/'))).toEqual([]);
    expect(files).not.toContain('playwright.config.ts');
  });
});
