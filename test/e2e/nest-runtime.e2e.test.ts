/**
 * Boots a real NestJS app with SpecScribeModule in a separate Node process —
 * the way users run it — on both HTTP adapters. Runs for every installed
 * NestJS major (10, 11 and the ESM-only 12) because it does not depend on
 * Jest's module loader. Requires `npm run build` first (uses dist/).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const script = path.join(__dirname, 'nest-smoke', 'app.cjs');

/** Read from disk: Nest 12's `exports` map hides package.json from require(). */
function installedNest(): { version: string } {
  const file = path.join(__dirname, '..', '..', 'node_modules', '@nestjs', 'core', 'package.json');
  return { version: JSON.parse(fs.readFileSync(file, 'utf8')).version };
}

function boot(adapter: 'express' | 'fastify', mode: 'explicit' | 'zero' = 'explicit') {
  const run = spawnSync(process.execPath, [script, adapter, mode], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    timeout: 90_000,
  });
  const line = run.stdout.trim().split('\n').pop() || '{}';
  const result = JSON.parse(line);
  if (result.error) throw new Error(result.error);
  return result;
}

describe(`NestJS ${installedNest().version} in a real Node process`, () => {
  for (const adapter of ['express', 'fastify'] as const) {
    it(`serves docs, spec and mock on the ${adapter} adapter`, () => {
      const result = boot(adapter);
      expect(result.nest).toBe(installedNest().version);
      expect(result).toMatchObject({
        adapter,
        docsStatus: 200,
        docsUi: true,
        frameDeny: 'DENY',
        paths: ['/users', '/users/{id}'],
        summary: 'List all users.',
        mockStatus: 200,
        live: { id: 1, name: 'Ada' },
      });
      expect(result.schemas).toContain('CreateUserDto');
    });

    it(`works with forRoot() and no options on ${adapter} (prefix, host and port from the running app)`, () => {
      const result = boot(adapter, 'zero');
      expect(result).toMatchObject({
        docsStatus: 200,
        docsUi: true,
        paths: ['/api/users', '/api/users/{id}'],
        summary: 'List all users.',
        mockPrefix: '/api/specscribe-mock',
        mockStatus: 200,
        live: { id: 1, name: 'Ada' },
      });
      // The docs point at the port the app really listens on, not a guess.
      expect(result.servers[0].url.replace('localhost', '127.0.0.1')).toBe(result.base);
    });
  }
});
