/**
 * A dependency-free plain WebSocket server (RFC 6455, text frames only) with a
 * socket.io-like surface, so the fixture exercises the docs UI's raw
 * WebSocket path without installing `ws` or `socket.io`.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encode(text) {
  const payload = Buffer.from(text);
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

function decode(buffer) {
  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) { length = buffer.readUInt16BE(2); offset = 4; }
  const mask = buffer.subarray(offset, offset + 4);
  const data = buffer.subarray(offset + 4, offset + 4 + length);
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  return { opcode, text: data.toString('utf8') };
}

class WebSocketServer extends EventEmitter {
  constructor({ server }) {
    super();
    server.on('upgrade', (req, tcp) => {
      const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
      tcp.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
      const client = new EventEmitter();
      client.emit = client.emit.bind(client);
      const handlers = new Map();
      client.on = (event, fn) => { handlers.set(event, fn); return client; };
      tcp.on('data', (chunk) => {
        const { opcode, text } = decode(chunk);
        if (opcode === 0x8) { tcp.end(); return; }
        let msg;
        try { msg = JSON.parse(text); } catch { return; }
        const handler = handlers.get(msg.event);
        if (handler) handler(msg.data, (reply) => tcp.write(encode(JSON.stringify({ event: msg.event, data: reply }))));
      });
      tcp.on('error', () => {});
      super.emit('connection', client);
    });
  }
}

module.exports = { WebSocketServer };
