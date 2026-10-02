/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { buildAsyncApiDocument } from '../src/utils/AsyncApiTransformer';
import { GatewayScanner } from '../src/websocket/GatewayScanner';
import { SpecScribeLogger } from '../src/utils/SpecScribeLogger';

const FIXTURE_SOURCE = 'test/fixtures/gateway-app';

describe('AsyncApiTransformer', () => {
  jest.setTimeout(120_000);

  beforeAll(() => {
    SpecScribeLogger.configure('silent');
  });

  afterAll(() => {
    SpecScribeLogger.configure('info');
  });

  it('produces an AsyncAPI 2.6.0 document', () => {
    const gateways = new GatewayScanner().scanGateways(FIXTURE_SOURCE);
    const doc = buildAsyncApiDocument(gateways, { title: 'Chat API', version: '1.0.0' });

    expect(doc.asyncapi).toBe('2.6.0');
    expect(doc.info.title).toContain('Chat API');
    expect(doc.info.version).toBe('1.0.0');
    expect(doc.defaultContentType).toBe('application/json');
  });

  it('creates a channel per gateway event', () => {
    const gateways = new GatewayScanner().scanGateways(FIXTURE_SOURCE);
    const doc = buildAsyncApiDocument(gateways, { title: 'Chat API', version: '1.0.0' });

    expect(Object.keys(doc.channels)).toContain('/chat/sendMessage');
    expect(Object.keys(doc.channels)).toContain('/chat/typing');

    const sendMessage = doc.channels['/chat/sendMessage'];
    expect(sendMessage.publish.operationId).toBe('ChatGateway_sendMessage_emit');
    expect(sendMessage.subscribe.operationId).toBe('ChatGateway_sendMessage_receive');
    expect(sendMessage.publish.summary).toContain('sendMessage');
  });

  it('keeps channels empty when no gateways exist', () => {
    const doc = buildAsyncApiDocument([], { title: 'Empty', version: '1.0.0' });
    expect(doc.channels).toEqual({});
  });
});
