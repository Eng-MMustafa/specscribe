/**
 * TypeScript 5/6 expose the compiler API the NestJS scanners use; TypeScript 7
 * (native port) does not, and plain-JS projects may have no TypeScript at all.
 * Scanning must degrade to a clear message instead of crashing the app.
 */
import * as ts from 'typescript';
import { typeScriptSupport } from '../src/analysis/TypeScriptSupport';
import { ScannerService } from '../src/scanner/ScannerService';

describe('typeScriptSupport', () => {
  it('accepts the installed TypeScript 5/6', () => {
    expect(typeScriptSupport(() => ts)).toEqual({ ok: true, version: ts.version });
  });

  it('explains TypeScript 7 (no compiler API) without breaking anything', () => {
    const result = typeScriptSupport(() => ({ version: '7.0.2', versionMajorMinor: '7.0' }));
    expect(result.ok).toBe(false);
    expect(result.version).toBe('7.0.2');
    expect(result.message).toContain('TypeScript 7.0.2 does not expose the compiler API');
    expect(result.message).toContain('npx -p typescript@6 -p specscribe specscribe serve');
    expect(result.message).toContain('Express, Fastify and Hono routes still work');
  });

  it('explains a missing TypeScript', () => {
    const result = typeScriptSupport(() => { throw Object.assign(new Error('nope'), { code: 'MODULE_NOT_FOUND' }); });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('npm i -D typescript');
  });

  it('scans normally with the real TypeScript', () => {
    expect(new ScannerService().scanControllers('test/fixtures/sample-app').length).toBeGreaterThan(0);
  });
});
