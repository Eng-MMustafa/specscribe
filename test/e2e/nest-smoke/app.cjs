/**
 * Boots a real NestJS app with SpecScribeModule in a plain Node process (no
 * Jest module system), so it works the same for CommonJS NestJS 10/11 and the
 * ESM-only NestJS 12 (loaded through Node's require(esm)).
 * Prints one JSON line with what it observed, then exits.
 */
require('reflect-metadata');
const path = require('path');
const { Module, Controller, Get, Post, Body, Param } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { SpecScribeModule } = require('../../../dist');

const adapter = process.argv[2] || 'express';
const sourcePath = path.join(__dirname, 'src');

// Decorators applied by hand: this file runs without a TypeScript build.
class UsersController {
  list() { return [{ id: 1, name: 'Ada' }]; }
  get(id) { return { id: Number(id), name: 'Ada' }; }
  create(body) { return { id: 2, ...body }; }
}
Controller('users')(UsersController);
const proto = UsersController.prototype;
const apply = (decorators, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(proto, key);
  for (const d of decorators) d(proto, key, descriptor);
  Object.defineProperty(proto, key, descriptor);
};
apply([Get()], 'list');
apply([Get(':id')], 'get');
Param('id')(proto, 'get', 0);
apply([Post()], 'create');
Body()(proto, 'create', 0);

class AppModule {}
// `zero`: forRoot() with no options at all in an app that calls
// setGlobalPrefix('api') — prefix, host and port must come from the running app.
const zero = process.argv[3] === 'zero';
// Zero-config mode finds the project (and its src/) from the working
// directory — like a user running their app from its own folder.
if (zero) process.chdir(__dirname);
Module({
  imports: [zero
    ? SpecScribeModule.forRoot()
    : SpecScribeModule.forRoot({ sourcePath, enableDocs: true, enableMock: true, logLevel: 'silent' })],
  controllers: [UsersController],
})(AppModule);

(async () => {
  let app;
  if (adapter === 'fastify') {
    const { FastifyAdapter } = require('@nestjs/platform-fastify');
    app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  } else {
    app = await NestFactory.create(AppModule, { logger: false });
  }
  const prefix = zero ? '/api' : '';
  if (zero) app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const base = url.replace('[::1]', '127.0.0.1');
  const docs = await fetch(`${base}${prefix}/docs`);
  const html = await docs.text();
  const spec = await (await fetch(`${base}${prefix}/docs-json`)).json();
  const mockPath = spec['x-specscribe-mock'] ? `${spec['x-specscribe-mock']}${prefix}/users/1` : '/specscribe-mock/users/1';
  const mock = await fetch(`${base}${mockPath}`);
  // What the docs UI's Send button calls: servers[0].url + documented path.
  const sendUrl = `${spec.servers && spec.servers[0] && spec.servers[0].url}${prefix}/users/1`;
  const live = await (await fetch(zero ? sendUrl.replace('localhost', '127.0.0.1') : `${base}/users/1`)).json();
  console.log(JSON.stringify({
    base,
    servers: spec.servers,
    mockPrefix: spec['x-specscribe-mock'],
    // Nest 12's `exports` map hides package.json from require().
    nest: JSON.parse(require('fs').readFileSync(path.join(path.dirname(require.resolve('@nestjs/core')), 'package.json'), 'utf8')).version,
    adapter,
    docsStatus: docs.status,
    docsUi: html.includes('<specscribe-docs'),
    frameDeny: docs.headers.get('x-frame-options'),
    paths: Object.keys(spec.paths || {}).sort(),
    summary: (() => { const item = spec.paths && spec.paths[`${prefix}/users`]; return item && item.get && item.get.summary; })(),
    description: spec.info && spec.info.description,
    schemas: Object.keys((spec.components && spec.components.schemas) || {}).sort(),
    mockStatus: mock.status,
    live,
  }));
  await app.close();
})().catch((e) => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(1); });
