/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { SpecScribeLogger } from '../utils/SpecScribeLogger';

let warned = false;

/**
 * Guard for every TypeScript-based scanner: true when the compiler API is
 * there; otherwise logs the reason once and lets the caller return an empty
 * result, so the app still boots and the docs still open.
 */
export function canScanTypeScript(): boolean {
  const support = typeScriptSupport();
  if (!support.ok && !warned) {
    warned = true;
    SpecScribeLogger.warn(support.message!);
  }
  return support.ok;
}

export interface TypeScriptSupport {
  /** The installed `typescript` exposes the compiler API the scanners use. */
  ok: boolean;
  version?: string;
  /** Why scanning TypeScript sources is unavailable, with what to do. */
  message?: string;
}

let cached: TypeScriptSupport | null = null;

/**
 * NestJS controllers, DTOs, gateways and resolvers are read with the
 * TypeScript compiler API (`createProgram` + type checker) of the project's
 * own `typescript`. TypeScript 5 and 6 provide it; TypeScript 7 (the native
 * port) does not expose it from `require('typescript')` yet. Plain Express /
 * Fastify / Hono route scanning does not need TypeScript at all.
 */
export function typeScriptSupport(load: () => unknown = () => require('typescript')): TypeScriptSupport {
  if (cached && arguments.length === 0) return cached;
  let ts: { createProgram?: unknown; SyntaxKind?: unknown; version?: string } | undefined;
  try {
    ts = load() as typeof ts;
  } catch {
    const result: TypeScriptSupport = {
      ok: false,
      message:
        'TypeScript is not installed, so TypeScript/NestJS sources cannot be scanned. ' +
        'Install it with `npm i -D typescript` (5.x or 6.x).',
    };
    if (arguments.length === 0) cached = result;
    return result;
  }
  const version = typeof ts?.version === 'string' ? ts.version : undefined;
  const ok = typeof ts?.createProgram === 'function' && typeof ts?.SyntaxKind === 'object';
  const result: TypeScriptSupport = ok
    ? { ok, version }
    : {
        ok,
        version,
        message:
          `TypeScript ${version ?? '(unknown version)'} does not expose the compiler API SpecScribe uses to read ` +
          'NestJS/TypeScript code (TypeScript 7 has no stable JS API yet). Express, Fastify and Hono routes still work. ' +
          'For NestJS: keep TypeScript 5/6 in this project for now, or run the CLI with an isolated TypeScript 6 — ' +
          '`npx -p typescript@6 -p specscribe specscribe serve` — which leaves your own `tsc` untouched.',
      };
  if (arguments.length === 0) cached = result;
  return result;
}
