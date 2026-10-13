/**
 * Decorator arguments written as constants instead of literals (issue #1 and
 * the same root cause for routes): event names, namespaces, controller paths
 * and versions resolve to their values instead of being dropped.
 */
import * as path from 'path';
import { GatewayScanner } from '../src/websocket/GatewayScanner';
import { ScannerService } from '../src/scanner/ScannerService';
import { SpecScribeLogger } from '../src/utils/SpecScribeLogger';

const src = path.join(__dirname, 'e2e', 'versioned-smoke', 'src');

describe('constants in decorator arguments', () => {
  beforeAll(() => SpecScribeLogger.configure('silent'));
  afterAll(() => SpecScribeLogger.configure('info'));

  it('documents every @SubscribeMessage written with a constant', () => {
    const [gateway] = new GatewayScanner().scanGateways(src);
    expect(gateway.events.map((e) => e.event).sort()).toEqual([
      'chat:send',          // string enum member
      'chat:typing',        // 'chat:' + 'typing'
      'file:collab:join',   // COLLAB_EVENTS.JOIN (as const, imported)
      'file:collab:leave',  // EV['LEAVE'] (aliased import, element access)
      'presence:ping',      // object without `as const`
      'project:subscribe',  // literal
      'room:local:enter',   // template with a local const
    ]);
    const join = gateway.events.find((e) => e.event === 'file:collab:join')!;
    expect(join.summary).toBe("Join a file's collaboration session.");
  });

  it('resolves a namespace built from constants', () => {
    expect(new GatewayScanner().scanGateways(src)[0].namespace).toBe('/realtime');
  });

  it('resolves @Controller(ROUTES.USERS) and keeps @Version on methods', () => {
    const users = new ScannerService().scanControllers(src).find((c) => c.name === 'UsersController')!;
    expect(users.path).toBe('users');
    expect(users.methods.find((m) => m.name === 'listV2')?.version).toBe('2');
  });
});

describe('versions and status codes from constants', () => {
  beforeAll(() => SpecScribeLogger.configure('silent'));
  afterAll(() => SpecScribeLogger.configure('info'));

  it('reads VERSION_NEUTRAL and any HttpStatus member', () => {
    const reports = new ScannerService().scanControllers(src).find((c) => c.path === 'reports')!;
    expect(reports.version).toBe('');
    expect(reports.methods[0].httpCode).toBe(207);
  });
});
