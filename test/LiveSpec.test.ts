/**
 * forRoot() with no options: the docs adapt to what only the running app
 * knows — the global prefix from main.ts and the real host/port.
 */
import { liveSpec, normalizePrefix, requestOrigin } from '../src/utils/LiveSpec';

type Doc = { paths?: Record<string, unknown>; servers?: unknown; [key: string]: unknown };

const spec: Doc = {
  openapi: '3.0.0',
  servers: [{ url: 'http://localhost:3000' }],
  paths: { '/users': { get: {} }, '/users/{id}': { get: {} }, '/': { get: {} } },
};

describe('liveSpec', () => {
  it('adds the runtime global prefix, points servers at the real origin and moves the mock', () => {
    const out = liveSpec(spec, { runtimePrefix: 'api', origin: 'http://localhost:3456', mockEnabled: true });
    expect(Object.keys(out.paths!)).toEqual(['/api/users', '/api/users/{id}', '/api']);
    expect(out.servers).toEqual([{ url: 'http://localhost:3456' }]);
    expect(out['x-specscribe-mock']).toBe('/api/specscribe-mock');
    expect(spec.paths).toHaveProperty('/users'); // the scanned document is untouched
  });

  it('never doubles a prefix that forRoot({ globalPrefix }) already applied', () => {
    const prefixed: Doc = { ...spec, paths: { '/api/users': { get: {} } } };
    const out = liveSpec(prefixed, { optionPrefix: 'api', runtimePrefix: 'api', origin: 'http://h:1', mockEnabled: true });
    expect(Object.keys(out.paths!)).toEqual(['/api/users']);
    expect(out['x-specscribe-mock']).toBe('/api/specscribe-mock');
  });

  it('keeps a configured baseUrl and returns the same object when nothing changes', () => {
    expect(liveSpec(spec, { explicitBaseUrl: true, origin: 'http://elsewhere' })).toBe(spec);
    const noPrefix = liveSpec(spec, { origin: 'http://localhost:9' });
    expect(Object.keys(noPrefix.paths!)).toEqual(Object.keys(spec.paths!));
  });

  it('normalises prefixes', () => {
    expect(normalizePrefix('/api/')).toBe('api');
    expect(normalizePrefix(undefined)).toBe('');
  });
});

describe('requestOrigin', () => {
  it('uses the Host header and the connection protocol', () => {
    expect(requestOrigin({ headers: { host: 'localhost:3456' } })).toBe('http://localhost:3456');
    expect(requestOrigin({ headers: { host: 'api.example.com' }, socket: { encrypted: true } })).toBe('https://api.example.com');
  });

  it('honours reverse-proxy headers', () => {
    expect(requestOrigin({ headers: { host: 'internal:8080', 'x-forwarded-host': 'api.example.com', 'x-forwarded-proto': 'https' } }))
      .toBe('https://api.example.com');
  });

  it('rejects hosts that are not a plain host[:port]', () => {
    expect(requestOrigin({ headers: { host: 'evil.com/path' } })).toBeUndefined();
    expect(requestOrigin({ headers: { host: 'a b' } })).toBeUndefined();
    expect(requestOrigin({ headers: {} })).toBeUndefined();
    expect(requestOrigin({ headers: { host: '[::1]:3000' } })).toBe('http://[::1]:3000');
  });
});
