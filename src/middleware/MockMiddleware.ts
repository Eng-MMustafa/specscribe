/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { ControllerInfo, MethodInfo } from '../scanner/ScannerService';
import { MockGenerator } from '../utils/MockGenerator';
import {
  buildRouteSegments,
  compareSpecificity,
  isParamSegment,
  paramName,
  requestSegments,
} from '../utils/RoutePath';
import { getRuntimeGlobalPrefix, getRuntimeVersioning, normalizePrefix, routeVersions, versionSegment } from '../utils/LiveSpec';

/** Injection token carrying the prefix so the mock matches the documented paths. */
export const MOCK_GLOBAL_PREFIX = 'SPECSCRIBE_MOCK_GLOBAL_PREFIX';

export const MOCK_PATH_PREFIX = '/specscribe-mock';

/** Statuses that must not carry a response body. */
const BODILESS_STATUSES = new Set([204, 205, 304]);

/**
 * Extracts the pathname of a request without depending on the HTTP adapter.
 *
 * Express decorates the request with `path`, but that value is relative to the
 * middleware's mount point, so the same middleware sees different values on
 * different adapters. `originalUrl` is the full request path on Express and also
 * available on the raw Node request used by Fastify, making it the reliable
 * source. The query string is stripped so `/specscribe-mock/users?foo=bar` still
 * matches the mock prefix.
 */
