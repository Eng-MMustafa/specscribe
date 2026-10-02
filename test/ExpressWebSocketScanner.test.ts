/**
 * Socket.IO events in plain Express projects: payloads, acknowledgements,
 * emitted events and the transport the docs UI should connect with.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExpressWebSocketScanner } from '../src/express/ExpressWebSocketScanner';

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-ws-'));
  for (const [rel, text] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return root;
}

describe('ExpressWebSocketScanner', () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

  const scan = (files: Record<string, string>) => {
    const root = project(files);
    roots.push(root);
    return ExpressWebSocketScanner.scan(root);
  };

  const gateway = `
    const { Server } = require('socket.io');
    function setup(io) {
      io.of('/orders').on('connection', (socket) => {
        // Subscribe to updates for one order.
        socket.on('subscribeOrder', (orderId, callback) => {
          socket.join(orderId);
          callback({ status: 'subscribed', orderId });
        });

        socket.on('updateOrderStatus', ({ orderId, status }) => {
          io.to(orderId).emit('orderStatusChanged', { orderId, status });
        });

        socket.on('chat', (message) => {
          const { text } = message;
          socket.emit('chat:ack', { received: true, length: message.length });
        });

        socket.on('disconnect', () => {});
      });
    }
    module.exports = { setup };
  `;

  it('documents payloads, acknowledgements and emitted events', () => {
    const [gw] = scan({ 'src/realtime/orders.gateway.js': gateway });
    const byName = Object.fromEntries(gw.events.map((e) => [e.event, e]));
    expect(Object.keys(byName).sort()).toEqual(['chat', 'subscribeOrder', 'updateOrderStatus']);

    expect(byName.subscribeOrder.summary).toBe('Subscribe to updates for one order');
    expect(byName.subscribeOrder.payload).toMatchObject({ type: 'string' });
    expect(byName.subscribeOrder.response.properties).toEqual({ status: { type: 'string' }, orderId: { type: 'string' } });

    expect(byName.updateOrderStatus.payload).toEqual({
      type: 'object',
      properties: { orderId: { type: 'string' }, status: { type: 'string' } },
      required: ['orderId', 'status'],
    });
    expect(byName.updateOrderStatus.emits).toEqual([
      { event: 'orderStatusChanged', payload: { type: 'object', properties: { orderId: { type: 'string' }, status: { type: 'string' } } } },
    ]);
    // A room broadcast is not an answer to the sender.
    expect(byName.updateOrderStatus.response).toBeUndefined();

    // Field reads on a single parameter make it an object; socket.emit is the reply.
    expect(Object.keys(byName.chat.payload.properties).sort()).toEqual(['length', 'text']);
    expect(byName.chat.response.properties.received).toEqual({ type: 'boolean' });
  });

  it('reads the namespace and the Socket.IO transport', () => {
    const [gw] = scan({ 'src/orders.gateway.js': gateway });
    expect(gw.namespace).toBe('/orders');
    expect(gw.transport).toBe('socket.io');
  });

  it('reports plain WebSocket for projects on the ws package', () => {
    const [gw] = scan({
      'src/server.js': "const { WebSocketServer } = require('ws'); const wss = new WebSocketServer({ port: 8080 });",
      'src/events.js': "io.on('connection', (socket) => { socket.on('ping', (data, cb) => cb({ pong: true })); });",
    });
    expect(gw.transport).toBe('ws');
  });

  it('keeps absolute file paths out of the browser document', () => {
    const gateways = scan({ 'src/orders.gateway.js': gateway });
    const doc = ExpressWebSocketScanner.buildDocument(gateways, { title: 'T', version: '1' });
    expect(JSON.stringify(doc)).not.toContain(os.tmpdir().replace(/\\/g, '\\\\'));
    expect(doc.gateways[0]).not.toHaveProperty('filePath');
  });
});
