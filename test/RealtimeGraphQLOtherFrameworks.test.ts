/**
 * Realtime and GraphQL for Fastify and Hono projects: Socket.IO plugins,
 * `@fastify/websocket` routes, Hono `upgradeWebSocket`, Mercurius and
 * `@hono/graphql-server` — read from source like the Express ones.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExpressWebSocketScanner } from '../src/express/ExpressWebSocketScanner';
import { ExpressGraphQLScanner } from '../src/express/ExpressGraphQLScanner';
import { StandaloneDocsServer } from '../src/standalone/StandaloneDocsServer';
import { SpecScribeLogger } from '../src/utils/SpecScribeLogger';

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-rt-'));
  for (const [rel, text] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return root;
}

describe('Fastify / Hono realtime and GraphQL', () => {
  const roots: string[] = [];
  beforeAll(() => SpecScribeLogger.configure('silent'));
  afterAll(() => {
    SpecScribeLogger.configure('info');
    roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true }));
  });
  const make = (files: Record<string, string>) => { const r = project(files); roots.push(r); return r; };

  const fastifyWs = `
    const fastify = require('fastify')();
    fastify.register(require('@fastify/websocket'));
    // Live price feed for one symbol.
    fastify.get('/prices', { websocket: true }, (socket, req) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'subscribe': socket.send(JSON.stringify({ ok: true, symbol: msg.symbol })); break;
          case 'unsubscribe': break;
        }
      });
    });
  `;

  it('documents @fastify/websocket routes with their message types', () => {
    const [gw] = ExpressWebSocketScanner.scan(make({ 'src/prices.js': fastifyWs }));
    expect(gw).toMatchObject({ namespace: '/prices', transport: 'ws', frame: 'raw' });
    expect(gw.events.map((e) => e.event)).toEqual(['subscribe', 'unsubscribe']);
    expect(gw.events[0].summary).toBe('Live price feed for one symbol');
    expect(gw.events[0].payload).toEqual({ type: 'object', properties: { type: { type: 'string', enum: ['subscribe'] } }, required: ['type'] });
    expect(Object.keys(gw.events[0].response.properties)).toEqual(['ok', 'symbol']);
  });

  it('documents Hono upgradeWebSocket routes', () => {
    const [gw] = ExpressWebSocketScanner.scan(make({
      'src/index.ts': `
        import { Hono } from 'hono';
        import { upgradeWebSocket } from 'hono/cloudflare-workers';
        const app = new Hono();
        app.get('/chat', upgradeWebSocket((c) => ({
          onMessage(event, ws) {
            const data = JSON.parse(event.data);
            if (data.event === 'join') ws.send(JSON.stringify({ joined: true }));
          },
        })));
      `,
    }));
    expect(gw).toMatchObject({ namespace: '/chat', transport: 'ws', frame: 'raw' });
    expect(gw.events.map((e) => e.event)).toEqual(['join']);
    expect(gw.events[0].response.properties.joined).toEqual({ type: 'boolean' });
  });

  it('falls back to a single "message" event when nothing discriminates messages', () => {
    const [gw] = ExpressWebSocketScanner.scan(make({
      'src/echo.js': "app.get('/echo', { websocket: true }, (socket) => { socket.on('message', (m) => socket.send(m)); });",
    }));
    expect(gw.events.map((e) => e.event)).toEqual(['message']);
  });

  it('reads Mercurius schemas', () => {
    const resolvers = ExpressGraphQLScanner.scan(make({
      'src/app.js': `
        const schema = \`
          type Book { id: ID!, title: String! }
          type Query { books: [Book!]! }
          type Mutation { addBook(title: String!): Book! }
        \`;
        app.register(require('mercurius'), { schema, resolvers });
      `,
    }));
    const ops = resolvers.flatMap((r) => r.operations.map((o) => `${o.kind}:${o.name}`)).sort();
    expect(ops).toEqual(['mutation:addBook', 'query:books']);
  });

  it('ignores template strings named `schema` that are not GraphQL', () => {
    expect(ExpressGraphQLScanner.scan(make({ 'src/x.js': 'const schema = `CREATE TABLE users (id int)`;' }))).toEqual([]);
  });

  it('serves realtime + GraphQL docs for a Fastify project end to end', () => {
    const root = make({
      'package.json': JSON.stringify({ name: 'fy', dependencies: { fastify: '^5', mercurius: '^16' } }),
      'src/prices.js': fastifyWs,
      'src/schema.js': 'module.exports = { schema: `type Query { hello: String }` };',
      'src/routes.js': "module.exports = async (app) => { app.get('/health', async () => ({ ok: true })); };",
    });
    const docs = StandaloneDocsServer.buildDocuments({ sourcePath: path.join(root, 'src') });
    expect(docs.framework).toBe('fastify');
    expect(docs.wsDocument.gateways[0]).toMatchObject({ namespace: '/prices', frame: 'raw' });
    expect(docs.graphqlDocument.resolvers[0].operations.map((o: any) => o.name)).toEqual(['hello']);
  });
});
