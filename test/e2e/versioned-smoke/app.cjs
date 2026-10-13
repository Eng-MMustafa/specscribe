/**
 * A Nest app with a global prefix and URI versioning (`defaultVersion: '1'`),
 * booted in its own Node process. Prints one JSON line describing what the
 * docs, the spec, the banner and the mock server actually do.
 *
 *   node app.cjs <express|fastify> [explicit]
 *
 * Without `explicit`, forRoot() gets no options (prefix and version must be
 * detected from the running app); with it, `globalPrefix: 'api'` is passed.
 */
require('reflect-metadata');
const path = require('path');
const { Controller, Get, Module, Param, Version, VersioningType } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { SpecScribeModule } = require('../../../dist');

const adapter = process.argv[2] || 'express';
const explicit = process.argv[3] === 'explicit';
process.chdir(__dirname);

// Runtime controllers mirroring src/users.controller.ts (the docs come from the source).
class UsersController {
  list() { return [{ id: 1, name: 'Ada' }]; }
  get(id) { return { id: Number(id), name: 'Ada' }; }
  listV2() { return []; }
}
Controller('users')(UsersController);
const d = (name) => Object.getOwnPropertyDescriptor(UsersController.prototype, name);
Get()(UsersController.prototype, 'list', d('list'));
Get(':id')(UsersController.prototype, 'get', d('get'));
Param('id')(UsersController.prototype, 'get', 0);
Version('2')(UsersController.prototype, 'listV2', d('listV2'));
Get('all')(UsersController.prototype, 'listV2', d('listV2'));

class AppModule {}
Module({
  imports: [explicit ? SpecScribeModule.forRoot({ globalPrefix: 'api' }) : SpecScribeModule.forRoot()],
  controllers: [UsersController],
})(AppModule);

(async () => {
  const banner = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => { banner.push(String(chunk)); return true; };
  let app;
  if (adapter === 'fastify') {
    const { FastifyAdapter } = require('@nestjs/platform-fastify');
    app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  } else {
    app = await NestFactory.create(AppModule, { logger: false });
  }
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  await app.listen(0, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 50));
  process.stdout.write = write;

  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  const status = async (p) => (await fetch(base + p)).status;
  const docsUrl = (await status('/api/docs')) === 200 ? '/api/docs' : (await status('/api/v1/docs')) === 200 ? '/api/v1/docs' : null;
  const spec = docsUrl ? await (await fetch(`${base}${docsUrl}-json`)).json() : {};
  const ws = docsUrl ? await (await fetch(`${base}${docsUrl}-ws-json`)).json() : { gateways: [] };
  const text = banner.join('').replace(/\x1b\[[0-9;]*m/g, '');
  const bannerLink = (label) => { const m = text.match(new RegExp(`${label}\\s+(\\S+)`)); return m ? m[1].replace(/^https?:\/\/[^/]+/, '') : null; };

  const mock = {};
  for (const p of ['/api/specscribe-mock/v1/users', '/api/specscribe-mock/users', '/api/specscribe-mock/v1/users/7',
    '/api/specscribe-mock/v2/users/all', '/api/specscribe-mock/api/v1/users', '/api/specscribe-mock/api/users']) {
    mock[p] = await status(p);
  }
  const mockBase = spec['x-specscribe-mock'];
  const firstPath = Object.keys(spec.paths || {}).find((p) => p.endsWith('/users'));
  // What the docs UI requests for a mock call: x-specscribe-mock + (documented path minus x-specscribe-prefix).
  const strip = spec['x-specscribe-prefix'] || '';
  const uiMockPath = mockBase && firstPath ? mockBase + (strip && firstPath.startsWith(strip) ? firstPath.slice(strip.length) : firstPath) : null;

  console.log(JSON.stringify({
    adapter,
    docsUrl,
    bannerDocs: bannerLink('Documentation'),
    bannerMock: bannerLink('Mock Server'),
    paths: Object.keys(spec.paths || {}).sort(),
    mockBase,
    uiMockPath,
    uiMockStatus: uiMockPath ? await status(uiMockPath) : null,
    realV1: await status('/api/v1/users'),
    mock,
    wsEvents: (ws.gateways || []).flatMap((g) => g.events.map((e) => e.event)).sort(),
    wsNamespace: (ws.gateways || [])[0] && ws.gateways[0].namespace,
  }));
  await app.close();
})().catch((e) => { console.log(JSON.stringify({ error: String((e && e.stack) || e) })); process.exit(1); });
