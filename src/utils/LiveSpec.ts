/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/

/**
 * Facts only the running app knows — static analysis cannot see
 * `app.setGlobalPrefix('api')` in `main.ts` or the port passed to `listen()`.
 * SpecScribeModule records the prefix when Nest configures middleware
 * (after `setGlobalPrefix()`), and the docs endpoints adapt the scanned
 * document to it per request. This is what makes `forRoot()` need no options.
 */
let runtimeGlobalPrefix = '';

export function normalizePrefix(prefix: string | undefined): string {
  return (prefix || '').replace(/^\/+|\/+$/g, '');
}

export function setRuntimeGlobalPrefix(prefix: string | undefined): void {
  runtimeGlobalPrefix = normalizePrefix(prefix);
}

export function getRuntimeGlobalPrefix(): string {
  return runtimeGlobalPrefix;
}

/** `https://api.example.com` for the request, honouring reverse-proxy headers. */
export function requestOrigin(req: { headers?: Record<string, unknown>; protocol?: string; socket?: { encrypted?: boolean } }): string | undefined {
  const header = (name: string) => {
    const value = req.headers?.[name];
    return (Array.isArray(value) ? value[0] : typeof value === 'string' ? value : '').split(',')[0].trim();
  };
  const host = header('x-forwarded-host') || header('host');
  if (!host || !/^[\w.-]+(:\d+)?$|^\[[0-9a-f:]+\](:\d+)?$/i.test(host)) return undefined;
  const forwarded = header('x-forwarded-proto').toLowerCase();
  const proto = forwarded === 'https' || forwarded === 'http'
    ? forwarded
    : req.protocol === 'https' || req.socket?.encrypted ? 'https' : 'http';
  return `${proto}://${host}`;
}

export interface LiveSpecInput {
  /** `globalPrefix` passed to forRoot() — already applied to the scanned paths. */
  optionPrefix?: string;
  /** Prefix the running app actually uses (`app.setGlobalPrefix()`). */
  runtimePrefix?: string;
  /** The user configured `baseUrl` themselves: keep their `servers`. */
  explicitBaseUrl?: boolean;
  /** Origin the docs were requested on. */
  origin?: string;
  mockEnabled?: boolean;
  mockSegment?: string;
}

/**
 * The scanned document as the running app serves it: paths carry the real
 * global prefix, `servers` points at the address the docs were opened on,
 * and the mock path matches. Returns the original object when nothing changes.
 */
export function liveSpec<T extends { paths?: Record<string, unknown>; servers?: unknown; [key: string]: unknown }>(
  spec: T,
  input: LiveSpecInput,
): T {
  const optionPrefix = normalizePrefix(input.optionPrefix);
  const addPrefix = optionPrefix ? '' : normalizePrefix(input.runtimePrefix);
  const effective = optionPrefix || addPrefix;
  const out: T = { ...spec };
  let changed = false;

  if (addPrefix && spec.paths) {
    const paths: Record<string, unknown> = {};
    for (const [route, item] of Object.entries(spec.paths)) {
      paths[`/${addPrefix}${route === '/' ? '' : route}` || '/'] = item;
    }
    out.paths = paths;
    changed = true;
  }
  if (!input.explicitBaseUrl && input.origin) {
    out.servers = [{ url: input.origin }];
    changed = true;
  }
  if (input.mockEnabled) {
    (out as Record<string, unknown>)['x-specscribe-mock'] = `${effective ? `/${effective}` : ''}/${input.mockSegment || 'specscribe-mock'}`;
    changed = true;
  }
  return changed ? out : spec;
}
