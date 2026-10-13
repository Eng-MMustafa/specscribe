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

/**
 * URI versioning as configured by `app.enableVersioning()` — also invisible
 * to static analysis, and it changes every route that has no `@Version()`.
 */
export interface RuntimeVersioning {
  /** `type: VersioningType.URI` is on (other types do not change paths). */
  enabled: boolean;
  /** `defaultVersion` values; `''` stands for `VERSION_NEUTRAL`. */
  defaults: string[];
  /** Segment prefix — `v` unless `prefix` was set (`false` → none). */
  prefix: string;
}

/** `undefined` until the app is configured, i.e. outside a running Nest app. */
let runtimeVersioning: RuntimeVersioning | undefined;

export function setRuntimeVersioning(versioning: RuntimeVersioning | undefined): void {
  runtimeVersioning = versioning;
}

export function getRuntimeVersioning(): RuntimeVersioning | undefined {
  return runtimeVersioning;
}

/** Internal per-path record of how a route is built; stripped before serving. */
export const ROUTE_META = 'x-specscribe-route';
export interface RouteMeta {
  /** Controller + method path, without global prefix or version: `/users/{id}`. */
  rest: string;
  /** Explicit `@Version()` values (`''` = neutral); absent = inherits `defaultVersion`. */
  version?: string[];
}

/**
 * The versions a route answers on in the running app (`''` = no segment).
 * Nest ignores `@Version()` unless versioning is enabled, and gives
 * unversioned routes the `defaultVersion`.
 */
export function routeVersions(explicit: string[] | undefined, versioning: RuntimeVersioning | undefined): string[] {
  const own = explicit && explicit.length > 0 ? explicit : undefined;
  if (!versioning) return own ?? [''];
  if (!versioning.enabled) return [''];
  const list = own ?? (versioning.defaults.length > 0 ? versioning.defaults : ['']);
  return [...new Set(list)];
}

export function versionSegment(version: string, versioning: RuntimeVersioning | undefined): string {
  return version ? `${versioning ? versioning.prefix : 'v'}${version}` : '';
}

/** `/api/v1/users/{id}` from its parts, skipping empty ones. */
export function joinRoute(...parts: string[]): string {
  const segments = parts.flatMap((part) => part.split('/')).filter(Boolean);
  return '/' + segments.join('/');
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
  /** URI versioning of the running app (see {@link getRuntimeVersioning}). */
  versioning?: RuntimeVersioning;
}

/**
 * The scanned document as the running app serves it: paths carry the real
 * global prefix and URI version, `servers` points at the address the docs
 * were opened on, and the mock path matches. Returns the original object
 * when nothing changes.
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

  const withMeta = spec.paths && Object.values(spec.paths).some((item) => !!(item as Record<string, unknown>)?.[ROUTE_META]);
  if (withMeta && spec.paths) {
    // Rebuilt from parts, so prefix and version are always exactly the app's.
    const paths: Record<string, Record<string, unknown>> = {};
    for (const [route, raw] of Object.entries(spec.paths)) {
      const { [ROUTE_META]: meta, ...item } = raw as Record<string, unknown> & { [ROUTE_META]?: RouteMeta };
      const keys = meta
        ? routeVersions(meta.version, input.versioning).map((v) => joinRoute(effective, versionSegment(v, input.versioning), meta.rest))
        : [route];
      for (const key of keys) paths[key] = paths[key] ? { ...paths[key], ...item } : item;
    }
    out.paths = paths;
    changed = true;
  } else if (addPrefix && spec.paths) {
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
    // Mock URLs read `<prefix>/specscribe-mock/<version>/<route>`: the docs UI
    // strips `x-specscribe-prefix` from a documented path before appending it.
    const record = out as Record<string, unknown>;
    record['x-specscribe-mock'] = `${effective ? `/${effective}` : ''}/${input.mockSegment || 'specscribe-mock'}`;
    if (effective) record['x-specscribe-prefix'] = `/${effective}`;
    else delete record['x-specscribe-prefix'];
    changed = true;
  }
  return changed ? out : spec;
}