function requestPath(req: any): string {
  const url: string = req?.originalUrl ?? req?.url ?? req?.path ?? '';
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

/**
 * Writes a JSON response through the raw Node API.
 *
 * `res.status().json()` is an Express convenience that does not exist on the
 * `ServerResponse` handed to Fastify middleware. `statusCode`, `setHeader` and
 * `end` are part of Node core, so both adapters accept them.
 */
function sendJson(res: any, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

interface CompiledRoute {
  controller: ControllerInfo;
  method: MethodInfo;
  segments: string[];
  /** `true` for `@All()`, which responds to every verb. */
  matchesAnyVerb: boolean;
  /** Version segments this route answers on (`v1`; `''` = unversioned). */
  versions: string[];
}

@Injectable()
export class MockMiddleware implements NestMiddleware {
  private routes: CompiledRoute[];
  private mockPrefixes: string[];
  private compiledFor: string;

  constructor(
    @Inject('SPECSCRIBE_CONTROLLERS') private controllers: ControllerInfo[],
    @Optional() @Inject(MOCK_GLOBAL_PREFIX) private readonly globalPrefix?: string,
  ) {
    this.compiledFor = this.runtimeKey();
    this.mockPrefixes = this.prefixesFor(this.effectivePrefix());
    this.routes = this.compileRoutes();
  }

  /** Everything the route table depends on that the app may set after startup. */
  private runtimeKey(): string {
    return `${this.effectivePrefix()}|${JSON.stringify(getRuntimeVersioning() ?? null)}`;
  }

  /** `globalPrefix` from forRoot(), else what `app.setGlobalPrefix()` set. */
  private effectivePrefix(): string {
    return normalizePrefix(this.globalPrefix) || getRuntimeGlobalPrefix();
  }

  private prefixesFor(prefix: string): string[] {
    return prefix ? [`/${prefix}${MOCK_PATH_PREFIX}`, MOCK_PATH_PREFIX] : [MOCK_PATH_PREFIX];
  }

  use(req: any, res: any, next: any) {
    // Prefix and versioning are only final once the app listens; recompile if they moved.
    const prefix = this.effectivePrefix();
    const key = this.runtimeKey();
    if (key !== this.compiledFor) {
      this.compiledFor = key;
      this.mockPrefixes = this.prefixesFor(prefix);
      this.routes = this.compileRoutes();
    }
    const path = requestPath(req);
    const mockPrefix = this.mockPrefixes.find(p => path === p || path.startsWith(`${p}/`));

    if (!mockPrefix) {
      return next();
    }

    let apiPath = path.slice(mockPrefix.length) || '/';
    // 1.0 URLs repeated the global prefix after the mock segment
    // (`/api/specscribe-mock/api/users`); they keep working.
    if (prefix && (apiPath === `/${prefix}` || apiPath.startsWith(`/${prefix}/`))) {
      apiPath = apiPath.slice(prefix.length + 1) || '/';
    }
    const match = this.findMatchingRoute(apiPath, req.method);

    if (!match) {
      return sendJson(res, 404, {
        error: 'Route not found in scanned controllers',
        path: apiPath,
        method: req.method,
      });
    }

    const statusCode = this.getStatusCode(match.route.method);

    // A 204/205/304 response must not carry a body.
    if (BODILESS_STATUSES.has(statusCode)) {
      res.statusCode = statusCode;
      return res.end();
    }

    sendJson(res, statusCode, MockGenerator.generateMock(match.route.method.returnType));
  }

  /**
   * Flattens the scanned controllers into a route table, sorted so that the most
   * specific route is considered first.
   */
  private compileRoutes(): CompiledRoute[] {
    const routes: CompiledRoute[] = [];
    const versioning = getRuntimeVersioning();

    for (const controller of this.controllers) {
      for (const method of controller.methods) {
        const explicit = method.version ?? controller.version;
        routes.push({
          controller,
          method,
          // The route without prefix or version: `<mock>/<version>/<route>`.
          segments: buildRouteSegments({ controllerPath: controller.path, methodRoute: method.route }),
          versions: routeVersions(explicit === undefined ? undefined : ([] as string[]).concat(explicit), versioning)
            .map((v) => versionSegment(v, versioning)),
          matchesAnyVerb: method.httpMethod.toUpperCase() === 'ALL',
        });
      }
    }

    return routes.sort((a, b) => compareSpecificity(a.segments, b.segments));
  }

  /**
   * Resolves a request to the most specific matching route.
   *
   * NestJS itself resolves overlapping routes in declaration order, so an app
   * that declares `@Get(':id')` before `@Get('me')` never reaches `me`. The mock
   * deliberately prefers the more specific route instead: returning the `:id`
   * payload for a request to a literal `me` route is never the useful answer for
   * a documentation tool, and it silently misled anyone reading the response.
   */
  private findMatchingRoute(
    path: string,
    verb: string,
  ): { route: CompiledRoute; params: Record<string, string> } | null {
    const requested = requestSegments(path);
    const normalizedVerb = (verb || '').toUpperCase();
    const candidates = this.routes.filter(
      (route) => route.matchesAnyVerb || route.method.httpMethod.toUpperCase() === normalizedVerb,
    );

    // `/v1/users` → the route's own version; then `/users` (version omitted).
    for (const route of candidates) {
      const version = route.versions.find((v) => v && v === requested[0]);
      const params = version ? this.matchSegments(route.segments, requested.slice(1)) : null;
      if (params) return { route, params };
    }
    for (const route of candidates) {
      const params = this.matchSegments(route.segments, requested);
      if (params) return { route, params };
    }

    return null;
  }

  /** Returns the extracted path parameters, or `null` when the route does not match. */
  private matchSegments(routeSegments: string[], requested: string[]): Record<string, string> | null {
    if (routeSegments.length !== requested.length) return null;

    const params: Record<string, string> = {};

    for (let i = 0; i < routeSegments.length; i++) {
      const segment = routeSegments[i];

      if (isParamSegment(segment)) {
        params[paramName(segment)] = requested[i];
        continue;
      }

      if (segment !== requested[i]) return null;
    }

    return params;
  }

  /** Honours `@HttpCode()` before falling back to the NestJS convention. */
  private getStatusCode(method: MethodInfo): number {
    if (method.httpCode !== undefined) return method.httpCode;

    switch (method.httpMethod.toUpperCase()) {
      case 'POST':
        return 201;
      default:
        return 200;
    }
  }
}