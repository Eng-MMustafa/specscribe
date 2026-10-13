/**
 * Express projects that keep event names and routes in constants, and expose
 * several routers from one file (`/api/v1`, `/api/v2`).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExpressScanner } from '../src/express/ExpressScanner';
import { ExpressWebSocketScanner } from '../src/express/ExpressWebSocketScanner';
import { ExpressSymbolRegistry } from '../src/express/ExpressSymbolRegistry';

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-xc-'));
  for (const [rel, text] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return root;
}

const events = `
const COLLAB_EVENTS = Object.freeze({ JOIN: 'file:collab:join', LEAVE: 'file:collab:leave' });
const CHAT = { SEND: 'chat:send', TYPING: 'chat:typing' };
const NS = 'realtime';
const COLLAB_NAMESPACE = \`/\${NS}\`;
const ROUTES = { PROJECTS: '/projects', PROJECT_BY_ID: '/projects/:id' };
module.exports = { COLLAB_EVENTS, CHAT, COLLAB_NAMESPACE, ROUTES };
`;

describe('Express: constants and several routers per file', () => {
  const roots: string[] = [];
  const make = (files: Record<string, string>) => { const r = project(files); roots.push(r); return r; };
  afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

  it('resolves constants across files: object members (first, last, frozen), templates, concatenation', () => {
    const root = make({ 'src/events.js': events, 'src/use.js': "const { COLLAB_EVENTS, CHAT, COLLAB_NAMESPACE } = require('./events');" });
    const registry = new ExpressSymbolRegistry(path.join(root, 'src'));
    const from = path.join(root, 'src', 'use.js');
    expect(registry.resolveString('COLLAB_EVENTS.JOIN', from)).toBe('file:collab:join');
    expect(registry.resolveString("COLLAB_EVENTS['LEAVE']", from)).toBe('file:collab:leave');
    expect(registry.resolveString('CHAT.SEND', from)).toBe('chat:send');
    expect(registry.resolveString('COLLAB_NAMESPACE', from)).toBe('/realtime');
    expect(registry.resolveString("'x:' + CHAT.TYPING", from)).toBe('x:chat:typing');
    expect(registry.resolveString('process.env.PORT', from)).toBeUndefined();
  });

  it('documents socket events written as constants, with their own summaries and namespace', () => {
    const root = make({
      'src/events.js': events,
      'src/collab.js': `
        const { COLLAB_EVENTS, CHAT, COLLAB_NAMESPACE } = require('./events');
        /** Collaboration gateway. */
        function setup(io) {
          const collab = io.of(COLLAB_NAMESPACE);
          collab.on('connection', (socket) => {
            /** Join a file. */
            socket.on(COLLAB_EVENTS.JOIN, ({ fileId }, ack) => { ack({ joined: fileId }); });
            // Send a chat message.
            socket.on(CHAT.SEND, ({ text }) => { collab.emit('chat:message', { text }); });
          });
        }
        module.exports = { setup };
      `,
    });
    const [gateway] = ExpressWebSocketScanner.scan(path.join(root, 'src'));
    expect(gateway.namespace).toBe('/realtime');
    expect(gateway.events.map((e) => [e.event, e.summary])).toEqual([
      ['file:collab:join', 'Join a file'],
      ['chat:send', 'Send a chat message'],
    ]);
    expect(Object.keys(gateway.events[0].response.properties)).toEqual(['joined']);
  });

  it('mounts each exported router at its own prefix, with constant paths', () => {
    const root = make({
      'src/events.js': events,
      'src/projects.js': `
        const express = require('express');
        const { ROUTES } = require('./events');
        const v1 = express.Router();
        /** List projects. */
        v1.get(ROUTES.PROJECTS, (req, res) => res.json([]));
        /** Get a project. */
        v1.get(ROUTES.PROJECT_BY_ID, (req, res) => res.json({ id: 1 }));
        const v2 = express.Router();
        /** List projects (v2). */
        v2.get(ROUTES.PROJECTS, (req, res) => res.json([]));
        module.exports = { projectsV1: v1, projectsV2: v2 };
      `,
      'src/app.js': `
        const express = require('express');
        const { projectsV1, projectsV2 } = require('./projects');
        const app = express();
        app.use('/api/v1', projectsV1);
        app.use('/api/v2', projectsV2);
        app.get(KEY);
      `,
    });
    const routes = ExpressScanner.scan(path.join(root, 'src')).flatMap((c) => c.routes.map((r) => `${r.method.toUpperCase()} ${r.path} — ${r.summary}`));
    expect(routes.sort()).toEqual([
      'GET /api/v1/projects — List projects',
      'GET /api/v1/projects/{id} — Get a project',
      'GET /api/v2/projects — List projects (v2)',
    ]);
  });
});
