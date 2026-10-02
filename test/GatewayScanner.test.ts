/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { buildWsDocument, GatewayInfo, GatewayScanner } from '../src/websocket/GatewayScanner';
import { SpecScribeLogger } from '../src/utils/SpecScribeLogger';

const FIXTURE_SOURCE = 'test/fixtures/gateway-app';

describe('GatewayScanner', () => {
  jest.setTimeout(120_000);

  let gateways: GatewayInfo[];
  let chat: GatewayInfo;

  beforeAll(() => {
    SpecScribeLogger.configure('silent');
    gateways = new GatewayScanner().scanGateways(FIXTURE_SOURCE);
    const found = gateways.find(g => g.name === 'ChatGateway');
    if (!found) throw new Error('ChatGateway fixture was not discovered');
    chat = found;
  });

  afterAll(() => {
    SpecScribeLogger.configure('info');
  });

  it('finds classes decorated with @WebSocketGateway', () => {
    expect(gateways.map(g => g.name).sort()).toEqual(['ChatGateway', 'MetricsGateway']);
  });

  it('normalises the namespace to a leading slash', () => {
    expect(chat.namespace).toBe('/chat');
  });

  it('reads a dedicated port', () => {
    const metrics = gateways.find(g => g.name === 'MetricsGateway')!;
    expect(metrics.port).toBe(3005);
    expect(metrics.namespace).toBe('');
  });

  it('extracts events from @SubscribeMessage', () => {
    expect(chat.events.map(e => e.event).sort()).toEqual(['sendMessage', 'typing']);
  });

  it('analyzes the @MessageBody payload type', () => {
    const send = chat.events.find(e => e.event === 'sendMessage')!;
    expect(send.payloadType?.type).toBe('SendMessageDto');
    const names = (send.payloadType?.properties || []).map(p => p.name).sort();
    expect(names).toEqual(['priority', 'room', 'text']);
  });

  it('analyzes the return type', () => {
    const send = chat.events.find(e => e.event === 'sendMessage')!;
    expect(send.returnType?.type).toBe('ChatMessage');
  });

  it('reads the JSDoc summary', () => {
    const send = chat.events.find(e => e.event === 'sendMessage')!;
    expect(send.summary).toBe('Send a message to a room.');
    expect(send.description).toContain('Broadcasts');
  });

  it('returns an empty array for a directory without gateways', () => {
    expect(new GatewayScanner().scanGateways('test/fixtures/sample-app')).toEqual([]);
  });

  describe('buildWsDocument', () => {
    it('produces JSON schemas for payload and response', () => {
      const doc = buildWsDocument(gateways, { title: 'API', version: '1.0.0' });
      const gateway = doc.gateways.find((g: any) => g.name === 'ChatGateway');
      const send = gateway.events.find((e: any) => e.event === 'sendMessage');

      expect(send.payload.type).toBe('object');
      expect(Object.keys(send.payload.properties).sort()).toEqual(['priority', 'room', 'text']);
      expect(send.payload.required.sort()).toEqual(['room', 'text']);
      expect(send.response.type).toBe('object');
      expect(send.response.properties.sentAt.type).toBe('string');
    });

    it('renders an empty schema for void events', () => {
      const doc = buildWsDocument(gateways, { title: 'API', version: '1.0.0' });
      const gateway = doc.gateways.find((g: any) => g.name === 'ChatGateway');
      const typing = gateway.events.find((e: any) => e.event === 'typing');

      expect(typing.response).toEqual({});
      expect(typing.payload).toEqual({ type: 'string' });
    });

    it('records the transport so the docs UI connects with the right protocol', () => {
      const doc = buildWsDocument(gateways, { title: 'Test', version: '1.0.0' });
      expect(doc.gateways.every((g: any) => g.transport === 'socket.io')).toBe(true);
    });
  });

  describe('transport detection', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const os = require('os') as typeof import('os');
    let dir: string;

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const scan = (files: Record<string, string>) => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-gw-'));
      for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
      return new GatewayScanner().scanGateways(dir);
    };
    const gateway = `
      import { WebSocketGateway, SubscribeMessage } from '@nestjs/websockets';
      @WebSocketGateway()
      export class PingGateway {
        @SubscribeMessage('ping') ping() { return 'pong'; }
      }`;

    it('reports plain WebSocket when the app installs WsAdapter', () => {
      const found = scan({
        'ping.gateway.ts': gateway,
        'main.ts': `import { WsAdapter } from '@nestjs/platform-ws';
          async function bootstrap() { const app = await NestFactory.create(AppModule); app.useWebSocketAdapter(new WsAdapter(app)); }`,
      });
      expect(found[0].transport).toBe('ws');
    });

    it('defaults to Socket.IO (Nest default adapter)', () => {
      expect(scan({ 'ping.gateway.ts': gateway })[0].transport).toBe('socket.io');
    });
  });
});
